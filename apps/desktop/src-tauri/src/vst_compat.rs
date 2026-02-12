use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VstMonoInputPolicy {
    SumAverage,
    LeftOnly,
}

impl Default for VstMonoInputPolicy {
    fn default() -> Self {
        Self::SumAverage
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VstCompatRule {
    #[serde(default = "default_true")]
    pub editor_safe_mode: bool,
    #[serde(default = "default_true")]
    pub load_on_ui_thread: bool,
    #[serde(default)]
    pub mono_input: VstMonoInputPolicy,
}

fn default_true() -> bool {
    true
}

impl Default for VstCompatRule {
    fn default() -> Self {
        Self {
            editor_safe_mode: true,
            load_on_ui_thread: true,
            mono_input: VstMonoInputPolicy::SumAverage,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VstCompatScope {
    Plugin,
    Vendor,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VstCompatQueryResult {
    pub plugin_id: String,
    pub vendor: Option<String>,
    pub effective: VstCompatRule,
    pub plugin_override: Option<VstCompatRule>,
    pub vendor_override: Option<VstCompatRule>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VstCompatStore {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    plugins: HashMap<String, VstCompatRule>,
    #[serde(default)]
    vendors: HashMap<String, VstCompatRule>,
}

static STORE: Lazy<Mutex<Option<VstCompatStore>>> = Lazy::new(|| Mutex::new(None));

fn compat_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Unable to resolve app data directory".to_string())?;
    let dir = app_data_dir.join("audio");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create audio directory: {e}"))?;
    Ok(dir.join("vst-compat.json"))
}

fn read_store_from_disk(app: &AppHandle) -> Result<VstCompatStore, String> {
    let path = compat_file_path(app)?;
    let data = match std::fs::read(&path) {
        Ok(data) => data,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(VstCompatStore::default())
        }
        Err(err) => return Err(format!("Failed to read VST compatibility: {err}")),
    };

    serde_json::from_slice::<VstCompatStore>(&data)
        .map_err(|e| format!("Failed to parse VST compatibility: {e}"))
}

fn write_store_to_disk(app: &AppHandle, store: &VstCompatStore) -> Result<(), String> {
    let path = compat_file_path(app)?;
    let data = serde_json::to_vec_pretty(store)
        .map_err(|e| format!("Failed to encode VST compatibility: {e}"))?;
    std::fs::write(&path, data).map_err(|e| format!("Failed to write VST compatibility: {e}"))
}

fn get_store(app: &AppHandle) -> VstCompatStore {
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

fn set_store(app: &AppHandle, store: VstCompatStore) -> Result<(), String> {
    {
        let mut guard = match STORE.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *guard = Some(store.clone());
    }
    write_store_to_disk(app, &store)
}

fn cached_store() -> VstCompatStore {
    let guard = match STORE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    guard.clone().unwrap_or_default()
}

fn normalize_plugin_id(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("pluginId is required".to_string());
    }
    Ok(trimmed.to_string())
}

fn normalize_vendor_key(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_lowercase())
}

fn resolve_effective_rule(
    store: &VstCompatStore,
    plugin_id: &str,
    vendor: Option<&str>,
) -> VstCompatRule {
    let mut effective = VstCompatRule::default();

    if let Some(vendor) = vendor.and_then(normalize_vendor_key) {
        if let Some(rule) = store.vendors.get(vendor.as_str()) {
            effective = rule.clone();
        }
    }

    if let Some(rule) = store.plugins.get(plugin_id) {
        effective = rule.clone();
    }

    effective
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    let _ = get_store(app);
    Ok(())
}

pub fn effective_rule(plugin_id: &str) -> VstCompatRule {
    let plugin_id = plugin_id.trim();
    if plugin_id.is_empty() {
        return VstCompatRule::default();
    }

    let store = cached_store();
    let vendor = crate::vst_library::plugin_vendor(plugin_id);
    resolve_effective_rule(&store, plugin_id, vendor.as_deref())
}

pub fn get_compatibility(app: &AppHandle, plugin_id: &str) -> Result<VstCompatQueryResult, String> {
    let plugin_id = normalize_plugin_id(plugin_id)?;
    let store = get_store(app);
    let vendor = crate::vst_library::plugin_vendor(plugin_id.as_str());
    let vendor_key = vendor.as_deref().and_then(normalize_vendor_key);

    let vendor_override = vendor_key
        .as_deref()
        .and_then(|key| store.vendors.get(key))
        .cloned();
    let plugin_override = store.plugins.get(plugin_id.as_str()).cloned();
    let effective = resolve_effective_rule(&store, plugin_id.as_str(), vendor.as_deref());

    Ok(VstCompatQueryResult {
        plugin_id,
        vendor,
        effective,
        plugin_override,
        vendor_override,
    })
}

pub fn set_rule(
    app: &AppHandle,
    scope: VstCompatScope,
    key: &str,
    rule: VstCompatRule,
) -> Result<(), String> {
    match scope {
        VstCompatScope::Plugin => {
            let plugin_id = normalize_plugin_id(key)?;
            let mut store = get_store(app);
            store.plugins.insert(plugin_id, rule);
            set_store(app, store)?;
        }
        VstCompatScope::Vendor => {
            let vendor_key =
                normalize_vendor_key(key).ok_or_else(|| "vendor is required".to_string())?;
            let mut store = get_store(app);
            store.vendors.insert(vendor_key, rule);
            set_store(app, store)?;
        }
    }
    Ok(())
}

pub fn clear_rule(app: &AppHandle, scope: VstCompatScope, key: &str) -> Result<(), String> {
    match scope {
        VstCompatScope::Plugin => {
            let plugin_id = normalize_plugin_id(key)?;
            let mut store = get_store(app);
            store.plugins.remove(plugin_id.as_str());
            set_store(app, store)?;
        }
        VstCompatScope::Vendor => {
            let vendor_key =
                normalize_vendor_key(key).ok_or_else(|| "vendor is required".to_string())?;
            let mut store = get_store(app);
            store.vendors.remove(vendor_key.as_str());
            set_store(app, store)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_effective_prefers_plugin_over_vendor() {
        let mut store = VstCompatStore::default();
        store.vendors.insert(
            "acme".to_string(),
            VstCompatRule {
                editor_safe_mode: true,
                load_on_ui_thread: false,
                mono_input: VstMonoInputPolicy::SumAverage,
            },
        );
        store.plugins.insert(
            "acme.plugin".to_string(),
            VstCompatRule {
                editor_safe_mode: false,
                load_on_ui_thread: true,
                mono_input: VstMonoInputPolicy::LeftOnly,
            },
        );

        let effective = resolve_effective_rule(&store, "acme.plugin", Some("Acme"));
        assert_eq!(effective.editor_safe_mode, false);
        assert_eq!(effective.load_on_ui_thread, true);
        assert_eq!(effective.mono_input, VstMonoInputPolicy::LeftOnly);
    }

    #[test]
    fn resolve_effective_applies_vendor_when_plugin_missing() {
        let mut store = VstCompatStore::default();
        store.vendors.insert(
            "acme".to_string(),
            VstCompatRule {
                editor_safe_mode: false,
                load_on_ui_thread: false,
                mono_input: VstMonoInputPolicy::LeftOnly,
            },
        );

        let effective = resolve_effective_rule(&store, "other.plugin", Some("ACME"));
        assert_eq!(effective.editor_safe_mode, false);
        assert_eq!(effective.load_on_ui_thread, false);
        assert_eq!(effective.mono_input, VstMonoInputPolicy::LeftOnly);
    }
}
