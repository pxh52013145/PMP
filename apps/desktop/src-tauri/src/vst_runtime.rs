use once_cell::sync::Lazy;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

use crate::dsp_graph::VstParamValue;
use crate::vst_audit::{self, VstAuditEventKind};
use crate::vst_bridge::{
    BridgeClient, BridgeOpenEditorOptions, BridgeParamValue, BridgePluginDescriptor,
    BridgeRealtimeMetrics,
};
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VstSessionStatus {
    pub node_id: String,
    pub plugin_id: String,
    pub peer_ready: bool,
    pub plugin_loaded: bool,
    pub processing_active: bool,
    pub plugin_error: bool,
    pub native_editor_open: bool,
    pub heartbeat_in: Option<u32>,
    pub heartbeat_out: Option<u32>,
    pub callback_lock_miss_blocks: u64,
    pub callback_lock_miss_frames: u64,
    pub dry_bypass_frames: u64,
    pub shm_output_backpressure_blocks: u64,
    pub shm_output_backpressure_frames: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct VstSessionStatusCore {
    node_id: String,
    plugin_id: String,
    peer_ready: bool,
    plugin_loaded: bool,
    processing_active: bool,
    plugin_error: bool,
    native_editor_open: bool,
    callback_lock_miss_blocks: u64,
    callback_lock_miss_frames: u64,
    dry_bypass_frames: u64,
    shm_output_backpressure_blocks: u64,
    shm_output_backpressure_frames: u64,
}

impl VstSessionStatusCore {
    fn from_status(status: &VstSessionStatus) -> Self {
        Self {
            node_id: status.node_id.clone(),
            plugin_id: status.plugin_id.clone(),
            peer_ready: status.peer_ready,
            plugin_loaded: status.plugin_loaded,
            processing_active: status.processing_active,
            plugin_error: status.plugin_error,
            native_editor_open: status.native_editor_open,
            callback_lock_miss_blocks: status.callback_lock_miss_blocks,
            callback_lock_miss_frames: status.callback_lock_miss_frames,
            dry_bypass_frames: status.dry_bypass_frames,
            shm_output_backpressure_blocks: status.shm_output_backpressure_blocks,
            shm_output_backpressure_frames: status.shm_output_backpressure_frames,
        }
    }
}

struct VstNodeSession {
    plugin_id: String,
    applied_generation: u64,
    sample_rate: u32,
    channels: usize,
    capacity_frames: u32,
    sidechain_mode: crate::vst_settings::VstSidechainMode,
    sidechain_channels: u32,
    client: BridgeClient,
    shm_in_name: String,
    shm_out_name: String,
    // Keep SHM mappings alive for the entire session lifetime.
    // Otherwise, if the bridge closes/reopens its mapping handles (e.g. bypass -> process),
    // Windows may destroy the mapping and subsequent OpenFileMappingW calls will fail.
    shm_in: ShmRing,
    #[allow(dead_code)]
    shm_out: ShmRing,
}

static SESSIONS: Lazy<Mutex<HashMap<String, VstNodeSession>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static SHM_NONCE: AtomicU64 = AtomicU64::new(0);
static FIRST_SESSION_SPAWN: AtomicBool = AtomicBool::new(true);
static SESSION_STATUS_BROADCAST_STARTED: AtomicBool = AtomicBool::new(false);
static SESSION_STATUS_BROADCAST_APP: Lazy<Mutex<Option<AppHandle>>> =
    Lazy::new(|| Mutex::new(None));
static SESSION_STATUS_BROADCAST_STOP: AtomicBool = AtomicBool::new(false);
static LAST_REPORTED_BRIDGE_METRICS: Lazy<Mutex<HashMap<String, BridgeRealtimeMetrics>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Copy, Debug)]
struct EditorOpenCacheEntry {
    value: bool,
    checked_at: Instant,
}

static EDITOR_OPEN_CACHE: Lazy<Mutex<HashMap<String, EditorOpenCacheEntry>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

static EDITOR_OPEN_PING_TIMEOUT_LOG_AT_MS: Lazy<Mutex<HashMap<String, u64>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

const EVENT_VST_SESSION_STATUSES: &str = "vst-session-statuses";
const SESSION_STATUS_METRICS_PING_TIMEOUT_MS: u64 = 30;

