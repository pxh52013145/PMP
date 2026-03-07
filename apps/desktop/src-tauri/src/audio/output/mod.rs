use std::sync::Arc;

use crate::audio::policy::{NativeAudioOutputQuantizationMode, NativeAudioTransportMode};
use once_cell::sync::Lazy;
use rodio::Source;

#[cfg(all(target_os = "windows", feature = "asio-sdk"))]
mod asio;
#[cfg(test)]
mod null;
mod render_ahead;
mod rodio_cpal;
#[cfg(target_os = "windows")]
mod wasapi;
#[cfg(target_os = "windows")]
mod wasapi_exclusive;

#[cfg(all(target_os = "windows", feature = "asio-sdk"))]
pub(crate) use asio::open_control_panel as open_asio_control_panel;
#[cfg(all(target_os = "windows", feature = "asio-sdk"))]
pub use asio::{asio_backend, ASIO_BACKEND_ID};
pub(crate) use render_ahead::{
    shared_render_ahead_metrics, shared_render_ahead_ready_snapshot,
    wait_for_shared_render_ahead_ready, wrap_source_for_shared_backend,
};
pub use rodio_cpal::RODIO_CPAL_BACKEND_ID;
#[cfg(target_os = "windows")]
pub use wasapi::{wasapi_backend, WASAPI_BACKEND_ID};
#[cfg(target_os = "windows")]
pub use wasapi_exclusive::{
    wasapi_exclusive_backend, wasapi_shared_raw_backend, WASAPI_EXCLUSIVE_BACKEND_ID,
    WASAPI_SHARED_RAW_BACKEND_ID,
};

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct OutputCallbackMetricsSnapshot {
    pub render_p99_us: u32,
    pub wait_timeout_count: u64,
    pub render_underrun_events: u64,
    pub render_underrun_frames: u64,
    pub interval_jitter_p99_us: u32,
    pub interval_overrun_count: u64,
    pub expected_interval_us: u32,
}

