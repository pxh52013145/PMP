// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use tauri::{CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu};
use magnet_layout_store::{
    magnet_layout_store_apply_patch, magnet_layout_store_bootstrap, magnet_layout_store_get_state,
};

mod background_media;
mod audio;
mod asio_diag;
mod audio_smoke;
mod dsp_graph;
mod magnet_layout_store;
mod music_library;
mod native_audio;
mod vst_audit;
mod vst_bridge;
mod vst_dsp;
mod vst_governance;
mod vst_instance_manager;
mod vst_library;
mod vst_runtime;
mod vst_scanner;
mod vst_settings;
mod vst_shm;
mod windows;

struct ExitFlag(Arc<AtomicBool>);
struct EditorEffectsState {
    blur_enabled: Arc<AtomicBool>,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Pixel Matrix Player!", name)
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

#[tauri::command]
async fn native_audio_load(app: tauri::AppHandle, path: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::load(&app, path))
        .await
        .map_err(|e| format!("Native audio load task failed: {e}"))?
}

#[tauri::command]
async fn native_audio_play(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::play(&app))
        .await
        .map_err(|e| format!("Native audio play task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_crossfade_to(
    app: tauri::AppHandle,
    path: String,
    duration_ms: u64,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::crossfade_to(&app, path, duration_ms))
        .await
        .map_err(|e| format!("Native audio crossfade task failed: {e}"))?
}

#[tauri::command]
async fn native_audio_pause(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::pause(&app))
        .await
        .map_err(|e| format!("Native audio pause task failed: {e}"))?
}

#[tauri::command]
async fn native_audio_stop(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::stop(&app))
        .await
        .map_err(|e| format!("Native audio stop task failed: {e}"))?
}

#[tauri::command]
async fn native_audio_seek(app: tauri::AppHandle, time: f64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::seek(&app, time))
        .await
        .map_err(|e| format!("Native audio seek task failed: {e}"))?
}

#[tauri::command]
async fn native_audio_set_volume(app: tauri::AppHandle, volume: f32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::set_volume(&app, volume))
        .await
        .map_err(|e| format!("Native audio set volume task failed: {e}"))?
}

