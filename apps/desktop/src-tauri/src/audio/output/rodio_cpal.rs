use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use once_cell::sync::Lazy;
use rodio::cpal::traits::{DeviceTrait, HostTrait};
use rodio::{OutputStream, OutputStreamHandle, Sink};

use super::{AudioOutputBackend, AudioSink, OutputStreamInfo};
use crate::audio::realtime_scheduler::RealtimePressureProfile;

pub const RODIO_CPAL_BACKEND_ID: &str = "rodio-cpal";

#[derive(Default)]
struct StreamState {
    thread: Option<StreamThread>,
    handle: Option<OutputStreamHandle>,
    device_name: Option<String>,
    output_sample_rate: Option<u32>,
}

struct StreamThread {
    shutdown_tx: Option<mpsc::Sender<()>>,
    join: Option<JoinHandle<()>>,
}

impl StreamThread {
    fn shutdown(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

impl Drop for StreamThread {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub struct RodioCpalBackend {
    state: Mutex<StreamState>,
}

impl RodioCpalBackend {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(StreamState::default()),
        }
    }

    fn resolve_host() -> rodio::cpal::Host {
        #[cfg(target_os = "windows")]
        {
            // When CPAL is built with extra backends (e.g. ASIO), `default_host()` may pick a host
            // that enumerates "drivers" instead of normal Windows output endpoints.
            // For the "rodio-cpal" backend we want the stable, typical Windows device list.
            match rodio::cpal::host_from_id(rodio::cpal::HostId::Wasapi) {
                Ok(host) => host,
                Err(_) => rodio::cpal::default_host(),
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            rodio::cpal::default_host()
        }
    }

    fn spawn_output_stream_thread(
        preferred_device_name: Option<String>,
    ) -> Result<(StreamThread, OutputStreamHandle, Option<String>, Option<u32>), String> {
        let (ready_tx, ready_rx) = mpsc::channel::<
            Result<(OutputStreamHandle, Option<String>, Option<u32>), String>,
        >();
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>();

        let join = thread::spawn(move || {
            let _priority_guard = crate::audio::threading::promote_current_thread_for_audio_output();
            crate::audio::threading::apply_audio_output_pressure_profile(
                crate::audio::realtime_scheduler::SCHEDULER.profile(),
            );

            let result = (|| -> Result<(OutputStream, OutputStreamHandle, Option<String>, Option<u32>), String> {
                let host = Self::resolve_host();

                if let Some(preferred) = preferred_device_name.as_deref() {
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
                        let (stream, handle) = OutputStream::try_from_device(&device).map_err(|e| {
                            format!("Failed to init output device '{preferred}': {e}")
                        })?;
                        return Ok((stream, handle, Some(name), output_sample_rate));
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
                        return Ok((stream, handle, device_name, output_sample_rate));
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
                        return Ok((stream, handle, device_name, output_sample_rate));
                    }
                }

                Err("No usable output device found".into())
            })();

            match result {
                Ok((stream, handle, device_name, output_sample_rate)) => {
                    let _ = ready_tx.send(Ok((handle, device_name, output_sample_rate)));
                    loop {
                        let profile = crate::audio::realtime_scheduler::SCHEDULER.profile();
                        crate::audio::threading::apply_audio_output_pressure_profile(profile);
                        let wait_ms = match profile {
                            RealtimePressureProfile::Normal => 250,
                            RealtimePressureProfile::Guarded => 96,
                            RealtimePressureProfile::Critical => 48,
                        };
                        if shutdown_rx.recv_timeout(Duration::from_millis(wait_ms)).is_ok() {
                            break;
                        }
                    }
                    drop(stream);
                }
                Err(err) => {
                    let _ = ready_tx.send(Err(err));
                }
            }
        });

        let ready = ready_rx
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "Timed out waiting for output stream thread".to_string())?;
        match ready {
            Ok((handle, device_name, output_sample_rate)) => Ok((
                StreamThread {
                    shutdown_tx: Some(shutdown_tx),
                    join: Some(join),
                },
                handle,
                device_name,
                output_sample_rate,
            )),
            Err(err) => {
                let _ = join.join();
                Err(err)
            }
        }
    }

    fn ensure_stream_handle(&self) -> Result<(OutputStreamHandle, OutputStreamInfo), String> {
        let mut guard = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?;
        if let (Some(handle), Some(_thread)) = (guard.handle.clone(), guard.thread.as_ref()) {
            return Ok((
                handle,
                OutputStreamInfo {
                    device_id: guard.device_name.clone(),
                    device_name: guard.device_name.clone(),
                    output_sample_rate: guard.output_sample_rate,
                },
            ));
        }

        let (thread, handle, device_name, output_sample_rate) =
            Self::spawn_output_stream_thread(guard.device_name.clone())?;
        guard.thread = Some(thread);
        guard.handle = Some(handle.clone());
        guard.device_name = device_name.clone();
        guard.output_sample_rate = output_sample_rate;
        Ok((
            handle,
            OutputStreamInfo {
                device_id: device_name.clone(),
                device_name,
                output_sample_rate,
            },
        ))
    }
}

impl Default for RodioCpalBackend {
    fn default() -> Self {
        Self::new()
    }
}

static DEFAULT_BACKEND: Lazy<Arc<RodioCpalBackend>> = Lazy::new(|| Arc::new(RodioCpalBackend::new()));

pub fn default_backend() -> Arc<dyn AudioOutputBackend> {
    DEFAULT_BACKEND.clone()
}

impl AudioOutputBackend for RodioCpalBackend {
    fn id(&self) -> &'static str {
        RODIO_CPAL_BACKEND_ID
    }

    fn list_devices(&self) -> Result<Vec<String>, String> {
        let host = Self::resolve_host();
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
        Self::resolve_host()
            .default_output_device()
            .and_then(|device| device.name().ok())
    }

    fn current_info(&self) -> OutputStreamInfo {
        let guard = self.state.lock();
        let Ok(guard) = guard else {
            return OutputStreamInfo::default();
        };
        OutputStreamInfo {
            device_id: guard.device_name.clone(),
            device_name: guard.device_name.clone(),
            output_sample_rate: guard.output_sample_rate,
        }
    }

    fn is_stream_open(&self) -> bool {
        let guard = self.state.lock();
        let Ok(guard) = guard else {
            return false;
        };
        guard.handle.is_some() && guard.thread.is_some()
    }

    fn select_device(&self, device_name: Option<String>) -> Result<OutputStreamInfo, String> {
        let (thread, handle, resolved_name, output_sample_rate) =
            Self::spawn_output_stream_thread(device_name.clone())?;

        let mut guard = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?;
        if let Some(mut thread) = guard.thread.take() {
            thread.shutdown();
        }
        guard.thread = Some(thread);
        guard.handle = Some(handle);
        guard.device_name = resolved_name.or(device_name);
        guard.output_sample_rate = output_sample_rate;

        Ok(OutputStreamInfo {
            device_id: guard.device_name.clone(),
            device_name: guard.device_name.clone(),
            output_sample_rate,
        })
    }

    fn close_stream(&self) {
        let Ok(mut guard) = self.state.lock() else {
            return;
        };
        guard.handle = None;
        guard.output_sample_rate = None;
        if let Some(mut thread) = guard.thread.take() {
            thread.shutdown();
        }
    }

    fn create_sink(&self) -> Result<(Arc<dyn AudioSink>, OutputStreamInfo), String> {
        let (handle, info) = self.ensure_stream_handle()?;
        let sink = Sink::try_new(&handle).map_err(|e| format!("Failed to create sink: {e}"))?;
        Ok((Arc::new(sink), info))
    }
}
