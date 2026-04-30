use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu};

const TRAY_MENU_SHOW_ID: &str = "show";
const TRAY_MENU_HIDE_ID: &str = "hide";
const TRAY_MENU_QUIT_ID: &str = "quit";

static MUSIC_LIBRARY_SERVICES_INITIALIZED: AtomicBool = AtomicBool::new(false);
static MUSIC_LIBRARY_SERVICES_INIT_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));
static VST_SERVICES_INITIALIZED: AtomicBool = AtomicBool::new(false);
static VST_SERVICES_INIT_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

#[cfg(target_os = "windows")]
fn should_enable_windows_shell_integration() -> bool {
    let force_enable = std::env::var("PMP_ENABLE_WINDOWS_SHELL_INTEGRATION")
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes"
            )
        })
        .unwrap_or(false);
    if force_enable {
        return true;
    }

    let force_disable = std::env::var("PMP_DISABLE_WINDOWS_SHELL_INTEGRATION")
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes"
            )
        })
        .unwrap_or(false);
    if force_disable {
        return false;
    }

    // In `tauri dev`, custom Win32 message hooks can interfere with WebView2 runtime startup.
    // Keep dev stable by default and allow explicit opt-in via env.
    std::env::var("TAURI_DEV").is_err()
}

pub fn create_system_tray() -> SystemTray {
    let show = CustomMenuItem::new(TRAY_MENU_SHOW_ID.to_string(), "Show Window");
    let hide = CustomMenuItem::new(TRAY_MENU_HIDE_ID.to_string(), "Hide Window");
    let quit = CustomMenuItem::new(TRAY_MENU_QUIT_ID.to_string(), "Quit");

    let tray_menu = SystemTrayMenu::new()
        .add_item(show)
        .add_item(hide)
        .add_native_item(tauri::SystemTrayMenuItem::Separator)
        .add_item(quit);

    SystemTray::new().with_menu(tray_menu)
}

pub fn handle_system_tray_event(app: &tauri::AppHandle, event: SystemTrayEvent) {
    match event {
        SystemTrayEvent::LeftClick { .. } => {
            toggle_main_window_visibility(app);
        }
        SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
            TRAY_MENU_SHOW_ID => {
                show_and_focus_main_window(app);
            }
            TRAY_MENU_HIDE_ID => {
                hide_main_window(app);
            }
            TRAY_MENU_QUIT_ID => {
                crate::app_runtime::request_app_exit(app);
            }
            _ => {}
        },
        _ => {}
    }
}

pub fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    crate::windows::desktop_lyrics::init();

    if let Err(error) = crate::debug_config::apply_from_disk(&app.handle()) {
        eprintln!("[debug] Failed to apply debug config: {error}");
    }

    let telemetry_policy = crate::debug_config::get_config(&app.handle())
        .map(|config| config.telemetry)
        .unwrap_or_default();
    app.manage(Arc::new(crate::telemetry::TelemetryCore::new(
        &app.handle(),
        telemetry_policy,
    )));

    if let Some(payload) = crate::app_runtime::capture_startup_host_file_open_payload() {
        crate::app_runtime::enqueue_startup_host_file_open(&app.handle(), payload);
    }

    let magnet_layout_store = crate::magnet_layout_store::MagnetLayoutStore::new(&app.handle())
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
    app.manage(magnet_layout_store);

    let window = app
        .get_window(crate::windows::MAIN_WINDOW_LABEL)
        .ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::NotFound, "Main window not found")
        })?;

    let _ = window.set_resizable(true);

    crate::app_runtime::install_live_host_file_open_bridge(&app.handle());

    #[cfg(target_os = "windows")]
    {
        use window_shadows::set_shadow;
        let _ = set_shadow(&window, false);
        if should_enable_windows_shell_integration() {
            crate::windows::taskbar_thumbbar::init_main_window(&app.handle());
            crate::windows::smtc::init(&app.handle());
        } else {
            eprintln!(
                "[windows] Shell integrations disabled in dev mode (set PMPM_ENABLE_WINDOWS_SHELL_INTEGRATION=1 to re-enable)."
            );
        }
    }

    bind_main_window_events(app, &window);

    Ok(())
}

