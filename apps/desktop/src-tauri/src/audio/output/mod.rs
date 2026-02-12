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
pub(crate) use render_ahead::{shared_render_ahead_metrics, wrap_source_for_shared_backend};
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

pub fn rodio_cpal_backend() -> Arc<dyn AudioOutputBackend> {
    rodio_cpal::default_backend()
}

#[cfg(target_os = "windows")]
pub fn default_backend() -> Arc<dyn AudioOutputBackend> {
    if std::env::var("PMP_AUDIO_DEFAULT_BACKEND")
        .ok()
        .map(|value| value.trim().eq_ignore_ascii_case("rodio-cpal"))
        .unwrap_or(false)
    {
        return rodio_cpal_backend();
    }

    let _guard = BACKEND_FALLBACK_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let backend = wasapi_exclusive_backend();
    if backend.create_sink().is_ok() {
        return backend;
    }

    let shared_raw = wasapi_shared_raw_backend();
    if shared_raw.create_sink().is_ok() {
        return shared_raw;
    }

    let fallback = wasapi_backend();
    if fallback.create_sink().is_ok() {
        return fallback;
    }

    rodio_cpal_backend()
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
        let default_name = self.default_device_name();
        self.list_devices().map(|devices| {
            devices
                .into_iter()
                .map(|name| OutputDeviceInfo {
                    id: name.clone(),
                    name: name.clone(),
                    is_default: default_name
                        .as_deref()
                        .is_some_and(|default_device| default_device == name),
                })
                .collect()
        })
    }
    fn default_device_name(&self) -> Option<String>;
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

#[derive(Clone, Debug)]
pub struct AudioOutputError {
    pub code: &'static str,
    pub message: String,
}
