use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::dsp_graph::VstParamValue;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VstPresetSummary {
    pub id: String,
    pub name: String,
    pub created_at_ms: u64,
    pub params_count: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VstPreset {
    pub id: String,
    pub name: String,
    pub created_at_ms: u64,
    pub params: Vec<VstParamValue>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VstPresetStore {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    presets_by_plugin: HashMap<String, Vec<VstPreset>>,
    #[serde(default)]
    locked_params_by_node: HashMap<String, Vec<String>>,
}

static STORE: Lazy<Mutex<Option<VstPresetStore>>> = Lazy::new(|| Mutex::new(None));
static PRESET_NONCE: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn presets_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Unable to resolve app data directory".to_string())?;
    let dir = app_data_dir.join("audio");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create audio directory: {e}"))?;
    Ok(dir.join("vst-presets.json"))
}

fn read_store_from_disk(app: &AppHandle) -> Result<VstPresetStore, String> {
    let path = presets_file_path(app)?;
    let data = match std::fs::read(&path) {
        Ok(data) => data,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(VstPresetStore::default())
        }
        Err(err) => return Err(format!("Failed to read VST presets: {err}")),
    };

    serde_json::from_slice::<VstPresetStore>(&data)
        .map_err(|e| format!("Failed to parse VST presets: {e}"))
}

fn write_store_to_disk(app: &AppHandle, store: &VstPresetStore) -> Result<(), String> {
    let path = presets_file_path(app)?;
    let data = serde_json::to_vec_pretty(store)
        .map_err(|e| format!("Failed to encode VST presets: {e}"))?;
    std::fs::write(&path, data).map_err(|e| format!("Failed to write VST presets: {e}"))
}

fn get_store(app: &AppHandle) -> VstPresetStore {
    let mut guard = match STORE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(store) = guard.as_ref() {
        return store.clone();
    }
    let store = read_store_from_disk(app).unwrap_or_default();
    *guard = Some(store.clone());
    store
}

fn set_store(app: &AppHandle, store: VstPresetStore) -> Result<(), String> {
    {
        let mut guard = match STORE.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *guard = Some(store.clone());
    }
    write_store_to_disk(app, &store)
}

fn normalized_plugin_id(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("pluginId is required".to_string());
    }
    Ok(trimmed.to_string())
}

fn normalized_node_id(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("nodeId is required".to_string());
    }
    Ok(trimmed.to_string())
}

