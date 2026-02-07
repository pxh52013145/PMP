use std::sync::atomic::Ordering;

use crate::{app_runtime, windows};

#[tauri::command]
pub async fn open_editor_window(
    app: tauri::AppHandle,
    window_type: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    exit: tauri::State<'_, app_runtime::ExitFlag>,
    effects: tauri::State<'_, app_runtime::EditorEffectsState>,
) -> Result<(), String> {
    let editor_window_type = windows::editor::EditorWindowType::from_str(window_type.as_str())
        .ok_or_else(|| format!("Unknown editor window type: {}", window_type))?;

    windows::editor::open_editor_window(
        &app,
        editor_window_type,
        windows::editor::EditorWindowGeometry {
            x,
            y,
            width,
            height,
        },
        exit.0.clone(),
        effects.blur_enabled.clone(),
    )
}

#[tauri::command]
pub async fn close_editor_window(app: tauri::AppHandle, window_type: String) -> Result<(), String> {
    let editor_window_type = windows::editor::EditorWindowType::from_str(window_type.as_str())
        .ok_or_else(|| format!("Unknown editor window type: {}", window_type))?;

    windows::editor::close_editor_window(&app, editor_window_type)
}

#[tauri::command]
pub async fn close_all_editor_windows(app: tauri::AppHandle) -> Result<(), String> {
    windows::editor::close_all_editor_windows(&app);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_plugin_window(
    app: tauri::AppHandle,
    plugin_id: String,
    window_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    title: Option<String>,
    exit: tauri::State<'_, app_runtime::ExitFlag>,
) -> Result<(), String> {
    windows::plugin::open_plugin_window(
        &app,
        plugin_id,
        window_id,
        windows::plugin::PluginWindowGeometry {
            x,
            y,
            width,
            height,
        },
        exit.0.clone(),
        title,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub async fn close_plugin_window(
    app: tauri::AppHandle,
    plugin_id: String,
    window_id: String,
) -> Result<(), String> {
    windows::plugin::close_plugin_window(&app, plugin_id, window_id)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_vst_manager_window(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    title: Option<String>,
    exit: tauri::State<'_, app_runtime::ExitFlag>,
) -> Result<(), String> {
    windows::vst_manager::open_vst_manager_window(
        &app,
        windows::vst_manager::VstManagerWindowGeometry {
            x,
            y,
            width,
            height,
        },
        exit.0.clone(),
        title,
    )
}

#[tauri::command]
pub async fn close_vst_manager_window(app: tauri::AppHandle) -> Result<(), String> {
    windows::vst_manager::close_vst_manager_window(&app)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_editor_blur_enabled(
    app: tauri::AppHandle,
    enabled: bool,
    effects: tauri::State<'_, app_runtime::EditorEffectsState>,
) -> Result<(), String> {
    effects.blur_enabled.store(enabled, Ordering::SeqCst);
    windows::editor::set_editor_windows_blur_enabled(&app, enabled)
}
