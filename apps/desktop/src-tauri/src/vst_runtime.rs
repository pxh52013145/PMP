use once_cell::sync::Lazy;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::AppHandle;

use crate::dsp_graph::VstParamValue;
use crate::vst_audit::{self, VstAuditEventKind};
use crate::vst_bridge::{BridgeClient, BridgeParamValue, BridgePluginDescriptor};
use crate::vst_governance;
use crate::vst_shm::ShmRing;

const DEMO_VST_PLUGIN_ID: &str = "demo.gain";

fn is_demo_vst_plugin_id(plugin_id: &str) -> bool {
    plugin_id.trim() == DEMO_VST_PLUGIN_ID
}

#[derive(Clone, Debug)]
pub struct VstAudioSessionInfo {
    pub node_id: String,
    pub plugin_id: String,
    pub shm_in_name: String,
    pub shm_out_name: String,
    pub sample_rate: u32,
    pub channels: usize,
    pub capacity_frames: u32,
}

struct VstNodeSession {
    plugin_id: String,
    sample_rate: u32,
    channels: usize,
    capacity_frames: u32,
    client: BridgeClient,
    shm_in_name: String,
    shm_out_name: String,
}

static SESSIONS: Lazy<Mutex<HashMap<String, VstNodeSession>>> = Lazy::new(|| Mutex::new(HashMap::new()));
static SHM_NONCE: AtomicU64 = AtomicU64::new(0);

pub fn list_plugins() -> Result<Vec<BridgePluginDescriptor>, String> {
    let plugins = crate::vst_bridge::list_plugins()?;
    let plugins = plugins
        .into_iter()
        .filter(|plugin| !is_demo_vst_plugin_id(plugin.id.as_str()))
        .collect::<Vec<_>>();
    vst_audit::record_scan_snapshot(&plugins);
    Ok(plugins)
}

pub fn describe_plugin(plugin_id: &str) -> Result<BridgePluginDescriptor, String> {
    if is_demo_vst_plugin_id(plugin_id) {
        return Err("Demo VST entry was removed: demo.gain".to_string());
    }
    crate::vst_bridge::describe_plugin(plugin_id)
}

fn resolve_capacity_frames(requested: u32) -> u32 {
    std::env::var("PMP_VST_BRIDGE_AUDIO_CAPACITY_FRAMES")
        .ok()
        .and_then(|raw| raw.parse::<u32>().ok())
        .filter(|value| *value > 0)
        .unwrap_or_else(|| requested.max(1))
}

fn shm_handshake_timeout() -> Duration {
    std::env::var("PMP_VST_BRIDGE_SHM_HANDSHAKE_TIMEOUT_MS")
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .map(Duration::from_millis)
        .unwrap_or_else(|| Duration::from_millis(10_000))
}

