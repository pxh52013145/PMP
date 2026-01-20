use once_cell::sync::Lazy;
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        mpsc,
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use crate::audio::atomic_f32::{load_atomic_f32, store_atomic_f32};
use crate::audio::events::NativeAudioStatePayload;
use crate::audio::input::{
    open_rodio_source_at, AudioInputRegistry, DecoderCommand, SharedSamplesSource, StreamingPlayback,
    StreamingSamplesSource,
};
use crate::audio::output::{default_backend, AudioOutputBackend, AudioSink, OutputStreamInfo};
#[cfg(all(target_os = "windows", feature = "asio-sdk"))]
use crate::audio::output::ASIO_BACKEND_ID;
#[cfg(target_os = "windows")]
use crate::audio::output::WASAPI_EXCLUSIVE_BACKEND_ID;
use crate::audio::pipeline::{boxed_with_dsp, DspNodeConfig, DspRuntime, SpectrumSnapshot, SpectrumTap};
use crate::audio::playback::prepare_playback;

pub(crate) static ENGINE: Lazy<Mutex<NativeAudioEngine>> = Lazy::new(|| {
    Mutex::new(NativeAudioEngine::new())
});

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioComponentsStatePayload {
    output_backend_id: String,
    output_device_id: Option<String>,
    output_device: Option<String>,
    output_sample_rate: Option<u32>,
    preferred_input_id: Option<String>,
    active_input_id: Option<String>,
}

struct ActiveCrossfade {
    cancel: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
    old_sink: Arc<dyn AudioSink>,
    old_streaming_command_tx: Option<mpsc::Sender<DecoderCommand>>,
}

pub(crate) struct NativeAudioEngine {
    input_registry: AudioInputRegistry,
    preferred_input_id: Option<String>,
    active_input_id: Option<String>,
    output_backend: Arc<dyn AudioOutputBackend>,
    sink: Option<Arc<dyn AudioSink>>,
    active_crossfade: Option<ActiveCrossfade>,
    current_track: Option<PathBuf>,
    queue: Vec<PathBuf>,
    current_index: i32,
    queue_initialized: bool,
    streaming: Option<StreamingPlayback>,
    current_position: f64,
    duration: f64,
    base_position: f64,
    playback_started_at: Option<Instant>,
    decoded_samples: Option<Arc<Vec<f32>>>,
    decoded_channels: u16,
    decoded_sample_rate: u32,
    decoded_bit_depth: Option<u32>,
    output_sample_rate: Option<u32>,
    device_id: Option<String>,
    device_name: Option<String>,
    volume: f32,
    gain_db: f32,
    replay_gain_db: f32,
    dsp_chain: Vec<DspNodeConfig>,
    vst_enabled: bool,
    dsp_runtime: Arc<DspRuntime>,
    spectrum_tap: SpectrumTap,
    muted: bool,
    effective_volume_bits: Arc<AtomicU32>,
    playback_state: PlaybackState,
    desired_playback_state: PlaybackState,
    error_seq_counter: u64,
    last_error_seq: u64,
    last_error_code: Option<String>,
    last_error_message: Option<String>,
}

#[derive(Clone, Copy)]
pub(crate) enum PlaybackState {
    Idle,
    Loading,
    Playing,
    Paused,
    Stopped,
    Error,
}

impl PlaybackState {
    fn as_str(&self) -> &'static str {
        match self {
            PlaybackState::Idle => "idle",
            PlaybackState::Loading => "loading",
            PlaybackState::Playing => "playing",
            PlaybackState::Paused => "paused",
            PlaybackState::Stopped => "stopped",
            PlaybackState::Error => "error",
        }
    }
}

impl NativeAudioEngine {
    fn new() -> Self {
        Self::new_with_backend(default_backend())
    }

    fn new_with_backend(output_backend: Arc<dyn AudioOutputBackend>) -> Self {
        eprintln!("[NativeAudio] Output backend: {}", output_backend.id());
        Self {
            input_registry: AudioInputRegistry::default(),
            preferred_input_id: None,
            active_input_id: None,
            output_backend,
            sink: None,
            active_crossfade: None,
            current_track: None,
            queue: Vec::new(),
            current_index: -1,
            queue_initialized: false,
            streaming: None,
            current_position: 0.0,
            duration: 0.0,
            base_position: 0.0,
            playback_started_at: None,
            decoded_samples: None,
            decoded_channels: 0,
            decoded_sample_rate: 0,
            decoded_bit_depth: None,
            output_sample_rate: None,
            device_id: None,
            device_name: None,
            volume: 0.7,
            gain_db: 0.0,
            replay_gain_db: 0.0,
            dsp_chain: Vec::new(),
            vst_enabled: false,
            dsp_runtime: Arc::new(DspRuntime::new()),
            spectrum_tap: SpectrumTap::new(1024),
            muted: false,
            effective_volume_bits: Arc::new(AtomicU32::new(0.7f32.to_bits())),
            playback_state: PlaybackState::Idle,
            desired_playback_state: PlaybackState::Idle,
            error_seq_counter: 1,
            last_error_seq: 0,
            last_error_code: None,
            last_error_message: None,
        }
    }

