use crate::telemetry::TelemetryCore;
use crate::telemetry_contract::{TelemetryExportBundle, TelemetryQueryInput};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

pub fn build_export_bundle(
    app: &AppHandle,
    telemetry_core: &TelemetryCore,
    query: TelemetryQueryInput,
    process_perf_totals: Option<serde_json::Value>,
    process_perf_error: Option<String>,
) -> TelemetryExportBundle {
    let status = telemetry_core.status();
    let query_result = telemetry_core.query_current_session(query.clone());
    let mut errors = Vec::new();

    let debug_config = match crate::debug_config::get_config(app) {
        Ok(config) => serde_json::to_value(config).ok(),
        Err(error) => {
            errors.push(format!("debug_config: {error}"));
            None
        }
    };

    let backend_modules = crate::modules::catalog::list_backend_modules()
        .into_iter()
        .filter_map(|module| serde_json::to_value(module).ok())
        .collect::<Vec<_>>();

    if let Some(error) = process_perf_error {
        errors.push(format!("process_perf_totals: {error}"));
    }

    TelemetryExportBundle {
        schema_version: 1,
        generated_at_ms: now_ms(),
        session_id: status.current_session_id.clone(),
        status,
        query,
        query_result,
        debug_config,
        env_snapshot: crate::debug_config::env_snapshot(),
        backend_modules,
        registered_commands: crate::commands::registry::list_registered_command_names()
            .into_iter()
            .map(str::to_string)
            .collect(),
        process_perf_totals,
        errors,
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
