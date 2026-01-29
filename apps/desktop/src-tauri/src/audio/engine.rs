use once_cell::sync::Lazy;
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        mpsc,
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use crate::audio::events::NativeAudioStatePayload;
use crate::audio::input::{
    open_rodio_source_at, AudioInputRegistry, DecoderCommand, SharedSamplesSource, StreamingPlayback,
    StreamingSamplesSource,
};
use crate::audio::mixer::{coerce_source_format, PlaybackMixerController, PlaybackMixerSource};
use crate::audio::output::{default_backend, AudioOutputBackend, AudioSink, OutputStreamInfo};
#[cfg(all(target_os = "windows", feature = "asio-sdk"))]
use crate::audio::output::ASIO_BACKEND_ID;
#[cfg(target_os = "windows")]
use crate::audio::output::WASAPI_EXCLUSIVE_BACKEND_ID;
use crate::audio::pipeline::{boxed_with_dsp, DspNodeConfig, DspRuntime, SpectrumSnapshot, SpectrumTap};

pub(crate) static ENGINE: Lazy<Mutex<NativeAudioEngine>> = Lazy::new(|| {
    Mutex::new(NativeAudioEngine::new())
});

#[derive(Clone, Copy, Debug)]
pub(crate) enum StreamingPrebufferKind {
    StartOrSeek,
    Crossfade,
}

pub(crate) fn streaming_prebuffer_target_samples(
    output_backend_id: &str,
    sample_rate: u32,
    channels: usize,
    capacity_samples: usize,
    duration_seconds: f64,
    kind: StreamingPrebufferKind,
    override_seconds: Option<f64>,
) -> (usize, Duration) {
    let (env_key, default_seconds) = match kind {
        StreamingPrebufferKind::StartOrSeek => (
            "PMP_AUDIO_STREAM_PREBUFFER_SECONDS",
            if output_backend_id == "wasapi-exclusive" {
                3.0
            } else {
                2.0
            },
        ),
        StreamingPrebufferKind::Crossfade => (
            "PMP_AUDIO_STREAM_CROSSFADE_PREBUFFER_SECONDS",
            if output_backend_id == "wasapi-exclusive" {
                1.0
            } else {
                0.5
            },
        ),
    };

    let seconds = override_seconds
        .filter(|value| value.is_finite())
        .or_else(|| {
            std::env::var(env_key)
                .ok()
                .and_then(|value| value.parse::<f64>().ok())
                .filter(|value| value.is_finite())
        })
        .unwrap_or(default_seconds)
        .clamp(0.0, 10.0);

    if seconds <= 0.0 {
        return (0, Duration::from_millis(0));
    }

    let seconds = seconds.max(0.05);

    let sample_rate = sample_rate.max(1) as f64;
    let channels = channels.max(1) as f64;
    let desired_samples = (sample_rate * seconds * channels).ceil() as usize;
    let mut target_samples = desired_samples.max(1).min(capacity_samples.max(1));

    if duration_seconds.is_finite() && duration_seconds > 0.0 {
        let max_samples_by_duration = (sample_rate * duration_seconds * channels).ceil() as usize;
        target_samples = target_samples.min(max_samples_by_duration.max(1));
    }

    let timeout = Duration::from_secs_f64((seconds + 0.5).clamp(0.25, 10.0));

    (target_samples, timeout)
}

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

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioStreamingBufferSettingsPayload {
    pub start_or_seek_seconds: Option<f64>,
    pub crossfade_seconds: Option<f64>,
}

pub(crate) struct NativeAudioEngine {
    input_registry: AudioInputRegistry,
    preferred_input_id: Option<String>,
    active_input_id: Option<String>,
    output_backend: Arc<dyn AudioOutputBackend>,
    sink: Option<Arc<dyn AudioSink>>,
    mixer: Option<PlaybackMixerController>,
    current_track: Option<PathBuf>,
    queue: Vec<PathBuf>,
    current_index: i32,
    queue_initialized: bool,
    streaming: Option<StreamingPlayback>,
    current_position: f64,
    duration: f64,
    base_position: f64,
    playback_started_at: Option<Instant>,
    buffering_started_at: Option<Instant>,
    buffering_last_progress_at: Option<Instant>,
    buffering_last_samples: usize,
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
    playback_state: PlaybackState,
    desired_playback_state: PlaybackState,
    operation_seq_counter: u64,
    pending_operation_seq: u64,
    error_seq_counter: u64,
    last_error_seq: u64,
    last_error_code: Option<String>,
    last_error_message: Option<String>,
    streaming_prebuffer_start_or_seek_seconds: Option<f64>,
    streaming_prebuffer_crossfade_seconds: Option<f64>,
}

pub(crate) struct LoadOperation {
    pub token: u64,
    pub output_backend: Arc<dyn AudioOutputBackend>,
    pub preferred_input_id: Option<String>,
    pub dsp_runtime: Arc<DspRuntime>,
    pub spectrum_tap: SpectrumTap,
    pub effective_volume: f32,
}