#[cfg(target_os = "windows")]
pub(crate) fn output_callback_metrics() -> OutputCallbackMetricsSnapshot {
    wasapi_exclusive::output_callback_metrics()
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn output_callback_metrics() -> OutputCallbackMetricsSnapshot {
    OutputCallbackMetricsSnapshot::default()
}

static BACKEND_FALLBACK_LOCK: Lazy<std::sync::Mutex<()>> = Lazy::new(|| std::sync::Mutex::new(()));

#[cfg(target_os = "windows")]
fn normalize_default_backend_env(value: &str) -> Option<&'static str> {
    let normalized = value.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "" | "auto" | "default" => None,
        "rodio" | "cpal" | "rodio-cpal" => Some(RODIO_CPAL_BACKEND_ID),
        "wasapi" | "wasapi-shared" | "shared" => Some(WASAPI_BACKEND_ID),
        "wasapi-shared-raw" | "shared-raw" | "raw" => Some(WASAPI_SHARED_RAW_BACKEND_ID),
        "wasapi-exclusive" | "exclusive" => Some(WASAPI_EXCLUSIVE_BACKEND_ID),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn backend_by_id(backend_id: &str) -> Arc<dyn AudioOutputBackend> {
    match backend_id {
        WASAPI_SHARED_RAW_BACKEND_ID => wasapi_shared_raw_backend(),
        WASAPI_BACKEND_ID => wasapi_backend(),
        RODIO_CPAL_BACKEND_ID => rodio_cpal_backend(),
        WASAPI_EXCLUSIVE_BACKEND_ID => wasapi_exclusive_backend(),
        _ => rodio_cpal_backend(),
    }
}

#[cfg(target_os = "windows")]
fn resolve_env_default_backend() -> Option<Arc<dyn AudioOutputBackend>> {
    let requested = std::env::var("PMP_AUDIO_DEFAULT_BACKEND")
        .ok()
        .and_then(|value| normalize_default_backend_env(&value))?;

    let backend = backend_by_id(requested);
    backend.create_sink().ok().map(|_| backend)
}

pub fn rodio_cpal_backend() -> Arc<dyn AudioOutputBackend> {
    rodio_cpal::default_backend()
}

#[cfg(target_os = "windows")]
pub fn default_backend() -> Arc<dyn AudioOutputBackend> {
    let _guard = BACKEND_FALLBACK_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    if let Some(env_backend) = resolve_env_default_backend() {
        return env_backend;
    }

    let exclusive = wasapi_exclusive_backend();
    if exclusive.create_sink().is_ok() {
        return exclusive;
    }

    let shared_raw = wasapi_shared_raw_backend();
    if shared_raw.create_sink().is_ok() {
        return shared_raw;
    }

    let shared = wasapi_backend();
    if shared.create_sink().is_ok() {
        return shared;
    }

    let rodio = rodio_cpal_backend();
    if rodio.create_sink().is_ok() {
        return rodio;
    }

    rodio
}

#[cfg(not(target_os = "windows"))]
pub use rodio_cpal::default_backend;

pub type BoxedSource = Box<dyn Source<Item = f32> + Send + 'static>;

pub trait AudioSink: Send + Sync {
    fn append(&self, source: BoxedSource);
    fn play(&self);
    fn pause(&self);
    fn stop(&self);
    fn empty(&self) -> bool;
    fn set_volume(&self, value: f32);
    fn flush(&self) {}
}

impl AudioSink for rodio::Sink {
    fn append(&self, source: BoxedSource) {
        self.append(source);
    }

    fn play(&self) {
        self.play();
    }

    fn pause(&self) {
        self.pause();
    }

    fn stop(&self) {
        self.stop();
    }

    fn empty(&self) -> bool {
        self.empty()
    }

    fn set_volume(&self, value: f32) {
        self.set_volume(value);
    }
}

#[derive(Clone, Debug, Default)]
pub struct OutputStreamInfo {
    pub device_id: Option<String>,
    pub device_name: Option<String>,
    pub output_sample_rate: Option<u32>,
}

#[derive(Clone, Debug)]
pub struct OutputDeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

pub trait AudioOutputBackend: Send + Sync {
    fn id(&self) -> &'static str;
    fn list_devices(&self) -> Result<Vec<String>, String>;
    fn list_devices_v2(&self) -> Result<Vec<OutputDeviceInfo>, String> {
        let default_info = self.default_device_info();
        self.list_devices().map(|devices| {
            devices
                .into_iter()
                .map(|name| OutputDeviceInfo {
                    id: name.clone(),
                    name: name.clone(),
                    is_default: default_info
                        .device_id
                        .as_deref()
                        .is_some_and(|default_device| default_device == name)
                        || default_info
                            .device_name
                            .as_deref()
                            .is_some_and(|default_device| default_device == name),
                })
                .collect()
        })
    }
    fn default_device_name(&self) -> Option<String>;
    fn default_device_info(&self) -> OutputStreamInfo {
        let device_name = self.default_device_name();
        OutputStreamInfo {
            device_id: device_name.clone(),
            device_name,
            output_sample_rate: None,
        }
    }
    fn current_info(&self) -> OutputStreamInfo;
    fn is_stream_open(&self) -> bool;
    fn select_device(&self, device_name: Option<String>) -> Result<OutputStreamInfo, String>;
    fn select_device_by_id(&self, device_id: Option<String>) -> Result<OutputStreamInfo, String> {
        self.select_device(device_id)
    }
    fn create_sink(&self) -> Result<(Arc<dyn AudioSink>, OutputStreamInfo), String>;

    fn close_stream(&self) {}

    fn take_error(&self) -> Option<AudioOutputError> {
        None
    }

    fn set_transport_mode(&self, _mode: NativeAudioTransportMode) {}

    fn set_output_quantization_mode(&self, _mode: NativeAudioOutputQuantizationMode) {}
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "windows")]
    use super::{normalize_default_backend_env, RODIO_CPAL_BACKEND_ID, WASAPI_BACKEND_ID};
    #[cfg(target_os = "windows")]
    use super::{WASAPI_EXCLUSIVE_BACKEND_ID, WASAPI_SHARED_RAW_BACKEND_ID};

    #[cfg(target_os = "windows")]
    #[test]
    fn normalize_default_backend_env_supports_explicit_aliases() {
        assert_eq!(
            normalize_default_backend_env("rodio"),
            Some(RODIO_CPAL_BACKEND_ID)
        );
        assert_eq!(
            normalize_default_backend_env("wasapi"),
            Some(WASAPI_BACKEND_ID)
        );
        assert_eq!(
            normalize_default_backend_env("shared-raw"),
            Some(WASAPI_SHARED_RAW_BACKEND_ID)
        );
        assert_eq!(
            normalize_default_backend_env("exclusive"),
            Some(WASAPI_EXCLUSIVE_BACKEND_ID)
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn normalize_default_backend_env_treats_auto_as_unspecified() {
        assert_eq!(normalize_default_backend_env("auto"), None);
        assert_eq!(normalize_default_backend_env(""), None);
        assert_eq!(normalize_default_backend_env("unknown"), None);
    }
}

#[derive(Clone, Debug)]
pub struct AudioOutputError {
    pub code: &'static str,
    pub message: String,
}
