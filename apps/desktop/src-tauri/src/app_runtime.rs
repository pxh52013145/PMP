use std::collections::{HashSet, VecDeque};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use once_cell::sync::OnceCell;
use serde::Serialize;
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostFileOpenPayload {
    pub paths: Vec<String>,
    pub source: String,
    pub action: Option<String>,
    pub received_at_ms: u64,
}

#[derive(Default)]
pub struct HostFileOpenState {
    pending: Mutex<VecDeque<HostFileOpenPayload>>,
}

impl HostFileOpenState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn enqueue(&self, payload: HostFileOpenPayload) -> usize {
        let mut pending = lock_host_file_open_queue(&self.pending);
        pending.push_back(payload);
        pending.len()
    }

    pub fn consume_pending(&self) -> Vec<HostFileOpenPayload> {
        let mut pending = lock_host_file_open_queue(&self.pending);
        pending.drain(..).collect()
    }
}

pub fn capture_startup_host_file_open_payload() -> Option<HostFileOpenPayload> {
    let paths = collect_startup_host_file_paths(std::env::args_os().skip(1));
    if paths.is_empty() {
        return None;
    }

    Some(HostFileOpenPayload {
        paths,
        source: "cli-startup".to_string(),
        action: Some("startup-opened".to_string()),
        received_at_ms: now_ms(),
    })
}

fn collect_startup_host_file_paths<I>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = std::ffi::OsString>,
{
    let mut seen = HashSet::<String>::new();
    let mut paths = Vec::new();

    for arg in args {
        let Some(path) = normalize_host_file_open_arg(arg.as_os_str()) else {
            continue;
        };

        if seen.insert(path.clone()) {
            paths.push(path);
        }
    }

    paths
}

fn normalize_host_file_open_arg(value: &OsStr) -> Option<String> {
    let raw = value.to_string_lossy();
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let path = parse_host_file_open_path(trimmed)?;
    if !path.exists() {
        return None;
    }

    let resolved = std::fs::canonicalize(&path).unwrap_or(path);
    Some(normalize_host_file_open_path(&resolved))
}

fn parse_host_file_open_path(value: &str) -> Option<PathBuf> {
    if value.to_ascii_lowercase().starts_with("file://") {
        let url = url::Url::parse(value).ok()?;
        return url.to_file_path().ok();
    }

    if let Some(stripped) = value.strip_prefix(r"\\?\") {
        return Some(PathBuf::from(stripped));
    }

    Some(PathBuf::from(value))
}

fn normalize_host_file_open_path(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    normalized
        .strip_prefix("//?/")
        .map(|value| value.to_string())
        .unwrap_or(normalized)
}

fn lock_host_file_open_queue(
    queue: &Mutex<VecDeque<HostFileOpenPayload>>,
) -> std::sync::MutexGuard<'_, VecDeque<HostFileOpenPayload>> {
    match queue.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
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
    crate::windows::plugin_shell_surface::close_all_plugin_shell_surfaces(app);
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

#[cfg(test)]
mod tests {
    use super::{
        capture_startup_host_file_open_payload, collect_startup_host_file_paths,
        HostFileOpenPayload, HostFileOpenState,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn create_temp_dir(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "pmp-host-file-open-{label}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    fn write_file(path: &Path) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(path, b"demo").expect("write file");
    }

    #[test]
    fn collects_existing_startup_host_file_paths_from_paths_and_file_urls() {
        let root = create_temp_dir("paths");
        let manifest_path = root.join("manifest.v2.json");
        let asset_path = root.join("nested").join("demo.pmpm");
        write_file(&manifest_path);
        write_file(&asset_path);

        let asset_url = url::Url::from_file_path(&asset_path)
            .expect("file url")
            .to_string();

        let paths = collect_startup_host_file_paths(vec![
            manifest_path.as_os_str().to_os_string(),
            asset_url.into(),
        ]);

        assert_eq!(paths.len(), 2);
        assert!(paths[0].ends_with("/manifest.v2.json"));
        assert!(paths[1].ends_with("/nested/demo.pmpm"));

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn ignores_missing_or_duplicate_startup_host_file_paths() {
        let root = create_temp_dir("dedupe");
        let manifest_path = root.join("manifest.v2.json");
        write_file(&manifest_path);

        let manifest_url = url::Url::from_file_path(&manifest_path)
            .expect("file url")
            .to_string();

        let missing = root.join("missing.json");
        let paths = collect_startup_host_file_paths(vec![
            "--flag".into(),
            missing.as_os_str().to_os_string(),
            manifest_path.as_os_str().to_os_string(),
            manifest_url.into(),
        ]);

        assert_eq!(paths.len(), 1);
        assert!(paths[0].ends_with("/manifest.v2.json"));

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn host_file_open_state_drains_pending_payloads() {
        let state = HostFileOpenState::new();

        let queued = state.enqueue(HostFileOpenPayload {
            paths: vec!["C:/demo/manifest.v2.json".to_string()],
            source: "cli-startup".to_string(),
            action: Some("startup-opened".to_string()),
            received_at_ms: 1,
        });
        assert_eq!(queued, 1);

        let pending = state.consume_pending();
        assert_eq!(
            pending,
            vec![HostFileOpenPayload {
                paths: vec!["C:/demo/manifest.v2.json".to_string()],
                source: "cli-startup".to_string(),
                action: Some("startup-opened".to_string()),
                received_at_ms: 1,
            }]
        );
        assert!(state.consume_pending().is_empty());
    }

    #[test]
    fn capture_startup_payload_uses_cli_startup_defaults() {
        let payload = capture_startup_host_file_open_payload();
        if let Some(payload) = payload {
            assert_eq!(payload.source, "cli-startup");
            assert_eq!(payload.action.as_deref(), Some("startup-opened"));
            assert!(payload.received_at_ms > 0);
        }
    }
}
