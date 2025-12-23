// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use tauri::{CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu};

mod native_audio;
mod windows;
mod music_library;
mod background_media;

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
    native_audio::load(&app, path)
}

#[tauri::command]
async fn native_audio_play(app: tauri::AppHandle) -> Result<(), String> {
    native_audio::play(&app)
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_crossfade_to(
    app: tauri::AppHandle,
    path: String,
    duration_ms: u64,
) -> Result<(), String> {
    native_audio::crossfade_to(&app, path, duration_ms)
}

#[tauri::command]
async fn native_audio_pause(app: tauri::AppHandle) -> Result<(), String> {
    native_audio::pause(&app)
}

#[tauri::command]
async fn native_audio_stop(app: tauri::AppHandle) -> Result<(), String> {
    native_audio::stop(&app)
}

#[tauri::command]
async fn native_audio_seek(app: tauri::AppHandle, time: f64) -> Result<(), String> {
    native_audio::seek(&app, time)
}

#[tauri::command]
async fn native_audio_set_volume(app: tauri::AppHandle, volume: f32) -> Result<(), String> {
    native_audio::set_volume(&app, volume)
}

#[tauri::command]
async fn native_audio_set_mute(app: tauri::AppHandle, muted: bool) -> Result<(), String> {
    native_audio::set_mute(&app, muted)
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_set_gain(app: tauri::AppHandle, db: f32) -> Result<(), String> {
    native_audio::set_gain(&app, db)
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_set_replay_gain(app: tauri::AppHandle, db: Option<f32>) -> Result<(), String> {
    native_audio::set_replay_gain(&app, db)
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_set_dsp_chain(
    app: tauri::AppHandle,
    chain: Vec<native_audio::DspNodeConfig>,
) -> Result<(), String> {
    native_audio::set_dsp_chain(&app, chain)
}

#[tauri::command]
async fn native_audio_list_devices() -> Result<Vec<String>, String> {
    native_audio::list_output_devices()
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_select_device(
    app: tauri::AppHandle,
    device_name: Option<String>,
) -> Result<(), String> {
    native_audio::select_output_device(&app, device_name)
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_sync_queue(
    app: tauri::AppHandle,
    queue: Vec<String>,
    current_index: i32,
) -> Result<(), String> {
    native_audio::sync_queue(&app, queue, current_index)
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
    tauri::async_runtime::spawn_blocking(move || music_library::get_or_create_cover(&app, path, max_bytes))
        .await
        .map_err(|e| format!("Cover task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn music_library_remove_cover(
    app: tauri::AppHandle,
    key: String,
) -> Result<u64, String> {
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
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        background_media::import_background_media(&app, source_path, kind)
    })
    .await
    .map_err(|e| format!("Import task failed: {e}"))?
}

fn main() {
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
            let window = app.get_window(windows::MAIN_WINDOW_LABEL).unwrap();

            #[cfg(target_os = "windows")]
            {
                use window_shadows::set_shadow;
                let _ = set_shadow(&window, false);
                windows::taskbar_thumbbar::init_main_window(&app.handle());
            }

            let app_handle = app.handle();
            let exit_flag = app.state::<ExitFlag>().0.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    exit_flag.store(true, Ordering::SeqCst);
                    windows::editor::close_all_editor_windows(&app_handle);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            background_import_media,
            open_editor_window,
            close_editor_window,
            close_all_editor_windows,
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
            native_audio_list_devices,
            native_audio_select_device,
            native_audio_sync_queue
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
