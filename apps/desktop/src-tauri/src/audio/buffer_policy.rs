use once_cell::sync::Lazy;
use std::time::Duration;

use crate::audio::realtime_scheduler::RealtimePressureProfile;

const DEFAULT_SAMPLE_RATE: u32 = 48_000;
const DEFAULT_RENDER_QUEUE_SECONDS: f64 = 1.2;
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
    normal_ms: parse_env_u64("PMP_AUDIO_SOURCE_POP_WAIT_NORMAL_MS", 1, 0, 12),
    guarded_ms: parse_env_u64("PMP_AUDIO_SOURCE_POP_WAIT_GUARDED_MS", 2, 0, 12),
    critical_ms: parse_env_u64("PMP_AUDIO_SOURCE_POP_WAIT_CRITICAL_MS", 3, 0, 12),
});

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
        RealtimePressureProfile::Normal => Duration::from_millis(2),
        RealtimePressureProfile::Guarded => Duration::from_millis(1),
        RealtimePressureProfile::Critical => Duration::from_millis(0),
    }
}

pub(crate) fn output_producer_chunk_samples(profile: RealtimePressureProfile) -> usize {
    match profile {
        RealtimePressureProfile::Normal => 8_192,
        RealtimePressureProfile::Guarded => 12_288,
        RealtimePressureProfile::Critical => 16_384,
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
        RealtimePressureProfile::Normal => (30usize, 85usize),
        RealtimePressureProfile::Guarded => (40usize, 90usize),
        RealtimePressureProfile::Critical => (50usize, 95usize),
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
        parse_env_u64("PMP_AUDIO_WASAPI_SHARED_RAW_PREFILL_MS", 160, 20, 2000)
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
            180,
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
    let is_exclusive = output_backend_id == "wasapi-exclusive";

    if is_exclusive {
        if underrun_recovery_active {
            (0.75, 0.25)
        } else {
            (0.30, 0.10)
        }
    } else if underrun_recovery_active {
        (1.05, 0.35)
    } else {
        (0.35, 0.12)
    }
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
}
