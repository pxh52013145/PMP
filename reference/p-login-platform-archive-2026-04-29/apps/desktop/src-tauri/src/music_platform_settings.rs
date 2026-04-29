use crate::music_platform_runtime::MusicPlatformRuntimeHost;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};
use tauri::AppHandle;

const GLOBAL_CACHE_SETTINGS_FILE: &str = "global-cache-settings.json";
const LEGACY_HOST_CACHE_SETTINGS_FILE: &str = "host-cache-settings.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicPlatformGlobalCacheSettings {
    #[serde(default)]
    pub custom_root_path: Option<String>,
    pub effective_root_path: String,
    pub default_root_path: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MusicPlatformGlobalCacheSettingsState {
    #[serde(default)]
    custom_root_path: Option<String>,
}

static GLOBAL_CACHE_SETTINGS_STATE: Lazy<Mutex<Option<MusicPlatformGlobalCacheSettingsState>>> =
    Lazy::new(|| Mutex::new(None));

fn lock_global_cache_settings_state(
) -> Result<MutexGuard<'static, Option<MusicPlatformGlobalCacheSettingsState>>, String> {
    GLOBAL_CACHE_SETTINGS_STATE
        .lock()
        .map_err(|_| "Music platform global cache settings state is locked".to_string())
}

fn resolve_music_platform_app_data_dir(host: &MusicPlatformRuntimeHost) -> Result<PathBuf, String> {
    host.path_resolver().app_data_dir().ok_or_else(|| {
        "Failed to resolve app data directory for music platform settings".to_string()
    })
}

fn resolve_global_settings_dir(host: &MusicPlatformRuntimeHost) -> Result<PathBuf, String> {
    let dir = resolve_music_platform_app_data_dir(host)?
        .join("music-platform")
        .join("global");
    fs::create_dir_all(&dir).map_err(|error| {
        format!("Failed to create music platform global settings directory: {error}")
    })?;
    Ok(dir)
}

fn resolve_legacy_host_settings_dir(host: &MusicPlatformRuntimeHost) -> Result<PathBuf, String> {
    Ok(resolve_music_platform_app_data_dir(host)?
        .join("music-platform")
        .join("host"))
}

fn resolve_global_cache_settings_file_path(
    host: &MusicPlatformRuntimeHost,
) -> Result<PathBuf, String> {
    Ok(resolve_global_settings_dir(host)?.join(GLOBAL_CACHE_SETTINGS_FILE))
}

fn resolve_legacy_host_cache_settings_file_path(
    host: &MusicPlatformRuntimeHost,
) -> Result<PathBuf, String> {
    Ok(resolve_legacy_host_settings_dir(host)?.join(LEGACY_HOST_CACHE_SETTINGS_FILE))
}

fn normalize_optional_path(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_global_cache_settings_state(
    mut state: MusicPlatformGlobalCacheSettingsState,
) -> MusicPlatformGlobalCacheSettingsState {
    state.custom_root_path = normalize_optional_path(state.custom_root_path);
    state
}

fn parse_absolute_cache_root(path: &str) -> Result<PathBuf, String> {
    let parsed = PathBuf::from(path);
    if !parsed.is_absolute() {
        return Err(
            "Music platform global cache path must be an absolute directory path".to_string(),
        );
    }
    Ok(parsed)
}

fn read_global_cache_settings_from_file(
    path: &Path,
    label: &str,
) -> Result<MusicPlatformGlobalCacheSettingsState, String> {
    let payload = fs::read(path)
        .map_err(|error| format!("Failed to read music platform {label}: {error}"))?;
    let parsed = serde_json::from_slice::<MusicPlatformGlobalCacheSettingsState>(&payload)
        .map_err(|error| format!("Failed to parse music platform {label}: {error}"))?;
    Ok(normalize_global_cache_settings_state(parsed))
}

fn write_global_cache_settings_to_disk(
    host: &MusicPlatformRuntimeHost,
    settings: &MusicPlatformGlobalCacheSettingsState,
) -> Result<(), String> {
    let path = resolve_global_cache_settings_file_path(host)?;
    let payload = serde_json::to_vec_pretty(settings).map_err(|error| {
        format!("Failed to encode music platform global cache settings: {error}")
    })?;
    fs::write(path, payload)
        .map_err(|error| format!("Failed to write music platform global cache settings: {error}"))
}

fn read_global_cache_settings_from_disk(
    host: &MusicPlatformRuntimeHost,
) -> Result<MusicPlatformGlobalCacheSettingsState, String> {
    let primary_path = resolve_global_cache_settings_file_path(host)?;
    if primary_path.exists() {
        return read_global_cache_settings_from_file(&primary_path, "global cache settings");
    }

    let legacy_path = resolve_legacy_host_cache_settings_file_path(host)?;
    if !legacy_path.exists() {
        return Ok(MusicPlatformGlobalCacheSettingsState::default());
    }

    let parsed = read_global_cache_settings_from_file(&legacy_path, "legacy host cache settings")?;

    if let Err(error) = write_global_cache_settings_to_disk(host, &parsed) {
        eprintln!(
            "[music_platform_settings] failed to migrate legacy host cache settings: {error}"
        );
    }

    Ok(parsed)
}

fn get_global_cache_settings_state(
    host: &MusicPlatformRuntimeHost,
) -> Result<MusicPlatformGlobalCacheSettingsState, String> {
    let mut guard = lock_global_cache_settings_state()?;
    if let Some(state) = guard.as_ref() {
        return Ok(state.clone());
    }

    let loaded = read_global_cache_settings_from_disk(host).unwrap_or_default();
    *guard = Some(loaded.clone());
    Ok(loaded)
}

fn persist_global_cache_settings_state(
    host: &MusicPlatformRuntimeHost,
    settings: MusicPlatformGlobalCacheSettingsState,
) -> Result<MusicPlatformGlobalCacheSettingsState, String> {
    let normalized = normalize_global_cache_settings_state(settings);
    if let Some(custom_root_path) = normalized.custom_root_path.as_deref() {
        let custom_root = parse_absolute_cache_root(custom_root_path)?;
        fs::create_dir_all(&custom_root).map_err(|error| {
            format!("Failed to create music platform global cache directory: {error}")
        })?;
    }

    {
        let mut guard = lock_global_cache_settings_state()?;
        *guard = Some(normalized.clone());
    }

    write_global_cache_settings_to_disk(host, &normalized)?;
    Ok(normalized)
}

pub(crate) fn resolve_default_global_cache_root_for_runtime_host(
    host: &MusicPlatformRuntimeHost,
) -> Result<PathBuf, String> {
    let root = host
        .path_resolver()
        .app_cache_dir()
        .or_else(|| host.path_resolver().app_data_dir())
        .ok_or_else(|| {
            "Failed to resolve app cache directory for music platform global cache".to_string()
        })?;
    Ok(root.join("music-platform").join("cache"))
}

pub fn resolve_default_global_cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    resolve_default_global_cache_root_for_runtime_host(&MusicPlatformRuntimeHost::from_app_handle(
        app,
    ))
}