pub(crate) struct PreparedLoad {
    pub track_path: PathBuf,
    pub sink: Arc<dyn AudioSink>,
    pub output_info: OutputStreamInfo,
    pub mixer: PlaybackMixerController,
    pub input_id: &'static str,
    pub meta: crate::audio::input::AudioInputMeta,
    pub streaming: Option<StreamingPlayback>,
    pub decoded_samples: Option<Arc<Vec<f32>>>,
}

impl PreparedLoad {
    pub(crate) fn abort(self) {
        self.sink.stop();
        if let Some(streaming) = self.streaming {
            let _ = streaming.command_tx.send(DecoderCommand::Shutdown);
        }
    }
}

pub(crate) struct CrossfadeOperation {
    pub token: u64,
    pub preferred_input_id: Option<String>,
    pub output_backend_id: &'static str,
    pub target_channels: u16,
    pub target_sample_rate: u32,
    pub streaming_prebuffer_crossfade_seconds: Option<f64>,
    pub old_shutdown_tx: Option<mpsc::Sender<DecoderCommand>>,
}

pub(crate) struct PreparedCrossfade {
    pub track_path: PathBuf,
    pub input_id: &'static str,
    pub meta: crate::audio::input::AudioInputMeta,
    pub streaming: Option<StreamingPlayback>,
    pub decoded_samples: Option<Arc<Vec<f32>>>,
    pub next_source: crate::audio::output::BoxedSource,
    pub old_shutdown_tx: Option<mpsc::Sender<DecoderCommand>>,
    pub target_channels: u16,
    pub target_sample_rate: u32,
    pub duration_frames: u64,
}

