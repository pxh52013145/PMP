use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::{
    collections::HashSet,
    io::{Read, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, ExitStatus, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant, SystemTime},
};

#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow;

pub const BRIDGE_PROTOCOL_VERSION: u32 = 1;

pub const MSG_SET_PARAMS: u8 = 1;
pub const MSG_OPEN_EDITOR: u8 = 3;
pub const MSG_CLOSE_EDITOR: u8 = 4;
pub const MSG_PING: u8 = 5;
#[allow(dead_code)]
pub const MSG_SCAN_PLUGINS: u8 = 6;
#[allow(dead_code)]
pub const MSG_DESCRIBE_PLUGIN: u8 = 7;
pub const MSG_GET_PARAMS: u8 = 8;
#[allow(dead_code)]
pub const MSG_INSTANTIATE: u8 = 9;
pub const MSG_DISPOSE: u8 = 10;
pub const MSG_ERROR: u8 = 255;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeParamDescriptor {
    pub key: String,
    pub title: String,
    pub min: f32,
    pub max: f32,
    pub default: f32,
    pub step: f32,
    pub unit: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgePluginDescriptor {
    pub id: String,
    pub name: String,
    pub vendor: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub input_channels: Option<u32>,
    #[serde(default)]
    pub output_channels: Option<u32>,
    pub parameters: Vec<BridgeParamDescriptor>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeParamValue {
    pub key: String,
    pub value: f32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeRealtimeMetrics {
    #[serde(default)]
    pub callback_lock_miss_blocks: u64,
    #[serde(default)]
    pub callback_lock_miss_frames: u64,
    #[serde(default)]
    pub dry_bypass_frames: u64,
    #[serde(default)]
    pub shm_output_backpressure_blocks: u64,
    #[serde(default)]
    pub shm_output_backpressure_frames: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgePingResponse {
    pub protocol_version: u32,
    pub plugin_id: Option<String>,
    #[serde(default)]
    pub editor_open: Option<bool>,
    #[serde(default)]
    pub metrics: Option<BridgeRealtimeMetrics>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeGetParamsResponse {
    pub protocol_version: u32,
    pub params: Vec<BridgeParamValue>,
}

struct BridgeRequest {
    ty: u8,
    payload: Vec<u8>,
    response_tx: mpsc::Sender<Result<(u8, Vec<u8>), String>>,
}

fn timeout_from_env_ms(key: &str, default_ms: u64) -> Duration {
    std::env::var(key)
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .map(Duration::from_millis)
        .unwrap_or_else(|| Duration::from_millis(default_ms))
}

fn is_scanner_command(args: &[String]) -> bool {
    if args.iter().any(|arg| arg == "--list-plugins") {
        return true;
    }
    if args.iter().any(|arg| arg == "--describe-plugin") {
        // When --plugin-path is not provided, the sidecar may scan default paths, which can hang/crash.
        return !args.iter().any(|arg| arg == "--plugin-path");
    }
    false
}

fn scanner_stall_timeout() -> Duration {
    // If the sidecar's JUCE PluginDirectoryScanner stops advancing the dead-man pedal file for
    // too long, assume the scan is stuck and kill the process so we can retry (the dead-man pedal
    // will cause JUCE to skip the problematic plugin next time).
    timeout_from_env_ms("PMP_VST_BRIDGE_SCAN_STALL_TIMEOUT_MS", 30_000)
}

#[cfg(target_os = "windows")]
fn scanner_deadman_file_path() -> Option<PathBuf> {
    // Must match sidecar: juce::File::userApplicationDataDirectory/PixelMatrixPlayer/vst3_scanner_deadman.txt
    std::env::var("APPDATA").ok().map(|dir| {
        PathBuf::from(dir)
            .join("PixelMatrixPlayer")
            .join("vst3_scanner_deadman.txt")
    })
}

#[cfg(not(target_os = "windows"))]
fn scanner_deadman_file_path() -> Option<PathBuf> {
    None
}

fn read_scanner_deadman_hint() -> Option<String> {
    let path = scanner_deadman_file_path()?;
    let data = std::fs::read(&path).ok()?;
    let raw = String::from_utf8_lossy(&data);
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn bridge_list_timeout() -> Duration {
    timeout_from_env_ms("PMP_VST_BRIDGE_LIST_TIMEOUT_MS", 60_000)
}

fn bridge_describe_timeout() -> Duration {
    timeout_from_env_ms("PMP_VST_BRIDGE_DESCRIBE_TIMEOUT_MS", 20_000)
}

static FIRST_BRIDGE_CLI_DESCRIBE: AtomicBool = AtomicBool::new(true);

fn describe_timeout_with_cold_start_boost(base: Duration) -> Duration {
    if FIRST_BRIDGE_CLI_DESCRIBE.load(Ordering::Relaxed) {
        base.max(Duration::from_millis(60_000))
    } else {
        base
    }
}

fn mark_cli_describe_warmed() {
    FIRST_BRIDGE_CLI_DESCRIBE.store(false, Ordering::Relaxed);
}

fn bridge_request_timeout() -> Duration {
    timeout_from_env_ms("PMP_VST_BRIDGE_REQUEST_TIMEOUT_MS", 2_500)
}

fn bridge_editor_timeout() -> Duration {
    timeout_from_env_ms("PMP_VST_BRIDGE_EDITOR_TIMEOUT_MS", 30_000)
}

#[derive(Clone, Copy, Debug)]
pub struct BridgeOpenEditorOptions {
    pub pinned: bool,
    pub bring_only: bool,
    pub show: bool,
    pub activate: bool,
}

impl Default for BridgeOpenEditorOptions {
    fn default() -> Self {
        Self {
            pinned: true,
            bring_only: false,
            show: true,
            activate: true,
        }
    }
}

#[allow(dead_code)]
fn bridge_ping_timeout() -> Duration {
    timeout_from_env_ms("PMP_VST_BRIDGE_PING_TIMEOUT_MS", 5_000)
}

fn bridge_executable_path() -> Result<PathBuf, String> {
    if let Ok(raw) = std::env::var("PMP_VST_BRIDGE_EXE") {
        let candidate = PathBuf::from(raw.trim());
        if candidate.exists() {
            return Ok(candidate);
        }
        return Err(format!(
            "PMP_VST_BRIDGE_EXE points to missing file: {}",
            candidate.display()
        ));
    }

    let exe = std::env::current_exe().map_err(|e| format!("Failed to resolve current exe: {e}"))?;
    let mut dir = exe
        .parent()
        .ok_or_else(|| "Failed to resolve current exe directory".to_string())?
        .to_path_buf();
    if dir
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("deps"))
        .unwrap_or(false)
    {
        dir.pop();
    }
    let file_name = if cfg!(windows) {
        "pmp-vst-bridge.exe"
    } else {
        "pmp-vst-bridge"
    };
    let local_candidate = dir.join(file_name);

    // Dev-friendly fallback: scripts/prepare-sidecars.mjs writes to `apps/desktop/src-tauri/binaries/`.
    // When running via `cargo tauri dev`, the app exe is typically under `src-tauri/target/{debug|release}`.
    let mut tauri_dir = dir.clone();
    if tauri_dir
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("debug") || name.eq_ignore_ascii_case("release"))
        .unwrap_or(false)
    {
        tauri_dir.pop();
    }
    if tauri_dir
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("target"))
        .unwrap_or(false)
    {
        tauri_dir.pop();
    }

    let binaries_file_name = if cfg!(windows) {
        "pmp-vst-bridge-x86_64-pc-windows-msvc.exe"
    } else {
        "pmp-vst-bridge"
    };
    let binaries_candidate = tauri_dir.join("binaries").join(binaries_file_name);

    let pick_newer = |a: &PathBuf, b: &PathBuf| -> PathBuf {
        let a_time = std::fs::metadata(a).and_then(|m| m.modified()).ok();
        let b_time = std::fs::metadata(b).and_then(|m| m.modified()).ok();
        match (a_time, b_time) {
            (Some(a_time), Some(b_time)) if b_time > a_time => b.clone(),
            _ => a.clone(),
        }
    };

    let resolved = match (local_candidate.exists(), binaries_candidate.exists()) {
        (true, true) => pick_newer(&local_candidate, &binaries_candidate),
        (true, false) => local_candidate,
        (false, true) => binaries_candidate,
        (false, false) => {
            return Err(format!(
                "Bridge executable not found. Tried: {} and {}. You can override via PMP_VST_BRIDGE_EXE",
                local_candidate.display(),
                binaries_candidate.display()
            ));
        }
    };

    if matches!(std::env::var("PMP_VST_BRIDGE_DEBUG").as_deref(), Ok("1"))
        || matches!(std::env::var("PMP_VST_BRIDGE_STDERR").as_deref(), Ok("1"))
    {
        eprintln!("[VST] Using bridge executable: {}", resolved.display());
    }

    Ok(resolved)
}

struct BridgeOutput {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

fn run_bridge_cli_cancellable_dynamic(
    args: Vec<String>,
    timeout: Duration,
    cancel: Option<&AtomicBool>,
) -> Result<BridgeOutput, String> {
    let bridge = bridge_executable_path()?;

    let watch_scanner_progress = is_scanner_command(&args);
    let deadman_path = watch_scanner_progress
        .then(scanner_deadman_file_path)
        .flatten();
    let stall_timeout = watch_scanner_progress.then(scanner_stall_timeout);
    let mut last_deadman_mtime: Option<SystemTime> = None;
    let mut last_deadman_progress_at = Instant::now();
    let mut saw_deadman = false;

    let mut cmd = Command::new(bridge);
    cmd.args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // The bridge sidecar is a console subsystem executable. When spawned from a GUI app without a
    // parent console, Windows may create a new console window ("black box" popup). Suppress that
    // by default for all CLI invocations.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn bridge: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open bridge stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to open bridge stderr".to_string())?;

    let (stdout_tx, stdout_rx) = mpsc::channel::<Vec<u8>>();
    thread::spawn(move || {
        let mut buf = Vec::new();
        let mut reader = std::io::BufReader::new(stdout);
        let _ = reader.read_to_end(&mut buf);
        let _ = stdout_tx.send(buf);
    });

    let (stderr_tx, stderr_rx) = mpsc::channel::<Vec<u8>>();
    thread::spawn(move || {
        let mut buf = Vec::new();
        let mut reader = std::io::BufReader::new(stderr);
        let _ = reader.read_to_end(&mut buf);
        let _ = stderr_tx.send(buf);
    });

    let start = Instant::now();
    let status = loop {
        if let Some(cancel) = cancel {
            if cancel.load(Ordering::Acquire) {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Bridge command cancelled".to_string());
            }
        }

        if let Some(path) = deadman_path.as_ref() {
            if let Ok(meta) = std::fs::metadata(path) {
                saw_deadman = true;
                if let Ok(modified) = meta.modified() {
                    if last_deadman_mtime
                        .map(|prev| prev != modified)
                        .unwrap_or(true)
                    {
                        last_deadman_mtime = Some(modified);
                        last_deadman_progress_at = Instant::now();
                    }
                }
            }
        }

        if saw_deadman {
            if let Some(stall_timeout) = stall_timeout {
                if last_deadman_progress_at.elapsed() >= stall_timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    let hint = read_scanner_deadman_hint()
                        .map(|v| format!(" (deadman={v})"))
                        .unwrap_or_default();
                    return Err(format!(
                        "Bridge scanner stalled after {}ms: {}{}",
                        stall_timeout.as_millis(),
                        args.join(" "),
                        hint
                    ));
                }
            }
        }

        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(err) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Failed to poll bridge process: {err}"));
            }
        }

        if start.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            let hint = if watch_scanner_progress {
                read_scanner_deadman_hint()
                    .map(|v| format!(" (deadman={v})"))
                    .unwrap_or_default()
            } else {
                String::new()
            };
            return Err(format!(
                "Bridge command timed out after {}ms: {}{}",
                timeout.as_millis(),
                args.join(" "),
                hint
            ));
        }

        thread::sleep(Duration::from_millis(20));
    };

    let stdout = stdout_rx
        .recv_timeout(Duration::from_secs(1))
        .unwrap_or_else(|_| Vec::new());
    let stderr = stderr_rx
        .recv_timeout(Duration::from_secs(1))
        .unwrap_or_else(|_| Vec::new());

    Ok(BridgeOutput {
        status,
        stdout,
        stderr,
    })
}

