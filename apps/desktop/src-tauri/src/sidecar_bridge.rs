use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::Duration;
use tauri::Manager;

pub const EVENT_PLUGIN_SIDECAR_BRIDGE_MESSAGE: &str = "plugin-sidecar-bridge-message";

const BRIDGE_VERSION: &str = "1.0";
const CHILD_EXIT_POLL_INTERVAL_MS: u64 = 50;
const MAX_STDERR_TAIL_BYTES: usize = 8 * 1024;

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
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    terminating: Arc<AtomicBool>,
    stderr_tail: Arc<Mutex<Vec<u8>>>,
}

#[derive(Default)]
struct SidecarBridgeRegistryInner {
    sessions: RwLock<HashMap<String, Arc<SidecarBridgeSession>>>,
}

impl Drop for SidecarBridgeRegistryInner {
    fn drop(&mut self) {
        if let Ok(mut sessions) = self.sessions.write() {
            for (_, session) in sessions.drain() {
                session.terminating.store(true, Ordering::Release);
                let _ = terminate_child_process(&session.child);
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
        let session_id = request.runtime_instance_id.clone();
        let command_id = request.command_id.clone();
        let timeout_ms = request.timeout_ms;

        {
            let sessions = self
                .inner
                .sessions
                .read()
                .map_err(|_| "Sidecar bridge registry lock poisoned".to_string())?;
            if sessions.contains_key(&session_id) {
                return Err(format!(
                    "Sidecar runtime bridge session already exists: {}",
                    session_id
                ));
            }
        }

        let mut child = spawn_sidecar_process(&request)?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to open sidecar stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to open sidecar stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to open sidecar stderr".to_string())?;

        let session = Arc::new(SidecarBridgeSession {
            session_id: session_id.clone(),
            plugin_id: request.plugin_id,
            runtime_id: request.runtime_id,
            runtime_instance_id: request.runtime_instance_id,
            child: Arc::new(Mutex::new(child)),
            stdin: Arc::new(Mutex::new(Some(stdin))),
            terminating: Arc::new(AtomicBool::new(false)),
            stderr_tail: Arc::new(Mutex::new(Vec::new())),
        });

        {
            let mut sessions = self
                .inner
                .sessions
                .write()
                .map_err(|_| "Sidecar bridge registry lock poisoned".to_string())?;
            sessions.insert(session_id.clone(), session.clone());
        }

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
                .field("timeoutMs", json!(timeout_ms)),
        );
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
                    .field("reason", json!(reason.unwrap_or("unknown"))),
            );
        }

        session.terminating.store(true, Ordering::Release);

        if let Ok(mut stdin) = session.stdin.lock() {
            stdin.take();
        }

        terminate_child_process(&session.child)
    }

    fn get_session(&self, session_id: &str) -> Result<Option<Arc<SidecarBridgeSession>>, String> {
        let sessions = self
            .inner
            .sessions
            .read()
            .map_err(|_| "Sidecar bridge registry lock poisoned".to_string())?;
        Ok(sessions.get(session_id).cloned())
    }

    fn remove_session(
        &self,
        session_id: &str,
    ) -> Result<Option<Arc<SidecarBridgeSession>>, String> {
        let mut sessions = self
            .inner
            .sessions
            .write()
            .map_err(|_| "Sidecar bridge registry lock poisoned".to_string())?;
        Ok(sessions.remove(session_id))
    }
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
            let mut child = match session.child.lock() {
                Ok(child) => child,
                Err(_) => {
                    emit_sidecar_runtime_error(
                        &app,
                        &session,
                        "Sidecar child lock poisoned while waiting for exit".to_string(),
                        None,
                    );
                    let _ = registry.remove_session(&session.session_id);
                    return;
                }
            };

            match child.try_wait() {
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

fn spawn_sidecar_process(request: &SidecarBridgeOpenRequest) -> Result<Child, String> {
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

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
        .spawn()
        .map_err(|error| format!("Failed to spawn sidecar process: {error}"))
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

fn terminate_child_process(child: &Arc<Mutex<Child>>) -> Result<(), String> {
    let mut child = child
        .lock()
        .map_err(|_| "Sidecar child lock poisoned".to_string())?;

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

    child
        .wait()
        .map(|_| ())
        .map_err(|error| format!("Wait sidecar process failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{
        build_sidecar_launch_command, resolve_sidecar_entry_path, spawn_sidecar_process,
        SidecarBridgeOpenRequest,
    };
    use serde_json::{json, Value};
    use std::io::{BufRead, BufReader, Write};
    use std::path::PathBuf;
    use std::process::Command;

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
    fn spawns_node_sidecar_fixture_and_completes_bridge_handshake() {
        let Ok(output) = Command::new("node").arg("--version").output() else {
            return;
        };
        if !output.status.success() {
            return;
        }

        let entry = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../community/plugins/sidecar-echo-demo/sidecar/echo-runtime.js")
            .canonicalize()
            .expect("sidecar fixture path");

        let mut child = spawn_sidecar_process(&SidecarBridgeOpenRequest {
            plugin_id: "sidecar-echo-demo".to_string(),
            runtime_id: "sidecar.echo".to_string(),
            runtime_instance_id: "sidecar-test-instance".to_string(),
            entry_path: entry.to_string_lossy().to_string(),
            command_id: "sidecar-echo-demo.run".to_string(),
            args: None,
            timeout_ms: 2_000,
        })
        .expect("spawn sidecar");

        let mut stdin = child.stdin.take().expect("sidecar stdin");
        let stdout = child.stdout.take().expect("sidecar stdout");
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

        let _ = child.kill();
        let _ = child.wait();
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
}
