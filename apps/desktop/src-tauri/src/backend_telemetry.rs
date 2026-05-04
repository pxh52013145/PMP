use crate::telemetry::TelemetryCore;
use crate::telemetry_contract::{
    TelemetryIngestBatchResult, TelemetryKind, TelemetryLevel, TelemetryRecord, TelemetrySide,
};
use once_cell::sync::OnceCell;
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Runtime};

pub type BackendTelemetryFields = BTreeMap<String, serde_json::Value>;

static GLOBAL_TELEMETRY_CORE: OnceCell<Arc<TelemetryCore>> = OnceCell::new();

#[derive(Debug, Clone, Default)]
pub struct BackendTelemetryOptions {
    pub component: Option<String>,
    pub message: Option<String>,
    pub trace_id: Option<String>,
    pub span_id: Option<String>,
    pub window_id: Option<String>,
    pub fields: Option<BackendTelemetryFields>,
}

impl BackendTelemetryOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn component(mut self, value: impl Into<String>) -> Self {
        self.component = Some(value.into());
        self
    }

    pub fn message(mut self, value: impl Into<String>) -> Self {
        self.message = Some(value.into());
        self
    }

    #[allow(dead_code)]
    pub fn trace_id(mut self, value: impl Into<String>) -> Self {
        self.trace_id = Some(value.into());
        self
    }

    #[allow(dead_code)]
    pub fn span_id(mut self, value: impl Into<String>) -> Self {
        self.span_id = Some(value.into());
        self
    }

    pub fn window_id(mut self, value: impl Into<String>) -> Self {
        self.window_id = Some(value.into());
        self
    }

    #[allow(dead_code)]
    pub fn fields(mut self, fields: BackendTelemetryFields) -> Self {
        self.fields = Some(fields);
        self
    }

    pub fn field(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        self.fields
            .get_or_insert_with(BTreeMap::new)
            .insert(key.into(), value);
        self
    }
}

pub fn install_global_core(telemetry_core: Arc<TelemetryCore>) {
    let _ = GLOBAL_TELEMETRY_CORE.set(telemetry_core);
}

#[allow(dead_code)]
pub fn debug<R: Runtime>(
    app: &AppHandle<R>,
    module_id: &str,
    event: &str,
    options: BackendTelemetryOptions,
) -> Option<TelemetryIngestBatchResult> {
    dispatch(
        app,
        TelemetryLevel::Debug,
        TelemetryKind::Log,
        module_id,
        event,
        options,
    )
}

pub fn info<R: Runtime>(
    app: &AppHandle<R>,
    module_id: &str,
    event: &str,
    options: BackendTelemetryOptions,
) -> Option<TelemetryIngestBatchResult> {
    dispatch(
        app,
        TelemetryLevel::Info,
        TelemetryKind::Log,
        module_id,
        event,
        options,
    )
}

#[allow(dead_code)]
pub fn warn<R: Runtime>(
    app: &AppHandle<R>,
    module_id: &str,
    event: &str,
    options: BackendTelemetryOptions,
) -> Option<TelemetryIngestBatchResult> {
    dispatch(
        app,
        TelemetryLevel::Warn,
        TelemetryKind::Log,
        module_id,
        event,
        options,
    )
}

pub fn error<R: Runtime>(
    app: &AppHandle<R>,
    module_id: &str,
    event: &str,
    options: BackendTelemetryOptions,
) -> Option<TelemetryIngestBatchResult> {
    dispatch(
        app,
        TelemetryLevel::Error,
        TelemetryKind::Log,
        module_id,
        event,
        options,
    )
}

#[allow(dead_code)]
pub fn fatal<R: Runtime>(
    app: &AppHandle<R>,
    module_id: &str,
    event: &str,
    options: BackendTelemetryOptions,
) -> Option<TelemetryIngestBatchResult> {
    dispatch(
        app,
        TelemetryLevel::Fatal,
        TelemetryKind::Log,
        module_id,
        event,
        options,
    )
}

#[allow(dead_code)]
pub fn metric<R: Runtime>(
    app: &AppHandle<R>,
    module_id: &str,
    event: &str,
    options: BackendTelemetryOptions,
) -> Option<TelemetryIngestBatchResult> {
    dispatch(
        app,
        TelemetryLevel::Info,
        TelemetryKind::Metric,
        module_id,
        event,
        options,
    )
}