pub fn list_plugins() -> Result<Vec<BridgePluginDescriptor>, String> {
    list_plugins_with_cancel(None)
}

pub fn describe_plugin(plugin_id: &str) -> Result<BridgePluginDescriptor, String> {
    describe_plugin_with_cancel(plugin_id, None)
}

pub fn list_plugins_with_cancel(
    cancel: Option<&AtomicBool>,
) -> Result<Vec<BridgePluginDescriptor>, String> {
    list_plugins_with_scan_paths_with_cancel(&[], false, cancel)
}

pub fn list_plugins_with_scan_paths_with_cancel(
    scan_paths: &[String],
    include_default_paths: bool,
    cancel: Option<&AtomicBool>,
) -> Result<Vec<BridgePluginDescriptor>, String> {
    let mut args = vec!["--list-plugins".to_string()];
    if include_default_paths {
        args.push("--include-default-paths".to_string());
    }
    append_scan_paths(&mut args, scan_paths);
    let output = run_bridge_cli_cancellable_dynamic(args, bridge_list_timeout(), cancel)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Bridge list failed: {stderr}"));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse bridge plugins: {e}"))
}

pub fn describe_plugin_with_cancel(
    plugin_id: &str,
    cancel: Option<&AtomicBool>,
) -> Result<BridgePluginDescriptor, String> {
    describe_plugin_with_scan_paths_with_cancel(plugin_id, None, &[], false, cancel)
}