fn normalized_key(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

fn build_preset_id() -> String {
    let pid = std::process::id() as u64;
    let nonce = PRESET_NONCE.fetch_add(1, Ordering::Relaxed);
    format!("preset-{pid}-{}-{nonce}", now_ms())
}

pub fn list_presets(app: &AppHandle, plugin_id: &str) -> Result<Vec<VstPresetSummary>, String> {
    let plugin_id = normalized_plugin_id(plugin_id)?;
    let store = get_store(app);
    let presets = store
        .presets_by_plugin
        .get(&plugin_id)
        .cloned()
        .unwrap_or_default();
    Ok(presets
        .into_iter()
        .map(|preset| VstPresetSummary {
            id: preset.id,
            name: preset.name,
            created_at_ms: preset.created_at_ms,
            params_count: preset.params.len(),
        })
        .collect())
}

pub fn save_preset_from_node(
    app: &AppHandle,
    node_id: &str,
    name: &str,
) -> Result<VstPresetSummary, String> {
    let node_id = normalized_node_id(node_id)?;
    let name = name.trim();
    if name.is_empty() {
        return Err("name is required".to_string());
    }

    let plugin_id = crate::dsp_graph::resolve_vst_plugin_id(app, node_id.as_str())?;
    let desired = crate::vst_instance_manager::desired_params(node_id.as_str(), plugin_id.as_str());
    let params = desired
        .into_iter()
        .map(|(key, value)| VstParamValue { key, value })
        .collect::<Vec<_>>();

    let preset = VstPreset {
        id: build_preset_id(),
        name: name.to_string(),
        created_at_ms: now_ms(),
        params,
    };

    let mut store = get_store(app);
    store
        .presets_by_plugin
        .entry(plugin_id)
        .or_default()
        .insert(0, preset.clone());
    set_store(app, store)?;

    Ok(VstPresetSummary {
        id: preset.id,
        name: preset.name,
        created_at_ms: preset.created_at_ms,
        params_count: preset.params.len(),
    })
}

pub fn delete_preset(app: &AppHandle, plugin_id: &str, preset_id: &str) -> Result<(), String> {
    let plugin_id = normalized_plugin_id(plugin_id)?;
    let preset_id = preset_id.trim();
    if preset_id.is_empty() {
        return Err("presetId is required".to_string());
    }

    let mut store = get_store(app);
    if let Some(presets) = store.presets_by_plugin.get_mut(&plugin_id) {
        presets.retain(|preset| preset.id != preset_id);
    }
    set_store(app, store)?;
    Ok(())
}

pub fn apply_preset_to_node(app: &AppHandle, node_id: &str, preset_id: &str) -> Result<(), String> {
    let node_id = normalized_node_id(node_id)?;
    let preset_id = preset_id.trim();
    if preset_id.is_empty() {
        return Err("presetId is required".to_string());
    }

    let plugin_id = crate::dsp_graph::resolve_vst_plugin_id(app, node_id.as_str())?;

    let store = get_store(app);
    let preset = store
        .presets_by_plugin
        .get(plugin_id.as_str())
        .and_then(|presets| presets.iter().find(|preset| preset.id == preset_id))
        .cloned()
        .ok_or_else(|| format!("Preset not found: {preset_id}"))?;

    let locked_keys = store
        .locked_params_by_node
        .get(node_id.as_str())
        .cloned()
        .unwrap_or_default();
    let locked: std::collections::HashSet<String> = locked_keys
        .into_iter()
        .filter_map(|k| normalized_key(&k))
        .collect();

    let existing =
        crate::vst_instance_manager::desired_params(node_id.as_str(), plugin_id.as_str());
    let mut merged: Vec<(String, f32)> = existing.clone();
    let mut index_by_key: HashMap<String, usize> = HashMap::new();
    for (idx, (key, _)) in merged.iter().enumerate() {
        index_by_key.insert(key.clone(), idx);
    }

    for param in &preset.params {
        let Some(key) = normalized_key(param.key.as_str()) else {
            continue;
        };
        if locked.contains(&key) {
            continue;
        }
        let value = param.value;
        if !value.is_finite() {
            continue;
        }
        match index_by_key.get(&key).copied() {
            Some(idx) if idx < merged.len() => {
                merged[idx] = (key, value);
            }
            _ => {
                index_by_key.insert(key.clone(), merged.len());
                merged.push((key, value));
            }
        }
    }

    let params = merged
        .into_iter()
        .map(|(key, value)| VstParamValue { key, value })
        .collect::<Vec<_>>();

    crate::vst_runtime::set_params(app, node_id, params)
}

pub fn locked_params(app: &AppHandle, node_id: &str) -> Result<Vec<String>, String> {
    let node_id = normalized_node_id(node_id)?;
    let store = get_store(app);
    Ok(store
        .locked_params_by_node
        .get(node_id.as_str())
        .cloned()
        .unwrap_or_default())
}

pub fn set_param_locked(
    app: &AppHandle,
    node_id: &str,
    key: &str,
    locked: bool,
) -> Result<(), String> {
    let node_id = normalized_node_id(node_id)?;
    let Some(key) = normalized_key(key) else {
        return Err("key is required".to_string());
    };

    let mut store = get_store(app);
    let entry = store.locked_params_by_node.entry(node_id).or_default();
    entry.retain(|existing| normalized_key(existing.as_str()).as_deref() != Some(key.as_str()));
    if locked {
        entry.push(key);
    }
    set_store(app, store)?;
    Ok(())
}
