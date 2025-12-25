use once_cell::sync::{Lazy, OnceCell};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::vst_audit::{self, VstAuditEventKind};

const GOVERNANCE_VERSION: u32 = 1;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VstDisabledPlugin {
    pub plugin_id: String,
    #[serde(default)]
    pub node_id: Option<String>,
    pub disabled_at_ms: u64,
    pub reason: String,
    #[serde(default)]
    pub failures: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VstGovernanceState {
    pub version: u32,
    #[serde(default)]
    pub disabled_plugins: Vec<VstDisabledPlugin>,
}

impl Default for VstGovernanceState {
    fn default() -> Self {
        Self {
            version: GOVERNANCE_VERSION,
            disabled_plugins: Vec::new(),
        }
    }
}

static GOVERNANCE_PATH: OnceCell<PathBuf> = OnceCell::new();
static GOVERNANCE_STATE: Lazy<Mutex<VstGovernanceState>> =
    Lazy::new(|| Mutex::new(VstGovernanceState::default()));

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn governance_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Unable to resolve app data directory".to_string())?;
    let dir = app_data_dir.join("audio");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create audio directory: {e}"))?;
    Ok(dir.join("vst-governance-v1.json"))
}

fn ensure_governance_path() -> Result<&'static PathBuf, String> {
    GOVERNANCE_PATH
        .get()
        .ok_or_else(|| "VST governance is not initialized".to_string())
}

fn load_from_disk(path: &PathBuf) -> VstGovernanceState {
    let data = match std::fs::read(path) {
        Ok(data) => data,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return VstGovernanceState::default(),
        Err(err) => {
            eprintln!("[VST][governance] Failed to read governance file: {err}");
            return VstGovernanceState::default();
        }
    };

    match serde_json::from_slice::<VstGovernanceState>(&data) {
        Ok(mut state) => {
            if state.version != GOVERNANCE_VERSION {
                state.version = GOVERNANCE_VERSION;
            }
            state
        }
        Err(err) => {
            eprintln!("[VST][governance] Failed to parse governance file: {err}");
            VstGovernanceState::default()
        }
    }
}

fn persist_to_disk(path: &PathBuf, state: &VstGovernanceState) -> Result<(), String> {
    let data = serde_json::to_vec_pretty(state)
        .map_err(|e| format!("Failed to encode VST governance state: {e}"))?;
    std::fs::write(path, data).map_err(|e| format!("Failed to write VST governance state: {e}"))
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    let path = governance_file_path(app)?;
    let _ = GOVERNANCE_PATH.set(path.clone());

    let loaded = load_from_disk(&path);
    let mut guard = GOVERNANCE_STATE
        .lock()
        .map_err(|_| "VST governance state is locked".to_string())?;
    *guard = loaded;
    Ok(())
}

pub fn state() -> Result<VstGovernanceState, String> {
    let _ = ensure_governance_path()?;
    let guard = GOVERNANCE_STATE
        .lock()
        .map_err(|_| "VST governance state is locked".to_string())?;
    Ok(guard.clone())
}

pub fn is_plugin_disabled(plugin_id: &str) -> bool {
    let guard = match GOVERNANCE_STATE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    guard
        .disabled_plugins
        .iter()
        .any(|entry| entry.plugin_id == plugin_id)
}

pub fn disable_plugin(
    plugin_id: String,
    node_id: Option<String>,
    reason: String,
    failures: Option<u32>,
) -> Result<bool, String> {
    let path = ensure_governance_path()?;
    let mut guard = match GOVERNANCE_STATE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    if guard
        .disabled_plugins
        .iter()
        .any(|entry| entry.plugin_id == plugin_id)
    {
        return Ok(false);
    }

    let record = VstDisabledPlugin {
        plugin_id: plugin_id.clone(),
        node_id: node_id.clone(),
        disabled_at_ms: now_ms(),
        reason: reason.clone(),
        failures,
    };

    guard.disabled_plugins.push(record);
    persist_to_disk(path, &guard)?;

    vst_audit::record_event(
        VstAuditEventKind::PluginDisabled,
        node_id,
        Some(plugin_id),
        reason,
    );

    Ok(true)
}

pub fn enable_plugin(plugin_id: &str) -> Result<bool, String> {
    let path = ensure_governance_path()?;
    let mut guard = match GOVERNANCE_STATE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let before = guard.disabled_plugins.len();
    guard.disabled_plugins.retain(|entry| entry.plugin_id != plugin_id);
    let changed = guard.disabled_plugins.len() != before;
    if !changed {
        return Ok(false);
    }

    persist_to_disk(path, &guard)?;

    vst_audit::record_event(
        VstAuditEventKind::PluginEnabled,
        None,
        Some(plugin_id.to_string()),
        "Plugin re-enabled".to_string(),
    );

    Ok(true)
}

