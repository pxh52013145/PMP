use std::collections::{HashSet, VecDeque};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::Manager;

const HOST_FILE_OPEN_SOURCE_STARTUP: &str = "cli-startup";
const HOST_FILE_OPEN_SOURCE_OS_REOPEN: &str = "os-reopen";
const HOST_FILE_OPEN_ACTION_STARTUP: &str = "startup-opened";
const HOST_FILE_OPEN_ACTION_OS_REOPEN: &str = "reopened";
const DEV_RESTART_EXIT_CODE_ENV: &str = "PMP_TAURI_DEV_RESTART_EXIT_CODE";
const DEV_RESTART_SIGNAL_ENV: &str = "PMP_TAURI_DEV_RESTART_SIGNAL";

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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
    capture_host_file_open_payload(
        std::env::args_os().skip(1),
        HOST_FILE_OPEN_SOURCE_STARTUP,
        Some(HOST_FILE_OPEN_ACTION_STARTUP),
    )
}

pub fn capture_os_reopen_host_file_open_payload() -> Option<HostFileOpenPayload> {
    capture_host_file_open_payload(
        std::env::args_os().skip(1),
        HOST_FILE_OPEN_SOURCE_OS_REOPEN,
        Some(HOST_FILE_OPEN_ACTION_OS_REOPEN),
    )
}

fn capture_host_file_open_payload<I>(
    args: I,
    source: &str,
    action: Option<&str>,
) -> Option<HostFileOpenPayload>
where
    I: IntoIterator<Item = std::ffi::OsString>,
{
    let paths = collect_host_file_open_paths(args);
    if paths.is_empty() {
        return None;
    }

    Some(HostFileOpenPayload {
        paths,
        source: source.to_string(),
        action: action.map(|value| value.to_string()),
        received_at_ms: now_ms(),
    })
}

fn collect_host_file_open_paths<I>(args: I) -> Vec<String>
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

fn enqueue_host_file_open_payload(
    app: &tauri::AppHandle,
    payload: HostFileOpenPayload,
    telemetry_event: &str,
    emit_signal: bool,
) -> usize {
    let source = payload.source.clone();
    let action = payload.action.clone();
    let path_count = payload.paths.len();
    let queued_batch_count = app.state::<HostFileOpenState>().enqueue(payload);

    if emit_signal {
        let _ = app.emit_all(crate::windows::EVENT_HOST_FILE_OPENED, ());
    }

    crate::backend_telemetry::info(
        app,
        "startup",
        telemetry_event,
        crate::backend_telemetry::BackendTelemetryOptions::new()
            .component("HostFileOpenState")
            .field("source", json!(source))
            .field("action", json!(action))
            .field("pathCount", json!(path_count))
            .field("queuedBatchCount", json!(queued_batch_count)),
    );

    queued_batch_count
}

pub fn enqueue_startup_host_file_open(
    app: &tauri::AppHandle,
    payload: HostFileOpenPayload,
) -> usize {
    enqueue_host_file_open_payload(
        app,
        payload,
        "startup.host-file-open.pending.enqueued",
        false,
    )
}

pub fn enqueue_live_host_file_open(app: &tauri::AppHandle, payload: HostFileOpenPayload) -> usize {
    crate::windows::focus_main_window_if_needed(app);
    enqueue_host_file_open_payload(app, payload, "startup.host-file-open.live.enqueued", true)
}

pub fn install_live_host_file_open_bridge(app: &tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    live_host_file_open_bridge::install(app);

    #[cfg(not(target_os = "windows"))]
    let _ = app;
}

