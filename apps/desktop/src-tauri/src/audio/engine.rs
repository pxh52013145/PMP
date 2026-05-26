use once_cell::sync::Lazy;
use serde::Serialize;
use std::{
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use crate::audio::buffer::AudioRingBuffer;
use crate::audio::buffer_policy::{
    runtime_rebuffer_threshold_samples, streaming_min_start_bounds,
    streaming_prebuffer_default_seconds, streaming_transfer_watermarks,
};
use crate::audio::events::NativeAudioStatePayload;
use crate::audio::input::{
    open_rodio_source_at, resolve_audio_input_target_sample_rate, AudioInputDecodeMode,
    AudioInputRegistry, AudioInputSrcPolicy, DecoderCommand, SharedSamplesSource,
    StreamingPlayback, StreamingSamplesSource, StreamingShutdownTx, REMOTE_STREAM_INPUT_ID,
    SACD_INPUT_ID, SYMPHONIA_INPUT_ID,
};
use crate::audio::mixer::{coerce_source_format, PlaybackMixerController, PlaybackMixerSource};
#[cfg(all(target_os = "windows", feature = "asio-sdk"))]
use crate::audio::output::ASIO_BACKEND_ID;
#[cfg(target_os = "windows")]
use crate::audio::output::WASAPI_EXCLUSIVE_BACKEND_ID;
use crate::audio::output::{
    default_backend, shared_render_ahead_ready_snapshot, wait_for_shared_render_ahead_ready,
    AudioOutputBackend, AudioOutputError, AudioSink, OutputStreamInfo,
};
use crate::audio::pipeline::{boxed_with_dsp, DspNodeConfig, DspRuntime, SpectrumTap};
use crate::audio::policy::{
    NativeAudioEnginePolicyPatch, NativeAudioEnginePolicyPayload, NativeAudioHqSrcPhaseMode,
    NativeAudioOutputQuantizationMode, NativeAudioSrcBackend, NativeAudioSrcMode,
    NativeAudioStabilityProfile, NativeAudioTransportMode,
};
use crate::audio::realtime_scheduler::{RealtimePressureProfile, SCHEDULER};
use crate::audio::stability_controller::AudioStabilityController;

const SHARED_TIMELINE_STRESS_WINDOW: Duration = Duration::from_secs(12);
const SHARED_TIMELINE_STRESS_EXTENSION: Duration = Duration::from_secs(16);
const SHARED_TIMELINE_LOW_WATERMARK_TRIGGER: usize = 20;
const SHARED_TIMELINE_STRESS_RESET_GRACE_MS: u64 = 1_500;
const STOP_RELEASE_BUFFER_THRESHOLD_DEFAULT_MIB: usize = 16;
const STOP_RELEASE_BUFFER_THRESHOLD_MIN_MIB: usize = 16;
const STOP_RELEASE_BUFFER_THRESHOLD_MAX_MIB: usize = 4096;
const DEFAULT_OUTPUT_ROUTE_FOLLOW_INTERVAL: Duration = Duration::from_millis(1_000);
const RETIRE_INLINE_RELEASE_THRESHOLD_DEFAULT_MIB: usize = 4;
const RETIRE_INLINE_RELEASE_THRESHOLD_MIN_MIB: usize = 0;
const RETIRE_INLINE_RELEASE_THRESHOLD_MAX_MIB: usize = 1024;
const RETIRE_INLINE_PENDING_THRESHOLD_DEFAULT: u64 = 0;
const RETIRE_INLINE_PENDING_THRESHOLD_MIN: u64 = 0;
const RETIRE_INLINE_PENDING_THRESHOLD_MAX: u64 = 64;
const EMPTY_QUEUE_RETIRE_DRAIN_TIMEOUT_MS_DEFAULT: u64 = 240;
const EMPTY_QUEUE_RETIRE_DRAIN_TIMEOUT_MS_MIN: u64 = 0;
const EMPTY_QUEUE_RETIRE_DRAIN_TIMEOUT_MS_MAX: u64 = 1_500;

pub(crate) static ENGINE: Lazy<Mutex<NativeAudioEngine>> =
    Lazy::new(|| Mutex::new(NativeAudioEngine::new()));

static STOP_RELEASE_BUFFER_THRESHOLD_BYTES: Lazy<usize> = Lazy::new(|| {
    let threshold_mib = std::env::var("PMP_AUDIO_STOP_RELEASE_THRESHOLD_MIB")
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(STOP_RELEASE_BUFFER_THRESHOLD_DEFAULT_MIB)
        .clamp(
            STOP_RELEASE_BUFFER_THRESHOLD_MIN_MIB,
            STOP_RELEASE_BUFFER_THRESHOLD_MAX_MIB,
        );

    threshold_mib
        .saturating_mul(1024)
        .saturating_mul(1024)
        .max(1)
});

static FORCE_RELEASE_ON_STOP: Lazy<bool> = Lazy::new(|| {
    std::env::var("PMP_AUDIO_FORCE_RELEASE_ON_STOP")
        .ok()
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            !matches!(normalized.as_str(), "0" | "false" | "no" | "off")
        })
        .unwrap_or(true)
});

static NATIVE_AUDIO_INFO_LOG_ENABLED: Lazy<bool> = Lazy::new(|| {
    std::env::var("PMP_AUDIO_INFO_LOG")
        .ok()
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            matches!(normalized.as_str(), "1" | "true" | "yes" | "on")
        })
        .unwrap_or(false)
});

static RETIRE_BACKPRESSURE_PENDING_THRESHOLD: Lazy<u64> =
    Lazy::new(|| parse_env_u64("PMP_AUDIO_RETIRE_BACKPRESSURE_PENDING_THRESHOLD", 3, 0, 64));

static RETIRE_BACKPRESSURE_TARGET_PENDING: Lazy<u64> =
    Lazy::new(|| parse_env_u64("PMP_AUDIO_RETIRE_BACKPRESSURE_TARGET_PENDING", 1, 0, 32));

static RETIRE_BACKPRESSURE_WAIT_TIMEOUT_MS: Lazy<u64> =
    Lazy::new(|| parse_env_u64("PMP_AUDIO_RETIRE_BACKPRESSURE_WAIT_TIMEOUT_MS", 18, 0, 250));

static RETIRE_RELOAD_WAIT_BUFFER_THRESHOLD_BYTES: Lazy<usize> = Lazy::new(|| {
    let threshold_mib =
        parse_env_u64("PMP_AUDIO_RETIRE_RELOAD_WAIT_THRESHOLD_MIB", 8, 0, 1024) as usize;
    threshold_mib.saturating_mul(1024).saturating_mul(1024)
});

static RETIRE_RELOAD_WAIT_TARGET_PENDING: Lazy<u64> =
    Lazy::new(|| parse_env_u64("PMP_AUDIO_RETIRE_RELOAD_WAIT_TARGET_PENDING", 0, 0, 8));

static RETIRE_RELOAD_WAIT_TIMEOUT_MS: Lazy<u64> =
    Lazy::new(|| parse_env_u64("PMP_AUDIO_RETIRE_RELOAD_WAIT_TIMEOUT_MS", 120, 0, 500));

static RETIRE_INLINE_RELEASE_THRESHOLD_BYTES: Lazy<usize> = Lazy::new(|| {
    let threshold_mib = parse_env_u64(
        "PMP_AUDIO_RETIRE_INLINE_RELEASE_THRESHOLD_MIB",
        RETIRE_INLINE_RELEASE_THRESHOLD_DEFAULT_MIB as u64,
        RETIRE_INLINE_RELEASE_THRESHOLD_MIN_MIB as u64,
        RETIRE_INLINE_RELEASE_THRESHOLD_MAX_MIB as u64,
    ) as usize;

    threshold_mib.saturating_mul(1024).saturating_mul(1024)
});

static RETIRE_INLINE_PENDING_THRESHOLD: Lazy<u64> = Lazy::new(|| {
    parse_env_u64(
        "PMP_AUDIO_RETIRE_INLINE_PENDING_THRESHOLD",
        RETIRE_INLINE_PENDING_THRESHOLD_DEFAULT,
        RETIRE_INLINE_PENDING_THRESHOLD_MIN,
        RETIRE_INLINE_PENDING_THRESHOLD_MAX,
    )
});

static EMPTY_QUEUE_RETIRE_DRAIN_TIMEOUT_MS: Lazy<u64> = Lazy::new(|| {
    parse_env_u64(
        "PMP_AUDIO_EMPTY_QUEUE_RETIRE_DRAIN_TIMEOUT_MS",
        EMPTY_QUEUE_RETIRE_DRAIN_TIMEOUT_MS_DEFAULT,
        EMPTY_QUEUE_RETIRE_DRAIN_TIMEOUT_MS_MIN,
        EMPTY_QUEUE_RETIRE_DRAIN_TIMEOUT_MS_MAX,
    )
});

mod policy_impl;
mod sink_rebuild_impl;
mod state_payload_impl;

