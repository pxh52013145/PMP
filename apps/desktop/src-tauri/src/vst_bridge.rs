use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, ExitStatus, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

pub const BRIDGE_PROTOCOL_VERSION: u32 = 1;

pub const MSG_SET_PARAMS: u8 = 1;
pub const MSG_PROCESS_AUDIO: u8 = 2;
pub const MSG_OPEN_EDITOR: u8 = 3;
pub const MSG_CLOSE_EDITOR: u8 = 4;
pub const MSG_PING: u8 = 5;
pub const MSG_SCAN_PLUGINS: u8 = 6;
pub const MSG_DESCRIBE_PLUGIN: u8 = 7;
pub const MSG_GET_PARAMS: u8 = 8;
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
    pub parameters: Vec<BridgeParamDescriptor>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeParamValue {
    pub key: String,
    pub value: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgePingResponse {
    pub protocol_version: u32,
    pub plugin_id: Option<String>,
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

fn bridge_list_timeout() -> Duration {
    timeout_from_env_ms("PMP_VST_BRIDGE_LIST_TIMEOUT_MS", 60_000)
}

fn bridge_describe_timeout() -> Duration {
    timeout_from_env_ms("PMP_VST_BRIDGE_DESCRIBE_TIMEOUT_MS", 20_000)
}

fn bridge_request_timeout() -> Duration {
    timeout_from_env_ms("PMP_VST_BRIDGE_REQUEST_TIMEOUT_MS", 2_500)
}

fn bridge_editor_timeout() -> Duration {
    timeout_from_env_ms("PMP_VST_BRIDGE_EDITOR_TIMEOUT_MS", 10_000)
}

fn bridge_ping_timeout() -> Duration {
    timeout_from_env_ms("PMP_VST_BRIDGE_PING_TIMEOUT_MS", 10_000)
}

fn bridge_executable_path() -> Result<PathBuf, String> {
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
    let candidate = dir.join(file_name);
    if candidate.exists() {
        return Ok(candidate);
    }
    Err(format!(
        "Bridge executable not found at: {}",
        candidate.display()
    ))
}

struct BridgeOutput {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

fn run_bridge_cli(args: &[&str], timeout: Duration) -> Result<BridgeOutput, String> {
    let bridge = bridge_executable_path()?;
    let mut child = Command::new(bridge)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
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
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(err) => return Err(format!("Failed to poll bridge process: {err}")),
        }

        if start.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "Bridge command timed out after {}ms: {}",
                timeout.as_millis(),
                args.join(" ")
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
    let output = run_bridge_cli(&["--list-plugins"], bridge_list_timeout())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Bridge list failed: {stderr}"));
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("Failed to parse bridge plugins: {e}"))
}

pub fn describe_plugin(plugin_id: &str) -> Result<BridgePluginDescriptor, String> {
    let output = run_bridge_cli(
        &["--describe-plugin", plugin_id],
        bridge_describe_timeout(),
    )?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Bridge describe failed: {stderr}"));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse bridge plugin descriptor: {e}"))
}

pub struct BridgeClient {
    child: Child,
    request_tx: Option<mpsc::Sender<BridgeRequest>>,
    worker: Option<thread::JoinHandle<()>>,
}

impl BridgeClient {
    pub fn spawn(
        plugin_id: &str,
        sample_rate: u32,
        channels: usize,
        shm_in: Option<&str>,
        shm_out: Option<&str>,
    ) -> Result<Self, String> {
        let bridge = bridge_executable_path()?;
        let debug_stderr = matches!(
            std::env::var("PMP_RACK_VST3_DEBUG").as_deref(),
            Ok("1")
        ) || matches!(std::env::var("PMP_VST_BRIDGE_DEBUG").as_deref(), Ok("1"))
            || matches!(std::env::var("PMP_VST_BRIDGE_STDERR").as_deref(), Ok("1"));
        let mut cmd = Command::new(bridge);
        cmd.arg("--plugin-id")
            .arg(plugin_id)
            .arg("--sample-rate")
            .arg(sample_rate.to_string())
            .arg("--channels")
            .arg(channels.to_string());

        if let (Some(shm_in), Some(shm_out)) = (shm_in, shm_out) {
            let shm_mode_raw =
                std::env::var("PMP_VST_BRIDGE_SHM_AUDIO_MODE").unwrap_or_else(|_| "process".to_string());
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

        let mut child = cmd.stdin(Stdio::piped())
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

    fn request_raw(&mut self, ty: u8, payload: Vec<u8>, timeout: Duration) -> Result<(u8, Vec<u8>), String> {
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
                self.kill();
                Err(format!("Bridge request timed out after {}ms", timeout.as_millis()))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                self.kill();
                Err("Bridge worker disconnected".to_string())
            }
        }
    }