pub(crate) fn resolve_effective_global_cache_root_for_runtime_host(
    host: &MusicPlatformRuntimeHost,
) -> Result<PathBuf, String> {
    let settings = get_global_cache_settings_state(host)?;
    if let Some(custom_root_path) = settings.custom_root_path.as_deref() {
        match parse_absolute_cache_root(custom_root_path) {
            Ok(path) => return Ok(path),
            Err(error) => {
                eprintln!(
                    "[music_platform_settings] invalid global cache root '{}': {error}",
                    custom_root_path
                );
            }
        }
    }

    resolve_default_global_cache_root_for_runtime_host(host)
}

pub fn resolve_effective_global_cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    resolve_effective_global_cache_root_for_runtime_host(
        &MusicPlatformRuntimeHost::from_app_handle(app),
    )
}

pub(crate) fn resolve_effective_platform_cache_root_for_runtime_host(
    host: &MusicPlatformRuntimeHost,
    platform_key: &str,
) -> Result<PathBuf, String> {
    Ok(resolve_effective_global_cache_root_for_runtime_host(host)?.join(platform_key))
}

pub fn resolve_effective_platform_cache_root(
    app: &AppHandle,
    platform_key: &str,
) -> Result<PathBuf, String> {
    resolve_effective_platform_cache_root_for_runtime_host(
        &MusicPlatformRuntimeHost::from_app_handle(app),
        platform_key,
    )
}

pub fn get_global_cache_settings(
    app: &AppHandle,
) -> Result<MusicPlatformGlobalCacheSettings, String> {
    let host = MusicPlatformRuntimeHost::from_app_handle(app);
    let state = get_global_cache_settings_state(&host)?;
    let effective_root_path = resolve_effective_global_cache_root_for_runtime_host(&host)?;
    let default_root_path = resolve_default_global_cache_root_for_runtime_host(&host)?;

    Ok(MusicPlatformGlobalCacheSettings {
        custom_root_path: state.custom_root_path,
        effective_root_path: effective_root_path.to_string_lossy().to_string(),
        default_root_path: default_root_path.to_string_lossy().to_string(),
    })
}

pub fn set_global_cache_settings(
    app: &AppHandle,
    custom_root_path: Option<String>,
) -> Result<MusicPlatformGlobalCacheSettings, String> {
    let host = MusicPlatformRuntimeHost::from_app_handle(app);
    let state = persist_global_cache_settings_state(
        &host,
        MusicPlatformGlobalCacheSettingsState { custom_root_path },
    )?;

    let effective_root_path = resolve_effective_global_cache_root_for_runtime_host(&host)?;
    fs::create_dir_all(&effective_root_path).map_err(|error| {
        format!("Failed to create effective music platform global cache directory: {error}")
    })?;
    let default_root_path = resolve_default_global_cache_root_for_runtime_host(&host)?;

    Ok(MusicPlatformGlobalCacheSettings {
        custom_root_path: state.custom_root_path,
        effective_root_path: effective_root_path.to_string_lossy().to_string(),
        default_root_path: default_root_path.to_string_lossy().to_string(),
    })
}
