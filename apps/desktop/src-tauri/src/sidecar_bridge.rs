use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
#[cfg(unix)]
use std::os::unix::process::CommandExt as _;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::Manager;

pub const EVENT_PLUGIN_SIDECAR_BRIDGE_MESSAGE: &str = "plugin-sidecar-bridge-message";

const BRIDGE_VERSION: &str = "1.0";
const CHILD_EXIT_POLL_INTERVAL_MS: u64 = 50;
const MAX_STDERR_TAIL_BYTES: usize = 8 * 1024;
#[cfg(unix)]
const SIDECAR_TERM_GRACE_PERIOD_MS: u64 = 250;
const SIDECAR_FORCE_KILL_WAIT_MS: u64 = 750;
static SIDECAR_SESSION_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarBridgeOpenRequest {
    pub plugin_id: String,
    pub runtime_id: String,
    pub runtime_instance_id: String,
    pub entry_path: String,
    pub command_id: String,
    pub args: Option<Value>,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarBridgeOpenResponse {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarBridgeMessageEventPayload {
    session_id: String,
    plugin_id: String,
    runtime_id: String,
    runtime_instance_id: String,
    message: Value,
}

#[derive(Debug)]
struct SidecarBridgeSession {
    session_id: String,
    plugin_id: String,
    runtime_id: String,
    runtime_instance_id: String,
    process: Arc<Mutex<ManagedSidecarProcess>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    terminating: Arc<AtomicBool>,
    ready: Arc<AtomicBool>,
    cleanup_strategy: &'static str,
    stderr_tail: Arc<Mutex<Vec<u8>>>,
}

#[derive(Debug)]
struct SpawnedSidecarProcess {
    process: ManagedSidecarProcess,
    cleanup_setup_error: Option<String>,
}

#[derive(Debug)]
struct ManagedSidecarProcess {
    child: Child,
    cleanup: SidecarProcessCleanup,
}

#[derive(Debug)]
enum SidecarProcessCleanup {
    Direct,
    #[cfg(target_os = "windows")]
    WindowsJobObject(WindowsJobObjectCleanup),
    #[cfg(unix)]
    UnixProcessGroup(UnixProcessGroupCleanup),
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
struct WindowsJobObjectCleanup {
    job: WindowsJobHandle,
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
struct WindowsJobHandle(windows::Win32::Foundation::HANDLE);

#[cfg(unix)]
#[derive(Debug)]
struct UnixProcessGroupCleanup {
    pgid: i32,
}

impl ManagedSidecarProcess {
    fn cleanup_strategy(&self) -> &'static str {
        self.cleanup.strategy_name()
    }

    fn terminate(&mut self) -> Result<(), String> {
        match self.child.try_wait() {
            Ok(Some(_)) => Ok(()),
            Ok(None) => self.cleanup.terminate(&mut self.child),
            Err(error) => Err(format!("Poll sidecar process failed: {error}")),
        }
    }
}

impl SidecarProcessCleanup {
    fn strategy_name(&self) -> &'static str {
        match self {
            Self::Direct => "direct",
            #[cfg(target_os = "windows")]
            Self::WindowsJobObject(_) => "windows-job-object",
            #[cfg(unix)]
            Self::UnixProcessGroup(_) => "unix-process-group",
        }
    }

    fn terminate(&mut self, child: &mut Child) -> Result<(), String> {
        match self {
            Self::Direct => terminate_direct_child_process(child),
            #[cfg(target_os = "windows")]
            Self::WindowsJobObject(cleanup) => cleanup.terminate(child),
            #[cfg(unix)]
            Self::UnixProcessGroup(cleanup) => cleanup.terminate(child),
        }
    }
}

#[cfg(target_os = "windows")]
impl WindowsJobObjectCleanup {
    fn new(child: &Child) -> Result<Self, String> {
        use std::mem::size_of;
        use std::os::windows::io::AsRawHandle as _;
        use windows::core::PCWSTR;
        use windows::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };

        let job = unsafe { CreateJobObjectW(None, PCWSTR::null()) }
            .map_err(|error| format!("Create sidecar job object failed: {error}"))?;
        let job = WindowsJobHandle(job);

        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        unsafe {
            SetInformationJobObject(
                job.handle(),
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        }
        .map_err(|error| format!("Configure sidecar job object failed: {error}"))?;

        let process_handle = windows::Win32::Foundation::HANDLE(child.as_raw_handle() as isize);
        unsafe { AssignProcessToJobObject(job.handle(), process_handle) }
            .map_err(|error| format!("Assign sidecar process to job object failed: {error}"))?;

        Ok(Self { job })
    }

    fn terminate(&mut self, child: &mut Child) -> Result<(), String> {
        use windows::Win32::System::JobObjects::TerminateJobObject;

        if let Err(error) = unsafe { TerminateJobObject(self.job.handle(), 1) } {
            if let Ok(Some(_)) = child.try_wait() {
                return Ok(());
            }
            return terminate_direct_child_process(child).map_err(|direct_error| {
                format!(
                    "Terminate sidecar job object failed: {error}; fallback direct kill failed: {direct_error}"
                )
            });
        }

        if wait_for_child_exit(child, Duration::from_millis(SIDECAR_FORCE_KILL_WAIT_MS))? {
            return Ok(());
        }

        terminate_direct_child_process(child)
            .map_err(|error| format!("Timed out waiting for sidecar job teardown: {error}"))
    }
}

#[cfg(target_os = "windows")]
impl WindowsJobHandle {
    fn handle(&self) -> windows::Win32::Foundation::HANDLE {
        self.0
    }
}

#[cfg(target_os = "windows")]
impl Drop for WindowsJobHandle {
    fn drop(&mut self) {
        let _ = unsafe { windows::Win32::Foundation::CloseHandle(self.0) };
    }
}

#[cfg(unix)]
impl UnixProcessGroupCleanup {
    fn terminate(&mut self, child: &mut Child) -> Result<(), String> {
        send_process_group_signal(self.pgid, libc::SIGTERM)?;
        if wait_for_child_exit(child, Duration::from_millis(SIDECAR_TERM_GRACE_PERIOD_MS))? {
            return Ok(());
        }

        send_process_group_signal(self.pgid, libc::SIGKILL)?;
        if wait_for_child_exit(child, Duration::from_millis(SIDECAR_FORCE_KILL_WAIT_MS))? {
            return Ok(());
        }

        terminate_direct_child_process(child).map_err(|error| {
            format!("Timed out waiting for sidecar process group teardown: {error}")
        })
    }
}

#[derive(Default)]
struct SidecarBridgeRegistryInner {
    sessions: RwLock<HashMap<String, Arc<SidecarBridgeSession>>>,
    runtime_sessions: RwLock<HashMap<String, String>>,
}

impl Drop for SidecarBridgeRegistryInner {
    fn drop(&mut self) {
        if let Ok(mut sessions) = self.sessions.write() {
            for (_, session) in sessions.drain() {
                session.terminating.store(true, Ordering::Release);
                let _ = terminate_managed_process(&session.process);
            }
        }
    }
}

#[derive(Clone, Default)]
pub struct SidecarBridgeRegistry {
    inner: Arc<SidecarBridgeRegistryInner>,
}

impl SidecarBridgeRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn open_session(
        &self,
        app: &tauri::AppHandle,
        request: SidecarBridgeOpenRequest,
    ) -> Result<SidecarBridgeOpenResponse, String> {
        let runtime_instance_id = request.runtime_instance_id.clone();
        let command_id = request.command_id.clone();
        let timeout_ms = request.timeout_ms;

        if let Some(existing_session) =
            self.get_active_session_for_runtime_instance(&runtime_instance_id)?
        {
            if sidecar_session_is_running(&existing_session)? {
                crate::backend_telemetry::info(
                    app,
                    "plugin",
                    "plugin.sidecar.bridge.reused",
                    crate::backend_telemetry::BackendTelemetryOptions::new()
                        .component("SidecarBridgeRegistry")
                        .field("pluginId", json!(existing_session.plugin_id.as_str()))
                        .field("runtimeId", json!(existing_session.runtime_id.as_str()))
                        .field(
                            "runtimeInstanceId",
                            json!(existing_session.runtime_instance_id.as_str()),
                        )
                        .field(
                            "sidecarSessionId",
                            json!(existing_session.session_id.as_str()),
                        )
                        .field("commandId", json!(command_id))
                        .field("timeoutMs", json!(timeout_ms))
                        .field("cleanupStrategy", json!(existing_session.cleanup_strategy)),
                );
                if existing_session.ready.load(Ordering::Acquire) {
                    emit_sidecar_bridge_message(app, &existing_session, json!({ "op": "ready" }));
                }
                return Ok(SidecarBridgeOpenResponse {
                    session_id: existing_session.session_id.clone(),
                });
            }

            let _ = self.remove_session(&existing_session.session_id);
        }

        let mut spawned = spawn_sidecar_process(&request)?;
        let cleanup_strategy = spawned.process.cleanup_strategy();
        let cleanup_setup_error = spawned.cleanup_setup_error.take();
        let stdin = spawned
            .process
            .child
            .stdin
            .take()
            .ok_or_else(|| "Failed to open sidecar stdin".to_string())?;
        let stdout = spawned
            .process
            .child
            .stdout
            .take()
            .ok_or_else(|| "Failed to open sidecar stdout".to_string())?;
        let stderr = spawned
            .process
            .child
            .stderr
            .take()
            .ok_or_else(|| "Failed to open sidecar stderr".to_string())?;

        let session_id = allocate_sidecar_session_id(&runtime_instance_id);
        let session = Arc::new(SidecarBridgeSession {
            session_id: session_id.clone(),
            plugin_id: request.plugin_id,
            runtime_id: request.runtime_id,
            runtime_instance_id: request.runtime_instance_id,
            process: Arc::new(Mutex::new(spawned.process)),
            stdin: Arc::new(Mutex::new(Some(stdin))),
            terminating: Arc::new(AtomicBool::new(false)),
            ready: Arc::new(AtomicBool::new(false)),
            cleanup_strategy,
            stderr_tail: Arc::new(Mutex::new(Vec::new())),
        });

        self.insert_session(session.clone())?;

        crate::backend_telemetry::info(
            app,
            "plugin",
            "plugin.sidecar.bridge.opened",
            crate::backend_telemetry::BackendTelemetryOptions::new()
                .component("SidecarBridgeRegistry")
                .field("pluginId", json!(session.plugin_id.as_str()))
                .field("runtimeId", json!(session.runtime_id.as_str()))
                .field(
                    "runtimeInstanceId",
                    json!(session.runtime_instance_id.as_str()),
                )
                .field("sidecarSessionId", json!(session_id.clone()))
                .field("commandId", json!(command_id))
                .field("timeoutMs", json!(timeout_ms))
                .field("cleanupStrategy", json!(session.cleanup_strategy)),
        );
        if let Some(error) = cleanup_setup_error {
            crate::backend_telemetry::warn(
                app,
                "plugin",
                "plugin.sidecar.bridge.cleanup.degraded",
                crate::backend_telemetry::BackendTelemetryOptions::new()
                    .component("SidecarBridgeRegistry")
                    .message("Fell back to direct sidecar cleanup")
                    .field("pluginId", json!(session.plugin_id.as_str()))
                    .field("runtimeId", json!(session.runtime_id.as_str()))
                    .field(
                        "runtimeInstanceId",
                        json!(session.runtime_instance_id.as_str()),
                    )
                    .field("sidecarSessionId", json!(session.session_id.as_str()))
                    .field("cleanupStrategy", json!(session.cleanup_strategy))
                    .field("cleanupSetupError", json!(error)),
            );
        }
        spawn_stdout_reader(app.clone(), session.clone(), stdout);
        spawn_stderr_reader(session.clone(), stderr);
        spawn_exit_watcher(app.clone(), self.clone(), session);

        Ok(SidecarBridgeOpenResponse { session_id })
    }

    pub fn send_message(&self, session_id: &str, message: Value) -> Result<(), String> {
        let session = self
            .get_session(session_id)?
            .ok_or_else(|| format!("Sidecar runtime bridge session not found: {session_id}"))?;

        let encoded = serde_json::to_vec(&message)
            .map_err(|error| format!("Encode sidecar message failed: {error}"))?;

        let mut guard = session
            .stdin
            .lock()
            .map_err(|_| "Sidecar stdin lock poisoned".to_string())?;
        let stdin = guard
            .as_mut()
            .ok_or_else(|| "Sidecar stdin is already closed".to_string())?;

        stdin
            .write_all(&encoded)
            .map_err(|error| format!("Write sidecar stdin failed: {error}"))?;
        stdin
            .write_all(b"\n")
            .map_err(|error| format!("Write sidecar stdin newline failed: {error}"))?;
        stdin
            .flush()
            .map_err(|error| format!("Flush sidecar stdin failed: {error}"))?;
        Ok(())
    }

    pub fn close_session(
        &self,
        app: &tauri::AppHandle,
        session_id: &str,
        reason: Option<&str>,
    ) -> Result<(), String> {
        let session = self.remove_session(session_id)?;
        let Some(session) = session else {
            return Ok(());
        };

        if should_emit_forced_teardown(reason) {
            crate::backend_telemetry::warn(
                app,
                "plugin",
                "plugin.sidecar.process.forced-teardown",
                crate::backend_telemetry::BackendTelemetryOptions::new()
                    .component("SidecarBridgeRegistry")
                    .field("pluginId", json!(session.plugin_id.as_str()))
                    .field("runtimeId", json!(session.runtime_id.as_str()))
                    .field(
                        "runtimeInstanceId",
                        json!(session.runtime_instance_id.as_str()),
                    )
                    .field("sidecarSessionId", json!(session.session_id.as_str()))
                    .field("cleanupStrategy", json!(session.cleanup_strategy))
                    .field("reason", json!(reason.unwrap_or("unknown"))),
            );
        }

        session.terminating.store(true, Ordering::Release);

        if let Ok(mut stdin) = session.stdin.lock() {
            stdin.take();
        }

        terminate_managed_process(&session.process)
    }

    fn get_session(&self, session_id: &str) -> Result<Option<Arc<SidecarBridgeSession>>, String> {
        let sessions = self
            .inner
            .sessions
            .read()
            .map_err(|_| "Sidecar bridge registry lock poisoned".to_string())?;
        Ok(sessions.get(session_id).cloned())
    }

    fn get_active_session_for_runtime_instance(
        &self,
        runtime_instance_id: &str,
    ) -> Result<Option<Arc<SidecarBridgeSession>>, String> {
        let session_id = {
            let runtime_sessions = self
                .inner
                .runtime_sessions
                .read()
                .map_err(|_| "Sidecar bridge registry lock poisoned".to_string())?;
            runtime_sessions.get(runtime_instance_id).cloned()
        };

        match session_id {
            Some(session_id) => self.get_session(&session_id),
            None => Ok(None),
        }
    }

    fn insert_session(&self, session: Arc<SidecarBridgeSession>) -> Result<(), String> {
        {
            let mut sessions = self
                .inner
                .sessions
                .write()
                .map_err(|_| "Sidecar bridge registry lock poisoned".to_string())?;
            sessions.insert(session.session_id.clone(), session.clone());
        }

        let mut runtime_sessions = self
            .inner
            .runtime_sessions
            .write()
            .map_err(|_| "Sidecar bridge registry lock poisoned".to_string())?;
        runtime_sessions.insert(
            session.runtime_instance_id.clone(),
            session.session_id.clone(),
        );
        Ok(())
    }

    fn remove_session(
        &self,
        session_id: &str,
    ) -> Result<Option<Arc<SidecarBridgeSession>>, String> {
        let removed = {
            let mut sessions = self
                .inner
                .sessions
                .write()
                .map_err(|_| "Sidecar bridge registry lock poisoned".to_string())?;
            sessions.remove(session_id)
        };

        if let Some(session) = removed.as_ref() {
            let mut runtime_sessions = self
                .inner
                .runtime_sessions
                .write()
                .map_err(|_| "Sidecar bridge registry lock poisoned".to_string())?;
            clear_runtime_session_mapping_if_matches(
                &mut runtime_sessions,
                &session.runtime_instance_id,
                &session.session_id,
            );
        }

        Ok(removed)
    }
}

fn allocate_sidecar_session_id(runtime_instance_id: &str) -> String {
    let seq = SIDECAR_SESSION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{runtime_instance_id}:session:{seq}")
}

fn clear_runtime_session_mapping_if_matches(
    runtime_sessions: &mut HashMap<String, String>,
    runtime_instance_id: &str,
    session_id: &str,
) {
    if runtime_sessions
        .get(runtime_instance_id)
        .map(String::as_str)
        == Some(session_id)
    {
        runtime_sessions.remove(runtime_instance_id);
    }
}

fn sidecar_session_is_running(session: &SidecarBridgeSession) -> Result<bool, String> {
    let mut process = session
        .process
        .lock()
        .map_err(|_| "Sidecar process lock poisoned".to_string())?;
    match process.child.try_wait() {
        Ok(Some(_)) => Ok(false),
        Ok(None) => Ok(true),
        Err(error) => Err(format!("Poll sidecar process failed: {error}")),
    }
}

fn is_ready_message(value: &Value) -> bool {
    value
        .get("op")
        .and_then(Value::as_str)
        .map(|op| op == "ready")
        .unwrap_or(false)
}

fn spawn_stdout_reader(
    app: tauri::AppHandle,
    session: Arc<SidecarBridgeSession>,
    stdout: ChildStdout,
) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();

        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let message = decode_sidecar_stdout_message(&session, trimmed);
                    if is_ready_message(&message) {
                        session.ready.store(true, Ordering::Release);
                    }
                    emit_sidecar_bridge_message(&app, &session, message);
                }
                Err(error) => {
                    emit_sidecar_runtime_error(
                        &app,
                        &session,
                        format!("Read sidecar stdout failed: {error}"),
                        None,
                    );
                    break;
                }
            }
        }
    });
}