pub fn describe_plugin_with_scan_paths_with_cancel(
    plugin_id: &str,
    plugin_path: Option<&str>,
    scan_paths: &[String],
    include_default_paths: bool,
    cancel: Option<&AtomicBool>,
) -> Result<BridgePluginDescriptor, String> {
    let mut args = vec!["--describe-plugin".to_string(), plugin_id.to_string()];
    if let Some(path) = plugin_path {
        if !path.trim().is_empty() {
            args.push("--plugin-path".to_string());
            args.push(path.to_string());
        }
    }
    if include_default_paths {
        args.push("--include-default-paths".to_string());
    }
    append_scan_paths(&mut args, scan_paths);
    let output = run_bridge_cli_cancellable_dynamic(
        args,
        describe_timeout_with_cold_start_boost(bridge_describe_timeout()),
        cancel,
    )?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Bridge describe failed: {stderr}"));
    }
    let descriptor = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse bridge plugin descriptor: {e}"))?;
    mark_cli_describe_warmed();
    Ok(descriptor)
}

fn append_scan_paths(args: &mut Vec<String>, scan_paths: &[String]) {
    let mut seen = HashSet::<String>::new();
    for raw in scan_paths
        .iter()
        .map(|path| path.trim())
        .filter(|path| !path.is_empty())
    {
        let key = raw.to_lowercase();
        if !seen.insert(key) {
            continue;
        }
        args.push("--scan-path".to_string());
        args.push(raw.to_string());
    }
}

