use crate::telemetry_contract::{
    TelemetryClearSessionResult, TelemetryCountBucket, TelemetryIngestBatchResult,
    TelemetryPolicy, TelemetryQueryInput, TelemetryQueryResult, TelemetryReadSessionResult,
    TelemetryRecord, TelemetryStatus,
};
use crate::telemetry_policy::should_accept_record;
use crate::telemetry_store::TelemetryStore;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

static SESSION_SEQUENCE: AtomicU64 = AtomicU64::new(1);
const DEFAULT_QUERY_LIMIT: usize = 160;
const MAX_QUERY_LIMIT: usize = 500;
const MAX_QUERY_BUCKETS: usize = 12;

#[derive(Debug)]
pub struct TelemetryCore {
    inner: Mutex<TelemetryCoreInner>,
}

#[derive(Debug)]
struct TelemetryCoreInner {
    policy: TelemetryPolicy,
    store: Option<TelemetryStore>,
    current_session_id: String,
    flushed_records: u64,
    dropped_records: u64,
    current_file_bytes: u64,
    last_error: Option<String>,
}

impl TelemetryCore {
    pub fn new(app: &AppHandle, policy: TelemetryPolicy) -> Self {
        let (store, last_error) = match TelemetryStore::new(app) {
            Ok(store) => (Some(store), None),
            Err(error) => (None, Some(error)),
        };

        Self::new_with_store(policy, store, last_error)
    }

    fn new_with_store(
        policy: TelemetryPolicy,
        store: Option<TelemetryStore>,
        last_error: Option<String>,
    ) -> Self {
        let current_file_bytes = store
            .as_ref()
            .map(TelemetryStore::current_file_len)
            .unwrap_or(0);

        Self {
            inner: Mutex::new(TelemetryCoreInner {
                policy,
                store,
                current_session_id: generate_session_id(),
                flushed_records: 0,
                dropped_records: 0,
                current_file_bytes,
                last_error,
            }),
        }
    }

    #[cfg(test)]
    fn new_for_tests(root_dir: std::path::PathBuf, policy: TelemetryPolicy) -> Self {
        let (store, last_error) = match TelemetryStore::new_for_root_dir(root_dir) {
            Ok(store) => (Some(store), None),
            Err(error) => (None, Some(error)),
        };
        Self::new_with_store(policy, store, last_error)
    }

    pub fn update_policy(&self, policy: TelemetryPolicy) {
        let mut guard = lock_inner(&self.inner);
        guard.policy = policy;
    }

    pub fn status(&self) -> TelemetryStatus {
        let guard = lock_inner(&self.inner);
        guard.status()
    }

    pub fn ingest_batch(&self, records: Vec<TelemetryRecord>) -> TelemetryIngestBatchResult {
        let mut guard = lock_inner(&self.inner);
        let mut accepted_records = Vec::<TelemetryRecord>::new();
        let mut dropped_count = 0u64;

        for mut record in records {
            if record.session_id.trim().is_empty() {
                record.session_id = guard.current_session_id.clone();
            }
            if should_accept_record(&guard.policy, &record) {
                accepted_records.push(record);
            } else {
                dropped_count = dropped_count.saturating_add(1);
            }
        }

        let accepted_count = accepted_records.len() as u64;
        if accepted_count > 0 {
            if let Some(store) = guard.store.as_ref() {
                match store.append_records(&accepted_records) {
                    Ok(bytes_written) => {
                        guard.flushed_records = guard.flushed_records.saturating_add(accepted_count);
                        guard.current_file_bytes =
                            guard.current_file_bytes.saturating_add(bytes_written);
                        guard.last_error = None;
                    }
                    Err(error) => {
                        dropped_count = dropped_count.saturating_add(accepted_count);
                        guard.dropped_records = guard.dropped_records.saturating_add(accepted_count);
                        guard.last_error = Some(error);
                        return TelemetryIngestBatchResult {
                            accepted_count: 0,
                            dropped_count,
                            status: guard.status(),
                        };
                    }
                }
            } else {
                dropped_count = dropped_count.saturating_add(accepted_count);
                guard.dropped_records = guard.dropped_records.saturating_add(accepted_count);
                return TelemetryIngestBatchResult {
                    accepted_count: 0,
                    dropped_count,
                    status: guard.status(),
                };
            }
        }

        if dropped_count > 0 {
            guard.dropped_records = guard.dropped_records.saturating_add(dropped_count);
        }

        TelemetryIngestBatchResult {
            accepted_count,
            dropped_count,
            status: guard.status(),
        }
    }

