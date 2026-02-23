use once_cell::sync::Lazy;
use std::time::Duration;

use crate::audio::realtime_scheduler::RealtimePressureProfile;

const DEFAULT_SAMPLE_RATE: u32 = 48_000;
const DEFAULT_RENDER_QUEUE_SECONDS: f64 = 1.8;
const MIN_RENDER_QUEUE_SECONDS: f64 = 0.2;
const MAX_RENDER_QUEUE_SECONDS: f64 = 4.0;
const MIN_RENDER_QUEUE_SAMPLES: usize = 16_384;
const MAX_RENDER_QUEUE_SAMPLES: usize = 1_048_576;

#[derive(Clone, Copy, Debug)]
struct SourcePopWaitPolicy {
    normal_ms: u64,
    guarded_ms: u64,
    critical_ms: u64,
}

fn parse_env_f64(key: &str, default_value: f64, min: f64, max: f64) -> f64 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<f64>().ok())
        .filter(|value| value.is_finite())
        .unwrap_or(default_value)
        .clamp(min, max)
}

fn parse_env_u64(key: &str, default_value: u64, min: u64, max: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(default_value)
        .clamp(min, max)
}

static SOURCE_POP_WAIT_POLICY: Lazy<SourcePopWaitPolicy> = Lazy::new(|| SourcePopWaitPolicy {
    normal_ms: parse_env_u64("PMP_AUDIO_SOURCE_POP_WAIT_NORMAL_MS", 2, 0, 16),
    guarded_ms: parse_env_u64("PMP_AUDIO_SOURCE_POP_WAIT_GUARDED_MS", 4, 0, 16),
    critical_ms: parse_env_u64("PMP_AUDIO_SOURCE_POP_WAIT_CRITICAL_MS", 6, 0, 16),
});

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TransferPressureBand {
    Low,
    Mid,
    High,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct TransferAdaptiveState {
    starvation_streak: u32,
    oscillation_streak: u32,
    stable_streak: u32,
    adaptation_level: u8,
    last_band: TransferPressureBand,
}

impl Default for TransferAdaptiveState {
    fn default() -> Self {
        Self {
            starvation_streak: 0,
            oscillation_streak: 0,
            stable_streak: 0,
            adaptation_level: 0,
            last_band: TransferPressureBand::Mid,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct AdaptiveTransferStrategy {
    pub low_watermark: usize,
    pub high_watermark: usize,
    pub chunk_limit: usize,
    pub producer_backoff: Duration,
    pub decode_idle_backoff: Duration,
    pub adaptation_level: u8,
    pub oscillation_streak: u32,
}

#[derive(Clone, Copy, Debug)]
struct BackendBufferPolicyPack {
    start_seek_prebuffer_seconds: f64,
    crossfade_prebuffer_seconds: f64,
    min_start_cap_seconds: f64,
    min_start_floor_seconds: f64,
    recovery_cap_seconds: f64,
    recovery_floor_seconds: f64,
    rebuffer_enter_divisor: usize,
    rebuffer_resume_divisor: usize,
    rebuffer_enter_floor_frames: usize,
    rebuffer_resume_floor_frames: usize,
}

fn backend_buffer_policy_pack(output_backend_id: &str) -> BackendBufferPolicyPack {
    match output_backend_id {
        "wasapi-exclusive" => BackendBufferPolicyPack {
            start_seek_prebuffer_seconds: 0.28,
            crossfade_prebuffer_seconds: 1.10,
            min_start_cap_seconds: 0.30,
            min_start_floor_seconds: 0.10,
            recovery_cap_seconds: 0.72,
            recovery_floor_seconds: 0.24,
            rebuffer_enter_divisor: 5,
            rebuffer_resume_divisor: 3,
            rebuffer_enter_floor_frames: 48,
            rebuffer_resume_floor_frames: 96,
        },
        "wasapi-shared-raw" => BackendBufferPolicyPack {
            start_seek_prebuffer_seconds: 0.35,
            crossfade_prebuffer_seconds: 0.88,
            min_start_cap_seconds: 0.40,
            min_start_floor_seconds: 0.14,
            recovery_cap_seconds: 0.95,
            recovery_floor_seconds: 0.35,
            rebuffer_enter_divisor: 4,
            rebuffer_resume_divisor: 3,
            rebuffer_enter_floor_frames: 64,
            rebuffer_resume_floor_frames: 128,
        },
        "rodio-cpal" => BackendBufferPolicyPack {
            start_seek_prebuffer_seconds: 0.55,
            crossfade_prebuffer_seconds: 0.95,
            min_start_cap_seconds: 0.75,
            min_start_floor_seconds: 0.25,
            recovery_cap_seconds: 1.80,
            recovery_floor_seconds: 0.65,
            rebuffer_enter_divisor: 2,
            rebuffer_resume_divisor: 1,
            rebuffer_enter_floor_frames: 128,
            rebuffer_resume_floor_frames: 256,
        },
        "wasapi" => BackendBufferPolicyPack {
            start_seek_prebuffer_seconds: 0.50,
            crossfade_prebuffer_seconds: 0.90,
            min_start_cap_seconds: 0.62,
            min_start_floor_seconds: 0.22,
            recovery_cap_seconds: 1.50,
            recovery_floor_seconds: 0.55,
            rebuffer_enter_divisor: 3,
            rebuffer_resume_divisor: 2,
            rebuffer_enter_floor_frames: 96,
            rebuffer_resume_floor_frames: 192,
        },
        _ => BackendBufferPolicyPack {
            start_seek_prebuffer_seconds: 0.35,
            crossfade_prebuffer_seconds: 0.50,
            min_start_cap_seconds: 0.35,
            min_start_floor_seconds: 0.12,
            recovery_cap_seconds: 1.05,
            recovery_floor_seconds: 0.35,
            rebuffer_enter_divisor: 4,
            rebuffer_resume_divisor: 2,
            rebuffer_enter_floor_frames: 64,
            rebuffer_resume_floor_frames: 128,
        },
    }
}

pub(crate) fn streaming_prebuffer_default_seconds(output_backend_id: &str, crossfade: bool) -> f64 {
    let pack = backend_buffer_policy_pack(output_backend_id);
    if crossfade {
        pack.crossfade_prebuffer_seconds
    } else {
        pack.start_seek_prebuffer_seconds
    }
}

fn classify_transfer_pressure_band(
    render_len: usize,
    low_watermark: usize,
    high_watermark: usize,
) -> TransferPressureBand {
    if render_len <= low_watermark {
        TransferPressureBand::Low
    } else if render_len >= high_watermark {
        TransferPressureBand::High
    } else {
        TransferPressureBand::Mid
    }
}

pub(crate) fn adaptive_transfer_strategy(
    capacity_samples: usize,
    channels: usize,
    profile: RealtimePressureProfile,
    render_len: usize,
    decode_len: usize,
    state: &mut TransferAdaptiveState,
) -> AdaptiveTransferStrategy {
    let channels = channels.max(1);
    let capacity = capacity_samples.max(channels);
    let (base_low, base_high) = streaming_transfer_watermarks(capacity, channels, profile);

    let band = classify_transfer_pressure_band(render_len, base_low, base_high);
    let starving = render_len <= base_low || decode_len <= base_low;

    if starving {
        state.starvation_streak = state.starvation_streak.saturating_add(1);
        state.stable_streak = 0;
    } else if matches!(band, TransferPressureBand::Mid) {
        state.stable_streak = state.stable_streak.saturating_add(1);
        state.starvation_streak = state.starvation_streak.saturating_sub(1);
    } else {
        state.stable_streak = 0;
        state.starvation_streak = state.starvation_streak.saturating_sub(1);
    }

    if !matches!(state.last_band, TransferPressureBand::Mid)
        && !matches!(band, TransferPressureBand::Mid)
        && state.last_band != band
    {
        state.oscillation_streak = state.oscillation_streak.saturating_add(1);
    } else {
        state.oscillation_streak = state.oscillation_streak.saturating_sub(1);
    }
    state.last_band = band;

    let starvation_level = if state.starvation_streak >= 6 {
        2
    } else if state.starvation_streak >= 2 {
        1
    } else {
        0
    };
    let oscillation_level = if state.oscillation_streak >= 6 { 1 } else { 0 };
    let target_level = starvation_level.max(oscillation_level) as u8;

    if target_level > state.adaptation_level {
        state.adaptation_level = target_level;
        state.stable_streak = 0;
    } else if target_level < state.adaptation_level && state.stable_streak >= 20 {
        state.adaptation_level = state.adaptation_level.saturating_sub(1);
        state.stable_streak = 0;
    }

    let (low_boost_percent, high_boost_percent, chunk_boost_frames) = match state.adaptation_level {
        0 => (0usize, 0usize, 0usize),
        1 => (12usize, 8usize, 1024usize),
        _ => (24usize, 14usize, 2048usize),
    };

    let low_watermark = ((base_low as u128)
        .saturating_add((capacity as u128).saturating_mul(low_boost_percent as u128) / 100)
        as usize)
        .min(capacity)
        .max(channels.saturating_mul(128));
    let mut high_watermark = ((base_high as u128)
        .saturating_add((capacity as u128).saturating_mul(high_boost_percent as u128) / 100)
        as usize)
        .min(capacity)
        .max(low_watermark);
    if high_watermark < low_watermark {
        high_watermark = low_watermark;
    }

    let chunk_limit = output_producer_chunk_samples(profile)
        .saturating_add(channels.saturating_mul(chunk_boost_frames))
        .min(capacity)
        .max(channels);

    let producer_backoff = if state.adaptation_level > 0 {
        Duration::from_millis(0)
    } else {
        output_producer_backoff(profile)
    };

    let decode_idle_backoff = if state.adaptation_level >= 2 {
        Duration::from_millis(1)
    } else {
        decode_push_backoff(profile).max(Duration::from_millis(2))
    };

    AdaptiveTransferStrategy {
        low_watermark,
        high_watermark,
        chunk_limit,
        producer_backoff,
        decode_idle_backoff,
        adaptation_level: state.adaptation_level,
        oscillation_streak: state.oscillation_streak,
    }
}

pub(crate) fn recommended_render_queue_capacity_samples(
    sample_rate: Option<u32>,
    channels: u16,
) -> usize {
    let seconds = parse_env_f64(
        "PMP_AUDIO_RENDER_QUEUE_SECONDS",
        DEFAULT_RENDER_QUEUE_SECONDS,
        MIN_RENDER_QUEUE_SECONDS,
        MAX_RENDER_QUEUE_SECONDS,
    );
    let sample_rate = sample_rate.unwrap_or(DEFAULT_SAMPLE_RATE).max(1) as f64;
    let channels = channels.max(1) as f64;
    ((sample_rate * channels * seconds).ceil() as usize)
        .clamp(MIN_RENDER_QUEUE_SAMPLES, MAX_RENDER_QUEUE_SAMPLES)
}

pub(crate) fn source_pop_wait_timeout(profile: RealtimePressureProfile) -> Duration {
    let policy = *SOURCE_POP_WAIT_POLICY;
    let wait_ms = match profile {
        RealtimePressureProfile::Normal => policy.normal_ms,
        RealtimePressureProfile::Guarded => policy.guarded_ms,
        RealtimePressureProfile::Critical => policy.critical_ms,
    };
    Duration::from_millis(wait_ms)
}

pub(crate) fn decode_push_backoff(profile: RealtimePressureProfile) -> Duration {
    match profile {
        RealtimePressureProfile::Normal => Duration::from_millis(1),
        RealtimePressureProfile::Guarded => Duration::from_millis(0),
        RealtimePressureProfile::Critical => Duration::from_millis(0),
    }
}

pub(crate) fn output_producer_chunk_samples(profile: RealtimePressureProfile) -> usize {
    match profile {
        RealtimePressureProfile::Normal => 12_288,
        RealtimePressureProfile::Guarded => 18_432,
        RealtimePressureProfile::Critical => 24_576,
    }
}

pub(crate) fn output_producer_backoff(profile: RealtimePressureProfile) -> Duration {
    match profile {
        RealtimePressureProfile::Normal => Duration::from_millis(1),
        RealtimePressureProfile::Guarded => Duration::from_millis(0),
        RealtimePressureProfile::Critical => Duration::from_millis(0),
    }
}

pub(crate) fn streaming_transfer_watermarks(
    capacity_samples: usize,
    channels: usize,
    profile: RealtimePressureProfile,
) -> (usize, usize) {
    let capacity = capacity_samples.max(channels.max(1));
    let (low_percent, high_percent) = match profile {
        RealtimePressureProfile::Normal => (36usize, 88usize),
        RealtimePressureProfile::Guarded => (52usize, 94usize),
        RealtimePressureProfile::Critical => (64usize, 97usize),
    };

    let low = ((capacity * low_percent) / 100)
        .max(channels * 128)
        .min(capacity);
    let mut high = ((capacity * high_percent) / 100)
        .max(channels * 256)
        .min(capacity);
    if high < low {
        high = low;
    }

    (low, high)
}

pub(crate) fn wasapi_start_prefill_samples(
    sample_rate: u32,
    channels: u16,
    buffer_frame_count: u32,
    shared_raw: bool,
) -> usize {
    let target_ms = if shared_raw {
        parse_env_u64("PMP_AUDIO_WASAPI_SHARED_RAW_PREFILL_MS", 200, 20, 2000)
    } else {
        parse_env_u64("PMP_AUDIO_WASAPI_EXCLUSIVE_PREFILL_MS", 120, 20, 2000)
    };

    let rate = sample_rate.max(1) as u128;
    let channels = channels.max(1) as usize;
    let frames_from_time = rate.saturating_mul(target_ms as u128).saturating_add(999) / 1000;
    let target_frames = (frames_from_time as usize)
        .max((buffer_frame_count as usize).saturating_mul(2))
        .max(64)
        .min((buffer_frame_count as usize).saturating_mul(16).max(1));

    target_frames.saturating_mul(channels)
}

pub(crate) fn wasapi_start_prefill_timeout(shared_raw: bool) -> Duration {
    let timeout_ms = if shared_raw {
        parse_env_u64(
            "PMP_AUDIO_WASAPI_SHARED_RAW_PREFILL_TIMEOUT_MS",
            220,
            40,
            3000,
        )
    } else {
        parse_env_u64(
            "PMP_AUDIO_WASAPI_EXCLUSIVE_PREFILL_TIMEOUT_MS",
            120,
            30,
            3000,
        )
    };
    Duration::from_millis(timeout_ms)
}

pub(crate) fn streaming_min_start_bounds(
    output_backend_id: &str,
    underrun_recovery_active: bool,
) -> (f64, f64) {
    let pack = backend_buffer_policy_pack(output_backend_id);
    if underrun_recovery_active {
        (pack.recovery_cap_seconds, pack.recovery_floor_seconds)
    } else {
        (pack.min_start_cap_seconds, pack.min_start_floor_seconds)
    }
}

pub(crate) fn runtime_rebuffer_threshold_samples(
    output_backend_id: &str,
    min_start_samples: usize,
    channels: usize,
) -> (usize, usize) {
    let pack = backend_buffer_policy_pack(output_backend_id);
    let channels = channels.max(1);
    let min_start_samples = min_start_samples.max(1);
    let hard_floor_enter = channels
        .saturating_mul(pack.rebuffer_enter_floor_frames.max(1))
        .max(1);
    let hard_floor_resume = channels
        .saturating_mul(pack.rebuffer_resume_floor_frames.max(1))
        .max(hard_floor_enter);

    let enter = (min_start_samples / pack.rebuffer_enter_divisor.max(1))
        .max(hard_floor_enter)
        .min(min_start_samples);
    let resume = (min_start_samples / pack.rebuffer_resume_divisor.max(1))
        .max(hard_floor_resume)
        .max(enter.saturating_add(channels.saturating_mul(32)))
        .min(min_start_samples)
        .max(enter);

    (enter, resume)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_queue_capacity_scales_with_sample_rate() {
        let low = recommended_render_queue_capacity_samples(Some(44_100), 2);
        let high = recommended_render_queue_capacity_samples(Some(96_000), 2);
        assert!(high > low);
        assert!(low >= MIN_RENDER_QUEUE_SAMPLES);
    }

    #[test]
    fn streaming_start_bounds_are_more_conservative_in_recovery() {
        let (normal_cap, normal_floor) = streaming_min_start_bounds("rodio-cpal", false);
        let (recovery_cap, recovery_floor) = streaming_min_start_bounds("rodio-cpal", true);
        assert!(recovery_cap >= normal_cap);
        assert!(recovery_floor >= normal_floor);
    }

    #[test]
    fn wasapi_prefill_scales_with_buffer_geometry() {
        let exclusive = wasapi_start_prefill_samples(48_000, 2, 512, false);
        let shared = wasapi_start_prefill_samples(48_000, 2, 512, true);
        assert!(exclusive >= 512 * 2 * 2);
        assert!(shared >= exclusive);
    }

    #[test]
    fn streaming_transfer_watermarks_increase_with_pressure() {
        let capacity = 96_000usize;
        let channels = 2usize;

        let (normal_low, normal_high) =
            streaming_transfer_watermarks(capacity, channels, RealtimePressureProfile::Normal);
        let (guarded_low, guarded_high) =
            streaming_transfer_watermarks(capacity, channels, RealtimePressureProfile::Guarded);
        let (critical_low, critical_high) =
            streaming_transfer_watermarks(capacity, channels, RealtimePressureProfile::Critical);

        assert!(normal_low <= guarded_low && guarded_low <= critical_low);
        assert!(normal_high <= guarded_high && guarded_high <= critical_high);
        assert!(critical_high <= capacity);
    }

    #[test]
    fn prebuffer_defaults_are_backend_specific() {
        let exclusive_start = streaming_prebuffer_default_seconds("wasapi-exclusive", false);
        let shared_start = streaming_prebuffer_default_seconds("rodio-cpal", false);
        let exclusive_crossfade = streaming_prebuffer_default_seconds("wasapi-exclusive", true);
        let shared_crossfade = streaming_prebuffer_default_seconds("rodio-cpal", true);

        assert!(exclusive_start < shared_start);
        assert!(exclusive_crossfade > shared_crossfade);
    }

    #[test]
    fn runtime_rebuffer_thresholds_track_backend_policy() {
        let min_start_samples = 33_600usize;

        let (exclusive_enter, exclusive_resume) =
            runtime_rebuffer_threshold_samples("wasapi-exclusive", min_start_samples, 2);
        let (shared_enter, shared_resume) =
            runtime_rebuffer_threshold_samples("rodio-cpal", min_start_samples, 2);

        assert!(exclusive_enter < shared_enter);
        assert!(exclusive_resume <= shared_resume);
    }

    #[test]
    fn shared_raw_policy_is_tighter_than_rodio_cpal() {
        let shared_raw_start = streaming_prebuffer_default_seconds("wasapi-shared-raw", false);
        let rodio_start = streaming_prebuffer_default_seconds("rodio-cpal", false);
        assert!(
            shared_raw_start < rodio_start,
            "shared-raw start prebuffer should be less than rodio-cpal"
        );

        let (shared_raw_cap, _) = streaming_min_start_bounds("wasapi-shared-raw", true);
        let (rodio_cap, _) = streaming_min_start_bounds("rodio-cpal", true);
        assert!(
            shared_raw_cap < rodio_cap,
            "shared-raw recovery cap should be less than rodio-cpal"
        );
    }

    #[test]
    fn shared_raw_rebuffer_thresholds_are_between_exclusive_and_rodio() {
        let min_start_samples = 33_600usize;
        let (exclusive_enter, exclusive_resume) =
            runtime_rebuffer_threshold_samples("wasapi-exclusive", min_start_samples, 2);
        let (shared_raw_enter, shared_raw_resume) =
            runtime_rebuffer_threshold_samples("wasapi-shared-raw", min_start_samples, 2);
        let (rodio_enter, rodio_resume) =
            runtime_rebuffer_threshold_samples("rodio-cpal", min_start_samples, 2);

        assert!(
            exclusive_enter <= shared_raw_enter,
            "exclusive enter should be <= shared-raw enter"
        );
        assert!(
            shared_raw_enter <= rodio_enter,
            "shared-raw enter should be <= rodio-cpal enter"
        );
        assert!(exclusive_resume <= shared_raw_resume);
        assert!(shared_raw_resume <= rodio_resume);
    }

    #[test]
    fn wasapi_shared_raw_prefill_is_larger_than_exclusive() {
        let exclusive = wasapi_start_prefill_samples(48_000, 2, 512, false);
        let shared_raw = wasapi_start_prefill_samples(48_000, 2, 512, true);
        assert!(
            shared_raw > exclusive,
            "shared-raw prefill should exceed exclusive prefill"
        );
    }

    #[test]
    fn adaptive_transfer_strategy_boosts_watermarks_when_starving() {
        let capacity = 96_000usize;
        let channels = 2usize;
        let mut state = TransferAdaptiveState::default();

        let (base_low, base_high) =
            streaming_transfer_watermarks(capacity, channels, RealtimePressureProfile::Guarded);

        let mut strategy = adaptive_transfer_strategy(
            capacity,
            channels,
            RealtimePressureProfile::Guarded,
            base_low / 2,
            base_low / 2,
            &mut state,
        );
        for _ in 0..8 {
            strategy = adaptive_transfer_strategy(
                capacity,
                channels,
                RealtimePressureProfile::Guarded,
                base_low / 2,
                base_low / 2,
                &mut state,
            );
        }

        assert!(strategy.adaptation_level >= 1);
        assert!(strategy.low_watermark >= base_low);
        assert!(strategy.high_watermark >= base_high);
        assert!(
            strategy.chunk_limit >= output_producer_chunk_samples(RealtimePressureProfile::Guarded)
        );
    }

    #[test]
    fn adaptive_transfer_strategy_decays_after_stable_mid_band() {
        let capacity = 96_000usize;
        let channels = 2usize;
        let mut state = TransferAdaptiveState::default();

        let (base_low, base_high) =
            streaming_transfer_watermarks(capacity, channels, RealtimePressureProfile::Normal);
        let mid = (base_low + base_high) / 2;

        for _ in 0..8 {
            let _ = adaptive_transfer_strategy(
                capacity,
                channels,
                RealtimePressureProfile::Normal,
                base_low / 2,
                base_low / 2,
                &mut state,
            );
        }
        assert!(state.adaptation_level >= 1);

        for _ in 0..40 {
            let _ = adaptive_transfer_strategy(
                capacity,
                channels,
                RealtimePressureProfile::Normal,
                mid,
                mid,
                &mut state,
            );
        }

        assert_eq!(state.adaptation_level, 0);
    }

    #[test]
    fn adaptive_transfer_strategy_detects_low_high_oscillation() {
        let capacity = 96_000usize;
        let channels = 2usize;
        let mut state = TransferAdaptiveState::default();
        let (base_low, base_high) =
            streaming_transfer_watermarks(capacity, channels, RealtimePressureProfile::Normal);

        for _ in 0..8 {
            let _ = adaptive_transfer_strategy(
                capacity,
                channels,
                RealtimePressureProfile::Normal,
                base_low.saturating_sub(channels),
                base_high,
                &mut state,
            );
            let _ = adaptive_transfer_strategy(
                capacity,
                channels,
                RealtimePressureProfile::Normal,
                base_high.saturating_add(channels),
                base_high,
                &mut state,
            );
        }

        assert!(state.oscillation_streak >= 1);
        assert!(state.adaptation_level >= 1);
    }
}