fn editor_open_cache_ttl() -> Duration {
    Duration::from_millis(900)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn empty_bridge_realtime_metrics() -> BridgeRealtimeMetrics {
    BridgeRealtimeMetrics::default()
}

fn record_bridge_metric_delta(
    kind: &'static str,
    current: u64,
    previous: u64,
    aux_current: u64,
    aux_previous: u64,
) {
    if current <= previous && aux_current <= aux_previous {
        return;
    }

    crate::audio::diagnostics::record_event(
        kind,
        current.saturating_sub(previous),
        aux_current.saturating_sub(aux_previous),
    );
}

fn record_bridge_metrics_if_changed(node_id: &str, metrics: &BridgeRealtimeMetrics) {
    let mut last_map = match LAST_REPORTED_BRIDGE_METRICS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let previous = last_map.get(node_id).cloned().unwrap_or_default();

    record_bridge_metric_delta(
        "vst.sidecar.callback_lock_miss",
        metrics.callback_lock_miss_blocks,
        previous.callback_lock_miss_blocks,
        metrics.callback_lock_miss_frames,
        previous.callback_lock_miss_frames,
    );
    record_bridge_metric_delta(
        "vst.sidecar.dry_bypass",
        metrics.dry_bypass_frames,
        previous.dry_bypass_frames,
        0,
        0,
    );
    record_bridge_metric_delta(
        "vst.sidecar.output_backpressure",
        metrics.shm_output_backpressure_blocks,
        previous.shm_output_backpressure_blocks,
        metrics.shm_output_backpressure_frames,
        previous.shm_output_backpressure_frames,
    );

    last_map.insert(node_id.to_string(), metrics.clone());
}

fn prune_bridge_metrics(active_node_ids: &HashSet<String>) {
    let mut last_map = match LAST_REPORTED_BRIDGE_METRICS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    last_map.retain(|node_id, _| active_node_ids.contains(node_id));
}

fn maybe_log_editor_open_ping_timeout(node_id: &str, plugin_id: &str, err: &str) {
    // Rate limit: an open editor may trigger ping checks; avoid log spam.
    const INTERVAL_MS: u64 = 10_000;
    if !err.contains("timed out") {
        return;
    }

    let now = now_ms();
    let mut map = match EDITOR_OPEN_PING_TIMEOUT_LOG_AT_MS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let last = map.get(node_id).copied().unwrap_or(0);
    if now.saturating_sub(last) < INTERVAL_MS {
        return;
    }
    map.insert(node_id.to_string(), now);

    crate::backend_telemetry::warn_global(
        "vst",
        "vst.editor-open.ping.timeout",
        crate::backend_telemetry::BackendTelemetryOptions::new()
            .component("vst_runtime")
            .message(err.to_string())
            .field("nodeId", serde_json::json!(node_id))
            .field("pluginId", serde_json::json!(plugin_id)),
    );
}

fn cache_editor_open(node_id: &str, value: bool) {
    let mut cache = match EDITOR_OPEN_CACHE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    cache.insert(
        node_id.to_string(),
        EditorOpenCacheEntry {
            value,
            checked_at: Instant::now(),
        },
    );
}

fn query_editor_open(node_id: &str) -> Option<bool> {
    let session = {
        let mut map = match SESSIONS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.remove(node_id)
    };

    let Some(mut session) = session else {
        return None;
    };

    let ping_result = session
        .client
        .ping_with_timeout(Duration::from_millis(1_500));
    if let Err(err) = &ping_result {
        maybe_log_editor_open_ping_timeout(node_id, session.plugin_id.as_str(), err.as_str());
    }
    let ping_ok = ping_result.is_ok();
    let editor_open = ping_result.ok().and_then(|resp| resp.editor_open);

    let should_keep_session = ping_ok || session.client.check_alive().is_ok();
    if should_keep_session {
        let mut map = match SESSIONS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.insert(node_id.to_string(), session);
    }

    editor_open
}

fn is_editor_open_cached(node_id: &str) -> bool {
    let ttl = editor_open_cache_ttl();
    let now = Instant::now();

    let mut cached_value = false;
    let mut is_fresh = false;
    {
        let cache = match EDITOR_OPEN_CACHE.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(entry) = cache.get(node_id) {
            cached_value = entry.value;
            is_fresh = now.duration_since(entry.checked_at) < ttl;
        }
    }

    if is_fresh {
        return cached_value;
    }

    if !cached_value {
        cache_editor_open(node_id, false);
        return false;
    }

    match query_editor_open(node_id) {
        Some(value) => {
            cache_editor_open(node_id, value);
            value
        }
        None => {
            cache_editor_open(node_id, cached_value);
            cached_value
        }
    }
}

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
        .unwrap_or_else(|| Duration::from_millis(60_000))
}