    pub fn ping(&mut self) -> Result<BridgePingResponse, String> {
        let payload = serde_json::to_vec(&serde_json::json!({
            "protocolVersion": BRIDGE_PROTOCOL_VERSION,
        }))
        .map_err(|e| format!("Failed to encode ping payload: {e}"))?;

        let (ty, payload) = self.request_raw(MSG_PING, payload, bridge_ping_timeout())?;
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

        let (ty, payload) = self.request_raw(MSG_SET_PARAMS, payload, bridge_request_timeout())?;
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

        let (ty, payload) = self.request_raw(MSG_GET_PARAMS, payload, bridge_request_timeout())?;
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

    pub fn process_audio(&mut self, input: &[f32], output: &mut Vec<f32>) -> Result<(), String> {
        let sample_count = input.len() as u32;
        let payload_len = 4usize
            .checked_add(input.len().saturating_mul(4))
            .ok_or_else(|| "Bridge payload length overflow".to_string())?;

        let mut payload = Vec::with_capacity(payload_len);
        payload.extend_from_slice(&sample_count.to_le_bytes());
        for sample in input {
            payload.extend_from_slice(&sample.to_le_bytes());
        }

        let (ty, payload) = self.request_raw(MSG_PROCESS_AUDIO, payload, bridge_request_timeout())?;
        if ty == MSG_ERROR {
            return Err(parse_error_payload(&payload));
        }
        if ty != MSG_PROCESS_AUDIO {
            return Err(format!("Unexpected bridge response type: {ty}"));
        }
        if payload.len() < 4 {
            return Err("Bridge audio response too short".to_string());
        }
        let mut count_bytes = [0u8; 4];
        count_bytes.copy_from_slice(&payload[..4]);
        let out_count = u32::from_le_bytes(count_bytes) as usize;
        let expected_bytes = 4usize
            .checked_add(out_count.saturating_mul(4))
            .ok_or_else(|| "Bridge audio response length overflow".to_string())?;
        if payload.len() != expected_bytes {
            return Err(format!(
                "Bridge audio response length mismatch: expected {expected_bytes}, got {}",
                payload.len()
            ));
        }

        output.clear();
        output.reserve(out_count.saturating_sub(output.len()));
        for idx in 0..out_count {
            let base = 4 + idx * 4;
            let mut bytes = [0u8; 4];
            bytes.copy_from_slice(&payload[base..base + 4]);
            output.push(f32::from_le_bytes(bytes));
        }
        Ok(())
    }

    pub fn open_editor_window(&mut self, title: Option<&str>) -> Result<(), String> {
        let payload = serde_json::to_vec(&serde_json::json!({
            "protocolVersion": BRIDGE_PROTOCOL_VERSION,
            "title": title
        }))
        .map_err(|e| e.to_string())?;

        let (ty, payload) = self.request_raw(MSG_OPEN_EDITOR, payload, bridge_editor_timeout())?;
        if ty == MSG_ERROR {
            return Err(parse_error_payload(&payload));
        }
        if ty != MSG_OPEN_EDITOR {
            return Err(format!("Unexpected bridge response type: {ty}"));
        }
        Ok(())
    }

    pub fn close_editor_window(&mut self) -> Result<(), String> {
        let (ty, payload) = self.request_raw(MSG_CLOSE_EDITOR, Vec::new(), bridge_editor_timeout())?;
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
    reader.read_exact(&mut ty)?;
    let mut len = [0u8; 4];
    reader.read_exact(&mut len)?;
    let len = u32::from_le_bytes(len) as usize;
    let mut payload = vec![0u8; len];
    reader.read_exact(&mut payload)?;
    Ok((ty[0], payload))
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