pub struct BridgeClient {
    child: Child,
    request_tx: Option<mpsc::Sender<BridgeRequest>>,
    worker: Option<thread::JoinHandle<()>>,
}

impl BridgeClient {
    pub fn spawn(
        plugin_id: &str,
        plugin_path: &str,
        sample_rate: u32,
        channels: usize,
        shm_in: Option<&str>,
        shm_out: Option<&str>,
        sidechain_mode: crate::vst_settings::VstSidechainMode,
        sidechain_channels: u32,
    ) -> Result<Self, String> {
        let bridge = bridge_executable_path()?;
        let debug_stderr = matches!(std::env::var("PMP_RACK_VST3_DEBUG").as_deref(), Ok("1"))
            || matches!(std::env::var("PMP_VST_BRIDGE_DEBUG").as_deref(), Ok("1"))
            || matches!(std::env::var("PMP_VST_BRIDGE_STDERR").as_deref(), Ok("1"));
        let mut cmd = Command::new(bridge);

        let compat = crate::vst_compat::effective_rule(plugin_id);

        // The bridge sidecar is a console subsystem executable. When spawned from a GUI app without a
        // parent console, Windows may create a new console window ("black box" popup). Suppress that
        // by default unless we're explicitly inheriting stderr for debugging.
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;

            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            if !debug_stderr {
                cmd.creation_flags(CREATE_NO_WINDOW);
            }
        }

        // Default to the more compatible editor window flow unless explicitly overridden.
        // This avoids Windows popup/temporary window edge cases ("flash then disappear") on some hosts/plugins.
        // Use PMP_VST_EDITOR_SAFE_MODE=0 to opt out.
        if std::env::var("PMP_VST_EDITOR_SAFE_MODE").is_err() {
            cmd.env(
                "PMP_VST_EDITOR_SAFE_MODE",
                if compat.editor_safe_mode { "1" } else { "0" },
            );
        }

        // Stability-first default: load/init the plugin on the JUCE message thread.
        // Many VST3s may touch COM/OLE/UI during initialization; doing this work on the message
        // thread tends to be the most compatible option.
        // Use PMP_VST_LOAD_ON_UI_THREAD=0 to opt out.
        if std::env::var("PMP_VST_LOAD_ON_UI_THREAD").is_err() {
            cmd.env(
                "PMP_VST_LOAD_ON_UI_THREAD",
                if compat.load_on_ui_thread { "1" } else { "0" },
            );
        }

        if std::env::var("PMP_VST_MONO_INPUT").is_err()
            && compat.mono_input == crate::vst_compat::VstMonoInputPolicy::LeftOnly
        {
            cmd.env("PMP_VST_MONO_INPUT", "left");
        }

        if std::env::var("PMP_VST_SIDECHAIN_MODE").is_err() {
            let value = match sidechain_mode {
                crate::vst_settings::VstSidechainMode::Disabled => "disabled",
                crate::vst_settings::VstSidechainMode::Silence => "silence",
                crate::vst_settings::VstSidechainMode::SelfFeed => "self",
            };
            cmd.env("PMP_VST_SIDECHAIN_MODE", value);
        }

        if std::env::var("PMP_VST_BRIDGE_SHM_SIDECHAIN_CHANNELS").is_err() {
            cmd.env(
                "PMP_VST_BRIDGE_SHM_SIDECHAIN_CHANNELS",
                sidechain_channels.min(2).to_string(),
            );
        }