#[allow(dead_code)]
pub fn debug_global(
    module_id: &str,
    event: &str,
    options: BackendTelemetryOptions,
) -> Option<TelemetryIngestBatchResult> {
    dispatch_global(
        TelemetryLevel::Debug,
        TelemetryKind::Log,
        module_id,
        event,
        options,
    )
}

pub fn info_global(
    module_id: &str,
    event: &str,
    options: BackendTelemetryOptions,
) -> Option<TelemetryIngestBatchResult> {
    dispatch_global(
        TelemetryLevel::Info,
        TelemetryKind::Log,
        module_id,
        event,
        options,
    )
}

pub fn warn_global(
    module_id: &str,
    event: &str,
    options: BackendTelemetryOptions,
) -> Option<TelemetryIngestBatchResult> {
    dispatch_global(
        TelemetryLevel::Warn,
        TelemetryKind::Log,
        module_id,
        event,
        options,
    )
}

pub fn error_global(
    module_id: &str,
    event: &str,
    options: BackendTelemetryOptions,
) -> Option<TelemetryIngestBatchResult> {
    dispatch_global(
        TelemetryLevel::Error,
        TelemetryKind::Log,
        module_id,
        event,
        options,
    )
}

fn dispatch<R: Runtime>(
    app: &AppHandle<R>,
    level: TelemetryLevel,
    kind: TelemetryKind,
    module_id: &str,
    event: &str,
    options: BackendTelemetryOptions,
) -> Option<TelemetryIngestBatchResult> {
    let record = build_record(level, kind, module_id, event, options);

    let Some(telemetry_core) = app.try_state::<Arc<TelemetryCore>>() else {
        return dispatch_record_with_global(record, "tauri telemetry state unavailable");
    };

    Some(dispatch_record_with_core(
        telemetry_core.inner().as_ref(),
        record,
    ))
}

fn dispatch_global(
    level: TelemetryLevel,
    kind: TelemetryKind,
    module_id: &str,
    event: &str,
    options: BackendTelemetryOptions,
) -> Option<TelemetryIngestBatchResult> {
    let record = build_record(level, kind, module_id, event, options);
    dispatch_record_with_global(record, "global telemetry core unavailable")
}

fn dispatch_record_with_global(
    record: TelemetryRecord,
    unavailable_reason: &str,
) -> Option<TelemetryIngestBatchResult> {
    let Some(telemetry_core) = GLOBAL_TELEMETRY_CORE.get() else {
        emit_stderr_fallback(&record, unavailable_reason);
        return None;
    };

    Some(dispatch_record_with_core(telemetry_core.as_ref(), record))
}

fn dispatch_record_with_core(
    telemetry_core: &TelemetryCore,
    record: TelemetryRecord,
) -> TelemetryIngestBatchResult {
    let result = dispatch_with_core(telemetry_core, record.clone());
    if result.accepted_count == 0
        && result.dropped_count > 0
        && result.status.last_error.as_deref().is_some()
    {
        emit_stderr_fallback(
            &record,
            result
                .status
                .last_error
                .as_deref()
                .unwrap_or("backend telemetry ingest failed"),
        );
    }

    result
}

fn dispatch_with_core(
    telemetry_core: &TelemetryCore,
    record: TelemetryRecord,
) -> TelemetryIngestBatchResult {
    telemetry_core.ingest_batch(vec![record])
}