pub fn forward_live_host_file_open_to_running_instance_if_any() -> bool {
    #[cfg(target_os = "windows")]
    {
        return live_host_file_open_bridge::forward_to_running_instance_if_any();
    }

    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

pub fn read_dev_restart_exit_code() -> Option<i32> {
    let raw = std::env::var(DEV_RESTART_EXIT_CODE_ENV).ok()?;
    let code = raw.trim().parse::<i32>().ok()?;
    if (1..=254).contains(&code) {
        Some(code)
    } else {
        None
    }
}

pub fn write_dev_restart_signal() -> Result<bool, String> {
    let raw = match std::env::var(DEV_RESTART_SIGNAL_ENV) {
        Ok(value) => value,
        Err(_) => return Ok(false),
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(false);
    }

    let path = PathBuf::from(trimmed);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(&path, b"restart").map_err(|error| error.to_string())?;
    Ok(true)
}

pub fn request_app_exit(app: &tauri::AppHandle) {
    request_app_exit_with_code(app, 0);
}

pub fn request_app_exit_with_code(app: &tauri::AppHandle, exit_code: i32) {
    static EXIT_REQUESTED: OnceCell<()> = OnceCell::new();
    if EXIT_REQUESTED.set(()).is_err() {
        app.exit(exit_code);
        return;
    }

    crate::backend_telemetry::info(
        app,
        "app",
        "app.exit.requested",
        crate::backend_telemetry::BackendTelemetryOptions::new()
            .component("app_runtime")
            .field("exitCode", serde_json::json!(exit_code)),
    );
    let exit_flag = app.state::<ExitFlag>().0.clone();
    exit_flag.store(true, Ordering::SeqCst);

    let exit_flag_for_watchdog = exit_flag.clone();
    let app_for_watchdog = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(4));
        if exit_flag_for_watchdog.load(Ordering::SeqCst) {
            crate::backend_telemetry::fatal(
                &app_for_watchdog,
                "app",
                "app.exit.watchdog.force-exit",
                crate::backend_telemetry::BackendTelemetryOptions::new()
                    .component("app_runtime")
                    .message("Exit watchdog forced process exit after timeout."),
            );
            std::process::exit(exit_code);
        }
    });

    crate::audio::shutdown();
    crate::native_audio::shutdown();
    crate::windows::desktop_lyrics::shutdown();
    crate::vst_runtime::shutdown_session_status_broadcaster();
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

    app.exit(exit_code);
}

#[cfg(target_os = "windows")]
mod live_host_file_open_bridge {
    use super::{
        capture_os_reopen_host_file_open_payload, enqueue_live_host_file_open, HostFileOpenPayload,
    };
    use once_cell::sync::{Lazy, OnceCell};
    use std::{collections::HashMap, mem, sync::Mutex};
    use tauri::{AppHandle, Manager};
    use windows::{
        core::{w, PCWSTR},
        Win32::{
            Foundation::{HWND, LPARAM, LRESULT, WPARAM},
            System::DataExchange::COPYDATASTRUCT,
            UI::WindowsAndMessaging::{
                CallWindowProcW, DefWindowProcW, FindWindowW, GetWindowLongPtrW,
                SendMessageTimeoutW, SetWindowLongPtrW, GWLP_WNDPROC, SMTO_ABORTIFHUNG,
                WM_COPYDATA, WNDPROC,
            },
        },
    };

    const HOST_FILE_OPEN_COPYDATA_KIND: usize = 0x504D_5048;
    const MAX_COPYDATA_BYTES: usize = 256 * 1024;
    const SEND_TIMEOUT_MS: u32 = 1_500;

    static APP_HANDLE: OnceCell<AppHandle> = OnceCell::new();

    #[derive(Default)]
    struct WndProcRegistry {
        original: HashMap<isize, isize>,
    }

    static WNDPROCS: Lazy<Mutex<WndProcRegistry>> =
        Lazy::new(|| Mutex::new(WndProcRegistry::default()));

    fn try_read_payload(copy_data: &COPYDATASTRUCT) -> Option<HostFileOpenPayload> {
        if copy_data.dwData != HOST_FILE_OPEN_COPYDATA_KIND {
            return None;
        }
        if copy_data.cbData <= 0 || copy_data.lpData.is_null() {
            return None;
        }

        let byte_len = copy_data.cbData as usize;
        if byte_len > MAX_COPYDATA_BYTES {
            return None;
        }

        let bytes = unsafe { std::slice::from_raw_parts(copy_data.lpData as *const u8, byte_len) };
        serde_json::from_slice::<HostFileOpenPayload>(bytes).ok()
    }