        cmd.arg("--plugin-id")
            .arg(plugin_id)
            .arg("--plugin-path")
            .arg(plugin_path)
            .arg("--sample-rate")
            .arg(sample_rate.to_string())
            .arg("--channels")
            .arg(channels.to_string());

        if let (Some(shm_in), Some(shm_out)) = (shm_in, shm_out) {
            let shm_mode_raw = std::env::var("PMP_VST_BRIDGE_SHM_AUDIO_MODE")
                .unwrap_or_else(|_| "process".to_string());
            let shm_mode = match shm_mode_raw.as_str() {
                "bypass" | "process" => shm_mode_raw,
                _ => "process".to_string(),
            };

            cmd.arg("--shm-in")
                .arg(shm_in)
                .arg("--shm-out")
                .arg(shm_out)
                .arg("--shm-audio-mode")
                .arg(shm_mode);
        }

        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(if debug_stderr {
                Stdio::inherit()
            } else {
                Stdio::null()
            })
            .spawn()
            .map_err(|e| format!("Failed to spawn bridge: {e}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to open bridge stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to open bridge stdout".to_string())?;

        let (request_tx, request_rx) = mpsc::channel::<BridgeRequest>();
        let worker = thread::spawn(move || bridge_worker(stdin, stdout, request_rx));

        Ok(Self {
            child,
            request_tx: Some(request_tx),
            worker: Some(worker),
        })
    }

    pub fn kill(&mut self) {
        self.request_tx.take();

        let _ = self.child.kill();
        let _ = self.child.wait();

        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }

    fn ensure_running(&mut self) -> Result<(), String> {
        match self.child.try_wait() {
            Ok(Some(status)) => {
                self.kill();
                Err(format!("Bridge exited unexpectedly: {status}"))
            }
            Ok(None) => Ok(()),
            Err(err) => {
                self.kill();
                Err(format!("Failed to poll bridge process: {err}"))
            }
        }
    }

    pub fn check_alive(&mut self) -> Result<(), String> {
        self.ensure_running()
    }

    #[cfg(target_os = "windows")]
    fn allow_set_foreground_window(&self) {
        let pid = self.child.id();
        unsafe {
            // Allows the sidecar process to call SetForegroundWindow when opening the editor UI.
            // This is best-effort; failures should not abort the request.
            let _ = AllowSetForegroundWindow(pid);
        }
    }

    #[cfg(not(target_os = "windows"))]
    fn allow_set_foreground_window(&self) {}