fn bridge_ping_timeout() -> Duration {
    let ms = std::env::var("PMP_VST_BRIDGE_PING_TIMEOUT_MS")
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(5_000);
    Duration::from_millis(ms.clamp(500, 120_000))
}

fn shm_ring_version() -> u32 {
    std::env::var("PMP_VST_BRIDGE_SHM_VERSION")
        .ok()
        .and_then(|raw| raw.parse::<u32>().ok())
        .filter(|v| *v == 1 || *v == 2)
        .unwrap_or(2)
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
    let desired_shm_version = shm_ring_version();

    let settings = crate::vst_settings::cached_settings();
    let sidechain_mode = settings.sidechain_mode;
    let sidechain_channels = if sidechain_mode == crate::vst_settings::VstSidechainMode::Disabled {
        0
    } else {
        std::env::var("PMP_VST_BRIDGE_SHM_SIDECHAIN_CHANNELS")
            .ok()
            .and_then(|raw| raw.parse::<u32>().ok())
            .filter(|v| *v <= 2)
            .unwrap_or_else(|| {
                crate::vst_settings::effective_sidechain_channels(&settings, channels)
            })
    };

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
                        || existing.shm_in.shm_version() != desired_shm_version
                        || existing.sidechain_mode != sidechain_mode
                        || existing.sidechain_channels != sidechain_channels
                } else {
                    false
                }
            }
            Some(_) => true,
            None => true,
        }
    };

    if !needs_spawn {
        let desired_generation =
            crate::vst_instance_manager::desired_generation(node_id, plugin_id).unwrap_or(0);

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
                crate::backend_telemetry::warn_global(
                    "vst",
                    "vst.params.refresh.failed",
                    crate::backend_telemetry::BackendTelemetryOptions::new()
                        .component("vst_runtime")
                        .message(err)
                        .field("nodeId", serde_json::json!(node_id))
                        .field("pluginId", serde_json::json!(plugin_id)),
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
    if !std::path::Path::new(plugin_path.as_str()).exists() {
        crate::vst_library::mark_plugin_status(plugin_id, "missing");
        return Err(format!(
            "VST plugin file missing: {plugin_path}. Run Scan Plugins in VST Manager first."
        ));
    }

    let nonce = SHM_NONCE.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();

    let shm_in_name = format!("Local\\pmp-vst-in-{node_id}-{pid}-{nonce}");
    let shm_out_name = format!("Local\\pmp-vst-out-{node_id}-{pid}-{nonce}");

    let (shm_in, shm_out) = if desired_shm_version == 2 {
        let bus0 = channels as u32;
        let bus1 = sidechain_channels;
        let shm_in = ShmRing::create_v2(&shm_in_name, sample_rate, bus0, bus1, capacity_frames)?;
        // Output ring typically only needs main bus.
        let shm_out = ShmRing::create_v2(&shm_out_name, sample_rate, bus0, 0, capacity_frames)?;
        (shm_in, shm_out)
    } else {
        let shm_in =
            ShmRing::create_v1(&shm_in_name, sample_rate, channels as u32, capacity_frames)?;
        let shm_out =
            ShmRing::create_v1(&shm_out_name, sample_rate, channels as u32, capacity_frames)?;
        (shm_in, shm_out)
    };

    let mut client = match BridgeClient::spawn(
        plugin_id,
        plugin_path.as_str(),
        sample_rate,
        channels,
        Some(shm_in_name.as_str()),
        Some(shm_out_name.as_str()),
        sidechain_mode,
        sidechain_channels,
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

    let is_first_spawn = FIRST_SESSION_SPAWN.load(Ordering::Relaxed);
    let handshake_timeout = if is_first_spawn {
        shm_handshake_timeout().max(Duration::from_millis(120_000))
    } else {
        shm_handshake_timeout()
    };

    let deadline = Instant::now() + handshake_timeout;
    let mut last_alive_check = Instant::now();
    while Instant::now() < deadline {
        if last_alive_check.elapsed() >= Duration::from_millis(200) {
            if let Err(err) = client.check_alive() {
                vst_audit::record_event(
                    VstAuditEventKind::SessionSpawnFailed,
                    Some(node_id.to_string()),
                    Some(plugin_id.to_string()),
                    err.clone(),
                );
                return Err(err);
            }
            last_alive_check = Instant::now();
        }
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

    let ping_timeout = if is_first_spawn {
        bridge_ping_timeout().max(Duration::from_millis(30_000))
    } else {
        bridge_ping_timeout()
    };

    if let Err(err) = client
        .ping_with_timeout(ping_timeout)
        .map_err(|e| format!("Bridge ping failed: {e}"))
    {
        client.kill();
        vst_audit::record_event(
            VstAuditEventKind::SessionSpawnFailed,
            Some(node_id.to_string()),
            Some(plugin_id.to_string()),
            err.clone(),
        );
        return Err(err);
    }

    if is_first_spawn {
        FIRST_SESSION_SPAWN.store(false, Ordering::Relaxed);
    }

    let desired_generation =
        crate::vst_instance_manager::desired_generation(node_id, plugin_id).unwrap_or(0);
    let desired_params = crate::vst_instance_manager::desired_params(node_id, plugin_id);
    let mut applied_generation = 0u64;
    if desired_generation > 0 {
        if desired_params.is_empty() {
            applied_generation = desired_generation;
        } else if let Err(err) = client.set_params(&desired_params) {
            crate::backend_telemetry::warn_global(
                "vst",
                "vst.params.cached-apply.failed",
                crate::backend_telemetry::BackendTelemetryOptions::new()
                    .component("vst_runtime")
                    .message(err)
                    .field("nodeId", serde_json::json!(node_id))
                    .field("pluginId", serde_json::json!(plugin_id)),
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
            sidechain_mode,
            sidechain_channels,
            client,
            shm_in_name: shm_in_name.clone(),
            shm_out_name: shm_out_name.clone(),
            shm_in,
            shm_out,
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

pub fn init_session_status_broadcaster(app: &AppHandle) {
    {
        let mut guard = match SESSION_STATUS_BROADCAST_APP.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *guard = Some(app.clone());
    }

    if SESSION_STATUS_BROADCAST_STARTED.swap(true, Ordering::AcqRel) {
        return;
    }

    SESSION_STATUS_BROADCAST_STOP.store(false, Ordering::Release);
    std::thread::spawn(|| {
        let mut last_core: Vec<VstSessionStatusCore> = Vec::new();
        loop {
            if SESSION_STATUS_BROADCAST_STOP.load(Ordering::Acquire) {
                break;
            }
            let app = {
                let guard = match SESSION_STATUS_BROADCAST_APP.lock() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                guard.clone()
            };

            let Some(app) = app else {
                std::thread::sleep(Duration::from_millis(500));
                continue;
            };

            let mut statuses = list_session_statuses();
            statuses.sort_by(|a, b| a.node_id.cmp(&b.node_id));

            let mut current_core = statuses
                .iter()
                .map(VstSessionStatusCore::from_status)
                .collect::<Vec<_>>();
            current_core.sort_by(|a, b| a.node_id.cmp(&b.node_id));

            if current_core != last_core {
                if let Err(err) = app.emit_all(EVENT_VST_SESSION_STATUSES, statuses.clone()) {
                    crate::backend_telemetry::warn(
                        &app,
                        "vst",
                        "vst.session-status.emit.failed",
                        crate::backend_telemetry::BackendTelemetryOptions::new()
                            .component("vst_runtime")
                            .message(err.to_string()),
                    );
                }
                last_core = current_core;
            }

            if SESSION_STATUS_BROADCAST_STOP.load(Ordering::Acquire) {
                break;
            }
            if last_core.is_empty() {
                std::thread::sleep(Duration::from_millis(900));
            } else {
                std::thread::sleep(Duration::from_millis(240));
            }
        }
    });
}

pub fn shutdown_session_status_broadcaster() {
    SESSION_STATUS_BROADCAST_STOP.store(true, Ordering::SeqCst);
    let mut guard = match SESSION_STATUS_BROADCAST_APP.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    *guard = None;
}

#[cfg(target_os = "windows")]
fn resolve_editor_owner_hwnd(app: &AppHandle) -> Option<u64> {
    let deadline = Instant::now() + Duration::from_millis(1_500);
    while Instant::now() < deadline {
        let hwnd = app
            .get_window(crate::windows::MAIN_WINDOW_LABEL)
            .and_then(|window| window.hwnd().ok())
            .map(|hwnd| hwnd.0 as u64)
            .filter(|value| *value != 0);
        if hwnd.is_some() {
            return hwnd;
        }
        thread::sleep(Duration::from_millis(20));
    }

    app.get_window(crate::windows::MAIN_WINDOW_LABEL)
        .and_then(|window| window.hwnd().ok())
        .map(|hwnd| hwnd.0 as u64)
        .filter(|value| *value != 0)
}

pub fn open_native_editor(
    app: &AppHandle,
    node_id: String,
    title: Option<String>,
) -> Result<(), String> {
    let node_id_key = node_id.clone();
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
            resolve_editor_owner_hwnd(app)
        }
        #[cfg(not(target_os = "windows"))]
        {
            None
        }
    };

    let result = session
        .client
        .open_editor_window(
            title.as_deref(),
            owner_hwnd,
            BridgeOpenEditorOptions {
                pinned: true,
                bring_only: false,
                show: true,
                activate: true,
            },
        )
        .map_err(|e| format!("Bridge open editor failed: {e}"));

    if let Err(err) = &result {
        vst_audit::record_event(
            vst_audit::VstAuditEventKind::EditorOpenFailed,
            Some(node_id_key.clone()),
            Some(plugin_id.clone()),
            err.clone(),
        );
    }

    let should_keep_session = result.is_ok() || session.client.check_alive().is_ok();
    if should_keep_session {
        let mut map = match SESSIONS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.insert(node_id, session);
    }

    if result.is_ok() {
        cache_editor_open(node_id_key.as_str(), true);
    }

    result
}

pub fn close_native_editor(node_id: String) -> Result<(), String> {
    let node_id_key = node_id.clone();

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

    let should_keep_session = result.is_ok() || session.client.check_alive().is_ok();
    if should_keep_session {
        let mut map = match SESSIONS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.insert(node_id, session);
    }

    if result.is_ok() {
        cache_editor_open(node_id_key.as_str(), false);
    }

    result
}

fn bring_editors(
    app: &AppHandle,
    show: bool,
    activate: bool,
    only_when_cached_open: bool,
) -> Result<u32, String> {
    let owner_hwnd = {
        #[cfg(target_os = "windows")]
        {
            resolve_editor_owner_hwnd(app)
        }
        #[cfg(not(target_os = "windows"))]
        {
            None
        }
    };

    let mut node_ids = {
        let map = match SESSIONS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.keys().cloned().collect::<Vec<_>>()
    };

    if only_when_cached_open {
        // Avoid sending editor-related IPC to sessions that do not have an editor open.
        // Some plugins (notably Waves) are sensitive to UI-thread interactions; keeping the focus
        // handler "quiet" unless necessary improves stability.
        node_ids.retain(|node_id| is_editor_open_cached(node_id.as_str()));
    }

    let mut brought = 0u32;
    for node_id in node_ids {
        let session = {
            let mut map = match SESSIONS.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            map.remove(node_id.as_str())
        };

        let Some(mut session) = session else {
            continue;
        };

        let result = session
            .client
            .open_editor_window(
                None,
                owner_hwnd,
                BridgeOpenEditorOptions {
                    pinned: true,
                    bring_only: true,
                    show,
                    activate,
                },
            )
            .map_err(|e| format!("Bridge bring editor failed: {e}"));

        let should_keep_session = result.is_ok() || session.client.check_alive().is_ok();
        if should_keep_session {
            let mut map = match SESSIONS.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            map.insert(node_id, session);
        }

        if result.is_ok() {
            brought = brought.saturating_add(1);
        }
    }

    Ok(brought)
}

pub fn bring_all_editors_to_front(app: &AppHandle) -> Result<u32, String> {
    // User-initiated: be aggressive and try all sessions.
    // `bring_only=true` ensures we won't reopen windows that were closed.
    bring_editors(app, true, true, false)
}

pub fn raise_visible_editors_above_main(app: &AppHandle) -> Result<u32, String> {
    // Host focus handling: keep it quiet unless we believe an editor is already open.
    bring_editors(app, false, false, true)
}

pub fn list_session_statuses() -> Vec<VstSessionStatus> {
    let node_ids = {
        let map = match SESSIONS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.keys().cloned().collect::<Vec<_>>()
    };
    let active_node_ids = node_ids.iter().cloned().collect::<HashSet<_>>();
    prune_bridge_metrics(&active_node_ids);

    let mut out = Vec::with_capacity(node_ids.len());
    for node_id in node_ids {
        let session = {
            let mut map = match SESSIONS.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            map.remove(node_id.as_str())
        };

        let Some(mut session) = session else {
            continue;
        };

        let plugin_id = session.plugin_id.clone();
        let shm_in_name = session.shm_in_name.clone();
        let shm_out_name = session.shm_out_name.clone();
        let in_ring = ShmRing::open(shm_in_name.as_str()).ok();
        let out_ring = ShmRing::open(shm_out_name.as_str()).ok();
        let metrics = session
            .client
            .ping_with_timeout(Duration::from_millis(
                SESSION_STATUS_METRICS_PING_TIMEOUT_MS,
            ))
            .ok()
            .and_then(|response| response.metrics);
        if let Some(metrics) = metrics.as_ref() {
            record_bridge_metrics_if_changed(node_id.as_str(), metrics);
        }
        let metrics = metrics.unwrap_or_else(empty_bridge_realtime_metrics);

        let (
            peer_ready,
            plugin_loaded,
            processing_active,
            plugin_error,
            heartbeat_in,
            heartbeat_out,
        ) = match (in_ring.as_ref(), out_ring.as_ref()) {
            (Some(in_ring), Some(out_ring)) => {
                let header_in = in_ring.header();
                let header_out = out_ring.header();
                (
                    header_in.is_peer_ready() && header_out.is_peer_ready(),
                    header_in.is_plugin_loaded(),
                    header_in.is_processing_active(),
                    header_in.is_plugin_error(),
                    Some(header_in.heartbeat.load(Ordering::Relaxed)),
                    Some(header_out.heartbeat.load(Ordering::Relaxed)),
                )
            }
            _ => (false, false, false, false, None, None),
        };

        {
            let mut map = match SESSIONS.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            map.insert(node_id.clone(), session);
        }

        let native_editor_open = is_editor_open_cached(node_id.as_str());

        out.push(VstSessionStatus {
            native_editor_open,
            node_id: node_id.clone(),
            plugin_id,
            peer_ready,
            plugin_loaded,
            processing_active,
            plugin_error,
            heartbeat_in,
            heartbeat_out,
            callback_lock_miss_blocks: metrics.callback_lock_miss_blocks,
            callback_lock_miss_frames: metrics.callback_lock_miss_frames,
            dry_bypass_frames: metrics.dry_bypass_frames,
            shm_output_backpressure_blocks: metrics.shm_output_backpressure_blocks,
            shm_output_backpressure_frames: metrics.shm_output_backpressure_frames,
        });
    }

    out
}

pub fn set_params(
    app: &AppHandle,
    node_id: String,
    params: Vec<VstParamValue>,
) -> Result<(), String> {
    let node_id = node_id.trim().to_string();
    if node_id.is_empty() {
        return Err("nodeId is required".to_string());
    }

    let plugin_id = crate::dsp_graph::resolve_vst_plugin_id(app, node_id.as_str())?;
    crate::vst_instance_manager::set_node_params(
        node_id.as_str(),
        plugin_id.as_str(),
        params.clone(),
    );

    let desired_snapshot =
        crate::vst_instance_manager::desired_params(node_id.as_str(), plugin_id.as_str())
            .into_iter()
            .map(|(key, value)| VstParamValue { key, value })
            .collect::<Vec<_>>();
    if let Err(err) = crate::dsp_graph::set_vst_node_params(
        app,
        node_id.as_str(),
        plugin_id.as_str(),
        desired_snapshot,
    ) {
        crate::backend_telemetry::warn(
            app,
            "vst",
            "vst.params.persist-dsp-graph.failed",
            crate::backend_telemetry::BackendTelemetryOptions::new()
                .component("vst_runtime")
                .message(err)
                .field("nodeId", serde_json::json!(node_id))
                .field("pluginId", serde_json::json!(plugin_id)),
        );
    }
    let desired_generation =
        crate::vst_instance_manager::desired_generation(node_id.as_str(), plugin_id.as_str())
            .unwrap_or(0);

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

    if session.plugin_id.trim() != plugin_id.as_str() {
        let mut map = match SESSIONS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.insert(node_id, session);
        return Ok(());
    }

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
    }

    // Never drop sessions on transient control-plane errors (timeouts, busy sidecar, etc.).
    // Dropping the session drops BridgeClient -> kills the sidecar -> native editor window flashes
    // then disappears.
    let should_keep_session = result.is_ok() || session.client.check_alive().is_ok();
    if should_keep_session {
        let mut map = match SESSIONS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.insert(node_id, session);
    }

    result
}

pub fn set_param_value(
    app: &AppHandle,
    node_id: String,
    key: String,
    value: f32,
) -> Result<(), String> {
    let node_id = node_id.trim().to_string();
    if node_id.is_empty() {
        return Err("nodeId is required".to_string());
    }

    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("key is required".to_string());
    }
    if !value.is_finite() {
        return Err("value must be finite".to_string());
    }

    let plugin_id = crate::dsp_graph::resolve_vst_plugin_id(app, node_id.as_str())?;

    let existing =
        crate::vst_instance_manager::desired_params(node_id.as_str(), plugin_id.as_str());
    let mut merged: Vec<(String, f32)> = Vec::with_capacity(existing.len().saturating_add(1));
    let mut index_by_key: HashMap<String, usize> = HashMap::new();
    for (k, v) in existing {
        if k.is_empty() {
            continue;
        }
        if index_by_key.contains_key(&k) {
            continue;
        }
        index_by_key.insert(k.clone(), merged.len());
        merged.push((k, v));
    }

    match index_by_key.get(&key).copied() {
        Some(idx) if idx < merged.len() => {
            merged[idx] = (key.clone(), value);
        }
        _ => {
            index_by_key.insert(key.clone(), merged.len());
            merged.push((key.clone(), value));
        }
    }

    let merged_values = merged
        .into_iter()
        .map(|(k, v)| VstParamValue { key: k, value: v })
        .collect::<Vec<_>>();

    crate::vst_instance_manager::set_node_params(
        node_id.as_str(),
        plugin_id.as_str(),
        merged_values,
    );

    let desired_snapshot =
        crate::vst_instance_manager::desired_params(node_id.as_str(), plugin_id.as_str())
            .into_iter()
            .map(|(key, value)| VstParamValue { key, value })
            .collect::<Vec<_>>();
    if let Err(err) = crate::dsp_graph::set_vst_node_params(
        app,
        node_id.as_str(),
        plugin_id.as_str(),
        desired_snapshot,
    ) {
        crate::backend_telemetry::warn(
            app,
            "vst",
            "vst.params.persist-dsp-graph.failed",
            crate::backend_telemetry::BackendTelemetryOptions::new()
                .component("vst_runtime")
                .message(err)
                .field("nodeId", serde_json::json!(node_id))
                .field("pluginId", serde_json::json!(plugin_id)),
        );
    }

    let desired_generation =
        crate::vst_instance_manager::desired_generation(node_id.as_str(), plugin_id.as_str())
            .unwrap_or(0);

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

    if session.plugin_id.trim() != plugin_id.as_str() {
        let mut map = match SESSIONS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.insert(node_id, session);
        return Ok(());
    }

    let result = session
        .client
        .set_params(&[(key.clone(), value)])
        .map_err(|e| format!("Bridge set params failed: {e}"));

    if result.is_ok() {
        session.applied_generation = desired_generation;
    }

    let should_keep_session = result.is_ok() || session.client.check_alive().is_ok();
    if should_keep_session {
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

    let should_keep_session = result.is_ok() || session.client.check_alive().is_ok();
    if should_keep_session {
        let mut map = match SESSIONS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.insert(node_id, session);
    }

    match result {
        Ok(values) => Ok(values
            .into_iter()
            .map(|BridgeParamValue { key, value }| VstParamValue { key, value })
            .collect()),
        Err(error) => Err(error),
    }
}

pub fn dispose_session(node_id: String) -> Result<(), String> {
    cache_editor_open(node_id.as_str(), false);

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
                cache_editor_open(key.as_str(), false);
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
