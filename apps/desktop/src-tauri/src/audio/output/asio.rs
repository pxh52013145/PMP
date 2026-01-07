use std::sync::{Arc, Mutex};

use once_cell::sync::Lazy;
use rodio::cpal::traits::{DeviceTrait, HostTrait};
use rodio::{OutputStream, OutputStreamHandle, Sink};

use super::{AudioOutputBackend, AudioSink, OutputStreamInfo};

pub const ASIO_BACKEND_ID: &str = "asio";

#[derive(Default)]
struct StreamState {
    handle: Option<OutputStreamHandle>,
    device_name: Option<String>,
    output_sample_rate: Option<u32>,
}

pub struct AsioBackend {
    state: Mutex<StreamState>,
}

impl AsioBackend {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(StreamState::default()),
        }
    }

    fn host() -> Result<rodio::cpal::Host, String> {
        rodio::cpal::host_from_id(rodio::cpal::HostId::Asio)
            .map_err(|e| format!("Failed to init ASIO host: {e}"))
    }

    fn open_output_stream_handle(
        preferred_device_name: Option<&str>,
    ) -> Result<(OutputStreamHandle, Option<String>, Option<u32>), String> {
        let host = Self::host()?;

        if let Some(preferred) = preferred_device_name {
            let devices = host
                .output_devices()
                .map_err(|e| format!("Failed to enumerate output devices: {e}"))?;
            for device in devices {
                let Ok(name) = device.name() else {
                    continue;
                };
                if name != preferred {
                    continue;
                }
                let output_sample_rate = device
                    .default_output_config()
                    .ok()
                    .map(|cfg| cfg.sample_rate().0);
                let (stream, handle) = OutputStream::try_from_device(&device)
                    .map_err(|e| format!("Failed to init output device '{preferred}': {e}"))?;
                std::mem::forget(stream);
                return Ok((handle, Some(name), output_sample_rate));
            }
            return Err(format!("Output device not found: {preferred}"));
        }

        if let Some(device) = host.default_output_device() {
            let device_name = device.name().ok();
            let output_sample_rate = device
                .default_output_config()
                .ok()
                .map(|cfg| cfg.sample_rate().0);
            if let Ok((stream, handle)) = OutputStream::try_from_device(&device) {
                std::mem::forget(stream);
                return Ok((handle, device_name, output_sample_rate));
            }
        }

        let devices = host
            .output_devices()
            .map_err(|e| format!("Failed to enumerate output devices: {e}"))?;
        for device in devices {
            let device_name = device.name().ok();
            let output_sample_rate = device
                .default_output_config()
                .ok()
                .map(|cfg| cfg.sample_rate().0);
            if let Ok((stream, handle)) = OutputStream::try_from_device(&device) {
                std::mem::forget(stream);
                return Ok((handle, device_name, output_sample_rate));
            }
        }

        Err("No usable output device found".into())
    }

    fn ensure_stream_handle(&self) -> Result<(OutputStreamHandle, OutputStreamInfo), String> {
        let mut guard = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?;
        if let Some(handle) = guard.handle.clone() {
            return Ok((
                handle,
                OutputStreamInfo {
                    device_name: guard.device_name.clone(),
                    output_sample_rate: guard.output_sample_rate,
                },
            ));
        }

        let (handle, device_name, output_sample_rate) =
            Self::open_output_stream_handle(guard.device_name.as_deref())?;
        guard.handle = Some(handle.clone());
        guard.device_name = device_name.clone();
        guard.output_sample_rate = output_sample_rate;
        Ok((
            handle,
            OutputStreamInfo {
                device_name,
                output_sample_rate,
            },
        ))
    }
}

impl Default for AsioBackend {
    fn default() -> Self {
        Self::new()
    }
}

static ASIO_BACKEND: Lazy<Arc<AsioBackend>> = Lazy::new(|| Arc::new(AsioBackend::new()));

pub fn asio_backend() -> Arc<dyn AudioOutputBackend> {
    ASIO_BACKEND.clone()
}

impl AudioOutputBackend for AsioBackend {
    fn id(&self) -> &'static str {
        ASIO_BACKEND_ID
    }

    fn list_devices(&self) -> Result<Vec<String>, String> {
        let host = Self::host()?;
        let devices = host
            .output_devices()
            .map_err(|e| format!("Failed to enumerate output devices: {e}"))?;

        let mut names = Vec::new();
        for device in devices {
            if let Ok(name) = device.name() {
                names.push(name);
            }
        }
        names.sort();
        names.dedup();
        Ok(names)
    }

    fn default_device_name(&self) -> Option<String> {
        Self::host()
            .ok()
            .and_then(|host| host.default_output_device())
            .and_then(|device| device.name().ok())
    }

    fn current_info(&self) -> OutputStreamInfo {
        let guard = self.state.lock();
        let Ok(guard) = guard else {
            return OutputStreamInfo::default();
        };
        OutputStreamInfo {
            device_name: guard.device_name.clone(),
            output_sample_rate: guard.output_sample_rate,
        }
    }

    fn is_stream_open(&self) -> bool {
        let guard = self.state.lock();
        let Ok(guard) = guard else {
            return false;
        };
        guard.handle.is_some()
    }

    fn select_device(&self, device_name: Option<String>) -> Result<OutputStreamInfo, String> {
        let (handle, resolved_name, output_sample_rate) =
            Self::open_output_stream_handle(device_name.as_deref())?;

        let mut guard = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?;
        guard.handle = Some(handle);
        guard.device_name = resolved_name.or(device_name);
        guard.output_sample_rate = output_sample_rate;

        Ok(OutputStreamInfo {
            device_name: guard.device_name.clone(),
            output_sample_rate,
        })
    }

    fn create_sink(&self) -> Result<(Arc<dyn AudioSink>, OutputStreamInfo), String> {
        let (handle, info) = self.ensure_stream_handle()?;
        let sink = Sink::try_new(&handle).map_err(|e| format!("Failed to create sink: {e}"))?;
        Ok((Arc::new(sink), info))
    }
}
