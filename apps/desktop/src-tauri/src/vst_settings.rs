use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VstBufferProfile {
    Stable,
    Balanced,
    LowLatency,
}

impl Default for VstBufferProfile {
    fn default() -> Self {
        Self::Stable
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VstSidechainMode {
    Disabled,
    Silence,
    #[serde(rename = "self")]
    SelfFeed,
}

impl Default for VstSidechainMode {
    fn default() -> Self {
        Self::Disabled
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VstSettings {
    #[serde(default)]
    pub buffer_profile: VstBufferProfile,
    #[serde(default)]
    pub sidechain_mode: VstSidechainMode,
    #[serde(default)]
    pub sidechain_channels: u32,
}

impl Default for VstSettings {
    fn default() -> Self {
        Self {
            buffer_profile: VstBufferProfile::Stable,
            sidechain_mode: VstSidechainMode::Disabled,
            sidechain_channels: 0,
        }
    }
}

static SETTINGS: Lazy<Mutex<Option<VstSettings>>> = Lazy::new(|| Mutex::new(None));

fn settings_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Unable to resolve app data directory".to_string())?;
    let dir = app_data_dir.join("audio");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create audio directory: {e}"))?;
    Ok(dir.join("vst-settings.json"))
}

fn read_settings_from_disk(app: &AppHandle) -> Result<VstSettings, String> {
    let path = settings_file_path(app)?;
    let data = match std::fs::read(&path) {
        Ok(data) => data,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(VstSettings::default()),
        Err(err) => return Err(format!("Failed to read VST settings: {err}")),
    };

    serde_json::from_slice::<VstSettings>(&data)
        .map_err(|e| format!("Failed to parse VST settings: {e}"))
}

fn write_settings_to_disk(app: &AppHandle, settings: &VstSettings) -> Result<(), String> {
    let path = settings_file_path(app)?;
    let data = serde_json::to_vec_pretty(settings)
        .map_err(|e| format!("Failed to encode VST settings: {e}"))?;
    std::fs::write(&path, data).map_err(|e| format!("Failed to write VST settings: {e}"))
}

pub fn get_settings(app: &AppHandle) -> Result<VstSettings, String> {
    let mut guard = SETTINGS
        .lock()
        .map_err(|_| "VST settings state is locked".to_string())?;
    if let Some(settings) = guard.as_ref() {
        return Ok(settings.clone());
    }

    let settings = read_settings_from_disk(app).unwrap_or_default();
    *guard = Some(settings.clone());
    Ok(settings)
}

pub fn cached_settings() -> VstSettings {
    let guard = match SETTINGS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    guard.clone().unwrap_or_default()
}

pub fn set_settings(app: &AppHandle, settings: VstSettings) -> Result<(), String> {
    {
        let mut guard = SETTINGS
            .lock()
            .map_err(|_| "VST settings state is locked".to_string())?;
        *guard = Some(settings.clone());
    }
    write_settings_to_disk(app, &settings)?;
    Ok(())
}

pub fn buffer_profile_latency_ms(profile: VstBufferProfile) -> u64 {
    match profile {
        VstBufferProfile::Stable => 150,
        VstBufferProfile::Balanced => 100,
        VstBufferProfile::LowLatency => 60,
    }
}

pub fn buffer_profile_latency_frames(profile: VstBufferProfile, sample_rate: u32) -> u32 {
    let sample_rate = sample_rate.max(1) as u64;
    let ms = buffer_profile_latency_ms(profile);
    ((sample_rate.saturating_mul(ms)) / 1000).max(1) as u32
}

pub fn effective_sidechain_channels(settings: &VstSettings, main_channels: usize) -> u32 {
    if settings.sidechain_mode == VstSidechainMode::Disabled {
        return 0;
    }

    let default = (main_channels.max(1).min(2)) as u32;
    let requested = settings.sidechain_channels.min(2);
    if requested == 0 {
        default
    } else {
        requested
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effective_sidechain_channels_disabled_is_zero() {
        let settings = VstSettings::default();
        assert_eq!(effective_sidechain_channels(&settings, 2), 0);
        assert_eq!(effective_sidechain_channels(&settings, 1), 0);
    }

    #[test]
    fn effective_sidechain_channels_defaults_to_main_width() {
        let mut settings = VstSettings::default();
        settings.sidechain_mode = VstSidechainMode::Silence;
        settings.sidechain_channels = 0;
        assert_eq!(effective_sidechain_channels(&settings, 2), 2);
        assert_eq!(effective_sidechain_channels(&settings, 1), 1);
    }

    #[test]
    fn effective_sidechain_channels_respects_override() {
        let mut settings = VstSettings::default();
        settings.sidechain_mode = VstSidechainMode::SelfFeed;
        settings.sidechain_channels = 1;
        assert_eq!(effective_sidechain_channels(&settings, 2), 1);

        settings.sidechain_channels = 9;
        assert_eq!(effective_sidechain_channels(&settings, 2), 2);
    }
}