fn bind_main_window_events(app: &tauri::App, window: &tauri::Window) {
    let app_handle = app.handle();
    let exit_flag = app.state::<crate::app_runtime::ExitFlag>().0.clone();

    window.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            if exit_flag.load(Ordering::SeqCst) {
                return;
            }
            api.prevent_close();
            let _ = app_handle.emit_all(crate::windows::EVENT_MAIN_WINDOW_CLOSE_REQUESTED, ());
        }
        tauri::WindowEvent::Focused(true) => {
            let app_handle = app_handle.clone();
            tauri::async_runtime::spawn_blocking(move || {
                std::thread::sleep(Duration::from_millis(80));
                let _ = crate::vst_runtime::raise_visible_editors_above_main(&app_handle);
            });
        }
        tauri::WindowEvent::Moved(_) => {
            crate::windows::editor::sync_style_bar_window(&app_handle);
        }
        tauri::WindowEvent::Resized(_) => {
            crate::windows::editor::sync_style_bar_window(&app_handle);
        }
        tauri::WindowEvent::ScaleFactorChanged { .. } => {
            crate::windows::editor::sync_style_bar_window(&app_handle);
        }
        _ => {}
    });
}

pub fn ensure_vst_services_initialized(app: &tauri::AppHandle) -> Result<(), String> {
    if VST_SERVICES_INITIALIZED.load(Ordering::Acquire) {
        return Ok(());
    }

    let _guard = VST_SERVICES_INIT_LOCK
        .lock()
        .map_err(|_| "VST services init lock is poisoned".to_string())?;
    if VST_SERVICES_INITIALIZED.load(Ordering::Acquire) {
        return Ok(());
    }

    crate::vst_audit::init(app)?;
    crate::vst_governance::init(app)?;
    crate::vst_library::init(app)?;
    crate::vst_compat::init(app)?;
    crate::vst_runtime::init_session_status_broadcaster(app);
    VST_SERVICES_INITIALIZED.store(true, Ordering::Release);
    Ok(())
}

pub fn ensure_music_library_services_initialized(app: &tauri::AppHandle) -> Result<(), String> {
    if MUSIC_LIBRARY_SERVICES_INITIALIZED.load(Ordering::Acquire) {
        return Ok(());
    }

    let _guard = MUSIC_LIBRARY_SERVICES_INIT_LOCK
        .lock()
        .map_err(|_| "Music library services init lock is poisoned".to_string())?;
    if MUSIC_LIBRARY_SERVICES_INITIALIZED.load(Ordering::Acquire) {
        return Ok(());
    }

    if let Err(error) = crate::music_library::cleanup_legacy_cover_cache_dirs(app) {
        eprintln!("[MusicLibrary] Failed to cleanup legacy cover caches: {error}");
    }
    crate::music_library_db::init(app)?;
    crate::music_library_sync::init(app)?;
    MUSIC_LIBRARY_SERVICES_INITIALIZED.store(true, Ordering::Release);
    Ok(())
}

fn toggle_main_window_visibility(app: &tauri::AppHandle) {
    if let Some(window) = app.get_window(crate::windows::MAIN_WINDOW_LABEL) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
            let _ = app.emit_all(crate::windows::EVENT_MAIN_WINDOW_HIDDEN, ());
        } else {
            let _ = window.show();
            let _ = window.set_focus();
            let _ = app.emit_all(crate::windows::EVENT_MAIN_WINDOW_SHOWN, ());
        }
    }
}

fn show_and_focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_window(crate::windows::MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit_all(crate::windows::EVENT_MAIN_WINDOW_SHOWN, ());
    }
}

fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_window(crate::windows::MAIN_WINDOW_LABEL) {
        let _ = window.hide();
        let _ = app.emit_all(crate::windows::EVENT_MAIN_WINDOW_HIDDEN, ());
    }
}