    pub(crate) fn playback_state(&self) -> PlaybackState {
        self.playback_state
    }

    pub(crate) fn output_backend(&self) -> Arc<dyn AudioOutputBackend> {
        self.output_backend.clone()
    }

    pub(crate) fn output_sample_rate(&self) -> Option<u32> {
        self.output_sample_rate
    }

    pub(crate) fn vst_enabled(&self) -> bool {
        self.vst_enabled
    }

    pub(crate) fn set_vst_enabled(&mut self, enabled: bool) {
        self.vst_enabled = enabled;
    }

    pub(crate) fn clone_dsp_chain(&self) -> Vec<DspNodeConfig> {
        self.dsp_chain.clone()
    }

    pub(crate) fn set_vst_nodes(&mut self, vst_nodes: Vec<crate::vst_dsp::VstNodeKey>) {
        self.dsp_runtime.set_vst_nodes(vst_nodes);
    }

    pub(crate) fn list_input_ids(&self) -> Vec<&'static str> {
        self.input_registry.list_ids()
    }

    pub(crate) fn resolve_output_sample_rate(&mut self) -> u32 {
        let mut resolved = self
            .output_sample_rate
            .or_else(|| self.output_backend.current_info().output_sample_rate);
        if resolved.is_some() {
            self.output_sample_rate = resolved;
        }

        if resolved.is_none() {
            if let Ok((_sink, info)) = self.output_backend.create_sink() {
                resolved = info.output_sample_rate;
                self.output_sample_rate = resolved;
                if self.device_name.is_none() {
                    self.device_name = info
                        .device_name
                        .clone()
                        .or_else(|| self.output_backend.default_device_name());
                }
                if self.device_id.is_none() {
                    self.device_id = info.device_id.or_else(|| self.device_name.clone());
                }
            }
        }

        resolved.unwrap_or(48_000).max(1)
    }

    pub(crate) fn switch_output_backend(
        &mut self,
        target_backend: Arc<dyn AudioOutputBackend>,
    ) -> Result<(), String> {
        let target_id = target_backend.id();
        if self.output_backend.id() == target_id {
            return Ok(());
        }

        let previous_backend = self.output_backend.clone();
        eprintln!(
            "[NativeAudio] Switching output backend: {} -> {}",
            previous_backend.id(),
            target_id
        );
        #[cfg(target_os = "windows")]
        let switching_from_exclusive = previous_backend.id() == WASAPI_EXCLUSIVE_BACKEND_ID
            && target_id != WASAPI_EXCLUSIVE_BACKEND_ID;
        #[cfg(not(target_os = "windows"))]
        let switching_from_exclusive = false;

        #[cfg(target_os = "windows")]
        let switching_to_exclusive = previous_backend.id() != WASAPI_EXCLUSIVE_BACKEND_ID
            && target_id == WASAPI_EXCLUSIVE_BACKEND_ID;
        #[cfg(not(target_os = "windows"))]
        let switching_to_exclusive = false;

        #[cfg(all(target_os = "windows", feature = "asio-sdk"))]
        let switching_to_asio =
            previous_backend.id() != ASIO_BACKEND_ID && target_id == ASIO_BACKEND_ID;
        #[cfg(not(all(target_os = "windows", feature = "asio-sdk")))]
        let switching_to_asio = false;

        let previous_device_name = self.device_name.clone();
        let previous_device_id = self.device_id.clone();
        let previous_output_sample_rate = self.output_sample_rate;

        if switching_from_exclusive || switching_to_exclusive || switching_to_asio {
            self.cancel_crossfade();
            self.sync_clock();
            if let Some(old_sink) = self.sink.take() {
                old_sink.stop();
            }

            if switching_to_exclusive || switching_to_asio {
                previous_backend.close_stream();
            }
        }

        self.output_backend = target_backend;
        self.device_id = None;
        self.device_name = None;
        self.output_sample_rate = None;

        #[cfg(all(target_os = "windows", feature = "asio-sdk"))]
        let should_close_previous_stream = previous_backend.id() != ASIO_BACKEND_ID;
        #[cfg(not(all(target_os = "windows", feature = "asio-sdk")))]
        let should_close_previous_stream = true;

        if self.current_track.is_some() {
            if let Err(err) = self.rebuild_sink_on_new_device() {
                self.output_backend = previous_backend.clone();
                self.device_id = previous_device_id;
                self.device_name = previous_device_name;
                self.output_sample_rate = previous_output_sample_rate;
                if switching_from_exclusive || switching_to_exclusive || switching_to_asio {
                    let _ = self.rebuild_sink_on_new_device();
                }
                return Err(err);
            } else {
                if should_close_previous_stream {
                    previous_backend.close_stream();
                }
            }
        } else {
            match self.output_backend.create_sink() {
                Ok((_sink, output_info)) => {
                    self.output_sample_rate = output_info.output_sample_rate;
                    self.device_id = output_info.device_id.or_else(|| output_info.device_name.clone());
                    self.device_name = output_info
                        .device_name
                        .or_else(|| self.output_backend.default_device_name());
                }
                Err(err) => {
                    self.output_backend = previous_backend.clone();
                    self.device_id = previous_device_id;
                    self.device_name = previous_device_name;
                    self.output_sample_rate = previous_output_sample_rate;
                    return Err(err);
                }
            }

            if should_close_previous_stream {
                previous_backend.close_stream();
            }
        }

        let resolved_sample_rate = self
            .output_sample_rate
            .or_else(|| self.output_backend.current_info().output_sample_rate);
        eprintln!(
            "[NativeAudio] Output backend ready: {} device={:?} out_sr={:?}",
            self.output_backend.id(),
            self.device_name,
            resolved_sample_rate
        );
        Ok(())
    }

    pub(crate) fn apply_selected_output_device(&mut self, output_info: OutputStreamInfo) {
        self.sync_clock();
        self.output_sample_rate = output_info.output_sample_rate;
        self.device_id = output_info
            .device_id
            .or_else(|| output_info.device_name.clone())
            .or_else(|| self.device_id.clone());
        self.device_name = output_info
            .device_name
            .or_else(|| self.device_name.clone())
            .or_else(|| self.output_backend.default_device_name());

        if let Err(err) = self.rebuild_sink_on_new_device() {
            self.set_error("NATIVE_AUDIO_REBUILD_SINK_FAILED", err);
        }
    }

    pub(crate) fn clear_error(&mut self) {
        self.last_error_code = None;
        self.last_error_message = None;
    }

    pub(crate) fn record_error(&mut self, code: &str, message: String) {
        self.error_seq_counter = self.error_seq_counter.saturating_add(1);
        self.last_error_seq = self.error_seq_counter;
        self.last_error_code = Some(code.to_string());
        self.last_error_message = Some(message);
    }

    pub(crate) fn set_error(&mut self, code: &str, message: String) {
        self.record_error(code, message);
        self.playback_state = PlaybackState::Error;
    }

    fn effective_volume(&self) -> f32 {
        if self.muted {
            0.0
        } else {
            self.volume.clamp(0.0, 4.0)
        }
    }

    fn apply_effective_volume(&mut self) {
        let effective = self.effective_volume();
        store_atomic_f32(self.effective_volume_bits.as_ref(), effective);

        if let Some(crossfade) = self.active_crossfade.as_ref() {
            if crossfade.finished.load(Ordering::Acquire) {
                self.active_crossfade = None;
            }
        }

        if self.active_crossfade.is_some() {
            return;
        }

        if let Some(sink) = &self.sink {
            sink.set_volume(effective);
        }
    }

    pub(crate) fn cancel_crossfade(&mut self) {
        let Some(crossfade) = self.active_crossfade.take() else {
            return;
        };

        crossfade.cancel.store(true, Ordering::Release);
        crossfade.old_sink.stop();
        if let Some(tx) = crossfade.old_streaming_command_tx {
            let _ = tx.send(DecoderCommand::Shutdown);
        }
    }

    pub(crate) fn set_state(&mut self, state: PlaybackState) {
        self.playback_state = state;
        if matches!(
            state,
            PlaybackState::Idle | PlaybackState::Playing | PlaybackState::Paused | PlaybackState::Stopped
        ) {
            self.desired_playback_state = state;
        }
    }

    fn shutdown_streaming(&mut self) {
        if let Some(streaming) = self.streaming.take() {
            let _ = streaming.command_tx.send(DecoderCommand::Shutdown);
        }
    }

    pub(crate) fn load(&mut self, path: PathBuf) -> Result<(), String> {
        self.cancel_crossfade();
        self.sync_clock();
        self.clear_error();
        self.spectrum_tap.clear();
        self.dsp_runtime.request_reset();
        if let Some(old_sink) = self.sink.take() {
            old_sink.stop();
        }
        self.shutdown_streaming();

        let (sink, output_info) = self.output_backend.create_sink()?;
        self.output_sample_rate = output_info.output_sample_rate;
        self.device_name = output_info
            .device_name
            .clone()
            .or_else(|| self.device_name.clone())
            .or_else(|| self.output_backend.default_device_name());
        sink.pause();

        let opened = self
            .input_registry
            .open_prefer(
                &path,
                self.output_sample_rate,
                self.preferred_input_id.as_deref(),
            )
            .map_err(|err| format!("[{}] {}", err.code, err.message))?;
        let prepared = prepare_playback(opened, self.dsp_runtime.clone(), self.spectrum_tap.clone());
        eprintln!("[NativeAudio] Input: {}", prepared.input_id);
        self.active_input_id = Some(prepared.input_id.to_string());

        self.duration = prepared.meta.duration;
        self.decoded_channels = prepared.meta.channels;
        self.decoded_sample_rate = prepared.meta.sample_rate;
        self.decoded_bit_depth = prepared.meta.bit_depth;
        self.decoded_samples = prepared.decoded_samples;
        self.streaming = prepared.streaming;

        sink.append(prepared.source);

        if self.device_name.is_none() {
            self.device_name = self.output_backend.default_device_name();
        }

        sink.pause();
        sink.set_volume(self.effective_volume());

        self.sink = Some(sink);
        self.current_track = Some(path.clone());

        if !self.queue_initialized {
            self.queue_initialized = true;
        }
        if self.queue.is_empty() {
            self.queue.push(path.clone());
            self.current_index = 0;
        } else if let Some(index) = self.queue.iter().position(|entry| entry == &path) {
            self.current_index = index as i32;
        } else {
            self.queue.push(path.clone());
            self.current_index = (self.queue.len() as i32).saturating_sub(1);
        }

        self.current_position = 0.0;
        self.base_position = 0.0;
        self.playback_started_at = None;
        self.set_state(PlaybackState::Paused);
        Ok(())
    }

    pub(crate) fn crossfade_to(&mut self, path: PathBuf, duration_ms: u64) -> Result<(), String> {
        let was_playing = matches!(self.playback_state, PlaybackState::Playing);
        // VST nodes currently run as out-of-process sidecars and are not safe to drive from two
        // concurrent sinks during crossfade; fall back to non-crossfade load for stability.
        let has_vst = self
            .dsp_chain
            .iter()
            .any(|node| matches!(node, DspNodeConfig::Vst { .. }));
        let can_crossfade = was_playing
            && self.sink.is_some()
            && duration_ms > 0
            && !has_vst
            && self.output_backend.id() != WASAPI_EXCLUSIVE_BACKEND_ID;
        if !can_crossfade {
            self.load(path)?;
            if was_playing {
                self.play()?;
            }
            return Ok(());
        }

        self.cancel_crossfade();
        self.clear_error();
        self.spectrum_tap.clear();

        let (new_sink, output_info) = self.output_backend.create_sink()?;
        self.output_sample_rate = output_info.output_sample_rate;
        self.device_name = output_info
            .device_name
            .clone()
            .or_else(|| self.device_name.clone())
            .or_else(|| self.output_backend.default_device_name());
        new_sink.pause();

        let opened = self
            .input_registry
            .open_prefer(
                &path,
                self.output_sample_rate,
                self.preferred_input_id.as_deref(),
            )
            .map_err(|err| format!("[{}] {}", err.code, err.message))?;
        let prepared = prepare_playback(opened, self.dsp_runtime.clone(), self.spectrum_tap.clone());
        eprintln!("[NativeAudio] Input: {}", prepared.input_id);
        let active_input_id = prepared.input_id.to_string();

        let duration = prepared.meta.duration;
        let decoded_channels = prepared.meta.channels;
        let decoded_sample_rate = prepared.meta.sample_rate;
        let decoded_bit_depth = prepared.meta.bit_depth;

        let new_streaming = prepared.streaming;
        let decoded_samples = prepared.decoded_samples;

        new_sink.append(prepared.source);

        if self.device_name.is_none() {
            self.device_name = self.output_backend.default_device_name();
        }

        let base_volume = self.effective_volume();
        store_atomic_f32(self.effective_volume_bits.as_ref(), base_volume);

        new_sink.pause();
        new_sink.set_volume(0.0);

        // For streaming playback, wait for a small prebuffer to reduce underrun clicks/noise.
        if let Some(streaming) = &new_streaming {
            let channels = decoded_channels.max(1) as usize;
            let target_frames = 2048usize; // ~46ms @ 44.1kHz
            let target_samples = target_frames * channels;
            if streaming.buffer.len_samples() < target_samples {
                streaming
                    .buffer
                    .wait_for_samples(target_samples, Duration::from_millis(250));
            }
        }

        new_sink.play();

        let old_sink = self
            .sink
            .replace(new_sink.clone())
            .ok_or_else(|| "No track loaded".to_string())?;
        let old_streaming = std::mem::replace(&mut self.streaming, new_streaming);
        let old_streaming_command_tx = old_streaming.map(|streaming| streaming.command_tx.clone());

        self.current_track = Some(path.clone());
        self.duration = duration;
        self.decoded_samples = decoded_samples;
        self.decoded_channels = decoded_channels;
        self.decoded_sample_rate = decoded_sample_rate;
        self.decoded_bit_depth = decoded_bit_depth;
        self.active_input_id = Some(active_input_id);

        if !self.queue_initialized {
            self.queue_initialized = true;
        }
        if self.queue.is_empty() {
            self.queue.push(path.clone());
            self.current_index = 0;
        } else if let Some(index) = self.queue.iter().position(|entry| entry == &path) {
            self.current_index = index as i32;
        } else {
            self.queue.push(path.clone());
            self.current_index = (self.queue.len() as i32).saturating_sub(1);
        }

        self.current_position = 0.0;
        self.base_position = 0.0;
        self.playback_started_at = Some(Instant::now());
        self.set_state(PlaybackState::Playing);

        let duration = Duration::from_millis(duration_ms.clamp(1, 30_000));
        let cancel = Arc::new(AtomicBool::new(false));
        let finished = Arc::new(AtomicBool::new(false));
        let base_bits = self.effective_volume_bits.clone();
        let cancel_thread = cancel.clone();
        let finished_thread = finished.clone();
        let new_sink_thread = new_sink;
        let old_sink_thread = old_sink.clone();
        let old_tx_thread = old_streaming_command_tx.clone();

        std::thread::spawn(move || {
            let start = Instant::now();
            let step = Duration::from_millis(10);
            loop {
                if cancel_thread.load(Ordering::Acquire) {
                    break;
                }
                let elapsed = start.elapsed();
                let t = if duration.as_nanos() == 0 {
                    1.0f32
                } else {
                    (elapsed.as_secs_f32() / duration.as_secs_f32()).clamp(0.0, 1.0)
                };

                let mut base = load_atomic_f32(base_bits.as_ref());
                if !base.is_finite() {
                    base = 0.0;
                }
                base = base.max(0.0);

                old_sink_thread.set_volume(base * (1.0 - t));
                new_sink_thread.set_volume(base * t);

                if t >= 1.0 {
                    break;
                }
                std::thread::sleep(step);
            }

            let mut base = load_atomic_f32(base_bits.as_ref());
            if !base.is_finite() {
                base = 0.0;
            }
            base = base.max(0.0);

            new_sink_thread.set_volume(base);
            old_sink_thread.set_volume(0.0);
            old_sink_thread.stop();
            if let Some(tx) = old_tx_thread {
                let _ = tx.send(DecoderCommand::Shutdown);
            }
            finished_thread.store(true, Ordering::Release);
        });

        self.active_crossfade = Some(ActiveCrossfade {
            cancel,
            finished,
            old_sink,
            old_streaming_command_tx,
        });

        Ok(())
    }

    pub(crate) fn play(&mut self) -> Result<(), String> {
        if let Some(sink) = &self.sink {
            // For streaming playback, wait for a small prebuffer to reduce underrun clicks/noise.
            if let Some(streaming) = &self.streaming {
                let channels = self.decoded_channels.max(1) as usize;
                let target_frames = if self.output_backend.id() == WASAPI_EXCLUSIVE_BACKEND_ID {
                    4096usize // ~93ms @ 44.1kHz (exclusive mode tends to need a bit more headroom)
                } else {
                    2048usize // ~46ms @ 44.1kHz
                };
                let target_samples = target_frames * channels;
                if streaming.buffer.len_samples() < target_samples {
                    streaming
                        .buffer
                        .wait_for_samples(target_samples, Duration::from_millis(250));
                }
            }

            sink.play();
            if let Some(crossfade) = self.active_crossfade.as_ref() {
                crossfade.old_sink.play();
            }
            self.set_state(PlaybackState::Playing);
            if self.playback_started_at.is_none() {
                self.base_position = self.current_position;
                self.playback_started_at = Some(Instant::now());
            }
            Ok(())
        } else {
            Err("No track loaded".into())
        }
    }

    pub(crate) fn pause(&mut self) -> Result<(), String> {
        if let Some(sink) = &self.sink {
            sink.pause();
            if let Some(crossfade) = self.active_crossfade.as_ref() {
                crossfade.old_sink.pause();
            }
            self.sync_clock();
            self.set_state(PlaybackState::Paused);
            Ok(())
        } else {
            Err("No track loaded".into())
        }
    }

    pub(crate) fn stop(&mut self) {
        self.cancel_crossfade();
        self.sync_clock();
        self.spectrum_tap.clear();
        self.dsp_runtime.request_reset();

        if let Some(streaming) = &self.streaming {
            streaming.buffer.clear();
            let _ = streaming.command_tx.send(DecoderCommand::Seek(0.0));
            if let Some(sink) = &self.sink {
                sink.pause();
            }
        } else if self.current_track.is_some() && self.output_backend.is_stream_open() {
            let track_path = self.current_track.clone().expect("checked is_some");
            let sink = self.output_backend.create_sink().ok().map(|(sink, _)| sink);

            if let Some(sink) = sink {
                if let (Some(samples), channels, sample_rate) = (
                    self.decoded_samples.clone(),
                    self.decoded_channels,
                    self.decoded_sample_rate,
                ) {
                    sink.append(boxed_with_dsp(
                        SharedSamplesSource::new(samples, channels, sample_rate, 0),
                        self.dsp_runtime.clone(),
                        self.spectrum_tap.clone(),
                    ));
                } else if let Ok((source, _)) = open_rodio_source_at(&track_path, 0.0) {
                    sink.append(boxed_with_dsp(
                        source,
                        self.dsp_runtime.clone(),
                        self.spectrum_tap.clone(),
                    ));
                }
                sink.pause();
                sink.set_volume(self.effective_volume());
                if let Some(old) = self.sink.replace(sink) {
                    old.stop();
                }
            }
        } else if let Some(sink) = &self.sink {
            sink.pause();
        }

        self.current_position = 0.0;
        self.base_position = 0.0;
        self.playback_started_at = None;
        self.set_state(PlaybackState::Stopped);
    }

    pub(crate) fn sync_queue_state(&mut self, queue: Vec<PathBuf>, current_index: i32) {
        self.queue_initialized = true;
        self.queue = queue;
        let max_index = (self.queue.len() as i32).saturating_sub(1);
        self.current_index = current_index.clamp(-1, max_index);

        if self.queue.is_empty() || self.current_index < 0 {
            self.cancel_crossfade();
            self.sync_clock();
            self.spectrum_tap.clear();
            self.dsp_runtime.request_reset();
            if let Some(sink) = self.sink.take() {
                sink.stop();
            }
            self.shutdown_streaming();
            self.current_track = None;
            self.active_input_id = None;
            self.current_position = 0.0;
            self.base_position = 0.0;
            self.playback_started_at = None;
            self.duration = 0.0;
            self.decoded_samples = None;
            self.decoded_channels = 0;
            self.decoded_sample_rate = 0;
            self.decoded_bit_depth = None;
            self.set_state(PlaybackState::Stopped);
        }
    }

    pub(crate) fn seek(&mut self, seconds: f64) -> Result<(), String> {
        self.cancel_crossfade();
        self.sync_clock();
        self.spectrum_tap.clear();
        self.dsp_runtime.request_reset();
        let track_path = self
            .current_track
            .clone()
            .ok_or_else(|| "No track loaded".to_string())?;
        let target = seconds.max(0.0);
        let resume_playing = matches!(self.playback_state, PlaybackState::Playing);

        if let Some(streaming) = &self.streaming {
            streaming.buffer.clear();
            self.spectrum_tap.clear();
            self.dsp_runtime.request_reset();
            let _ = streaming.command_tx.send(DecoderCommand::Seek(target));

            if resume_playing {
                if let Some(sink) = &self.sink {
                    sink.play();
                }
                self.base_position = target;
                self.playback_started_at = Some(Instant::now());
            } else {
                self.base_position = target;
                self.playback_started_at = None;
            }

            self.current_position = target;
            return Ok(());
        }

        let (sink, output_info) = self.output_backend.create_sink()?;
        self.output_sample_rate = output_info.output_sample_rate;
        self.device_name = output_info
            .device_name
            .clone()
            .or_else(|| self.device_name.clone())
            .or_else(|| self.output_backend.default_device_name());
        sink.pause();

        if let (Some(samples), channels, sample_rate) = (
            self.decoded_samples.clone(),
            self.decoded_channels,
            self.decoded_sample_rate,
        ) {
            let start_sample = ((target * sample_rate as f64) as usize) * channels as usize;
            let source = SharedSamplesSource::new(samples, channels, sample_rate, start_sample);
            sink.append(boxed_with_dsp(
                source,
                self.dsp_runtime.clone(),
                self.spectrum_tap.clone(),
            ));
        } else {
            let (source, _) = open_rodio_source_at(&track_path, target)
                .map_err(|err| format!("[{}] {}", err.code, err.message))?;
            sink.append(boxed_with_dsp(
                source,
                self.dsp_runtime.clone(),
                self.spectrum_tap.clone(),
            ));
        }
        sink.set_volume(self.effective_volume());

        if resume_playing {
            sink.play();
            self.base_position = target;
            self.playback_started_at = Some(Instant::now());
        } else {
            self.base_position = target;
            self.playback_started_at = None;
        }

        if let Some(old_sink) = self.sink.replace(sink) {
            old_sink.stop();
        }

        self.current_position = target;
        Ok(())
    }

    pub(crate) fn snapshot_for_spectrum(&self) -> Option<SpectrumSnapshot> {
        let (window, sample_rate) = self.spectrum_tap.snapshot()?;
        Some(SpectrumSnapshot {
            sample_rate,
            window,
        })
    }

    fn update_position_from_clock(&mut self) {
        let Some(started_at) = self.playback_started_at else {
            return;
        };
        let elapsed = started_at.elapsed().as_secs_f64();
        let mut next = self.base_position + elapsed;
        if self.duration > 0.0 {
            next = next.min(self.duration);
        }
        self.current_position = next;
    }

    pub(crate) fn sync_clock(&mut self) {
        self.update_position_from_clock();
        self.base_position = self.current_position;
        self.playback_started_at = None;
    }

    pub(crate) fn tick(&mut self) -> bool {
        if let Some(crossfade) = self.active_crossfade.as_ref() {
            if crossfade.finished.load(Ordering::Acquire) {
                self.active_crossfade = None;
                self.apply_effective_volume();
            }
        }

        if let Some(err) = self.output_backend.take_error() {
            if let Some(sink) = &self.sink {
                sink.pause();
            }
            self.sync_clock();
            self.set_error(
                "NATIVE_AUDIO_OUTPUT_ERROR",
                format!("[{}] {}", err.code, err.message),
            );
            return true;
        }

        let streaming_error = if let Some(streaming) = self.streaming.as_ref() {
            if let Ok(mut guard) = streaming.error.lock() {
                guard.take()
            } else {
                None
            }
        } else {
            None
        };

        if let Some(message) = streaming_error {
            if let Some(sink) = &self.sink {
                sink.pause();
            }
            self.sync_clock();
            self.set_error("NATIVE_AUDIO_STREAM_ERROR", message);
            return true;
        }

        if !matches!(self.playback_state, PlaybackState::Playing) {
            return false;
        }
        self.update_position_from_clock();
        let Some(sink) = &self.sink else {
            return false;
        };
        if sink.empty() {
            self.current_position = self.duration;
            self.base_position = self.current_position;
            self.playback_started_at = None;
            self.set_state(PlaybackState::Stopped);
        }
        true
    }

    pub(crate) fn set_volume(&mut self, volume: f32) {
        self.volume = volume;
        self.apply_effective_volume();
    }

    pub(crate) fn set_mute(&mut self, muted: bool) {
        self.muted = muted;
        self.apply_effective_volume();
    }

    pub(crate) fn set_gain(&mut self, gain_db: f32) {
        self.gain_db = gain_db.clamp(-60.0, 12.0);

        // Keep non-gain nodes while replacing gain with a single node.
        let mut next_chain = Vec::with_capacity(self.dsp_chain.len().max(1));
        next_chain.push(DspNodeConfig::Gain { db: self.gain_db });
        for node in &self.dsp_chain {
            if !matches!(node, DspNodeConfig::Gain { .. }) {
                next_chain.push(node.clone());
            }
        }
        self.dsp_chain = next_chain;
        self.gain_db = self.dsp_runtime.apply_chain(&self.dsp_chain);
    }

    pub(crate) fn set_replay_gain(&mut self, replay_gain_db: f32) {
        self.replay_gain_db = self.dsp_runtime.set_replay_gain_db(replay_gain_db);
    }

    pub(crate) fn set_dsp_chain(&mut self, chain: Vec<DspNodeConfig>) {
        self.dsp_chain = chain;
        self.gain_db = self.dsp_runtime.apply_chain(&self.dsp_chain);
    }

    pub(crate) fn set_preferred_input_id(&mut self, input_id: Option<String>) -> Result<(), String> {
        let input_id = input_id.and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        });

        if let Some(id) = input_id.as_deref() {
            if !self.input_registry.contains_id(id) {
                return Err(format!("Unknown audio input id: {id}"));
            }
        }

        self.preferred_input_id = input_id;
        Ok(())
    }

    pub(crate) fn build_state_payload(&self, ended: bool) -> NativeAudioStatePayload {
        let (underrun_events, underrun_frames) = crate::audio::input::streaming_underrun_stats();
        NativeAudioStatePayload {
            playback_state: self.playback_state.as_str().to_string(),
            volume: self.volume,
            gain_db: self.gain_db,
            replay_gain_db: self.replay_gain_db,
            muted: self.muted,
            track_path: self
                .current_track
                .as_ref()
                .and_then(|path| path.to_str().map(|s| s.to_string())),
            current_time: self.current_position,
            duration: self.duration,
            sample_rate: if self.decoded_sample_rate > 0 {
                Some(self.decoded_sample_rate)
            } else {
                None
            },
            bit_depth: self.decoded_bit_depth,
            device: self.device_name.clone(),
            queue: if self.queue_initialized {
                Some(
                    self.queue
                        .iter()
                        .filter_map(|path| path.to_str().map(|s| s.to_string()))
                        .collect(),
                )
            } else {
                None
            },
            current_index: if self.queue_initialized {
                Some(self.current_index)
            } else {
                None
            },
            ended,
            underrun_events,
            underrun_frames,
            error_seq: self
                .last_error_code
                .as_ref()
                .map(|_| self.last_error_seq)
                .filter(|seq| *seq > 0),
            error_code: self.last_error_code.clone(),
            error_message: self.last_error_message.clone(),
        }
    }

    pub(crate) fn build_components_payload(&self) -> NativeAudioComponentsStatePayload {
        let output_sample_rate = self
            .output_sample_rate
            .or_else(|| self.output_backend.current_info().output_sample_rate);
        NativeAudioComponentsStatePayload {
            output_backend_id: self.output_backend.id().to_string(),
            output_device_id: self.device_id.clone(),
            output_device: self.device_name.clone(),
            output_sample_rate,
            preferred_input_id: self.preferred_input_id.clone(),
            active_input_id: self.active_input_id.clone(),
        }
    }

    pub(crate) fn rebuild_sink_on_new_device(&mut self) -> Result<(), String> {
        self.cancel_crossfade();
        let Some(track_path) = self.current_track.clone() else {
            return Ok(());
        };

        let was_error = matches!(self.playback_state, PlaybackState::Error);
        let resume_playing = matches!(self.desired_playback_state, PlaybackState::Playing);

        if resume_playing {
            self.update_position_from_clock();
        }
        let target = self.current_position.max(0.0);

        let maybe_rodio_source = if self.streaming.is_none() && self.decoded_samples.is_none() {
            Some(
                open_rodio_source_at(&track_path, target)
                    .map_err(|err| format!("[{}] {}", err.code, err.message))?,
            )
        } else {
            None
        };

        // Attempt to create the new sink first so we can bail out without disrupting playback.
        let (sink, output_info) = self.output_backend.create_sink()?;

        // Commit point: stop current playback before mutating shared state (DSP runtime / streaming buffer).
        self.sync_clock();
        if let Some(old_sink) = self.sink.take() {
            old_sink.stop();
        }

        self.output_sample_rate = output_info.output_sample_rate;
        self.device_id = output_info
            .device_id
            .or_else(|| output_info.device_name.clone())
            .or_else(|| self.device_id.clone());
        self.device_name = output_info
            .device_name
            .clone()
            .or_else(|| self.device_name.clone())
            .or_else(|| self.output_backend.default_device_name());

        self.spectrum_tap.clear();
        self.dsp_runtime.request_reset();

        if let Some(streaming) = &self.streaming {
            streaming.buffer.clear();
            let _ = streaming.command_tx.send(DecoderCommand::Seek(target));
            let source = StreamingSamplesSource::new(
                streaming.buffer.clone(),
                self.decoded_channels.max(1),
                self.decoded_sample_rate.max(1),
                self.duration,
            );
            sink.append(boxed_with_dsp(
                source,
                self.dsp_runtime.clone(),
                self.spectrum_tap.clone(),
            ));
        } else if let Some(samples) = self.decoded_samples.clone() {
            let channels = self.decoded_channels.max(1);
            let sample_rate = self.decoded_sample_rate.max(1);
            let start_sample = ((target * sample_rate as f64) as usize) * channels as usize;
            sink.append(boxed_with_dsp(
                SharedSamplesSource::new(samples, channels, sample_rate, start_sample),
                self.dsp_runtime.clone(),
                self.spectrum_tap.clone(),
            ));
        } else {
            let (source, _) = maybe_rodio_source
                .expect("rodio source prepared when no streaming/decoded samples");
            sink.append(boxed_with_dsp(
                source,
                self.dsp_runtime.clone(),
                self.spectrum_tap.clone(),
            ));
        }

        sink.pause();
        sink.set_volume(self.effective_volume());

        if resume_playing {
            if let Some(streaming) = &self.streaming {
                let channels = self.decoded_channels.max(1) as usize;
                let target_frames = if self.output_backend.id() == WASAPI_EXCLUSIVE_BACKEND_ID {
                    4096usize // ~93ms @ 44.1kHz
                } else {
                    2048usize // ~46ms @ 44.1kHz
                };
                let target_samples = target_frames * channels;
                if streaming.buffer.len_samples() < target_samples {
                    streaming
                        .buffer
                        .wait_for_samples(target_samples, Duration::from_millis(250));
                }
            }

            sink.play();
            self.base_position = target;
            self.playback_started_at = Some(Instant::now());
            self.set_state(PlaybackState::Playing);
        } else {
            self.base_position = target;
            self.playback_started_at = None;
        }

        self.current_position = target;
        self.sink = Some(sink);

        if was_error {
            self.clear_error();
            self.playback_state = self.desired_playback_state;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    struct FailBackend;

    impl AudioOutputBackend for FailBackend {
        fn id(&self) -> &'static str {
            "fail"
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
            Ok(OutputStreamInfo::default())
        }

        fn create_sink(&self) -> Result<(Arc<dyn AudioSink>, OutputStreamInfo), String> {
            Err("create_sink failed".into())
        }
    }

    #[derive(Default)]
    struct FlagSink {
        stopped: AtomicBool,
    }

    impl AudioSink for FlagSink {
        fn append(&self, _source: crate::audio::output::BoxedSource) {}

        fn play(&self) {}

        fn pause(&self) {}

        fn stop(&self) {
            self.stopped.store(true, Ordering::Release);
        }

        fn empty(&self) -> bool {
            true
        }

        fn set_volume(&self, _value: f32) {}
    }

    #[test]
    fn rebuild_sink_does_not_stop_old_sink_when_new_sink_fails() {
        let backend: Arc<dyn AudioOutputBackend> = Arc::new(FailBackend);
        let mut engine = NativeAudioEngine::new_with_backend(backend);

        let old_sink = Arc::new(FlagSink::default());
        engine.sink = Some(old_sink.clone());
        engine.current_track = Some(PathBuf::from("dummy.wav"));
        engine.decoded_samples = Some(Arc::new(vec![0.0f32; 16]));
        engine.decoded_channels = 2;
        engine.decoded_sample_rate = 48_000;
        engine.playback_state = PlaybackState::Playing;
        engine.playback_started_at = Some(Instant::now());

        let err = engine
            .rebuild_sink_on_new_device()
            .expect_err("expected sink rebuild error");
        assert_eq!(err, "create_sink failed");
        assert!(engine.sink.is_some());
        assert!(!old_sink.stopped.load(Ordering::Acquire));
    }
}