fn spawn_stderr_reader(session: Arc<SidecarBridgeSession>, stderr: ChildStderr) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut buffer = [0u8; 1024];

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    if let Ok(mut tail) = session.stderr_tail.lock() {
                        tail.extend_from_slice(&buffer[..read]);
                        if tail.len() > MAX_STDERR_TAIL_BYTES {
                            let drain = tail.len() - MAX_STDERR_TAIL_BYTES;
                            tail.drain(0..drain);
                        }
                    } else {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
}

fn spawn_exit_watcher(
    app: tauri::AppHandle,
    registry: SidecarBridgeRegistry,
    session: Arc<SidecarBridgeSession>,
) {
    thread::spawn(move || loop {
        let exit = {
            let mut process = match session.process.lock() {
                Ok(process) => process,
                Err(_) => {
                    emit_sidecar_runtime_error(
                        &app,
                        &session,
                        "Sidecar process lock poisoned while waiting for exit".to_string(),
                        None,
                    );
                    let _ = registry.remove_session(&session.session_id);
                    return;
                }
            };

            match process.child.try_wait() {
                Ok(Some(status)) => Some(Ok(status.to_string())),
                Ok(None) => None,
                Err(error) => Some(Err(format!("Poll sidecar process failed: {error}"))),
            }
        };

        match exit {
            None => {
                thread::sleep(Duration::from_millis(CHILD_EXIT_POLL_INTERVAL_MS));
            }
            Some(Ok(status)) => {
                let _ = registry.remove_session(&session.session_id);
                if !session.terminating.load(Ordering::Acquire) {
                    let stderr_tail = read_stderr_tail(&session);
                    emit_sidecar_runtime_error(
                        &app,
                        &session,
                        format!("Sidecar process exited unexpectedly: {status}"),
                        stderr_tail.map(|stderr| json!({ "stderrTail": stderr })),
                    );
                }
                return;
            }
            Some(Err(message)) => {
                let _ = registry.remove_session(&session.session_id);
                if !session.terminating.load(Ordering::Acquire) {
                    emit_sidecar_runtime_error(&app, &session, message, None);
                }
                return;
            }
        }
    });
}