impl PreparedCrossfade {
    pub(crate) fn abort(self) {
        if let Some(streaming) = self.streaming {
            let _ = streaming.command_tx.send(DecoderCommand::Shutdown);
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum PlaybackState {
    Idle,
    Loading,
    Buffering,
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
            PlaybackState::Buffering => "buffering",
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
            mixer: None,
            current_track: None,
            queue: Vec::new(),
            current_index: -1,
            queue_initialized: false,
            streaming: None,
            current_position: 0.0,
            duration: 0.0,
            base_position: 0.0,
            playback_started_at: None,
            buffering_started_at: None,
            buffering_last_progress_at: None,
            buffering_last_samples: 0,
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
            playback_state: PlaybackState::Idle,
            desired_playback_state: PlaybackState::Idle,
            operation_seq_counter: 0,
            pending_operation_seq: 0,
            error_seq_counter: 1,
            last_error_seq: 0,
            last_error_code: None,
            last_error_message: None,
            streaming_prebuffer_start_or_seek_seconds: None,
            streaming_prebuffer_crossfade_seconds: None,
        }
    }

    pub(crate) fn playback_state(&self) -> PlaybackState {
        self.playback_state
    }

    pub(crate) fn is_playing_or_rebuffering(&self) -> bool {
        matches!(self.playback_state, PlaybackState::Playing)
            || (matches!(self.playback_state, PlaybackState::Buffering)
                && matches!(self.desired_playback_state, PlaybackState::Playing))
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

    pub(crate) fn streaming_buffer_settings_payload(&self) -> NativeAudioStreamingBufferSettingsPayload {
        NativeAudioStreamingBufferSettingsPayload {
            start_or_seek_seconds: self.streaming_prebuffer_start_or_seek_seconds,
            crossfade_seconds: self.streaming_prebuffer_crossfade_seconds,
        }
    }

    pub(crate) fn set_streaming_buffer_settings(
        &mut self,
        start_or_seek_seconds: Option<f64>,
        crossfade_seconds: Option<f64>,
    ) {
        fn sanitize(value: Option<f64>) -> Option<f64> {
            value
                .filter(|seconds| seconds.is_finite())
                .map(|seconds| seconds.clamp(0.0, 10.0))
        }

        self.streaming_prebuffer_start_or_seek_seconds = sanitize(start_or_seek_seconds);
        self.streaming_prebuffer_crossfade_seconds = sanitize(crossfade_seconds);
    }

    pub(crate) fn clone_dsp_chain(&self) -> Vec<DspNodeConfig> {
        self.dsp_chain.clone()
    }

    pub(crate) fn set_vst_nodes(&mut self, vst_nodes: Vec<crate::vst_dsp::VstNodeKey>) {
        self.dsp_runtime.set_vst_nodes(vst_nodes);
    }

    pub(crate) fn begin_operation(&mut self) -> u64 {
        self.operation_seq_counter = self.operation_seq_counter.saturating_add(1);
        self.pending_operation_seq = self.operation_seq_counter;
        self.pending_operation_seq
    }

    pub(crate) fn is_pending_operation(&self, token: u64) -> bool {
        token != 0 && self.pending_operation_seq == token
    }

    pub(crate) fn abandon_operation(&mut self, token: u64) {
        if self.pending_operation_seq == token {
            self.pending_operation_seq = 0;
        }
    }

    pub(crate) fn begin_load_operation(&mut self) -> LoadOperation {
        self.cancel_crossfade();
        self.sync_clock();
        self.clear_error();
        self.spectrum_tap.clear();
        self.dsp_runtime.request_reset();

        if let Some(old_sink) = self.sink.take() {
            old_sink.stop();
        }
        self.shutdown_streaming();
        self.mixer = None;

        let token = self.begin_operation();
        self.set_state(PlaybackState::Loading);

        LoadOperation {
            token,
            output_backend: self.output_backend.clone(),
            preferred_input_id: self.preferred_input_id.clone(),
            dsp_runtime: self.dsp_runtime.clone(),
            spectrum_tap: self.spectrum_tap.clone(),
            effective_volume: self.effective_volume(),
        }
    }

    pub(crate) fn commit_load_operation(
        &mut self,
        token: u64,
        prepared: PreparedLoad,
    ) -> Result<bool, String> {
        if !self.is_pending_operation(token) {
            prepared.abort();
            return Ok(false);
        }

        self.output_sample_rate = prepared.output_info.output_sample_rate;
        self.device_id = prepared
            .output_info
            .device_id
            .or_else(|| prepared.output_info.device_name.clone())
            .or_else(|| self.device_id.clone());
        self.device_name = prepared
            .output_info
            .device_name
            .clone()
            .or_else(|| self.device_name.clone())
            .or_else(|| self.output_backend.default_device_name());

        self.duration = prepared.meta.duration;
        self.decoded_channels = prepared.meta.channels;
        self.decoded_sample_rate = prepared.meta.sample_rate;
        self.decoded_bit_depth = prepared.meta.bit_depth;
        self.active_input_id = Some(prepared.input_id.to_string());

        self.decoded_samples = prepared.decoded_samples;
        self.streaming = prepared.streaming;
        self.mixer = Some(prepared.mixer);
        self.sink = Some(prepared.sink);
        self.current_track = Some(prepared.track_path.clone());

        if !self.queue_initialized {
            self.queue_initialized = true;
        }
        if self.queue.is_empty() {
            self.queue.push(prepared.track_path.clone());
            self.current_index = 0;
        } else if let Some(index) = self
            .queue
            .iter()
            .position(|entry| entry == &prepared.track_path)
        {
            self.current_index = index as i32;
        } else {
            self.queue.push(prepared.track_path.clone());
            self.current_index = (self.queue.len() as i32).saturating_sub(1);
        }

        self.current_position = 0.0;
        self.base_position = 0.0;
        self.playback_started_at = None;
        self.set_state(PlaybackState::Paused);
        self.abandon_operation(token);
        Ok(true)
    }

    pub(crate) fn begin_crossfade_operation(&mut self, duration_ms: u64) -> Option<CrossfadeOperation> {
        let was_playing = matches!(self.playback_state, PlaybackState::Playing);
        let can_crossfade = was_playing
            && self.sink.is_some()
            && self.mixer.is_some()
            && duration_ms > 0
            && self.decoded_channels > 0
            && self.decoded_sample_rate > 0;
        if !can_crossfade {
            return None;
        }

        self.cancel_crossfade();
        self.clear_error();
        self.spectrum_tap.clear();

        let token = self.begin_operation();
        Some(CrossfadeOperation {
            token,
            preferred_input_id: self.preferred_input_id.clone(),
            output_backend_id: self.output_backend.id(),
            target_channels: self.decoded_channels.max(1),
            target_sample_rate: self.decoded_sample_rate.max(1),
            streaming_prebuffer_crossfade_seconds: self.streaming_prebuffer_crossfade_seconds,
            old_shutdown_tx: self.streaming.as_ref().map(|streaming| streaming.command_tx.clone()),
        })
    }

    pub(crate) fn commit_crossfade_operation(
        &mut self,
        token: u64,
        prepared: PreparedCrossfade,
    ) -> Result<bool, String> {
        if !self.is_pending_operation(token) {
            prepared.abort();
            return Ok(false);
        }

        let was_playing = matches!(self.playback_state, PlaybackState::Playing);
        let can_crossfade = was_playing
            && self.sink.is_some()
            && self.mixer.is_some()
            && prepared.duration_frames > 0
            && prepared.target_channels > 0
            && prepared.target_sample_rate > 0;
        if !can_crossfade {
            prepared.abort();
            self.abandon_operation(token);
            return Ok(false);
        }

        let controller = self
            .mixer
            .as_ref()
            .ok_or_else(|| "Playback mixer unavailable".to_string())?;
        controller.crossfade_to(
            prepared.next_source,
            prepared.old_shutdown_tx,
            prepared.duration_frames,
        )?;

        self.current_track = Some(prepared.track_path.clone());
        self.duration = prepared.meta.duration;
        self.decoded_samples = prepared.decoded_samples;
        self.decoded_channels = prepared.target_channels;
        self.decoded_sample_rate = prepared.target_sample_rate;
        self.decoded_bit_depth = prepared.meta.bit_depth;
        self.streaming = prepared.streaming;
        self.active_input_id = Some(prepared.input_id.to_string());

        if !self.queue_initialized {
            self.queue_initialized = true;
        }
        if self.queue.is_empty() {
            self.queue.push(prepared.track_path.clone());
            self.current_index = 0;
        } else if let Some(index) = self.queue.iter().position(|entry| entry == &prepared.track_path)
        {
            self.current_index = index as i32;
        } else {
            self.queue.push(prepared.track_path.clone());
            self.current_index = (self.queue.len() as i32).saturating_sub(1);
        }

        self.current_position = 0.0;
        self.base_position = 0.0;
        self.playback_started_at = Some(Instant::now());
        self.set_state(PlaybackState::Playing);
        self.abandon_operation(token);
        Ok(true)
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
        if let Some(sink) = &self.sink {
            sink.set_volume(effective);
        }
    }

    pub(crate) fn cancel_crossfade(&mut self) {
        if let Some(mixer) = &self.mixer {
            mixer.cancel_crossfade();
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
        self.buffering_started_at = None;
        self.buffering_last_progress_at = None;
        self.buffering_last_samples = 0;
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

        let crate::audio::input::AudioInputOpenResult {
            input_id,
            meta,
            kind,
            source,
        } = opened;

        eprintln!("[NativeAudio] Input: {input_id}");
        self.active_input_id = Some(input_id.to_string());

        self.duration = meta.duration;
        self.decoded_channels = meta.channels;
        self.decoded_sample_rate = meta.sample_rate;
        self.decoded_bit_depth = meta.bit_depth;

        self.decoded_samples = None;
        self.streaming = None;
        match kind {
            crate::audio::input::AudioInputKind::Streaming(playback) => {
                self.streaming = Some(playback);
            }
            crate::audio::input::AudioInputKind::Decoded { samples } => {
                self.decoded_samples = Some(samples);
            }
            crate::audio::input::AudioInputKind::Rodio => {}
        }

        // For streaming playback, prebuffer some decoded samples before attaching the source to the sink.
        if let Some(streaming) = &self.streaming {
            let channels = meta.channels.max(1) as usize;
            let (target_samples, timeout) = streaming_prebuffer_target_samples(
                self.output_backend.id(),
                meta.sample_rate,
                channels,
                streaming.buffer.capacity_samples(),
                meta.duration,
                StreamingPrebufferKind::StartOrSeek,
                self.streaming_prebuffer_start_or_seek_seconds,
            );
            if streaming.buffer.len_samples() < target_samples {
                streaming
                    .buffer
                    .wait_for_samples(target_samples, timeout);
            }
        }

        let (controller, mixer_source) =
            PlaybackMixerSource::new(source, self.decoded_channels, self.decoded_sample_rate);
        self.mixer = Some(controller);
        sink.append(boxed_with_dsp(
            mixer_source,
            self.dsp_runtime.clone(),
            self.spectrum_tap.clone(),
        ));

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
        let can_crossfade = was_playing
            && self.sink.is_some()
            && self.mixer.is_some()
            && duration_ms > 0
            && self.decoded_channels > 0
            && self.decoded_sample_rate > 0;

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

        let target_channels = self.decoded_channels.max(1);
        let target_sample_rate = self.decoded_sample_rate.max(1);
        let open_sample_rate = Some(target_sample_rate);

        let opened = self
            .input_registry
            .open_prefer(&path, open_sample_rate, self.preferred_input_id.as_deref())
            .map_err(|err| format!("[{}] {}", err.code, err.message))?;

        let crate::audio::input::AudioInputOpenResult {
            input_id,
            meta,
            kind,
            source,
        } = opened;
        eprintln!("[NativeAudio] Input: {input_id}");

        let mut new_streaming: Option<StreamingPlayback> = None;
        let mut decoded_samples: Option<Arc<Vec<f32>>> = None;
        match kind {
            crate::audio::input::AudioInputKind::Streaming(playback) => {
                new_streaming = Some(playback);
            }
            crate::audio::input::AudioInputKind::Decoded { samples } => {
                decoded_samples = Some(samples);
            }
            crate::audio::input::AudioInputKind::Rodio => {}
        }

        // For streaming playback, wait for a small prebuffer to reduce underrun clicks/noise.
        if let Some(streaming) = &new_streaming {
            let channels = meta.channels.max(1) as usize;
            let (target_samples, timeout) = streaming_prebuffer_target_samples(
                self.output_backend.id(),
                meta.sample_rate,
                channels,
                streaming.buffer.capacity_samples(),
                meta.duration,
                StreamingPrebufferKind::Crossfade,
                self.streaming_prebuffer_crossfade_seconds,
            );
            if streaming.buffer.len_samples() < target_samples {
                streaming
                    .buffer
                    .wait_for_samples(target_samples, timeout);
            }
        }

        let next_source = coerce_source_format(source, target_channels, target_sample_rate);
        let old_shutdown_tx = self.streaming.as_ref().map(|streaming| streaming.command_tx.clone());

        let controller = self
            .mixer
            .as_ref()
            .ok_or_else(|| "Playback mixer unavailable".to_string())?;
        let duration_frames = ((target_sample_rate as u64).saturating_mul(duration_ms.clamp(1, 30_000)))
            / 1000;
        controller.crossfade_to(next_source, old_shutdown_tx, duration_frames.max(1))?;

        let decoded_samples = if decoded_samples.is_some()
            && (meta.channels != target_channels || meta.sample_rate != target_sample_rate)
        {
            None
        } else {
            decoded_samples
        };

        self.current_track = Some(path.clone());
        self.duration = meta.duration;
        self.decoded_samples = decoded_samples;
        self.decoded_channels = target_channels;
        self.decoded_sample_rate = target_sample_rate;
        self.decoded_bit_depth = meta.bit_depth;
        self.streaming = new_streaming;
        self.active_input_id = Some(input_id.to_string());

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

        Ok(())
    }

    pub(crate) fn play(&mut self) -> Result<(), String> {
        if let Some(sink) = &self.sink {
            if let Some(streaming) = &self.streaming {
                let channels = self.decoded_channels.max(1) as usize;
                let remaining_duration = if self.duration.is_finite() && self.duration > 0.0 {
                    (self.duration - self.current_position).max(0.0)
                } else {
                    self.duration
                };
                let (target_samples, _timeout) = streaming_prebuffer_target_samples(
                    self.output_backend.id(),
                    self.decoded_sample_rate,
                    channels,
                    streaming.buffer.capacity_samples(),
                    remaining_duration,
                    StreamingPrebufferKind::StartOrSeek,
                    self.streaming_prebuffer_start_or_seek_seconds,
                );

                if target_samples > 0 {
                    let sample_rate = self.decoded_sample_rate.max(1) as f64;
                    let channels_f64 = channels.max(1) as f64;
                    let target_seconds = target_samples as f64 / (sample_rate * channels_f64);
                    let is_exclusive = self.output_backend.id() == "wasapi-exclusive";
                    let min_seconds_cap = if is_exclusive { 0.75 } else { 0.35 };
                    let min_seconds_floor = if is_exclusive { 0.25 } else { 0.15 };
                    let min_start_seconds = target_seconds
                        .min(min_seconds_cap)
                        .max(min_seconds_floor)
                        .min(target_seconds);
                    let min_start_samples = ((sample_rate * channels_f64 * min_start_seconds).ceil() as usize)
                        .clamp(1, target_samples);

                    let available = streaming.buffer.len_samples();
                    self.desired_playback_state = PlaybackState::Playing;
                    if available < min_start_samples && !streaming.buffer.is_finished() {
                        sink.pause();
                        self.sync_clock();
                        self.playback_state = PlaybackState::Buffering;
                        let now = Instant::now();
                        self.buffering_started_at = Some(now);
                        self.buffering_last_progress_at = Some(now);
                        self.buffering_last_samples = available;
                        return Ok(());
                    }
                }
            }

            sink.play();
            self.buffering_started_at = None;
            self.buffering_last_progress_at = None;
            self.buffering_last_samples = 0;
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
            self.sync_clock();
            self.buffering_started_at = None;
            self.buffering_last_progress_at = None;
            self.buffering_last_samples = 0;
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
        self.buffering_started_at = None;
        self.buffering_last_progress_at = None;
        self.buffering_last_samples = 0;

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
                let (source, channels, sample_rate) = if let (Some(samples), channels, sample_rate) =
                    (self.decoded_samples.clone(), self.decoded_channels, self.decoded_sample_rate)
                {
                    (
                        Box::new(SharedSamplesSource::new(samples, channels, sample_rate, 0))
                            as crate::audio::output::BoxedSource,
                        channels,
                        sample_rate,
                    )
                } else if let Ok((source, meta)) = open_rodio_source_at(&track_path, 0.0) {
                    (source, meta.channels, meta.sample_rate)
                } else {
                    sink.pause();
                    sink.set_volume(self.effective_volume());
                    if let Some(old) = self.sink.replace(sink) {
                        old.stop();
                    }
                    self.current_position = 0.0;
                    self.base_position = 0.0;
                    self.playback_started_at = None;
                    self.set_state(PlaybackState::Stopped);
                    return;
                };

                let (controller, mixer_source) =
                    PlaybackMixerSource::new(source, channels.max(1), sample_rate.max(1));
                self.mixer = Some(controller);
                sink.append(boxed_with_dsp(
                    mixer_source,
                    self.dsp_runtime.clone(),
                    self.spectrum_tap.clone(),
                ));
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
        let resume_playing = matches!(self.desired_playback_state, PlaybackState::Playing);

        if let Some(streaming) = &self.streaming {
            if resume_playing {
                if let Some(sink) = &self.sink {
                    sink.pause();
                }
            }

            streaming.buffer.clear();
            self.spectrum_tap.clear();
            self.dsp_runtime.request_reset();
            let _ = streaming.command_tx.send(DecoderCommand::Seek(target));

            if resume_playing {
                self.base_position = target;
                self.playback_started_at = None;
                self.desired_playback_state = PlaybackState::Playing;
                self.playback_state = PlaybackState::Buffering;
                let now = Instant::now();
                self.buffering_started_at = Some(now);
                self.buffering_last_progress_at = Some(now);
                self.buffering_last_samples = streaming.buffer.len_samples();
            } else {
                self.base_position = target;
                self.playback_started_at = None;
                self.buffering_started_at = None;
                self.buffering_last_progress_at = None;
                self.buffering_last_samples = 0;
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

        let (source, channels, sample_rate) = if let (Some(samples), channels, sample_rate) = (
            self.decoded_samples.clone(),
            self.decoded_channels,
            self.decoded_sample_rate,
        ) {
            let start_sample = ((target * sample_rate as f64) as usize) * channels as usize;
            (
                Box::new(SharedSamplesSource::new(samples, channels, sample_rate, start_sample))
                    as crate::audio::output::BoxedSource,
                channels,
                sample_rate,
            )
        } else {
            let (source, meta) = open_rodio_source_at(&track_path, target)
                .map_err(|err| format!("[{}] {}", err.code, err.message))?;
            (source, meta.channels, meta.sample_rate)
        };

        let (controller, mixer_source) =
            PlaybackMixerSource::new(source, channels.max(1), sample_rate.max(1));
        self.mixer = Some(controller);
        sink.append(boxed_with_dsp(
            mixer_source,
            self.dsp_runtime.clone(),
            self.spectrum_tap.clone(),
        ));
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
        if let Some(err) = self.output_backend.take_error() {
            if let Some(sink) = &self.sink {
                sink.pause();
            }
            self.sync_clock();
            self.buffering_started_at = None;
            self.buffering_last_progress_at = None;
            self.buffering_last_samples = 0;
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
            self.buffering_started_at = None;
            self.buffering_last_progress_at = None;
            self.buffering_last_samples = 0;
            self.set_error("NATIVE_AUDIO_STREAM_ERROR", message);
            return true;
        }

        if let (Some(sink), Some(streaming)) = (&self.sink, &self.streaming) {
            let channels = self.decoded_channels.max(1) as usize;
            let remaining_duration = if self.duration.is_finite() && self.duration > 0.0 {
                (self.duration - self.current_position).max(0.0)
            } else {
                self.duration
            };
            let (target_samples, _timeout) = streaming_prebuffer_target_samples(
                self.output_backend.id(),
                self.decoded_sample_rate,
                channels,
                streaming.buffer.capacity_samples(),
                remaining_duration,
                StreamingPrebufferKind::StartOrSeek,
                self.streaming_prebuffer_start_or_seek_seconds,
            );

            if target_samples > 0 {
                let sample_rate = self.decoded_sample_rate.max(1) as f64;
                let channels_f64 = channels.max(1) as f64;
                let target_seconds = target_samples as f64 / (sample_rate * channels_f64);
                let is_exclusive = self.output_backend.id() == "wasapi-exclusive";
                let min_seconds_cap = if is_exclusive { 0.75 } else { 0.35 };
                let min_seconds_floor = if is_exclusive { 0.25 } else { 0.15 };
                let min_start_seconds = target_seconds
                    .min(min_seconds_cap)
                    .max(min_seconds_floor)
                    .min(target_seconds);
                let min_start_samples = ((sample_rate * channels_f64 * min_start_seconds).ceil() as usize)
                    .clamp(1, target_samples);
                let fallback_after = if is_exclusive {
                    Duration::from_secs(4)
                } else {
                    Duration::from_secs(3)
                };

                if matches!(self.desired_playback_state, PlaybackState::Playing)
                    && matches!(self.playback_state, PlaybackState::Playing)
                {
                    let available = streaming.buffer.len_samples();
                    if available < min_start_samples && !streaming.buffer.is_finished() {
                        sink.pause();
                        self.sync_clock();
                        self.playback_state = PlaybackState::Buffering;
                        let now = Instant::now();
                        self.buffering_started_at = Some(now);
                        self.buffering_last_progress_at = Some(now);
                        self.buffering_last_samples = available;
                        return true;
                    }
                }

                if matches!(self.desired_playback_state, PlaybackState::Playing)
                    && matches!(self.playback_state, PlaybackState::Buffering)
                {
                    let available = streaming.buffer.len_samples();
                    let finished = streaming.buffer.is_finished();
                    let now = Instant::now();
                    if available != self.buffering_last_samples {
                        self.buffering_last_samples = available;
                        self.buffering_last_progress_at = Some(now);
                    }

                    if streaming.buffer.is_finished_and_empty() {
                        self.buffering_started_at = None;
                        self.buffering_last_progress_at = None;
                        self.buffering_last_samples = 0;
                        self.current_position = self.duration;
                        self.base_position = self.current_position;
                        self.playback_started_at = None;
                        self.set_state(PlaybackState::Stopped);
                        return true;
                    }

                    if finished && available > 0 {
                        sink.play();
                        self.buffering_started_at = None;
                        self.buffering_last_progress_at = None;
                        self.buffering_last_samples = 0;
                        self.set_state(PlaybackState::Playing);
                        self.base_position = self.current_position;
                        self.playback_started_at = Some(now);
                        return true;
                    }

                    let ready_full = available >= target_samples;
                    let ready_min = available >= min_start_samples;
                    let waited_long_enough = self
                        .buffering_started_at
                        .is_some_and(|started| started.elapsed() >= fallback_after);

                    let stall_timeout = Duration::from_secs(15);
                    let no_progress_for = self
                        .buffering_last_progress_at
                        .map(|instant| now.saturating_duration_since(instant))
                        .unwrap_or(Duration::from_secs(0));
                    if !ready_min && no_progress_for >= stall_timeout && !finished {
                        sink.pause();
                        self.sync_clock();
                        self.buffering_started_at = None;
                        self.buffering_last_progress_at = None;
                        self.buffering_last_samples = 0;
                        self.set_error(
                            "NATIVE_AUDIO_BUFFERING_TIMEOUT",
                            "Audio buffering stalled (no decoder progress)".to_string(),
                        );
                        return true;
                    }

                    if ready_full || (waited_long_enough && ready_min) {
                        sink.play();
                        self.buffering_started_at = None;
                        self.buffering_last_progress_at = None;
                        self.buffering_last_samples = 0;
                        self.set_state(PlaybackState::Playing);
                        self.base_position = self.current_position;
                        self.playback_started_at = Some(Instant::now());
                        return true;
                    }

                    return true;
                }
            }

            if matches!(self.desired_playback_state, PlaybackState::Playing)
                && matches!(self.playback_state, PlaybackState::Buffering)
            {
                sink.play();
                self.buffering_started_at = None;
                self.buffering_last_progress_at = None;
                self.buffering_last_samples = 0;
                self.set_state(PlaybackState::Playing);
                self.base_position = self.current_position;
                self.playback_started_at = Some(Instant::now());
                return true;
            }
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

        let (buffered_time, buffered_ahead) = if let Some(streaming) = &self.streaming {
            let channels = self.decoded_channels.max(1) as f64;
            let sample_rate = self.decoded_sample_rate.max(1) as f64;
            let buffered_seconds = (streaming.buffer.len_samples() as f64 / channels) / sample_rate;
            let buffered_time = if self.duration > 0.0 {
                (self.current_position + buffered_seconds).min(self.duration)
            } else {
                self.current_position + buffered_seconds
            };
            (buffered_time, buffered_seconds)
        } else if self.decoded_samples.is_some() && self.duration > 0.0 {
            let ahead = (self.duration - self.current_position).max(0.0);
            (self.duration, ahead)
        } else {
            (self.current_position, 0.0)
        };

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
            buffered_time,
            buffered_ahead,
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

        let (source, channels, sample_rate) = if let Some(streaming) = &self.streaming {
            streaming.buffer.clear();
            let _ = streaming.command_tx.send(DecoderCommand::Seek(target));
            (
                Box::new(StreamingSamplesSource::new(
                    streaming.buffer.clone(),
                    self.decoded_channels.max(1),
                    self.decoded_sample_rate.max(1),
                    self.duration,
                )) as crate::audio::output::BoxedSource,
                self.decoded_channels,
                self.decoded_sample_rate,
            )
        } else if let Some(samples) = self.decoded_samples.clone() {
            let channels = self.decoded_channels.max(1);
            let sample_rate = self.decoded_sample_rate.max(1);
            let start_sample = ((target * sample_rate as f64) as usize) * channels as usize;
            (
                Box::new(SharedSamplesSource::new(
                    samples,
                    channels,
                    sample_rate,
                    start_sample,
                )) as crate::audio::output::BoxedSource,
                channels,
                sample_rate,
            )
        } else {
            let (source, meta) = maybe_rodio_source
                .expect("rodio source prepared when no streaming/decoded samples");
            (source, meta.channels, meta.sample_rate)
        };

        let (controller, mixer_source) =
            PlaybackMixerSource::new(source, channels.max(1), sample_rate.max(1));
        self.mixer = Some(controller);
        sink.append(boxed_with_dsp(
            mixer_source,
            self.dsp_runtime.clone(),
            self.spectrum_tap.clone(),
        ));

        sink.pause();
        sink.set_volume(self.effective_volume());

        if resume_playing {
            if let Some(streaming) = &self.streaming {
                let channels = self.decoded_channels.max(1) as usize;
                let remaining_duration = if self.duration.is_finite() && self.duration > 0.0 {
                    (self.duration - target).max(0.0)
                } else {
                    self.duration
                };
                let (target_samples, timeout) = streaming_prebuffer_target_samples(
                    self.output_backend.id(),
                    self.decoded_sample_rate,
                    channels,
                    streaming.buffer.capacity_samples(),
                    remaining_duration,
                    StreamingPrebufferKind::StartOrSeek,
                    self.streaming_prebuffer_start_or_seek_seconds,
                );
                if streaming.buffer.len_samples() < target_samples {
                    streaming
                        .buffer
                        .wait_for_samples(target_samples, timeout);
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
    use std::sync::atomic::AtomicUsize;

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

    #[derive(Default)]
    struct CallSink {
        play_calls: AtomicUsize,
        pause_calls: AtomicUsize,
    }

    impl AudioSink for CallSink {
        fn append(&self, _source: crate::audio::output::BoxedSource) {}

        fn play(&self) {
            self.play_calls.fetch_add(1, Ordering::Relaxed);
        }

        fn pause(&self) {
            self.pause_calls.fetch_add(1, Ordering::Relaxed);
        }

        fn stop(&self) {}

        fn empty(&self) -> bool {
            false
        }

        fn set_volume(&self, _value: f32) {}
    }

    struct StaticBackend(&'static str);

    impl AudioOutputBackend for StaticBackend {
        fn id(&self) -> &'static str {
            self.0
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
            true
        }

        fn select_device(&self, _device_name: Option<String>) -> Result<OutputStreamInfo, String> {
            Ok(OutputStreamInfo::default())
        }

        fn create_sink(&self) -> Result<(Arc<dyn AudioSink>, OutputStreamInfo), String> {
            Err("not supported".into())
        }
    }

    fn make_finished_streaming_playback(capacity_samples: usize, channels: usize) -> StreamingPlayback {
        let buffer = crate::audio::buffer::AudioRingBuffer::new(capacity_samples);
        let samples = vec![0.1f32; channels * 8];
        buffer.push_interleaved(&samples, channels);
        buffer.mark_finished();

        let (command_tx, _command_rx) = mpsc::channel::<DecoderCommand>();
        StreamingPlayback {
            buffer,
            command_tx,
            error: Arc::new(Mutex::new(None)),
        }
    }

    #[test]
    fn buffering_finished_stream_resumes_instead_of_timeout() {
        let backend: Arc<dyn AudioOutputBackend> = Arc::new(StaticBackend("rodio-cpal"));
        let mut engine = NativeAudioEngine::new_with_backend(backend);

        let sink = Arc::new(CallSink::default());
        engine.sink = Some(sink.clone());
        engine.streaming = Some(make_finished_streaming_playback(1024, 2));
        engine.decoded_channels = 2;
        engine.decoded_sample_rate = 48_000;
        engine.duration = 10.0;
        engine.current_position = 9.9;
        engine.playback_state = PlaybackState::Buffering;
        engine.desired_playback_state = PlaybackState::Playing;
        engine.buffering_started_at = Some(Instant::now() - Duration::from_secs(20));
        engine.buffering_last_progress_at = Some(Instant::now() - Duration::from_secs(20));
        engine.buffering_last_samples = engine
            .streaming
            .as_ref()
            .expect("streaming")
            .buffer
            .len_samples();

        let ticked = engine.tick();
        assert!(ticked);
        assert!(matches!(engine.playback_state, PlaybackState::Playing));
        assert_eq!(sink.pause_calls.load(Ordering::Relaxed), 0);
        assert!(sink.play_calls.load(Ordering::Relaxed) > 0);
        assert!(!matches!(engine.playback_state, PlaybackState::Error));
    }

    #[test]
    fn playing_finished_stream_does_not_enter_buffering() {
        let backend: Arc<dyn AudioOutputBackend> = Arc::new(StaticBackend("rodio-cpal"));
        let mut engine = NativeAudioEngine::new_with_backend(backend);

        let sink = Arc::new(CallSink::default());
        engine.sink = Some(sink.clone());
        engine.streaming = Some(make_finished_streaming_playback(1024, 2));
        engine.decoded_channels = 2;
        engine.decoded_sample_rate = 48_000;
        engine.duration = 10.0;
        engine.current_position = 9.9;
        engine.base_position = engine.current_position;
        engine.playback_started_at = Some(Instant::now());
        engine.playback_state = PlaybackState::Playing;
        engine.desired_playback_state = PlaybackState::Playing;

        let ticked = engine.tick();
        assert!(ticked);
        assert!(matches!(engine.playback_state, PlaybackState::Playing));
        assert_eq!(sink.pause_calls.load(Ordering::Relaxed), 0);
    }
}