    unsafe extern "system" fn wnd_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == WM_COPYDATA {
            let copy_data_ptr = lparam.0 as *const COPYDATASTRUCT;
            if !copy_data_ptr.is_null() {
                let copy_data = &*copy_data_ptr;
                if let Some(payload) = try_read_payload(copy_data) {
                    if let Some(app) = APP_HANDLE.get() {
                        enqueue_live_host_file_open(app, payload);
                    }
                    return LRESULT(1);
                }
            }
        }

        let original = {
            let registry = WNDPROCS.lock().ok();
            registry
                .and_then(|r| r.original.get(&(hwnd.0 as isize)).copied())
                .unwrap_or(0)
        };
        if original == 0 {
            return DefWindowProcW(hwnd, msg, wparam, lparam);
        }

        CallWindowProcW(
            mem::transmute::<isize, WNDPROC>(original),
            hwnd,
            msg,
            wparam,
            lparam,
        )
    }

    pub fn install(app: &AppHandle) {
        let _ = APP_HANDLE.set(app.clone());

        let Some(window) = app.get_window(crate::windows::MAIN_WINDOW_LABEL) else {
            return;
        };
        let Ok(hwnd) = window.hwnd() else {
            return;
        };

        unsafe {
            let hwnd_raw = HWND(hwnd.0 as isize);
            let mut registry = match WNDPROCS.lock() {
                Ok(registry) => registry,
                Err(_) => return,
            };

            if registry.original.contains_key(&(hwnd_raw.0 as isize)) {
                return;
            }

            let original = GetWindowLongPtrW(hwnd_raw, GWLP_WNDPROC);
            registry.original.insert(hwnd_raw.0 as isize, original);
            drop(registry);

            let _ = SetWindowLongPtrW(hwnd_raw, GWLP_WNDPROC, wnd_proc as isize);
        }
    }

    pub fn forward_to_running_instance_if_any() -> bool {
        let Some(payload) = capture_os_reopen_host_file_open_payload() else {
            return false;
        };

        let bytes = match serde_json::to_vec(&payload) {
            Ok(bytes) if !bytes.is_empty() => bytes,
            _ => return false,
        };

        let target = unsafe { FindWindowW(PCWSTR::null(), w!("Pixel Matrix Player")) };
        if target.0 == 0 {
            return false;
        }

        let copy_data = COPYDATASTRUCT {
            dwData: HOST_FILE_OPEN_COPYDATA_KIND,
            cbData: bytes.len() as u32,
            lpData: bytes.as_ptr() as *mut _,
        };
        let mut result = 0usize;
        let sent = unsafe {
            SendMessageTimeoutW(
                target,
                WM_COPYDATA,
                WPARAM(0),
                LPARAM((&copy_data as *const COPYDATASTRUCT) as isize),
                SMTO_ABORTIFHUNG,
                SEND_TIMEOUT_MS,
                Some(&mut result),
            )
        };

        sent.0 != 0 && result != 0
    }
}

#[cfg(test)]
mod tests {
    use super::{
        capture_os_reopen_host_file_open_payload, capture_startup_host_file_open_payload,
        collect_host_file_open_paths, HostFileOpenPayload, HostFileOpenState,
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

        let paths = collect_host_file_open_paths(vec![
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
        let paths = collect_host_file_open_paths(vec![
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

    #[test]
    fn capture_os_reopen_payload_uses_live_defaults() {
        let payload = capture_os_reopen_host_file_open_payload();
        if let Some(payload) = payload {
            assert_eq!(payload.source, "os-reopen");
            assert_eq!(payload.action.as_deref(), Some("reopened"));
            assert!(payload.received_at_ms > 0);
        }
    }
}