fn emit_sidecar_bridge_message(
    app: &tauri::AppHandle,
    session: &SidecarBridgeSession,
    message: Value,
) {
    let payload = SidecarBridgeMessageEventPayload {
        session_id: session.session_id.clone(),
        plugin_id: session.plugin_id.clone(),
        runtime_id: session.runtime_id.clone(),
        runtime_instance_id: session.runtime_instance_id.clone(),
        message,
    };
    let _ = app.emit_all(EVENT_PLUGIN_SIDECAR_BRIDGE_MESSAGE, payload);
}

fn emit_sidecar_runtime_error(
    app: &tauri::AppHandle,
    session: &SidecarBridgeSession,
    message: String,
    details: Option<Value>,
) {
    let mut telemetry = crate::backend_telemetry::BackendTelemetryOptions::new()
        .component("SidecarBridgeRegistry")
        .message(message.clone())
        .field("pluginId", json!(session.plugin_id.as_str()))
        .field("runtimeId", json!(session.runtime_id.as_str()))
        .field(
            "runtimeInstanceId",
            json!(session.runtime_instance_id.as_str()),
        )
        .field("sidecarSessionId", json!(session.session_id.as_str()))
        .field("cleanupStrategy", json!(session.cleanup_strategy))
        .field("fatal", json!(true));
    if let Some(details_value) = details.clone() {
        telemetry = telemetry.field("details", details_value);
    }
    crate::backend_telemetry::error(app, "plugin", "plugin.sidecar.bridge.failed", telemetry);
    emit_sidecar_bridge_message(
        app,
        session,
        build_runtime_error_message(session, message, details),
    );
}

