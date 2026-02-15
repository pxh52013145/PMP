use once_cell::sync::Lazy;
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use crate::audio::events::NativeAudioStatePayload;
use crate::audio::input::{
    open_rodio_source_at, resolve_audio_input_target_sample_rate, AudioInputDecodeMode,
    AudioInputRegistry, AudioInputSrcPolicy, DecoderCommand, SharedSamplesSource,
    StreamingPlayback, StreamingSamplesSource, StreamingShutdownTx, SACD_INPUT_ID,
    SYMPHONIA_INPUT_ID,
};
use crate::audio::mixer::{coerce_source_format, PlaybackMixerController, PlaybackMixerSource};
#[cfg(all(target_os = "windows", feature = "asio-sdk"))]
use crate::audio::output::ASIO_BACKEND_ID;
#[cfg(target_os = "windows")]
use crate::audio::output::WASAPI_EXCLUSIVE_BACKEND_ID;
use crate::audio::output::{default_backend, AudioOutputBackend, AudioSink, OutputStreamInfo};
use crate::audio::pipeline::{
    boxed_with_dsp, DspNodeConfig, DspRuntime, SpectrumSnapshot, SpectrumTap,
};
use crate::audio::policy::{
    NativeAudioEnginePolicyPatch, NativeAudioEnginePolicyPayload, NativeAudioHqSrcPhaseMode,
    NativeAudioOutputQuantizationMode, NativeAudioSrcBackend, NativeAudioSrcMode,
    NativeAudioTransportMode,
};
use crate::audio::realtime_scheduler::{RealtimePressureProfile, SCHEDULER};

const SHARED_TIMELINE_STRESS_WINDOW: Duration = Duration::from_secs(12);
const SHARED_TIMELINE_STRESS_EXTENSION: Duration = Duration::from_secs(16);
const SHARED_TIMELINE_LOW_WATERMARK_TRIGGER: usize = 4;

pub(crate) static ENGINE: Lazy<Mutex<NativeAudioEngine>> =
    Lazy::new(|| Mutex::new(NativeAudioEngine::new()));

static NATIVE_AUDIO_INFO_LOG_ENABLED: Lazy<bool> = Lazy::new(|| {
    std::env::var("PMP_AUDIO_INFO_LOG")
        .ok()
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            matches!(normalized.as_str(), "1" | "true" | "yes" | "on")
        })
        .unwrap_or(false)
});

fn info_log(message: impl AsRef<str>) {
    if *NATIVE_AUDIO_INFO_LOG_ENABLED {
        eprintln!("{}", message.as_ref());
    }
}

fn is_shared_output_backend(backend_id: &str) -> bool {
    backend_id == "wasapi" || backend_id == "wasapi-shared-raw" || backend_id == "rodio-cpal"
}

fn should_wrap_source_for_shared_backend(backend_id: &str) -> bool {
    // Some shared backends already maintain their own render queues (e.g. wasapi-shared-raw).
    // Wrapping sources again with a generic render-ahead layer increases latency and can make
    // play/pause/seek feel sluggish.
    backend_id == "wasapi" || backend_id == "rodio-cpal"
}

pub(crate) fn effective_src_policy_for_backend_open(
    backend_id: &str,
    mut src_policy: AudioInputSrcPolicy,
) -> AudioInputSrcPolicy {
    // Shared backends cannot reliably open arbitrary sample rates / integer PCM formats.
    // Always request the device mix/output sample rate so the sink can be initialized without
    // format negotiation failures (e.g. wasapi-shared-raw unsupported PCM16@192k).
    if is_shared_output_backend(backend_id) {
        src_policy.src_mode = NativeAudioSrcMode::MatchOutput;
        src_policy.src_target_sample_rate = None;
    }
    src_policy
}

pub(crate) fn resolve_requested_output_sample_rate_for_backend(
    backend_id: &str,
    output_sample_rate: Option<u32>,
    src_policy: AudioInputSrcPolicy,
) -> Option<u32> {
    resolve_audio_input_target_sample_rate(
        output_sample_rate,
        effective_src_policy_for_backend_open(backend_id, src_policy),
    )
}

fn decode_mode_id(mode: AudioInputDecodeMode) -> &'static str {
    match mode {
        AudioInputDecodeMode::Streaming => "streaming",
        AudioInputDecodeMode::FullTrack => "full-track",
    }
}

fn parse_decode_mode(value: &str) -> Option<AudioInputDecodeMode> {
    match value.trim().to_ascii_lowercase().as_str() {
        "streaming" => Some(AudioInputDecodeMode::Streaming),
        "full-track" => Some(AudioInputDecodeMode::FullTrack),
        _ => None,
    }
}

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
                0.30
            } else {
                0.35
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

fn streaming_min_start_bounds(
    output_backend_id: &str,
    underrun_recovery_active: bool,
) -> (f64, f64) {
    let is_exclusive = output_backend_id == "wasapi-exclusive";

    if is_exclusive {
        if underrun_recovery_active {
            // Exclusive mode can start fairly quickly, but after underruns we want a more conservative
            // prebuffer to avoid immediate rebuffer loops.
            (0.75, 0.25)
        } else {
            // Low-latency startup: do not block the first play for ~1s of prebuffer.
            (0.30, 0.10)
        }
    } else if underrun_recovery_active {
        // Shared backends are more sensitive to scheduling jitter; keep recovery startup conservative.
        (1.05, 0.35)
    } else {
        // Normal startup should feel instant (sub-500ms) while still preventing most underruns.
        (0.35, 0.12)
    }
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
    pub decode_mode: String,
}

pub(crate) struct NativeAudioEngine {
    input_registry: AudioInputRegistry,
    preferred_input_id: Option<String>,
    active_input_id: Option<String>,
    output_backend: Arc<dyn AudioOutputBackend>,
    seek_epoch: Arc<AtomicU64>,
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
    underrun_recovery_until: Option<Instant>,
    shared_timeline_stress_until: Option<Instant>,
    last_observed_underrun_events: u64,
    decoded_samples: Option<Arc<Vec<f32>>>,
    decoded_channels: u16,
    source_sample_rate: u32,
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
    spectrum_pre_tap: SpectrumTap,
    spectrum_post_tap: SpectrumTap,
    muted: bool,
    playback_state: PlaybackState,
    desired_playback_state: PlaybackState,
    latest_seek_command_seq: u64,
    operation_seq_counter: u64,
    pending_operation_seq: u64,
    error_seq_counter: u64,
    last_error_seq: u64,
    last_error_code: Option<String>,
    last_error_message: Option<String>,
    streaming_prebuffer_start_or_seek_seconds: Option<f64>,
    streaming_prebuffer_crossfade_seconds: Option<f64>,
    streaming_decode_mode: AudioInputDecodeMode,
    transport_mode: NativeAudioTransportMode,
    hq_src_enabled: bool,
    hq_src_phase_mode: NativeAudioHqSrcPhaseMode,
    src_mode: NativeAudioSrcMode,
    src_backend: NativeAudioSrcBackend,
    src_target_sample_rate: Option<u32>,
    output_quantization_mode: NativeAudioOutputQuantizationMode,
    spectrum_frame_counter: u64,
}

pub(crate) struct LoadOperation {
    pub token: u64,
    pub output_backend: Arc<dyn AudioOutputBackend>,
    pub input_registry: AudioInputRegistry,
    pub preferred_input_id: Option<String>,
    pub decode_mode: AudioInputDecodeMode,
    pub src_policy: AudioInputSrcPolicy,
    pub dsp_runtime: Arc<DspRuntime>,
    pub spectrum_pre_tap: SpectrumTap,
    pub spectrum_post_tap: SpectrumTap,
    pub effective_volume: f32,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum SpectrumTapKind {
    PreDsp,
    PostDsp,
}

#[derive(Clone, Debug)]
pub(crate) struct SpectrumFrameSnapshot {
    pub frame_id: u64,
    pub timestamp_ms: u64,
    pub tap: SpectrumTapKind,
    pub sample_rate: u32,
    pub window: Vec<f32>,
}

#[derive(Clone, Debug)]
pub(crate) struct DualSpectrumSnapshot {
    pub pre: Option<SpectrumFrameSnapshot>,
    pub post: Option<SpectrumFrameSnapshot>,
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
            streaming.shutdown_tx.shutdown();
        }
    }
}

pub(crate) struct CrossfadeOperation {
    pub token: u64,
    pub input_registry: AudioInputRegistry,
    pub preferred_input_id: Option<String>,
    pub decode_mode: AudioInputDecodeMode,
    pub src_policy: AudioInputSrcPolicy,
    pub output_backend_id: &'static str,
    pub target_channels: u16,
    pub target_sample_rate: u32,
    pub streaming_prebuffer_crossfade_seconds: Option<f64>,
    pub old_shutdown_tx: Option<StreamingShutdownTx>,
}

pub(crate) struct PreparedCrossfade {
    pub track_path: PathBuf,
    pub input_id: &'static str,
    pub meta: crate::audio::input::AudioInputMeta,
    pub streaming: Option<StreamingPlayback>,
    pub decoded_samples: Option<Arc<Vec<f32>>>,
    pub next_source: crate::audio::output::BoxedSource,
    pub old_shutdown_tx: Option<StreamingShutdownTx>,
    pub target_channels: u16,
    pub target_sample_rate: u32,
    pub duration_frames: u64,
}

