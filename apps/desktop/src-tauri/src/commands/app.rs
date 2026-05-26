use crate::app_runtime;
use serde_json::json;
use tauri::Manager;

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Pixel Matrix Player!", name)
}

#[tauri::command]
pub fn app_request_exit(app: tauri::AppHandle) {
    app_runtime::request_app_exit(&app);
}

#[tauri::command]
pub fn app_restart(app: tauri::AppHandle) {
    if let Some(exit_code) = app_runtime::read_dev_restart_exit_code() {
        let signal_written = match app_runtime::write_dev_restart_signal() {
            Ok(written) => written,
            Err(error) => {
                crate::backend_telemetry::warn(
                    &app,
                    "app",
                    "app.restart.dev-supervisor.signal.failed",
                    crate::backend_telemetry::BackendTelemetryOptions::new()
                        .component("commands::app")
                        .message(error),
                );
                false
            }
        };

        crate::backend_telemetry::info(
            &app,
            "app",
            "app.restart.dev-supervisor.requested",
            crate::backend_telemetry::BackendTelemetryOptions::new()
                .component("commands::app")
                .field("exitCode", json!(exit_code))
                .field("signalWritten", json!(signal_written)),
        );
        app_runtime::request_app_exit_with_code(&app, exit_code);
        return;
    }

    tauri::api::process::restart(&app.env());
}

#[tauri::command]
pub fn app_consume_pending_host_file_opens(
    app: tauri::AppHandle,
    state: tauri::State<'_, app_runtime::HostFileOpenState>,
) -> Vec<app_runtime::HostFileOpenPayload> {
    let payloads = state.consume_pending();

    if !payloads.is_empty() {
        let path_count = payloads
            .iter()
            .map(|payload| payload.paths.len())
            .sum::<usize>();
        let sources = payloads
            .iter()
            .map(|payload| payload.source.as_str())
            .collect::<Vec<_>>();

        crate::backend_telemetry::info(
            &app,
            "startup",
            "startup.host-file-open.pending.consumed",
            crate::backend_telemetry::BackendTelemetryOptions::new()
                .component("HostFileOpenState")
                .field("payloadCount", json!(payloads.len()))
                .field("pathCount", json!(path_count))
                .field("sources", json!(sources)),
        );
    }

    payloads
}

#[cfg(test)]
mod tests {
    use super::greet;

    #[test]
    fn greet_returns_expected_message() {
        let message = greet("Tester");
        assert_eq!(message, "Hello, Tester! Welcome to Pixel Matrix Player!");
    }
}