    fn request_raw_with_policy(
        &mut self,
        ty: u8,
        payload: Vec<u8>,
        timeout: Duration,
        kill_on_timeout: bool,
    ) -> Result<(u8, Vec<u8>), String> {
        self.ensure_running()?;

        let Some(tx) = self.request_tx.as_ref() else {
            return Err("Bridge is not running".to_string());
        };

        let (response_tx, response_rx) = mpsc::channel::<Result<(u8, Vec<u8>), String>>();
        tx.send(BridgeRequest {
            ty,
            payload,
            response_tx,
        })
        .map_err(|_| "Bridge worker is unavailable".to_string())?;

        match response_rx.recv_timeout(timeout) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Important: some requests (like ping) are best-effort and may time out while the
                // sidecar is busy (e.g. opening a heavy native editor UI). Killing the bridge here
                // can cause editor windows to flash then disappear.
                if kill_on_timeout {
                    self.kill();
                }
                Err(format!(
                    "Bridge request timed out after {}ms",
                    timeout.as_millis()
                ))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                self.kill();
                Err("Bridge worker disconnected".to_string())
            }
        }
    }

    fn request_raw(
        &mut self,
        ty: u8,
        payload: Vec<u8>,
        timeout: Duration,
    ) -> Result<(u8, Vec<u8>), String> {
        self.request_raw_with_policy(ty, payload, timeout, true)
    }

    #[allow(dead_code)]
    pub fn ping(&mut self) -> Result<BridgePingResponse, String> {
        self.ping_with_timeout(bridge_ping_timeout())
    }

    pub fn ping_with_timeout(&mut self, timeout: Duration) -> Result<BridgePingResponse, String> {
        let payload = serde_json::to_vec(&serde_json::json!({
            "protocolVersion": BRIDGE_PROTOCOL_VERSION,
        }))
        .map_err(|e| format!("Failed to encode ping payload: {e}"))?;

        // Ping is best-effort: if it times out while the sidecar is busy (e.g. creating an editor
        // window), we must NOT kill the bridge process.
        let (ty, payload) = self.request_raw_with_policy(MSG_PING, payload, timeout, false)?;
        if ty == MSG_ERROR {
            return Err(parse_error_payload(&payload));
        }
        if ty != MSG_PING {
            return Err(format!("Unexpected bridge response type: {ty}"));
        }

        if payload.is_empty() {
            return Ok(BridgePingResponse {
                protocol_version: BRIDGE_PROTOCOL_VERSION,
                plugin_id: None,
                editor_open: None,
                metrics: None,
            });
        }

        let response = serde_json::from_slice::<BridgePingResponse>(&payload)
            .map_err(|e| format!("Failed to parse bridge ping response: {e}"))?;

        if response.protocol_version != BRIDGE_PROTOCOL_VERSION {
            return Err(format!(
                "Bridge protocol mismatch: expected {}, got {}",
                BRIDGE_PROTOCOL_VERSION, response.protocol_version
            ));
        }

        Ok(response)
    }

    #[allow(dead_code)]
    pub fn instantiate(&mut self, plugin_id: &str) -> Result<BridgePingResponse, String> {
        let payload = serde_json::to_vec(&serde_json::json!({
            "protocolVersion": BRIDGE_PROTOCOL_VERSION,
            "pluginId": plugin_id,
        }))
        .map_err(|e| format!("Failed to encode instantiate payload: {e}"))?;

        let (ty, payload) = self.request_raw(MSG_INSTANTIATE, payload, bridge_request_timeout())?;
        if ty == MSG_ERROR {
            return Err(parse_error_payload(&payload));
        }
        if ty != MSG_INSTANTIATE {
            return Err(format!("Unexpected bridge response type: {ty}"));
        }

        let response = serde_json::from_slice::<BridgePingResponse>(&payload)
            .map_err(|e| format!("Failed to parse bridge instantiate response: {e}"))?;

        if response.protocol_version != BRIDGE_PROTOCOL_VERSION {
            return Err(format!(
                "Bridge protocol mismatch: expected {}, got {}",
                BRIDGE_PROTOCOL_VERSION, response.protocol_version
            ));
        }

        Ok(response)
    }

    pub fn set_params(&mut self, params: &[(String, f32)]) -> Result<(), String> {
        let payload = serde_json::to_vec(&serde_json::json!({
            "protocolVersion": BRIDGE_PROTOCOL_VERSION,
            "params": params.iter().map(|(key, value)| serde_json::json!({ "key": key, "value": value })).collect::<Vec<_>>()
        }))
        .map_err(|e| format!("Failed to encode params: {e}"))?;

        // Some plugins can block the bridge (e.g. editor attach on the JUCE UI thread), and
        // setParams is often invoked by UI polling/automation. Avoid killing the bridge process
        // on transient timeouts to prevent "editor flashes then disappears" regressions.
        let (ty, payload) =
            self.request_raw_with_policy(MSG_SET_PARAMS, payload, bridge_request_timeout(), false)?;
        if ty == MSG_ERROR {
            return Err(parse_error_payload(&payload));
        }
        if ty != MSG_SET_PARAMS {
            return Err(format!("Unexpected bridge response type: {ty}"));
        }
        Ok(())
    }

    pub fn get_params(&mut self) -> Result<Vec<BridgeParamValue>, String> {
        let payload = serde_json::to_vec(&serde_json::json!({
            "protocolVersion": BRIDGE_PROTOCOL_VERSION,
        }))
        .map_err(|e| format!("Failed to encode getParams payload: {e}"))?;

        // getParams is best-effort: if the sidecar is busy opening/closing a native editor,
        // a timeout should not kill the bridge process.
        let (ty, payload) =
            self.request_raw_with_policy(MSG_GET_PARAMS, payload, bridge_request_timeout(), false)?;
        if ty == MSG_ERROR {
            return Err(parse_error_payload(&payload));
        }
        if ty != MSG_GET_PARAMS {
            return Err(format!("Unexpected bridge response type: {ty}"));
        }

        let response = serde_json::from_slice::<BridgeGetParamsResponse>(&payload)
            .map_err(|e| format!("Failed to parse bridge getParams response: {e}"))?;
        if response.protocol_version != BRIDGE_PROTOCOL_VERSION {
            return Err(format!(
                "Bridge protocol mismatch: expected {}, got {}",
                BRIDGE_PROTOCOL_VERSION, response.protocol_version
            ));
        }
        Ok(response.params)
    }

    pub fn open_editor_window(
        &mut self,
        title: Option<&str>,
        owner_hwnd: Option<u64>,
        options: BridgeOpenEditorOptions,
    ) -> Result<(), String> {
        self.allow_set_foreground_window();

        let payload = serde_json::to_vec(&serde_json::json!({
            "protocolVersion": BRIDGE_PROTOCOL_VERSION,
            "title": title,
            "ownerHwnd": owner_hwnd,
            "pinned": options.pinned,
            "bringOnly": options.bring_only,
            "show": options.show,
            "activate": options.activate,
        }))
        .map_err(|e| e.to_string())?;

        // Opening native editors can legitimately take a long time (or block the message loop)
        // for some plugins. If we kill the bridge process on a timeout, the editor window can
        // flash then disappear, which is worse than returning an error.
        let (ty, payload) =
            self.request_raw_with_policy(MSG_OPEN_EDITOR, payload, bridge_editor_timeout(), false)?;
        if ty == MSG_ERROR {
            return Err(parse_error_payload(&payload));
        }
        if ty != MSG_OPEN_EDITOR {
            return Err(format!("Unexpected bridge response type: {ty}"));
        }
        Ok(())
    }

    pub fn close_editor_window(&mut self) -> Result<(), String> {
        // Closing native editors can also block (plugin UI teardown). Avoid killing the bridge on
        // timeout to prevent transient UI flicker / unexpected session loss.
        let (ty, payload) = self.request_raw_with_policy(
            MSG_CLOSE_EDITOR,
            Vec::new(),
            bridge_editor_timeout(),
            false,
        )?;
        if ty == MSG_ERROR {
            return Err(parse_error_payload(&payload));
        }
        if ty != MSG_CLOSE_EDITOR {
            return Err(format!("Unexpected bridge response type: {ty}"));
        }
        Ok(())
    }

    pub fn dispose(&mut self) -> Result<(), String> {
        let payload = serde_json::to_vec(&serde_json::json!({
            "protocolVersion": BRIDGE_PROTOCOL_VERSION,
        }))
        .map_err(|e| format!("Failed to encode dispose payload: {e}"))?;

        let (ty, payload) = self.request_raw(MSG_DISPOSE, payload, bridge_request_timeout())?;
        if ty == MSG_ERROR {
            return Err(parse_error_payload(&payload));
        }
        if ty != MSG_DISPOSE {
            return Err(format!("Unexpected bridge response type: {ty}"));
        }

        self.kill();
        Ok(())
    }
}

