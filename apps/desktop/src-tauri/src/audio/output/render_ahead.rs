use std::f32::consts::FRAC_PI_2;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use rodio::Source;

use crate::audio::buffer::AudioRingBuffer;
use crate::audio::buffer_policy;
use crate::audio::bulk_source::BulkSource;
use crate::audio::diagnostics;
use crate::audio::memory_pool;
use crate::audio::realtime_scheduler::RealtimePressureProfile;

use super::BoxedSource;

static SHARED_RENDER_UNDERRUN_EVENTS: AtomicU64 = AtomicU64::new(0);
static SHARED_RENDER_UNDERRUN_FRAMES: AtomicU64 = AtomicU64::new(0);
static SHARED_RENDER_LOW_HIT_COUNT: AtomicU64 = AtomicU64::new(0);
static SHARED_RENDER_LOW_WATERMARK_SAMPLES: AtomicU64 = AtomicU64::new(0);
static SHARED_RENDER_CONSUMER_JITTER_P99_US: AtomicU64 = AtomicU64::new(0);
static SHARED_RENDER_JITTER_ANOMALY_COUNT: AtomicU64 = AtomicU64::new(0);
static SHARED_RENDER_LOW_TIMELINE_GATE_MS: AtomicU64 = AtomicU64::new(0);
static SHARED_RENDER_UNDERRUN_TIMELINE_GATE_MS: AtomicU64 = AtomicU64::new(0);
static SHARED_RENDER_JITTER_TIMELINE_GATE_MS: AtomicU64 = AtomicU64::new(0);
static SHARED_RENDER_WRAPPER_SEQ: AtomicU64 = AtomicU64::new(1);
static SHARED_RENDER_ACTIVE_WRAPPER_ID: AtomicU64 = AtomicU64::new(0);
static SHARED_RENDER_READY_WRAPPER_ID: AtomicU64 = AtomicU64::new(0);
static SHARED_RENDER_READY_SEEK_EPOCH: AtomicU64 = AtomicU64::new(0);
static SHARED_RENDER_AVAILABLE_SAMPLES: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, Default)]
#[allow(dead_code)]
pub(crate) struct SharedRenderAheadMetricsSnapshot {
    pub render_underrun_events: u64,
    pub render_underrun_frames: u64,
    pub render_low_hit_count: u64,
    pub render_low_watermark_samples: u64,
    pub consumer_jitter_p99_us: u32,
    pub jitter_anomaly_count: u64,
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct SharedRenderAheadReadySnapshot {
    pub active_wrapper_id: u64,
    pub ready_wrapper_id: u64,
    pub ready_seek_epoch: u64,
    pub available_samples: usize,
    pub low_watermark_samples: usize,
}

pub(crate) fn shared_render_ahead_metrics() -> SharedRenderAheadMetricsSnapshot {
    SharedRenderAheadMetricsSnapshot {
        render_underrun_events: SHARED_RENDER_UNDERRUN_EVENTS.load(Ordering::Relaxed),
        render_underrun_frames: SHARED_RENDER_UNDERRUN_FRAMES.load(Ordering::Relaxed),
        render_low_hit_count: SHARED_RENDER_LOW_HIT_COUNT.load(Ordering::Relaxed),
        render_low_watermark_samples: SHARED_RENDER_LOW_WATERMARK_SAMPLES.load(Ordering::Relaxed),
        consumer_jitter_p99_us: SHARED_RENDER_CONSUMER_JITTER_P99_US
            .load(Ordering::Relaxed)
            .min(u32::MAX as u64) as u32,
        jitter_anomaly_count: SHARED_RENDER_JITTER_ANOMALY_COUNT.load(Ordering::Relaxed),
    }
}

pub(crate) fn shared_render_ahead_ready_snapshot() -> SharedRenderAheadReadySnapshot {
    SharedRenderAheadReadySnapshot {
        active_wrapper_id: SHARED_RENDER_ACTIVE_WRAPPER_ID.load(Ordering::Acquire),
        ready_wrapper_id: SHARED_RENDER_READY_WRAPPER_ID.load(Ordering::Acquire),
        ready_seek_epoch: SHARED_RENDER_READY_SEEK_EPOCH.load(Ordering::Acquire),
        available_samples: SHARED_RENDER_AVAILABLE_SAMPLES.load(Ordering::Relaxed) as usize,
        low_watermark_samples: SHARED_RENDER_LOW_WATERMARK_SAMPLES.load(Ordering::Relaxed) as usize,
    }
}

pub(crate) fn wait_for_shared_render_ahead_ready(
    min_samples: usize,
    seek_epoch: u64,
    timeout: Duration,
) -> bool {
    let start = Instant::now();
    let mut spin_budget = 128u32;

    loop {
        let snapshot = shared_render_ahead_ready_snapshot();
        if snapshot.active_wrapper_id == 0 {
            return true;
        }

        let required_samples = min_samples.max(snapshot.low_watermark_samples.max(1));
        if snapshot.ready_wrapper_id == snapshot.active_wrapper_id
            && snapshot.ready_seek_epoch >= seek_epoch
            && snapshot.available_samples >= required_samples
        {
            return true;
        }

        if start.elapsed() >= timeout {
            return false;
        }

        if spin_budget > 0 {
            spin_budget -= 1;
            std::hint::spin_loop();
            continue;
        }

        thread::sleep(Duration::from_millis(1));
    }
}

fn set_shared_render_ready_state(
    wrapper_id: u64,
    seek_epoch: u64,
    available_samples: usize,
    low_watermark: usize,
) {
    if SHARED_RENDER_ACTIVE_WRAPPER_ID.load(Ordering::Acquire) != wrapper_id {
        return;
    }

    SHARED_RENDER_AVAILABLE_SAMPLES.store(available_samples as u64, Ordering::Relaxed);
    if available_samples >= low_watermark.max(1) {
        SHARED_RENDER_READY_WRAPPER_ID.store(wrapper_id, Ordering::Release);
        SHARED_RENDER_READY_SEEK_EPOCH.store(seek_epoch, Ordering::Release);
    }
}

fn invalidate_shared_render_ready_state(wrapper_id: u64, seek_epoch: u64) {
    if SHARED_RENDER_ACTIVE_WRAPPER_ID.load(Ordering::Acquire) != wrapper_id {
        return;
    }

    SHARED_RENDER_AVAILABLE_SAMPLES.store(0, Ordering::Relaxed);
    SHARED_RENDER_READY_WRAPPER_ID.store(wrapper_id, Ordering::Release);
    SHARED_RENDER_READY_SEEK_EPOCH.store(seek_epoch.saturating_sub(1), Ordering::Release);
}

#[cfg(test)]
fn reset_shared_render_ahead_metrics() {
    SHARED_RENDER_UNDERRUN_EVENTS.store(0, Ordering::Relaxed);
    SHARED_RENDER_UNDERRUN_FRAMES.store(0, Ordering::Relaxed);
    SHARED_RENDER_LOW_HIT_COUNT.store(0, Ordering::Relaxed);
    SHARED_RENDER_LOW_WATERMARK_SAMPLES.store(0, Ordering::Relaxed);
    SHARED_RENDER_CONSUMER_JITTER_P99_US.store(0, Ordering::Relaxed);
    SHARED_RENDER_JITTER_ANOMALY_COUNT.store(0, Ordering::Relaxed);
    SHARED_RENDER_JITTER_TIMELINE_GATE_MS.store(0, Ordering::Relaxed);
    SHARED_RENDER_ACTIVE_WRAPPER_ID.store(0, Ordering::Relaxed);
    SHARED_RENDER_READY_WRAPPER_ID.store(0, Ordering::Relaxed);
    SHARED_RENDER_READY_SEEK_EPOCH.store(0, Ordering::Relaxed);
    SHARED_RENDER_AVAILABLE_SAMPLES.store(0, Ordering::Relaxed);
}

#[cfg(test)]
fn set_shared_render_ready_state_for_test(
    active_wrapper_id: u64,
    ready_wrapper_id: u64,
    ready_seek_epoch: u64,
    available_samples: usize,
    low_watermark_samples: usize,
) {
    SHARED_RENDER_ACTIVE_WRAPPER_ID.store(active_wrapper_id, Ordering::Relaxed);
    SHARED_RENDER_READY_WRAPPER_ID.store(ready_wrapper_id, Ordering::Relaxed);
    SHARED_RENDER_READY_SEEK_EPOCH.store(ready_seek_epoch, Ordering::Relaxed);
    SHARED_RENDER_AVAILABLE_SAMPLES.store(available_samples as u64, Ordering::Relaxed);
    SHARED_RENDER_LOW_WATERMARK_SAMPLES.store(low_watermark_samples as u64, Ordering::Relaxed);
}

fn parse_env_seconds(key: &str, default_value: f64, min: f64, max: f64) -> f64 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite())
        .unwrap_or(default_value)
        .clamp(min, max)
}

