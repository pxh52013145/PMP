use once_cell::sync::Lazy;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

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
    applied_generation: u64,
    sample_rate: u32,
    channels: usize,
    capacity_frames: u32,
    client: BridgeClient,
    shm_in_name: String,
    shm_out_name: String,
}

static SESSIONS: Lazy<Mutex<HashMap<String, VstNodeSession>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static SHM_NONCE: AtomicU64 = AtomicU64::new(0);

pub fn list_plugins() -> Result<Vec<BridgePluginDescriptor>, String> {
    let plugins = crate::vst_bridge::list_plugins()?;
    let plugins = plugins
        .into_iter()
        .filter(|plugin| !is_demo_vst_plugin_id(plugin.id.as_str()))
        .collect::<Vec<_>>();
    vst_audit::record_scan_snapshot(&plugins);

    let run_id = format!(
        "legacy-list-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    let started_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let _ = crate::vst_library::record_scan_run_started(&run_id, started_at_ms, "legacy");
    for plugin in &plugins {
        let _ = crate::vst_library::upsert_plugin_snapshot(&run_id, plugin);
    }
    let finished_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let _ = crate::vst_library::record_scan_run_finished(&run_id, finished_at_ms, "ok", None);

    Ok(plugins)
}

pub fn describe_plugin(plugin_id: &str) -> Result<BridgePluginDescriptor, String> {
    if is_demo_vst_plugin_id(plugin_id) {
        return Err("Demo VST entry was removed: demo.gain".to_string());
    }
    crate::vst_bridge::describe_plugin(plugin_id)
}

fn resolve_capacity_frames(requested: u32) -> u32 {
    let requested = requested.max(1);
    let from_env = std::env::var("PMP_VST_BRIDGE_AUDIO_CAPACITY_FRAMES")
        .ok()
        .and_then(|raw| raw.parse::<u32>().ok())
        .filter(|value| *value > 0);
    match from_env {
        Some(value) => value.max(requested),
        None => requested,
    }
}

fn shm_handshake_timeout() -> Duration {
    std::env::var("PMP_VST_BRIDGE_SHM_HANDSHAKE_TIMEOUT_MS")
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .map(Duration::from_millis)
        .unwrap_or_else(|| Duration::from_millis(30_000))
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
        let desired_generation = crate::vst_instance_manager::desired_generation(node_id, plugin_id)
            .unwrap_or(0);

        let needs_apply = {
            let map = match SESSIONS.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            match map.get(node_id) {
                Some(existing) if existing.plugin_id == plugin_id => {
                    desired_generation > 0 && existing.applied_generation != desired_generation
                }
                _ => false,
            }
        };

        if needs_apply {
            let desired_params = crate::vst_instance_manager::desired_params(node_id, plugin_id);

            let mut session = {
                let mut map = match SESSIONS.lock() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                map.remove(node_id)
            }
            .ok_or_else(|| "VST session missing".to_string())?;

            let result = session.client.set_params(&desired_params);
            if result.is_ok() {
                session.applied_generation = desired_generation;
            } else if let Err(err) = result {
                eprintln!(
                    "[VST] Failed to refresh params (node={node_id}, plugin={plugin_id}): {err}"
                );
            }

            let info = VstAudioSessionInfo {
                node_id: node_id.to_string(),
                plugin_id: session.plugin_id.clone(),
                shm_in_name: session.shm_in_name.clone(),
                shm_out_name: session.shm_out_name.clone(),
                sample_rate: session.sample_rate,
                channels: session.channels,
                capacity_frames: session.capacity_frames,
            };

            let mut map = match SESSIONS.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            map.insert(node_id.to_string(), session);
            return Ok(info);
        }

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

    let plugin_path = crate::vst_library::lookup_plugin_path(plugin_id)
        .or_else(|| crate::vst_audit::lookup_last_scan_path(plugin_id))
        .ok_or_else(|| {
        format!(
            "VST plugin not in scan cache: {plugin_id}. Run Scan Plugins in VST Manager first."
        )
    })?;

    let nonce = SHM_NONCE.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();

    let shm_in_name = format!("Local\\pmp-vst-in-{node_id}-{pid}-{nonce}");
    let shm_out_name = format!("Local\\pmp-vst-out-{node_id}-{pid}-{nonce}");

    let shm_in = ShmRing::create(&shm_in_name, sample_rate, channels as u32, capacity_frames)?;
    let shm_out = ShmRing::create(&shm_out_name, sample_rate, channels as u32, capacity_frames)?;

    let mut client = match BridgeClient::spawn(
        plugin_id,
        plugin_path.as_str(),
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
    if let Err(err) = client
        .ping()
        .map_err(|e| format!("Bridge ping failed: {e}"))
    {
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

    let desired_generation =
        crate::vst_instance_manager::desired_generation(node_id, plugin_id).unwrap_or(0);
    let desired_params = crate::vst_instance_manager::desired_params(node_id, plugin_id);
    let mut applied_generation = 0u64;
    if desired_generation > 0 {
        if desired_params.is_empty() {
            applied_generation = desired_generation;
        } else if let Err(err) = client.set_params(&desired_params) {
            eprintln!(
                "[VST] Failed to apply cached params (node={node_id}, plugin={plugin_id}): {err}"
            );
        } else {
            applied_generation = desired_generation;
        }
    }

    let mut map = match SESSIONS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    map.insert(
        node_id.to_string(),
        VstNodeSession {
            plugin_id: plugin_id.to_string(),
            applied_generation,
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
    ensure_session_internal(
        node_id,
        plugin_id,
        sample_rate,
        channels,
        capacity_frames,
        true,
    )
}

pub fn open_native_editor(
    app: &AppHandle,
    node_id: String,
    title: Option<String>,
) -> Result<(), String> {
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

    let owner_hwnd = {
        #[cfg(target_os = "windows")]
        {
            app.get_window(crate::windows::MAIN_WINDOW_LABEL)
                .and_then(|window| window.hwnd().ok())
                .map(|hwnd| hwnd.0 as u64)
        }
        #[cfg(not(target_os = "windows"))]
        {
            None
        }
    };

    let result = session
        .client
        .open_editor_window(title.as_deref(), owner_hwnd, true)
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

pub fn set_params(
    app: &AppHandle,
    node_id: String,
    params: Vec<VstParamValue>,
) -> Result<(), String> {
    let plugin_id = crate::dsp_graph::resolve_vst_plugin_id(app, node_id.as_str())?;
    ensure_control_session(node_id.as_str(), plugin_id.as_str())?;
    crate::vst_instance_manager::set_node_params(node_id.as_str(), plugin_id.as_str(), params.clone());
    let desired_generation =
        crate::vst_instance_manager::desired_generation(node_id.as_str(), plugin_id.as_str())
            .unwrap_or(0);

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
        session.applied_generation = desired_generation;
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
