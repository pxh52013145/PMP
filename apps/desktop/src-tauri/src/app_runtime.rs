use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use once_cell::sync::OnceCell;
use tauri::Manager;

pub struct ExitFlag(pub Arc<AtomicBool>);

impl ExitFlag {
    pub fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }
}

pub struct EditorEffectsState {
    pub blur_enabled: Arc<AtomicBool>,
}

impl EditorEffectsState {
    pub fn new(blur_enabled: bool) -> Self {
        Self {
            blur_enabled: Arc::new(AtomicBool::new(blur_enabled)),
        }
    }
}

pub fn request_app_exit(app: &tauri::AppHandle) {
    static EXIT_REQUESTED: OnceCell<()> = OnceCell::new();
    if EXIT_REQUESTED.set(()).is_err() {
        app.exit(0);
        return;
    }

    eprintln!("[App] Exit requested");
    let exit_flag = app.state::<ExitFlag>().0.clone();
    exit_flag.store(true, Ordering::SeqCst);

    let exit_flag_for_watchdog = exit_flag.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(4));
        if exit_flag_for_watchdog.load(Ordering::SeqCst) {
            eprintln!("[App] Exit watchdog: forcing process exit");
            std::process::exit(0);
        }
    });

    crate::audio::shutdown();
    crate::native_audio::shutdown();
    crate::windows::desktop_lyrics::shutdown();
    crate::vst_runtime::shutdown_session_status_broadcaster();
    if let Err(error) = crate::music_platform_bilibili::cleanup_session_cover_cache(app) {
        eprintln!("[MusicLibrary] Failed to cleanup Bilibili session cover cache: {error}");
    }

    crate::windows::editor::close_all_editor_windows(app);
    crate::windows::plugin::close_all_plugin_windows(app);
    crate::windows::vst_manager::close_all_vst_manager_windows(app);
    crate::vst_runtime::close_all();

    let backend = match crate::audio::engine::ENGINE.lock() {
        Ok(mut engine) => {
            engine.stop();
            Some(engine.output_backend())
        }
        Err(poisoned) => {
            let mut engine = poisoned.into_inner();
            engine.stop();
            Some(engine.output_backend())
        }
    };
    if let Some(backend) = backend {
        backend.close_stream();
    }

    app.exit(0);
}