    pub fn clear_session(&self) -> TelemetryClearSessionResult {
        let mut guard = lock_inner(&self.inner);
        let previous_session_id = guard.current_session_id.clone();

        if let Some(store) = guard.store.clone() {
            if let Err(error) = store.clear_current_session() {
                guard.last_error = Some(error);
            } else {
                guard.last_error = None;
            }
            guard.current_file_bytes = store.current_file_len();
        } else if guard.last_error.is_none() {
            guard.last_error = Some("Telemetry store unavailable".to_string());
        }

        guard.current_session_id = generate_session_id();
        guard.flushed_records = 0;
        guard.dropped_records = 0;

        TelemetryClearSessionResult {
            previous_session_id,
            status: guard.status(),
        }
    }

    pub fn read_current_session(&self) -> TelemetryReadSessionResult {
        let guard = lock_inner(&self.inner);
        let records = match guard.store.as_ref() {
            Some(store) => match store.read_current_session_records() {
                Ok(records) => records
                    .into_iter()
                    .filter(|record| record.session_id == guard.current_session_id)
                    .collect::<Vec<_>>(),
                Err(_) => Vec::new(),
            },
            None => Vec::new(),
        };

        TelemetryReadSessionResult {
            status: guard.status(),
            record_count: records.len() as u64,
            records,
        }
    }

    pub fn query_current_session(&self, input: TelemetryQueryInput) -> TelemetryQueryResult {
        let (status, store, current_session_id) = {
            let guard = lock_inner(&self.inner);
            (
                guard.status(),
                guard.store.clone(),
                guard.current_session_id.clone(),
            )
        };

        let records = match store.as_ref() {
            Some(store) => match store.read_current_session_records() {
                Ok(records) => records
                    .into_iter()
                    .filter(|record| record.session_id == current_session_id)
                    .collect::<Vec<_>>(),
                Err(_) => Vec::new(),
            },
            None => Vec::new(),
        };

        build_query_result(status, records, input)
    }
}

impl TelemetryCoreInner {
    fn status(&self) -> TelemetryStatus {
        TelemetryStatus {
            enabled: self.policy.enabled,
            current_session_id: self.current_session_id.clone(),
            queued_records: 0,
            flushed_records: self.flushed_records,
            dropped_records: self.dropped_records,
            current_file_bytes: self.current_file_bytes,
            current_file_path: self
                .store
                .as_ref()
                .map(|store| normalize_path(store.current_file_path())),
            frontend_min_level: self.policy.frontend_min_level,
            backend_min_level: self.policy.backend_min_level,
            persist_min_level: self.policy.persist_min_level,
            last_error: self.last_error.clone(),
        }
    }
}

fn lock_inner<'a>(inner: &'a Mutex<TelemetryCoreInner>) -> std::sync::MutexGuard<'a, TelemetryCoreInner> {
    match inner.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn generate_session_id() -> String {
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let sequence = SESSION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("session-{timestamp_ms}-{sequence}")
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[derive(Debug)]
struct NormalizedTelemetryQuery {
    module_ids: BTreeSet<String>,
    levels: Vec<crate::telemetry_contract::TelemetryLevel>,
    kinds: Vec<crate::telemetry_contract::TelemetryKind>,
    search_text: Option<String>,
    from_ts: Option<u64>,
    to_ts: Option<u64>,
    limit: usize,
}

fn normalize_query_input(input: TelemetryQueryInput) -> NormalizedTelemetryQuery {
    let module_ids = input
        .module_ids
        .into_iter()
        .filter_map(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .collect::<BTreeSet<_>>();

    let search_text = input
        .search_text
        .and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_lowercase())
            }
        });

    let limit = input
        .limit
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_QUERY_LIMIT)
        .clamp(1, MAX_QUERY_LIMIT);

    NormalizedTelemetryQuery {
        module_ids,
        levels: input.levels,
        kinds: input.kinds,
        search_text,
        from_ts: input.from_ts,
        to_ts: input.to_ts,
        limit,
    }
}

fn record_matches_query(record: &TelemetryRecord, query: &NormalizedTelemetryQuery) -> bool {
    if let Some(from_ts) = query.from_ts {
        if record.ts < from_ts {
            return false;
        }
    }
    if let Some(to_ts) = query.to_ts {
        if record.ts > to_ts {
            return false;
        }
    }
    if !query.module_ids.is_empty() && !query.module_ids.contains(&record.module_id) {
        return false;
    }
    if !query.levels.is_empty() && !query.levels.iter().any(|level| *level == record.level) {
        return false;
    }
    if !query.kinds.is_empty() && !query.kinds.iter().any(|kind| *kind == record.kind) {
        return false;
    }
    if let Some(search_text) = query.search_text.as_deref() {
        return record_matches_search(record, search_text);
    }
    true
}