fn ensure_session_internal(
    node_id: &str,
    plugin_id: &str,
    sample_rate: u32,
    channels: usize,
    capacity_frames: u32,
    enforce_format: bool,
) -> Result<VstAudioSessionInfo, String> {
    if vst_governance::is_plugin_disabled(plugin_id) {
        return Err(format!("VST plugin is disabled by governance: {plugin_id}"));
    }

    let sample_rate = sample_rate.max(1);
    let channels = channels.max(1);
    let capacity_frames = resolve_capacity_frames(capacity_frames.max(1));

    let needs_spawn = {
        let map = match SESSIONS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        match map.get(node_id) {
            Some(existing) if existing.plugin_id == plugin_id => {
                if enforce_format {
                    existing.sample_rate != sample_rate
                        || existing.channels != channels
                        || existing.capacity_frames != capacity_frames
                } else {
                    false
                }
            }
            Some(_) => true,
            None => true,
        }
    };

    if !needs_spawn {
        let map = match SESSIONS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let existing = map
            .get(node_id)
            .ok_or_else(|| "VST session missing".to_string())?;
        return Ok(VstAudioSessionInfo {
            node_id: node_id.to_string(),
            plugin_id: existing.plugin_id.clone(),
            shm_in_name: existing.shm_in_name.clone(),
            shm_out_name: existing.shm_out_name.clone(),
            sample_rate: existing.sample_rate,
            channels: existing.channels,
            capacity_frames: existing.capacity_frames,
        });
    }

    let removed = {
        let mut map = match SESSIONS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.remove(node_id)
    };
    if let Some(mut session) = removed {
        let _ = session.client.dispose();
        session.client.kill();
    }

    let nonce = SHM_NONCE.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();

    let shm_in_name = format!("Local\\pmp-vst-in-{node_id}-{pid}-{nonce}");
    let shm_out_name = format!("Local\\pmp-vst-out-{node_id}-{pid}-{nonce}");

    let shm_in = ShmRing::create(&shm_in_name, sample_rate, channels as u32, capacity_frames)?;
    let shm_out = ShmRing::create(&shm_out_name, sample_rate, channels as u32, capacity_frames)?;

    let mut client = match BridgeClient::spawn(
        plugin_id,
        sample_rate,
        channels,
        Some(shm_in_name.as_str()),
        Some(shm_out_name.as_str()),
    ) {
        Ok(client) => client,
        Err(err) => {
            vst_audit::record_event(
                VstAuditEventKind::SessionSpawnFailed,
                Some(node_id.to_string()),
                Some(plugin_id.to_string()),
                err.clone(),
            );
            return Err(err);
        }
    };
    if let Err(err) = client.ping().map_err(|e| format!("Bridge ping failed: {e}")) {
        vst_audit::record_event(
            VstAuditEventKind::SessionSpawnFailed,
            Some(node_id.to_string()),
            Some(plugin_id.to_string()),
            err.clone(),
        );
        return Err(err);
    }

    let deadline = Instant::now() + shm_handshake_timeout();
    while Instant::now() < deadline {
        if shm_in.header().is_peer_ready() && shm_out.header().is_peer_ready() {
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }
    if !shm_in.header().is_peer_ready() || !shm_out.header().is_peer_ready() {
        client.kill();
        vst_audit::record_event(
            VstAuditEventKind::SessionHandshakeTimeout,
            Some(node_id.to_string()),
            Some(plugin_id.to_string()),
            "Bridge shared memory handshake timed out".to_string(),
        );
        return Err("Bridge shared memory handshake timed out".to_string());
    }

    let mut map = match SESSIONS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    map.insert(
        node_id.to_string(),
        VstNodeSession {
            plugin_id: plugin_id.to_string(),
            sample_rate,
            channels,
            capacity_frames,
            client,
            shm_in_name: shm_in_name.clone(),
            shm_out_name: shm_out_name.clone(),
        },
    );

    Ok(VstAudioSessionInfo {
        node_id: node_id.to_string(),
        plugin_id: plugin_id.to_string(),
        shm_in_name,
        shm_out_name,
        sample_rate,
        channels,
        capacity_frames,
    })
}

fn ensure_control_session(node_id: &str, plugin_id: &str) -> Result<(), String> {
    let _ = ensure_session_internal(node_id, plugin_id, 48_000, 2, 8192, false)?;
    Ok(())
}

pub fn ensure_audio_session(
    node_id: &str,
    plugin_id: &str,
    sample_rate: u32,
    channels: usize,
    capacity_frames: u32,
) -> Result<VstAudioSessionInfo, String> {
    ensure_session_internal(node_id, plugin_id, sample_rate, channels, capacity_frames, true)
}

pub fn open_native_editor(app: &AppHandle, node_id: String, title: Option<String>) -> Result<(), String> {
    let plugin_id = crate::dsp_graph::resolve_vst_plugin_id(app, node_id.as_str())?;

    ensure_control_session(node_id.as_str(), plugin_id.as_str())?;

    let mut session = {
        let mut map = match SESSIONS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.remove(node_id.as_str())
            .ok_or_else(|| "VST session missing".to_string())?
    };

    let result = session
        .client
        .open_editor_window(title.as_deref())
        .map_err(|e| format!("Bridge open editor failed: {e}"));

    if result.is_ok() {
        let mut map = match SESSIONS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.insert(node_id, session);
    }

    result
}

pub fn close_native_editor(node_id: String) -> Result<(), String> {
    let session = {
        let mut map = match SESSIONS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.remove(node_id.as_str())
    };

    let Some(mut session) = session else {
        return Ok(());
    };

    let result = session
        .client
        .close_editor_window()
        .map_err(|e| format!("Bridge close editor failed: {e}"));

    if result.is_ok() {
        let mut map = match SESSIONS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.insert(node_id, session);
    }

    result
}

pub fn set_params(app: &AppHandle, node_id: String, params: Vec<VstParamValue>) -> Result<(), String> {
    let plugin_id = crate::dsp_graph::resolve_vst_plugin_id(app, node_id.as_str())?;
    ensure_control_session(node_id.as_str(), plugin_id.as_str())?;

    let mut session = {
        let mut map = match SESSIONS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.remove(node_id.as_str())
    }
    .ok_or_else(|| "VST session missing".to_string())?;

    let mapped = params
        .iter()
        .map(|p| (p.key.clone(), p.value))
        .collect::<Vec<_>>();

    let result = session
        .client
        .set_params(&mapped)
        .map_err(|e| format!("Bridge set params failed: {e}"));

    if result.is_ok() {
        let mut map = match SESSIONS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.insert(node_id, session);
    }

    result
}

pub fn get_params(app: &AppHandle, node_id: String) -> Result<Vec<VstParamValue>, String> {
    let plugin_id = crate::dsp_graph::resolve_vst_plugin_id(app, node_id.as_str())?;
    ensure_control_session(node_id.as_str(), plugin_id.as_str())?;

    let mut session = {
        let mut map = match SESSIONS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.remove(node_id.as_str())
    }
    .ok_or_else(|| "VST session missing".to_string())?;

    let result = session
        .client
        .get_params()
        .map_err(|e| format!("Bridge get params failed: {e}"));

    match result {
        Ok(values) => {
            let mut map = match SESSIONS.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            map.insert(node_id, session);

            Ok(values
                .into_iter()
                .map(|BridgeParamValue { key, value }| VstParamValue { key, value })
                .collect())
        }
        Err(error) => Err(error),
    }
}

pub fn dispose_session(node_id: String) -> Result<(), String> {
    let mut session = {
        let mut map = match SESSIONS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.remove(node_id.as_str())
    }
    .ok_or_else(|| "VST session missing".to_string())?;

    let result = session
        .client
        .dispose()
        .map_err(|e| format!("Bridge dispose failed: {e}"));

    session.client.kill();
    result
}

pub fn close_all() {
    let mut map = match SESSIONS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    for (_, mut session) in map.drain() {
        let _ = session.client.dispose();
        session.client.kill();
    }
}

pub fn dispose_sessions_except(keep: &[String]) {
    let keep_set: HashSet<&str> = keep.iter().map(|id| id.as_str()).collect();

    let removed: Vec<VstNodeSession> = {
        let mut map = match SESSIONS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let mut out = Vec::new();
        let keys = map.keys().cloned().collect::<Vec<_>>();
        for key in keys {
            if keep_set.contains(key.as_str()) {
                continue;
            }
            if let Some(session) = map.remove(key.as_str()) {
                out.push(session);
            }
        }
        out
    };

    for mut session in removed {
        let _ = session.client.dispose();
        session.client.kill();
    }
}
