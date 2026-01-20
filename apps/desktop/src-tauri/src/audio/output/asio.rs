use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use asio_sys::Asio;
use once_cell::sync::Lazy;
use rodio::cpal::traits::{DeviceTrait, HostTrait};
use rodio::{OutputStream, OutputStreamHandle, Sink};

use super::{AudioOutputBackend, AudioSink, OutputStreamInfo};

pub const ASIO_BACKEND_ID: &str = "asio";

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

    fn spawn_output_stream_thread(
        preferred_device_name: Option<String>,
    ) -> Result<(StreamThread, OutputStreamHandle, Option<String>, Option<u32>), String> {
        let (ready_tx, ready_rx) = mpsc::channel::<
            Result<(OutputStreamHandle, Option<String>, Option<u32>), String>,
        >();
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>();

        let join = thread::spawn(move || {
            let result = (|| -> Result<(OutputStream, OutputStreamHandle, Option<String>, Option<u32>), String> {
                let host = Self::host()?;
                let mut attempts: Vec<String> = Vec::new();

                let preferred = preferred_device_name
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty());

                let try_stream_for_device = |device: &rodio::cpal::Device| -> Result<
                    (OutputStream, OutputStreamHandle, Option<u32>),
                    String,
                > {
                    let default_config = device
                        .default_output_config()
                        .map_err(|e| format!("Failed to query default output config: {e}"))?;

                    let select_config = |preferred_format: rodio::cpal::SampleFormat,
                                         default_config: &rodio::cpal::SupportedStreamConfig| {
                        let Ok(configs) = device.supported_output_configs() else {
                            return None;
                        };

                        let desired_channels = default_config.channels();
                        let desired_rate = default_config.sample_rate().0;
                        let mut best: Option<(u32, rodio::cpal::SupportedStreamConfig)> = None;

                        for range in configs {
                            if range.channels() != desired_channels {
                                continue;
                            }
                            if range.sample_format() != preferred_format {
                                continue;
                            }

                            let min_rate = range.min_sample_rate().0;
                            let max_rate = range.max_sample_rate().0;
                            let picked = desired_rate.clamp(min_rate, max_rate);
                            let delta = if desired_rate >= min_rate && desired_rate <= max_rate {
                                0
                            } else {
                                desired_rate.abs_diff(picked)
                            };
                            let candidate = range.with_sample_rate(rodio::cpal::SampleRate(picked));

                            match best.as_ref() {
                                Some((best_delta, _)) if *best_delta <= delta => {}
                                _ => best = Some((delta, candidate)),
                            }

                            if delta == 0 {
                                break;
                            }
                        }

                        best.map(|(_, cfg)| cfg)
                    };

                    // Prefer float output when available. Some drivers (notably ASIO4ALL) may
                    // report `I32` as the default format but produce silence in that mode.
                    let selected_config = if default_config.sample_format() == rodio::cpal::SampleFormat::F32 {
                        default_config.clone()
                    } else {
                        select_config(rodio::cpal::SampleFormat::F32, &default_config)
                            .or_else(|| select_config(rodio::cpal::SampleFormat::I16, &default_config))
                            .unwrap_or_else(|| default_config.clone())
                    };

                    let output_sample_rate = Some(selected_config.sample_rate().0);

                    // Some ASIO drivers expose many output channels (often including disabled
                    // busses). Forcing a 2-channel stream can end up mapped to an inactive pair,
                    // resulting in silence even though the stream successfully opens. Prefer the
                    // driver's default channel count so audio is present on all active outputs.
                    let mut opened_config = selected_config.clone();
                    let (stream, handle) = match OutputStream::try_from_device_config(
                        device,
                        selected_config.clone(),
                    ) {
                        Ok(value) => value,
                        Err(err) => {
                            if selected_config.channels() <= 2 {
                                return Err(format!("{err}"));
                            }

                            // Fall back to a stereo stream for drivers that refuse to open
                            // multi-channel configs.
                            let stereo_config = rodio::cpal::SupportedStreamConfig::new(
                                2,
                                selected_config.sample_rate(),
                                *selected_config.buffer_size(),
                                selected_config.sample_format(),
                            );
                            opened_config = stereo_config.clone();
                            OutputStream::try_from_device_config(device, stereo_config)
                                .map_err(|e| format!("{e}"))?
                        }
                    };

                    let device_label = device.name().ok();
                    eprintln!(
                        "[NativeAudio] ASIO stream init: device={device_label:?} cfg={}ch @ {}Hz ({:?})",
                        opened_config.channels(),
                        opened_config.sample_rate().0,
                        opened_config.sample_format()
                    );

                    Ok((stream, handle, output_sample_rate))
                };

                let mut enumerated_any = false;

                if let Some(preferred) = preferred {
                    let mut found = false;
                    let devices = host
                        .output_devices()
                        .map_err(|e| format!("Failed to enumerate output devices: {e}"))?;
                    for device in devices {
                        enumerated_any = true;
                        let Ok(name) = device.name() else {
                            continue;
                        };
                        let normalized = name.trim();
                        if normalized != preferred
                            && !normalized.eq_ignore_ascii_case(preferred)
                            && name != preferred
                        {
                            continue;
                        }

                        found = true;
                        match try_stream_for_device(&device) {
                            Ok((stream, handle, output_sample_rate)) => {
                                return Ok((stream, handle, Some(name), output_sample_rate));
                            }
                            Err(err) => {
                                attempts.push(format!("preferred '{preferred}' failed: {err}"));
                            }
                        }
                    }

                    if !found {
                        attempts.push(format!("preferred '{preferred}' not found"));
                    }
                }

                let mut did_clear_stale = false;
                for pass in 0..2 {
                    let devices = host
                        .output_devices()
                        .map_err(|e| format!("Failed to enumerate output devices: {e}"))?;
                    for device in devices {
                        enumerated_any = true;
                        let device_name = device.name().ok();
                        match try_stream_for_device(&device) {
                            Ok((stream, handle, output_sample_rate)) => {
                                return Ok((stream, handle, device_name, output_sample_rate));
                            }
                            Err(err) => {
                                let label = device_name.clone().unwrap_or_else(|| "<device>".into());
                                attempts.push(format!("'{label}' failed: {err}"));
                            }
                        }
                    }

                    if enumerated_any || did_clear_stale || pass == 1 {
                        break;
                    }

                    // Some ASIO drivers can leave a stale "current driver" behind when switching
                    // backends quickly. Clearing it here helps CPAL re-enumerate drivers.
                    unsafe {
                        asio_sys::bindings::asio_import::remove_current_driver();
                    }
                    did_clear_stale = true;
                }

                if !enumerated_any {
                    // As a last resort, try to prime the driver loader so CPAL can enumerate.
                    let asio = Asio::new();
                    let candidates = preferred
                        .into_iter()
                        .map(|value| value.to_string())
                        .collect::<Vec<_>>();
                    let candidates = if candidates.is_empty() {
                        asio.driver_names().into_iter().take(16).collect()
                    } else {
                        candidates
                    };

                    for candidate in candidates {
                        match asio.load_driver(&candidate) {
                            Ok(driver) => {
                                attempts.push(format!(
                                    "asio_sys load_driver '{candidate}': ok (ins={}, outs={})",
                                    driver.channels().map(|c| c.ins).unwrap_or_default(),
                                    driver.channels().map(|c| c.outs).unwrap_or_default(),
                                ));
                                let destroyed = driver
                                    .destroy()
                                    .map_err(|e| format!("asio_sys destroy '{candidate}': {e}"))?;
                                if !destroyed {
                                    attempts.push(format!("asio_sys destroy '{candidate}': driver still has active handles"));
                                }

                                let devices = host
                                    .output_devices()
                                    .map_err(|e| format!("Failed to enumerate output devices: {e}"))?;
                                for device in devices {
                                    let device_name = device.name().ok();
                                    match try_stream_for_device(&device) {
                                        Ok((stream, handle, output_sample_rate)) => {
                                            return Ok((stream, handle, device_name, output_sample_rate));
                                        }
                                        Err(err) => {
                                            let label = device_name.clone().unwrap_or_else(|| "<device>".into());
                                            attempts.push(format!("'{label}' failed: {err}"));
                                        }
                                    }
                                }
                                break;
                            }
                            Err(err) => {
                                attempts.push(format!("asio_sys load_driver '{candidate}': {err}"));
                            }
                        }
                    }
                }

                if attempts.is_empty() {
                    Err("No usable output device found".into())
                } else {
                    Err(format!(
                        "No usable output device found. Attempts: {}",
                        attempts.join(" | ")
                    ))
                }
            })();

            match result {
                Ok((stream, handle, device_name, output_sample_rate)) => {
                    let _ = ready_tx.send(Ok((handle, device_name, output_sample_rate)));
                    let _ = shutdown_rx.recv();
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

impl Default for AsioBackend {
    fn default() -> Self {
        Self::new()
    }
}

static ASIO_BACKEND: Lazy<Arc<AsioBackend>> = Lazy::new(|| Arc::new(AsioBackend::new()));

pub fn asio_backend() -> Arc<dyn AudioOutputBackend> {
    ASIO_BACKEND.clone()
}

pub(crate) fn open_control_panel(device_name: Option<String>) -> Result<(), String> {
    let asio = Asio::new();
    let had_loaded_driver = asio.loaded_driver().is_some();

    let requested = device_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let driver = if let Some(requested) = requested {
        match asio.load_driver(requested) {
            Ok(driver) => driver,
            Err(asio_sys::LoadDriverError::DriverAlreadyExists) => {
                let Some(loaded) = asio.loaded_driver() else {
                    return Err(format!("ASIO driver '{requested}' is already loaded"));
                };
                let current = loaded.name();
                if current.trim().eq_ignore_ascii_case(requested) {
                    loaded
                } else {
                    return Err(format!(
                        "ASIO driver '{requested}' cannot be opened because '{current}' is currently loaded"
                    ));
                }
            }
            Err(err) => return Err(format!("Failed to load ASIO driver '{requested}': {err}")),
        }
    } else {
        asio.loaded_driver()
            .ok_or_else(|| "No ASIO driver loaded".to_string())?
    };

    driver
        .open_control_panel()
        .map_err(|err| format!("ASIO control panel failed: {err}"))?;

    if !had_loaded_driver {
        let _ = driver.destroy();
    }

    Ok(())
}

impl AudioOutputBackend for AsioBackend {
    fn id(&self) -> &'static str {
        ASIO_BACKEND_ID
    }

    fn list_devices(&self) -> Result<Vec<String>, String> {
        let stream_open = self.is_stream_open();

        if !stream_open {
            if let Ok(host) = Self::host() {
                if let Ok(devices) = host.output_devices() {
                    let mut names = Vec::new();
                    for device in devices {
                        if let Ok(name) = device.name() {
                            names.push(name);
                        }
                    }
                    if !names.is_empty() {
                        names.sort();
                        names.dedup();
                        return Ok(names);
                    }
                }
            }
        }

        // Avoid enumerating devices through CPAL when a stream is open - CPAL's ASIO device
        // enumeration loads and initializes drivers. With an active stream this may return an
        // empty list because ASIO only supports a single loaded driver at a time.
        let mut names = Asio::new().driver_names();
        names.sort();
        names.dedup();
        Ok(names)
    }

    fn default_device_name(&self) -> Option<String> {
        let Ok(guard) = self.state.lock() else {
            return None;
        };
        if guard.handle.is_some() && guard.thread.is_some() {
            if let Some(name) = guard.device_name.clone() {
                return Some(name);
            }
        }

        drop(guard);

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
        let previous_device_name = {
            let mut guard = self
                .state
                .lock()
                .map_err(|_| "Audio stream state is locked".to_string())?;
            let previous = guard.device_name.clone();
            guard.handle = None;
            guard.output_sample_rate = None;
            if let Some(mut thread) = guard.thread.take() {
                thread.shutdown();
            }
            previous
        };

        let spawn_result = Self::spawn_output_stream_thread(device_name.clone());
        let (thread, handle, resolved_name, output_sample_rate) = match spawn_result {
            Ok(result) => result,
            Err(error) => {
                if previous_device_name.is_some() {
                    if let Ok((thread, handle, resolved_name, output_sample_rate)) =
                        Self::spawn_output_stream_thread(previous_device_name.clone())
                    {
                        let mut guard = self
                            .state
                            .lock()
                            .map_err(|_| "Audio stream state is locked".to_string())?;
                        guard.thread = Some(thread);
                        guard.handle = Some(handle);
                        guard.device_name = resolved_name.or(previous_device_name);
                        guard.output_sample_rate = output_sample_rate;
                    }
                }
                return Err(error);
            }
        };

        let mut guard = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?;
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