fn record_matches_search(record: &TelemetryRecord, search_text: &str) -> bool {
    let mut haystacks = Vec::with_capacity(8);
    haystacks.push(record.module_id.to_lowercase());
    haystacks.push(record.event.to_lowercase());

    if let Some(component) = record.component.as_ref() {
        haystacks.push(component.to_lowercase());
    }
    if let Some(message) = record.message.as_ref() {
        haystacks.push(message.to_lowercase());
    }
    if let Some(trace_id) = record.trace_id.as_ref() {
        haystacks.push(trace_id.to_lowercase());
    }
    if let Some(span_id) = record.span_id.as_ref() {
        haystacks.push(span_id.to_lowercase());
    }
    if let Some(window_id) = record.window_id.as_ref() {
        haystacks.push(window_id.to_lowercase());
    }
    if let Some(fields) = record.fields.as_ref() {
        if let Ok(serialized) = serde_json::to_string(fields) {
            haystacks.push(serialized.to_lowercase());
        }
    }

    haystacks.into_iter().any(|value| value.contains(search_text))
}

fn push_count(map: &mut BTreeMap<String, u64>, key: String) {
    let next = map.get(&key).copied().unwrap_or(0).saturating_add(1);
    map.insert(key, next);
}

fn sort_count_buckets(map: BTreeMap<String, u64>) -> Vec<TelemetryCountBucket> {
    let mut buckets = map
        .into_iter()
        .map(|(key, count)| TelemetryCountBucket { key, count })
        .collect::<Vec<_>>();
    buckets.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.key.cmp(&right.key))
    });
    buckets.truncate(MAX_QUERY_BUCKETS);
    buckets
}

fn build_query_result(
    status: TelemetryStatus,
    records: Vec<TelemetryRecord>,
    input: TelemetryQueryInput,
) -> TelemetryQueryResult {
    let query = normalize_query_input(input);
    let scanned_record_count = records.len() as u64;
    let mut matched_record_count = 0u64;
    let mut first_matched_ts = None;
    let mut last_matched_ts = None;
    let mut module_counts = BTreeMap::<String, u64>::new();
    let mut level_counts = BTreeMap::<String, u64>::new();
    let mut event_counts = BTreeMap::<String, u64>::new();
    let mut latest_records = VecDeque::<TelemetryRecord>::new();

    for record in records {
        if !record_matches_query(&record, &query) {
            continue;
        }

        matched_record_count = matched_record_count.saturating_add(1);
        first_matched_ts = Some(first_matched_ts.unwrap_or(record.ts));
        last_matched_ts = Some(record.ts);
        push_count(&mut module_counts, record.module_id.clone());
        push_count(&mut level_counts, format!("{:?}", record.level).to_lowercase());
        push_count(&mut event_counts, record.event.clone());

        if latest_records.len() == query.limit {
            latest_records.pop_front();
        }
        latest_records.push_back(record);
    }

    TelemetryQueryResult {
        status,
        scanned_record_count,
        matched_record_count,
        first_matched_ts,
        last_matched_ts,
        records: latest_records.into_iter().collect(),
        module_counts: sort_count_buckets(module_counts),
        level_counts: sort_count_buckets(level_counts),
        event_counts: sort_count_buckets(event_counts),
    }
}

#[cfg(test)]
mod tests {
    use super::TelemetryCore;
    use crate::telemetry_contract::{
        TelemetryKind, TelemetryLevel, TelemetryPolicy, TelemetryQueryInput, TelemetryRecord,
        TelemetrySide,
    };
    use std::time::{SystemTime, UNIX_EPOCH};

    fn record(level: TelemetryLevel) -> TelemetryRecord {
        TelemetryRecord {
            ts: 1,
            level,
            kind: TelemetryKind::Log,
            side: TelemetrySide::Frontend,
            module_id: "test".to_string(),
            event: "hello".to_string(),
            session_id: String::new(),
            component: None,
            message: None,
            trace_id: None,
            span_id: None,
            window_id: None,
            fields: None,
        }
    }

