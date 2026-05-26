use std::sync::atomic::Ordering;

use crate::{app_runtime, desktop_lyrics_fonts, windows};

#[tauri::command]
pub async fn open_editor_window(
    app: tauri::AppHandle,
    window_type: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    always_on_top: Option<bool>,
    memory_first: Option<bool>,
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
        always_on_top,
        memory_first,
        exit.0.clone(),
        effects.blur_enabled.clone(),
    )
}

#[tauri::command]
pub async fn close_editor_window(
    app: tauri::AppHandle,
    window_type: String,
    memory_first: Option<bool>,
) -> Result<(), String> {
    let editor_window_type = windows::editor::EditorWindowType::from_str(window_type.as_str())
        .ok_or_else(|| format!("Unknown editor window type: {}", window_type))?;

    windows::editor::close_editor_window(&app, editor_window_type, memory_first)
}

#[tauri::command]
pub async fn close_all_editor_windows(app: tauri::AppHandle) -> Result<(), String> {
    windows::editor::close_all_editor_windows(&app);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_plugin_window(
    app: tauri::AppHandle,
    source_kind: Option<String>,
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
        source_kind,
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
    source_kind: Option<String>,
    plugin_id: String,
    window_id: String,
) -> Result<(), String> {
    windows::plugin::close_plugin_window(&app, source_kind, plugin_id, window_id)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_plugin_shell_surface(
    app: tauri::AppHandle,
    source_kind: Option<String>,
    plugin_id: String,
    surface_id: String,
    surface_type: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    title: Option<String>,
    always_on_top: bool,
    focusable: bool,
    pointer_policy: String,
    exit: tauri::State<'_, app_runtime::ExitFlag>,
) -> Result<(), String> {
    windows::plugin_shell_surface::open_plugin_shell_surface(
        &app,
        windows::plugin_shell_surface::PluginShellSurfaceConfig {
            source_kind,
            plugin_id,
            surface_id,
            surface_type,
            geometry: windows::plugin_shell_surface::PluginShellSurfaceGeometry {
                x,
                y,
                width,
                height,
            },
            title,
            always_on_top,
            focusable,
            pointer_policy,
        },
        exit.0.clone(),
    )
}

#[tauri::command(rename_all = "camelCase")]
pub async fn dismiss_plugin_shell_surface(
    app: tauri::AppHandle,
    source_kind: Option<String>,
    plugin_id: String,
    surface_id: String,
    surface_type: String,
) -> Result<(), String> {
    windows::plugin_shell_surface::dismiss_plugin_shell_surface(
        &app,
        source_kind,
        plugin_id,
        surface_id,
        surface_type,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub async fn destroy_plugin_shell_surface(
    app: tauri::AppHandle,
    source_kind: Option<String>,
    plugin_id: String,
    surface_id: String,
    surface_type: String,
    reason: Option<String>,
) -> Result<(), String> {
    windows::plugin_shell_surface::destroy_plugin_shell_surface(
        &app,
        source_kind,
        plugin_id,
        surface_id,
        surface_type,
        reason,
    )
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

#[tauri::command(rename_all = "camelCase")]
pub async fn set_editor_memory_first_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<(), String> {
    windows::editor::set_editor_windows_memory_first_enabled(&app, enabled)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_workbench_native_surface(
    app: tauri::AppHandle,
    surface_id: String,
    region: String,
    width: f64,
    height: f64,
    title: Option<String>,
) -> Result<(), String> {
    let region =
        windows::workbench_native_surface::WorkbenchNativeSurfaceRegion::from_str(region.as_str())
            .ok_or_else(|| format!("Unknown workbench native surface region: {}", region))?;

    windows::workbench_native_surface::open_surface(
        &app,
        windows::workbench_native_surface::WorkbenchNativeSurfaceConfig {
            surface_id,
            region,
            title,
            width,
            height,
        },
    )
}

#[tauri::command]
pub async fn sync_workbench_native_surfaces_geometry(app: tauri::AppHandle) -> Result<(), String> {
    windows::workbench_native_surface::sync_geometry(&app)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_workbench_native_surface_content(
    surface_id: String,
    content: serde_json::Value,
) -> Result<(), String> {
    windows::workbench_native_surface::update_surface_content(surface_id, content)
}

#[tauri::command]
pub async fn close_workbench_native_surface(surface_id: String) -> Result<(), String> {
    windows::workbench_native_surface::close_surface(surface_id)
}

#[tauri::command]
pub async fn close_all_workbench_native_surfaces() -> Result<(), String> {
    windows::workbench_native_surface::close_all_surfaces()
}

#[tauri::command]
pub async fn ornaments_editor_overlay_open(app: tauri::AppHandle) -> Result<(), String> {
    windows::ornaments_editor_overlay::open(&app)
}

#[tauri::command]
pub async fn ornaments_editor_overlay_close(app: tauri::AppHandle) -> Result<(), String> {
    windows::ornaments_editor_overlay::close(&app)
}

#[tauri::command]
pub async fn ornaments_render_overlay_open(app: tauri::AppHandle) -> Result<(), String> {
    windows::ornaments_editor_overlay::open_render(&app)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ornaments_render_overlay_sync_planes(
    app: tauri::AppHandle,
    behind: bool,
    above: bool,
) -> Result<(), String> {
    windows::ornaments_editor_overlay::sync_render_planes(&app, behind, above)
}

#[tauri::command]
pub async fn ornaments_overlay_sync_geometry(app: tauri::AppHandle) -> Result<(), String> {
    windows::ornaments_editor_overlay::sync_geometry(&app)
}

#[tauri::command]
pub async fn ornaments_drag_main_window(app: tauri::AppHandle) -> Result<(), String> {
    windows::ornaments_editor_overlay::drag_main_window(&app)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn taskbar_thumbbar_sync_playback_state(playback_state: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        windows::taskbar_thumbbar::sync_from_native_audio_state(&playback_state);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = playback_state;
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn desktop_lyrics_set_visible(
    app: tauri::AppHandle,
    visible: bool,
) -> Result<(), String> {
    windows::desktop_lyrics::register_app_handle(&app);
    windows::desktop_lyrics::set_visible(visible)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn desktop_lyrics_toggle_visible(app: tauri::AppHandle) -> Result<bool, String> {
    windows::desktop_lyrics::register_app_handle(&app);
    windows::desktop_lyrics::toggle_visible()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn desktop_lyrics_set_click_through(enabled: bool) -> Result<(), String> {
    windows::desktop_lyrics::set_click_through(enabled)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn desktop_lyrics_set_font_size(font_size: u32) -> Result<(), String> {
    windows::desktop_lyrics::set_font_size(font_size)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn desktop_lyrics_set_position_preset(preset: String) -> Result<(), String> {
    windows::desktop_lyrics::set_position_preset(preset)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn desktop_lyrics_set_opacity_percent(opacity_percent: u8) -> Result<(), String> {
    windows::desktop_lyrics::set_opacity_percent(opacity_percent)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn desktop_lyrics_set_position_offset(
    offset_x: i32,
    offset_y: i32,
) -> Result<(), String> {
    windows::desktop_lyrics::set_position_offset(offset_x, offset_y)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn desktop_lyrics_set_region_size(width: i32, height: i32) -> Result<(), String> {
    windows::desktop_lyrics::set_region_size(width, height)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn desktop_lyrics_set_layout(
    offset_x: i32,
    offset_y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    windows::desktop_lyrics::set_layout(offset_x, offset_y, width, height)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn desktop_lyrics_preview_layout(
    app: tauri::AppHandle,
    offset_x: i32,
    offset_y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    windows::desktop_lyrics::preview_layout(&app, offset_x, offset_y, width, height)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn desktop_lyrics_set_lyric_offset_ms(offset_ms: i32) -> Result<(), String> {
    windows::desktop_lyrics::set_lyric_offset_ms(offset_ms)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn desktop_lyrics_import_font(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<desktop_lyrics_fonts::DesktopLyricsFontImportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        desktop_lyrics_fonts::import_desktop_lyrics_font(&app, source_path)
    })
    .await
    .map_err(|error| format!("Import task failed: {error}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn desktop_lyrics_debug_set_text(
    primary: Option<String>,
    secondary: Option<String>,
    visible: Option<bool>,
) -> Result<(), String> {
    windows::desktop_lyrics::debug_set_text(primary, secondary, visible)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn desktop_lyrics_overlay_get_snapshot(
) -> Result<windows::desktop_lyrics::DesktopLyricsOverlaySnapshot, String> {
    windows::desktop_lyrics::get_overlay_snapshot()
}