fn should_emit_forced_teardown(reason: Option<&str>) -> bool {
    matches!(reason, Some("runtime-unresponsive" | "runtime-crash"))
}

fn build_runtime_error_message(
    session: &SidecarBridgeSession,
    message: String,
    details: Option<Value>,
) -> Value {
    let mut payload = json!({
        "bridgeVersion": BRIDGE_VERSION,
        "op": "runtime.error",
        "pluginId": session.plugin_id,
        "runtimeId": session.runtime_id,
        "runtimeInstanceId": session.runtime_instance_id,
        "fatal": true,
        "message": message,
    });

    if let Some(details) = details {
        if let Some(object) = payload.as_object_mut() {
            object.insert("details".to_string(), details);
        }
    }

    payload
}

fn decode_sidecar_stdout_message(session: &SidecarBridgeSession, raw: &str) -> Value {
    match serde_json::from_str::<Value>(raw) {
        Ok(Value::Object(object)) if object.get("op").and_then(Value::as_str).is_some() => {
            Value::Object(object)
        }
        Ok(other) => build_runtime_error_message(
            session,
            "Sidecar emitted an invalid runtime bridge payload".to_string(),
            Some(json!({ "payload": other })),
        ),
        Err(error) => build_runtime_error_message(
            session,
            format!("Failed to parse sidecar stdout JSON: {error}"),
            Some(json!({ "raw": raw })),
        ),
    }
}

