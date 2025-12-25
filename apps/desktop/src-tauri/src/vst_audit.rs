use once_cell::sync::{Lazy, OnceCell};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::vst_bridge::BridgePluginDescriptor;

const AUDIT_LOG_VERSION: u32 = 1;
const MAX_EVENTS: usize = 200;
const DEMO_VST_PLUGIN_ID: &str = "demo.gain";

fn is_demo_vst_plugin_id(plugin_id: &str) -> bool {
    plugin_id.trim() == DEMO_VST_PLUGIN_ID
}

fn normalize_audit_log(log: &mut VstAuditLog) -> bool {
    let mut changed = false;

    if let Some(snapshot) = log.last_scan.as_mut() {
        let before = snapshot.plugins.len();
        snapshot
            .plugins
            .retain(|plugin| !is_demo_vst_plugin_id(plugin.id.as_str()));
        changed |= snapshot.plugins.len() != before;
    }

    let before = log.events.len();
    log.events.retain(|event| {
        event
            .plugin_id
            .as_deref()
            .map(|id| !is_demo_vst_plugin_id(id))
            .unwrap_or(true)
    });
    changed |= log.events.len() != before;

    changed
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VstAuditEventKind {
    ScanPlugins,
    SessionSpawnFailed,
    SessionHandshakeTimeout,
    RestartAttempt,
    RestartSucceeded,
    RestartFailed,
    PluginDisabled,
    PluginEnabled,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VstPluginSummary {
    pub id: String,
    pub name: String,
    pub vendor: Option<String>,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VstPluginScanSnapshot {
    pub at_ms: u64,
    pub plugins: Vec<VstPluginSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VstAuditEvent {
    pub at_ms: u64,
    pub kind: VstAuditEventKind,
    pub node_id: Option<String>,
    pub plugin_id: Option<String>,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VstAuditLog {
    pub version: u32,
    #[serde(default)]
    pub events: Vec<VstAuditEvent>,
    #[serde(default)]
    pub last_scan: Option<VstPluginScanSnapshot>,
}

impl Default for VstAuditLog {
    fn default() -> Self {
        Self {
            version: AUDIT_LOG_VERSION,
            events: Vec::new(),
            last_scan: None,
        }
    }
}

static AUDIT_PATH: OnceCell<PathBuf> = OnceCell::new();
static AUDIT_STATE: Lazy<Mutex<VstAuditLog>> = Lazy::new(|| Mutex::new(VstAuditLog::default()));

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn audit_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Unable to resolve app data directory".to_string())?;
    let dir = app_data_dir.join("audio");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create audio directory: {e}"))?;
    Ok(dir.join("vst-audit-log-v1.json"))
}

fn ensure_audit_path() -> Result<&'static PathBuf, String> {
    AUDIT_PATH
        .get()
        .ok_or_else(|| "VST audit log is not initialized".to_string())
}

fn load_from_disk(path: &PathBuf) -> VstAuditLog {
    let data = match std::fs::read(path) {
        Ok(data) => data,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return VstAuditLog::default(),
        Err(err) => {
            eprintln!("[VST][audit] Failed to read audit log: {err}");
            return VstAuditLog::default();
        }
    };

    match serde_json::from_slice::<VstAuditLog>(&data) {
        Ok(mut log) => {
            if log.version != AUDIT_LOG_VERSION {
                log.version = AUDIT_LOG_VERSION;
            }
            log
        }
        Err(err) => {
            eprintln!("[VST][audit] Failed to parse audit log: {err}");
            VstAuditLog::default()
        }
    }
}

fn persist_to_disk(path: &PathBuf, state: &VstAuditLog) -> Result<(), String> {
    let data =
        serde_json::to_vec_pretty(state).map_err(|e| format!("Failed to encode VST audit log: {e}"))?;
    std::fs::write(path, data).map_err(|e| format!("Failed to write VST audit log: {e}"))
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    let path = audit_file_path(app)?;
    let _ = AUDIT_PATH.set(path.clone());

    let mut loaded = load_from_disk(&path);
    if normalize_audit_log(&mut loaded) {
        let _ = persist_to_disk(&path, &loaded);
    }
    let mut guard = AUDIT_STATE
        .lock()
        .map_err(|_| "VST audit log state is locked".to_string())?;
    *guard = loaded;
    Ok(())
}

pub fn record_event(
    kind: VstAuditEventKind,
    node_id: Option<String>,
    plugin_id: Option<String>,
    message: String,
) {
    let Ok(path) = ensure_audit_path() else {
        return;
    };
    let mut guard = match AUDIT_STATE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    guard.events.push(VstAuditEvent {
        at_ms: now_ms(),
        kind,
        node_id,
        plugin_id,
        message,
    });

    if guard.events.len() > MAX_EVENTS {
        let drain = guard.events.len() - MAX_EVENTS;
        guard.events.drain(0..drain);
    }

    if let Err(err) = persist_to_disk(path, &guard) {
        eprintln!("[VST][audit] Failed to persist audit log: {err}");
    }
}

pub fn record_scan_snapshot(plugins: &[BridgePluginDescriptor]) {
    let Ok(path) = ensure_audit_path() else {
        return;
    };
    let mut guard = match AUDIT_STATE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    guard.last_scan = Some(VstPluginScanSnapshot {
        at_ms: now_ms(),
        plugins: plugins
            .iter()
            .map(|plugin| VstPluginSummary {
                id: plugin.id.clone(),
                name: plugin.name.clone(),
                vendor: plugin.vendor.clone(),
                version: plugin.version.clone(),
                path: plugin.path.clone(),
            })
            .collect(),
    });

    guard.events.push(VstAuditEvent {
        at_ms: now_ms(),
        kind: VstAuditEventKind::ScanPlugins,
        node_id: None,
        plugin_id: None,
        message: format!("Scanned {} plugin(s)", plugins.len()),
    });

    if guard.events.len() > MAX_EVENTS {
        let drain = guard.events.len() - MAX_EVENTS;
        guard.events.drain(0..drain);
    }

    if let Err(err) = persist_to_disk(path, &guard) {
        eprintln!("[VST][audit] Failed to persist scan snapshot: {err}");
    }
}

pub fn get_log() -> Result<VstAuditLog, String> {
    let _ = ensure_audit_path()?;
    let guard = AUDIT_STATE
        .lock()
        .map_err(|_| "VST audit log state is locked".to_string())?;
    Ok(guard.clone())
}

pub fn clear_events() -> Result<(), String> {
    let path = ensure_audit_path()?;
    let mut guard = AUDIT_STATE
        .lock()
        .map_err(|_| "VST audit log state is locked".to_string())?;
    guard.events.clear();
    persist_to_disk(path, &guard)?;
    Ok(())
}