impl Drop for BridgeClient {
    fn drop(&mut self) {
        self.kill();
    }
}

fn bridge_worker(
    mut stdin: ChildStdin,
    mut stdout: ChildStdout,
    request_rx: mpsc::Receiver<BridgeRequest>,
) {
    for request in request_rx {
        let result = (|| -> Result<(u8, Vec<u8>), String> {
            write_message(&mut stdin, request.ty, &request.payload)
                .map_err(|e| format!("Bridge write failed: {e}"))?;
            read_message(&mut stdout).map_err(|e| format!("Bridge read failed: {e}"))
        })();

        let should_stop = result.is_err();
        let _ = request.response_tx.send(result);
        if should_stop {
            break;
        }
    }
}

fn write_message<W: Write>(writer: &mut W, ty: u8, payload: &[u8]) -> std::io::Result<()> {
    writer.write_all(&[ty])?;
    writer.write_all(&(payload.len() as u32).to_le_bytes())?;
    writer.write_all(payload)?;
    writer.flush()?;
    Ok(())
}

fn read_message<R: Read>(reader: &mut R) -> std::io::Result<(u8, Vec<u8>)> {
    let mut ty = [0u8; 1];
    reader
        .read_exact(&mut ty)
        .map_err(|e| std::io::Error::new(e.kind(), format!("read type byte: {e}")))?;
    let mut len = [0u8; 4];
    reader
        .read_exact(&mut len)
        .map_err(|e| std::io::Error::new(e.kind(), format!("read payload length: {e}")))?;
    let len = u32::from_le_bytes(len) as usize;
    let mut payload = vec![0u8; len];
    reader.read_exact(&mut payload).map_err(|e| {
        std::io::Error::new(e.kind(), format!("read payload bytes (len={len}): {e}"))
    })?;
    Ok((ty[0], payload))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::process::{Command, Stdio};

    #[cfg(target_os = "windows")]
    #[test]
    fn open_editor_timeout_does_not_kill_bridge_process() {
        // Regression guard: killing the bridge on editor-open timeouts causes the native editor
        // window to flash then disappear.
        // We simulate an unresponsive bridge process and assert that the host does NOT kill it
        // when openEditor times out.

        // Make the editor timeout tiny so the test is fast.
        std::env::set_var("PMP_VST_BRIDGE_EDITOR_TIMEOUT_MS", "20");

        // Spawn a dummy process that keeps stdout open but never responds.
        // `ping` with output redirected sleeps for a few seconds and doesn't read stdin.
        let mut child = Command::new("cmd")
            .args(["/C", "ping", "-n", "6", "127.0.0.1", ">", "nul"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn dummy bridge");

        let stdin = child.stdin.take().expect("dummy stdin");
        let stdout = child.stdout.take().expect("dummy stdout");

        let (request_tx, request_rx) = mpsc::channel::<BridgeRequest>();
        let worker = std::thread::spawn(move || bridge_worker(stdin, stdout, request_rx));

        let mut client = BridgeClient {
            child,
            request_tx: Some(request_tx),
            worker: Some(worker),
        };

        let err = client
            .open_editor_window(None, None, BridgeOpenEditorOptions::default())
            .unwrap_err();
        assert!(err.contains("timed out"), "expected timeout, got: {err}");

        // Critical behavior: process must still be alive because we used kill_on_timeout=false.
        assert!(
            matches!(client.child.try_wait(), Ok(None)),
            "dummy bridge should still be running after timeout"
        );

        client.kill();
        // Best-effort cleanup.
        std::env::remove_var("PMP_VST_BRIDGE_EDITOR_TIMEOUT_MS");
    }

    #[test]
    fn read_message_includes_context_on_eof() {
        // Empty stream -> fail while reading type byte.
        let mut empty = Cursor::new(Vec::<u8>::new());
        let err = read_message(&mut empty).unwrap_err();
        assert!(format!("{err}").contains("read type byte"));

        // Only type byte -> fail while reading length.
        let mut only_type = Cursor::new(vec![1u8]);
        let err = read_message(&mut only_type).unwrap_err();
        assert!(format!("{err}").contains("read payload length"));

        // Type + length, but missing payload bytes.
        let mut missing_payload = Cursor::new(vec![1u8, 3u8, 0, 0, 0, 0xAA]);
        let err = read_message(&mut missing_payload).unwrap_err();
        assert!(format!("{err}").contains("read payload bytes"));
        assert!(format!("{err}").contains("len=3"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn set_params_timeout_does_not_kill_bridge_process() {
        // Regression guard: killing the bridge on setParams timeouts can tear down a native editor
        // window and cause it to "flash then disappear".
        std::env::set_var("PMP_VST_BRIDGE_REQUEST_TIMEOUT_MS", "20");

        let mut child = Command::new("cmd")
            .args(["/C", "ping", "-n", "6", "127.0.0.1", ">", "nul"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn dummy bridge");

        let stdin = child.stdin.take().expect("dummy stdin");
        let stdout = child.stdout.take().expect("dummy stdout");

        let (request_tx, request_rx) = mpsc::channel::<BridgeRequest>();
        let worker = std::thread::spawn(move || bridge_worker(stdin, stdout, request_rx));

        let mut client = BridgeClient {
            child,
            request_tx: Some(request_tx),
            worker: Some(worker),
        };

        let err = client.set_params(&[("0".to_string(), 0.5)]).unwrap_err();
        assert!(err.contains("timed out"), "expected timeout, got: {err}");
        assert!(
            matches!(client.child.try_wait(), Ok(None)),
            "dummy bridge should still be running after timeout"
        );

        client.kill();
        std::env::remove_var("PMP_VST_BRIDGE_REQUEST_TIMEOUT_MS");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn get_params_timeout_does_not_kill_bridge_process() {
        std::env::set_var("PMP_VST_BRIDGE_REQUEST_TIMEOUT_MS", "20");

        let mut child = Command::new("cmd")
            .args(["/C", "ping", "-n", "6", "127.0.0.1", ">", "nul"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn dummy bridge");

        let stdin = child.stdin.take().expect("dummy stdin");
        let stdout = child.stdout.take().expect("dummy stdout");

        let (request_tx, request_rx) = mpsc::channel::<BridgeRequest>();
        let worker = std::thread::spawn(move || bridge_worker(stdin, stdout, request_rx));

        let mut client = BridgeClient {
            child,
            request_tx: Some(request_tx),
            worker: Some(worker),
        };

        let err = client.get_params().unwrap_err();
        assert!(err.contains("timed out"), "expected timeout, got: {err}");
        assert!(
            matches!(client.child.try_wait(), Ok(None)),
            "dummy bridge should still be running after timeout"
        );

        client.kill();
        std::env::remove_var("PMP_VST_BRIDGE_REQUEST_TIMEOUT_MS");
    }
}

fn parse_error_payload(payload: &[u8]) -> String {
    if let Ok(value) = serde_json::from_slice::<serde_json::Value>(payload) {
        let code = value.get("code").and_then(|v| v.as_str());
        let message = value.get("message").and_then(|v| v.as_str());
        if let Some(message) = message {
            if let Some(code) = code {
                return format!("{code}: {message}");
            }
            return message.to_string();
        }
    }
    String::from_utf8_lossy(payload).to_string()
}
