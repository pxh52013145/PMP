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
