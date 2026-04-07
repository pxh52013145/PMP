use crate::sidecar_bridge::{SidecarBridgeOpenRequest, SidecarBridgeOpenResponse, SidecarBridgeRegistry};

#[tauri::command(rename_all = "camelCase")]
pub fn plugin_sidecar_bridge_open(
    app: tauri::AppHandle,
    registry: tauri::State<'_, SidecarBridgeRegistry>,
    plugin_id: String,
    runtime_id: String,
    runtime_instance_id: String,
    entry_path: String,
    command_id: String,
    args: Option<serde_json::Value>,
    timeout_ms: u64,
) -> Result<SidecarBridgeOpenResponse, String> {
    registry.open_session(
        &app,
        SidecarBridgeOpenRequest {
            plugin_id,
            runtime_id,
            runtime_instance_id,
            entry_path,
            command_id,
            args,
            timeout_ms,
        },
    )
}

#[tauri::command(rename_all = "camelCase")]
pub fn plugin_sidecar_bridge_send(
    registry: tauri::State<'_, SidecarBridgeRegistry>,
    session_id: String,
    message: serde_json::Value,
) -> Result<(), String> {
    registry.send_message(&session_id, message)
}

#[tauri::command(rename_all = "camelCase")]
pub fn plugin_sidecar_bridge_close(
    registry: tauri::State<'_, SidecarBridgeRegistry>,
    session_id: String,
    reason: Option<String>,
) -> Result<(), String> {
    registry.close_session(&session_id, reason.as_deref())
}
