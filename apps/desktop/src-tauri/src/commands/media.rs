use crate::{background_media, ornament_media};

#[tauri::command(rename_all = "camelCase")]
pub async fn background_import_media(
    app: tauri::AppHandle,
    source_path: String,
    kind: String,
    gif_max_fps: Option<u16>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        background_media::import_background_media(&app, source_path, kind, gif_max_fps)
    })
    .await
    .map_err(|e| format!("Import task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ornament_import_media(
    app: tauri::AppHandle,
    source_path: String,
    gif_max_fps: Option<u16>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ornament_media::import_ornament_media(&app, source_path, gif_max_fps)
    })
    .await
    .map_err(|e| format!("Import task failed: {e}"))?
}
