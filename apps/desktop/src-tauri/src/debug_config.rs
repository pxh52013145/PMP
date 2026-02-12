use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VstSidechainModeOverride {
    Disabled,
    Silence,
    #[serde(rename = "self")]
    SelfFeed,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugVstBridgeConfig {
    #[serde(default)]
    pub stderr: bool,
    #[serde(default)]
    pub log_editor: bool,
    #[serde(default)]
    pub minidump: bool,
    #[serde(default)]
    pub minidump_dir: Option<String>,
    #[serde(default)]
    pub editor_safe_mode: Option<bool>,
    #[serde(default)]
    pub sidechain_mode: Option<VstSidechainModeOverride>,
}

impl Default for DebugVstBridgeConfig {
    fn default() -> Self {
        Self {
            stderr: false,
            log_editor: false,
            minidump: false,
            minidump_dir: None,
            editor_safe_mode: None,
            sidechain_mode: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugConfig {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub open_debug_center_on_next_start: bool,
    #[serde(default)]
    pub vst_bridge: DebugVstBridgeConfig,
}

fn default_version() -> u32 {
    1
}

impl Default for DebugConfig {
    fn default() -> Self {
        Self {
            version: default_version(),
            enabled: false,
            open_debug_center_on_next_start: false,
            vst_bridge: DebugVstBridgeConfig::default(),
        }
    }
}

static CONFIG: Lazy<Mutex<Option<DebugConfig>>> = Lazy::new(|| Mutex::new(None));

fn config_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Unable to resolve app data directory".to_string())?;
    let dir = app_data_dir.join("debug");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create debug directory: {e}"))?;
    Ok(dir.join("debug-config.json"))
}

fn read_config_from_disk(app: &AppHandle) -> Result<DebugConfig, String> {
    let path = config_file_path(app)?;
    let data = match std::fs::read(&path) {
        Ok(data) => data,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(DebugConfig::default()),
        Err(err) => return Err(format!("Failed to read debug config: {err}")),
    };

    serde_json::from_slice::<DebugConfig>(&data)
        .map_err(|e| format!("Failed to parse debug config: {e}"))
}

fn write_config_to_disk(app: &AppHandle, config: &DebugConfig) -> Result<(), String> {
    let path = config_file_path(app)?;
    let data = serde_json::to_vec_pretty(config)
        .map_err(|e| format!("Failed to encode debug config: {e}"))?;
    std::fs::write(&path, data).map_err(|e| format!("Failed to write debug config: {e}"))
}

pub fn get_config(app: &AppHandle) -> Result<DebugConfig, String> {
    let mut guard = CONFIG
        .lock()
        .map_err(|_| "Debug config state is locked".to_string())?;
    if let Some(config) = guard.as_ref() {
        return Ok(config.clone());
    }

    let config = read_config_from_disk(app).unwrap_or_default();
    *guard = Some(config.clone());
    Ok(config)
}

pub fn set_config(app: &AppHandle, config: DebugConfig) -> Result<(), String> {
    {
        let mut guard = CONFIG
            .lock()
            .map_err(|_| "Debug config state is locked".to_string())?;
        *guard = Some(config.clone());
    }

    write_config_to_disk(app, &config)?;
    Ok(())
}

fn set_env_if_unset(key: &str, value: &str) {
    if std::env::var_os(key).is_none() {
        std::env::set_var(key, value);
    }
}

pub fn apply_config_to_env(config: &DebugConfig) {
    if !config.enabled {
        return;
    }

    let stderr_enabled = config.vst_bridge.stderr || config.vst_bridge.log_editor;
    if stderr_enabled {
        set_env_if_unset("PMP_VST_BRIDGE_STDERR", "1");
    }
    if config.vst_bridge.log_editor {
        set_env_if_unset("PMP_VST_BRIDGE_LOG_EDITOR", "1");
    }
    if config.vst_bridge.minidump {
        set_env_if_unset("PMP_VST_BRIDGE_MINIDUMP", "1");
    }
    if let Some(dir) = config.vst_bridge.minidump_dir.as_deref() {
        if !dir.trim().is_empty() {
            set_env_if_unset("PMP_VST_BRIDGE_MINIDUMP_DIR", dir);
        }
    }
    if let Some(mode) = config.vst_bridge.editor_safe_mode {
        set_env_if_unset("PMP_VST_EDITOR_SAFE_MODE", if mode { "1" } else { "0" });
    }
    if let Some(mode) = config.vst_bridge.sidechain_mode {
        let value = match mode {
            VstSidechainModeOverride::Disabled => "disabled",
            VstSidechainModeOverride::Silence => "silence",
            VstSidechainModeOverride::SelfFeed => "self",
        };
        set_env_if_unset("PMP_VST_SIDECHAIN_MODE", value);
    }
}

pub fn apply_from_disk(app: &AppHandle) -> Result<(), String> {
    let config = read_config_from_disk(app).unwrap_or_default();
    {
        let mut guard = CONFIG
            .lock()
            .map_err(|_| "Debug config state is locked".to_string())?;
        *guard = Some(config.clone());
    }
    apply_config_to_env(&config);
    Ok(())
}

pub fn env_snapshot() -> BTreeMap<String, Option<String>> {
    let mut map = BTreeMap::<String, Option<String>>::new();
    let keys = [
        "PMP_VST_BRIDGE_STDERR",
        "PMP_VST_BRIDGE_LOG_EDITOR",
        "PMP_VST_EDITOR_SAFE_MODE",
        "PMP_VST_SIDECHAIN_MODE",
        "PMP_VST_BRIDGE_MINIDUMP",
        "PMP_VST_BRIDGE_MINIDUMP_DIR",
        "PMP_VST_BRIDGE_DEBUG",
        "PMP_RACK_VST3_DEBUG",
    ];

    for key in keys {
        map.insert(
            key.to_string(),
            std::env::var(key)
                .ok()
                .map(|value| value.trim().to_string()),
        );
    }
    map
}
