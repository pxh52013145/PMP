use std::sync::Arc;

use rodio::Source;

#[cfg(test)]
mod null;
#[cfg(target_os = "windows")]
mod asio;
mod rodio_cpal;
#[cfg(target_os = "windows")]
mod wasapi;
#[cfg(target_os = "windows")]
mod wasapi_exclusive;

pub use rodio_cpal::default_backend;
pub use rodio_cpal::RODIO_CPAL_BACKEND_ID;
#[cfg(target_os = "windows")]
pub use asio::{asio_backend, ASIO_BACKEND_ID};
#[cfg(target_os = "windows")]
pub use wasapi::{wasapi_backend, WASAPI_BACKEND_ID};
#[cfg(target_os = "windows")]
pub use wasapi_exclusive::{wasapi_exclusive_backend, WASAPI_EXCLUSIVE_BACKEND_ID};

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
    pub device_name: Option<String>,
    pub output_sample_rate: Option<u32>,
}

pub trait AudioOutputBackend: Send + Sync {
    fn id(&self) -> &'static str;
    fn list_devices(&self) -> Result<Vec<String>, String>;
    fn default_device_name(&self) -> Option<String>;
    fn current_info(&self) -> OutputStreamInfo;
    fn is_stream_open(&self) -> bool;
    fn select_device(&self, device_name: Option<String>) -> Result<OutputStreamInfo, String>;
    fn create_sink(&self) -> Result<(Arc<dyn AudioSink>, OutputStreamInfo), String>;

    fn take_error(&self) -> Option<AudioOutputError> {
        None
    }
}

#[derive(Clone, Debug)]
pub struct AudioOutputError {
    pub code: &'static str,
    pub message: String,
}