fn info_log(message: impl AsRef<str>) {
    if *NATIVE_AUDIO_INFO_LOG_ENABLED {
        let mut stderr = std::io::stderr();
        let _ = writeln!(stderr, "{}", message.as_ref());
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

fn output_error_looks_like_device_disconnect(err: &AudioOutputError) -> bool {
    let code_upper = err.code.to_ascii_uppercase();
    if code_upper.contains("DEVICE_NOT_FOUND")
        || code_upper.contains("DEVICE_INVALIDATED")
        || code_upper.contains("NO_DEVICE_SELECTED")
    {
        return true;
    }

    let message = err.message.to_ascii_lowercase();
    message.contains("no longer available")
        || message.contains("unplugged")
        || message.contains("device invalidated")
        || message.contains("audclnt_e_device_invalidated")
        || message.contains("device not found")
}

fn output_route_matches(expected: &OutputStreamInfo, actual: &OutputStreamInfo) -> bool {
    if let (Some(expected_id), Some(actual_id)) =
        (expected.device_id.as_deref(), actual.device_id.as_deref())
    {
        return expected_id == actual_id;
    }

    if let (Some(expected_name), Some(actual_name)) = (
        expected.device_name.as_deref(),
        actual.device_name.as_deref(),
    ) {
        return expected_name == actual_name;
    }

    false
}

fn clamp_min_start_samples_to_reachable(
    min_start_samples: usize,
    target_samples: usize,
    capacity_samples: usize,
    channels: usize,
    profile: RealtimePressureProfile,
) -> usize {
    let channels = channels.max(1);
    let floor_samples = channels.saturating_mul(32).max(1);
    let (_, high_watermark) =
        streaming_transfer_watermarks(capacity_samples.max(1), channels, profile);
    let reachable_ceiling = high_watermark
        .max(floor_samples)
        .min(capacity_samples.max(1));

    min_start_samples
        .max(1)
        .min(target_samples.max(1))
        .min(reachable_ceiling)
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
        AudioInputDecodeMode::FullTrack | AudioInputDecodeMode::StreamingFullTrack => "full-track",
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum InteractivePrebufferProfile {
    Fast,
    Balanced,
    Stable,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct InteractivePrebufferWaitPolicy {
    start_seek_cap_seconds: f64,
    crossfade_cap_seconds: f64,
    start_seek_timeout_ms: u64,
    crossfade_timeout_ms: u64,
}

fn interactive_prebuffer_profile_id(profile: InteractivePrebufferProfile) -> &'static str {
    match profile {
        InteractivePrebufferProfile::Fast => "fast",
        InteractivePrebufferProfile::Balanced => "balanced",
        InteractivePrebufferProfile::Stable => "stable",
    }
}

fn parse_interactive_prebuffer_profile_id(value: &str) -> Option<InteractivePrebufferProfile> {
    match value.trim().to_ascii_lowercase().as_str() {
        "fast" => Some(InteractivePrebufferProfile::Fast),
        "balanced" => Some(InteractivePrebufferProfile::Balanced),
        "stable" => Some(InteractivePrebufferProfile::Stable),
        _ => None,
    }
}

fn parse_env_f64(name: &str, default_value: f64, min: f64, max: f64) -> f64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<f64>().ok())
        .filter(|value| value.is_finite())
        .unwrap_or(default_value)
        .clamp(min, max)
}

fn parse_env_u64(name: &str, default_value: u64, min: u64, max: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(default_value)
        .clamp(min, max)
}

fn parse_interactive_prebuffer_profile() -> InteractivePrebufferProfile {
    std::env::var("PMP_AUDIO_STREAM_INTERACTIVE_PROFILE")
        .ok()
        .and_then(|value| parse_interactive_prebuffer_profile_id(&value))
        .unwrap_or(InteractivePrebufferProfile::Balanced)
}

impl InteractivePrebufferWaitPolicy {
    fn from_profile(profile: InteractivePrebufferProfile) -> Self {
        let (
            start_seek_cap_seconds,
            crossfade_cap_seconds,
            start_seek_timeout_ms,
            crossfade_timeout_ms,
        ) = match profile {
            InteractivePrebufferProfile::Fast => (0.24, 0.36, 180, 260),
            InteractivePrebufferProfile::Balanced => (0.30, 0.45, 220, 320),
            InteractivePrebufferProfile::Stable => (0.42, 0.65, 320, 450),
        };

        Self {
            start_seek_cap_seconds,
            crossfade_cap_seconds,
            start_seek_timeout_ms,
            crossfade_timeout_ms,
        }
    }

    fn from_env() -> Self {
        let profile = parse_interactive_prebuffer_profile();
        let defaults = Self::from_profile(profile);

        Self {
            start_seek_cap_seconds: parse_env_f64(
                "PMP_AUDIO_STREAM_INTERACTIVE_START_CAP_SECONDS",
                defaults.start_seek_cap_seconds,
                0.10,
                2.00,
            ),
            crossfade_cap_seconds: parse_env_f64(
                "PMP_AUDIO_STREAM_INTERACTIVE_CROSSFADE_CAP_SECONDS",
                defaults.crossfade_cap_seconds,
                0.15,
                3.00,
            ),
            start_seek_timeout_ms: parse_env_u64(
                "PMP_AUDIO_STREAM_INTERACTIVE_START_TIMEOUT_MS",
                defaults.start_seek_timeout_ms,
                80,
                2000,
            ),
            crossfade_timeout_ms: parse_env_u64(
                "PMP_AUDIO_STREAM_INTERACTIVE_CROSSFADE_TIMEOUT_MS",
                defaults.crossfade_timeout_ms,
                120,
                3000,
            ),
        }
    }
}

static INTERACTIVE_PREBUFFER_WAIT_POLICY: Lazy<InteractivePrebufferWaitPolicy> =
    Lazy::new(InteractivePrebufferWaitPolicy::from_env);

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
            streaming_prebuffer_default_seconds(output_backend_id, false),
        ),
        StreamingPrebufferKind::Crossfade => (
            "PMP_AUDIO_STREAM_CROSSFADE_PREBUFFER_SECONDS",
            streaming_prebuffer_default_seconds(output_backend_id, true),
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

pub(crate) fn streaming_prebuffer_interactive_wait(
    output_backend_id: &str,
    sample_rate: u32,
    channels: usize,
    capacity_samples: usize,
    duration_seconds: f64,
    kind: StreamingPrebufferKind,
    override_seconds: Option<f64>,
) -> (usize, Duration) {
    streaming_prebuffer_interactive_wait_with_policy(
        output_backend_id,
        sample_rate,
        channels,
        capacity_samples,
        duration_seconds,
        kind,
        override_seconds,
        *INTERACTIVE_PREBUFFER_WAIT_POLICY,
    )
}

pub(crate) fn streaming_prebuffer_interactive_wait_with_policy(
    output_backend_id: &str,
    sample_rate: u32,
    channels: usize,
    capacity_samples: usize,
    duration_seconds: f64,
    kind: StreamingPrebufferKind,
    override_seconds: Option<f64>,
    wait_policy: InteractivePrebufferWaitPolicy,
) -> (usize, Duration) {
    let (target_samples, timeout) = streaming_prebuffer_target_samples(
        output_backend_id,
        sample_rate,
        channels,
        capacity_samples,
        duration_seconds,
        kind,
        override_seconds,
    );

    if target_samples == 0 {
        return (0, Duration::from_millis(0));
    }

    let channels = channels.max(1);
    let sample_rate = sample_rate.max(1) as f64;
    let channels_f64 = channels as f64;
    let shared_cap_scale = if is_shared_output_backend(output_backend_id) {
        parse_env_f64(
            "PMP_AUDIO_STREAM_INTERACTIVE_SHARED_CAP_SCALE",
            1.8,
            1.0,
            6.0,
        )
    } else {
        1.0
    };
    let shared_timeout_scale = if is_shared_output_backend(output_backend_id) {
        parse_env_f64(
            "PMP_AUDIO_STREAM_INTERACTIVE_SHARED_TIMEOUT_SCALE",
            1.6,
            1.0,
            6.0,
        )
    } else {
        1.0
    };
    let cap_seconds = match kind {
        StreamingPrebufferKind::StartOrSeek => {
            wait_policy.start_seek_cap_seconds * shared_cap_scale
        }
        StreamingPrebufferKind::Crossfade => wait_policy.crossfade_cap_seconds * shared_cap_scale,
    };
    let mut cap_samples = ((sample_rate * channels_f64 * cap_seconds).ceil() as usize)
        .clamp(channels * 32, capacity_samples.max(1));

    if duration_seconds.is_finite() && duration_seconds > 0.0 {
        let max_samples_by_duration =
            (sample_rate * duration_seconds * channels_f64).ceil() as usize;
        cap_samples = cap_samples.min(max_samples_by_duration.max(1));
    }

    let capped_target = target_samples.min(cap_samples.max(1));
    let timeout_cap = match kind {
        StreamingPrebufferKind::StartOrSeek => Duration::from_millis(
            ((wait_policy.start_seek_timeout_ms as f64) * shared_timeout_scale)
                .round()
                .clamp(80.0, 4_000.0) as u64,
        ),
        StreamingPrebufferKind::Crossfade => Duration::from_millis(
            ((wait_policy.crossfade_timeout_ms as f64) * shared_timeout_scale)
                .round()
                .clamp(120.0, 6_000.0) as u64,
        ),
    };

    (capped_target, timeout.min(timeout_cap))
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
    pub interactive_profile: String,
}

#[derive(Clone)]
pub(crate) struct StreamingPrebufferWaitRequest {
    pub render_queue: AudioRingBuffer,
    pub target_samples: usize,
    pub timeout: Duration,
}

struct PlayPrebufferPlan {
    decode_reservoir: AudioRingBuffer,
    render_queue: AudioRingBuffer,
    min_start_samples: usize,
    wait_timeout: Duration,
    available: usize,
    finished: bool,
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
    buffering_resume_samples: usize,
    underrun_recovery_until: Option<Instant>,
    shared_timeline_stress_until: Option<Instant>,
    shared_timeline_stress_ignore_before_ms: u64,
    last_observed_underrun_events: u64,
    decoded_samples: Option<Arc<Vec<f32>>>,
    decoded_channels: u16,
    source_sample_rate: u32,
    decoded_sample_rate: u32,
    decoded_bit_depth: Option<u32>,
    output_sample_rate: Option<u32>,
    device_id: Option<String>,
    device_name: Option<String>,
    last_default_output_route_check_at: Option<Instant>,
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
    streaming_interactive_profile: InteractivePrebufferProfile,
    transport_mode: NativeAudioTransportMode,
    stability_profile: NativeAudioStabilityProfile,
    stability_controller: AudioStabilityController,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RuntimeReleaseMode {
    Deferred,
    Inline,
}

fn flush_and_stop_sink(sink: &Arc<dyn AudioSink>) {
    sink.flush();
    sink.stop();
}

fn estimated_streaming_playback_bytes(streaming: &StreamingPlayback) -> usize {
    std::mem::size_of::<f32>().saturating_mul(
        streaming
            .buffer
            .capacity_samples()
            .saturating_add(streaming.render_queue.capacity_samples()),
    )
}

fn estimated_decoded_samples_bytes(decoded_samples: &Arc<Vec<f32>>) -> usize {
    decoded_samples
        .len()
        .saturating_mul(std::mem::size_of::<f32>())
}

fn estimated_detached_audio_buffer_bytes(
    streaming: Option<&StreamingPlayback>,
    decoded_samples: Option<&Arc<Vec<f32>>>,
) -> usize {
    streaming
        .map(estimated_streaming_playback_bytes)
        .unwrap_or(0)
        .saturating_add(
            decoded_samples
                .map(estimated_decoded_samples_bytes)
                .unwrap_or(0),
        )
}

fn resolve_runtime_release_mode_with_thresholds(
    detached_audio_buffer_bytes: usize,
    pending_tasks: u64,
    inline_release_threshold_bytes: usize,
    pending_threshold: u64,
) -> RuntimeReleaseMode {
    let threshold_hit = inline_release_threshold_bytes > 0
        && detached_audio_buffer_bytes >= inline_release_threshold_bytes;
    let pending_hit = pending_tasks > pending_threshold;

    if threshold_hit || pending_hit {
        RuntimeReleaseMode::Inline
    } else {
        RuntimeReleaseMode::Deferred
    }
}

fn resolve_detached_runtime_release_mode(detached_audio_buffer_bytes: usize) -> RuntimeReleaseMode {
    resolve_runtime_release_mode_with_thresholds(
        detached_audio_buffer_bytes,
        crate::audio::retire_plane::pending_tasks(),
        *RETIRE_INLINE_RELEASE_THRESHOLD_BYTES,
        *RETIRE_INLINE_PENDING_THRESHOLD,
    )
}

fn release_sink_handle(
    task_name: &'static str,
    sink: Arc<dyn AudioSink>,
    mode: RuntimeReleaseMode,
) {
    flush_and_stop_sink(&sink);
    match mode {
        RuntimeReleaseMode::Deferred => crate::audio::retire_plane::retire_drop(task_name, sink),
        RuntimeReleaseMode::Inline => drop(sink),
    }
}

impl PreparedLoad {
    pub(crate) fn abort(self) {
        let release_mode =
            resolve_detached_runtime_release_mode(estimated_detached_audio_buffer_bytes(
                self.streaming.as_ref(),
                self.decoded_samples.as_ref(),
            ));
        release_sink_handle("engine.prepared_load.sink", self.sink, release_mode);
        if let Some(streaming) = self.streaming {
            release_streaming_playback("engine.prepared_load.streaming", streaming, release_mode);
        }
        if let Some(decoded_samples) = self.decoded_samples {
            release_decoded_samples(
                "engine.prepared_load.decoded_samples",
                decoded_samples,
                release_mode,
            );
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
    pub interactive_wait_policy: InteractivePrebufferWaitPolicy,
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
        let release_mode =
            resolve_detached_runtime_release_mode(estimated_detached_audio_buffer_bytes(
                self.streaming.as_ref(),
                self.decoded_samples.as_ref(),
            ));
        if let Some(streaming) = self.streaming {
            release_streaming_playback(
                "engine.prepared_crossfade.streaming",
                streaming,
                release_mode,
            );
        }
        if let Some(decoded_samples) = self.decoded_samples {
            release_decoded_samples(
                "engine.prepared_crossfade.decoded_samples",
                decoded_samples,
                release_mode,
            );
        }
    }
}

fn prepare_streaming_for_retirement(streaming: &StreamingPlayback) {
    streaming.buffer.clear();
    streaming.render_queue.clear();
    streaming.buffer.mark_finished();
    streaming.render_queue.mark_finished();
    streaming.shutdown_tx.shutdown();
}

fn release_streaming_playback(
    task_name: &'static str,
    streaming: StreamingPlayback,
    mode: RuntimeReleaseMode,
) {
    prepare_streaming_for_retirement(&streaming);
    match mode {
        RuntimeReleaseMode::Deferred => {
            crate::audio::retire_plane::retire_drop(task_name, streaming)
        }
        RuntimeReleaseMode::Inline => drop(streaming),
    }
}

fn release_decoded_samples(
    task_name: &'static str,
    decoded_samples: Arc<Vec<f32>>,
    mode: RuntimeReleaseMode,
) {
    match mode {
        RuntimeReleaseMode::Deferred => {
            crate::audio::retire_plane::retire_drop(task_name, decoded_samples)
        }
        RuntimeReleaseMode::Inline => drop(decoded_samples),
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
        crate::audio::stability::set_stability_profile(NativeAudioStabilityProfile::Balanced);
        crate::audio::stability::set_runtime_action_profile(RealtimePressureProfile::Normal);
        crate::audio::stability::clear_external_hints();
        let shared_output_backend = is_shared_output_backend(output_backend.id());
        info_log(format!(
            "[NativeAudio] Output backend: {}",
            output_backend.id()
        ));

        // Shared backends already incur an extra mixing pipeline.
        // Prefer Rubato by default to avoid interpolation noise on certain material/device paths.
        // Low-latency SIMD SRC remains available as an explicit manual override.
        let (default_hq_src_enabled, default_src_backend) = if shared_output_backend {
            (false, NativeAudioSrcBackend::Rubato)
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
            buffering_resume_samples: 0,
            underrun_recovery_until: None,
            shared_timeline_stress_until: None,
            shared_timeline_stress_ignore_before_ms: 0,
            last_observed_underrun_events: 0,
            decoded_samples: None,
            decoded_channels: 0,
            source_sample_rate: 0,
            decoded_sample_rate: 0,
            decoded_bit_depth: None,
            output_sample_rate: None,
            device_id: None,
            device_name: None,
            last_default_output_route_check_at: None,
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
            streaming_interactive_profile: parse_interactive_prebuffer_profile(),
            transport_mode: NativeAudioTransportMode::Robust,
            stability_profile: NativeAudioStabilityProfile::Balanced,
            stability_controller: AudioStabilityController::default(),
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
            interactive_profile: interactive_prebuffer_profile_id(
                self.streaming_interactive_profile,
            )
            .to_string(),
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
        interactive_profile: Option<&str>,
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
        if let Some(profile) = interactive_profile.and_then(parse_interactive_prebuffer_profile_id)
        {
            self.streaming_interactive_profile = profile;
        }
    }

    fn interactive_prebuffer_wait_policy(&self) -> InteractivePrebufferWaitPolicy {
        let env_profile = parse_interactive_prebuffer_profile();
        if self.streaming_interactive_profile == env_profile {
            *INTERACTIVE_PREBUFFER_WAIT_POLICY
        } else {
            InteractivePrebufferWaitPolicy::from_profile(self.streaming_interactive_profile)
        }
    }

    fn streaming_prebuffer_interactive_wait(
        &self,
        sample_rate: u32,
        channels: usize,
        capacity_samples: usize,
        duration_seconds: f64,
        kind: StreamingPrebufferKind,
        override_seconds: Option<f64>,
    ) -> (usize, Duration) {
        if self.streaming_interactive_profile == parse_interactive_prebuffer_profile() {
            return streaming_prebuffer_interactive_wait(
                self.output_backend.id(),
                sample_rate,
                channels,
                capacity_samples,
                duration_seconds,
                kind,
                override_seconds,
            );
        }

        streaming_prebuffer_interactive_wait_with_policy(
            self.output_backend.id(),
            sample_rate,
            channels,
            capacity_samples,
            duration_seconds,
            kind,
            override_seconds,
            self.interactive_prebuffer_wait_policy(),
        )
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

    fn streaming_is_finished(&self, streaming: &StreamingPlayback) -> bool {
        streaming.buffer.is_finished() && streaming.render_queue.is_finished()
    }

    fn streaming_is_finished_and_empty(&self, streaming: &StreamingPlayback) -> bool {
        streaming.buffer.is_finished_and_empty() && streaming.render_queue.is_finished_and_empty()
    }

    pub(crate) fn is_cold_idle_runtime(&self) -> bool {
        self.current_track.is_none()
            && self.queue.is_empty()
            && self.sink.is_none()
            && self.streaming.is_none()
            && self.decoded_samples.is_none()
            && !self.is_playing_or_rebuffering()
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
        self.reset_recovery_tracking();
        self.detach_active_runtime_state_for_reload();

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

        self.apply_output_stream_info(prepared.output_info.clone());

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
        self.reset_recovery_tracking();

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
            interactive_wait_policy: self.interactive_prebuffer_wait_policy(),
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
                self.stop_and_release_sink(old_sink, RuntimeReleaseMode::Deferred);
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
                    self.apply_output_stream_info(output_info);
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

        // Backend/device topology changed: stale recovery pressure from the previous pipeline can
        // over-constrain min-start gating for the new sink path and cause impossible buffering
        // targets during immediate post-switch ticks. Reset recovery tracking and apply a short
        // diagnostics grace window.
        self.reset_recovery_tracking();

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

    fn current_output_route_state(&self) -> OutputStreamInfo {
        OutputStreamInfo {
            device_id: self.device_id.clone(),
            device_name: self.device_name.clone(),
            output_sample_rate: self.output_sample_rate,
        }
    }

    fn apply_output_stream_info(&mut self, output_info: OutputStreamInfo) {
        let default_info = self.output_backend.default_device_info();
        let default_device_id = default_info
            .device_id
            .clone()
            .or_else(|| default_info.device_name.clone());
        let default_device_name = default_info.device_name;

        self.output_sample_rate = output_info.output_sample_rate.or(self.output_sample_rate);
        self.device_id = output_info
            .device_id
            .or_else(|| output_info.device_name.clone())
            .or(default_device_id)
            .or_else(|| self.device_id.clone());
        self.device_name = output_info
            .device_name
            .clone()
            .or(default_device_name)
            .or_else(|| self.device_name.clone());
    }

    fn maybe_follow_system_default_output_route(&mut self) -> Result<bool, String> {
        let now = Instant::now();
        if self
            .last_default_output_route_check_at
            .is_some_and(|last| now.duration_since(last) < DEFAULT_OUTPUT_ROUTE_FOLLOW_INTERVAL)
        {
            return Ok(false);
        }
        self.last_default_output_route_check_at = Some(now);

        let default_info = self.output_backend.default_device_info();
        let default_has_route =
            default_info.device_id.is_some() || default_info.device_name.is_some();
        if !default_has_route {
            return Ok(false);
        }

        let backend_current_info = self.output_backend.current_info();
        let backend_has_route =
            backend_current_info.device_id.is_some() || backend_current_info.device_name.is_some();

        if backend_has_route && !output_route_matches(&default_info, &backend_current_info) {
            info_log(format!(
                "[NativeAudio] Following system default output route on {}: {:?} -> {:?}",
                self.output_backend.id(),
                backend_current_info.device_name.as_deref(),
                default_info.device_name.as_deref()
            ));
            let output_info = self.output_backend.select_device(None)?;
            self.apply_output_stream_info(output_info);
            self.reset_recovery_tracking();
            self.clear_error();
            if self.current_track.is_some() {
                self.rebuild_sink_on_new_device()?;
            }
            return Ok(true);
        }

        if !output_route_matches(&default_info, &self.current_output_route_state()) {
            self.apply_output_stream_info(if backend_has_route {
                backend_current_info
            } else {
                default_info
            });
            return Ok(true);
        }

        Ok(false)
    }

    pub(crate) fn apply_selected_output_device(&mut self, output_info: OutputStreamInfo) {
        self.sync_clock();
        self.apply_output_stream_info(output_info);

        if let Err(err) = self.rebuild_sink_on_new_device() {
            self.set_error("NATIVE_AUDIO_REBUILD_SINK_FAILED", err);
        }
    }

    fn try_recover_output_after_device_disconnect(
        &mut self,
        err: &AudioOutputError,
    ) -> Result<bool, String> {
        if !output_error_looks_like_device_disconnect(err) {
            return Ok(false);
        }

        let output_info = self.output_backend.select_device(None)?;
        self.sync_clock();
        self.apply_output_stream_info(output_info);

        self.rebuild_sink_on_new_device()?;
        self.reset_recovery_tracking();
        self.clear_error();
        Ok(true)
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

    fn play_sink_with_shared_guard(&self, sink: &Arc<dyn AudioSink>) {
        if let Some(streaming) = &self.streaming {
            let channels = self.decoded_channels.max(1) as usize;
            let sample_rate = self
                .output_sample_rate
                .or(if self.decoded_sample_rate > 0 {
                    Some(self.decoded_sample_rate)
                } else {
                    None
                })
                .unwrap_or(48_000)
                .max(1);
            let (inner_resume_target, inner_resume_timeout) = self
                .streaming_prebuffer_interactive_wait(
                    sample_rate,
                    channels,
                    streaming.render_queue.capacity_samples(),
                    self.duration,
                    StreamingPrebufferKind::StartOrSeek,
                    self.streaming_prebuffer_start_or_seek_seconds,
                );
            if inner_resume_target > 0 && inner_resume_timeout > Duration::ZERO {
                if streaming.render_queue.len_samples() < inner_resume_target {
                    streaming
                        .render_queue
                        .wait_for_samples(inner_resume_target, inner_resume_timeout);
                }
            }

            if should_wrap_source_for_shared_backend(self.output_backend.id()) {
                let guard_timeout_seconds =
                    parse_env_f64("PMP_AUDIO_SHARED_RESUME_GUARD_SECONDS", 0.24, 0.0, 2.0);
                let guard_min_seconds =
                    parse_env_f64("PMP_AUDIO_SHARED_RESUME_GUARD_MIN_SECONDS", 0.08, 0.0, 0.8);
                let guard_timeout = Duration::from_secs_f64(guard_timeout_seconds);
                let guard_state = shared_render_ahead_ready_snapshot();

                if guard_state.active_wrapper_id > 0 && guard_timeout > Duration::ZERO {
                    let sample_rate = sample_rate as f64;
                    let outer_resume_target = ((sample_rate * channels as f64 * guard_min_seconds)
                        .ceil() as usize)
                        .max(channels.saturating_mul(48));
                    let seek_epoch = self.seek_epoch.load(Ordering::Acquire);
                    let wait_target = outer_resume_target.max(guard_state.low_watermark_samples);
                    let _ =
                        wait_for_shared_render_ahead_ready(wait_target, seek_epoch, guard_timeout);
                }
            }
        }
        sink.play();
    }

    fn seek_resume_wait_plan(&self, render_queue_capacity: usize) -> (usize, Duration) {
        let channels = self.decoded_channels.max(1) as usize;
        let sample_rate = self
            .output_sample_rate
            .or(if self.decoded_sample_rate > 0 {
                Some(self.decoded_sample_rate)
            } else {
                None
            })
            .unwrap_or(48_000)
            .max(1);
        let capacity = render_queue_capacity.max(channels);
        let (target_samples, timeout) = self.streaming_prebuffer_interactive_wait(
            sample_rate,
            channels,
            capacity,
            self.duration,
            StreamingPrebufferKind::StartOrSeek,
            self.streaming_prebuffer_start_or_seek_seconds,
        );
        if target_samples == 0 {
            return (0, Duration::ZERO);
        }

        let floor_samples = channels.saturating_mul(64);
        let resume_samples = target_samples
            .max(floor_samples)
            .clamp(channels.max(1), capacity.max(1));
        let resume_timeout = timeout.max(Duration::from_millis(120));

        (resume_samples, resume_timeout)
    }

    fn stop_and_release_sink(&self, sink: Arc<dyn AudioSink>, mode: RuntimeReleaseMode) {
        release_sink_handle("engine.sink", sink, mode);
    }

    fn maybe_wait_for_retire_backpressure_after_detach(&self) {
        let timeout_ms = *RETIRE_BACKPRESSURE_WAIT_TIMEOUT_MS;
        if timeout_ms == 0 {
            return;
        }

        let pending_threshold = *RETIRE_BACKPRESSURE_PENDING_THRESHOLD;
        let current_pending = crate::audio::retire_plane::pending_tasks();
        if current_pending <= pending_threshold {
            return;
        }

        let target_pending = (*RETIRE_BACKPRESSURE_TARGET_PENDING).min(pending_threshold);
        let _ = crate::audio::retire_plane::wait_for_pending_tasks_at_most(
            target_pending,
            Duration::from_millis(timeout_ms),
        );
    }

    fn maybe_wait_for_reload_retire_completion(&self, detached_audio_buffer_bytes: usize) {
        let threshold_bytes = *RETIRE_RELOAD_WAIT_BUFFER_THRESHOLD_BYTES;
        if threshold_bytes > 0 && detached_audio_buffer_bytes < threshold_bytes {
            return;
        }

        let timeout_ms = *RETIRE_RELOAD_WAIT_TIMEOUT_MS;
        if timeout_ms == 0 {
            return;
        }

        let target_pending = *RETIRE_RELOAD_WAIT_TARGET_PENDING;
        let current_pending = crate::audio::retire_plane::pending_tasks();
        if current_pending <= target_pending {
            return;
        }

        let _ = crate::audio::retire_plane::wait_for_pending_tasks_at_most(
            target_pending,
            Duration::from_millis(timeout_ms),
        );
    }

    fn detach_active_runtime_state_for_reload(&mut self) {
        let mut detached_any = false;
        let detached_audio_buffer_bytes = self.estimated_audio_buffer_bytes();
        let release_mode = resolve_detached_runtime_release_mode(detached_audio_buffer_bytes);

        if let Some(old_sink) = self.sink.take() {
            detached_any = true;
            self.stop_and_release_sink(old_sink, release_mode);
        }
        if self.streaming.is_some() {
            detached_any = true;
            self.shutdown_streaming_with_mode(release_mode);
        }
        if self.decoded_samples.is_some() {
            detached_any = true;
            self.retire_cached_decoded_samples_with_mode(release_mode);
        }
        if self.mixer.take().is_some() {
            detached_any = true;
        }

        if detached_any && matches!(release_mode, RuntimeReleaseMode::Deferred) {
            self.maybe_wait_for_retire_backpressure_after_detach();
            self.maybe_wait_for_reload_retire_completion(detached_audio_buffer_bytes);
        }
    }

    fn shutdown_and_release_streaming(
        &self,
        streaming: StreamingPlayback,
        mode: RuntimeReleaseMode,
    ) {
        release_streaming_playback("engine.streaming", streaming, mode);
    }

    fn retire_cached_decoded_samples_with_mode(&mut self, mode: RuntimeReleaseMode) {
        if let Some(decoded_samples) = self.decoded_samples.take() {
            release_decoded_samples("engine.decoded_samples", decoded_samples, mode);
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

    fn shutdown_streaming_with_mode(&mut self, mode: RuntimeReleaseMode) {
        if let Some(streaming) = self.streaming.take() {
            self.shutdown_and_release_streaming(streaming, mode);
        }
    }

    fn shutdown_streaming(&mut self) {
        self.shutdown_streaming_with_mode(RuntimeReleaseMode::Deferred);
    }

    fn estimated_audio_buffer_bytes(&self) -> usize {
        estimated_detached_audio_buffer_bytes(
            self.streaming.as_ref(),
            self.decoded_samples.as_ref(),
        )
    }

    fn should_release_cached_audio_on_stop(&self) -> bool {
        if *FORCE_RELEASE_ON_STOP {
            return self.streaming.is_some() || self.decoded_samples.is_some();
        }

        self.estimated_audio_buffer_bytes() >= *STOP_RELEASE_BUFFER_THRESHOLD_BYTES
    }

    fn release_cached_audio_pipeline_with_mode(&mut self, mode: RuntimeReleaseMode) {
        if let Some(sink) = self.sink.take() {
            self.stop_and_release_sink(sink, mode);
        }
        self.mixer = None;
        self.shutdown_streaming_with_mode(mode);
        self.retire_cached_decoded_samples_with_mode(mode);
        self.decoded_channels = 0;
        self.source_sample_rate = 0;
        self.decoded_sample_rate = 0;
        self.decoded_bit_depth = None;
        self.active_input_id = None;
    }

    fn release_cached_audio_pipeline(&mut self) {
        self.release_cached_audio_pipeline_with_mode(RuntimeReleaseMode::Deferred);
    }

    fn release_runtime_state_for_empty_queue(&mut self) {
        self.cancel_crossfade();
        self.sync_clock();
        self.clear_error();
        self.spectrum_pre_tap.clear();
        self.spectrum_post_tap.clear();
        self.dsp_runtime.request_reset();
        self.reset_recovery_tracking();

        let had_runtime = self.sink.is_some()
            || self.mixer.is_some()
            || self.streaming.is_some()
            || self.decoded_samples.is_some();

        self.release_cached_audio_pipeline_with_mode(RuntimeReleaseMode::Inline);
        self.output_backend.close_stream();

        if had_runtime {
            self.maybe_wait_for_retire_backpressure_after_detach();
        }
        let drain_timeout_ms = *EMPTY_QUEUE_RETIRE_DRAIN_TIMEOUT_MS;
        if drain_timeout_ms > 0 {
            let _ = crate::audio::retire_plane::wait_for_pending_tasks_at_most(
                0,
                Duration::from_millis(drain_timeout_ms),
            );
        }

        self.current_track = None;
        self.active_input_id = None;
        self.current_position = 0.0;
        self.base_position = 0.0;
        self.playback_started_at = None;
        self.duration = 0.0;
        self.output_sample_rate = self.output_backend.current_info().output_sample_rate;
        self.set_state(PlaybackState::Stopped);
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
        self.reset_recovery_tracking();
        self.detach_active_runtime_state_for_reload();

        let (sink, output_info) = self.output_backend.create_sink()?;
        self.apply_output_stream_info(output_info);
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
            let (target_samples, timeout) = self.streaming_prebuffer_interactive_wait(
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
        self.reset_recovery_tracking();

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
            let (target_samples, timeout) = self.streaming_prebuffer_interactive_wait(
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

    fn refresh_recovery_window_state(&mut self) -> bool {
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

        underrun_recovery_active || shared_stress_active
    }

    fn play_prebuffer_plan(&mut self) -> Option<PlayPrebufferPlan> {
        let robust_recovery_active = self.refresh_recovery_window_state();
        let streaming = self.streaming.as_ref()?;

        let channels = self.decoded_channels.max(1) as usize;
        let remaining_duration = if self.duration.is_finite() && self.duration > 0.0 {
            (self.duration - self.current_position).max(0.0)
        } else {
            self.duration
        };

        let decode_reservoir = streaming.buffer.clone();
        let render_queue = streaming.render_queue.clone();
        let (target_samples, wait_timeout) = streaming_prebuffer_target_samples(
            self.output_backend.id(),
            self.decoded_sample_rate,
            channels,
            render_queue.capacity_samples(),
            remaining_duration,
            StreamingPrebufferKind::StartOrSeek,
            self.streaming_prebuffer_start_or_seek_seconds,
        );

        if target_samples == 0 {
            return None;
        }

        let sample_rate = self.decoded_sample_rate.max(1) as f64;
        let channels_f64 = channels.max(1) as f64;
        let target_seconds = target_samples as f64 / (sample_rate * channels_f64);
        let (min_seconds_cap, min_seconds_floor) =
            streaming_min_start_bounds(self.output_backend.id(), robust_recovery_active);
        let min_start_seconds = target_seconds
            .min(min_seconds_cap)
            .max(min_seconds_floor)
            .min(target_seconds);
        let mut min_start_samples = ((sample_rate * channels_f64 * min_start_seconds).ceil()
            as usize)
            .clamp(1, target_samples);

        let available = render_queue.len_samples();
        let buffered_ahead_seconds = if sample_rate > 0.0 && channels_f64 > 0.0 {
            (available as f64) / (sample_rate * channels_f64)
        } else {
            0.0
        };
        self.update_stability_pressure_state(
            buffered_ahead_seconds,
            self.underrun_recovery_until.is_some(),
            self.shared_timeline_stress_until.is_some(),
        );
        let profile = SCHEDULER.update(buffered_ahead_seconds, robust_recovery_active);
        min_start_samples = clamp_min_start_samples_to_reachable(
            min_start_samples,
            target_samples,
            render_queue.capacity_samples(),
            channels,
            profile,
        );

        let finished = decode_reservoir.is_finished() && render_queue.is_finished();

        Some(PlayPrebufferPlan {
            decode_reservoir,
            render_queue,
            min_start_samples,
            wait_timeout,
            available,
            finished,
        })
    }

    pub(crate) fn extract_play_prebuffer_wait_request(
        &mut self,
    ) -> Option<StreamingPrebufferWaitRequest> {
        self.update_shared_timeline_stress_window();
        let plan = self.play_prebuffer_plan()?;

        if plan.available < plan.min_start_samples && !plan.finished {
            Some(StreamingPrebufferWaitRequest {
                render_queue: plan.render_queue,
                target_samples: plan.min_start_samples,
                timeout: plan.wait_timeout,
            })
        } else {
            None
        }
    }

    pub(crate) fn play(&mut self) -> Result<(), String> {
        self.play_internal(true)
    }

    pub(crate) fn play_without_prebuffer_wait(&mut self) -> Result<(), String> {
        self.play_internal(false)
    }

    fn play_internal(&mut self, allow_prebuffer_wait: bool) -> Result<(), String> {
        if self.sink.is_none() {
            if let Some(track_path) = self.current_track.clone() {
                self.reload_track_for_seek_recovery(track_path)?;
            }
        }

        let sink = self
            .sink
            .as_ref()
            .cloned()
            .ok_or_else(|| "No track loaded".to_string())?;

        self.update_shared_timeline_stress_window();
        if let Some(plan) = self.play_prebuffer_plan() {
            self.desired_playback_state = PlaybackState::Playing;
            if plan.available < plan.min_start_samples && !plan.finished {
                sink.pause();
                self.sync_clock();
                self.playback_state = PlaybackState::Buffering;
                let now = Instant::now();
                self.buffering_started_at = Some(now);
                self.buffering_last_progress_at = Some(now);
                self.buffering_last_samples = plan.available;
                self.buffering_resume_samples = plan.min_start_samples;

                if allow_prebuffer_wait {
                    // Fast-path: wait briefly for initial decoded samples so click-to-play does
                    // not depend on the emitter tick cadence.
                    plan.render_queue
                        .wait_for_samples(plan.min_start_samples, plan.wait_timeout);

                    let available = plan.render_queue.len_samples();
                    let finished =
                        plan.decode_reservoir.is_finished() && plan.render_queue.is_finished();
                    if available >= plan.min_start_samples || (finished && available > 0) {
                        self.play_sink_with_shared_guard(&sink);
                        self.buffering_started_at = None;
                        self.buffering_last_progress_at = None;
                        self.buffering_last_samples = 0;
                        self.buffering_resume_samples = 0;
                        self.set_state(PlaybackState::Playing);
                        self.base_position = self.current_position;
                        self.playback_started_at = Some(Instant::now());
                    }
                }
                return Ok(());
            }
        }

        self.play_sink_with_shared_guard(&sink);
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
        let should_release_cached_audio = self.should_release_cached_audio_on_stop();

        if should_release_cached_audio {
            self.release_cached_audio_pipeline();
        } else if let Some(streaming) = &self.streaming {
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
                            self.stop_and_release_sink(old, RuntimeReleaseMode::Deferred);
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
                    self.stop_and_release_sink(old, RuntimeReleaseMode::Deferred);
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

    pub(crate) fn append_queue_state(&mut self, entries: Vec<PathBuf>) {
        if entries.is_empty() {
            return;
        }

        self.queue_initialized = true;
        self.queue.extend(entries);
    }

    pub(crate) fn clear_queue_state(&mut self) {
        self.queue_initialized = true;
        self.queue.clear();
        self.current_index = -1;
        self.release_runtime_state_for_empty_queue();
    }

    pub(crate) fn remove_queue_entry_at(&mut self, index: i32) -> Result<(), String> {
        if index < 0 {
            return Err("Queue index is negative".to_string());
        }

        self.queue_initialized = true;
        let normalized_index = index as usize;
        if normalized_index >= self.queue.len() {
            return Err(format!(
                "Queue index out of range: {} >= {}",
                normalized_index,
                self.queue.len()
            ));
        }

        self.queue.remove(normalized_index);

        if self.queue.is_empty() {
            self.current_index = -1;
            self.release_runtime_state_for_empty_queue();
            return Ok(());
        }

        if self.current_index == index {
            self.current_index = index.min((self.queue.len() as i32).saturating_sub(1));
        } else if self.current_index > index {
            self.current_index -= 1;
        }

        if self.current_index >= self.queue.len() as i32 {
            self.current_index = (self.queue.len() as i32).saturating_sub(1);
        }

        Ok(())
    }

    pub(crate) fn move_queue_entry(
        &mut self,
        from_index: i32,
        to_index: i32,
    ) -> Result<(), String> {
        if from_index < 0 || to_index < 0 {
            return Err("Queue index is negative".to_string());
        }

        self.queue_initialized = true;
        let normalized_from = from_index as usize;
        let normalized_to = to_index as usize;
        let queue_len = self.queue.len();
        if normalized_from >= queue_len {
            return Err(format!(
                "Queue source index out of range: {} >= {}",
                normalized_from, queue_len
            ));
        }
        if normalized_to >= queue_len {
            return Err(format!(
                "Queue target index out of range: {} >= {}",
                normalized_to, queue_len
            ));
        }
        if normalized_from == normalized_to {
            return Ok(());
        }

        let entry = self.queue.remove(normalized_from);
        self.queue.insert(normalized_to, entry);

        if self.current_index == from_index {
            self.current_index = to_index;
        } else if from_index < self.current_index && to_index >= self.current_index {
            self.current_index -= 1;
        } else if from_index > self.current_index && to_index <= self.current_index {
            self.current_index += 1;
        }

        Ok(())
    }

    pub(crate) fn replace_queue_entry_path(
        &mut self,
        index: i32,
        path: PathBuf,
    ) -> Result<(), String> {
        if index < 0 {
            return Err("Queue index is negative".to_string());
        }

        self.queue_initialized = true;
        let normalized_index = index as usize;
        if normalized_index >= self.queue.len() {
            return Err(format!(
                "Queue index out of range: {} >= {}",
                normalized_index,
                self.queue.len()
            ));
        }

        self.queue[normalized_index] = path;
        Ok(())
    }

    pub(crate) fn queued_track_path_at(&self, index: i32) -> Option<PathBuf> {
        if index < 0 {
            return None;
        }

        self.queue.get(index as usize).cloned()
    }

    pub(crate) fn sync_queue_index_state(&mut self, current_index: i32) {
        if !self.queue_initialized {
            return;
        }

        let max_index = (self.queue.len() as i32).saturating_sub(1);
        self.current_index = current_index.clamp(-1, max_index);

        if self.queue.is_empty() || self.current_index < 0 {
            self.release_runtime_state_for_empty_queue();
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
        let remote_seek_requires_materialized_reload = self
            .active_input_id
            .as_deref()
            .is_some_and(|id| id == REMOTE_STREAM_INPUT_ID)
            && crate::audio::source::lookup_remote_stream_input_locator(&track_path)
                .as_ref()
                .is_some_and(|locator| {
                    !crate::audio::source::remote_stream_locator_has_complete_cache(locator)
                });

        if remote_seek_requires_materialized_reload {
            let previous_decode_mode = self.streaming_decode_mode;
            self.streaming_decode_mode = AudioInputDecodeMode::FullTrack;
            let reload_result = self.reload_track_for_seek_recovery(track_path.clone());
            self.streaming_decode_mode = previous_decode_mode;
            reload_result?;
            force_non_streaming_seek = true;
        }

        let apply_streaming_seek_state =
            |engine: &mut NativeAudioEngine,
             seek_target: f64,
             should_resume_playing: bool,
             available_samples: usize,
             resume_samples: usize| {
                // Interactive seek requirement: resume output immediately (ms-level perceived seek),
                // but keep the clock paused until the decoder has produced samples for the new position.
                engine.base_position = seek_target;
                engine.current_position = seek_target;
                engine.playback_started_at = None;

                if should_resume_playing {
                    engine.desired_playback_state = PlaybackState::Playing;
                    engine.playback_state = PlaybackState::Buffering;
                    let now = Instant::now();
                    engine.buffering_started_at = Some(now);
                    engine.buffering_last_progress_at = Some(now);
                    engine.buffering_last_samples = available_samples;
                    engine.buffering_resume_samples = resume_samples;
                } else {
                    engine.buffering_started_at = None;
                    engine.buffering_last_progress_at = None;
                    engine.buffering_last_samples = 0;
                    engine.buffering_resume_samples = 0;
                }
            };

        if let Some(streaming) = &self.streaming {
            let seek_command_tx = streaming.command_tx.clone();
            let seek_decode_buffer = streaming.buffer.clone();
            let seek_render_queue = streaming.render_queue.clone();
            self.spectrum_pre_tap.clear();
            self.spectrum_post_tap.clear();
            self.dsp_runtime.request_reset();

            match seek_command_tx.send(DecoderCommand::Seek(target)) {
                Ok(()) => {
                    let seek_sink = self.sink.as_ref().cloned();
                    if resume_playing {
                        if let Some(sink) = &seek_sink {
                            sink.pause();
                        }
                    }
                    seek_decode_buffer.clear();
                    seek_render_queue.clear();
                    // Flush shared render-ahead queues only after the upstream decoder state has been
                    // updated/cleared. Otherwise the producer can refill the buffer with old audio
                    // before we switch sources, causing a noticeable seek delay ("rubber banding").
                    self.bump_seek_epoch();
                    if let Some(sink) = &seek_sink {
                        sink.flush();
                    }
                    let (seek_resume_samples, seek_resume_timeout) = if resume_playing {
                        self.seek_resume_wait_plan(seek_render_queue.capacity_samples())
                    } else {
                        (0, Duration::ZERO)
                    };
                    let available_samples = seek_render_queue.len_samples();
                    apply_streaming_seek_state(
                        self,
                        target,
                        resume_playing,
                        available_samples,
                        seek_resume_samples,
                    );
                    if resume_playing {
                        if available_samples < seek_resume_samples
                            && seek_resume_samples > 0
                            && seek_resume_timeout > Duration::ZERO
                        {
                            seek_render_queue
                                .wait_for_samples(seek_resume_samples, seek_resume_timeout);
                        }

                        let available_after_wait = seek_render_queue.len_samples();
                        let finished_after_wait =
                            seek_decode_buffer.is_finished() && seek_render_queue.is_finished();
                        let ready = seek_resume_samples == 0
                            || available_after_wait >= seek_resume_samples
                            || (finished_after_wait && available_after_wait > 0);

                        if let Some(sink) = &seek_sink {
                            if ready {
                                self.play_sink_with_shared_guard(sink);
                                self.buffering_started_at = None;
                                self.buffering_last_progress_at = None;
                                self.buffering_last_samples = 0;
                                self.buffering_resume_samples = 0;
                                self.set_state(PlaybackState::Playing);
                                self.base_position = target;
                                self.playback_started_at = Some(Instant::now());
                            } else {
                                sink.pause();
                                self.playback_started_at = None;
                                self.playback_state = PlaybackState::Buffering;
                            }
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
                        let seek_decode_buffer = reloaded_streaming.buffer.clone();
                        let seek_render_queue = reloaded_streaming.render_queue.clone();
                        let seek_sink = self.sink.as_ref().cloned();
                        if resume_playing {
                            if let Some(sink) = &seek_sink {
                                sink.pause();
                            }
                        }
                        seek_decode_buffer.clear();
                        seek_render_queue.clear();
                        self.bump_seek_epoch();
                        if let Some(sink) = &seek_sink {
                            sink.flush();
                        }
                        let (seek_resume_samples, seek_resume_timeout) = if resume_playing {
                            self.seek_resume_wait_plan(seek_render_queue.capacity_samples())
                        } else {
                            (0, Duration::ZERO)
                        };
                        let available_samples = seek_render_queue.len_samples();
                        apply_streaming_seek_state(
                            self,
                            target,
                            resume_playing,
                            available_samples,
                            seek_resume_samples,
                        );
                        if resume_playing {
                            if available_samples < seek_resume_samples
                                && seek_resume_samples > 0
                                && seek_resume_timeout > Duration::ZERO
                            {
                                seek_render_queue
                                    .wait_for_samples(seek_resume_samples, seek_resume_timeout);
                            }

                            let available_after_wait = seek_render_queue.len_samples();
                            let finished_after_wait =
                                seek_decode_buffer.is_finished() && seek_render_queue.is_finished();
                            let ready = seek_resume_samples == 0
                                || available_after_wait >= seek_resume_samples
                                || (finished_after_wait && available_after_wait > 0);

                            if let Some(sink) = &seek_sink {
                                if ready {
                                    self.play_sink_with_shared_guard(sink);
                                    self.buffering_started_at = None;
                                    self.buffering_last_progress_at = None;
                                    self.buffering_last_samples = 0;
                                    self.buffering_resume_samples = 0;
                                    self.set_state(PlaybackState::Playing);
                                    self.base_position = target;
                                    self.playback_started_at = Some(Instant::now());
                                } else {
                                    sink.pause();
                                    self.playback_started_at = None;
                                    self.playback_state = PlaybackState::Buffering;
                                }
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
                self.play_sink_with_shared_guard(&sink);
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
        self.apply_output_stream_info(output_info);
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
            self.play_sink_with_shared_guard(&sink);
            self.base_position = target;
            self.playback_started_at = Some(Instant::now());
        } else {
            self.base_position = target;
            self.playback_started_at = None;
        }

        if let Some(old_sink) = self.sink.replace(sink) {
            self.stop_and_release_sink(old_sink, RuntimeReleaseMode::Deferred);
        }

        self.current_position = target;
        Ok(())
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
        let playback_rate = self.dsp_runtime.playback_rate().max(0.0) as f64;
        let mut next = self.base_position + elapsed * playback_rate;
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
            if self.streaming.is_some() && self.is_playing_or_rebuffering() {
                self.underrun_recovery_until = Some(Instant::now() + Duration::from_secs(20));
            }
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
            self.buffering_resume_samples = 0;

            match self.try_recover_output_after_device_disconnect(&err) {
                Ok(true) => {
                    info_log(format!(
                        "[NativeAudio] Recovered output after device disconnect: [{}] {}",
                        err.code, err.message
                    ));
                    return true;
                }
                Ok(false) => {
                    self.set_error(
                        "NATIVE_AUDIO_OUTPUT_ERROR",
                        format!("[{}] {}", err.code, err.message),
                    );
                }
                Err(recovery_err) => {
                    self.set_error(
                        "NATIVE_AUDIO_OUTPUT_ERROR",
                        format!(
                            "[{}] {}; auto-recovery failed: {}",
                            err.code, err.message, recovery_err
                        ),
                    );
                }
            }
            return true;
        }

        match self.maybe_follow_system_default_output_route() {
            Ok(true) => return true,
            Ok(false) => {}
            Err(err) => {
                self.set_error("NATIVE_AUDIO_OUTPUT_ROUTE_SYNC_FAILED", err);
                return true;
            }
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
            self.buffering_resume_samples = 0;
            self.set_error("NATIVE_AUDIO_STREAM_ERROR", message);
            return true;
        }

        let streaming_runtime = self.streaming.as_ref().map(|streaming| {
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
            let sample_rate = self.decoded_sample_rate.max(1) as f64;
            let channels_f64 = channels.max(1) as f64;
            let buffered_ahead_seconds = if sample_rate > 0.0 && channels_f64 > 0.0 {
                (streaming.render_queue.len_samples() as f64) / (sample_rate * channels_f64)
            } else {
                0.0
            };
            (
                channels,
                target_samples,
                sample_rate,
                channels_f64,
                buffered_ahead_seconds,
            )
        });

        if let Some((channels, target_samples, sample_rate, channels_f64, buffered_ahead_seconds)) =
            streaming_runtime
        {
            if target_samples > 0 {
                self.update_stability_pressure_state(
                    buffered_ahead_seconds,
                    underrun_recovery_active,
                    shared_stress_active,
                );
            }

            if let (Some(sink), Some(streaming)) = (&self.sink, &self.streaming) {
                if target_samples > 0 {
                    let target_seconds = target_samples as f64 / (sample_rate * channels_f64);
                    let (min_seconds_cap, min_seconds_floor) = streaming_min_start_bounds(
                        self.output_backend.id(),
                        robust_recovery_active,
                    );
                    let min_start_seconds = target_seconds
                        .min(min_seconds_cap)
                        .max(min_seconds_floor)
                        .min(target_seconds);
                    let mut min_start_samples = ((sample_rate * channels_f64 * min_start_seconds)
                        .ceil() as usize)
                        .clamp(1, target_samples);
                    let profile = SCHEDULER.update(buffered_ahead_seconds, robust_recovery_active);
                    min_start_samples = clamp_min_start_samples_to_reachable(
                        min_start_samples,
                        target_samples,
                        streaming.render_queue.capacity_samples(),
                        channels,
                        profile,
                    );

                    if matches!(self.desired_playback_state, PlaybackState::Playing)
                        && matches!(self.playback_state, PlaybackState::Playing)
                    {
                        let available = streaming.render_queue.len_samples();
                        let (rebuffer_enter_samples, rebuffer_resume_samples) =
                            runtime_rebuffer_threshold_samples(
                                self.output_backend.id(),
                                min_start_samples,
                                channels,
                            );
                        // During interactive seek we keep the sink running (the streaming source emits
                        // silence) and avoid entering the buffering state, otherwise shared backends
                        // can "pause then resume" with large perceived latency.
                        if self.playback_started_at.is_some()
                            && available < rebuffer_enter_samples
                            && !self.streaming_is_finished(streaming)
                        {
                            sink.pause();
                            self.sync_clock();
                            self.playback_state = PlaybackState::Buffering;
                            let now = Instant::now();
                            self.buffering_started_at = Some(now);
                            self.buffering_last_progress_at = Some(now);
                            self.buffering_last_samples = available;
                            self.buffering_resume_samples = rebuffer_resume_samples;
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
                            let decode_available = streaming.buffer.len_samples();
                            sink.pause();
                            self.sync_clock();
                            self.buffering_started_at = None;
                            self.buffering_last_progress_at = None;
                            self.buffering_last_samples = 0;
                            self.buffering_resume_samples = 0;
                            self.set_error(
                                "NATIVE_AUDIO_SEEK_STALLED",
                                format!(
                                    "Audio seek stalled (no decoder progress): available={available} minStart={min_start_samples} target={target_samples} decodeAvailable={decode_available}"
                                ),
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
                            self.buffering_resume_samples = 0;
                            self.current_position = self.duration;
                            self.base_position = self.current_position;
                            self.playback_started_at = None;
                            self.set_state(PlaybackState::Stopped);
                            if self.should_release_cached_audio_on_stop() {
                                self.release_cached_audio_pipeline();
                            }
                            return true;
                        }

                        if finished && available > 0 {
                            self.play_sink_with_shared_guard(&sink);
                            self.buffering_started_at = None;
                            self.buffering_last_progress_at = None;
                            self.buffering_last_samples = 0;
                            self.buffering_resume_samples = 0;
                            self.set_state(PlaybackState::Playing);
                            self.base_position = self.current_position;
                            self.playback_started_at = Some(now);
                            return true;
                        }

                        let resume_samples = self
                            .buffering_resume_samples
                            .max((channels.max(1)).saturating_mul(32))
                            .min(min_start_samples.max(1));
                        let ready_min = available >= resume_samples;

                        let stall_timeout = Duration::from_secs(15);
                        let no_progress_for = self
                            .buffering_last_progress_at
                            .map(|instant| now.saturating_duration_since(instant))
                            .unwrap_or(Duration::from_secs(0));
                        if !ready_min && no_progress_for >= stall_timeout && !finished {
                            let decode_available = streaming.buffer.len_samples();
                            sink.pause();
                            self.sync_clock();
                            self.buffering_started_at = None;
                            self.buffering_last_progress_at = None;
                            self.buffering_last_samples = 0;
                            self.set_error(
                                "NATIVE_AUDIO_BUFFERING_TIMEOUT",
                                format!(
                                    "Audio buffering stalled (no decoder progress): available={available} minStart={min_start_samples} target={target_samples} decodeAvailable={decode_available} profile={profile:?}"
                                ),
                            );
                            self.buffering_resume_samples = 0;
                            return true;
                        }

                        if ready_min {
                            self.play_sink_with_shared_guard(&sink);
                            self.buffering_started_at = None;
                            self.buffering_last_progress_at = None;
                            self.buffering_last_samples = 0;
                            self.buffering_resume_samples = 0;
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
                    self.play_sink_with_shared_guard(&sink);
                    self.buffering_started_at = None;
                    self.buffering_last_progress_at = None;
                    self.buffering_last_samples = 0;
                    self.buffering_resume_samples = 0;
                    self.set_state(PlaybackState::Playing);
                    self.base_position = self.current_position;
                    self.playback_started_at = Some(Instant::now());
                    return true;
                }
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
            if self.should_release_cached_audio_on_stop() {
                self.release_cached_audio_pipeline();
            }
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

    pub(crate) fn set_replay_gain(&mut self, replay_gain_db: Option<f32>) {
        let replay_gain_db = replay_gain_db.unwrap_or(0.0);
        self.replay_gain_db = self.dsp_runtime.set_replay_gain_db(replay_gain_db);
    }

    pub(crate) fn set_dynamic_gain_enabled(&mut self, enabled: bool) {
        self.dsp_runtime.set_dynamic_gain_enabled(enabled);
    }

    pub(crate) fn set_dsp_chain(&mut self, chain: Vec<DspNodeConfig>) {
        let clock_was_running = self.playback_started_at.is_some();
        self.update_position_from_clock();
        self.base_position = self.current_position;
        self.dsp_chain = chain;
        self.gain_db = self.dsp_runtime.apply_chain(&self.dsp_chain);
        if clock_was_running {
            self.playback_started_at = Some(Instant::now());
        }
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

    pub(super) fn build_state_payload_with_options(
        &self,
        ended: bool,
        include_track_path: bool,
        include_queue: bool,
        include_diagnostics: bool,
    ) -> NativeAudioStatePayload {
        state_payload_impl::build_state_payload_with_options_impl(
            self,
            ended,
            include_track_path,
            include_queue,
            include_diagnostics,
        )
    }

    pub(crate) fn rebuild_sink_on_new_device(&mut self) -> Result<(), String> {
        sink_rebuild_impl::rebuild_sink_on_new_device_impl(self)
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
        flushed: AtomicBool,
        stopped: AtomicBool,
    }

    impl AudioSink for FlagSink {
        fn append(&self, _source: crate::audio::output::BoxedSource) {}

        fn play(&self) {}

        fn pause(&self) {}

        fn flush(&self) {
            self.flushed.store(true, Ordering::Release);
        }

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
    fn min_start_samples_is_clamped_to_reachable_ceiling() {
        let channels = 2usize;
        let capacity_samples = 16_384usize;
        let target_samples = capacity_samples;
        let raw_min_start_samples = capacity_samples;

        let clamped = clamp_min_start_samples_to_reachable(
            raw_min_start_samples,
            target_samples,
            capacity_samples,
            channels,
            RealtimePressureProfile::Critical,
        );

        let expected = streaming_transfer_watermarks(
            capacity_samples,
            channels,
            RealtimePressureProfile::Critical,
        )
        .1;
        assert_eq!(clamped, expected);
        assert!(clamped < capacity_samples);
    }

    #[test]
    fn runtime_rebuffer_thresholds_are_less_aggressive_than_start_gate() {
        let min_start_samples = 33_600usize;
        let (enter, resume) =
            runtime_rebuffer_threshold_samples("rodio-cpal", min_start_samples, 2);

        assert!(enter > 0);
        assert!(enter < min_start_samples);
        assert!(resume >= enter);
        assert!(resume <= min_start_samples);

        let (small_enter, small_resume) = runtime_rebuffer_threshold_samples("rodio-cpal", 512, 2);
        assert!(small_enter >= 128);
        assert!(small_resume >= small_enter);
    }

    #[test]
    fn play_buffers_until_render_queue_has_min_start_samples() {
        let backend: Arc<dyn AudioOutputBackend> = Arc::new(TransportModeBackend::new("wasapi"));
        let mut engine = NativeAudioEngine::new_with_backend(backend);

        engine.decoded_channels = 2;
        engine.decoded_sample_rate = 48_000;
        engine.duration = 120.0;
        engine.current_position = 0.0;
        engine.set_streaming_buffer_settings(Some(0.2), None, Some("streaming"), None);

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

        let (command_tx, _command_rx) =
            crate::audio::control_plane::command_channel::<DecoderCommand>();
        let (transfer_tx, _transfer_rx) = crate::audio::control_plane::command_channel();
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
        engine.set_streaming_buffer_settings(Some(2.4), None, Some("streaming"), None);

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
        let min_start_samples = clamp_min_start_samples_to_reachable(
            ((sample_rate * channels_f64 * min_start_seconds).ceil() as usize)
                .clamp(1, target_samples),
            target_samples,
            render_queue.capacity_samples(),
            channels,
            RealtimePressureProfile::Normal,
        );

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

        let (command_tx, _command_rx) =
            crate::audio::control_plane::command_channel::<DecoderCommand>();
        let (transfer_tx, _transfer_rx) = crate::audio::control_plane::command_channel();
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
    fn release_cached_audio_pipeline_drops_heavy_runtime_handles() {
        let backend: Arc<dyn AudioOutputBackend> =
            Arc::new(TransportModeBackend::new("rodio-cpal"));
        let mut engine = NativeAudioEngine::new_with_backend(backend);
        let sink = Arc::new(CallSink::default());

        engine.current_track = Some(PathBuf::from("D:/memory-test.wav"));
        engine.decoded_channels = 2;
        engine.decoded_sample_rate = 48_000;
        engine.decoded_samples = Some(Arc::new(vec![0.0f32; 64 * 1024]));
        engine.sink = Some(sink.clone());
        engine.streaming = Some(make_finished_streaming_playback(1_000_000, 2));

        engine.release_cached_audio_pipeline();

        assert!(
            engine.streaming.is_none(),
            "release should drop streaming pipeline"
        );
        assert!(
            engine.decoded_samples.is_none(),
            "release should drop decoded samples cache"
        );
        assert!(engine.sink.is_none(), "release should drop sink handle");
        assert_eq!(engine.decoded_channels, 0);
        assert_eq!(engine.decoded_sample_rate, 0);
        assert!(engine.active_input_id.is_none());
        assert!(
            sink.flush_calls.load(Ordering::Acquire) >= 1,
            "release should flush old sink before retiring it"
        );
    }

    #[test]
    fn begin_load_operation_aggressively_retires_old_runtime_state() {
        let backend: Arc<dyn AudioOutputBackend> =
            Arc::new(TransportModeBackend::new("rodio-cpal"));
        let mut engine = NativeAudioEngine::new_with_backend(backend);

        let sink = Arc::new(FlagSink::default());
        let sink_dyn: Arc<dyn AudioSink> = sink.clone();
        let streaming = make_active_streaming_playback(48_000, 2);
        let decode_buffer = streaming.buffer.clone();
        let render_queue = streaming.render_queue.clone();

        engine.sink = Some(sink_dyn);
        engine.streaming = Some(streaming);
        engine.decoded_samples = Some(Arc::new(vec![0.0f32; 96_000]));

        let op = engine.begin_load_operation();

        assert!(op.token > 0, "load operation should allocate a token");
        assert!(sink.flushed.load(Ordering::Acquire));
        assert!(sink.stopped.load(Ordering::Acquire));
        assert!(
            engine.streaming.is_none(),
            "old streaming should be detached"
        );
        assert!(
            engine.decoded_samples.is_none(),
            "old decoded samples should be detached before prepare"
        );
        assert_eq!(decode_buffer.len_samples(), 0);
        assert_eq!(render_queue.len_samples(), 0);
        assert!(decode_buffer.is_finished());
        assert!(render_queue.is_finished());
        assert!(matches!(engine.playback_state, PlaybackState::Loading));
    }

    #[test]
    fn play_recovers_by_reloading_when_sink_was_released() {
        let backend: Arc<dyn AudioOutputBackend> =
            Arc::new(TransportModeBackend::new("rodio-cpal"));
        let mut engine = NativeAudioEngine::new_with_backend(backend);

        let temp_name = format!(
            "pmpm-play-recover-{}.wav",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        );
        let path = std::env::temp_dir().join(temp_name);
        write_wav_i16_stereo(&path, 48_000, 4_800);

        engine.current_track = Some(path.clone());
        engine.active_input_id = None;
        engine.sink = None;
        engine.mixer = None;
        engine.streaming = None;
        engine.decoded_samples = None;

        let play_result = engine.play();
        let _ = std::fs::remove_file(&path);

        assert!(
            play_result.is_ok(),
            "play should reload track when sink was released"
        );
        assert!(
            engine.sink.is_some(),
            "play should restore sink via lazy reload"
        );
        assert!(
            matches!(
                engine.playback_state,
                PlaybackState::Playing | PlaybackState::Buffering
            ),
            "playback should transition into active state after reload"
        );
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

    struct SlowDropSink {
        stop_calls: Arc<AtomicUsize>,
        dropped: Arc<AtomicBool>,
    }

    impl Drop for SlowDropSink {
        fn drop(&mut self) {
            std::thread::sleep(Duration::from_millis(180));
            self.dropped.store(true, Ordering::Release);
        }
    }

    impl AudioSink for SlowDropSink {
        fn append(&self, _source: crate::audio::output::BoxedSource) {}

        fn play(&self) {}

        fn pause(&self) {}

        fn stop(&self) {
            self.stop_calls.fetch_add(1, Ordering::Release);
        }

        fn empty(&self) -> bool {
            true
        }

        fn set_volume(&self, _value: f32) {}
    }

    #[test]
    fn release_cached_audio_pipeline_does_not_block_on_sink_drop() {
        let backend: Arc<dyn AudioOutputBackend> =
            Arc::new(TransportModeBackend::new("rodio-cpal"));
        let mut engine = NativeAudioEngine::new_with_backend(backend);

        let stop_calls = Arc::new(AtomicUsize::new(0));
        let dropped = Arc::new(AtomicBool::new(false));
        engine.sink = Some(Arc::new(SlowDropSink {
            stop_calls: stop_calls.clone(),
            dropped: dropped.clone(),
        }));

        let started = Instant::now();
        engine.release_cached_audio_pipeline();
        let elapsed = started.elapsed();
        assert!(
            elapsed < Duration::from_millis(120),
            "release_cached_audio_pipeline should stay non-blocking, elapsed={elapsed:?}"
        );
        assert_eq!(
            stop_calls.load(Ordering::Acquire),
            1,
            "sink stop should still be invoked before retirement"
        );

        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if dropped.load(Ordering::Acquire) {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }

        assert!(
            dropped.load(Ordering::Acquire),
            "retire plane should eventually drop retired sink"
        );
    }

    #[test]
    fn resolve_runtime_release_mode_prefers_inline_for_heavy_buffers_or_backlog() {
        assert_eq!(
            resolve_runtime_release_mode_with_thresholds(16 * 1024 * 1024, 0, 4 * 1024 * 1024, 0),
            RuntimeReleaseMode::Inline
        );
        assert_eq!(
            resolve_runtime_release_mode_with_thresholds(0, 2, 4 * 1024 * 1024, 0),
            RuntimeReleaseMode::Inline
        );
        assert_eq!(
            resolve_runtime_release_mode_with_thresholds(512 * 1024, 0, 4 * 1024 * 1024, 0),
            RuntimeReleaseMode::Deferred
        );
    }

    #[test]
    fn clear_queue_state_empty_blocks_until_slow_sink_is_dropped() {
        let backend_impl = Arc::new(TransportModeBackend::new("rodio-cpal"));
        let backend: Arc<dyn AudioOutputBackend> = backend_impl.clone();
        let mut engine = NativeAudioEngine::new_with_backend(backend);

        let stop_calls = Arc::new(AtomicUsize::new(0));
        let dropped = Arc::new(AtomicBool::new(false));
        engine.queue = vec![PathBuf::from("queue-track-a.wav")];
        engine.current_track = Some(PathBuf::from("queue-track-a.wav"));
        engine.current_index = 0;
        engine.sink = Some(Arc::new(SlowDropSink {
            stop_calls: stop_calls.clone(),
            dropped: dropped.clone(),
        }));
        engine.streaming = Some(make_finished_streaming_playback(131_072, 2));
        engine.decoded_samples = Some(Arc::new(vec![0.0f32; 96_000]));
        engine.decoded_channels = 2;
        engine.decoded_sample_rate = 48_000;
        engine.playback_state = PlaybackState::Paused;
        engine.desired_playback_state = PlaybackState::Paused;

        let started = Instant::now();
        engine.clear_queue_state();
        let elapsed = started.elapsed();

        assert!(
            elapsed >= Duration::from_millis(150),
            "empty queue should synchronously drain old sink on cold idle, elapsed={elapsed:?}"
        );
        assert_eq!(stop_calls.load(Ordering::Acquire), 1);
        assert!(
            dropped.load(Ordering::Acquire),
            "slow sink should already be dropped before clear_queue_state returns"
        );
        assert_eq!(backend_impl.close_stream_calls.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn clear_queue_state_empty_aggressively_cools_runtime_state() {
        let backend_impl = Arc::new(TransportModeBackend::new("rodio-cpal"));
        let backend: Arc<dyn AudioOutputBackend> = backend_impl.clone();
        let mut engine = NativeAudioEngine::new_with_backend(backend);

        let sink = Arc::new(CallSink::default());
        let initial_source = Box::new(SharedSamplesSource::new(
            Arc::new(vec![0.0f32; 4_096]),
            2,
            48_000,
            0,
        )) as crate::audio::output::BoxedSource;
        let (controller, _mixer_source) = PlaybackMixerSource::new(initial_source, 2, 48_000);

        engine.queue = vec![PathBuf::from("queue-track-a.wav")];
        engine.current_track = Some(PathBuf::from("queue-track-a.wav"));
        engine.current_index = 0;
        engine.sink = Some(sink.clone());
        engine.mixer = Some(controller);
        engine.streaming = Some(make_finished_streaming_playback(131_072, 2));
        engine.decoded_samples = Some(Arc::new(vec![0.0f32; 96_000]));
        engine.decoded_channels = 2;
        engine.decoded_sample_rate = 48_000;
        engine.duration = 123.0;
        engine.playback_state = PlaybackState::Paused;
        engine.desired_playback_state = PlaybackState::Paused;

        engine.clear_queue_state();

        assert!(engine.queue.is_empty());
        assert!(engine.current_track.is_none());
        assert!(engine.sink.is_none());
        assert!(engine.mixer.is_none());
        assert!(engine.streaming.is_none());
        assert!(engine.decoded_samples.is_none());
        assert_eq!(engine.decoded_channels, 0);
        assert_eq!(engine.decoded_sample_rate, 0);
        assert_eq!(engine.duration, 0.0);
        assert!(matches!(engine.playback_state, PlaybackState::Stopped));
        assert!(
            sink.flush_calls.load(Ordering::Acquire) >= 1,
            "empty queue should flush sink before retirement"
        );
        assert_eq!(
            backend_impl.close_stream_calls.load(Ordering::Relaxed),
            1,
            "empty queue should close output stream for cold idle"
        );
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
        close_stream_calls: Arc<AtomicUsize>,
    }

    impl TransportModeBackend {
        fn new(id: &'static str) -> Self {
            Self {
                id,
                sink: Arc::new(CallSink::default()),
                transport_mode_calls: Arc::new(AtomicUsize::new(0)),
                close_stream_calls: Arc::new(AtomicUsize::new(0)),
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

        fn close_stream(&self) {
            self.close_stream_calls.fetch_add(1, Ordering::Relaxed);
        }

        fn set_transport_mode(&self, _mode: NativeAudioTransportMode) {
            self.transport_mode_calls.fetch_add(1, Ordering::Relaxed);
        }
    }

    struct RecoveringOutputBackend {
        output_error: Mutex<Option<AudioOutputError>>,
        select_device_calls: AtomicUsize,
        create_sink_calls: AtomicUsize,
        last_created_sink: Mutex<Option<Arc<CallSink>>>,
    }

    impl RecoveringOutputBackend {
        fn new(output_error: AudioOutputError) -> Self {
            Self {
                output_error: Mutex::new(Some(output_error)),
                select_device_calls: AtomicUsize::new(0),
                create_sink_calls: AtomicUsize::new(0),
                last_created_sink: Mutex::new(None),
            }
        }
    }

    impl AudioOutputBackend for RecoveringOutputBackend {
        fn id(&self) -> &'static str {
            "wasapi-exclusive"
        }

        fn list_devices(&self) -> Result<Vec<String>, String> {
            Ok(vec!["Recovered Device".to_string()])
        }

        fn default_device_name(&self) -> Option<String> {
            Some("Recovered Device".to_string())
        }

        fn current_info(&self) -> OutputStreamInfo {
            OutputStreamInfo {
                device_id: Some("recovered-device-id".to_string()),
                device_name: Some("Recovered Device".to_string()),
                output_sample_rate: Some(48_000),
            }
        }

        fn is_stream_open(&self) -> bool {
            true
        }

        fn select_device(&self, _device_name: Option<String>) -> Result<OutputStreamInfo, String> {
            self.select_device_calls.fetch_add(1, Ordering::Relaxed);
            Ok(self.current_info())
        }

        fn create_sink(&self) -> Result<(Arc<dyn AudioSink>, OutputStreamInfo), String> {
            self.create_sink_calls.fetch_add(1, Ordering::Relaxed);
            let sink = Arc::new(CallSink::default());
            if let Ok(mut guard) = self.last_created_sink.lock() {
                *guard = Some(sink.clone());
            }
            Ok((sink, self.current_info()))
        }

        fn take_error(&self) -> Option<AudioOutputError> {
            self.output_error.lock().ok()?.take()
        }
    }

    struct DefaultFollowingOutputBackend {
        current_info: Mutex<OutputStreamInfo>,
        default_info: Mutex<OutputStreamInfo>,
        select_device_calls: AtomicUsize,
        create_sink_calls: AtomicUsize,
        last_created_sink: Mutex<Option<Arc<CallSink>>>,
    }

    impl DefaultFollowingOutputBackend {
        fn new(current_info: OutputStreamInfo, default_info: OutputStreamInfo) -> Self {
            Self {
                current_info: Mutex::new(current_info),
                default_info: Mutex::new(default_info),
                select_device_calls: AtomicUsize::new(0),
                create_sink_calls: AtomicUsize::new(0),
                last_created_sink: Mutex::new(None),
            }
        }

        fn set_default_info(&self, output_info: OutputStreamInfo) {
            if let Ok(mut guard) = self.default_info.lock() {
                *guard = output_info;
            }
        }
    }

    impl AudioOutputBackend for DefaultFollowingOutputBackend {
        fn id(&self) -> &'static str {
            "wasapi-shared-raw"
        }

        fn list_devices(&self) -> Result<Vec<String>, String> {
            let default_name = self
                .default_info
                .lock()
                .ok()
                .and_then(|guard| guard.device_name.clone());
            Ok(default_name.into_iter().collect())
        }

        fn default_device_name(&self) -> Option<String> {
            self.default_info
                .lock()
                .ok()
                .and_then(|guard| guard.device_name.clone())
        }

        fn default_device_info(&self) -> OutputStreamInfo {
            self.default_info
                .lock()
                .ok()
                .map(|guard| guard.clone())
                .unwrap_or_default()
        }

        fn current_info(&self) -> OutputStreamInfo {
            self.current_info
                .lock()
                .ok()
                .map(|guard| guard.clone())
                .unwrap_or_default()
        }

        fn is_stream_open(&self) -> bool {
            true
        }

        fn select_device(&self, _device_name: Option<String>) -> Result<OutputStreamInfo, String> {
            self.select_device_calls.fetch_add(1, Ordering::Relaxed);
            let output_info = self.default_device_info();
            if let Ok(mut guard) = self.current_info.lock() {
                *guard = output_info.clone();
            }
            Ok(output_info)
        }

        fn create_sink(&self) -> Result<(Arc<dyn AudioSink>, OutputStreamInfo), String> {
            self.create_sink_calls.fetch_add(1, Ordering::Relaxed);
            let sink = Arc::new(CallSink::default());
            if let Ok(mut guard) = self.last_created_sink.lock() {
                *guard = Some(sink.clone());
            }
            Ok((sink, self.current_info()))
        }
    }

    #[test]
    fn tick_recovers_from_device_disconnect_output_error() {
        let backend_impl = Arc::new(RecoveringOutputBackend::new(AudioOutputError {
            code: "AUDIO_OUTPUT_WASAPI_EXCLUSIVE_RENDER_FAILED",
            message:
                "The requested device is no longer available. For example, it has been unplugged."
                    .to_string(),
        }));
        let backend: Arc<dyn AudioOutputBackend> = backend_impl.clone();
        let mut engine = NativeAudioEngine::new_with_backend(backend);

        engine.current_track = Some(PathBuf::from("dummy.wav"));
        engine.decoded_samples = Some(Arc::new(vec![0.0f32; 96_000]));
        engine.decoded_channels = 2;
        engine.decoded_sample_rate = 48_000;
        engine.duration = 120.0;
        engine.current_position = 12.5;
        engine.base_position = 12.5;
        engine.playback_state = PlaybackState::Playing;
        engine.desired_playback_state = PlaybackState::Playing;
        engine.playback_started_at = Some(Instant::now() - Duration::from_millis(120));
        engine.sink = Some(Arc::new(CallSink::default()));

        let ticked = engine.tick();
        assert!(ticked);
        assert_eq!(
            backend_impl.select_device_calls.load(Ordering::Relaxed),
            1,
            "tick should reselect default output device after disconnect"
        );
        assert!(
            backend_impl.create_sink_calls.load(Ordering::Relaxed) >= 1,
            "tick should rebuild sink after recovery"
        );
        assert!(matches!(engine.playback_state, PlaybackState::Playing));
        assert!(
            engine.last_error_code.is_none(),
            "successful recovery should clear output error"
        );
        assert_eq!(engine.device_name.as_deref(), Some("Recovered Device"));

        let recovered_sink = backend_impl
            .last_created_sink
            .lock()
            .expect("sink lock")
            .clone()
            .expect("recovered sink");
        assert!(
            recovered_sink.play_calls.load(Ordering::Relaxed) > 0,
            "recovered sink should resume playback"
        );
    }

    #[test]
    fn tick_follows_system_default_output_route_changes_without_disconnect_error() {
        let backend_impl = Arc::new(DefaultFollowingOutputBackend::new(
            OutputStreamInfo {
                device_id: Some("old-device-id".to_string()),
                device_name: Some("Old Device".to_string()),
                output_sample_rate: Some(48_000),
            },
            OutputStreamInfo {
                device_id: Some("old-device-id".to_string()),
                device_name: Some("Old Device".to_string()),
                output_sample_rate: Some(48_000),
            },
        ));
        let backend: Arc<dyn AudioOutputBackend> = backend_impl.clone();
        let mut engine = NativeAudioEngine::new_with_backend(backend);

        engine.current_track = Some(PathBuf::from("dummy.wav"));
        engine.decoded_samples = Some(Arc::new(vec![0.0f32; 96_000]));
        engine.decoded_channels = 2;
        engine.decoded_sample_rate = 48_000;
        engine.duration = 120.0;
        engine.current_position = 8.0;
        engine.base_position = 8.0;
        engine.playback_state = PlaybackState::Playing;
        engine.desired_playback_state = PlaybackState::Playing;
        engine.playback_started_at = Some(Instant::now() - Duration::from_millis(120));
        engine.sink = Some(Arc::new(CallSink::default()));
        engine.device_id = Some("old-device-id".to_string());
        engine.device_name = Some("Old Device".to_string());

        backend_impl.set_default_info(OutputStreamInfo {
            device_id: Some("new-device-id".to_string()),
            device_name: Some("New Device".to_string()),
            output_sample_rate: Some(96_000),
        });

        let ticked = engine.tick();
        assert!(ticked);
        assert_eq!(backend_impl.select_device_calls.load(Ordering::Relaxed), 1);
        assert!(backend_impl.create_sink_calls.load(Ordering::Relaxed) >= 1);
        assert_eq!(engine.device_id.as_deref(), Some("new-device-id"));
        assert_eq!(engine.device_name.as_deref(), Some("New Device"));
        assert_eq!(engine.output_sample_rate, Some(96_000));
        assert!(matches!(engine.playback_state, PlaybackState::Playing));

        let recovered_sink = backend_impl
            .last_created_sink
            .lock()
            .expect("sink lock")
            .clone()
            .expect("recovered sink");
        assert!(recovered_sink.play_calls.load(Ordering::Relaxed) > 0);
    }

    #[test]
    fn build_components_payload_falls_back_to_system_default_route_when_idle() {
        let backend: Arc<dyn AudioOutputBackend> = Arc::new(DefaultFollowingOutputBackend::new(
            OutputStreamInfo::default(),
            OutputStreamInfo {
                device_id: Some("system-default-id".to_string()),
                device_name: Some("System Default".to_string()),
                output_sample_rate: None,
            },
        ));
        let engine = NativeAudioEngine::new_with_backend(backend);

        let payload = engine.build_components_payload();
        assert_eq!(
            payload.output_device_id.as_deref(),
            Some("system-default-id")
        );
        assert_eq!(payload.output_device.as_deref(), Some("System Default"));
    }

    #[test]
    fn tick_keeps_error_for_non_disconnect_output_failure() {
        let backend_impl = Arc::new(RecoveringOutputBackend::new(AudioOutputError {
            code: "AUDIO_OUTPUT_WASAPI_EXCLUSIVE_UNSUPPORTED_FORMAT",
            message: "Unsupported format".to_string(),
        }));
        let backend: Arc<dyn AudioOutputBackend> = backend_impl.clone();
        let mut engine = NativeAudioEngine::new_with_backend(backend);

        engine.sink = Some(Arc::new(CallSink::default()));

        let ticked = engine.tick();
        assert!(ticked);
        assert_eq!(backend_impl.select_device_calls.load(Ordering::Relaxed), 0);
        assert!(matches!(engine.playback_state, PlaybackState::Error));
        assert_eq!(
            engine.last_error_code.as_deref(),
            Some("NATIVE_AUDIO_OUTPUT_ERROR")
        );
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

        let (command_tx, _command_rx) =
            crate::audio::control_plane::command_channel::<DecoderCommand>();
        let (transfer_tx, _transfer_rx) = crate::audio::control_plane::command_channel();
        StreamingPlayback {
            buffer,
            render_queue,
            shutdown_tx: StreamingShutdownTx::new(command_tx.clone(), transfer_tx),
            command_tx,
            error: Arc::new(Mutex::new(None)),
        }
    }

    fn make_active_streaming_playback(
        capacity_samples: usize,
        channels: usize,
    ) -> StreamingPlayback {
        let buffer = crate::audio::buffer::AudioRingBuffer::new(capacity_samples);
        let render_queue = crate::audio::buffer::AudioRingBuffer::new(
            (capacity_samples / 4).clamp(16_384, 262_144),
        );
        let samples = vec![0.1f32; channels * 16];
        buffer.push_interleaved(&samples, channels);
        render_queue.push_interleaved(&samples, channels);

        let (command_tx, _command_rx) =
            crate::audio::control_plane::command_channel::<DecoderCommand>();
        let (transfer_tx, _transfer_rx) = crate::audio::control_plane::command_channel();
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

    fn make_prepared_load_fixture(
        track_path: &str,
        sink: Arc<dyn AudioSink>,
        channels: u16,
        sample_rate: u32,
    ) -> PreparedLoad {
        let decoded = Arc::new(vec![0.0f32; channels as usize * 1024]);
        let source = Box::new(SharedSamplesSource::new(
            decoded.clone(),
            channels,
            sample_rate,
            0,
        )) as crate::audio::output::BoxedSource;
        let (mixer, _mixer_source) = PlaybackMixerSource::new(source, channels, sample_rate);

        PreparedLoad {
            track_path: PathBuf::from(track_path),
            sink,
            output_info: OutputStreamInfo {
                device_id: Some("fixture-device-id".to_string()),
                device_name: Some("fixture-device-name".to_string()),
                output_sample_rate: Some(sample_rate),
            },
            mixer,
            input_id: super::SYMPHONIA_INPUT_ID,
            meta: crate::audio::input::AudioInputMeta {
                channels,
                sample_rate,
                source_sample_rate: sample_rate,
                bit_depth: Some(24),
                duration: 180.0,
            },
            streaming: None,
            decoded_samples: Some(decoded),
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
        let expected_shared_start = ((samples_per_second as f64) * 0.55f64).ceil() as usize;
        let expected_shared_cross = ((samples_per_second as f64) * 0.95f64).ceil() as usize;
        let expected_exclusive_start = ((samples_per_second as f64) * 0.28f64).ceil() as usize;
        let expected_exclusive_cross = ((samples_per_second as f64) * 1.10f64).ceil() as usize;
        assert_eq!(shared_start_samples, expected_shared_start);
        assert_eq!(shared_cross_samples, expected_shared_cross);
        assert_eq!(exclusive_start_samples, expected_exclusive_start);
        assert_eq!(exclusive_cross_samples, expected_exclusive_cross);
    }

    #[test]
    fn interactive_prebuffer_wait_caps_start_seek_to_sub_second_target() {
        let sample_rate = 48_000u32;
        let channels = 2usize;
        let capacity = sample_rate as usize * channels * 10;

        let (target_samples, timeout) = streaming_prebuffer_interactive_wait(
            "rodio-cpal",
            sample_rate,
            channels,
            capacity,
            120.0,
            StreamingPrebufferKind::StartOrSeek,
            Some(4.0),
        );

        assert!(target_samples > 0);
        assert!(target_samples <= (sample_rate as usize * channels * 11) / 20);
        assert!(timeout <= Duration::from_millis(352));
    }

    #[test]
    fn interactive_prebuffer_wait_caps_crossfade_to_short_timeout() {
        let sample_rate = 48_000u32;
        let channels = 2usize;
        let capacity = sample_rate as usize * channels * 10;

        let (target_samples, timeout) = streaming_prebuffer_interactive_wait(
            "rodio-cpal",
            sample_rate,
            channels,
            capacity,
            120.0,
            StreamingPrebufferKind::Crossfade,
            Some(3.0),
        );

        assert!(target_samples > 0);
        assert!(target_samples <= (sample_rate as usize * channels * 17) / 20);
        assert!(timeout <= Duration::from_millis(512));
    }

    #[test]
    fn default_decode_mode_is_streaming() {
        let engine = NativeAudioEngine::new();
        assert_eq!(
            engine.streaming_buffer_settings_payload().decode_mode,
            "streaming"
        );
        assert_eq!(
            engine.current_decode_mode(),
            AudioInputDecodeMode::Streaming
        );
    }

    #[test]
    fn replay_gain_update_does_not_implicitly_toggle_dynamic_gain() {
        let mut engine = NativeAudioEngine::new();

        engine.set_dynamic_gain_enabled(false);
        engine.set_replay_gain(Some(-6.0));
        assert!(!engine.dsp_runtime.dynamic_gain_enabled());

        engine.set_replay_gain(None);
        assert!(!engine.dsp_runtime.dynamic_gain_enabled());

        engine.set_dynamic_gain_enabled(true);
        engine.set_replay_gain(Some(0.0));
        assert!(engine.dsp_runtime.dynamic_gain_enabled());
    }

    #[test]
    fn streaming_buffer_settings_updates_interactive_profile() {
        let mut engine = NativeAudioEngine::new();
        engine.set_streaming_buffer_settings(None, None, None, Some("stable"));

        assert_eq!(
            engine
                .streaming_buffer_settings_payload()
                .interactive_profile,
            "stable"
        );

        let policy = engine.interactive_prebuffer_wait_policy();
        assert_eq!(policy.start_seek_timeout_ms, 320);
        assert_eq!(policy.crossfade_timeout_ms, 450);

        engine.set_streaming_buffer_settings(None, None, None, Some("invalid"));
        assert_eq!(
            engine
                .streaming_buffer_settings_payload()
                .interactive_profile,
            "stable"
        );
    }

    #[test]
    fn streaming_min_start_bounds_allow_fast_click_to_play() {
        let (shared_cap, shared_floor) = streaming_min_start_bounds("rodio-cpal", false);
        let (exclusive_cap, exclusive_floor) =
            streaming_min_start_bounds("wasapi-exclusive", false);

        assert!(
            shared_cap >= shared_floor,
            "shared backend bounds must be ordered: cap={shared_cap} floor={shared_floor}"
        );
        assert!(
            exclusive_cap >= exclusive_floor,
            "exclusive backend bounds must be ordered: cap={exclusive_cap} floor={exclusive_floor}"
        );

        let (shared_recovery_cap, shared_recovery_floor) =
            streaming_min_start_bounds("rodio-cpal", true);
        let (exclusive_recovery_cap, exclusive_recovery_floor) =
            streaming_min_start_bounds("wasapi-exclusive", true);
        assert!(
            shared_recovery_cap >= shared_cap,
            "recovery cap should not be lower than normal cap"
        );
        assert!(
            shared_recovery_floor >= shared_floor,
            "recovery floor should not be lower than normal floor"
        );
        assert!(
            exclusive_recovery_cap >= exclusive_cap,
            "recovery cap should not be lower than normal cap"
        );
        assert!(
            exclusive_recovery_floor >= exclusive_floor,
            "recovery floor should not be lower than normal floor"
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
            engine.set_streaming_buffer_settings(Some(0.2), Some(0.1), Some(decode_mode), None);

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
            stability_profile: Some(NativeAudioStabilityProfile::Stable),
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
            next.stability_profile,
            NativeAudioStabilityProfile::Stable
        ));
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
    fn load_operation_latest_token_wins_and_stale_prepare_is_aborted() {
        let backend: Arc<dyn AudioOutputBackend> = Arc::new(StaticBackend("rodio-cpal"));
        let mut engine = NativeAudioEngine::new_with_backend(backend);

        let stale_op = engine.begin_load_operation();
        let stale_sink = Arc::new(FlagSink::default());
        let stale_sink_dyn: Arc<dyn AudioSink> = stale_sink.clone();
        let stale_prepared = make_prepared_load_fixture("stale.wav", stale_sink_dyn, 2, 48_000);

        let latest_op = engine.begin_load_operation();
        let latest_sink = Arc::new(FlagSink::default());
        let latest_sink_dyn: Arc<dyn AudioSink> = latest_sink.clone();
        let latest_prepared = make_prepared_load_fixture("latest.wav", latest_sink_dyn, 2, 48_000);

        let latest_committed = engine
            .commit_load_operation(latest_op.token, latest_prepared)
            .expect("latest load commit should succeed");
        assert!(latest_committed);
        assert_eq!(
            engine.current_track.as_deref(),
            Some(Path::new("latest.wav"))
        );

        let stale_committed = engine
            .commit_load_operation(stale_op.token, stale_prepared)
            .expect("stale load commit should return false");
        assert!(!stale_committed);
        assert!(
            stale_sink.stopped.load(Ordering::Acquire),
            "stale prepared sink should be stopped during abort"
        );
        assert!(
            !latest_sink.stopped.load(Ordering::Acquire),
            "latest committed sink must remain active"
        );
        assert_eq!(
            engine.current_track.as_deref(),
            Some(Path::new("latest.wav"))
        );
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

        let (command_tx, command_rx) =
            crate::audio::control_plane::command_channel::<DecoderCommand>();
        drop(command_rx);
        let (transfer_tx, _transfer_rx) = crate::audio::control_plane::command_channel();

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
                engine.set_streaming_buffer_settings(Some(0.2), Some(0.1), Some(decode_mode), None);
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

                    let (command_tx, command_rx) =
                        crate::audio::control_plane::command_channel::<DecoderCommand>();
                    drop(command_rx);
                    let (transfer_tx, _transfer_rx) =
                        crate::audio::control_plane::command_channel();
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
    fn switch_output_backend_resets_recovery_tracking_after_success() {
        let old_backend = Arc::new(TransportModeBackend::new("old"));
        let mut engine = NativeAudioEngine::new_with_backend(old_backend.clone());

        engine.underrun_recovery_until = Some(Instant::now() + Duration::from_secs(10));
        engine.shared_timeline_stress_until = Some(Instant::now() + Duration::from_secs(10));
        engine.buffering_started_at = Some(Instant::now() - Duration::from_secs(2));
        engine.buffering_last_progress_at = Some(Instant::now() - Duration::from_secs(2));
        engine.buffering_last_samples = 12_345;
        engine.shared_timeline_stress_ignore_before_ms = 0;

        let switched_backend: Arc<dyn AudioOutputBackend> =
            Arc::new(TransportModeBackend::new("new"));
        engine
            .switch_output_backend(switched_backend)
            .expect("backend switch should succeed");

        assert_eq!(engine.output_backend.id(), "new");
        assert!(engine.underrun_recovery_until.is_none());
        assert!(engine.shared_timeline_stress_until.is_none());
        assert!(engine.buffering_started_at.is_none());
        assert!(engine.buffering_last_progress_at.is_none());
        assert_eq!(engine.buffering_last_samples, 0);
        assert!(
            engine.shared_timeline_stress_ignore_before_ms
                > crate::audio::diagnostics::current_timestamp_ms()
        );
    }

    #[test]
    fn shared_timeline_stress_window_gets_extended_by_diagnostics() {
        let backend: Arc<dyn AudioOutputBackend> = Arc::new(StaticBackend("wasapi"));
        let mut engine = NativeAudioEngine::new_with_backend(backend);

        // Diagnostics recording is best-effort (`try_lock`); under parallel test load some events
        // can be dropped. Retry recording/updating a few rounds to make the assertion stable.
        for _ in 0..8 {
            for index in 0..32 {
                let kind = match index % 3 {
                    0 => "shared.transfer.render_low_watermark",
                    1 => "shared.transfer.decode_low_watermark",
                    _ => "shared.render_ahead.low_watermark",
                };
                crate::audio::diagnostics::record_event(kind, 128, 512);
            }
            engine.update_shared_timeline_stress_window();
            if engine.shared_timeline_stress_until.is_some() {
                break;
            }
            std::thread::yield_now();
        }

        assert!(engine.shared_timeline_stress_until.is_some());
    }

    #[test]
    fn extended_tick_payload_keeps_diagnostics_but_omits_queue() {
        let backend: Arc<dyn AudioOutputBackend> = Arc::new(StaticBackend("wasapi"));
        let mut engine = NativeAudioEngine::new_with_backend(backend);
        engine.current_track = Some(PathBuf::from("queue-track-a.wav"));
        engine.queue_initialized = true;
        engine.queue = vec![
            PathBuf::from("queue-track-a.wav"),
            PathBuf::from("queue-track-b.wav"),
        ];
        engine.current_index = 0;

        crate::audio::diagnostics::record_event("shared.transfer.render_low_watermark", 64, 128);
        let payload = engine.build_extended_tick_state_payload(false);

        assert_eq!(payload.track_path.as_deref(), Some("queue-track-a.wav"));
        assert!(payload.queue.is_none());
        assert!(payload.diagnostic_timeline.is_some());
    }

    #[test]
    fn transport_payload_omits_queue_and_diagnostics() {
        let backend: Arc<dyn AudioOutputBackend> = Arc::new(StaticBackend("wasapi"));
        let mut engine = NativeAudioEngine::new_with_backend(backend);
        engine.current_track = Some(PathBuf::from("queue-track-a.wav"));
        engine.queue_initialized = true;
        engine.queue = vec![PathBuf::from("queue-track-a.wav")];
        engine.current_index = 0;

        let payload = engine.build_transport_state_payload(false);
        assert_eq!(payload.track_path.as_deref(), Some("queue-track-a.wav"));
        assert!(payload.queue.is_none());
        assert!(payload.diagnostic_timeline.is_none());
        assert!(payload.diagnostic_timeline_dropped_events.is_none());
    }
}