fn read_stderr_tail(session: &SidecarBridgeSession) -> Option<String> {
    let guard = session.stderr_tail.lock().ok()?;
    if guard.is_empty() {
        return None;
    }
    Some(String::from_utf8_lossy(&guard).trim().to_string())
}

fn spawn_sidecar_process(
    request: &SidecarBridgeOpenRequest,
) -> Result<SpawnedSidecarProcess, String> {
    let entry_path = resolve_sidecar_entry_path(&request.entry_path)?;
    let (program, launch_args) = build_sidecar_launch_command(&entry_path)?;
    let mut command = Command::new(program);
    let working_dir = entry_path
        .parent()
        .ok_or_else(|| "Sidecar entry path does not have a parent directory".to_string())?;

    command
        .args(launch_args)
        .current_dir(working_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PXP_PLUGIN_ID", &request.plugin_id)
        .env("PXP_RUNTIME_ID", &request.runtime_id)
        .env("PXP_RUNTIME_INSTANCE_ID", &request.runtime_instance_id)
        .env("PXP_COMMAND_ID", &request.command_id)
        .env("PXP_COMMAND_TIMEOUT_MS", request.timeout_ms.to_string());

    if let Some(args) = request.args.as_ref() {
        let encoded = serde_json::to_string(args)
            .map_err(|error| format!("Encode sidecar args failed: {error}"))?;
        command.env("PXP_COMMAND_ARGS_JSON", encoded);
    }

    #[cfg(unix)]
    command.process_group(0);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt as _;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let child = command
        .spawn()
        .map_err(|error| format!("Failed to spawn sidecar process: {error}"))?;

    let (cleanup, cleanup_setup_error) = match configure_sidecar_cleanup(&child) {
        Ok(cleanup) => (cleanup, None),
        Err(error) => (SidecarProcessCleanup::Direct, Some(error)),
    };

    Ok(SpawnedSidecarProcess {
        process: ManagedSidecarProcess { child, cleanup },
        cleanup_setup_error,
    })
}

fn resolve_sidecar_entry_path(entry_path: &str) -> Result<PathBuf, String> {
    let trimmed = entry_path.trim();
    if trimmed.is_empty() {
        return Err("Sidecar entry path is empty".to_string());
    }

    let requested = PathBuf::from(trimmed);
    let mut candidates = Vec::<PathBuf>::new();

    if requested.is_absolute() {
        candidates.push(requested.clone());
    } else {
        if let Ok(current_dir) = std::env::current_dir() {
            candidates.push(current_dir.join(&requested));
        }

        if let Ok(current_exe) = std::env::current_exe() {
            if let Some(dir) = current_exe.parent() {
                candidates.push(dir.join(&requested));
                if let Some(parent) = dir.parent() {
                    candidates.push(parent.join(&requested));
                }
            }
        }
    }

    candidates.push(requested.clone());

    for candidate in candidates {
        if !candidate.exists() {
            continue;
        }
        return candidate
            .canonicalize()
            .or(Ok(candidate))
            .map_err(|error: std::io::Error| format!("Resolve sidecar entry failed: {error}"));
    }

    Err(format!("Sidecar entry not found: {trimmed}"))
}

fn build_sidecar_launch_command(entry_path: &Path) -> Result<(PathBuf, Vec<String>), String> {
    let extension = entry_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());

    match extension.as_deref() {
        Some("js") | Some("mjs") | Some("cjs") => {
            let node = std::env::var("PXP_SIDECAR_NODE_EXE").unwrap_or_else(|_| "node".to_string());
            Ok((
                PathBuf::from(node),
                vec![entry_path.to_string_lossy().to_string()],
            ))
        }
        #[cfg(target_os = "windows")]
        Some("cmd") | Some("bat") => {
            let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
            Ok((
                PathBuf::from(shell),
                vec!["/C".to_string(), entry_path.to_string_lossy().to_string()],
            ))
        }
        #[cfg(target_os = "windows")]
        Some("ps1") => Ok((
            PathBuf::from(
                std::env::var("PXP_SIDECAR_POWERSHELL_EXE")
                    .unwrap_or_else(|_| "powershell.exe".to_string()),
            ),
            vec![
                "-ExecutionPolicy".to_string(),
                "Bypass".to_string(),
                "-File".to_string(),
                entry_path.to_string_lossy().to_string(),
            ],
        )),
        _ => Ok((entry_path.to_path_buf(), Vec::new())),
    }
}

