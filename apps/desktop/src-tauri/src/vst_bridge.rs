use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
};

pub const MSG_SET_PARAMS: u8 = 1;
pub const MSG_PROCESS_AUDIO: u8 = 2;
pub const MSG_OPEN_EDITOR: u8 = 3;
pub const MSG_CLOSE_EDITOR: u8 = 4;
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
    pub parameters: Vec<BridgeParamDescriptor>,
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

pub fn list_plugins() -> Result<Vec<BridgePluginDescriptor>, String> {
    let bridge = bridge_executable_path()?;
    let output = Command::new(bridge)
        .arg("--list-plugins")
        .output()
        .map_err(|e| format!("Failed to run bridge: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Bridge list failed: {stderr}"));
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("Failed to parse bridge plugins: {e}"))
}

pub fn describe_plugin(plugin_id: &str) -> Result<BridgePluginDescriptor, String> {
    let bridge = bridge_executable_path()?;
    let output = Command::new(bridge)
        .arg("--describe-plugin")
        .arg(plugin_id)
        .output()
        .map_err(|e| format!("Failed to run bridge: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Bridge describe failed: {stderr}"));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse bridge plugin descriptor: {e}"))
}

pub struct BridgeClient {
    _child: Child,
    stdin: ChildStdin,
    stdout: ChildStdout,
}

impl BridgeClient {
    pub fn spawn(plugin_id: &str, sample_rate: u32, channels: usize) -> Result<Self, String> {
        let bridge = bridge_executable_path()?;
        let debug_stderr = matches!(
            std::env::var("PMP_RACK_VST3_DEBUG").as_deref(),
            Ok("1")
        ) || matches!(std::env::var("PMP_VST_BRIDGE_DEBUG").as_deref(), Ok("1"))
            || matches!(std::env::var("PMP_VST_BRIDGE_STDERR").as_deref(), Ok("1"));
        let mut child = Command::new(bridge)
            .arg("--plugin-id")
            .arg(plugin_id)
            .arg("--sample-rate")
            .arg(sample_rate.to_string())
            .arg("--channels")
            .arg(channels.to_string())
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
        Ok(Self {
            _child: child,
            stdin,
            stdout,
        })
    }

    pub fn set_params(&mut self, params: &[(String, f32)]) -> Result<(), String> {
        let payload = serde_json::to_vec(&serde_json::json!({
            "params": params.iter().map(|(key, value)| serde_json::json!({ "key": key, "value": value })).collect::<Vec<_>>()
        }))
        .map_err(|e| format!("Failed to encode params: {e}"))?;

        write_message(&mut self.stdin, MSG_SET_PARAMS, &payload)
            .map_err(|e| format!("Failed to send params: {e}"))?;
        let (ty, payload) =
            read_message(&mut self.stdout).map_err(|e| format!("Failed to read params ack: {e}"))?;
        if ty == MSG_ERROR {
            return Err(parse_error_payload(&payload));
        }
        if ty != MSG_SET_PARAMS {
            return Err(format!("Unexpected bridge response type: {ty}"));
        }
        Ok(())
    }

    pub fn process_audio(&mut self, input: &[f32], output: &mut Vec<f32>) -> Result<(), String> {
        let sample_count = input.len() as u32;
        let payload_len = 4u32
            .checked_add(sample_count.saturating_mul(4))
            .ok_or_else(|| "Bridge payload length overflow".to_string())?;

        self.stdin
            .write_all(&[MSG_PROCESS_AUDIO])
            .and_then(|_| self.stdin.write_all(&payload_len.to_le_bytes()))
            .and_then(|_| self.stdin.write_all(&sample_count.to_le_bytes()))
            .map_err(|e| format!("Failed to write audio request: {e}"))?;

        for sample in input {
            self.stdin
                .write_all(&sample.to_le_bytes())
                .map_err(|e| format!("Failed to write audio sample: {e}"))?;
        }
        self.stdin
            .flush()
            .map_err(|e| format!("Failed to flush audio request: {e}"))?;

        let (ty, payload) =
            read_message(&mut self.stdout).map_err(|e| format!("Failed to read audio response: {e}"))?;
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
        let payload = serde_json::to_vec(&serde_json::json!({ "title": title })).map_err(|e| e.to_string())?;
        write_message(&mut self.stdin, MSG_OPEN_EDITOR, &payload).map_err(|e| e.to_string())?;
        let (ty, payload) = read_message(&mut self.stdout).map_err(|e| e.to_string())?;
        if ty == MSG_ERROR {
            return Err(parse_error_payload(&payload));
        }
        if ty != MSG_OPEN_EDITOR {
            return Err(format!("Unexpected bridge response type: {ty}"));
        }
        Ok(())
    }

    pub fn close_editor_window(&mut self) -> Result<(), String> {
        write_message(&mut self.stdin, MSG_CLOSE_EDITOR, &[]).map_err(|e| e.to_string())?;
        let (ty, payload) = read_message(&mut self.stdout).map_err(|e| e.to_string())?;
        if ty == MSG_ERROR {
            return Err(parse_error_payload(&payload));
        }
        if ty != MSG_CLOSE_EDITOR {
            return Err(format!("Unexpected bridge response type: {ty}"));
        }
        Ok(())
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
        if let Some(message) = value.get("message").and_then(|v| v.as_str()) {
            return message.to_string();
        }
    }
    String::from_utf8_lossy(payload).to_string()
}