fn parse_env_bool(key: &str, default_value: bool) -> bool {
    std::env::var(key)
        .ok()
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            matches!(normalized.as_str(), "1" | "true" | "yes" | "on")
        })
        .unwrap_or(default_value)
}

fn parse_env_u64(key: &str, default_value: u64, min: u64, max: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(default_value)
        .clamp(min, max)
}

fn has_render_pop_wait_override() -> bool {
    std::env::var("PMP_AUDIO_RENDER_POP_WAIT_NORMAL_MS").is_ok()
        || std::env::var("PMP_AUDIO_RENDER_POP_WAIT_GUARDED_MS").is_ok()
        || std::env::var("PMP_AUDIO_RENDER_POP_WAIT_CRITICAL_MS").is_ok()
}

fn parse_env_u32(key: &str, default_value: u32, min: u32, max: u32) -> u32 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<u32>().ok())
        .unwrap_or(default_value)
        .clamp(min, max)
}

#[derive(Clone, Copy, Debug)]
struct RenderPopWaitPolicy {
    normal_ms: u64,
    guarded_ms: u64,
    critical_ms: u64,
}

impl RenderPopWaitPolicy {
    fn from_env() -> Self {
        Self {
            normal_ms: parse_env_u64("PMP_AUDIO_RENDER_POP_WAIT_NORMAL_MS", 1, 0, 12),
            guarded_ms: parse_env_u64("PMP_AUDIO_RENDER_POP_WAIT_GUARDED_MS", 2, 0, 12),
            critical_ms: parse_env_u64("PMP_AUDIO_RENDER_POP_WAIT_CRITICAL_MS", 3, 0, 12),
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct UnderrunMaskPolicy {
    normal_ms: u32,
    guarded_ms: u32,
    critical_ms: u32,
    streak_boost_ms: u32,
    min_ms: u32,
    max_ms: u32,
}

impl UnderrunMaskPolicy {
    fn from_env() -> Self {
        let min_ms = parse_env_u32("PMP_AUDIO_UNDERRUN_MASK_MIN_MS", 4, 1, 120);
        let max_ms = parse_env_u32("PMP_AUDIO_UNDERRUN_MASK_MAX_MS", 64, min_ms, 200);
        Self {
            normal_ms: parse_env_u32("PMP_AUDIO_UNDERRUN_MASK_NORMAL_MS", 8, min_ms, max_ms),
            guarded_ms: parse_env_u32("PMP_AUDIO_UNDERRUN_MASK_GUARDED_MS", 14, min_ms, max_ms),
            critical_ms: parse_env_u32("PMP_AUDIO_UNDERRUN_MASK_CRITICAL_MS", 24, min_ms, max_ms),
            streak_boost_ms: parse_env_u32("PMP_AUDIO_UNDERRUN_MASK_STREAK_BOOST_MS", 3, 0, 40),
            min_ms,
            max_ms,
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct RenderPopRetryPolicy {
    normal_attempts: u32,
    guarded_attempts: u32,
    critical_attempts: u32,
    streak_step: u32,
    max_attempts: u32,
    normal_spins: u32,
    guarded_spins: u32,
    critical_spins: u32,
}

impl RenderPopRetryPolicy {
    fn from_env() -> Self {
        Self {
            normal_attempts: parse_env_u32("PMP_AUDIO_RENDER_POP_RETRY_NORMAL", 2, 1, 8),
            guarded_attempts: parse_env_u32("PMP_AUDIO_RENDER_POP_RETRY_GUARDED", 3, 1, 8),
            critical_attempts: parse_env_u32("PMP_AUDIO_RENDER_POP_RETRY_CRITICAL", 4, 1, 8),
            streak_step: parse_env_u32("PMP_AUDIO_RENDER_POP_RETRY_STREAK_STEP", 2, 1, 8),
            max_attempts: parse_env_u32("PMP_AUDIO_RENDER_POP_RETRY_MAX", 7, 1, 12),
            normal_spins: parse_env_u32("PMP_AUDIO_RENDER_POP_RETRY_SPIN_NORMAL", 24, 0, 600),
            guarded_spins: parse_env_u32("PMP_AUDIO_RENDER_POP_RETRY_SPIN_GUARDED", 48, 0, 1200),
            critical_spins: parse_env_u32("PMP_AUDIO_RENDER_POP_RETRY_SPIN_CRITICAL", 96, 0, 1600),
        }
    }
}

static RENDER_POP_WAIT_POLICY: Lazy<Option<RenderPopWaitPolicy>> =
    Lazy::new(|| has_render_pop_wait_override().then(RenderPopWaitPolicy::from_env));
static UNDERRUN_MASK_POLICY: Lazy<UnderrunMaskPolicy> = Lazy::new(UnderrunMaskPolicy::from_env);
static RENDER_POP_RETRY_POLICY: Lazy<RenderPopRetryPolicy> =
    Lazy::new(RenderPopRetryPolicy::from_env);

fn ms_to_frames(sample_rate: u32, milliseconds: u32) -> usize {
    let rate = sample_rate.max(8_000) as f64;
    ((rate * milliseconds as f64) / 1000.0).round().max(1.0) as usize
}

fn producer_chunk_samples(profile: RealtimePressureProfile) -> usize {
    buffer_policy::output_producer_chunk_samples(profile)
}

fn render_pop_wait_timeout(profile: RealtimePressureProfile) -> Duration {
    if let Some(policy) = *RENDER_POP_WAIT_POLICY {
        let wait_ms = match profile {
            RealtimePressureProfile::Normal => policy.normal_ms,
            RealtimePressureProfile::Guarded => policy.guarded_ms,
            RealtimePressureProfile::Critical => policy.critical_ms,
        };
        Duration::from_millis(wait_ms)
    } else {
        buffer_policy::source_pop_wait_timeout(profile)
    }
}

fn render_watermark_samples(
    capacity_samples: usize,
    channels: usize,
    profile: RealtimePressureProfile,
) -> (usize, usize) {
    let capacity = capacity_samples.max(channels.max(1));
    let (low_percent, high_percent) = match profile {
        RealtimePressureProfile::Normal => (40usize, 86usize),
        RealtimePressureProfile::Guarded => (56usize, 92usize),
        RealtimePressureProfile::Critical => (68usize, 96usize),
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

fn adaptive_underrun_silence_frames(
    profile: RealtimePressureProfile,
    underrun_streak: u32,
    sample_rate: u32,
) -> usize {
    let policy = *UNDERRUN_MASK_POLICY;
    let base_ms = match profile {
        RealtimePressureProfile::Normal => policy.normal_ms,
        RealtimePressureProfile::Guarded => policy.guarded_ms,
        RealtimePressureProfile::Critical => policy.critical_ms,
    };
    let streak_boost = underrun_streak
        .saturating_sub(1)
        .min(8)
        .saturating_mul(policy.streak_boost_ms);
    let mask_ms = base_ms
        .saturating_add(streak_boost)
        .clamp(policy.min_ms, policy.max_ms);
    ms_to_frames(sample_rate, mask_ms)
}

fn seek_discontinuity_fade_frames(sample_rate: u32) -> usize {
    let fade_ms = parse_env_u32("PMP_AUDIO_RENDER_AHEAD_SEEK_FADE_IN_MS", 6, 1, 60);
    ms_to_frames(sample_rate, fade_ms)
}

fn render_pop_retry_attempts(profile: RealtimePressureProfile, underrun_streak: u32) -> u32 {
    let policy = *RENDER_POP_RETRY_POLICY;
    let base_attempts = match profile {
        RealtimePressureProfile::Normal => policy.normal_attempts,
        RealtimePressureProfile::Guarded => policy.guarded_attempts,
        RealtimePressureProfile::Critical => policy.critical_attempts,
    };

    let streak_boost = underrun_streak.saturating_sub(1) / policy.streak_step.max(1);
    base_attempts
        .saturating_add(streak_boost)
        .clamp(1, policy.max_attempts)
}

fn render_pop_retry_spins(profile: RealtimePressureProfile) -> u32 {
    let policy = *RENDER_POP_RETRY_POLICY;
    match profile {
        RealtimePressureProfile::Normal => policy.normal_spins,
        RealtimePressureProfile::Guarded => policy.guarded_spins,
        RealtimePressureProfile::Critical => policy.critical_spins,
    }
}

fn predictive_concealment_sample(
    last: f32,
    previous: f32,
    frame: usize,
    total_frames: usize,
) -> f32 {
    if total_frames <= 1 {
        return last.clamp(-1.0, 1.0);
    }

    let normalized = frame as f32 / (total_frames.saturating_sub(1)) as f32;
    let slope = (last - previous).clamp(-0.18, 0.18);
    let slope_decay = (1.0 - normalized).clamp(0.0, 1.0);
    let continuation = last + slope * ((frame + 1) as f32) * slope_decay * slope_decay;
    continuation.clamp(-1.0, 1.0)
}

fn equal_power_fade_out_gain(frame: usize, frames: usize) -> f32 {
    if frames <= 1 {
        return 0.0;
    }
    let t = frame as f32 / (frames.saturating_sub(1)) as f32;
    ((1.0 - t).clamp(0.0, 1.0) * FRAC_PI_2).sin()
}

fn equal_power_fade_in_gain(frame: usize, frames: usize) -> f32 {
    if frames <= 1 {
        return 1.0;
    }
    let t = frame as f32 / (frames.saturating_sub(1)) as f32;
    (t.clamp(0.0, 1.0) * FRAC_PI_2).sin()
}

fn record_render_consumer_jitter_sample(
    jitter_window: &mut [u32; 16],
    jitter_window_pos: &mut usize,
    jitter_window_count: &mut usize,
    expected_interval_us: u32,
    delta_us: u32,
) {
    jitter_window[*jitter_window_pos % 16] = delta_us;
    *jitter_window_pos = (*jitter_window_pos).wrapping_add(1);
    *jitter_window_count = (*jitter_window_count).saturating_add(1).min(16);

    let count = *jitter_window_count;
    if count < 4 {
        return;
    }

    let mut sorted = *jitter_window;
    sorted[..count].sort_unstable();
    let p99_idx = (count * 99 / 100).max(count.saturating_sub(1));
    let p99 = sorted[p99_idx];
    SHARED_RENDER_CONSUMER_JITTER_P99_US.store(p99 as u64, Ordering::Relaxed);

    let threshold = expected_interval_us.saturating_mul(3);
    if threshold > 0 && delta_us > threshold {
        SHARED_RENDER_JITTER_ANOMALY_COUNT.fetch_add(1, Ordering::Relaxed);
        diagnostics::record_event_throttled(
            "shared.render_ahead.jitter_anomaly",
            delta_us as u64,
            expected_interval_us as u64,
            &SHARED_RENDER_JITTER_TIMELINE_GATE_MS,
            200,
        );
    }
}

pub(crate) fn wrap_source_for_shared_backend(
    source: BoxedSource,
    seek_epoch: Arc<AtomicU64>,
) -> BoxedSource {
    if !parse_env_bool("PMP_AUDIO_SHARED_RENDER_AHEAD", true) {
        return source;
    }

    let channels = source.channels().max(1);
    let sample_rate = source.sample_rate().max(1);
    let duration = source.total_duration();

    let prebuffer_seconds =
        parse_env_seconds("PMP_AUDIO_SHARED_RENDER_AHEAD_SECONDS", 0.65, 0.2, 8.0);
    let prebuffer_samples =
        ((sample_rate as f64) * (channels as f64) * prebuffer_seconds).ceil() as usize;
    let policy_capacity_scale = parse_env_seconds(
        "PMP_AUDIO_SHARED_RENDER_AHEAD_POLICY_CAPACITY_SCALE",
        1.20,
        1.0,
        4.0,
    );
    let policy_capacity =
        buffer_policy::recommended_render_queue_capacity_samples(Some(sample_rate), channels);
    let scaled_policy_capacity = ((policy_capacity as f64) * policy_capacity_scale).ceil() as usize;
    let capacity_samples = prebuffer_samples
        .max(scaled_policy_capacity)
        .clamp(16_384, 1_500_000);

    let queue = AudioRingBuffer::new(capacity_samples.max(channels as usize * 256));
    queue.try_lock_memory_pages();

    let wrapper_id = SHARED_RENDER_WRAPPER_SEQ.fetch_add(1, Ordering::AcqRel);
    SHARED_RENDER_ACTIVE_WRAPPER_ID.store(wrapper_id, Ordering::Release);

    let initial_profile = crate::audio::realtime_scheduler::SCHEDULER.profile();
    let (initial_low_watermark, _) =
        render_watermark_samples(queue.capacity_samples(), channels as usize, initial_profile);
    SHARED_RENDER_LOW_WATERMARK_SAMPLES.store(initial_low_watermark as u64, Ordering::Relaxed);

    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let producer = spawn_producer_thread(
        source,
        queue.clone(),
        stop_rx,
        seek_epoch.clone(),
        wrapper_id,
    );

    let prebuffer_target_seconds = parse_env_seconds(
        "PMP_AUDIO_SHARED_RENDER_AHEAD_PREROLL_SECONDS",
        0.20,
        0.02,
        1.2,
    );
    let prebuffer_target =
        ((sample_rate as f64) * (channels as f64) * prebuffer_target_seconds).ceil() as usize;
    queue.wait_for_samples(
        prebuffer_target
            .max(initial_low_watermark)
            .max(channels as usize * 32),
        Duration::from_millis(450),
    );

    let observed_seek_epoch = seek_epoch.load(Ordering::Acquire);
    invalidate_shared_render_ready_state(wrapper_id, observed_seek_epoch);
    set_shared_render_ready_state(
        wrapper_id,
        observed_seek_epoch,
        queue.len_samples(),
        initial_low_watermark,
    );
    let expected_interval_us =
        (4096u64 * 1_000_000 / (sample_rate as u64 * channels.max(1) as u64)) as u32;

    Box::new(RenderAheadSource {
        wrapper_id,
        queue,
        channels,
        sample_rate,
        duration,
        seek_epoch,
        observed_seek_epoch,
        local: Vec::with_capacity(8192),
        local_index: 0,
        channel_cursor: 0,
        previous_samples: vec![0.0; channels as usize],
        last_samples: vec![0.0; channels as usize],
        needs_fade_in: false,
        pending_fade_in_frames: 0,
        underrun_streak: 0,
        last_refill_instant: None,
        jitter_window: [0u32; 16],
        jitter_window_pos: 0,
        jitter_window_count: 0,
        expected_interval_us,
        stop_tx: Some(stop_tx),
        producer: Some(producer),
    })
}

fn spawn_producer_thread(
    mut source: BoxedSource,
    queue: AudioRingBuffer,
    stop_rx: mpsc::Receiver<()>,
    seek_epoch: Arc<AtomicU64>,
    wrapper_id: u64,
) -> JoinHandle<()> {
    let name = "pmpm-shared-render-ahead".to_string();
    let builder = thread::Builder::new().name(name);
    let queue_for_error = queue.clone();

    builder
        .spawn(move || {
            let _priority_guard =
                crate::audio::threading::promote_current_thread_for_audio_decode();
            let channels = source.channels().max(1) as usize;
            let sample_rate = source.sample_rate().max(1) as f64;
            let queue_capacity = queue.capacity_samples().max(channels);
            let seek_poll_stride_samples = channels.saturating_mul(192).clamp(channels, 2048);
            let mut adaptive_state = buffer_policy::TransferAdaptiveState::default();

            let mut block = Vec::<f32>::with_capacity(producer_chunk_samples(
                RealtimePressureProfile::Critical,
            ));
            let mut observed_seek_epoch = seek_epoch.load(Ordering::Acquire);
            let mut observed_queue_clear_epoch = queue.clear_epoch();
            invalidate_shared_render_ready_state(wrapper_id, observed_seek_epoch);

            loop {
                if stop_rx.try_recv().is_ok() {
                    break;
                }

                let current_epoch = seek_epoch.load(Ordering::Acquire);
                if current_epoch != observed_seek_epoch {
                    observed_seek_epoch = current_epoch;
                    queue.clear();
                    observed_queue_clear_epoch = queue.clear_epoch();
                    block.clear();
                    adaptive_state = buffer_policy::TransferAdaptiveState::default();
                    invalidate_shared_render_ready_state(wrapper_id, current_epoch);
                }

                let current_clear_epoch = queue.clear_epoch();
                if current_clear_epoch != observed_queue_clear_epoch {
                    observed_queue_clear_epoch = current_clear_epoch;
                    block.clear();
                    adaptive_state = buffer_policy::TransferAdaptiveState::default();
                    invalidate_shared_render_ready_state(wrapper_id, observed_seek_epoch);
                }

                let render_len = queue.len_samples();
                let current_profile = crate::audio::realtime_scheduler::SCHEDULER.profile();
                let (mut base_low_watermark, mut _base_high_watermark) =
                    render_watermark_samples(queue_capacity, channels, current_profile);
                let buffered_ahead_seconds = (render_len as f64) / (sample_rate * channels as f64);
                let profile = crate::audio::realtime_scheduler::SCHEDULER
                    .update(buffered_ahead_seconds, render_len <= base_low_watermark);
                if profile != current_profile {
                    (base_low_watermark, _base_high_watermark) =
                        render_watermark_samples(queue_capacity, channels, profile);
                }

                let adaptive = buffer_policy::adaptive_transfer_strategy(
                    queue_capacity,
                    channels,
                    profile,
                    render_len,
                    render_len,
                    &mut adaptive_state,
                );
                let low_watermark = adaptive.low_watermark.max(base_low_watermark);
                let high_watermark = adaptive.high_watermark;

                SHARED_RENDER_LOW_WATERMARK_SAMPLES.store(low_watermark as u64, Ordering::Relaxed);
                set_shared_render_ready_state(
                    wrapper_id,
                    observed_seek_epoch,
                    render_len,
                    low_watermark,
                );
                crate::audio::threading::apply_audio_decode_pressure_profile(profile);
                let backoff = adaptive.producer_backoff;

                if render_len >= high_watermark {
                    if backoff.is_zero() {
                        thread::yield_now();
                    } else {
                        thread::sleep(backoff);
                    }
                    continue;
                }

                let chunk_samples = adaptive.chunk_limit.max(producer_chunk_samples(profile));
                memory_pool::reserve_f32_capacity(
                    &mut block,
                    chunk_samples,
                    "shared.render_ahead.block_growth",
                );
                block.clear();
                let mut seek_flushed = false;
                let mut sampled = 0usize;
                while sampled < chunk_samples {
                    if sampled % seek_poll_stride_samples == 0 {
                        let current_epoch = seek_epoch.load(Ordering::Acquire);
                        if current_epoch != observed_seek_epoch {
                            observed_seek_epoch = current_epoch;
                            queue.clear();
                            observed_queue_clear_epoch = queue.clear_epoch();
                            block.clear();
                            adaptive_state = buffer_policy::TransferAdaptiveState::default();
                            invalidate_shared_render_ready_state(wrapper_id, current_epoch);
                            seek_flushed = true;
                            break;
                        }
                    }
                    match source.next() {
                        Some(sample) => block.push(sample),
                        None => break,
                    }
                    sampled = sampled.saturating_add(1);
                }

                if seek_flushed {
                    continue;
                }

                if block.is_empty() {
                    queue.mark_finished();
                    break;
                }

                let mut start = 0usize;
                while start < block.len() {
                    if stop_rx.try_recv().is_ok() {
                        queue.mark_finished();
                        return;
                    }

                    let current_epoch = seek_epoch.load(Ordering::Acquire);
                    if current_epoch != observed_seek_epoch {
                        observed_seek_epoch = current_epoch;
                        queue.clear();
                        observed_queue_clear_epoch = queue.clear_epoch();
                        invalidate_shared_render_ready_state(wrapper_id, current_epoch);
                        break;
                    }

                    let push_result = queue.push_interleaved_guarded(
                        &block[start..],
                        channels,
                        observed_queue_clear_epoch,
                    );
                    if push_result.cleared {
                        observed_queue_clear_epoch = queue.clear_epoch();
                        block.clear();
                        adaptive_state = buffer_policy::TransferAdaptiveState::default();
                        invalidate_shared_render_ready_state(wrapper_id, observed_seek_epoch);
                        break;
                    }

                    if push_result.pushed_frames == 0 {
                        if backoff.is_zero() {
                            thread::yield_now();
                        } else {
                            thread::sleep(backoff);
                        }
                        continue;
                    }
                    set_shared_render_ready_state(
                        wrapper_id,
                        observed_seek_epoch,
                        queue.len_samples(),
                        low_watermark,
                    );
                    start = start.saturating_add(push_result.pushed_frames * channels);
                }
            }

            queue.mark_finished();
        })
        .unwrap_or_else(|_| thread::spawn(move || queue_for_error.mark_finished()))
}

struct RenderAheadSource {
    wrapper_id: u64,
    queue: AudioRingBuffer,
    channels: u16,
    sample_rate: u32,
    duration: Option<Duration>,
    seek_epoch: Arc<AtomicU64>,
    observed_seek_epoch: u64,
    local: Vec<f32>,
    local_index: usize,
    channel_cursor: usize,
    previous_samples: Vec<f32>,
    last_samples: Vec<f32>,
    needs_fade_in: bool,
    pending_fade_in_frames: usize,
    underrun_streak: u32,
    last_refill_instant: Option<Instant>,
    jitter_window: [u32; 16],
    jitter_window_pos: usize,
    jitter_window_count: usize,
    expected_interval_us: u32,
    stop_tx: Option<mpsc::Sender<()>>,
    producer: Option<JoinHandle<()>>,
}

impl RenderAheadSource {
    fn pop_chunk_samples() -> usize {
        match crate::audio::realtime_scheduler::SCHEDULER.profile() {
            RealtimePressureProfile::Normal => 4096,
            RealtimePressureProfile::Guarded => 6144,
            RealtimePressureProfile::Critical => 8192,
        }
    }

    fn track_sample_history(&mut self, sample: f32) {
        let channels = self.channels.max(1) as usize;
        let channel = self.channel_cursor;
        self.channel_cursor += 1;
        if self.channel_cursor >= channels {
            self.channel_cursor = 0;
        }
        if let (Some(previous), Some(last)) = (
            self.previous_samples.get_mut(channel),
            self.last_samples.get_mut(channel),
        ) {
            *previous = *last;
            *last = sample;
        }
    }

    fn refill_local(&mut self) -> bool {
        let now = Instant::now();
        if let Some(prev) = self.last_refill_instant {
            let delta_us = prev.elapsed().as_micros().min(u32::MAX as u128) as u32;
            record_render_consumer_jitter_sample(
                &mut self.jitter_window,
                &mut self.jitter_window_pos,
                &mut self.jitter_window_count,
                self.expected_interval_us,
                delta_us,
            );
        }
        self.last_refill_instant = Some(now);

        let current_epoch = self.seek_epoch.load(Ordering::Acquire);
        if current_epoch != self.observed_seek_epoch {
            self.observed_seek_epoch = current_epoch;
            self.queue.clear();
            self.local.clear();
            self.local_index = 0;
            self.channel_cursor = 0;
            for sample in &mut self.previous_samples {
                *sample = 0.0;
            }
            for sample in &mut self.last_samples {
                *sample = 0.0;
            }
            self.needs_fade_in = true;
            self.pending_fade_in_frames = seek_discontinuity_fade_frames(self.sample_rate);
            self.underrun_streak = 0;
        }

        self.local.clear();
        self.local_index = 0;

        let low_watermark = SHARED_RENDER_LOW_WATERMARK_SAMPLES.load(Ordering::Relaxed) as usize;
        let render_len = self.queue.len_samples();
        if low_watermark > 0 && render_len <= low_watermark {
            SHARED_RENDER_LOW_HIT_COUNT.fetch_add(1, Ordering::Relaxed);
            diagnostics::record_event_throttled(
                "shared.render_ahead.low_watermark",
                render_len as u64,
                low_watermark as u64,
                &SHARED_RENDER_LOW_TIMELINE_GATE_MS,
                160,
            );
        }

        let profile = crate::audio::realtime_scheduler::SCHEDULER.profile();
        let chunk_samples = Self::pop_chunk_samples();
        let retry_attempts = render_pop_retry_attempts(profile, self.underrun_streak).max(1);
        let retry_spins = render_pop_retry_spins(profile);
        let mut pop = self.queue.pop_chunk_into(
            &mut self.local,
            chunk_samples,
            render_pop_wait_timeout(profile),
        );
        for _ in 1..retry_attempts {
            if pop.popped > 0 || pop.finished {
                break;
            }
            for _ in 0..retry_spins {
                std::hint::spin_loop();
            }
            pop = self
                .queue
                .pop_chunk_into(&mut self.local, chunk_samples, Duration::ZERO);
        }

        if pop.popped > 0 {
            if self.needs_fade_in {
                let channels = self.channels.max(1) as usize;
                let fade_frames =
                    (self.local.len() / channels).min(self.pending_fade_in_frames.max(1));
                if fade_frames > 0 {
                    for frame in 0..fade_frames {
                        let gain = equal_power_fade_in_gain(frame, fade_frames);
                        let base = frame * channels;
                        for channel in 0..channels {
                            self.local[base + channel] *= gain;
                        }
                    }
                }
                self.needs_fade_in = false;
                self.pending_fade_in_frames = 0;
            }
            self.underrun_streak = 0;
            return true;
        }

        if pop.finished {
            return false;
        }

        let channels = self.channels.max(1) as usize;
        self.underrun_streak = self.underrun_streak.saturating_add(1);
        let silence_frames =
            adaptive_underrun_silence_frames(profile, self.underrun_streak, self.sample_rate);
        self.needs_fade_in = true;
        self.pending_fade_in_frames = silence_frames;
        let silence_samples = channels * silence_frames;
        self.local.resize(silence_samples, 0.0);
        for frame in 0..silence_frames {
            let gain = equal_power_fade_out_gain(frame, silence_frames);
            let base = frame * channels;
            for channel in 0..channels {
                let predicted = predictive_concealment_sample(
                    self.last_samples[channel],
                    self.previous_samples[channel],
                    frame,
                    silence_frames,
                );
                self.local[base + channel] = predicted * gain;
            }
        }
        SHARED_RENDER_UNDERRUN_EVENTS.fetch_add(1, Ordering::Relaxed);
        SHARED_RENDER_UNDERRUN_FRAMES.fetch_add(silence_frames as u64, Ordering::Relaxed);
        diagnostics::record_event_throttled(
            "shared.render_ahead.underrun",
            silence_frames as u64,
            channels as u64,
            &SHARED_RENDER_UNDERRUN_TIMELINE_GATE_MS,
            120,
        );
        true
    }
}

impl Iterator for RenderAheadSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.local_index >= self.local.len() && !self.refill_local() {
            return None;
        }

        let sample_index = self.local_index;
        let sample = self.local[sample_index];
        self.local_index += 1;
        self.track_sample_history(sample);

        Some(sample)
    }
}

impl BulkSource for RenderAheadSource {
    fn fill_buffer(&mut self, buf: &mut [f32]) -> usize {
        let mut written = 0usize;
        while written < buf.len() {
            if self.local_index >= self.local.len() && !self.refill_local() {
                break;
            }

            let available = self.local.len().saturating_sub(self.local_index);
            let to_copy = available.min(buf.len().saturating_sub(written));
            let start = self.local_index;
            let end = start + to_copy;
            buf[written..written + to_copy].copy_from_slice(&self.local[start..end]);
            self.local_index = end;

            for &sample in &buf[written..written + to_copy] {
                self.track_sample_history(sample);
            }

            written += to_copy;
        }
        written
    }
}

impl Source for RenderAheadSource {
    fn current_frame_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        self.duration
    }
}

impl Drop for RenderAheadSource {
    fn drop(&mut self) {
        if SHARED_RENDER_ACTIVE_WRAPPER_ID.load(Ordering::Acquire) == self.wrapper_id {
            SHARED_RENDER_ACTIVE_WRAPPER_ID.store(0, Ordering::Release);
            SHARED_RENDER_READY_WRAPPER_ID.store(0, Ordering::Release);
            SHARED_RENDER_READY_SEEK_EPOCH.store(0, Ordering::Release);
            SHARED_RENDER_AVAILABLE_SAMPLES.store(0, Ordering::Relaxed);
        }
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.producer.take() {
            let _ = handle.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use once_cell::sync::Lazy;
    use std::sync::{Mutex, MutexGuard};

    static SHARED_RENDER_AHEAD_TEST_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    fn lock_shared_render_ahead_test_state() -> MutexGuard<'static, ()> {
        SHARED_RENDER_AHEAD_TEST_LOCK
            .lock()
            .expect("shared render ahead test lock poisoned")
    }

    #[derive(Clone)]
    struct TestSource {
        remaining: usize,
        channels: u16,
        sample_rate: u32,
    }

    impl Iterator for TestSource {
        type Item = f32;

        fn next(&mut self) -> Option<Self::Item> {
            if self.remaining == 0 {
                return None;
            }
            self.remaining -= 1;
            Some(0.5)
        }
    }

    impl Source for TestSource {
        fn current_frame_len(&self) -> Option<usize> {
            None
        }

        fn channels(&self) -> u16 {
            self.channels
        }

        fn sample_rate(&self) -> u32 {
            self.sample_rate
        }

        fn total_duration(&self) -> Option<Duration> {
            None
        }
    }

    #[test]
    fn render_ahead_source_bulk_fill_matches_queue_samples() {
        let queue = AudioRingBuffer::new(4_096);
        let samples = vec![0.2f32, -0.2, 0.4, -0.4, 0.6, -0.6, 0.8, -0.8];
        let pushed = queue.push_interleaved(&samples, 2);
        assert_eq!(pushed * 2, samples.len());
        queue.mark_finished();

        let mut source = RenderAheadSource {
            wrapper_id: 0,
            queue,
            channels: 2,
            sample_rate: 48_000,
            duration: None,
            seek_epoch: Arc::new(AtomicU64::new(1)),
            observed_seek_epoch: 1,
            local: Vec::with_capacity(8192),
            local_index: 0,
            channel_cursor: 0,
            previous_samples: vec![0.0; 2],
            last_samples: vec![0.0; 2],
            needs_fade_in: false,
            pending_fade_in_frames: 0,
            underrun_streak: 0,
            last_refill_instant: None,
            jitter_window: [0; 16],
            jitter_window_pos: 0,
            jitter_window_count: 0,
            expected_interval_us: 0,
            stop_tx: None,
            producer: None,
        };

        let mut out = vec![0.0f32; samples.len()];
        let filled = source.fill_buffer(&mut out);

        assert_eq!(filled, samples.len());
        assert_eq!(out, samples);
        assert_eq!(source.fill_buffer(&mut out), 0);
    }

    #[test]
    fn render_ahead_source_yields_samples() {
        let _guard = lock_shared_render_ahead_test_state();
        reset_shared_render_ahead_metrics();

        let source: BoxedSource = Box::new(TestSource {
            remaining: 2048,
            channels: 2,
            sample_rate: 48_000,
        });

        let seek_epoch = Arc::new(AtomicU64::new(1));
        let mut wrapped = wrap_source_for_shared_backend(source, seek_epoch);
        let mut count = 0usize;
        while wrapped.next().is_some() {
            count += 1;
            if count >= 2048 {
                break;
            }
        }

        assert!(count > 0);
    }

    #[test]
    fn adaptive_underrun_silence_frames_scales_with_pressure_and_streak() {
        let normal = adaptive_underrun_silence_frames(RealtimePressureProfile::Normal, 1, 48_000);
        let guarded = adaptive_underrun_silence_frames(RealtimePressureProfile::Guarded, 1, 48_000);
        let critical =
            adaptive_underrun_silence_frames(RealtimePressureProfile::Critical, 1, 48_000);

        assert!(normal < guarded);
        assert!(guarded < critical);

        let streaked =
            adaptive_underrun_silence_frames(RealtimePressureProfile::Critical, 8, 48_000);
        assert!(streaked >= critical);
    }

    #[test]
    fn adaptive_underrun_silence_frames_scale_with_sample_rate() {
        let low_rate =
            adaptive_underrun_silence_frames(RealtimePressureProfile::Guarded, 1, 44_100);
        let high_rate =
            adaptive_underrun_silence_frames(RealtimePressureProfile::Guarded, 1, 96_000);
        assert!(high_rate > low_rate);
    }

    #[test]
    fn render_pop_wait_timeout_scales_with_pressure_profile() {
        let normal = render_pop_wait_timeout(RealtimePressureProfile::Normal);
        let guarded = render_pop_wait_timeout(RealtimePressureProfile::Guarded);
        let critical = render_pop_wait_timeout(RealtimePressureProfile::Critical);
        assert!(normal <= guarded);
        assert!(guarded <= critical);
    }

    #[test]
    fn render_watermarks_scale_with_pressure() {
        let (normal_low, normal_high) =
            render_watermark_samples(100_000, 2, RealtimePressureProfile::Normal);
        let (guarded_low, guarded_high) =
            render_watermark_samples(100_000, 2, RealtimePressureProfile::Guarded);
        let (critical_low, critical_high) =
            render_watermark_samples(100_000, 2, RealtimePressureProfile::Critical);

        assert!(normal_low < guarded_low);
        assert!(guarded_low < critical_low);
        assert!(normal_high < guarded_high);
        assert!(guarded_high < critical_high);
    }

    #[test]
    fn render_pop_retry_attempts_scale_with_pressure_and_streak() {
        let normal = render_pop_retry_attempts(RealtimePressureProfile::Normal, 1);
        let guarded = render_pop_retry_attempts(RealtimePressureProfile::Guarded, 1);
        let critical = render_pop_retry_attempts(RealtimePressureProfile::Critical, 1);
        assert!(normal <= guarded);
        assert!(guarded <= critical);

        let streaked = render_pop_retry_attempts(RealtimePressureProfile::Critical, 9);
        assert!(streaked >= critical);
    }

    #[test]
    fn pop_chunk_samples_scales_with_pressure() {
        let chunk = RenderAheadSource::pop_chunk_samples();
        assert!(chunk >= 4096);
        assert!(chunk <= 8192);
    }

    #[test]
    fn predictive_concealment_stays_finite_and_bounded() {
        for frame in 0..64 {
            let sample = predictive_concealment_sample(0.92, -0.35, frame, 64);
            assert!(sample.is_finite());
            assert!(sample <= 1.0);
            assert!(sample >= -1.0);
        }
    }

    #[test]
    fn predictive_concealment_tracks_transient_direction_early() {
        let rise = predictive_concealment_sample(0.45, 0.10, 0, 24);
        let fall = predictive_concealment_sample(-0.40, -0.05, 0, 24);
        assert!(rise > 0.45);
        assert!(fall < -0.40);
    }

    #[test]
    fn shared_render_ahead_ready_wait_returns_true_without_active_wrapper() {
        let _guard = lock_shared_render_ahead_test_state();
        reset_shared_render_ahead_metrics();
        assert!(wait_for_shared_render_ahead_ready(
            1,
            1,
            Duration::from_millis(2)
        ));
    }

    #[test]
    fn shared_render_ahead_ready_wait_requires_epoch_and_samples() {
        let _guard = lock_shared_render_ahead_test_state();
        reset_shared_render_ahead_metrics();
        let wrapper_id = u64::MAX - 16;
        set_shared_render_ready_state_for_test(wrapper_id, wrapper_id, 3, 512, 256);
        let snapshot = shared_render_ahead_ready_snapshot();
        assert_eq!(snapshot.active_wrapper_id, wrapper_id);
        assert_eq!(snapshot.ready_wrapper_id, wrapper_id);
        assert_eq!(snapshot.ready_seek_epoch, 3);
        assert!(snapshot.available_samples >= 512);
        assert!(wait_for_shared_render_ahead_ready(
            256,
            3,
            Duration::from_millis(1)
        ));
    }

    #[test]
    fn jitter_anomaly_threshold_scales_with_interval() {
        let _guard = lock_shared_render_ahead_test_state();
        reset_shared_render_ahead_metrics();

        let mut jitter_window = [0u32; 16];
        let mut jitter_window_pos = 0usize;
        let mut jitter_window_count = 0usize;

        record_render_consumer_jitter_sample(
            &mut jitter_window,
            &mut jitter_window_pos,
            &mut jitter_window_count,
            1_000,
            800,
        );
        record_render_consumer_jitter_sample(
            &mut jitter_window,
            &mut jitter_window_pos,
            &mut jitter_window_count,
            1_000,
            1_000,
        );
        record_render_consumer_jitter_sample(
            &mut jitter_window,
            &mut jitter_window_pos,
            &mut jitter_window_count,
            1_000,
            1_200,
        );
        record_render_consumer_jitter_sample(
            &mut jitter_window,
            &mut jitter_window_pos,
            &mut jitter_window_count,
            1_000,
            3_000,
        );
        assert_eq!(shared_render_ahead_metrics().jitter_anomaly_count, 0);

        record_render_consumer_jitter_sample(
            &mut jitter_window,
            &mut jitter_window_pos,
            &mut jitter_window_count,
            1_000,
            3_001,
        );
        assert_eq!(shared_render_ahead_metrics().jitter_anomaly_count, 1);

        record_render_consumer_jitter_sample(
            &mut jitter_window,
            &mut jitter_window_pos,
            &mut jitter_window_count,
            2_000,
            6_000,
        );
        assert_eq!(shared_render_ahead_metrics().jitter_anomaly_count, 1);

        record_render_consumer_jitter_sample(
            &mut jitter_window,
            &mut jitter_window_pos,
            &mut jitter_window_count,
            2_000,
            6_001,
        );
        assert_eq!(shared_render_ahead_metrics().jitter_anomaly_count, 2);
    }

    #[test]
    fn jitter_p99_window_produces_stable_values() {
        let _guard = lock_shared_render_ahead_test_state();
        reset_shared_render_ahead_metrics();

        let mut jitter_window = [0u32; 16];
        let mut jitter_window_pos = 0usize;
        let mut jitter_window_count = 0usize;

        let first_window = [
            920u32, 940, 960, 980, 1_000, 1_020, 1_040, 1_060, 1_080, 1_100, 1_120, 1_140, 1_160,
            1_180, 1_200, 2_400,
        ];
        for delta_us in first_window {
            record_render_consumer_jitter_sample(
                &mut jitter_window,
                &mut jitter_window_pos,
                &mut jitter_window_count,
                2_000,
                delta_us,
            );
        }
        assert_eq!(shared_render_ahead_metrics().consumer_jitter_p99_us, 2_400);

        for _ in 0..16 {
            record_render_consumer_jitter_sample(
                &mut jitter_window,
                &mut jitter_window_pos,
                &mut jitter_window_count,
                2_000,
                1_100,
            );
        }
        let snapshot = shared_render_ahead_metrics();
        assert_eq!(snapshot.consumer_jitter_p99_us, 1_100);
    }
}