fn terminate_managed_process(process: &Arc<Mutex<ManagedSidecarProcess>>) -> Result<(), String> {
    let mut process = process
        .lock()
        .map_err(|_| "Sidecar process lock poisoned".to_string())?;

    process.terminate()
}

fn configure_sidecar_cleanup(child: &Child) -> Result<SidecarProcessCleanup, String> {
    #[cfg(target_os = "windows")]
    {
        return WindowsJobObjectCleanup::new(child).map(SidecarProcessCleanup::WindowsJobObject);
    }

    #[cfg(unix)]
    {
        let pgid = i32::try_from(child.id())
            .map_err(|_| format!("Sidecar pid does not fit process group id: {}", child.id()))?;
        return Ok(SidecarProcessCleanup::UnixProcessGroup(
            UnixProcessGroupCleanup { pgid },
        ));
    }

    #[allow(unreachable_code)]
    Ok(SidecarProcessCleanup::Direct)
}

fn terminate_direct_child_process(child: &mut Child) -> Result<(), String> {
    match child.try_wait() {
        Ok(Some(_)) => return Ok(()),
        Ok(None) => {}
        Err(error) => return Err(format!("Poll sidecar process failed: {error}")),
    }

    if let Err(error) = child.kill() {
        match child.try_wait() {
            Ok(Some(_)) => return Ok(()),
            Ok(None) => {
                return Err(format!("Kill sidecar process failed: {error}"));
            }
            Err(wait_error) => {
                return Err(format!(
                    "Kill sidecar process failed: {error}; polling exit also failed: {wait_error}"
                ));
            }
        }
    }

    if wait_for_child_exit(child, Duration::from_millis(SIDECAR_FORCE_KILL_WAIT_MS))? {
        return Ok(());
    }

    Err(format!(
        "Timed out waiting for sidecar process exit after force kill ({}ms)",
        SIDECAR_FORCE_KILL_WAIT_MS
    ))
}

fn wait_for_child_exit(child: &mut Child, timeout: Duration) -> Result<bool, String> {
    let deadline = Instant::now() + timeout;

    loop {
        match child.try_wait() {
            Ok(Some(_)) => return Ok(true),
            Ok(None) if Instant::now() >= deadline => return Ok(false),
            Ok(None) => thread::sleep(Duration::from_millis(CHILD_EXIT_POLL_INTERVAL_MS)),
            Err(error) => return Err(format!("Poll sidecar process failed: {error}")),
        }
    }
}

