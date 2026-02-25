use once_cell::sync::Lazy;
use serde::Serialize;
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, MutexGuard,
    },
    thread::{self, JoinHandle},
    time::Duration,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const LOCAL_CONNECTOR_ID: &str = "connector.local.default";
const LOCAL_CONNECTOR_KIND: &str = "local";
const LOCAL_CONNECTOR_DRIVER: &str = "filesystem";
const LOCAL_CONNECTOR_DISPLAY_NAME: &str = "Local Filesystem";
const LOCAL_CONNECTOR_STATUS: &str = "active";

const SOURCE_SYNC_BASE_BACKOFF_MS: i64 = 30_000;
const SOURCE_SYNC_MAX_BACKOFF_MS: i64 = 6 * 60 * 60 * 1_000;
const SCHEDULER_DEFAULT_INTERVAL_MS: i64 = 60_000;
const SCHEDULER_MIN_INTERVAL_MS: i64 = 5_000;
const SCHEDULER_MAX_INTERVAL_MS: i64 = 60 * 60 * 1_000;
const SCHEDULER_SLEEP_SLICE_MS: i64 = 250;
const METADATA_REFRESH_WORKER_BATCH_SIZE: u32 = 24;
const METADATA_REFRESH_BASE_BACKOFF_MS: i64 = 15_000;
const METADATA_REFRESH_MAX_BACKOFF_MS: i64 = 24 * 60 * 60 * 1_000;
const METADATA_REFRESH_MAX_ATTEMPTS: u64 = 8;
pub const EVENT_MUSIC_LIBRARY_SYNC_STATUS_UPDATED: &str = "music-library-sync-status-updated";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicLibrarySyncFailedSource {
    pub source_id: String,
    pub source_path: String,
    pub error: String,
    pub backoff_until_ms: Option<i64>,
    pub failed_at_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicLibrarySyncFailureSourceSummary {
    pub source_id: String,
    pub source_path: String,
    pub source_display_name: Option<String>,
    pub connector_id: String,
    pub last_error: Option<String>,
    pub backoff_until_ms: Option<i64>,
    pub backoff_remaining_ms: Option<i64>,
    pub backoff_active: bool,
    pub last_success_at_ms: Option<i64>,
    pub incremental_scan_at_ms: Option<i64>,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicLibrarySyncFailureOverview {
    pub generated_at_ms: i64,
    pub total_failed_sources: u64,
    pub backoff_active_sources: u64,
    pub items: Vec<MusicLibrarySyncFailureSourceSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicLibrarySyncRetryResult {
    pub all_sources: bool,
    pub requested_sources: u64,
    pub cleared_sources: u64,
    pub tick_result: MusicLibrarySyncTickResult,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicLibrarySyncClearResult {
    pub all_sources: bool,
    pub requested_sources: u64,
    pub cleared_sources: u64,
    pub cleared_at_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicLibrarySyncStatus {
    pub initialized: bool,
    pub running: bool,
    pub total_ticks: u64,
    pub last_tick_reason: Option<String>,
    pub last_tick_started_at_ms: Option<i64>,
    pub last_tick_finished_at_ms: Option<i64>,
    pub last_error: Option<String>,
    pub updated_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicLibrarySyncTickResult {
    pub reason: String,
    pub started_at_ms: i64,
    pub finished_at_ms: i64,
    pub duration_ms: i64,
    pub scanned_sources: u64,
    pub changed_sources: u64,
    pub skipped_sources: u64,
    pub failed_sources: u64,
    pub failed_source_items: Vec<MusicLibrarySyncFailedSource>,
    pub enqueued_metadata_jobs: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicLibrarySyncSchedulerStatus {
    pub running: bool,
    pub interval_ms: i64,
    pub started_at_ms: Option<i64>,
    pub next_run_at_ms: Option<i64>,
    pub ticks_total: u64,
    pub last_tick_started_at_ms: Option<i64>,
    pub last_tick_finished_at_ms: Option<i64>,
    pub last_error: Option<String>,
    pub last_tick_result: Option<MusicLibrarySyncTickResult>,
    pub updated_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicLibrarySyncEventPayload {
    pub source: String,
    pub emitted_at_ms: i64,
    pub sync_status: MusicLibrarySyncStatus,
    pub scheduler_status: MusicLibrarySyncSchedulerStatus,
    pub tick_result: Option<MusicLibrarySyncTickResult>,
}

#[derive(Debug, Default)]
struct MusicLibrarySyncState {
    initialized: bool,
    running: bool,
    total_ticks: u64,
    last_tick_reason: Option<String>,
    last_tick_started_at_ms: Option<i64>,
    last_tick_finished_at_ms: Option<i64>,
    last_error: Option<String>,
    updated_at_ms: Option<i64>,
}

static SYNC_STATE: Lazy<Mutex<MusicLibrarySyncState>> =
    Lazy::new(|| Mutex::new(MusicLibrarySyncState::default()));

struct MusicLibrarySyncSchedulerState {
    running: bool,
    interval_ms: i64,
    started_at_ms: Option<i64>,
    next_run_at_ms: Option<i64>,
    ticks_total: u64,
    last_tick_started_at_ms: Option<i64>,
    last_tick_finished_at_ms: Option<i64>,
    last_error: Option<String>,
    last_tick_result: Option<MusicLibrarySyncTickResult>,
    updated_at_ms: Option<i64>,
    stop_signal: Option<Arc<AtomicBool>>,
    worker_handle: Option<JoinHandle<()>>,
}

impl Default for MusicLibrarySyncSchedulerState {
    fn default() -> Self {
        Self {
            running: false,
            interval_ms: SCHEDULER_DEFAULT_INTERVAL_MS,
            started_at_ms: None,
            next_run_at_ms: None,
            ticks_total: 0,
            last_tick_started_at_ms: None,
            last_tick_finished_at_ms: None,
            last_error: None,
            last_tick_result: None,
            updated_at_ms: None,
            stop_signal: None,
            worker_handle: None,
        }
    }
}

static SCHEDULER_STATE: Lazy<Mutex<MusicLibrarySyncSchedulerState>> =
    Lazy::new(|| Mutex::new(MusicLibrarySyncSchedulerState::default()));

#[derive(Debug, Clone)]
struct SourceFingerprintSnapshot {
    tree_fingerprint: String,
    file_count: u64,
    total_size: u64,
    sampled_at_ms: i64,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

fn lock_state() -> Result<MutexGuard<'static, MusicLibrarySyncState>, String> {
    SYNC_STATE
        .lock()
        .map_err(|_| "Music library sync state is locked".to_string())
}

fn lock_scheduler_state() -> Result<MutexGuard<'static, MusicLibrarySyncSchedulerState>, String> {
    SCHEDULER_STATE
        .lock()
        .map_err(|_| "Music library sync scheduler state is locked".to_string())
}

fn normalize_scheduler_interval_ms(interval_ms: Option<u64>) -> i64 {
    interval_ms
        .map(|value| value.min(i64::MAX as u64) as i64)
        .unwrap_or(SCHEDULER_DEFAULT_INTERVAL_MS)
        .clamp(SCHEDULER_MIN_INTERVAL_MS, SCHEDULER_MAX_INTERVAL_MS)
}

fn scheduler_status_from_state(
    state: &MusicLibrarySyncSchedulerState,
) -> MusicLibrarySyncSchedulerStatus {
    MusicLibrarySyncSchedulerStatus {
        running: state.running,
        interval_ms: state.interval_ms,
        started_at_ms: state.started_at_ms,
        next_run_at_ms: state.next_run_at_ms,
        ticks_total: state.ticks_total,
        last_tick_started_at_ms: state.last_tick_started_at_ms,
        last_tick_finished_at_ms: state.last_tick_finished_at_ms,
        last_error: state.last_error.clone(),
        last_tick_result: state.last_tick_result.clone(),
        updated_at_ms: state.updated_at_ms,
    }
}

fn emit_sync_event(app: &AppHandle, source: &str, tick_result: Option<MusicLibrarySyncTickResult>) {
    let sync_status = match get_status() {
        Ok(status) => status,
        Err(_) => return,
    };

    let scheduler_status = match get_scheduler_status() {
        Ok(status) => status,
        Err(_) => return,
    };

    let payload = MusicLibrarySyncEventPayload {
        source: source.to_string(),
        emitted_at_ms: now_ms(),
        sync_status,
        scheduler_status,
        tick_result,
    };

    let _ = app.emit_all(EVENT_MUSIC_LIBRARY_SYNC_STATUS_UPDATED, payload);
}

fn normalize_reason(reason: Option<String>) -> String {
    reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| "manual".to_string())
}

fn normalize_source_id_list(source_ids: Option<Vec<String>>) -> Option<Vec<String>> {
    let source_ids = source_ids?;
    let mut normalized_items: Vec<String> = Vec::new();
    for source_id in source_ids {
        let normalized = source_id.trim();
        if normalized.is_empty() {
            continue;
        }
        if normalized_items.iter().any(|item| item == normalized) {
            continue;
        }
        normalized_items.push(normalized.to_string());
    }

    if normalized_items.is_empty() {
        return Some(Vec::new());
    }

    Some(normalized_items)
}

fn jitter_ms(seed: &str, now: i64, window_ms: i64) -> i64 {
    let normalized_window = window_ms.max(1);
    let mut hasher = DefaultHasher::new();
    seed.hash(&mut hasher);
    now.hash(&mut hasher);
    ((hasher.finish() as i64) & i64::MAX) % normalized_window
}

fn stable_hash_for_text(value: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

fn compute_next_backoff_until_ms(
    source_id: &str,
    now: i64,
    previous_backoff_until_ms: Option<i64>,
) -> i64 {
    let previous_delay = previous_backoff_until_ms
        .map(|value| (value - now).max(0))
        .unwrap_or(0);

    let base_delay = if previous_delay <= 0 {
        SOURCE_SYNC_BASE_BACKOFF_MS
    } else {
        previous_delay.saturating_mul(2)
    };

    let delay_ms = base_delay.clamp(SOURCE_SYNC_BASE_BACKOFF_MS, SOURCE_SYNC_MAX_BACKOFF_MS);
    let jitter_window_ms = (delay_ms / 5).max(250);
    let jitter = jitter_ms(source_id, now, jitter_window_ms);

    now.saturating_add(delay_ms).saturating_add(jitter)
}

fn compute_metadata_job_next_run_at_ms(job_id: &str, now: i64, attempt_count: u64) -> i64 {
    let exp = attempt_count.saturating_sub(1).min(16) as u32;
    let factor = 1_i64.checked_shl(exp).unwrap_or(i64::MAX);
    let base_delay = METADATA_REFRESH_BASE_BACKOFF_MS.saturating_mul(factor);
    let delay_ms = base_delay.clamp(
        METADATA_REFRESH_BASE_BACKOFF_MS,
        METADATA_REFRESH_MAX_BACKOFF_MS,
    );
    let jitter_window_ms = (delay_ms / 5).max(250);
    let jitter = jitter_ms(job_id, now, jitter_window_ms);
    now.saturating_add(delay_ms).saturating_add(jitter)
}

fn detect_local_lyric(path: &str) -> Option<(String, String)> {
    let audio_path = Path::new(path);
    let stem = audio_path.file_stem()?.to_str()?.trim();
    if stem.is_empty() {
        return None;
    }

    let parent = audio_path.parent()?;
    let candidates: [(&str, &str); 3] = [("lrc", "lrc"), ("yrc", "yrc"), ("txt", "plain")];
    for (extension, format) in candidates {
        let candidate = parent.join(format!("{stem}.{extension}"));
        if candidate.exists() && candidate.is_file() {
            return Some((candidate.to_string_lossy().to_string(), format.to_string()));
        }
    }

    None
}

fn process_metadata_refresh_job(
    app: &AppHandle,
    job: &crate::music_library_db::LibraryMetadataRefreshJobClaimRecord,
) -> Result<(), String> {
    let job_kind = job.kind.trim().to_ascii_lowercase();
    let track_path = job
        .track_file_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("metadata job {} has no track file path", job.id))?
        .to_string();

    let should_refresh_cover = job_kind == "cover" || job_kind == "both";
    let should_refresh_lyric = job_kind == "lyric" || job_kind == "both";
    if !should_refresh_cover && !should_refresh_lyric {
        return Err(format!(
            "metadata job {} has unsupported kind: {}",
            job.id, job.kind
        ));
    }

    if should_refresh_cover {
        let cover = crate::music_library::get_or_create_cover(
            app,
            track_path.clone(),
            Some(2 * 1024 * 1024),
            Some(512),
        )?
        .ok_or_else(|| format!("no cover found for {}", track_path))?;

        crate::music_library_db::upsert_cover_ref(
            app,
            crate::music_library_db::LibraryCoverRefUpsertInput {
                entry_id: job.entry_id.clone(),
                provider_cover_id: Some(cover.key.clone()),
                cover_locator: format!("pmp://cover/{}", cover.key),
                etag: Some(format!("{}:{}", cover.key, cover.size)),
                width: None,
                height: None,
                updated_at_ms: Some(now_ms()),
            },
        )?;
    }

    if should_refresh_lyric {
        let (lyric_locator, lyric_format) = detect_local_lyric(&track_path)
            .ok_or_else(|| format!("no sidecar lyric found for {}", track_path))?;

        crate::music_library_db::upsert_lyric_ref(
            app,
            crate::music_library_db::LibraryLyricRefUpsertInput {
                entry_id: job.entry_id.clone(),
                provider_lyric_id: None,
                lyric_locator: lyric_locator.clone(),
                format: Some(lyric_format),
                lang: None,
                etag: Some(format!(
                    "local-lyric:{:016x}",
                    stable_hash_for_text(&lyric_locator)
                )),
                updated_at_ms: Some(now_ms()),
            },
        )?;
    }

    Ok(())
}

fn run_metadata_refresh_worker(app: &AppHandle, limit: Option<u32>) -> Result<(), String> {
    let jobs = crate::music_library_db::claim_metadata_refresh_jobs(app, limit)?;
    if jobs.is_empty() {
        return Ok(());
    }

    for job in jobs {
        match process_metadata_refresh_job(app, &job) {
            Ok(_) => {
                let _ = crate::music_library_db::complete_metadata_refresh_job(app, &job.id);
            }
            Err(error) => {
                let attempt_count = job.attempt_count.max(1);
                let terminal_failed = attempt_count >= METADATA_REFRESH_MAX_ATTEMPTS;
                let now = now_ms();
                let next_run_at_ms = if terminal_failed {
                    None
                } else {
                    Some(compute_metadata_job_next_run_at_ms(
                        job.id.as_str(),
                        now,
                        attempt_count,
                    ))
                };

                let _ = crate::music_library_db::reschedule_metadata_refresh_job(
                    app,
                    &job.id,
                    error.as_str(),
                    next_run_at_ms,
                    terminal_failed,
                );
            }
        }
    }

    Ok(())
}

fn capture_source_fingerprint(path: &str) -> Result<SourceFingerprintSnapshot, String> {
    let source_path = PathBuf::from(path);
    if !source_path.exists() {
        return Err(format!("Source path does not exist: {path}"));
    }

    let mut stack = vec![source_path.clone()];
    let mut hasher = DefaultHasher::new();
    let mut file_count: u64 = 0;
    let mut total_size: u64 = 0;

    while let Some(current_dir) = stack.pop() {
        let read_dir = fs::read_dir(&current_dir)
            .map_err(|error| format!("Failed to read source directory {}: {error}", path))?;

        for entry in read_dir {
            let entry = entry.map_err(|error| {
                format!(
                    "Failed to read source directory entry for {}: {error}",
                    current_dir.display()
                )
            })?;

            let entry_path = entry.path();
            let entry_metadata = entry.metadata().map_err(|error| {
                format!(
                    "Failed to read metadata for {}: {error}",
                    entry_path.display()
                )
            })?;

            if entry_metadata.is_dir() {
                stack.push(entry_path);
                continue;
            }

            if !entry_metadata.is_file() {
                continue;
            }

            file_count = file_count.saturating_add(1);
            total_size = total_size.saturating_add(entry_metadata.len());

            let modified_ms = entry_metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map(|value| value.as_millis() as i64)
                .unwrap_or(0);

            let relative = entry_path
                .strip_prefix(&source_path)
                .unwrap_or(entry_path.as_path())
                .to_string_lossy()
                .to_ascii_lowercase();

            relative.hash(&mut hasher);
            entry_metadata.len().hash(&mut hasher);
            modified_ms.hash(&mut hasher);
        }
    }

    path.to_ascii_lowercase().hash(&mut hasher);
    file_count.hash(&mut hasher);
    total_size.hash(&mut hasher);

    let digest = hasher.finish();
    Ok(SourceFingerprintSnapshot {
        tree_fingerprint: format!("treev1:{digest:016x}"),
        file_count,
        total_size,
        sampled_at_ms: now_ms(),
    })
}

fn has_fingerprint_changed(
    previous: Option<&crate::music_library_db::LibrarySourceFingerprintStateRecord>,
    current: &SourceFingerprintSnapshot,
) -> bool {
    let Some(previous) = previous else {
        return true;
    };

    previous.tree_fingerprint.as_deref() != Some(current.tree_fingerprint.as_str())
        || previous.file_count != current.file_count
        || previous.total_size != current.total_size
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    crate::music_library_db::init(app)?;
    crate::music_library_db::ensure_connector(
        app,
        LOCAL_CONNECTOR_ID,
        LOCAL_CONNECTOR_KIND,
        LOCAL_CONNECTOR_DRIVER,
        Some(LOCAL_CONNECTOR_DISPLAY_NAME),
        Some(LOCAL_CONNECTOR_STATUS),
    )?;
    let mut state = lock_state()?;
    if !state.initialized {
        state.initialized = true;
        state.updated_at_ms = Some(now_ms());
    }
    Ok(())
}

pub fn get_status() -> Result<MusicLibrarySyncStatus, String> {
    let state = lock_state()?;
    Ok(MusicLibrarySyncStatus {
        initialized: state.initialized,
        running: state.running,
        total_ticks: state.total_ticks,
        last_tick_reason: state.last_tick_reason.clone(),
        last_tick_started_at_ms: state.last_tick_started_at_ms,
        last_tick_finished_at_ms: state.last_tick_finished_at_ms,
        last_error: state.last_error.clone(),
        updated_at_ms: state.updated_at_ms,
    })
}

pub fn get_scheduler_status() -> Result<MusicLibrarySyncSchedulerStatus, String> {
    let state = lock_scheduler_state()?;
    Ok(scheduler_status_from_state(&state))
}

pub fn get_failure_overview(
    app: &AppHandle,
    limit: Option<u32>,
) -> Result<MusicLibrarySyncFailureOverview, String> {
    init(app)?;

    let now = now_ms();
    let records = crate::music_library_db::list_source_sync_failures(app, limit)?;
    let mut backoff_active_sources: u64 = 0;

    let items = records
        .into_iter()
        .map(|item| {
            let backoff_remaining_ms = item.backoff_until_ms.map(|value| (value - now).max(0));
            let backoff_active = backoff_remaining_ms.map(|value| value > 0).unwrap_or(false);
            if backoff_active {
                backoff_active_sources = backoff_active_sources.saturating_add(1);
            }

            MusicLibrarySyncFailureSourceSummary {
                source_id: item.source_id,
                source_path: item.source_path,
                source_display_name: item.source_display_name,
                connector_id: item.connector_id,
                last_error: item.last_error,
                backoff_until_ms: item.backoff_until_ms,
                backoff_remaining_ms,
                backoff_active,
                last_success_at_ms: item.last_success_at_ms,
                incremental_scan_at_ms: item.incremental_scan_at_ms,
                updated_at_ms: item.updated_at_ms,
            }
        })
        .collect::<Vec<_>>();

    Ok(MusicLibrarySyncFailureOverview {
        generated_at_ms: now,
        total_failed_sources: items.len() as u64,
        backoff_active_sources,
        items,
    })
}

pub fn retry_failed_sources(
    app: &AppHandle,
    source_ids: Option<Vec<String>>,
    reason: Option<String>,
) -> Result<MusicLibrarySyncRetryResult, String> {
    init(app)?;

    let normalized_source_ids = normalize_source_id_list(source_ids);
    let requested_sources = normalized_source_ids
        .as_ref()
        .map(|items| items.len() as u64)
        .unwrap_or(0);
    let all_sources = normalized_source_ids.is_none();

    let cleared_sources =
        crate::music_library_db::clear_source_sync_failures(app, normalized_source_ids)?;
    let tick_reason = reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| "retry-failed-sources".to_string());
    let tick_result = run_tick_internal(app, Some(tick_reason), true)?;

    Ok(MusicLibrarySyncRetryResult {
        all_sources,
        requested_sources,
        cleared_sources,
        tick_result,
    })
}

pub fn clear_failed_sources(
    app: &AppHandle,
    source_ids: Option<Vec<String>>,
) -> Result<MusicLibrarySyncClearResult, String> {
    init(app)?;

    let normalized_source_ids = normalize_source_id_list(source_ids);
    let requested_sources = normalized_source_ids
        .as_ref()
        .map(|items| items.len() as u64)
        .unwrap_or(0);
    let all_sources = normalized_source_ids.is_none();
    let cleared_sources =
        crate::music_library_db::clear_source_sync_failures(app, normalized_source_ids)?;
    let cleared_at_ms = now_ms();

    emit_sync_event(app, "clear-failed-sources", None);

    Ok(MusicLibrarySyncClearResult {
        all_sources,
        requested_sources,
        cleared_sources,
        cleared_at_ms,
    })
}

fn scheduler_loop(app: AppHandle, stop_signal: Arc<AtomicBool>, interval_ms: i64) {
    loop {
        if stop_signal.load(Ordering::Relaxed) {
            break;
        }

        let started_at_ms = now_ms();
        if let Ok(mut state) = lock_scheduler_state() {
            state.last_tick_started_at_ms = Some(started_at_ms);
            state.next_run_at_ms = None;
            state.updated_at_ms = Some(started_at_ms);
        }

        let tick_result = run_tick_internal(&app, Some("scheduler".to_string()), false);
        let finished_at_ms = now_ms();

        let (tick_payload, tick_error) = match tick_result {
            Ok(result) => (Some(result), None),
            Err(error) => (None, Some(error)),
        };

        if let Ok(mut state) = lock_scheduler_state() {
            state.ticks_total = state.ticks_total.saturating_add(1);
            state.last_tick_finished_at_ms = Some(finished_at_ms);
            state.last_error = tick_error.clone();
            state.last_tick_result = tick_payload.clone();
            state.next_run_at_ms = Some(finished_at_ms.saturating_add(interval_ms));
            state.updated_at_ms = Some(finished_at_ms);
        }

        emit_sync_event(&app, "scheduler-loop", tick_payload.clone());

        let sleep_until_ms = finished_at_ms.saturating_add(interval_ms);
        while now_ms() < sleep_until_ms {
            if stop_signal.load(Ordering::Relaxed) {
                return;
            }
            let remaining_ms = sleep_until_ms.saturating_sub(now_ms());
            let sleep_ms = remaining_ms.min(SCHEDULER_SLEEP_SLICE_MS).max(1) as u64;
            thread::sleep(Duration::from_millis(sleep_ms));
        }
    }
}

pub fn start_scheduler(
    app: &AppHandle,
    interval_ms: Option<u64>,
) -> Result<MusicLibrarySyncSchedulerStatus, String> {
    init(app)?;

    let normalized_interval_ms = normalize_scheduler_interval_ms(interval_ms);
    let running = {
        let state = lock_scheduler_state()?;
        state.running
    };

    if running {
        stop_scheduler()?;
    }

    let stop_signal = Arc::new(AtomicBool::new(false));
    let stop_signal_for_thread = Arc::clone(&stop_signal);
    let app_handle = app.clone();

    let worker_handle = thread::Builder::new()
        .name("pmp-sync-scheduler".to_string())
        .spawn(move || scheduler_loop(app_handle, stop_signal_for_thread, normalized_interval_ms))
        .map_err(|error| format!("Failed to start music library sync scheduler thread: {error}"))?;

    let started_at_ms = now_ms();
    let mut state = lock_scheduler_state()?;
    state.running = true;
    state.interval_ms = normalized_interval_ms;
    state.started_at_ms = Some(started_at_ms);
    state.next_run_at_ms = Some(started_at_ms);
    state.last_error = None;
    state.updated_at_ms = Some(started_at_ms);
    state.stop_signal = Some(stop_signal);
    state.worker_handle = Some(worker_handle);

    let status = scheduler_status_from_state(&state);
    drop(state);

    emit_sync_event(app, "scheduler-start", None);
    Ok(status)
}

pub fn stop_scheduler() -> Result<MusicLibrarySyncSchedulerStatus, String> {
    let (stop_signal, worker_handle) = {
        let mut state = lock_scheduler_state()?;
        let signal = state.stop_signal.take();
        let handle = state.worker_handle.take();
        state.running = false;
        state.next_run_at_ms = None;
        state.updated_at_ms = Some(now_ms());
        (signal, handle)
    };

    if let Some(signal) = stop_signal {
        signal.store(true, Ordering::Relaxed);
    }

    if let Some(handle) = worker_handle {
        handle
            .join()
            .map_err(|_| "Music library sync scheduler thread panicked".to_string())?;
    }

    get_scheduler_status()
}

pub fn stop_scheduler_with_event(
    app: &AppHandle,
) -> Result<MusicLibrarySyncSchedulerStatus, String> {
    let status = stop_scheduler()?;
    emit_sync_event(app, "scheduler-stop", None);
    Ok(status)
}

fn run_tick_internal(
    app: &AppHandle,
    reason: Option<String>,
    emit_event: bool,
) -> Result<MusicLibrarySyncTickResult, String> {
    let tick_reason = normalize_reason(reason);
    let started_at_ms = now_ms();

    {
        let mut state = lock_state()?;
        if state.running {
            return Err("Music library sync orchestrator is already running".to_string());
        }
        state.initialized = true;
        state.running = true;
        state.last_tick_reason = Some(tick_reason.clone());
        state.last_tick_started_at_ms = Some(started_at_ms);
        state.last_error = None;
        state.updated_at_ms = Some(started_at_ms);
    }

    let mut fatal_error: Option<String> = None;
    let mut scanned_sources: u64 = 0;
    let mut changed_sources: u64 = 0;
    let mut skipped_sources: u64 = 0;
    let mut failed_sources: u64 = 0;
    let mut failed_source_items: Vec<MusicLibrarySyncFailedSource> = Vec::new();
    let mut enqueued_metadata_jobs: u64 = 0;
    let mut first_non_fatal_error: Option<String> = None;

    if let Err(error) = crate::music_library_db::init(app) {
        fatal_error = Some(format!(
            "Failed to ensure music library DB before sync tick: {error}"
        ));
    }

    if fatal_error.is_none() {
        if let Err(error) = crate::music_library_db::ensure_connector(
            app,
            LOCAL_CONNECTOR_ID,
            LOCAL_CONNECTOR_KIND,
            LOCAL_CONNECTOR_DRIVER,
            Some(LOCAL_CONNECTOR_DISPLAY_NAME),
            Some(LOCAL_CONNECTOR_STATUS),
        ) {
            fatal_error = Some(format!("Failed to ensure local connector state: {error}"));
        }
    }

    if fatal_error.is_none() {
        match crate::music_library_db::list_sources(app) {
            Ok(sources) => {
                for source in sources {
                    if !source.is_scanned {
                        skipped_sources = skipped_sources.saturating_add(1);
                        continue;
                    }

                    let source_id = source.id.clone();
                    let now = now_ms();
                    let sync_state =
                        match crate::music_library_db::get_source_sync_state(app, &source_id) {
                            Ok(value) => value,
                            Err(error) => {
                                failed_sources = failed_sources.saturating_add(1);
                                failed_source_items.push(MusicLibrarySyncFailedSource {
                                    source_id: source_id.clone(),
                                    source_path: source.path.clone(),
                                    error: format!("sync state load failed: {error}"),
                                    backoff_until_ms: None,
                                    failed_at_ms: now,
                                });
                                if first_non_fatal_error.is_none() {
                                    first_non_fatal_error = Some(format!(
                                        "Failed to load sync state for source {}: {error}",
                                        source_id
                                    ));
                                }
                                continue;
                            }
                        };

                    if sync_state
                        .as_ref()
                        .and_then(|state| state.backoff_until_ms)
                        .map(|backoff_until| backoff_until > now)
                        .unwrap_or(false)
                    {
                        skipped_sources = skipped_sources.saturating_add(1);
                        continue;
                    }

                    match capture_source_fingerprint(&source.path) {
                        Ok(snapshot) => {
                            let previous_fingerprint =
                                match crate::music_library_db::get_source_fingerprint_state(
                                    app, &source_id,
                                ) {
                                    Ok(value) => value,
                                    Err(error) => {
                                        failed_sources = failed_sources.saturating_add(1);
                                        failed_source_items.push(MusicLibrarySyncFailedSource {
                                            source_id: source_id.clone(),
                                            source_path: source.path.clone(),
                                            error: format!(
                                                "fingerprint state load failed: {error}"
                                            ),
                                            backoff_until_ms: None,
                                            failed_at_ms: now,
                                        });
                                        if first_non_fatal_error.is_none() {
                                            first_non_fatal_error = Some(format!(
                                                "Failed to load fingerprint state for source {}: {error}",
                                                source_id
                                            ));
                                        }
                                        continue;
                                    }
                                };

                            let has_changed =
                                has_fingerprint_changed(previous_fingerprint.as_ref(), &snapshot);

                            if let Err(error) = crate::music_library_db::upsert_source_fingerprint_state(
                                app,
                                crate::music_library_db::LibrarySourceFingerprintStateUpsertInput {
                                    source_id: source_id.clone(),
                                    tree_fingerprint: Some(snapshot.tree_fingerprint.clone()),
                                    file_count: snapshot.file_count,
                                    total_size: snapshot.total_size,
                                    sampled_at_ms: snapshot.sampled_at_ms,
                                    updated_at_ms: Some(now),
                                },
                            ) {
                                failed_sources = failed_sources.saturating_add(1);
                                failed_source_items.push(MusicLibrarySyncFailedSource {
                                    source_id: source_id.clone(),
                                    source_path: source.path.clone(),
                                    error: format!("fingerprint state upsert failed: {error}"),
                                    backoff_until_ms: None,
                                    failed_at_ms: now,
                                });
                                if first_non_fatal_error.is_none() {
                                    first_non_fatal_error = Some(format!(
                                        "Failed to upsert fingerprint state for source {}: {error}",
                                        source_id
                                    ));
                                }
                                continue;
                            }

                            let sync_full_scan_at_ms = sync_state
                                .as_ref()
                                .and_then(|value| value.full_scan_at_ms)
                                .or(Some(now));

                            if let Err(error) = crate::music_library_db::upsert_source_sync_state(
                                app,
                                crate::music_library_db::LibrarySourceSyncStateUpsertInput {
                                    source_id: source_id.clone(),
                                    connector_id: LOCAL_CONNECTOR_ID.to_string(),
                                    sync_cursor: sync_state
                                        .as_ref()
                                        .and_then(|value| value.sync_cursor.clone()),
                                    full_scan_at_ms: sync_full_scan_at_ms,
                                    incremental_scan_at_ms: Some(now),
                                    last_success_at_ms: Some(now),
                                    last_error: None,
                                    backoff_until_ms: None,
                                    updated_at_ms: Some(now),
                                },
                            ) {
                                failed_sources = failed_sources.saturating_add(1);
                                failed_source_items.push(MusicLibrarySyncFailedSource {
                                    source_id: source_id.clone(),
                                    source_path: source.path.clone(),
                                    error: format!("sync state upsert failed: {error}"),
                                    backoff_until_ms: None,
                                    failed_at_ms: now,
                                });
                                if first_non_fatal_error.is_none() {
                                    first_non_fatal_error = Some(format!(
                                        "Failed to upsert sync state for source {}: {error}",
                                        source_id
                                    ));
                                }
                                continue;
                            }

                            if has_changed {
                                changed_sources = changed_sources.saturating_add(1);
                                match crate::music_library_db::enqueue_metadata_refresh_jobs_for_source(
                                    app,
                                    &source_id,
                                    Some(1_000),
                                ) {
                                    Ok(queued) => {
                                        enqueued_metadata_jobs =
                                            enqueued_metadata_jobs.saturating_add(queued)
                                    }
                                    Err(error) => {
                                        if first_non_fatal_error.is_none() {
                                            first_non_fatal_error = Some(format!(
                                                "Failed to enqueue metadata jobs for source {}: {error}",
                                                source_id
                                            ));
                                        }
                                    }
                                }
                            }

                            scanned_sources = scanned_sources.saturating_add(1);
                        }
                        Err(scan_error) => {
                            failed_sources = failed_sources.saturating_add(1);
                            if first_non_fatal_error.is_none() {
                                first_non_fatal_error = Some(format!(
                                    "Failed to fingerprint source {}: {scan_error}",
                                    source_id
                                ));
                            }

                            let backoff_until_ms = Some(compute_next_backoff_until_ms(
                                &source_id,
                                now,
                                sync_state.as_ref().and_then(|value| value.backoff_until_ms),
                            ));
                            failed_source_items.push(MusicLibrarySyncFailedSource {
                                source_id: source_id.clone(),
                                source_path: source.path.clone(),
                                error: scan_error.clone(),
                                backoff_until_ms,
                                failed_at_ms: now,
                            });

                            let _ = crate::music_library_db::upsert_source_sync_state(
                                app,
                                crate::music_library_db::LibrarySourceSyncStateUpsertInput {
                                    source_id: source_id.clone(),
                                    connector_id: LOCAL_CONNECTOR_ID.to_string(),
                                    sync_cursor: sync_state
                                        .as_ref()
                                        .and_then(|value| value.sync_cursor.clone()),
                                    full_scan_at_ms: sync_state
                                        .as_ref()
                                        .and_then(|value| value.full_scan_at_ms),
                                    incremental_scan_at_ms: Some(now),
                                    last_success_at_ms: sync_state
                                        .as_ref()
                                        .and_then(|value| value.last_success_at_ms),
                                    last_error: Some(scan_error),
                                    backoff_until_ms,
                                    updated_at_ms: Some(now),
                                },
                            );
                        }
                    }
                }
            }
            Err(error) => {
                fatal_error = Some(format!("Failed to list music library sources: {error}"));
            }
        }
    }

    if fatal_error.is_none() {
        if let Err(error) =
            run_metadata_refresh_worker(app, Some(METADATA_REFRESH_WORKER_BATCH_SIZE))
        {
            if first_non_fatal_error.is_none() {
                first_non_fatal_error = Some(format!("Metadata refresh worker failed: {error}"));
            }
        }
    }

    let finished_at_ms = now_ms();
    let result = MusicLibrarySyncTickResult {
        reason: tick_reason,
        started_at_ms,
        finished_at_ms,
        duration_ms: (finished_at_ms - started_at_ms).max(0),
        scanned_sources,
        changed_sources,
        skipped_sources,
        failed_sources,
        failed_source_items,
        enqueued_metadata_jobs,
    };

    let final_error = fatal_error.clone().or(first_non_fatal_error);
    {
        let mut state = lock_state()?;
        state.running = false;
        state.total_ticks = state.total_ticks.saturating_add(1);
        state.last_tick_finished_at_ms = Some(finished_at_ms);
        state.last_error = final_error.clone();
        state.updated_at_ms = Some(finished_at_ms);
    }

    if let Some(error) = fatal_error {
        if emit_event {
            emit_sync_event(app, "tick-failed", None);
        }
        return Err(error);
    }

    if emit_event {
        emit_sync_event(app, "tick", Some(result.clone()));
    }

    Ok(result)
}

pub fn run_tick(
    app: &AppHandle,
    reason: Option<String>,
) -> Result<MusicLibrarySyncTickResult, String> {
    run_tick_internal(app, reason, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, io::Write, path::PathBuf};

    fn temp_dir(prefix: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "{prefix}-{}-{}",
            std::process::id(),
            now_ms().max(1)
        ));
        path
    }

    #[test]
    fn backoff_delay_scales_with_previous_attempt() {
        let now = now_ms();
        let first = compute_next_backoff_until_ms("source-a", now, None);
        let second = compute_next_backoff_until_ms("source-a", now, Some(first));

        let first_delay = first - now;
        let second_delay = second - now;

        assert!(first_delay >= SOURCE_SYNC_BASE_BACKOFF_MS);
        assert!(second_delay > first_delay);
    }

    #[test]
    fn capture_source_fingerprint_changes_when_files_change() {
        let root = temp_dir("music-sync-fingerprint");
        fs::create_dir_all(&root).expect("create source temp dir");

        let file_path = root.join("track-a.mp3");
        {
            let mut file = fs::File::create(&file_path).expect("create test file");
            file.write_all(b"abc").expect("write test file content");
        }

        let first = capture_source_fingerprint(root.to_string_lossy().as_ref())
            .expect("capture first fingerprint");

        {
            let mut file = fs::OpenOptions::new()
                .append(true)
                .open(&file_path)
                .expect("open test file");
            file.write_all(b"defg").expect("append test file content");
        }

        let second = capture_source_fingerprint(root.to_string_lossy().as_ref())
            .expect("capture second fingerprint");

        assert_ne!(first.tree_fingerprint, second.tree_fingerprint);
        assert!(second.total_size > first.total_size);

        let _ = fs::remove_file(&file_path);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn scheduler_interval_is_clamped() {
        assert_eq!(
            normalize_scheduler_interval_ms(None),
            SCHEDULER_DEFAULT_INTERVAL_MS
        );
        assert_eq!(
            normalize_scheduler_interval_ms(Some(10)),
            SCHEDULER_MIN_INTERVAL_MS
        );
        assert_eq!(
            normalize_scheduler_interval_ms(Some((2 * 60 * 60 * 1_000) as u64)),
            SCHEDULER_MAX_INTERVAL_MS
        );
        assert_eq!(normalize_scheduler_interval_ms(Some(30_000)), 30_000);
    }
}