#[tauri::command]
async fn native_audio_set_mute(app: tauri::AppHandle, muted: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::set_mute(&app, muted))
        .await
        .map_err(|e| format!("Native audio set mute task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_set_gain(app: tauri::AppHandle, db: f32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::set_gain(&app, db))
        .await
        .map_err(|e| format!("Native audio set gain task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_set_replay_gain(
    app: tauri::AppHandle,
    db: Option<f32>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::set_replay_gain(&app, db))
        .await
        .map_err(|e| format!("Native audio set replay gain task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_set_dsp_chain(
    app: tauri::AppHandle,
    chain: Vec<native_audio::DspNodeConfig>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::set_dsp_chain(&app, chain))
        .await
        .map_err(|e| format!("Native audio set DSP chain task failed: {e}"))?
}

#[tauri::command]
async fn native_audio_list_output_backends() -> Result<Vec<String>, String> {
    native_audio::list_output_backends()
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_select_output_backend(
    app: tauri::AppHandle,
    backend_id: Option<String>,
) -> Result<native_audio::NativeAudioComponentsStatePayload, String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::select_output_backend(&app, backend_id))
        .await
        .map_err(|e| format!("Native audio select output backend task failed: {e}"))?
}

#[tauri::command]
async fn native_audio_list_audio_inputs() -> Result<Vec<String>, String> {
    native_audio::list_audio_inputs()
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_select_audio_input(
    app: tauri::AppHandle,
    input_id: Option<String>,
) -> Result<native_audio::NativeAudioComponentsStatePayload, String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::select_audio_input(&app, input_id))
        .await
        .map_err(|e| format!("Native audio select audio input task failed: {e}"))?
}

#[tauri::command]
async fn native_audio_get_audio_components_state(
) -> Result<native_audio::NativeAudioComponentsStatePayload, String> {
    native_audio::get_audio_components_state()
}

#[tauri::command]
async fn native_audio_list_devices() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(native_audio::list_output_devices)
        .await
        .map_err(|e| format!("Native audio list devices task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_select_device(
    app: tauri::AppHandle,
    device_name: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::select_output_device(&app, device_name))
        .await
        .map_err(|e| format!("Native audio select device task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_open_asio_control_panel(device_name: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::open_asio_control_panel(device_name))
        .await
        .map_err(|e| format!("Native audio open ASIO control panel task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_sync_queue(
    app: tauri::AppHandle,
    queue: Vec<String>,
    current_index: i32,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::sync_queue(&app, queue, current_index))
        .await
        .map_err(|e| format!("Native audio sync queue task failed: {e}"))?
}

#[tauri::command]
async fn native_audio_resample_cache_get_status(
    app: tauri::AppHandle,
) -> Result<audio::resample_cache::ResampleCacheStatus, String> {
    audio::resample_cache::get_status(&app)
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_resample_cache_set_max_bytes(
    app: tauri::AppHandle,
    max_bytes: u64,
) -> Result<audio::resample_cache::ResampleCacheStatus, String> {
    audio::resample_cache::set_max_bytes(&app, max_bytes)
}

#[tauri::command]
async fn native_audio_resample_cache_clear(
    app: tauri::AppHandle,
) -> Result<audio::resample_cache::ResampleCacheStatus, String> {
    audio::resample_cache::clear(&app)
}

#[tauri::command]
async fn native_audio_get_dsp_graph(
    app: tauri::AppHandle,
) -> Result<dsp_graph::DspGraphConfig, String> {
    tauri::async_runtime::spawn_blocking(move || dsp_graph::get_dsp_graph(&app))
        .await
        .map_err(|e| format!("Get DSP graph task failed: {e}"))?
}

#[tauri::command]
async fn native_audio_set_dsp_graph(
    app: tauri::AppHandle,
    graph: dsp_graph::DspGraphConfig,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || dsp_graph::set_dsp_graph(&app, graph))
        .await
        .map_err(|e| format!("Set DSP graph task failed: {e}"))?
}

#[tauri::command]
async fn native_audio_vst_list_plugins() -> Result<Vec<vst_bridge::BridgePluginDescriptor>, String>
{
    tauri::async_runtime::spawn_blocking(|| vst_runtime::list_plugins())
        .await
        .map_err(|e| format!("VST list task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_vst_describe_plugin(
    plugin_id: String,
) -> Result<vst_bridge::BridgePluginDescriptor, String> {
    tauri::async_runtime::spawn_blocking(move || vst_runtime::describe_plugin(plugin_id.as_str()))
        .await
        .map_err(|e| format!("VST describe task failed: {e}"))?
}

#[tauri::command]
async fn native_audio_vst_library_list_plugins() -> Result<Vec<vst_library::VstLibraryPlugin>, String>
{
    tauri::async_runtime::spawn_blocking(|| vst_library::list_plugins())
        .await
        .map_err(|e| format!("VST library list task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_vst_library_get_plugin_params(
    plugin_id: String,
) -> Result<Vec<vst_library::VstLibraryParamDescriptor>, String> {
    tauri::async_runtime::spawn_blocking(move || vst_library::get_plugin_params(plugin_id.as_str()))
        .await
        .map_err(|e| format!("VST library params task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_vst_library_list_scan_runs(
    limit: Option<u32>,
) -> Result<Vec<vst_library::VstScanRun>, String> {
    tauri::async_runtime::spawn_blocking(move || vst_library::list_scan_runs(limit.unwrap_or(40)))
        .await
        .map_err(|e| format!("VST library scan runs task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_vst_library_list_scan_events(
    run_id: String,
    limit: Option<u32>,
) -> Result<Vec<vst_library::VstScanEvent>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        vst_library::list_scan_events(run_id.as_str(), limit.unwrap_or(80))
    })
    .await
    .map_err(|e| format!("VST library scan events task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_vst_scan_start(
    app: tauri::AppHandle,
    request: vst_scanner::VstScanRequest,
) -> Result<String, String> {
    vst_scanner::start_scan(&app, request)
}

#[tauri::command]
async fn native_audio_vst_scan_cancel() -> Result<(), String> {
    vst_scanner::cancel_scan()
}

#[tauri::command]
async fn native_audio_vst_scan_state() -> Result<vst_scanner::VstScanState, String> {
    vst_scanner::get_state()
}

#[tauri::command]
async fn native_audio_vst_list_session_statuses() -> Result<Vec<vst_runtime::VstSessionStatus>, String> {
    Ok(tauri::async_runtime::spawn_blocking(|| vst_runtime::list_session_statuses())
        .await
        .map_err(|e| format!("VST list session statuses task failed: {e}"))?)
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_vst_set_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::set_vst_enabled(&app, enabled))
        .await
        .map_err(|e| format!("VST set enabled task failed: {e}"))?
}

#[tauri::command]
async fn native_audio_vst_warmup(app: tauri::AppHandle) -> Result<Vec<native_audio::VstWarmupNodeReport>, String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::vst_warmup(&app))
        .await
        .map_err(|e| format!("VST warmup task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_vst_open_native_editor(
    app: tauri::AppHandle,
    node_id: String,
    title: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        vst_runtime::open_native_editor(&app, node_id, title)
    })
    .await
    .map_err(|e| format!("VST open editor task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_vst_close_native_editor(node_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || vst_runtime::close_native_editor(node_id))
        .await
        .map_err(|e| format!("VST close editor task failed: {e}"))?
}

#[tauri::command]
async fn native_audio_vst_bring_editors_to_front(app: tauri::AppHandle) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || vst_runtime::bring_all_editors_to_front(&app))
        .await
        .map_err(|e| format!("VST bring editors task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_vst_set_params(
    app: tauri::AppHandle,
    node_id: String,
    params: Vec<dsp_graph::VstParamValue>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || vst_runtime::set_params(&app, node_id, params))
        .await
        .map_err(|e| format!("VST set params task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_vst_get_params(
    app: tauri::AppHandle,
    node_id: String,
) -> Result<Vec<dsp_graph::VstParamValue>, String> {
    tauri::async_runtime::spawn_blocking(move || vst_runtime::get_params(&app, node_id))
        .await
        .map_err(|e| format!("VST get params task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_vst_dispose_session(node_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || vst_runtime::dispose_session(node_id))
        .await
        .map_err(|e| format!("VST dispose task failed: {e}"))?
}

#[tauri::command]
async fn native_audio_vst_get_settings(
    app: tauri::AppHandle,
) -> Result<vst_settings::VstSettings, String> {
    tauri::async_runtime::spawn_blocking(move || vst_settings::get_settings(&app))
        .await
        .map_err(|e| format!("VST get settings task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_vst_set_settings(
    app: tauri::AppHandle,
    settings: vst_settings::VstSettings,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || vst_settings::set_settings(&app, settings))
        .await
        .map_err(|e| format!("VST set settings task failed: {e}"))?
}

#[tauri::command]
async fn native_audio_vst_get_audit_log() -> Result<vst_audit::VstAuditLog, String> {
    tauri::async_runtime::spawn_blocking(|| vst_audit::get_log())
        .await
        .map_err(|e| format!("VST audit log task failed: {e}"))?
}

#[tauri::command]
async fn native_audio_vst_clear_audit_log() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| vst_audit::clear_events())
        .await
        .map_err(|e| format!("VST audit log clear task failed: {e}"))?
}

#[tauri::command]
async fn native_audio_vst_get_governance() -> Result<vst_governance::VstGovernanceState, String> {
    tauri::async_runtime::spawn_blocking(|| vst_governance::state())
        .await
        .map_err(|e| format!("VST governance task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_vst_disable_plugin(
    plugin_id: String,
    reason: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        vst_governance::disable_plugin(
            plugin_id,
            None,
            reason.unwrap_or_else(|| "Disabled by user".to_string()),
            None,
        )
        .map(|_| ())
    })
    .await
    .map_err(|e| format!("VST disable plugin task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_vst_enable_plugin(plugin_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        vst_governance::enable_plugin(plugin_id.as_str()).map(|_| ())
    })
    .await
    .map_err(|e| format!("VST enable plugin task failed: {e}"))?
}

#[tauri::command]
async fn open_editor_window(
    app: tauri::AppHandle,
    window_type: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    exit: tauri::State<'_, ExitFlag>,
    effects: tauri::State<'_, EditorEffectsState>,
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
async fn close_editor_window(app: tauri::AppHandle, window_type: String) -> Result<(), String> {
    let editor_window_type = windows::editor::EditorWindowType::from_str(window_type.as_str())
        .ok_or_else(|| format!("Unknown editor window type: {}", window_type))?;

    windows::editor::close_editor_window(&app, editor_window_type)
}

#[tauri::command]
async fn close_all_editor_windows(app: tauri::AppHandle) -> Result<(), String> {
    windows::editor::close_all_editor_windows(&app);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
async fn open_plugin_window(
    app: tauri::AppHandle,
    plugin_id: String,
    window_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    title: Option<String>,
    exit: tauri::State<'_, ExitFlag>,
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
async fn close_plugin_window(
    app: tauri::AppHandle,
    plugin_id: String,
    window_id: String,
) -> Result<(), String> {
    windows::plugin::close_plugin_window(&app, plugin_id, window_id)
}

#[tauri::command(rename_all = "camelCase")]
async fn open_vst_manager_window(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    title: Option<String>,
    exit: tauri::State<'_, ExitFlag>,
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
async fn close_vst_manager_window(app: tauri::AppHandle) -> Result<(), String> {
    windows::vst_manager::close_vst_manager_window(&app)
}

#[tauri::command(rename_all = "camelCase")]
async fn set_editor_blur_enabled(
    app: tauri::AppHandle,
    enabled: bool,
    effects: tauri::State<'_, EditorEffectsState>,
) -> Result<(), String> {
    effects.blur_enabled.store(enabled, Ordering::SeqCst);
    windows::editor::set_editor_windows_blur_enabled(&app, enabled)
}

#[tauri::command(rename_all = "camelCase")]
async fn music_library_scan(
    app: tauri::AppHandle,
    paths: Vec<String>,
    options: Option<music_library::ScanOptions>,
) -> Result<Vec<music_library::ScannedTrack>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_library::scan_library_paths(&app, paths, options)
    })
    .await
    .map_err(|e| format!("Scan task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn music_library_get_cover(
    app: tauri::AppHandle,
    path: String,
    max_bytes: Option<u64>,
) -> Result<Option<music_library::CachedCover>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_library::get_or_create_cover(&app, path, max_bytes)
    })
    .await
    .map_err(|e| format!("Cover task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn music_library_remove_cover(app: tauri::AppHandle, key: String) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || music_library::remove_cached_cover(&app, key))
        .await
        .map_err(|e| format!("Remove cover task failed: {e}"))?
}

#[tauri::command]
fn music_library_cancel_scan() -> Result<(), String> {
    music_library::request_cancel_scan();
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
async fn background_import_media(
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

fn main() {
    if let Some(exit_code) = asio_diag::maybe_run_from_cli() {
        std::process::exit(exit_code);
    }
    if let Some(exit_code) = audio_smoke::maybe_run_from_cli() {
        std::process::exit(exit_code);
    }

    let show = CustomMenuItem::new("show".to_string(), "显示窗口");
    let hide = CustomMenuItem::new("hide".to_string(), "隐藏窗口");
    let quit = CustomMenuItem::new("quit".to_string(), "退出");
    let tray_menu = SystemTrayMenu::new()
        .add_item(show)
        .add_item(hide)
        .add_native_item(tauri::SystemTrayMenuItem::Separator)
        .add_item(quit);

    let system_tray = SystemTray::new().with_menu(tray_menu);

    tauri::Builder::default()
        .manage(ExitFlag(Arc::new(AtomicBool::new(false))))
        .manage(EditorEffectsState {
            blur_enabled: Arc::new(AtomicBool::new(true)),
        })
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick { .. } => {
                if let Some(window) = app.get_window(windows::MAIN_WINDOW_LABEL) {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                        let _ = app.emit_all(windows::EVENT_MAIN_WINDOW_HIDDEN, ());
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = app.emit_all(windows::EVENT_MAIN_WINDOW_SHOWN, ());
                    }
                }
            }
            SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                "show" => {
                    if let Some(window) = app.get_window(windows::MAIN_WINDOW_LABEL) {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = app.emit_all(windows::EVENT_MAIN_WINDOW_SHOWN, ());
                    }
                }
                "hide" => {
                    if let Some(window) = app.get_window(windows::MAIN_WINDOW_LABEL) {
                        let _ = window.hide();
                        let _ = app.emit_all(windows::EVENT_MAIN_WINDOW_HIDDEN, ());
                    }
                }
                "quit" => {
                    std::process::exit(0);
                }
                _ => {}
            },
            _ => {}
        })
        .setup(|app| {
            let magnet_layout_store = magnet_layout_store::MagnetLayoutStore::new(&app.handle())
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            app.manage(magnet_layout_store);

            let window = app.get_window(windows::MAIN_WINDOW_LABEL).unwrap();

            #[cfg(target_os = "windows")]
            {
                use window_shadows::set_shadow;
                let _ = set_shadow(&window, false);
                windows::taskbar_thumbbar::init_main_window(&app.handle());
            }

            let app_handle = app.handle();
            let exit_flag = app.state::<ExitFlag>().0.clone();
            window.on_window_event(move |event| match event {
                tauri::WindowEvent::CloseRequested { .. } => {
                    exit_flag.store(true, Ordering::SeqCst);
                    windows::editor::close_all_editor_windows(&app_handle);
                    windows::plugin::close_all_plugin_windows(&app_handle);
                    windows::vst_manager::close_all_vst_manager_windows(&app_handle);
                    vst_runtime::close_all();
                }
                tauri::WindowEvent::Focused(true) => {
                    let app_handle = app_handle.clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        std::thread::sleep(Duration::from_millis(80));
                        let _ = vst_runtime::raise_visible_editors_above_main(&app_handle);
                    });
                }
                _ => {}
            });

            if let Err(error) = vst_audit::init(&app.handle()) {
                eprintln!("[VST] Failed to init audit log: {error}");
            }
            if let Err(error) = vst_governance::init(&app.handle()) {
                eprintln!("[VST] Failed to init governance: {error}");
            }
            if let Err(error) = vst_library::init(&app.handle()) {
                eprintln!("[VST] Failed to init library: {error}");
            }
            vst_runtime::init_session_status_broadcaster(&app.handle());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            background_import_media,
            open_editor_window,
            close_editor_window,
            close_all_editor_windows,
            open_plugin_window,
            close_plugin_window,
            open_vst_manager_window,
            close_vst_manager_window,
            set_editor_blur_enabled,
            music_library_scan,
            music_library_get_cover,
            music_library_remove_cover,
            music_library_cancel_scan,
            native_audio_load,
            native_audio_play,
            native_audio_crossfade_to,
            native_audio_pause,
            native_audio_stop,
            native_audio_seek,
            native_audio_set_volume,
            native_audio_set_mute,
            native_audio_set_gain,
            native_audio_set_replay_gain,
            native_audio_set_dsp_chain,
            native_audio_get_dsp_graph,
            native_audio_set_dsp_graph,
            native_audio_vst_list_plugins,
            native_audio_vst_describe_plugin,
            native_audio_vst_library_list_plugins,
            native_audio_vst_library_get_plugin_params,
            native_audio_vst_library_list_scan_runs,
            native_audio_vst_library_list_scan_events,
            native_audio_vst_scan_start,
            native_audio_vst_scan_cancel,
            native_audio_vst_scan_state,
            native_audio_vst_list_session_statuses,
            native_audio_vst_set_enabled,
            native_audio_vst_warmup,
            native_audio_vst_open_native_editor,
            native_audio_vst_close_native_editor,
            native_audio_vst_bring_editors_to_front,
            native_audio_vst_set_params,
            native_audio_vst_get_params,
            native_audio_vst_dispose_session,
            native_audio_vst_get_settings,
            native_audio_vst_set_settings,
            native_audio_vst_get_audit_log,
            native_audio_vst_clear_audit_log,
            native_audio_vst_get_governance,
            native_audio_vst_disable_plugin,
            native_audio_vst_enable_plugin,
            native_audio_list_output_backends,
            native_audio_select_output_backend,
            native_audio_list_audio_inputs,
            native_audio_select_audio_input,
            native_audio_get_audio_components_state,
            native_audio_list_devices,
            native_audio_select_device,
            native_audio_open_asio_control_panel,
            native_audio_sync_queue,
            native_audio_resample_cache_get_status,
            native_audio_resample_cache_set_max_bytes,
            native_audio_resample_cache_clear,
            magnet_layout_store_get_state,
            magnet_layout_store_bootstrap,
            magnet_layout_store_apply_patch
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