fn build_record(
    level: TelemetryLevel,
    kind: TelemetryKind,
    module_id: &str,
    event: &str,
    options: BackendTelemetryOptions,
) -> TelemetryRecord {
    TelemetryRecord {
        ts: now_ms(),
        level,
        kind,
        side: TelemetrySide::Backend,
        module_id: normalize_required_string(module_id),
        event: normalize_required_string(event),
        session_id: String::new(),
        component: normalize_optional_string(options.component),
        message: normalize_optional_string(options.message),
        trace_id: normalize_optional_string(options.trace_id),
        span_id: normalize_optional_string(options.span_id),
        window_id: normalize_optional_string(options.window_id),
        fields: normalize_fields(options.fields),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn normalize_required_string(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        "unknown".to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_fields(fields: Option<BackendTelemetryFields>) -> Option<BackendTelemetryFields> {
    let Some(fields) = fields else {
        return None;
    };

    let normalized = fields
        .into_iter()
        .filter_map(|(key, value)| {
            let trimmed = key.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some((trimmed.to_string(), value))
            }
        })
        .collect::<BackendTelemetryFields>();

    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn emit_stderr_fallback(record: &TelemetryRecord, reason: &str) {
    let level = format!("{:?}", record.level).to_ascii_lowercase();
    let message = record.message.as_deref().unwrap_or("");
    if message.is_empty() {
        eprintln!(
            "[backend-telemetry][fallback] level={level} module={} event={} reason={reason}",
            record.module_id, record.event
        );
    } else {
        eprintln!(
            "[backend-telemetry][fallback] level={level} module={} event={} reason={reason} message={message}",
            record.module_id, record.event
        );
    }
}

#[cfg(test)]
mod tests {
    use super::{build_record, dispatch_with_core, BackendTelemetryOptions};
    use crate::telemetry::TelemetryCore;
    use crate::telemetry_contract::{
        TelemetryKind, TelemetryLevel, TelemetryPolicy, TelemetrySide,
    };
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_root_dir() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("pmp-backend-telemetry-test-{nanos}"))
    }

    #[test]
    fn build_record_normalizes_backend_defaults() {
        let record = build_record(
            TelemetryLevel::Warn,
            TelemetryKind::Log,
            "  plugin  ",
            "  plugin.sidecar.bridge.failed  ",
            BackendTelemetryOptions::new()
                .component("  SidecarBridgeRegistry  ")
                .message("  unexpected exit  ")
                .trace_id("  trace-1  ")
                .span_id("  span-1  ")
                .window_id("  main  ")
                .field("  pluginId  ", serde_json::json!("demo"))
                .field("   ", serde_json::json!("ignored")),
        );

        assert!(record.ts > 0);
        assert_eq!(record.level, TelemetryLevel::Warn);
        assert_eq!(record.kind, TelemetryKind::Log);
        assert_eq!(record.side, TelemetrySide::Backend);
        assert_eq!(record.module_id, "plugin");
        assert_eq!(record.event, "plugin.sidecar.bridge.failed");
        assert_eq!(record.component.as_deref(), Some("SidecarBridgeRegistry"));
        assert_eq!(record.message.as_deref(), Some("unexpected exit"));
        assert_eq!(record.trace_id.as_deref(), Some("trace-1"));
        assert_eq!(record.span_id.as_deref(), Some("span-1"));
        assert_eq!(record.window_id.as_deref(), Some("main"));
        assert!(record.session_id.is_empty());
        assert_eq!(
            record
                .fields
                .as_ref()
                .and_then(|fields| fields.get("pluginId")),
            Some(&serde_json::json!("demo"))
        );
        assert_eq!(record.fields.as_ref().map(|fields| fields.len()), Some(1));
    }

    #[test]
    fn dispatch_with_core_persists_backend_metric_records() {
        let mut policy = TelemetryPolicy::default();
        policy.persist_min_level = TelemetryLevel::Info;
        let root_dir = test_root_dir();
        let telemetry_core = TelemetryCore::new_for_tests(root_dir.clone(), policy);

        let result = dispatch_with_core(
            &telemetry_core,
            build_record(
                TelemetryLevel::Info,
                TelemetryKind::Metric,
                "performance",
                "performance.process-snapshot.unavailable",
                BackendTelemetryOptions::new()
                    .component("ProcessPerfService")
                    .field("status", serde_json::json!("unsupported")),
            ),
        );

        assert_eq!(result.accepted_count, 1);
        let session = telemetry_core.read_current_session();
        assert_eq!(session.record_count, 1);
        assert_eq!(session.records[0].kind, TelemetryKind::Metric);
        assert_eq!(session.records[0].side, TelemetrySide::Backend);
        assert_eq!(
            session.records[0]
                .fields
                .as_ref()
                .and_then(|fields| fields.get("status")),
            Some(&serde_json::json!("unsupported"))
        );
        assert!(!session.records[0].session_id.is_empty());

        let _ = std::fs::remove_dir_all(root_dir);
    }
}