#[cfg(unix)]
fn send_process_group_signal(pgid: i32, signal: i32) -> Result<(), String> {
    let result = unsafe { libc::killpg(pgid, signal) };
    if result == 0 {
        return Ok(());
    }

    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        return Ok(());
    }

    Err(format!(
        "Send signal {signal} to sidecar process group failed: {error}"
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        allocate_sidecar_session_id, build_sidecar_launch_command,
        clear_runtime_session_mapping_if_matches, resolve_sidecar_entry_path,
        spawn_sidecar_process, SidecarBridgeOpenRequest,
    };
    use serde_json::{json, Value};
    use std::collections::HashMap;
    use std::fs;
    use std::io::{BufRead, BufReader, Write};
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    const ORPHAN_PARENT_SCRIPT: &str = r#"
const { spawn } = require('child_process');

const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {
  stdio: 'ignore',
});
process.stdout.write(JSON.stringify({ childPid: child.pid }) + '\n');
setInterval(() => {}, 1000);
"#;

    #[test]
    fn resolves_absolute_sidecar_entry_path() {
        let path = std::env::current_exe().expect("current exe");
        let resolved =
            resolve_sidecar_entry_path(path.to_str().expect("utf8 path")).expect("resolve");
        assert_eq!(resolved, path.canonicalize().expect("canonical path"));
    }

    #[test]
    fn maps_javascript_sidecar_entries_to_node_launcher() {
        let entry = PathBuf::from("C:/demo/echo-runtime.js");
        let (program, args) = build_sidecar_launch_command(&entry).expect("launch command");

        assert_eq!(program, PathBuf::from("node"));
        assert_eq!(args, vec![entry.to_string_lossy().to_string()]);
    }

    #[test]
    fn allocates_unique_sidecar_session_ids_for_same_runtime_instance() {
        let first = allocate_sidecar_session_id("platform-pack:connector.platform.netease");
        let second = allocate_sidecar_session_id("platform-pack:connector.platform.netease");

        assert_ne!(first, second);
        assert!(first.starts_with("platform-pack:connector.platform.netease:session:"));
        assert!(second.starts_with("platform-pack:connector.platform.netease:session:"));
    }

    #[test]
    fn only_clears_active_runtime_session_mapping_when_session_matches() {
        let runtime_instance_id = "platform-pack:connector.platform.netease";
        let active_session_id = "platform-pack:connector.platform.netease:session:42";
        let stale_session_id = "platform-pack:connector.platform.netease:session:7";
        let mut runtime_sessions = HashMap::from([(
            runtime_instance_id.to_string(),
            active_session_id.to_string(),
        )]);

        clear_runtime_session_mapping_if_matches(
            &mut runtime_sessions,
            runtime_instance_id,
            stale_session_id,
        );
        assert_eq!(
            runtime_sessions
                .get(runtime_instance_id)
                .map(String::as_str),
            Some(active_session_id)
        );

        clear_runtime_session_mapping_if_matches(
            &mut runtime_sessions,
            runtime_instance_id,
            active_session_id,
        );
        assert!(!runtime_sessions.contains_key(runtime_instance_id));
    }

    #[test]
    fn spawns_node_sidecar_fixture_and_completes_bridge_handshake() {
        if !node_available() {
            return;
        }

        let entry = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../community/plugins/sidecar-echo-demo/sidecar/echo-runtime.js")
            .canonicalize()
            .expect("sidecar fixture path");

        let mut spawned = spawn_sidecar_process(&SidecarBridgeOpenRequest {
            plugin_id: "sidecar-echo-demo".to_string(),
            runtime_id: "sidecar.echo".to_string(),
            runtime_instance_id: "sidecar-test-instance".to_string(),
            entry_path: entry.to_string_lossy().to_string(),
            command_id: "sidecar-echo-demo.run".to_string(),
            args: None,
            timeout_ms: 2_000,
        })
        .expect("spawn sidecar");

        let mut stdin = spawned.process.child.stdin.take().expect("sidecar stdin");
        let stdout = spawned.process.child.stdout.take().expect("sidecar stdout");
        let mut reader = BufReader::new(stdout);

        let hello = read_json_line(&mut reader);
        assert_eq!(hello["op"], "runtime.hello");
        assert_eq!(hello["runtimeKind"], "sidecar");
        assert_eq!(hello["carrier"], "native-process");

        write_json_line(
            &mut stdin,
            json!({
                "bridgeVersion": "1.0",
                "op": "runtime.init",
                "pluginId": "sidecar-echo-demo",
                "runtimeId": "sidecar.echo",
                "runtimeInstanceId": "sidecar-test-instance",
                "hostId": "pmp",
                "trustLevel": "sandboxed",
                "grantedCapabilities": [],
            }),
        );
        assert_eq!(read_json_line(&mut reader)["op"], "runtime.init.ack");

        write_json_line(
            &mut stdin,
            json!({
                "bridgeVersion": "1.0",
                "op": "runtime.activate",
                "pluginId": "sidecar-echo-demo",
                "runtimeId": "sidecar.echo",
                "runtimeInstanceId": "sidecar-test-instance",
                "cause": "command",
                "payload": {
                    "commandId": "sidecar-echo-demo.run",
                }
            }),
        );
        assert_eq!(read_json_line(&mut reader)["op"], "runtime.activate.ack");

        let capability_request = read_json_line(&mut reader);
        assert_eq!(capability_request["op"], "capability.invoke.request");
        assert_eq!(
            capability_request["capabilityId"],
            "core.capability-registry"
        );
        assert_eq!(capability_request["method"], "list");

        write_json_line(
            &mut stdin,
            json!({
                "protocolVersion": "1.0",
                "op": "capability.invoke.response",
                "requestId": capability_request["requestId"],
                "ok": true,
                "data": [
                    {
                        "id": "core.capability-registry",
                        "version": "1.0.0"
                    }
                ]
            }),
        );

        let command_result = read_json_line(&mut reader);
        assert_eq!(command_result["op"], "runtime.event");
        assert_eq!(command_result["eventName"], "command.result");
        assert_eq!(command_result["payload"]["ok"], true);

        spawned.process.terminate().expect("terminate sidecar");
    }

    #[test]
    fn forced_cleanup_terminates_spawned_descendants() {
        if !node_available() {
            return;
        }

        let temp_dir = TempTestDir::new("sidecar-orphan-cleanup");
        let entry = temp_dir.path.join("orphan-parent.js");
        fs::write(&entry, ORPHAN_PARENT_SCRIPT).expect("write sidecar fixture");

        let mut spawned = spawn_sidecar_process(&SidecarBridgeOpenRequest {
            plugin_id: "sidecar-cleanup-test".to_string(),
            runtime_id: "sidecar.cleanup".to_string(),
            runtime_instance_id: "sidecar-cleanup-instance".to_string(),
            entry_path: entry.to_string_lossy().to_string(),
            command_id: "sidecar.cleanup.run".to_string(),
            args: None,
            timeout_ms: 2_000,
        })
        .expect("spawn sidecar");

        let stdout = spawned.process.child.stdout.take().expect("sidecar stdout");
        let mut reader = BufReader::new(stdout);
        let child_info = read_json_line(&mut reader);
        let child_pid = child_info["childPid"].as_u64().expect("child pid") as u32;

        assert!(
            wait_for_pid_state(child_pid, true, Duration::from_secs(2)),
            "spawned descendant should be running before teardown"
        );

        spawned.process.terminate().expect("terminate sidecar");

        assert!(
            wait_for_pid_state(child_pid, false, Duration::from_secs(2)),
            "spawned descendant should exit during teardown"
        );
    }

    fn read_json_line(reader: &mut BufReader<std::process::ChildStdout>) -> Value {
        let mut line = String::new();
        reader.read_line(&mut line).expect("read line");
        serde_json::from_str(line.trim()).expect("json line")
    }

    fn write_json_line(stdin: &mut std::process::ChildStdin, value: Value) {
        let encoded = serde_json::to_string(&value).expect("encode json line");
        stdin
            .write_all(encoded.as_bytes())
            .expect("write json line");
        stdin.write_all(b"\n").expect("write newline");
        stdin.flush().expect("flush stdin");
    }

    fn node_available() -> bool {
        Command::new(node_command())
            .arg("--version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    fn node_command() -> String {
        std::env::var("PXP_SIDECAR_NODE_EXE").unwrap_or_else(|_| "node".to_string())
    }

    fn wait_for_pid_state(pid: u32, should_exist: bool, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;

        loop {
            if is_process_running(pid) == should_exist {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            thread::sleep(Duration::from_millis(50));
        }
    }

    #[cfg(unix)]
    fn is_process_running(pid: u32) -> bool {
        let result = unsafe { libc::kill(pid as i32, 0) };
        if result == 0 {
            return true;
        }

        let error = std::io::Error::last_os_error();
        error.raw_os_error() == Some(libc::EPERM)
    }

    #[cfg(target_os = "windows")]
    fn is_process_running(pid: u32) -> bool {
        use windows::Win32::Foundation::{CloseHandle, BOOL, STILL_ACTIVE};
        use windows::Win32::System::Threading::{
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };

        let Ok(handle) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, BOOL(0), pid) })
        else {
            return false;
        };

        let mut exit_code = 0u32;
        let result = unsafe { GetExitCodeProcess(handle, &mut exit_code) }.is_ok();
        let _ = unsafe { CloseHandle(handle) };
        result && exit_code == STILL_ACTIVE.0 as u32
    }

    struct TempTestDir {
        path: PathBuf,
    }

    impl TempTestDir {
        fn new(prefix: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("pmp-{prefix}-{}-{unique}", std::process::id()));
            fs::create_dir_all(&path).expect("create temp dir");
            Self { path }
        }
    }

    impl Drop for TempTestDir {
        fn drop(&mut self) {
            remove_dir_if_exists(&self.path);
        }
    }

    fn remove_dir_if_exists(path: &Path) {
        let _ = fs::remove_dir_all(path);
    }
}
