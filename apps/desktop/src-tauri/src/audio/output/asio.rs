use std::sync::Arc;

use once_cell::sync::Lazy;

use super::{AudioOutputBackend, AudioSink, OutputStreamInfo};

pub const ASIO_BACKEND_ID: &str = "asio";

pub struct AsioBackend;

impl AsioBackend {
    pub fn new() -> Self {
        Self
    }
}

impl Default for AsioBackend {
    fn default() -> Self {
        Self::new()
    }
}

static DEFAULT_BACKEND: Lazy<Arc<AsioBackend>> = Lazy::new(|| Arc::new(AsioBackend::new()));

pub fn asio_backend() -> Arc<dyn AudioOutputBackend> {
    DEFAULT_BACKEND.clone()
}

impl AudioOutputBackend for AsioBackend {
    fn id(&self) -> &'static str {
        ASIO_BACKEND_ID
    }

    fn list_devices(&self) -> Result<Vec<String>, String> {
        Ok(Vec::new())
    }

    fn default_device_name(&self) -> Option<String> {
        None
    }

    fn current_info(&self) -> OutputStreamInfo {
        OutputStreamInfo::default()
    }

    fn is_stream_open(&self) -> bool {
        false
    }

    fn select_device(&self, _device_name: Option<String>) -> Result<OutputStreamInfo, String> {
        Err("ASIO output backend is not implemented yet".to_string())
    }

    fn create_sink(&self) -> Result<(Arc<dyn AudioSink>, OutputStreamInfo), String> {
        Err("ASIO output backend is not implemented yet".to_string())
    }
}