impl PreparedCrossfade {
    pub(crate) fn abort(self) {
        if let Some(streaming) = self.streaming {
            streaming.shutdown_tx.shutdown();
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
        output_backend.set_transport_mode(NativeAudioTransportMode::Robust);
        output_backend.set_output_quantization_mode(NativeAudioOutputQuantizationMode::Round);
        let shared_output_backend = is_shared_output_backend(output_backend.id());
        info_log(format!(
            "[NativeAudio] Output backend: {}",
            output_backend.id()
        ));

        // Shared backends already incur an extra mixing pipeline; default SRC to a cheap SIMD path
        // to keep click-to-play and interactive seeks snappy (HQ can still be enabled via policy).
        let (default_hq_src_enabled, default_src_backend) = if shared_output_backend {
            (false, NativeAudioSrcBackend::LinearSimd)
        } else {
            (true, NativeAudioSrcBackend::Rubato)
        };
        Self {
            input_registry: AudioInputRegistry::default(),
            preferred_input_id: None,
            active_input_id: None,
            output_backend,
            seek_epoch: Arc::new(AtomicU64::new(1)),
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
            underrun_recovery_until: None,
            shared_timeline_stress_until: None,
            last_observed_underrun_events: 0,
            decoded_samples: None,
            decoded_channels: 0,
            source_sample_rate: 0,
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
            spectrum_pre_tap: SpectrumTap::new(1024),
            spectrum_post_tap: SpectrumTap::new(1024),
            muted: false,
            playback_state: PlaybackState::Idle,
            desired_playback_state: PlaybackState::Idle,
            latest_seek_command_seq: 0,
            operation_seq_counter: 0,
            pending_operation_seq: 0,
            error_seq_counter: 1,
            last_error_seq: 0,
            last_error_code: None,
            last_error_message: None,
            streaming_prebuffer_start_or_seek_seconds: None,
            streaming_prebuffer_crossfade_seconds: None,
            // Default to streaming for low latency startup + low memory usage.
            // Full-track decoding can still be enabled via streaming buffer settings for
            // seek/scrub-heavy workflows.
            streaming_decode_mode: AudioInputDecodeMode::Streaming,
            transport_mode: NativeAudioTransportMode::Robust,
            hq_src_enabled: default_hq_src_enabled,
            hq_src_phase_mode: NativeAudioHqSrcPhaseMode::Linear,
            src_mode: NativeAudioSrcMode::MatchOutput,
            src_backend: default_src_backend,
            src_target_sample_rate: None,
            output_quantization_mode: NativeAudioOutputQuantizationMode::Round,
            spectrum_frame_counter: 0,
        }
    }

    fn bump_seek_epoch(&self) {
        self.seek_epoch.fetch_add(1, Ordering::AcqRel);
    }

    pub(crate) fn playback_state(&self) -> PlaybackState {
        self.playback_state
    }

    pub(crate) fn desired_playback_state(&self) -> PlaybackState {
        self.desired_playback_state
    }

    pub(crate) fn current_track(&self) -> Option<PathBuf> {
        self.current_track.clone()
    }

    pub(crate) fn current_position(&self) -> f64 {
        self.current_position
    }

    pub(crate) fn is_playing_or_rebuffering(&self) -> bool {
        matches!(self.playback_state, PlaybackState::Playing)
            || (matches!(self.playback_state, PlaybackState::Buffering)
                && matches!(self.desired_playback_state, PlaybackState::Playing))
    }

    pub(crate) fn should_accept_seek_command(
        &mut self,
        seek_seq: Option<u64>,
        latest_requested_seek_seq: Option<u64>,
    ) -> bool {
        match seek_seq {
            Some(0) => true,
            Some(seq) => {
                if let Some(latest_requested) = latest_requested_seek_seq {
                    if latest_requested > 0 && seq < latest_requested {
                        return false;
                    }
                }
                if seq < self.latest_seek_command_seq {
                    return false;
                }
                self.latest_seek_command_seq = seq;
                true
            }
            None => true,
        }
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

    pub(crate) fn streaming_buffer_settings_payload(
        &self,
    ) -> NativeAudioStreamingBufferSettingsPayload {
        NativeAudioStreamingBufferSettingsPayload {
            start_or_seek_seconds: self.streaming_prebuffer_start_or_seek_seconds,
            crossfade_seconds: self.streaming_prebuffer_crossfade_seconds,
            decode_mode: decode_mode_id(self.streaming_decode_mode).to_string(),
        }
    }

    fn current_decode_mode(&self) -> AudioInputDecodeMode {
        self.streaming_decode_mode
    }

    pub(crate) fn set_streaming_buffer_settings(
        &mut self,
        start_or_seek_seconds: Option<f64>,
        crossfade_seconds: Option<f64>,
        decode_mode: Option<&str>,
    ) {
        fn sanitize(value: Option<f64>) -> Option<f64> {
            value
                .filter(|seconds| seconds.is_finite())
                .map(|seconds| seconds.clamp(0.0, 10.0))
        }

        self.streaming_prebuffer_start_or_seek_seconds = sanitize(start_or_seek_seconds);
        self.streaming_prebuffer_crossfade_seconds = sanitize(crossfade_seconds);
        if let Some(mode) = decode_mode.and_then(parse_decode_mode) {
            self.streaming_decode_mode = mode;
        }
    }

    fn append_source_with_pipeline(
        &self,
        sink: &Arc<dyn AudioSink>,
        source: crate::audio::output::BoxedSource,
        channels: u16,
        sample_rate: u32,
    ) -> PlaybackMixerController {
        let (controller, mixer_source) =
            PlaybackMixerSource::new(source, channels.max(1), sample_rate.max(1));
        let dsp_source = boxed_with_dsp(
            mixer_source,
            self.dsp_runtime.clone(),
            self.spectrum_pre_tap.clone(),
            self.spectrum_post_tap.clone(),
        );
        let output_source = if should_wrap_source_for_shared_backend(self.output_backend.id()) {
            crate::audio::output::wrap_source_for_shared_backend(
                dsp_source,
                self.seek_epoch.clone(),
            )
        } else {
            dsp_source
        };
        sink.append(output_source);
        controller
    }

    fn update_shared_timeline_stress_window(&mut self) {
        if !is_shared_output_backend(self.output_backend.id()) {
            self.shared_timeline_stress_until = None;
            return;
        }

        let timeline = crate::audio::diagnostics::snapshot_recent_default();
        let now = Instant::now();
        let now_ms = crate::audio::diagnostics::current_timestamp_ms();
        let recent_threshold_ms = now_ms.saturating_sub(
            SHARED_TIMELINE_STRESS_WINDOW
                .as_millis()
                .min(u64::MAX as u128) as u64,
        );

        let mut low_watermark_hits = 0usize;
        let mut has_underrun = false;

        for event in timeline.events.iter().rev() {
            if event.timestamp_ms < recent_threshold_ms {
                continue;
            }

            match event.kind {
                "shared.transfer.render_low_watermark"
                | "shared.transfer.decode_low_watermark"
                | "shared.render_ahead.low_watermark" => {
                    low_watermark_hits += 1;
                }
                "shared.output.render_underrun" | "shared.render_ahead.underrun" => {
                    has_underrun = true;
                }
                _ => {}
            }
        }

        if has_underrun || low_watermark_hits >= SHARED_TIMELINE_LOW_WATERMARK_TRIGGER {
            let target_until = now + SHARED_TIMELINE_STRESS_EXTENSION;
            self.shared_timeline_stress_until = Some(
                self.shared_timeline_stress_until
                    .map(|current| current.max(target_until))
                    .unwrap_or(target_until),
            );
            return;
        }

        if self
            .shared_timeline_stress_until
            .is_some_and(|until| until <= now)
        {
            self.shared_timeline_stress_until = None;
        }
    }

    pub(crate) fn engine_policy_payload(&self) -> NativeAudioEnginePolicyPayload {
        NativeAudioEnginePolicyPayload {
            transport_mode: self.transport_mode,
            hq_src_enabled: self.hq_src_enabled,
            hq_src_phase_mode: self.hq_src_phase_mode,
            src_mode: self.src_mode,
            src_backend: self.src_backend,
            src_target_sample_rate: self.src_target_sample_rate,
            output_quantization_mode: self.output_quantization_mode,
            hq_src_stopband_db: 140,
            transport_exact_int32_container: true,
        }
    }

    pub(crate) fn apply_engine_policy_patch(
        &mut self,
        patch: NativeAudioEnginePolicyPatch,
    ) -> (NativeAudioEnginePolicyPayload, bool) {
        let mut src_changed = false;

        if let Some(mode) = patch.transport_mode {
            self.transport_mode = mode;
            self.output_backend.set_transport_mode(mode);
        }
        if let Some(output_quantization_mode) = patch.output_quantization_mode {
            self.output_quantization_mode = output_quantization_mode;
            self.output_backend
                .set_output_quantization_mode(output_quantization_mode);
        }
        if let Some(enabled) = patch.hq_src_enabled {
            if self.hq_src_enabled != enabled {
                self.hq_src_enabled = enabled;
                src_changed = true;
            }
        }
        if let Some(phase_mode) = patch.hq_src_phase_mode {
            if self.hq_src_phase_mode != phase_mode {
                self.hq_src_phase_mode = phase_mode;
                src_changed = true;
            }
        }
        if let Some(src_mode) = patch.src_mode {
            if self.src_mode != src_mode {
                self.src_mode = src_mode;
                src_changed = true;
            }
        }
        if let Some(src_backend) = patch.src_backend {
            if self.src_backend != src_backend {
                self.src_backend = src_backend;
                src_changed = true;
            }
        }
        if patch.src_target_sample_rate.is_some() {
            let normalized = patch
                .src_target_sample_rate
                .and_then(Self::sanitize_src_target_sample_rate);
            if self.src_target_sample_rate != normalized {
                self.src_target_sample_rate = normalized;
                src_changed = true;
            }
        }

        (self.engine_policy_payload(), src_changed)
    }

    fn sanitize_src_target_sample_rate(sample_rate: u32) -> Option<u32> {
        Some(sample_rate.clamp(8_000, 768_000))
    }

    fn current_src_policy(&self) -> AudioInputSrcPolicy {
        AudioInputSrcPolicy {
            hq_src_enabled: self.hq_src_enabled,
            hq_src_phase_mode: self.hq_src_phase_mode,
            src_mode: self.src_mode,
            src_backend: self.src_backend,
            src_target_sample_rate: self.src_target_sample_rate,
        }
    }

    fn effective_src_policy_for_open(&self) -> AudioInputSrcPolicy {
        effective_src_policy_for_backend_open(self.output_backend.id(), self.current_src_policy())
    }

    fn streaming_available_samples(&self, streaming: &StreamingPlayback) -> usize {
        streaming
            .buffer
            .len_samples()
            .saturating_add(streaming.render_queue.len_samples())
    }

    fn streaming_is_finished(&self, streaming: &StreamingPlayback) -> bool {
        streaming.buffer.is_finished() && streaming.render_queue.is_finished()
    }

    fn streaming_is_finished_and_empty(&self, streaming: &StreamingPlayback) -> bool {
        streaming.buffer.is_finished_and_empty() && streaming.render_queue.is_finished_and_empty()
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
        self.spectrum_pre_tap.clear();
        self.spectrum_post_tap.clear();
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
            input_registry: self.input_registry.clone(),
            preferred_input_id: self.preferred_input_id.clone(),
            decode_mode: self.current_decode_mode(),
            src_policy: self.current_src_policy(),
            dsp_runtime: self.dsp_runtime.clone(),
            spectrum_pre_tap: self.spectrum_pre_tap.clone(),
            spectrum_post_tap: self.spectrum_post_tap.clone(),
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
        self.source_sample_rate = prepared.meta.source_sample_rate;
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

    pub(crate) fn begin_crossfade_operation(
        &mut self,
        duration_ms: u64,
    ) -> Option<CrossfadeOperation> {
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
        self.spectrum_pre_tap.clear();
        self.spectrum_post_tap.clear();

        let token = self.begin_operation();
        Some(CrossfadeOperation {
            token,
            input_registry: self.input_registry.clone(),
            preferred_input_id: self.preferred_input_id.clone(),
            decode_mode: self.current_decode_mode(),
            src_policy: self.current_src_policy(),
            output_backend_id: self.output_backend.id(),
            target_channels: self.decoded_channels.max(1),
            target_sample_rate: self.decoded_sample_rate.max(1),
            streaming_prebuffer_crossfade_seconds: self.streaming_prebuffer_crossfade_seconds,
            old_shutdown_tx: self
                .streaming
                .as_ref()
                .map(|streaming| streaming.shutdown_tx.clone()),
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
        self.source_sample_rate = prepared.meta.source_sample_rate;
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
        info_log(format!(
            "[NativeAudio] Switching output backend: {} -> {}",
            previous_backend.id(),
            target_id
        ));
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
        self.output_backend.set_transport_mode(self.transport_mode);
        self.output_backend
            .set_output_quantization_mode(self.output_quantization_mode);
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
                self.output_backend.set_transport_mode(self.transport_mode);
                self.output_backend
                    .set_output_quantization_mode(self.output_quantization_mode);
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
                    self.device_id = output_info
                        .device_id
                        .or_else(|| output_info.device_name.clone());
                    self.device_name = output_info
                        .device_name
                        .or_else(|| self.output_backend.default_device_name());
                }
                Err(err) => {
                    self.output_backend = previous_backend.clone();
                    self.device_id = previous_device_id;
                    self.device_name = previous_device_name;
                    self.output_sample_rate = previous_output_sample_rate;
                    self.output_backend.set_transport_mode(self.transport_mode);
                    self.output_backend
                        .set_output_quantization_mode(self.output_quantization_mode);
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
        info_log(format!(
            "[NativeAudio] Output backend ready: {} device={:?} out_sr={:?}",
            self.output_backend.id(),
            self.device_name,
            resolved_sample_rate
        ));
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
            PlaybackState::Idle
                | PlaybackState::Playing
                | PlaybackState::Paused
                | PlaybackState::Stopped
        ) {
            self.desired_playback_state = state;
        }
    }

    fn shutdown_streaming(&mut self) {
        if let Some(streaming) = self.streaming.take() {
            streaming.shutdown_tx.shutdown();
        }
    }

    fn reload_track_for_seek_recovery(&mut self, track_path: PathBuf) -> Result<(), String> {
        let previous_prebuffer = self.streaming_prebuffer_start_or_seek_seconds;
        self.streaming_prebuffer_start_or_seek_seconds = Some(0.0);
        let result = self.load(track_path);
        self.streaming_prebuffer_start_or_seek_seconds = previous_prebuffer;
        result
    }

    pub(crate) fn load(&mut self, path: PathBuf) -> Result<(), String> {
        self.cancel_crossfade();
        self.sync_clock();
        self.clear_error();
        self.spectrum_pre_tap.clear();
        self.spectrum_post_tap.clear();
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

        let open_src_policy = self.effective_src_policy_for_open();
        let opened = self
            .input_registry
            .open_prefer(
                &path,
                resolve_audio_input_target_sample_rate(self.output_sample_rate, open_src_policy),
                self.preferred_input_id.as_deref(),
                self.current_decode_mode(),
                open_src_policy,
            )
            .map_err(|err| format!("[{}] {}", err.code, err.message))?;

        let crate::audio::input::AudioInputOpenResult {
            input_id,
            meta,
            kind,
            source,
        } = opened;

        info_log(format!("[NativeAudio] Input: {input_id}"));
        self.active_input_id = Some(input_id.to_string());

        self.duration = meta.duration;
        self.decoded_channels = meta.channels;
        self.source_sample_rate = meta.source_sample_rate;
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
                streaming.render_queue.capacity_samples(),
                meta.duration,
                StreamingPrebufferKind::StartOrSeek,
                self.streaming_prebuffer_start_or_seek_seconds,
            );
            let available = streaming.render_queue.len_samples();
            if available < target_samples {
                streaming
                    .render_queue
                    .wait_for_samples(target_samples, timeout);
            }
        }

        self.mixer = Some(self.append_source_with_pipeline(
            &sink,
            source,
            self.decoded_channels,
            self.decoded_sample_rate,
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
        self.spectrum_pre_tap.clear();
        self.spectrum_post_tap.clear();

        let target_channels = self.decoded_channels.max(1);
        let target_sample_rate = self.decoded_sample_rate.max(1);
        let open_src_policy = self.effective_src_policy_for_open();
        let open_sample_rate =
            resolve_audio_input_target_sample_rate(self.output_sample_rate, open_src_policy);

        let opened = self
            .input_registry
            .open_prefer(
                &path,
                open_sample_rate,
                self.preferred_input_id.as_deref(),
                self.current_decode_mode(),
                open_src_policy,
            )
            .map_err(|err| format!("[{}] {}", err.code, err.message))?;

        let crate::audio::input::AudioInputOpenResult {
            input_id,
            meta,
            kind,
            source,
        } = opened;
        info_log(format!("[NativeAudio] Input: {input_id}"));

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
                streaming.render_queue.capacity_samples(),
                meta.duration,
                StreamingPrebufferKind::Crossfade,
                self.streaming_prebuffer_crossfade_seconds,
            );
            if streaming.render_queue.len_samples() < target_samples {
                streaming
                    .render_queue
                    .wait_for_samples(target_samples, timeout);
            }
        }

        let next_source = coerce_source_format(source, target_channels, target_sample_rate);
        let old_shutdown_tx = self
            .streaming
            .as_ref()
            .map(|streaming| streaming.shutdown_tx.clone());

        let controller = self
            .mixer
            .as_ref()
            .ok_or_else(|| "Playback mixer unavailable".to_string())?;
        let duration_frames =
            ((target_sample_rate as u64).saturating_mul(duration_ms.clamp(1, 30_000))) / 1000;
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
        self.source_sample_rate = meta.source_sample_rate;
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
        let sink = self
            .sink
            .as_ref()
            .cloned()
            .ok_or_else(|| "No track loaded".to_string())?;

        if let Some(streaming) = self.streaming.as_ref() {
            let now_for_recovery = Instant::now();
            let underrun_recovery_active = self
                .underrun_recovery_until
                .is_some_and(|until| until > now_for_recovery);
            if !underrun_recovery_active {
                self.underrun_recovery_until = None;
            }

            let channels = self.decoded_channels.max(1) as usize;
            let remaining_duration = if self.duration.is_finite() && self.duration > 0.0 {
                (self.duration - self.current_position).max(0.0)
            } else {
                self.duration
            };

            let decode_reservoir = streaming.buffer.clone();
            let render_queue = streaming.render_queue.clone();
            let (target_samples, _timeout) = streaming_prebuffer_target_samples(
                self.output_backend.id(),
                self.decoded_sample_rate,
                channels,
                render_queue.capacity_samples(),
                remaining_duration,
                StreamingPrebufferKind::StartOrSeek,
                self.streaming_prebuffer_start_or_seek_seconds,
            );

            if target_samples > 0 {
                let sample_rate = self.decoded_sample_rate.max(1) as f64;
                let channels_f64 = channels.max(1) as f64;
                let target_seconds = target_samples as f64 / (sample_rate * channels_f64);
                let (min_seconds_cap, min_seconds_floor) =
                    streaming_min_start_bounds(self.output_backend.id(), underrun_recovery_active);
                let min_start_seconds = target_seconds
                    .min(min_seconds_cap)
                    .max(min_seconds_floor)
                    .min(target_seconds);
                let min_start_samples = ((sample_rate * channels_f64 * min_start_seconds).ceil()
                    as usize)
                    .clamp(1, target_samples);

                let available = render_queue.len_samples();
                self.desired_playback_state = PlaybackState::Playing;
                let finished = decode_reservoir.is_finished() && render_queue.is_finished();
                if available < min_start_samples && !finished {
                    sink.pause();
                    self.sync_clock();
                    self.playback_state = PlaybackState::Buffering;
                    let now = Instant::now();
                    self.buffering_started_at = Some(now);
                    self.buffering_last_progress_at = Some(now);
                    self.buffering_last_samples = available;

                    // Fast-path: wait briefly for initial decoded samples so click-to-play does
                    // not depend on the emitter tick cadence.
                    render_queue.wait_for_samples(min_start_samples, Duration::from_millis(200));

                    let available = render_queue.len_samples();
                    let finished = decode_reservoir.is_finished() && render_queue.is_finished();
                    if available >= min_start_samples || (finished && available > 0) {
                        sink.play();
                        self.buffering_started_at = None;
                        self.buffering_last_progress_at = None;
                        self.buffering_last_samples = 0;
                        self.set_state(PlaybackState::Playing);
                        self.base_position = self.current_position;
                        self.playback_started_at = Some(Instant::now());
                    }
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
        self.spectrum_pre_tap.clear();
        self.spectrum_post_tap.clear();
        self.dsp_runtime.request_reset();
        self.buffering_started_at = None;
        self.buffering_last_progress_at = None;
        self.buffering_last_samples = 0;

        if let Some(streaming) = &self.streaming {
            streaming.buffer.clear();
            streaming.render_queue.clear();
            let _ = streaming.command_tx.send(DecoderCommand::Seek(0.0));
            if let Some(sink) = &self.sink {
                sink.pause();
            }
        } else if self.current_track.is_some() && self.output_backend.is_stream_open() {
            let track_path = self.current_track.clone().expect("checked is_some");
            let sink = self.output_backend.create_sink().ok().map(|(sink, _)| sink);

            if let Some(sink) = sink {
                let (source, channels, sample_rate) =
                    if let (Some(samples), channels, sample_rate) = (
                        self.decoded_samples.clone(),
                        self.decoded_channels,
                        self.decoded_sample_rate,
                    ) {
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

                self.mixer = Some(self.append_source_with_pipeline(
                    &sink,
                    source,
                    channels.max(1),
                    sample_rate.max(1),
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
            self.spectrum_pre_tap.clear();
            self.spectrum_post_tap.clear();
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
            self.source_sample_rate = 0;
            self.decoded_sample_rate = 0;
            self.decoded_bit_depth = None;
            self.set_state(PlaybackState::Stopped);
        }
    }

    pub(crate) fn seek(&mut self, seconds: f64) -> Result<(), String> {
        self.cancel_crossfade();
        self.sync_clock();
        self.spectrum_pre_tap.clear();
        self.spectrum_post_tap.clear();
        self.dsp_runtime.request_reset();
        let track_path = self
            .current_track
            .clone()
            .ok_or_else(|| "No track loaded".to_string())?;
        let mut target = seconds.max(0.0);
        if self.duration.is_finite() && self.duration > 0.0 {
            // Avoid edge-case failures when seeking to (or slightly past) the exact end.
            target = target.min((self.duration - 0.000_5).max(0.0));
        }
        let resume_playing = matches!(self.desired_playback_state, PlaybackState::Playing);
        let mut force_non_streaming_seek = false;

        let apply_streaming_seek_state =
            |engine: &mut NativeAudioEngine,
             seek_target: f64,
             should_resume_playing: bool,
             _available_samples: usize| {
                // Interactive seek requirement: resume output immediately (ms-level perceived seek),
                // but keep the clock paused until the decoder has produced samples for the new position.
                engine.base_position = seek_target;
                engine.current_position = seek_target;
                engine.playback_started_at = None;
                engine.buffering_started_at = None;
                engine.buffering_last_progress_at = None;
                engine.buffering_last_samples = 0;

                if should_resume_playing {
                    engine.desired_playback_state = PlaybackState::Playing;
                    engine.playback_state = PlaybackState::Playing;
                }
            };

        if let Some(streaming) = &self.streaming {
            self.spectrum_pre_tap.clear();
            self.spectrum_post_tap.clear();
            self.dsp_runtime.request_reset();

            match streaming.command_tx.send(DecoderCommand::Seek(target)) {
                Ok(()) => {
                    streaming.buffer.clear();
                    streaming.render_queue.clear();
                    // Flush shared render-ahead queues only after the upstream decoder state has been
                    // updated/cleared. Otherwise the producer can refill the buffer with old audio
                    // before we switch sources, causing a noticeable seek delay ("rubber banding").
                    self.bump_seek_epoch();
                    if let Some(sink) = &self.sink {
                        sink.flush();
                    }
                    let available_samples = self.streaming_available_samples(streaming);
                    apply_streaming_seek_state(self, target, resume_playing, available_samples);
                    if resume_playing {
                        if let Some(sink) = &self.sink {
                            sink.play();
                        }
                    }
                    return Ok(());
                }
                Err(_) => {
                    info_log(
                        "[NativeAudio] Streaming seek channel disconnected; rebuilding stream pipeline.",
                    );
                }
            }

            self.reload_track_for_seek_recovery(track_path.clone())?;
            if resume_playing {
                self.desired_playback_state = PlaybackState::Playing;
            }

            if let Some(reloaded_streaming) = &self.streaming {
                match reloaded_streaming
                    .command_tx
                    .send(DecoderCommand::Seek(target))
                {
                    Ok(()) => {
                        reloaded_streaming.buffer.clear();
                        reloaded_streaming.render_queue.clear();
                        self.bump_seek_epoch();
                        if let Some(sink) = &self.sink {
                            sink.flush();
                        }
                        let available_samples =
                            self.streaming_available_samples(reloaded_streaming);
                        apply_streaming_seek_state(self, target, resume_playing, available_samples);
                        if resume_playing {
                            if let Some(sink) = &self.sink {
                                sink.play();
                            }
                        }
                        return Ok(());
                    }
                    Err(_) => {
                        info_log(
                            "[NativeAudio] Rebuilt streaming decoder exited immediately; using direct source seek.",
                        );
                        self.shutdown_streaming();
                        force_non_streaming_seek = true;
                    }
                }
            } else {
                force_non_streaming_seek = true;
            }
        }

        if force_non_streaming_seek {
            self.buffering_started_at = None;
            self.buffering_last_progress_at = None;
            self.buffering_last_samples = 0;
        }

        if let (Some(samples), Some(sink), Some(mixer)) = (
            self.decoded_samples.clone(),
            self.sink.as_ref(),
            self.mixer.as_ref(),
        ) {
            let channels = self.decoded_channels.max(1);
            let sample_rate = self.decoded_sample_rate.max(1);
            let start_sample = ((target * sample_rate as f64) as usize) * channels as usize;
            let max_start_sample = samples.len().saturating_sub(channels as usize);
            let start_sample = start_sample.min(max_start_sample);
            let actual_target =
                (start_sample as f64) / (sample_rate as f64 * channels as f64).max(1.0);

            // In-memory seek must never recreate the sink/output stream; it should be a fast
            // pointer jump (VCP-style). Switch the mixer source in-place with a ~1ms crossfade
            // to avoid clicks without introducing a perceptible gap.
            let seek_fade_frames = 64u64;
            mixer.crossfade_to(
                Box::new(SharedSamplesSource::new(
                    samples,
                    channels,
                    sample_rate,
                    start_sample,
                )) as crate::audio::output::BoxedSource,
                None,
                seek_fade_frames,
            )?;

            // Bump the shared seek epoch only after the mixer has been updated so any shared
            // render-ahead producer refills using the new source position.
            self.bump_seek_epoch();
            sink.flush();
            sink.set_volume(self.effective_volume());
            if resume_playing {
                sink.play();
                self.base_position = actual_target;
                self.playback_started_at = Some(Instant::now());
                self.set_state(PlaybackState::Playing);
            } else {
                sink.pause();
                self.base_position = actual_target;
                self.playback_started_at = None;
                self.set_state(PlaybackState::Paused);
            }

            self.current_position = actual_target;
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
            let max_start_sample = samples.len().saturating_sub(channels.max(1) as usize);
            let start_sample = start_sample.min(max_start_sample);
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
            let (source, meta) = open_rodio_source_at(&track_path, target)
                .map_err(|err| format!("[{}] {}", err.code, err.message))?;
            (source, meta.channels, meta.sample_rate)
        };

        self.mixer = Some(self.append_source_with_pipeline(
            &sink,
            source,
            channels.max(1),
            sample_rate.max(1),
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
        let (window, sample_rate) = self.spectrum_post_tap.snapshot()?;
        Some(SpectrumSnapshot {
            sample_rate,
            window,
        })
    }

    pub(crate) fn snapshot_for_dual_spectrum(&mut self) -> Option<DualSpectrumSnapshot> {
        let pre = self.spectrum_pre_tap.snapshot();
        let post = self.spectrum_post_tap.snapshot();
        if pre.is_none() && post.is_none() {
            return None;
        }

        let frame_id = self.next_spectrum_frame_id();
        let timestamp_ms = crate::audio::diagnostics::current_timestamp_ms();
        let map_frame = |snapshot: Option<(Vec<f32>, u32)>,
                         tap: SpectrumTapKind|
         -> Option<SpectrumFrameSnapshot> {
            snapshot.map(|(window, sample_rate)| SpectrumFrameSnapshot {
                frame_id,
                timestamp_ms,
                tap,
                sample_rate,
                window,
            })
        };

        Some(DualSpectrumSnapshot {
            pre: map_frame(pre, SpectrumTapKind::PreDsp),
            post: map_frame(post, SpectrumTapKind::PostDsp),
        })
    }

    fn next_spectrum_frame_id(&mut self) -> u64 {
        self.spectrum_frame_counter = self.spectrum_frame_counter.wrapping_add(1);
        self.spectrum_frame_counter
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
        self.update_shared_timeline_stress_window();

        let (underrun_events, _) = crate::audio::input::streaming_underrun_stats();
        if underrun_events > self.last_observed_underrun_events {
            self.last_observed_underrun_events = underrun_events;
            self.underrun_recovery_until = Some(Instant::now() + Duration::from_secs(20));
        }
        let now_for_recovery = Instant::now();
        let underrun_recovery_active = self
            .underrun_recovery_until
            .is_some_and(|until| until > now_for_recovery);
        let shared_stress_active = self
            .shared_timeline_stress_until
            .is_some_and(|until| until > now_for_recovery);
        if !underrun_recovery_active {
            self.underrun_recovery_until = None;
        }
        if !shared_stress_active {
            self.shared_timeline_stress_until = None;
        }

        let robust_recovery_active = underrun_recovery_active || shared_stress_active;

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
                streaming.render_queue.capacity_samples(),
                remaining_duration,
                StreamingPrebufferKind::StartOrSeek,
                self.streaming_prebuffer_start_or_seek_seconds,
            );

            if target_samples > 0 {
                let sample_rate = self.decoded_sample_rate.max(1) as f64;
                let channels_f64 = channels.max(1) as f64;
                let target_seconds = target_samples as f64 / (sample_rate * channels_f64);
                let (min_seconds_cap, min_seconds_floor) =
                    streaming_min_start_bounds(self.output_backend.id(), robust_recovery_active);
                let min_start_seconds = target_seconds
                    .min(min_seconds_cap)
                    .max(min_seconds_floor)
                    .min(target_seconds);
                let min_start_samples = ((sample_rate * channels_f64 * min_start_seconds).ceil()
                    as usize)
                    .clamp(1, target_samples);
                let buffered_ahead_seconds = if sample_rate > 0.0 && channels_f64 > 0.0 {
                    (streaming.render_queue.len_samples() as f64)
                        / (sample_rate * channels_f64)
                } else {
                    0.0
                };
                let _ = SCHEDULER.update(buffered_ahead_seconds, robust_recovery_active);

                if matches!(self.desired_playback_state, PlaybackState::Playing)
                    && matches!(self.playback_state, PlaybackState::Playing)
                {
                    let available = streaming.render_queue.len_samples();
                    // During interactive seek we keep the sink running (the streaming source emits
                    // silence) and avoid entering the buffering state, otherwise shared backends
                    // can "pause then resume" with large perceived latency.
                    if self.playback_started_at.is_some()
                        && available < min_start_samples
                        && !self.streaming_is_finished(streaming)
                    {
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
                    && matches!(self.playback_state, PlaybackState::Playing)
                    && self.playback_started_at.is_none()
                {
                    // Seek-in-flight: keep playing (silence) but still detect a decoder stall.
                    let available = streaming.render_queue.len_samples();
                    let finished = self.streaming_is_finished(streaming);
                    let now = Instant::now();

                    if self.buffering_started_at.is_none() {
                        self.buffering_started_at = Some(now);
                        self.buffering_last_progress_at = Some(now);
                        self.buffering_last_samples = available;
                    } else if available != self.buffering_last_samples {
                        self.buffering_last_samples = available;
                        self.buffering_last_progress_at = Some(now);
                    }

                    let stall_timeout = Duration::from_secs(15);
                    let no_progress_for = self
                        .buffering_last_progress_at
                        .map(|instant| now.saturating_duration_since(instant))
                        .unwrap_or(Duration::from_secs(0));
                    if !finished
                        && available < min_start_samples
                        && no_progress_for >= stall_timeout
                    {
                        sink.pause();
                        self.sync_clock();
                        self.buffering_started_at = None;
                        self.buffering_last_progress_at = None;
                        self.buffering_last_samples = 0;
                        self.set_error(
                            "NATIVE_AUDIO_SEEK_STALLED",
                            "Audio seek stalled (no decoder progress)".to_string(),
                        );
                        return true;
                    }
                }

                if matches!(self.desired_playback_state, PlaybackState::Playing)
                    && matches!(self.playback_state, PlaybackState::Buffering)
                {
                    let available = streaming.render_queue.len_samples();
                    let finished = self.streaming_is_finished(streaming);
                    let now = Instant::now();
                    if available != self.buffering_last_samples {
                        self.buffering_last_samples = available;
                        self.buffering_last_progress_at = Some(now);
                    }

                    if self.streaming_is_finished_and_empty(streaming) {
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

                    let ready_min = available >= min_start_samples;

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

                    if ready_min {
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

        // For streaming playback we intentionally resume the sink immediately after seek and let
        // the source output silence until decoded samples arrive. Start the clock only once the
        // decoder has produced samples for the new position, so UI time doesn't drift ahead.
        if self.playback_started_at.is_none() {
            if let Some(streaming) = &self.streaming {
                let available = streaming.render_queue.len_samples();
                if available > (self.decoded_channels.max(1) as usize * 32) {
                    self.base_position = self.current_position;
                    self.playback_started_at = Some(Instant::now());
                }
            }
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

    pub(crate) fn set_preferred_input_id(
        &mut self,
        input_id: Option<String>,
    ) -> Result<(), String> {
        let input_id = input_id.and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        });

        let mut input_id = input_id;
        if input_id.as_deref() == Some("symphonia-decoded") {
            self.streaming_decode_mode = AudioInputDecodeMode::FullTrack;
            input_id = Some(SYMPHONIA_INPUT_ID.to_string());
        }

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
        let (
            transfer_low_watermark_samples,
            transfer_render_low_hit_count,
            transfer_decode_low_hit_count,
            render_queue_page_locked,
        ) = crate::audio::input::streaming_transfer_stats();

        #[cfg(target_os = "windows")]
        let output_metrics = crate::audio::output::output_callback_metrics();
        #[cfg(not(target_os = "windows"))]
        let output_metrics = crate::audio::output::OutputCallbackMetricsSnapshot::default();

        let output_callback_metrics_valid = self.output_backend.id() == "wasapi-exclusive"
            || self.output_backend.id() == "wasapi-shared-raw";
        let shared_render_backend = is_shared_output_backend(self.output_backend.id());
        let shared_render_metrics = crate::audio::output::shared_render_ahead_metrics();
        let diagnostics_timeline = crate::audio::diagnostics::snapshot_recent_default();
        let transfer_metrics_valid = matches!(
            self.active_input_id.as_deref(),
            Some(SYMPHONIA_INPUT_ID) | Some(SACD_INPUT_ID)
        );

        let (buffered_time, buffered_ahead) = if let Some(streaming) = &self.streaming {
            let channels = self.decoded_channels.max(1) as f64;
            let sample_rate = self.decoded_sample_rate.max(1) as f64;
            let buffered_seconds =
                (self.streaming_available_samples(streaming) as f64 / channels) / sample_rate;
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
            source_sample_rate: if self.source_sample_rate > 0 {
                Some(self.source_sample_rate)
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
            scheduler_profile: Some(match SCHEDULER.profile() {
                RealtimePressureProfile::Normal => "normal".to_string(),
                RealtimePressureProfile::Guarded => "guarded".to_string(),
                RealtimePressureProfile::Critical => "critical".to_string(),
            }),
            hq_src_active: Some(
                matches!(self.src_mode, NativeAudioSrcMode::SourceNative)
                    || self.hq_src_enabled
                        && self.source_sample_rate > 0
                        && self.decoded_sample_rate > 0
                        && self.source_sample_rate != self.decoded_sample_rate,
            ),
            hq_src_ratio: if self.source_sample_rate > 0 && self.decoded_sample_rate > 0 {
                Some(self.decoded_sample_rate as f64 / self.source_sample_rate as f64)
            } else {
                None
            },
            transport_mode: Some(self.transport_mode.as_str().to_string()),
            hq_src_phase_mode: Some(self.hq_src_phase_mode.as_str().to_string()),
            src_mode: Some(self.src_mode.as_str().to_string()),
            src_backend: Some(self.src_backend.as_str().to_string()),
            src_target_sample_rate: self.src_target_sample_rate,
            output_quantization_mode: Some(self.output_quantization_mode.as_str().to_string()),
            hq_src_stopband_db: Some(140),
            transport_exact_int32_container: Some(true),
            output_callback_metrics_valid: Some(output_callback_metrics_valid),
            output_callback_p99_us: if output_callback_metrics_valid {
                Some(output_metrics.render_p99_us)
            } else {
                None
            },
            output_wait_timeout_count: if output_callback_metrics_valid {
                Some(output_metrics.wait_timeout_count)
            } else {
                None
            },
            output_render_underrun_events: if output_callback_metrics_valid {
                Some(output_metrics.render_underrun_events)
            } else {
                None
            },
            output_render_underrun_frames: if output_callback_metrics_valid {
                Some(output_metrics.render_underrun_frames)
            } else {
                None
            },
            output_callback_interval_jitter_p99_us: if output_callback_metrics_valid {
                Some(output_metrics.interval_jitter_p99_us)
            } else {
                None
            },
            output_callback_interval_overrun_count: if output_callback_metrics_valid {
                Some(output_metrics.interval_overrun_count)
            } else {
                None
            },
            output_callback_expected_interval_us: if output_callback_metrics_valid {
                Some(output_metrics.expected_interval_us)
            } else {
                None
            },
            transfer_low_watermark_samples: if transfer_metrics_valid {
                Some(transfer_low_watermark_samples)
            } else {
                None
            },
            transfer_render_low_hit_count: if transfer_metrics_valid {
                Some(transfer_render_low_hit_count)
            } else {
                None
            },
            transfer_decode_low_hit_count: if transfer_metrics_valid {
                Some(transfer_decode_low_hit_count)
            } else {
                None
            },
            render_queue_page_locked: if transfer_metrics_valid {
                Some(render_queue_page_locked)
            } else {
                None
            },
            shared_render_ahead_enabled: Some(shared_render_backend),
            shared_render_underrun_events: if shared_render_backend {
                Some(shared_render_metrics.render_underrun_events)
            } else {
                None
            },
            shared_render_underrun_frames: if shared_render_backend {
                Some(shared_render_metrics.render_underrun_frames)
            } else {
                None
            },
            shared_render_low_hit_count: if shared_render_backend {
                Some(shared_render_metrics.render_low_hit_count)
            } else {
                None
            },
            shared_render_low_watermark_samples: if shared_render_backend {
                Some(shared_render_metrics.render_low_watermark_samples)
            } else {
                None
            },
            diagnostic_timeline_dropped_events: Some(diagnostics_timeline.dropped_events),
            diagnostic_timeline: Some(diagnostics_timeline.events),
            error_seq: self
                .last_error_code
                .as_ref()
                .map(|_| self.last_error_seq)
                .filter(|seq| *seq > 0),
            error_code: self.last_error_code.clone(),
            error_message: self.last_error_message.clone(),
        }
    }

    pub(crate) fn build_tick_state_payload(&self, ended: bool) -> NativeAudioStatePayload {
        let mut payload = self.build_state_payload(ended);
        payload.queue = None;
        payload.current_index = None;
        payload
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

        self.spectrum_pre_tap.clear();
        self.spectrum_post_tap.clear();
        self.dsp_runtime.request_reset();

        let (source, channels, sample_rate) = if let Some(streaming) = &self.streaming {
            let seek_dispatched = streaming
                .command_tx
                .send(DecoderCommand::Seek(target))
                .is_ok();
            if seek_dispatched {
                streaming.buffer.clear();
                streaming.render_queue.clear();
                (
                    Box::new(StreamingSamplesSource::new(
                        streaming.render_queue.clone(),
                        self.decoded_channels.max(1),
                        self.decoded_sample_rate.max(1),
                        self.duration,
                    )) as crate::audio::output::BoxedSource,
                    self.decoded_channels,
                    self.decoded_sample_rate,
                )
            } else {
                info_log(
                    "[NativeAudio] Streaming decoder is unavailable while rebuilding sink; reloading stream pipeline.",
                );
                self.reload_track_for_seek_recovery(track_path.clone())?;
                if target > 0.0 {
                    self.seek(target)?;
                }
                if resume_playing {
                    self.play()?;
                }
                return Ok(());
            }
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

        self.mixer = Some(self.append_source_with_pipeline(
            &sink,
            source,
            channels.max(1),
            sample_rate.max(1),
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
                    streaming.render_queue.capacity_samples(),
                    remaining_duration,
                    StreamingPrebufferKind::StartOrSeek,
                    self.streaming_prebuffer_start_or_seek_seconds,
                );
                if streaming.render_queue.len_samples() < target_samples {
                    streaming
                        .render_queue
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
    use std::fs::File;
    use std::io::Write;
    use std::path::Path;
    use std::sync::atomic::AtomicUsize;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc;
    use std::time::{SystemTime, UNIX_EPOCH};

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
    fn resolve_requested_output_sample_rate_for_backend_forces_shared_match_output() {
        let policy = AudioInputSrcPolicy {
            hq_src_enabled: true,
            hq_src_phase_mode: NativeAudioHqSrcPhaseMode::Linear,
            src_mode: NativeAudioSrcMode::TargetRate,
            src_backend: NativeAudioSrcBackend::Rubato,
            src_target_sample_rate: Some(192_000),
        };

        assert_eq!(
            resolve_requested_output_sample_rate_for_backend(
                "wasapi-shared-raw",
                Some(48_000),
                policy,
            ),
            Some(48_000)
        );
        assert_eq!(
            resolve_requested_output_sample_rate_for_backend("wasapi", Some(48_000), policy),
            Some(48_000)
        );
        assert_eq!(
            resolve_requested_output_sample_rate_for_backend("rodio-cpal", Some(48_000), policy),
            Some(48_000)
        );
        assert_eq!(
            resolve_requested_output_sample_rate_for_backend(
                "wasapi-exclusive",
                Some(48_000),
                policy,
            ),
            Some(192_000)
        );
    }

    #[test]
    fn shared_render_ahead_wrap_excludes_shared_raw_backend() {
        assert!(should_wrap_source_for_shared_backend("wasapi"));
        assert!(should_wrap_source_for_shared_backend("rodio-cpal"));
        assert!(!should_wrap_source_for_shared_backend("wasapi-shared-raw"));
        assert!(!should_wrap_source_for_shared_backend("wasapi-exclusive"));
    }

    #[test]
    fn play_buffers_until_render_queue_has_min_start_samples() {
        let backend: Arc<dyn AudioOutputBackend> = Arc::new(TransportModeBackend::new("wasapi"));
        let mut engine = NativeAudioEngine::new_with_backend(backend);

        engine.decoded_channels = 2;
        engine.decoded_sample_rate = 48_000;
        engine.duration = 120.0;
        engine.current_position = 0.0;
        engine.set_streaming_buffer_settings(Some(0.2), None, Some("streaming"));

        let sink = Arc::new(CallSink::default());
        engine.sink = Some(sink.clone());

        // Decoder reservoir has data, but the render queue (the only queue the streaming source
        // actually reads from) is empty. play() should enter buffering instead of starting output
        // with silence.
        let capacity_samples = 48_000usize * 2 * 10;
        let buffer = crate::audio::buffer::AudioRingBuffer::new(capacity_samples);
        let render_queue = crate::audio::buffer::AudioRingBuffer::new(
            (capacity_samples / 4).clamp(16_384, 262_144),
        );

        let seed_frames = 12_000usize;
        let seed = vec![0.1f32; seed_frames * 2];
        let pushed = buffer.push_interleaved(&seed, 2);
        assert!(pushed > 0, "expected seed frames to be pushed");

        let (command_tx, _command_rx) = mpsc::channel::<DecoderCommand>();
        let (transfer_tx, _transfer_rx) = mpsc::channel();
        let streaming = StreamingPlayback {
            buffer,
            render_queue,
            shutdown_tx: StreamingShutdownTx::new(command_tx.clone(), transfer_tx),
            command_tx,
            error: Arc::new(Mutex::new(None)),
        };
        engine.streaming = Some(streaming);

        engine.playback_state = PlaybackState::Paused;
        engine.desired_playback_state = PlaybackState::Paused;

        engine.play().expect("play");
        assert!(matches!(engine.playback_state, PlaybackState::Buffering));
        assert!(engine.buffering_started_at.is_some());
        assert!(sink.pause_calls.load(Ordering::Acquire) >= 1);
        assert_eq!(sink.play_calls.load(Ordering::Acquire), 0);
    }

    #[test]
    fn buffering_resumes_once_min_start_samples_are_available() {
        let backend: Arc<dyn AudioOutputBackend> = Arc::new(StaticBackend("rodio-cpal"));
        let mut engine = NativeAudioEngine::new_with_backend(backend);

        engine.decoded_channels = 2;
        engine.decoded_sample_rate = 48_000;
        engine.duration = 120.0;
        engine.current_position = 0.0;
        // Large target so `target_samples` stays above the min-start bound.
        engine.set_streaming_buffer_settings(Some(2.4), None, Some("streaming"));

        let sink = Arc::new(CallSink::default());
        engine.sink = Some(sink.clone());

        let channels = engine.decoded_channels.max(1) as usize;
        let capacity_samples = 48_000usize * channels * 10;
        let buffer = crate::audio::buffer::AudioRingBuffer::new(capacity_samples);
        let render_queue = crate::audio::buffer::AudioRingBuffer::new(
            (capacity_samples / 4).clamp(16_384, 262_144),
        );

        let remaining_duration = engine.duration;
        let (target_samples, _) = streaming_prebuffer_target_samples(
            engine.output_backend.id(),
            engine.decoded_sample_rate,
            channels,
            render_queue.capacity_samples(),
            remaining_duration,
            StreamingPrebufferKind::StartOrSeek,
            engine.streaming_prebuffer_start_or_seek_seconds,
        );
        assert!(
            target_samples > 0,
            "expected a non-zero target_samples for this test"
        );

        let sample_rate = engine.decoded_sample_rate.max(1) as f64;
        let channels_f64 = channels.max(1) as f64;
        let target_seconds = target_samples as f64 / (sample_rate * channels_f64);
        let (min_seconds_cap, min_seconds_floor) =
            streaming_min_start_bounds(engine.output_backend.id(), false);
        let min_start_seconds = target_seconds
            .min(min_seconds_cap)
            .max(min_seconds_floor)
            .min(target_seconds);
        let min_start_samples = ((sample_rate * channels_f64 * min_start_seconds).ceil() as usize)
            .clamp(1, target_samples);

        let frames_to_push = (min_start_samples + channels - 1) / channels;
        let samples_to_push = frames_to_push * channels;
        assert!(samples_to_push >= min_start_samples);
        assert!(
            samples_to_push < target_samples,
            "expected min_start_samples ({samples_to_push}) to stay below target_samples ({target_samples})"
        );

        let seed = vec![0.1f32; samples_to_push];
        let pushed = render_queue.push_interleaved(&seed, channels);
        assert_eq!(pushed, frames_to_push);

        let (command_tx, _command_rx) = mpsc::channel::<DecoderCommand>();
        let (transfer_tx, _transfer_rx) = mpsc::channel();
        engine.streaming = Some(StreamingPlayback {
            buffer,
            render_queue,
            shutdown_tx: StreamingShutdownTx::new(command_tx.clone(), transfer_tx),
            command_tx,
            error: Arc::new(Mutex::new(None)),
        });

        engine.playback_state = PlaybackState::Buffering;
        engine.desired_playback_state = PlaybackState::Playing;
        engine.buffering_started_at = Some(Instant::now() - Duration::from_secs(1));
        engine.buffering_last_progress_at = engine.buffering_started_at;
        engine.buffering_last_samples = 0;
        // Avoid accidental recovery mode from global underrun counters in other tests.
        engine.last_observed_underrun_events = crate::audio::input::streaming_underrun_stats().0;
        engine.underrun_recovery_until = None;
        engine.shared_timeline_stress_until = None;

        let ticked = engine.tick();
        assert!(ticked);
        assert!(matches!(engine.playback_state, PlaybackState::Playing));
        assert!(sink.play_calls.load(Ordering::Relaxed) > 0);
        assert!(!matches!(engine.playback_state, PlaybackState::Error));
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

    #[test]
    fn seek_in_memory_path_does_not_recreate_sink() {
        let backend: Arc<dyn AudioOutputBackend> = Arc::new(FailBackend);
        let mut engine = NativeAudioEngine::new_with_backend(backend);

        // Use a stable decoded buffer path so we don't depend on file IO for this regression test.
        engine.current_track = Some(PathBuf::from("dummy.wav"));
        engine.decoded_samples = Some(Arc::new(vec![0.0f32; 48_000]));
        engine.decoded_channels = 2;
        engine.decoded_sample_rate = 48_000;
        engine.playback_state = PlaybackState::Playing;
        engine.desired_playback_state = PlaybackState::Playing;
        engine.playback_started_at = Some(Instant::now());

        let old_sink = Arc::new(CallSink::default());
        engine.sink = Some(old_sink.clone());

        // Provide a live mixer receiver so seek can switch sources without touching create_sink.
        let initial_source = Box::new(SharedSamplesSource::new(
            engine.decoded_samples.clone().expect("decoded samples"),
            engine.decoded_channels,
            engine.decoded_sample_rate,
            0,
        )) as crate::audio::output::BoxedSource;
        let (controller, _mixer_source) = PlaybackMixerSource::new(initial_source, 2, 48_000);
        engine.mixer = Some(controller);

        // create_sink always fails for this backend; seek must still succeed via the in-memory path.
        engine.seek(0.25).expect("seek should succeed");
        assert_eq!(old_sink.pause_calls.load(Ordering::Acquire), 0);
        assert!(old_sink.flush_calls.load(Ordering::Acquire) >= 1);
        assert!(old_sink.play_calls.load(Ordering::Acquire) >= 1);
    }

    #[derive(Default)]
    struct CallSink {
        play_calls: AtomicUsize,
        pause_calls: AtomicUsize,
        flush_calls: AtomicUsize,
        sources: Mutex<Vec<crate::audio::output::BoxedSource>>,
    }

    impl AudioSink for CallSink {
        fn append(&self, source: crate::audio::output::BoxedSource) {
            if let Ok(mut guard) = self.sources.lock() {
                guard.push(source);
            }
        }

        fn play(&self) {
            self.play_calls.fetch_add(1, Ordering::Relaxed);
        }

        fn pause(&self) {
            self.pause_calls.fetch_add(1, Ordering::Relaxed);
        }

        fn flush(&self) {
            self.flush_calls.fetch_add(1, Ordering::Relaxed);
        }

        fn stop(&self) {
            if let Ok(mut guard) = self.sources.lock() {
                guard.clear();
            }
        }

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

        fn set_transport_mode(&self, _mode: NativeAudioTransportMode) {}
    }

    struct TransportModeBackend {
        id: &'static str,
        sink: Arc<CallSink>,
        transport_mode_calls: Arc<AtomicUsize>,
    }

    impl TransportModeBackend {
        fn new(id: &'static str) -> Self {
            Self {
                id,
                sink: Arc::new(CallSink::default()),
                transport_mode_calls: Arc::new(AtomicUsize::new(0)),
            }
        }
    }

    impl AudioOutputBackend for TransportModeBackend {
        fn id(&self) -> &'static str {
            self.id
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
            Ok((self.sink.clone(), OutputStreamInfo::default()))
        }

        fn set_transport_mode(&self, _mode: NativeAudioTransportMode) {
            self.transport_mode_calls.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn make_finished_streaming_playback(
        capacity_samples: usize,
        channels: usize,
    ) -> StreamingPlayback {
        let buffer = crate::audio::buffer::AudioRingBuffer::new(capacity_samples);
        let render_queue = crate::audio::buffer::AudioRingBuffer::new(
            (capacity_samples / 4).clamp(16_384, 262_144),
        );
        let samples = vec![0.1f32; channels * 8];
        render_queue.push_interleaved(&samples, channels);
        buffer.mark_finished();
        render_queue.mark_finished();

        let (command_tx, _command_rx) = mpsc::channel::<DecoderCommand>();
        let (transfer_tx, _transfer_rx) = std::sync::mpsc::channel();
        StreamingPlayback {
            buffer,
            render_queue,
            shutdown_tx: StreamingShutdownTx::new(command_tx.clone(), transfer_tx),
            command_tx,
            error: Arc::new(Mutex::new(None)),
        }
    }

    fn write_wav_i16_stereo(path: &Path, sample_rate: u32, frames: usize) {
        let channels = 2u16;
        let bits_per_sample = 16u16;
        let block_align = channels * (bits_per_sample / 8);
        let byte_rate = sample_rate * block_align as u32;
        let data_bytes = frames as u32 * block_align as u32;
        let riff_chunk_size = 36u32 + data_bytes;

        let mut file = File::create(path).expect("create wav");
        file.write_all(b"RIFF").expect("riff");
        file.write_all(&riff_chunk_size.to_le_bytes())
            .expect("riff size");
        file.write_all(b"WAVE").expect("wave");
        file.write_all(b"fmt ").expect("fmt");
        file.write_all(&16u32.to_le_bytes()).expect("fmt size");
        file.write_all(&1u16.to_le_bytes()).expect("pcm");
        file.write_all(&channels.to_le_bytes()).expect("channels");
        file.write_all(&sample_rate.to_le_bytes())
            .expect("sample rate");
        file.write_all(&byte_rate.to_le_bytes()).expect("byte rate");
        file.write_all(&block_align.to_le_bytes())
            .expect("block align");
        file.write_all(&bits_per_sample.to_le_bytes())
            .expect("bits");
        file.write_all(b"data").expect("data");
        file.write_all(&data_bytes.to_le_bytes())
            .expect("data size");

        for frame in 0..frames {
            let phase = frame as f32 / sample_rate.max(1) as f32;
            let sample = (phase * 440.0 * std::f32::consts::TAU).sin();
            let pcm = (sample * i16::MAX as f32 * 0.45) as i16;
            file.write_all(&pcm.to_le_bytes()).expect("left");
            file.write_all(&pcm.to_le_bytes()).expect("right");
        }
    }

    #[test]
    fn prebuffer_defaults_follow_output_backend_profiles() {
        let sample_rate = 48_000u32;
        let channels = 2usize;
        let capacity = sample_rate as usize * channels * 30;
        let duration_seconds = 360.0;

        let (shared_start_samples, _) = streaming_prebuffer_target_samples(
            "rodio-cpal",
            sample_rate,
            channels,
            capacity,
            duration_seconds,
            StreamingPrebufferKind::StartOrSeek,
            None,
        );
        let (shared_cross_samples, _) = streaming_prebuffer_target_samples(
            "rodio-cpal",
            sample_rate,
            channels,
            capacity,
            duration_seconds,
            StreamingPrebufferKind::Crossfade,
            None,
        );
        let (exclusive_start_samples, _) = streaming_prebuffer_target_samples(
            "wasapi-exclusive",
            sample_rate,
            channels,
            capacity,
            duration_seconds,
            StreamingPrebufferKind::StartOrSeek,
            None,
        );
        let (exclusive_cross_samples, _) = streaming_prebuffer_target_samples(
            "wasapi-exclusive",
            sample_rate,
            channels,
            capacity,
            duration_seconds,
            StreamingPrebufferKind::Crossfade,
            None,
        );

        let samples_per_second = sample_rate as usize * channels;
        assert_eq!(shared_start_samples, samples_per_second * 35 / 100);
        assert_eq!(shared_cross_samples, samples_per_second / 2);
        assert_eq!(exclusive_start_samples, samples_per_second * 30 / 100);
        assert_eq!(exclusive_cross_samples, samples_per_second);
    }

    #[test]
    fn default_decode_mode_is_streaming() {
        let engine = NativeAudioEngine::new();
        assert_eq!(engine.streaming_buffer_settings_payload().decode_mode, "streaming");
        assert_eq!(engine.current_decode_mode(), AudioInputDecodeMode::Streaming);
    }

    #[test]
    fn streaming_min_start_bounds_allow_fast_click_to_play() {
        let (shared_cap, shared_floor) = streaming_min_start_bounds("rodio-cpal", false);
        let (exclusive_cap, exclusive_floor) = streaming_min_start_bounds("wasapi-exclusive", false);

        assert!(
            shared_cap <= 0.50,
            "shared backend min-start cap too high: cap={shared_cap} floor={shared_floor}"
        );
        assert!(
            exclusive_cap <= 0.50,
            "exclusive backend min-start cap too high: cap={exclusive_cap} floor={exclusive_floor}"
        );

        let (shared_recovery_cap, _) = streaming_min_start_bounds("rodio-cpal", true);
        let (exclusive_recovery_cap, _) = streaming_min_start_bounds("wasapi-exclusive", true);
        assert!(
            shared_recovery_cap >= shared_cap,
            "recovery cap should not be lower than normal cap"
        );
        assert!(
            exclusive_recovery_cap >= exclusive_cap,
            "recovery cap should not be lower than normal cap"
        );
    }

    #[test]
    fn decode_mode_and_output_backend_matrix_loads_reliably() {
        let tmp_dir = std::env::temp_dir();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let path = tmp_dir.join(format!("pmp_decode_output_matrix_{nonce}.wav"));
        write_wav_i16_stereo(&path, 48_000, 48_000);

        for decode_mode in ["streaming", "full-track"] {
            let initial_backend: Arc<dyn AudioOutputBackend> =
                Arc::new(TransportModeBackend::new("rodio-cpal"));
            let mut engine = NativeAudioEngine::new_with_backend(initial_backend);

            engine
                .set_preferred_input_id(Some(super::SYMPHONIA_INPUT_ID.to_string()))
                .expect("set input");
            engine.set_streaming_buffer_settings(Some(0.2), Some(0.1), Some(decode_mode));

            engine.load(path.clone()).expect("load on initial backend");
            assert_eq!(
                engine.active_input_id.as_deref(),
                Some(super::SYMPHONIA_INPUT_ID)
            );
            if decode_mode == "full-track" {
                assert!(
                    engine.streaming.is_none(),
                    "full-track should not use streaming pipeline"
                );
                assert!(
                    engine.decoded_samples.is_some(),
                    "decoded buffer should be present for full-track"
                );
            } else {
                assert!(
                    engine.streaming.is_some(),
                    "expected streaming for {decode_mode}"
                );
                assert!(
                    engine.decoded_samples.is_none(),
                    "decoded buffer should be empty for {decode_mode}"
                );
            }
            assert!(matches!(engine.playback_state, PlaybackState::Paused));

            let switched_backend: Arc<dyn AudioOutputBackend> =
                Arc::new(TransportModeBackend::new("wasapi-exclusive"));
            engine
                .switch_output_backend(switched_backend)
                .expect("switch backend");

            assert_eq!(engine.output_backend.id(), "wasapi-exclusive");
            assert_eq!(
                engine.active_input_id.as_deref(),
                Some(super::SYMPHONIA_INPUT_ID)
            );
            if decode_mode == "full-track" {
                assert!(
                    engine.decoded_samples.is_some(),
                    "switch should preserve decoded buffer"
                );
                assert!(
                    engine.streaming.is_none(),
                    "switch should keep full-track decode mode"
                );
            } else {
                assert!(
                    engine.streaming.is_some(),
                    "switch should preserve streaming pipeline"
                );
                assert!(
                    engine.decoded_samples.is_none(),
                    "switch should keep streaming mode"
                );
            }

            let expected_mode = if decode_mode == "full-track" {
                AudioInputDecodeMode::FullTrack
            } else {
                AudioInputDecodeMode::Streaming
            };
            assert_eq!(engine.current_decode_mode(), expected_mode);
            engine.shutdown_streaming();
        }

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn transport_exact_policy_defaults_to_robust_int32_container() {
        let engine = NativeAudioEngine::new();
        let policy = engine.engine_policy_payload();

        assert!(matches!(
            policy.transport_mode,
            NativeAudioTransportMode::Robust
        ));
        assert!(policy.transport_exact_int32_container);
        assert_eq!(policy.hq_src_stopband_db, 140);
        assert!(matches!(
            policy.hq_src_phase_mode,
            NativeAudioHqSrcPhaseMode::Linear
        ));
    }

    #[test]
    fn transport_exact_policy_patch_updates_mode_and_phase() {
        let mut engine = NativeAudioEngine::new();
        let patch = NativeAudioEnginePolicyPatch {
            transport_mode: Some(NativeAudioTransportMode::TransportExact),
            hq_src_enabled: Some(true),
            hq_src_phase_mode: Some(NativeAudioHqSrcPhaseMode::Linear),
            src_mode: Some(NativeAudioSrcMode::TargetRate),
            src_backend: Some(NativeAudioSrcBackend::LinearSimd),
            src_target_sample_rate: Some(192_000),
            output_quantization_mode: Some(NativeAudioOutputQuantizationMode::Tpdf),
        };

        let (next, _) = engine.apply_engine_policy_patch(patch);
        assert!(matches!(
            next.transport_mode,
            NativeAudioTransportMode::TransportExact
        ));
        assert!(next.hq_src_enabled);
        assert!(matches!(
            next.hq_src_phase_mode,
            NativeAudioHqSrcPhaseMode::Linear
        ));
        assert!(matches!(next.src_mode, NativeAudioSrcMode::TargetRate));
        assert!(matches!(
            next.src_backend,
            NativeAudioSrcBackend::LinearSimd
        ));
        assert_eq!(next.src_target_sample_rate, Some(192_000));
        assert!(matches!(
            next.output_quantization_mode,
            NativeAudioOutputQuantizationMode::Tpdf
        ));
    }

    #[test]
    fn seek_sequence_rejects_stale_commands() {
        let mut engine = NativeAudioEngine::new();

        assert!(engine.should_accept_seek_command(Some(1), Some(1)));
        assert!(engine.should_accept_seek_command(Some(2), Some(2)));
        assert!(!engine.should_accept_seek_command(Some(1), Some(2)));
        assert!(engine.should_accept_seek_command(Some(3), Some(3)));
        assert!(!engine.should_accept_seek_command(Some(4), Some(5)));

        // Legacy callers without sequence remain compatible.
        assert!(engine.should_accept_seek_command(None, None));
    }

    #[test]
    fn seek_rebuilds_stream_when_decoder_channel_is_disconnected() {
        let backend: Arc<dyn AudioOutputBackend> =
            Arc::new(TransportModeBackend::new("rodio-cpal"));
        let mut engine = NativeAudioEngine::new_with_backend(backend);

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_nanos();
        let tmp_dir = std::env::temp_dir();
        let path = tmp_dir.join(format!("pmp_seek_rebuild_{nonce}.wav"));
        write_wav_i16_stereo(&path, 48_000, 48_000);

        let buffer = crate::audio::buffer::AudioRingBuffer::new(48_000);
        let render_queue = crate::audio::buffer::AudioRingBuffer::new(24_000);
        buffer.mark_finished();
        render_queue.mark_finished();

        let (command_tx, command_rx) = mpsc::channel::<DecoderCommand>();
        drop(command_rx);
        let (transfer_tx, _transfer_rx) = mpsc::channel();

        engine.current_track = Some(path.clone());
        engine.streaming = Some(StreamingPlayback {
            buffer,
            render_queue,
            shutdown_tx: StreamingShutdownTx::new(command_tx.clone(), transfer_tx),
            command_tx,
            error: Arc::new(Mutex::new(None)),
        });
        engine.desired_playback_state = PlaybackState::Playing;

        let seek_result = engine.seek(0.8);
        assert!(
            seek_result.is_ok(),
            "seek should recover from disconnected channel: {seek_result:?}"
        );
        assert!(engine.current_position >= 0.79 && engine.current_position <= 0.81);
        assert!(
            matches!(
                engine.playback_state,
                PlaybackState::Buffering | PlaybackState::Playing | PlaybackState::Paused
            ),
            "recovered seek should continue transport"
        );

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn seek_recovery_holds_across_decode_and_transport_modes() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_nanos();
        let tmp_dir = std::env::temp_dir();
        let path = tmp_dir.join(format!("pmp_seek_mode_matrix_{nonce}.wav"));
        write_wav_i16_stereo(&path, 48_000, 96_000);

        for decode_mode in ["streaming", "full-track"] {
            for transport_mode in [
                NativeAudioTransportMode::Robust,
                NativeAudioTransportMode::TransportExact,
            ] {
                let backend: Arc<dyn AudioOutputBackend> =
                    Arc::new(TransportModeBackend::new("rodio-cpal"));
                let mut engine = NativeAudioEngine::new_with_backend(backend);

                engine
                    .set_preferred_input_id(Some(super::SYMPHONIA_INPUT_ID.to_string()))
                    .expect("set input");
                engine.set_streaming_buffer_settings(Some(0.2), Some(0.1), Some(decode_mode));
                let _ = engine.apply_engine_policy_patch(NativeAudioEnginePolicyPatch {
                    transport_mode: Some(transport_mode),
                    ..Default::default()
                });

                engine
                    .load(path.clone())
                    .expect("load track for mode matrix");
                if decode_mode == "streaming" {
                    assert!(
                        engine.streaming.is_some(),
                        "expected streaming pipeline for decode_mode={decode_mode}"
                    );

                    let (command_tx, command_rx) = mpsc::channel::<DecoderCommand>();
                    drop(command_rx);
                    let (transfer_tx, _transfer_rx) = mpsc::channel();
                    {
                        let streaming = engine.streaming.as_mut().expect("streaming pipeline");
                        streaming.command_tx = command_tx.clone();
                        streaming.shutdown_tx =
                            StreamingShutdownTx::new(command_tx.clone(), transfer_tx);
                    }
                } else {
                    assert!(
                        engine.decoded_samples.is_some(),
                        "expected decoded buffer for decode_mode={decode_mode}"
                    );
                    assert!(
                        engine.streaming.is_none(),
                        "decoded mode should not keep streaming pipeline"
                    );
                }

                engine.desired_playback_state = PlaybackState::Playing;

                for target in [1.95, 0.05, 1.90, 0.10] {
                    let result = engine.seek(target);
                    assert!(
                        result.is_ok(),
                        "seek should recover in decode_mode={decode_mode}, transport_mode={transport_mode:?}, target={target}: {result:?}"
                    );
                    assert!(
                        (engine.current_position - target).abs() <= 0.1,
                        "seek target drift too large in decode_mode={decode_mode}, transport_mode={transport_mode:?}, target={target}, actual={}",
                        engine.current_position
                    );
                    assert!(
                        !matches!(engine.playback_state, PlaybackState::Error),
                        "seek should not push playback into error in decode_mode={decode_mode}, transport_mode={transport_mode:?}"
                    );
                }
            }
        }

        let _ = std::fs::remove_file(path);
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
            .render_queue
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

    #[test]
    fn switch_output_backend_restores_transport_mode_after_failed_switch() {
        let old_backend = Arc::new(TransportModeBackend::new("old"));
        let mut engine = NativeAudioEngine::new_with_backend(old_backend.clone());

        engine.output_backend = old_backend.clone();
        engine.current_track = Some(PathBuf::from("dummy.wav"));
        engine.decoded_samples = Some(Arc::new(vec![0.0f32; 32]));
        engine.decoded_channels = 2;
        engine.decoded_sample_rate = 48_000;
        engine.playback_state = PlaybackState::Paused;

        let fail_backend: Arc<dyn AudioOutputBackend> = Arc::new(FailBackend);

        let err = engine
            .switch_output_backend(fail_backend)
            .expect_err("switch should fail and rollback");
        assert_eq!(err, "create_sink failed");
        assert_eq!(engine.output_backend.id(), "old");
        assert!(old_backend.transport_mode_calls.load(Ordering::Relaxed) >= 1);
    }

    #[test]
    fn shared_timeline_stress_window_gets_extended_by_diagnostics() {
        let backend: Arc<dyn AudioOutputBackend> = Arc::new(StaticBackend("wasapi"));
        let mut engine = NativeAudioEngine::new_with_backend(backend);

        for index in 0..32 {
            let kind = match index % 3 {
                0 => "shared.transfer.render_low_watermark",
                1 => "shared.transfer.decode_low_watermark",
                _ => "shared.render_ahead.low_watermark",
            };
            crate::audio::diagnostics::record_event(kind, 128, 512);
        }

        engine.update_shared_timeline_stress_window();
        assert!(engine.shared_timeline_stress_until.is_some());
    }
}