    fn test_root_dir() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("pmp-telemetry-test-{nanos}"))
    }

    #[test]
    fn ingest_batch_tracks_accepted_and_dropped_records() {
        let mut policy = TelemetryPolicy::default();
        policy.persist_min_level = TelemetryLevel::Warn;
        let root_dir = test_root_dir();
        let core = TelemetryCore::new_for_tests(root_dir.clone(), policy);

        let result = core.ingest_batch(vec![record(TelemetryLevel::Info), record(TelemetryLevel::Error)]);
        assert_eq!(result.accepted_count, 1);
        assert_eq!(result.dropped_count, 1);
        assert_eq!(result.status.flushed_records, 1);
        assert_eq!(result.status.dropped_records, 1);

        let _ = std::fs::remove_dir_all(root_dir);
    }

    #[test]
    fn clear_session_resets_counters_and_rotates_session_id() {
        let root_dir = test_root_dir();
        let core = TelemetryCore::new_for_tests(root_dir.clone(), TelemetryPolicy::default());

        let before = core.status();
        let _ = core.ingest_batch(vec![record(TelemetryLevel::Error)]);
        let cleared = core.clear_session();
        assert_eq!(cleared.previous_session_id, before.current_session_id);
        assert_eq!(cleared.status.flushed_records, 0);
        assert_eq!(cleared.status.dropped_records, 0);
        assert_ne!(cleared.status.current_session_id, before.current_session_id);

        let _ = std::fs::remove_dir_all(root_dir);
    }

    #[test]
    fn read_current_session_returns_only_active_session_records() {
        let root_dir = test_root_dir();
        let core = TelemetryCore::new_for_tests(root_dir.clone(), TelemetryPolicy::default());

        let _ = core.ingest_batch(vec![record(TelemetryLevel::Error)]);
        let session_before_clear = core.status().current_session_id;
        let _ = core.clear_session();
        let session_after_clear = core.status().current_session_id;
        let _ = core.ingest_batch(vec![record(TelemetryLevel::Error)]);

        let result = core.read_current_session();
        assert_eq!(result.record_count, 1);
        assert_eq!(result.records.len(), 1);
        assert_eq!(result.records[0].session_id, session_after_clear);
        assert_ne!(result.records[0].session_id, session_before_clear);

        let _ = std::fs::remove_dir_all(root_dir);
    }

    #[test]
    fn query_current_session_filters_records_and_keeps_recent_limit() {
        let root_dir = test_root_dir();
        let mut policy = TelemetryPolicy::default();
        policy.persist_min_level = TelemetryLevel::Info;
        let core = TelemetryCore::new_for_tests(root_dir.clone(), policy);

        let mut first = record(TelemetryLevel::Info);
        first.ts = 10;
        first.module_id = "audio".to_string();
        first.event = "audio.queue.add".to_string();

        let mut second = record(TelemetryLevel::Warn);
        second.ts = 20;
        second.module_id = "playlists".to_string();
        second.event = "playlists.overlay.opened".to_string();

        let mut third = record(TelemetryLevel::Error);
        third.ts = 30;
        third.module_id = "audio".to_string();
        third.event = "audio.track.switch.failed".to_string();

        let _ = core.ingest_batch(vec![first, second, third]);

        let result = core.query_current_session(TelemetryQueryInput {
            module_ids: vec!["audio".to_string()],
            levels: vec![TelemetryLevel::Info, TelemetryLevel::Error],
            kinds: Vec::new(),
            search_text: None,
            from_ts: Some(5),
            to_ts: Some(35),
            limit: Some(1),
        });

        assert_eq!(result.scanned_record_count, 3);
        assert_eq!(result.matched_record_count, 2);
        assert_eq!(result.first_matched_ts, Some(10));
        assert_eq!(result.last_matched_ts, Some(30));
        assert_eq!(result.records.len(), 1);
        assert_eq!(result.records[0].event, "audio.track.switch.failed");
        assert_eq!(result.module_counts[0].key, "audio");
        assert_eq!(result.module_counts[0].count, 2);

        let _ = std::fs::remove_dir_all(root_dir);
    }

    #[test]
    fn query_current_session_searches_message_and_fields() {
        let root_dir = test_root_dir();
        let mut policy = TelemetryPolicy::default();
        policy.persist_min_level = TelemetryLevel::Info;
        let core = TelemetryCore::new_for_tests(root_dir.clone(), policy);

        let mut first = record(TelemetryLevel::Warn);
        first.ts = 10;
        first.module_id = "music-library".to_string();
        first.event = "music-library.cover.failed".to_string();
        first.message = Some("Probe failed".to_string());

        let mut second = record(TelemetryLevel::Info);
        second.ts = 20;
        second.module_id = "audio".to_string();
        second.event = "audio.queue.add".to_string();
        second.fields = Some(
            [(
                "playlistId".to_string(),
                serde_json::Value::String("recent-play".to_string()),
            )]
            .into_iter()
            .collect(),
        );

        let _ = core.ingest_batch(vec![first, second]);

        let message_result = core.query_current_session(TelemetryQueryInput {
            search_text: Some("probe".to_string()),
            ..TelemetryQueryInput::default()
        });
        assert_eq!(message_result.matched_record_count, 1);
        assert_eq!(message_result.records[0].module_id, "music-library");

        let field_result = core.query_current_session(TelemetryQueryInput {
            search_text: Some("recent-play".to_string()),
            ..TelemetryQueryInput::default()
        });
        assert_eq!(field_result.matched_record_count, 1);
        assert_eq!(field_result.records[0].module_id, "audio");

        let _ = std::fs::remove_dir_all(root_dir);
    }
}
