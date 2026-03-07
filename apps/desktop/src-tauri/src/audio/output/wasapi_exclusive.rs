use std::collections::VecDeque;
use std::f32::consts::FRAC_PI_2;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use rodio::Source;

use super::{
    AudioOutputBackend, AudioOutputError, AudioSink, BoxedSource, OutputCallbackMetricsSnapshot,
    OutputDeviceInfo, OutputStreamInfo,
};
use crate::audio::buffer::AudioRingBuffer;
use crate::audio::buffer_policy;
use crate::audio::diagnostics;
use crate::audio::memory_pool;
use crate::audio::policy::{NativeAudioOutputQuantizationMode, NativeAudioTransportMode};
use crate::audio::realtime_scheduler::{RealtimePressureProfile, SCHEDULER};

pub const WASAPI_EXCLUSIVE_BACKEND_ID: &str = "wasapi-exclusive";
pub const WASAPI_SHARED_RAW_BACKEND_ID: &str = "wasapi-shared-raw";

#[derive(Clone, Copy, Debug)]
struct UnderrunDeclickPolicy {
    normal_ms: u32,
    guarded_ms: u32,
    critical_ms: u32,
    streak_boost_ms: u32,
    min_ms: u32,
    max_ms: u32,
}

fn parse_env_u32(key: &str, default_value: u32, min: u32, max: u32) -> u32 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<u32>().ok())
        .unwrap_or(default_value)
        .clamp(min, max)
}

fn parse_env_bool_wasapi(key: &str, default_value: bool) -> bool {
    std::env::var(key)
        .ok()
        .map(|value| match value.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => true,
            "0" | "false" | "no" | "off" => false,
            _ => default_value,
        })
        .unwrap_or(default_value)
}

#[inline]
fn quantization_mode_to_bits(mode: NativeAudioOutputQuantizationMode) -> u32 {
    match mode {
        NativeAudioOutputQuantizationMode::Round => 0,
        NativeAudioOutputQuantizationMode::Tpdf => 1,
    }
}

#[inline]
fn quantization_mode_from_bits(bits: u32) -> NativeAudioOutputQuantizationMode {
    match bits {
        1 => NativeAudioOutputQuantizationMode::Tpdf,
        _ => NativeAudioOutputQuantizationMode::Round,
    }
}

#[inline]
fn callback_pop_retry_attempts(profile: RealtimePressureProfile) -> u32 {
    match profile {
        RealtimePressureProfile::Normal => 2,
        RealtimePressureProfile::Guarded => 3,
        RealtimePressureProfile::Critical => 4,
    }
}

#[inline]
fn callback_pop_retry_spins(profile: RealtimePressureProfile) -> u32 {
    match profile {
        RealtimePressureProfile::Normal => 24,
        RealtimePressureProfile::Guarded => 48,
        RealtimePressureProfile::Critical => 96,
    }
}

fn shared_raw_low_latency_prefill_floor_samples(
    sample_rate: u32,
    channels: u16,
    low_latency_period_frames: Option<u32>,
) -> usize {
    let Some(period_frames) = low_latency_period_frames else {
        return 0;
    };

    let sample_rate = sample_rate.max(1) as usize;
    let channels = channels.max(1) as usize;
    let period_frames = period_frames.max(1) as usize;

    let floor_from_time = sample_rate.saturating_mul(120).saturating_add(999) / 1000;
    let floor_from_period = period_frames.saturating_mul(64);
    let floor_frames = floor_from_time
        .max(floor_from_period)
        .min(sample_rate.saturating_mul(320).saturating_add(999) / 1000)
        .max(period_frames.saturating_mul(8));

    floor_frames.saturating_mul(channels)
}

fn shared_raw_render_pop_wait_timeout(
    sample_rate: u32,
    low_latency_period_frames: Option<u32>,
) -> Duration {
    let Some(period_frames) = low_latency_period_frames else {
        return Duration::ZERO;
    };

    let sample_rate = sample_rate.max(1) as u64;
    let period_us = (period_frames.max(1) as u64)
        .saturating_mul(1_000_000)
        .saturating_div(sample_rate)
        .max(250);
    Duration::from_micros(period_us.min(1_500))
}

fn exclusive_render_pop_wait_timeout(sample_rate: u32, buffer_frame_count: u32) -> Duration {
    let sample_rate = sample_rate.max(1) as u64;
    let period_frames = buffer_frame_count.max(1) as u64;
    let period_us = period_frames
        .saturating_mul(1_000_000)
        .saturating_div(sample_rate)
        .max(400);
    let wait_us = period_us / 4;
    Duration::from_micros(wait_us.clamp(200, 2_000))
}

impl UnderrunDeclickPolicy {
    fn from_env() -> Self {
        let min_ms = parse_env_u32("PMP_AUDIO_EXCLUSIVE_DECLICK_MIN_MS", 4, 1, 120);
        let max_ms = parse_env_u32("PMP_AUDIO_EXCLUSIVE_DECLICK_MAX_MS", 64, min_ms, 200);

        Self {
            normal_ms: parse_env_u32("PMP_AUDIO_EXCLUSIVE_DECLICK_NORMAL_MS", 8, min_ms, max_ms),
            guarded_ms: parse_env_u32("PMP_AUDIO_EXCLUSIVE_DECLICK_GUARDED_MS", 14, min_ms, max_ms),
            critical_ms: parse_env_u32(
                "PMP_AUDIO_EXCLUSIVE_DECLICK_CRITICAL_MS",
                24,
                min_ms,
                max_ms,
            ),
            streak_boost_ms: parse_env_u32("PMP_AUDIO_EXCLUSIVE_DECLICK_STREAK_BOOST_MS", 3, 0, 40),
            min_ms,
            max_ms,
        }
    }
}

static UNDERRUN_DECLICK_POLICY: Lazy<UnderrunDeclickPolicy> =
    Lazy::new(UnderrunDeclickPolicy::from_env);
static CALLBACK_POP_RT_SPIN_WAIT: Lazy<bool> =
    Lazy::new(|| parse_env_bool_wasapi("PMP_AUDIO_CALLBACK_POP_RT_SPIN_WAIT", true));

fn ms_to_frames(sample_rate: u32, milliseconds: u32) -> usize {
    let rate = sample_rate.max(8_000) as f64;
    ((rate * milliseconds as f64) / 1000.0).round().max(1.0) as usize
}

fn adaptive_declick_frames(
    sample_rate: u32,
    profile: RealtimePressureProfile,
    underrun_streak: u32,
) -> usize {
    let policy = *UNDERRUN_DECLICK_POLICY;
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

const AUDIO_OUTPUT_WASAPI_EXCLUSIVE_DEVICE_NOT_FOUND: &str =
    "AUDIO_OUTPUT_WASAPI_EXCLUSIVE_DEVICE_NOT_FOUND";
const AUDIO_OUTPUT_WASAPI_EXCLUSIVE_NO_DEVICE_SELECTED: &str =
    "AUDIO_OUTPUT_WASAPI_EXCLUSIVE_NO_DEVICE_SELECTED";
const AUDIO_OUTPUT_WASAPI_EXCLUSIVE_OPEN_FAILED: &str = "AUDIO_OUTPUT_WASAPI_EXCLUSIVE_OPEN_FAILED";
const AUDIO_OUTPUT_WASAPI_EXCLUSIVE_RENDER_FAILED: &str =
    "AUDIO_OUTPUT_WASAPI_EXCLUSIVE_RENDER_FAILED";
const AUDIO_OUTPUT_WASAPI_EXCLUSIVE_UNSUPPORTED_FORMAT: &str =
    "AUDIO_OUTPUT_WASAPI_EXCLUSIVE_UNSUPPORTED_FORMAT";
const AUDIO_OUTPUT_WASAPI_SHARED_RAW_OPEN_FAILED: &str =
    "AUDIO_OUTPUT_WASAPI_SHARED_RAW_OPEN_FAILED";
const AUDIO_OUTPUT_WASAPI_SHARED_RAW_UNSUPPORTED_FORMAT: &str =
    "AUDIO_OUTPUT_WASAPI_SHARED_RAW_UNSUPPORTED_FORMAT";
const AUDIO_OUTPUT_WASAPI_SHARED_RAW_INIT_FAILED: &str =
    "AUDIO_OUTPUT_WASAPI_SHARED_RAW_INIT_FAILED";
const SHARED_RAW_MAX_RENDER_RETRIES: u32 = 3;
const SHARED_RAW_RETRY_BASE_DELAY_MS: u64 = 50;

fn is_transient_shared_raw_error(err: &AudioOutputError) -> bool {
    !matches!(
        err.code,
        AUDIO_OUTPUT_WASAPI_SHARED_RAW_UNSUPPORTED_FORMAT
            | AUDIO_OUTPUT_WASAPI_SHARED_RAW_INIT_FAILED
            | AUDIO_OUTPUT_WASAPI_EXCLUSIVE_UNSUPPORTED_FORMAT
    )
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WasapiStreamMode {
    Exclusive,
    SharedRaw,
}

static CALLBACK_WAIT_TIMEOUT_COUNT: AtomicU64 = AtomicU64::new(0);
static CALLBACK_RENDER_COUNT: AtomicU64 = AtomicU64::new(0);
static CALLBACK_RENDER_TOTAL_US: AtomicU64 = AtomicU64::new(0);
static CALLBACK_RENDER_MAX_US: AtomicU64 = AtomicU64::new(0);
static CALLBACK_RENDER_QUEUE_UNDERRUN_EVENTS: AtomicU64 = AtomicU64::new(0);
static CALLBACK_RENDER_QUEUE_UNDERRUN_FRAMES: AtomicU64 = AtomicU64::new(0);
static CALLBACK_INTERVAL_JITTER_COUNT: AtomicU64 = AtomicU64::new(0);
static CALLBACK_INTERVAL_JITTER_TOTAL_US: AtomicU64 = AtomicU64::new(0);
static CALLBACK_INTERVAL_JITTER_MAX_US: AtomicU64 = AtomicU64::new(0);
static CALLBACK_INTERVAL_OVERRUN_COUNT: AtomicU64 = AtomicU64::new(0);
static CALLBACK_EXPECTED_INTERVAL_US: AtomicU64 = AtomicU64::new(0);
static CALLBACK_INTERVAL_OVERRUN_TIMELINE_GATE_MS: AtomicU64 = AtomicU64::new(0);
static CALLBACK_WAIT_TIMEOUT_TIMELINE_GATE_MS: AtomicU64 = AtomicU64::new(0);
static CALLBACK_RENDER_UNDERRUN_TIMELINE_GATE_MS: AtomicU64 = AtomicU64::new(0);
static QUANTIZATION_RNG_STATE: AtomicU64 = AtomicU64::new(0x9E37_79B9_7F4A_7C15);

#[derive(Debug)]
struct UnderrunDeclicker {
    last_frame: Vec<f32>,
    fade_in_pos: usize,
    fade_in_total_frames: usize,
    underrun_streak: u32,
}

impl UnderrunDeclicker {
    fn new(channels: usize) -> Self {
        Self {
            last_frame: vec![0.0; channels],
            fade_in_pos: 0,
            fade_in_total_frames: 0,
            underrun_streak: 0,
        }
    }

    fn ensure_channels(&mut self, channels: usize) {
        if self.last_frame.len() != channels {
            self.last_frame = vec![0.0; channels];
        } else {
            self.last_frame.fill(0.0);
        }
        self.fade_in_pos = 0;
        self.fade_in_total_frames = 0;
        self.underrun_streak = 0;
    }

    fn on_intentional_silence(&mut self, channels: usize, sample_rate: u32) {
        if self.last_frame.len() != channels {
            self.last_frame = vec![0.0; channels];
        } else {
            self.last_frame.fill(0.0);
        }
        self.fade_in_total_frames =
            adaptive_declick_frames(sample_rate, RealtimePressureProfile::Normal, 1);
        self.fade_in_pos = 0;
        self.underrun_streak = 0;
    }

    fn apply_fade_in(&mut self, scratch: &mut [f32], available_frames: u32, channels: usize) {
        if self.fade_in_total_frames <= 1 || self.fade_in_pos >= self.fade_in_total_frames {
            self.fade_in_pos = self.fade_in_total_frames;
            return;
        }

        let remaining = self.fade_in_total_frames.saturating_sub(self.fade_in_pos);
        let frames_to_apply = remaining.min(available_frames as usize);
        if frames_to_apply == 0 {
            return;
        }

        for frame in 0..frames_to_apply {
            let gain =
                equal_power_fade_in_gain(self.fade_in_pos + frame, self.fade_in_total_frames);
            let offset = frame * channels;
            for channel in 0..channels {
                scratch[offset + channel] *= gain;
            }
        }

        self.fade_in_pos = self
            .fade_in_pos
            .saturating_add(frames_to_apply)
            .min(self.fade_in_total_frames);
    }

    fn snapshot_tail_frame(&mut self, scratch: &[f32], available_frames: u32, channels: usize) {
        if self.last_frame.len() != channels {
            self.last_frame = vec![0.0; channels];
        }

        if available_frames == 0 {
            return;
        }

        let base = available_frames.saturating_sub(1) as usize * channels;
        self.last_frame
            .copy_from_slice(&scratch[base..base + channels]);
    }

    fn apply_underrun_fade_out(
        &mut self,
        scratch: &mut [f32],
        frames: u32,
        available_frames: u32,
        channels: usize,
        requested_fade_frames: usize,
    ) {
        let frames = frames as usize;
        let available_frames = available_frames.min(frames as u32) as usize;
        let missing_frames = frames.saturating_sub(available_frames);
        let adaptive_ceiling = missing_frames.saturating_mul(8);
        let fade_frames = requested_fade_frames
            .min(adaptive_ceiling.max(32))
            .min(frames)
            .max(1);

        if fade_frames <= 1 {
            return;
        }

        let ramp_start = if missing_frames.saturating_mul(2) >= fade_frames {
            available_frames
        } else {
            frames.saturating_sub(fade_frames)
        };
        let ramp_end = (ramp_start + fade_frames).min(frames);
        let ramp_len = ramp_end.saturating_sub(ramp_start).max(1);
        for frame in ramp_start..ramp_end {
            let idx = frame.saturating_sub(ramp_start);
            let gain = equal_power_fade_out_gain(idx, ramp_len);
            let offset = frame * channels;

            if frame < available_frames {
                for channel in 0..channels {
                    scratch[offset + channel] *= gain;
                }
            } else {
                for channel in 0..channels {
                    scratch[offset + channel] = self.last_frame[channel] * gain;
                }
            }
        }

        for frame in ramp_end..frames {
            let offset = frame * channels;
            scratch[offset..offset + channels].fill(0.0);
        }
    }

    fn store_last_frame(&mut self, scratch: &[f32], frames: u32, channels: usize) {
        if channels == 0 || frames == 0 {
            return;
        }

        if self.last_frame.len() != channels {
            self.last_frame = vec![0.0; channels];
        }

        let base = (frames.saturating_sub(1) as usize) * channels;
        self.last_frame
            .copy_from_slice(&scratch[base..base + channels]);
    }

    fn process_render_buffer(
        &mut self,
        scratch: &mut Vec<f32>,
        frames: u32,
        sample_rate: u32,
        channels: usize,
        available_samples: usize,
        underrun: bool,
    ) {
        if channels == 0 {
            scratch.clear();
            return;
        }

        let total_samples = frames as usize * channels;
        let available_frames = (available_samples / channels).min(frames as usize) as u32;

        if scratch.len() < total_samples {
            scratch.resize(total_samples, 0.0);
        } else if scratch.len() > total_samples {
            scratch.truncate(total_samples);
        }

        if underrun {
            self.underrun_streak = self.underrun_streak.saturating_add(1);
            self.snapshot_tail_frame(scratch, available_frames, channels);
            let fade_frames =
                adaptive_declick_frames(sample_rate, SCHEDULER.profile(), self.underrun_streak);
            self.apply_underrun_fade_out(scratch, frames, available_frames, channels, fade_frames);
            self.fade_in_total_frames = fade_frames.max(1);
            self.fade_in_pos = 0;
        } else {
            self.underrun_streak = 0;
            self.apply_fade_in(scratch, available_frames, channels);
            self.store_last_frame(scratch, frames, channels);
        }
    }
}

#[cfg(test)]
mod declicker_tests {
    use super::{adaptive_declick_frames, UnderrunDeclicker};
    use crate::audio::realtime_scheduler::RealtimePressureProfile;

    const EPS: f32 = 1e-4;
    const SAMPLE_RATE: u32 = 48_000;

    #[test]
    fn fade_in_progresses_across_small_buffers() {
        let frames = 64u32;
        let channels = 1usize;

        let mut declicker = UnderrunDeclicker::new(channels);
        declicker.on_intentional_silence(channels, SAMPLE_RATE);

        let mut scratch = vec![1.0f32; frames as usize * channels];
        let available_samples = scratch.len();
        declicker.process_render_buffer(
            &mut scratch,
            frames,
            SAMPLE_RATE,
            channels,
            available_samples,
            false,
        );
        assert!(scratch[0].abs() <= EPS);
        assert!(scratch[frames as usize - 1] < 1.0);
        for idx in 0..(frames as usize - 1) {
            assert!(scratch[idx + 1] + EPS >= scratch[idx]);
        }

        let mut scratch2 = vec![1.0f32; frames as usize * channels];
        let available_samples2 = scratch2.len();
        declicker.process_render_buffer(
            &mut scratch2,
            frames,
            SAMPLE_RATE,
            channels,
            available_samples2,
            false,
        );
        assert!(scratch2[0] + EPS >= scratch[frames as usize - 1]);
        assert!(scratch2[frames as usize - 1] > scratch2[0]);
        assert!(scratch2[frames as usize - 1] < 1.0);
    }

    #[test]
    fn underrun_ramps_down_and_zeros_tail_when_missing_large() {
        let frames = 256u32;
        let channels = 1usize;
        let available_frames = 64usize;

        let mut declicker = UnderrunDeclicker::new(channels);

        let mut scratch = vec![1.0f32; available_frames * channels];
        let available_samples = scratch.len();
        declicker.process_render_buffer(
            &mut scratch,
            frames,
            SAMPLE_RATE,
            channels,
            available_samples,
            true,
        );

        assert_eq!(scratch.len(), frames as usize * channels);
        assert!((scratch[0] - 1.0).abs() <= EPS);
        assert!(scratch[available_frames - 1] <= 1.0 + EPS);
        assert!(scratch[available_frames] <= scratch[available_frames - 1] + EPS);
        assert!(scratch[frames as usize - 1].abs() <= EPS);

        for idx in available_frames..(frames as usize - 1) {
            assert!(scratch[idx + 1] <= scratch[idx] + 1e-3);
            assert!(scratch[idx] >= -EPS);
        }
    }

    #[test]
    fn underrun_fade_out_spreads_into_audio_when_missing_small() {
        let frames = 256u32;
        let channels = 1usize;
        let available_frames = 240usize;

        let mut declicker = UnderrunDeclicker::new(channels);

        let mut scratch = vec![1.0f32; available_frames * channels];
        let available_samples = scratch.len();
        declicker.process_render_buffer(
            &mut scratch,
            frames,
            SAMPLE_RATE,
            channels,
            available_samples,
            true,
        );

        assert!((scratch[96] - 1.0).abs() <= EPS);
        assert!(scratch[239] <= 1.0 + EPS);
        assert!(scratch[240] <= scratch[239] + EPS);
        assert!(scratch[255].abs() <= EPS);
    }

    #[test]
    fn adaptive_declick_frames_track_profile_and_streak() {
        let low_sr = adaptive_declick_frames(24_000, RealtimePressureProfile::Normal, 1);
        let normal = adaptive_declick_frames(SAMPLE_RATE, RealtimePressureProfile::Normal, 1);
        let guarded = adaptive_declick_frames(SAMPLE_RATE, RealtimePressureProfile::Guarded, 1);
        let critical = adaptive_declick_frames(SAMPLE_RATE, RealtimePressureProfile::Critical, 1);
        let streak = adaptive_declick_frames(SAMPLE_RATE, RealtimePressureProfile::Normal, 4);

        assert!(normal >= 1);
        assert!(normal >= low_sr);
        assert!(guarded >= normal);
        assert!(critical >= guarded);
        assert!(streak >= normal);
    }
}

fn p99_like_u32(total_us: u64, sample_count: u64, max_us: u64) -> u32 {
    if sample_count == 0 {
        return 0;
    }

    let avg = total_us / sample_count;
    avg.max(max_us).min(u32::MAX as u64) as u32
}

pub(crate) fn output_callback_metrics() -> OutputCallbackMetricsSnapshot {
    let render_count = CALLBACK_RENDER_COUNT.load(Ordering::Relaxed);
    let total_us = CALLBACK_RENDER_TOTAL_US.load(Ordering::Relaxed);
    let max_us = CALLBACK_RENDER_MAX_US.load(Ordering::Relaxed);
    let jitter_count = CALLBACK_INTERVAL_JITTER_COUNT.load(Ordering::Relaxed);
    let jitter_total_us = CALLBACK_INTERVAL_JITTER_TOTAL_US.load(Ordering::Relaxed);
    let jitter_max_us = CALLBACK_INTERVAL_JITTER_MAX_US.load(Ordering::Relaxed);

    OutputCallbackMetricsSnapshot {
        render_p99_us: p99_like_u32(total_us, render_count, max_us),
        wait_timeout_count: CALLBACK_WAIT_TIMEOUT_COUNT.load(Ordering::Relaxed),
        render_underrun_events: CALLBACK_RENDER_QUEUE_UNDERRUN_EVENTS.load(Ordering::Relaxed),
        render_underrun_frames: CALLBACK_RENDER_QUEUE_UNDERRUN_FRAMES.load(Ordering::Relaxed),
        interval_jitter_p99_us: p99_like_u32(jitter_total_us, jitter_count, jitter_max_us),
        interval_overrun_count: CALLBACK_INTERVAL_OVERRUN_COUNT.load(Ordering::Relaxed),
        expected_interval_us: CALLBACK_EXPECTED_INTERVAL_US
            .load(Ordering::Relaxed)
            .min(u32::MAX as u64) as u32,
    }
}

fn reset_output_callback_metrics() {
    CALLBACK_WAIT_TIMEOUT_COUNT.store(0, Ordering::Relaxed);
    CALLBACK_RENDER_COUNT.store(0, Ordering::Relaxed);
    CALLBACK_RENDER_TOTAL_US.store(0, Ordering::Relaxed);
    CALLBACK_RENDER_MAX_US.store(0, Ordering::Relaxed);
    CALLBACK_RENDER_QUEUE_UNDERRUN_EVENTS.store(0, Ordering::Relaxed);
    CALLBACK_RENDER_QUEUE_UNDERRUN_FRAMES.store(0, Ordering::Relaxed);
    CALLBACK_INTERVAL_JITTER_COUNT.store(0, Ordering::Relaxed);
    CALLBACK_INTERVAL_JITTER_TOTAL_US.store(0, Ordering::Relaxed);
    CALLBACK_INTERVAL_JITTER_MAX_US.store(0, Ordering::Relaxed);
    CALLBACK_INTERVAL_OVERRUN_COUNT.store(0, Ordering::Relaxed);
    CALLBACK_EXPECTED_INTERVAL_US.store(0, Ordering::Relaxed);
}

fn record_callback_render_cost(duration_us: u32) {
    let duration_us_u64 = duration_us as u64;
    CALLBACK_RENDER_COUNT.fetch_add(1, Ordering::Relaxed);
    CALLBACK_RENDER_TOTAL_US.fetch_add(duration_us_u64, Ordering::Relaxed);

    let mut observed = CALLBACK_RENDER_MAX_US.load(Ordering::Relaxed);
    while duration_us_u64 > observed {
        match CALLBACK_RENDER_MAX_US.compare_exchange(
            observed,
            duration_us_u64,
            Ordering::Relaxed,
            Ordering::Relaxed,
        ) {
            Ok(_) => break,
            Err(next) => observed = next,
        }
    }
}

fn record_callback_interval(interval_us: u64, expected_interval_us: u64) {
    if expected_interval_us == 0 {
        return;
    }

    let jitter_us = interval_us.abs_diff(expected_interval_us);
    CALLBACK_INTERVAL_JITTER_COUNT.fetch_add(1, Ordering::Relaxed);
    CALLBACK_INTERVAL_JITTER_TOTAL_US.fetch_add(jitter_us, Ordering::Relaxed);

    let mut observed_jitter = CALLBACK_INTERVAL_JITTER_MAX_US.load(Ordering::Relaxed);
    while jitter_us > observed_jitter {
        match CALLBACK_INTERVAL_JITTER_MAX_US.compare_exchange(
            observed_jitter,
            jitter_us,
            Ordering::Relaxed,
            Ordering::Relaxed,
        ) {
            Ok(_) => break,
            Err(next) => observed_jitter = next,
        }
    }

    let overrun_tolerance_us = (expected_interval_us / 4).max(1_000);
    if interval_us > expected_interval_us.saturating_add(overrun_tolerance_us) {
        CALLBACK_INTERVAL_OVERRUN_COUNT.fetch_add(1, Ordering::Relaxed);
        diagnostics::record_event_throttled(
            "exclusive.callback.interval_overrun",
            interval_us,
            expected_interval_us,
            &CALLBACK_INTERVAL_OVERRUN_TIMELINE_GATE_MS,
            150,
        );
    }
}

#[derive(Default)]
struct CallbackTimingState {
    expected_interval_us: u64,
    last_wake_at: Option<Instant>,
}

impl CallbackTimingState {
    fn reset_for_stream(&mut self, buffer_frame_count: u32, sample_rate: u32) {
        let sample_rate_u128 = sample_rate.max(1) as u128;
        let expected = ((buffer_frame_count as u128) * 1_000_000u128)
            .saturating_div(sample_rate_u128)
            .max(1)
            .min(u64::MAX as u128) as u64;

        self.expected_interval_us = expected;
        self.last_wake_at = None;
        CALLBACK_EXPECTED_INTERVAL_US.store(expected, Ordering::Relaxed);
    }

    fn clear_last_wake(&mut self) {
        self.last_wake_at = None;
    }

    fn on_callback_wake(&mut self) {
        let now = Instant::now();
        if let Some(last) = self.last_wake_at {
            let interval_us = now.duration_since(last).as_micros().min(u64::MAX as u128) as u64;
            record_callback_interval(interval_us, self.expected_interval_us);
        }
        self.last_wake_at = Some(now);
    }
}

impl Default for BackendState {
    fn default() -> Self {
        Self {
            device_id: None,
            device_name: None,
            output_sample_rate: None,
            stream_open: false,
            error: None,
            transport_mode: NativeAudioTransportMode::Robust,
            output_quantization_mode: NativeAudioOutputQuantizationMode::Round,
        }
    }
}

struct BackendState {
    device_id: Option<String>,
    device_name: Option<String>,
    output_sample_rate: Option<u32>,
    stream_open: bool,
    error: Option<AudioOutputError>,
    transport_mode: NativeAudioTransportMode,
    output_quantization_mode: NativeAudioOutputQuantizationMode,
}

pub struct WasapiExclusiveBackend {
    state: Arc<Mutex<BackendState>>,
    output_quantization_mode_bits: Arc<AtomicU32>,
}

impl WasapiExclusiveBackend {
    pub fn new() -> Self {
        let output_quantization_mode_bits = Arc::new(AtomicU32::new(quantization_mode_to_bits(
            NativeAudioOutputQuantizationMode::Round,
        )));
        Self {
            state: Arc::new(Mutex::new(BackendState::default())),
            output_quantization_mode_bits,
        }
    }

    fn resolve_device_by_id(&self, device_id: &str) -> Result<(), String> {
        let device_id = device_id.trim();
        if device_id.is_empty() {
            return self.resolve_default_device();
        }

        let devices = enumerate_render_devices()?;
        let matched = devices
            .into_iter()
            .find(|device| device.id == device_id)
            .ok_or_else(|| format!("Output device not found: {device_id}"))?;

        let mut state = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?;
        state.device_id = Some(matched.id);
        state.device_name = Some(matched.name);
        Ok(())
    }

    fn resolve_default_device(&self) -> Result<(), String> {
        let info = resolve_default_render_device()?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?;
        state.device_id = Some(info.id);
        state.device_name = Some(info.name);
        Ok(())
    }

    fn resolve_named_device(&self, device_name: &str) -> Result<(), String> {
        let device_name = device_name.trim();
        if device_name.is_empty() {
            return self.resolve_default_device();
        }

        let devices = enumerate_render_devices()?;
        let matched = devices
            .into_iter()
            .find(|device| device.name == device_name)
            .ok_or_else(|| format!("Output device not found: {device_name}"))?;

        let mut state = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?;
        state.device_id = Some(matched.id);
        state.device_name = Some(matched.name);
        Ok(())
    }

    fn ensure_device_selected(&self) -> Result<(), String> {
        let has_device = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?
            .device_id
            .is_some();
        if has_device {
            return Ok(());
        }
        self.resolve_default_device()
    }
}

impl Default for WasapiExclusiveBackend {
    fn default() -> Self {
        Self::new()
    }
}

static DEFAULT_BACKEND: Lazy<Arc<WasapiExclusiveBackend>> =
    Lazy::new(|| Arc::new(WasapiExclusiveBackend::new()));

pub fn wasapi_exclusive_backend() -> Arc<dyn AudioOutputBackend> {
    DEFAULT_BACKEND.clone()
}

pub struct WasapiSharedRawBackend {
    state: Arc<Mutex<BackendState>>,
    output_quantization_mode_bits: Arc<AtomicU32>,
}

impl WasapiSharedRawBackend {
    pub fn new() -> Self {
        let output_quantization_mode_bits = Arc::new(AtomicU32::new(quantization_mode_to_bits(
            NativeAudioOutputQuantizationMode::Round,
        )));
        Self {
            state: Arc::new(Mutex::new(BackendState::default())),
            output_quantization_mode_bits,
        }
    }

    fn resolve_device_by_id(&self, device_id: &str) -> Result<(), String> {
        let device_id = device_id.trim();
        if device_id.is_empty() {
            return self.resolve_default_device();
        }

        let devices = enumerate_render_devices()?;
        let matched = devices
            .into_iter()
            .find(|device| device.id == device_id)
            .ok_or_else(|| format!("Output device not found: {device_id}"))?;
        let mix_sample_rate = query_render_device_mix_sample_rate(&matched.id)
            .ok()
            .flatten();

        let mut state = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?;
        state.device_id = Some(matched.id);
        state.device_name = Some(matched.name);
        state.output_sample_rate = mix_sample_rate;
        Ok(())
    }

    fn resolve_default_device(&self) -> Result<(), String> {
        let info = resolve_default_render_device()?;
        let mix_sample_rate = query_render_device_mix_sample_rate(&info.id).ok().flatten();
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?;
        state.device_id = Some(info.id);
        state.device_name = Some(info.name);
        state.output_sample_rate = mix_sample_rate;
        Ok(())
    }

    fn resolve_named_device(&self, device_name: &str) -> Result<(), String> {
        let device_name = device_name.trim();
        if device_name.is_empty() {
            return self.resolve_default_device();
        }

        let devices = enumerate_render_devices()?;
        let matched = devices
            .into_iter()
            .find(|device| device.name == device_name)
            .ok_or_else(|| format!("Output device not found: {device_name}"))?;
        let mix_sample_rate = query_render_device_mix_sample_rate(&matched.id)
            .ok()
            .flatten();

        let mut state = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?;
        state.device_id = Some(matched.id);
        state.device_name = Some(matched.name);
        state.output_sample_rate = mix_sample_rate;
        Ok(())
    }

    fn ensure_device_selected(&self) -> Result<(), String> {
        let (device_id, output_sample_rate) = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())
            .map(|state| (state.device_id.clone(), state.output_sample_rate))?;
        if let Some(device_id) = device_id {
            if output_sample_rate.is_none() {
                let mix_sample_rate = query_render_device_mix_sample_rate(&device_id)
                    .ok()
                    .flatten();
                if let Ok(mut state) = self.state.lock() {
                    if state.output_sample_rate.is_none() {
                        state.output_sample_rate = mix_sample_rate;
                    }
                }
            }
            return Ok(());
        }
        self.resolve_default_device()
    }
}

impl Default for WasapiSharedRawBackend {
    fn default() -> Self {
        Self::new()
    }
}

static SHARED_RAW_BACKEND: Lazy<Arc<WasapiSharedRawBackend>> =
    Lazy::new(|| Arc::new(WasapiSharedRawBackend::new()));

pub fn wasapi_shared_raw_backend() -> Arc<dyn AudioOutputBackend> {
    SHARED_RAW_BACKEND.clone()
}

impl AudioOutputBackend for WasapiExclusiveBackend {
    fn id(&self) -> &'static str {
        WASAPI_EXCLUSIVE_BACKEND_ID
    }

    fn list_devices(&self) -> Result<Vec<String>, String> {
        let mut names = enumerate_render_devices()?
            .into_iter()
            .map(|device| device.name)
            .collect::<Vec<_>>();
        names.sort();
        names.dedup();
        Ok(names)
    }

    fn list_devices_v2(&self) -> Result<Vec<OutputDeviceInfo>, String> {
        let default_id = resolve_default_render_device().ok().map(|device| device.id);
        enumerate_render_devices().map(|devices| {
            devices
                .into_iter()
                .map(|device| OutputDeviceInfo {
                    id: device.id.clone(),
                    name: device.name.clone(),
                    is_default: default_id
                        .as_deref()
                        .is_some_and(|default_id| default_id == device.id.as_str()),
                })
                .collect()
        })
    }

    fn default_device_name(&self) -> Option<String> {
        resolve_default_render_device()
            .ok()
            .map(|device| device.name)
    }

    fn default_device_info(&self) -> OutputStreamInfo {
        resolve_default_render_device()
            .ok()
            .map(|device| OutputStreamInfo {
                device_id: Some(device.id),
                device_name: Some(device.name),
                output_sample_rate: None,
            })
            .unwrap_or_default()
    }

    fn current_info(&self) -> OutputStreamInfo {
        let guard = self.state.lock();
        let Ok(guard) = guard else {
            return OutputStreamInfo::default();
        };
        OutputStreamInfo {
            device_id: guard.device_id.clone(),
            device_name: guard.device_name.clone(),
            output_sample_rate: guard.output_sample_rate,
        }
    }

    fn is_stream_open(&self) -> bool {
        let guard = self.state.lock();
        let Ok(guard) = guard else {
            return false;
        };
        guard.stream_open
    }

    fn select_device(&self, device_name: Option<String>) -> Result<OutputStreamInfo, String> {
        if let Some(name) = device_name.as_deref() {
            self.resolve_named_device(name)?;
        } else {
            self.resolve_default_device()?;
        }

        let mut state = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?;
        state.stream_open = false;
        state.output_sample_rate = None;
        state.error = None;

        Ok(OutputStreamInfo {
            device_id: state.device_id.clone(),
            device_name: state.device_name.clone(),
            output_sample_rate: None,
        })
    }

    fn select_device_by_id(&self, device_id: Option<String>) -> Result<OutputStreamInfo, String> {
        if let Some(device_id) = device_id.as_deref() {
            self.resolve_device_by_id(device_id)?;
        } else {
            self.resolve_default_device()?;
        }

        let mut state = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?;
        state.stream_open = false;
        state.output_sample_rate = None;
        state.error = None;

        Ok(OutputStreamInfo {
            device_id: state.device_id.clone(),
            device_name: state.device_name.clone(),
            output_sample_rate: None,
        })
    }

    fn create_sink(&self) -> Result<(Arc<dyn AudioSink>, OutputStreamInfo), String> {
        self.ensure_device_selected()?;
        let sink = WasapiExclusiveSink::new(
            self.state.clone(),
            self.output_quantization_mode_bits.clone(),
        );
        let info = self.current_info();
        Ok((Arc::new(sink), info))
    }

    fn take_error(&self) -> Option<AudioOutputError> {
        let mut guard = self.state.lock().ok()?;
        guard.error.take()
    }

    fn set_transport_mode(&self, mode: NativeAudioTransportMode) {
        if let Ok(mut guard) = self.state.lock() {
            guard.transport_mode = mode;
        }
    }

    fn set_output_quantization_mode(&self, mode: NativeAudioOutputQuantizationMode) {
        self.output_quantization_mode_bits
            .store(quantization_mode_to_bits(mode), Ordering::Release);
        if let Ok(mut guard) = self.state.lock() {
            guard.output_quantization_mode = mode;
        }
    }
}

impl AudioOutputBackend for WasapiSharedRawBackend {
    fn id(&self) -> &'static str {
        WASAPI_SHARED_RAW_BACKEND_ID
    }

    fn list_devices(&self) -> Result<Vec<String>, String> {
        let mut names = enumerate_render_devices()?
            .into_iter()
            .map(|device| device.name)
            .collect::<Vec<_>>();
        names.sort();
        names.dedup();
        Ok(names)
    }

    fn list_devices_v2(&self) -> Result<Vec<OutputDeviceInfo>, String> {
        let default_id = resolve_default_render_device().ok().map(|device| device.id);
        enumerate_render_devices().map(|devices| {
            devices
                .into_iter()
                .map(|device| OutputDeviceInfo {
                    id: device.id.clone(),
                    name: device.name.clone(),
                    is_default: default_id
                        .as_deref()
                        .is_some_and(|default_id| default_id == device.id.as_str()),
                })
                .collect()
        })
    }

    fn default_device_name(&self) -> Option<String> {
        resolve_default_render_device()
            .ok()
            .map(|device| device.name)
    }

    fn default_device_info(&self) -> OutputStreamInfo {
        resolve_default_render_device()
            .ok()
            .map(|device| OutputStreamInfo {
                device_id: Some(device.id),
                device_name: Some(device.name),
                output_sample_rate: None,
            })
            .unwrap_or_default()
    }

    fn current_info(&self) -> OutputStreamInfo {
        let guard = self.state.lock();
        let Ok(guard) = guard else {
            return OutputStreamInfo::default();
        };
        OutputStreamInfo {
            device_id: guard.device_id.clone(),
            device_name: guard.device_name.clone(),
            output_sample_rate: guard.output_sample_rate,
        }
    }

    fn is_stream_open(&self) -> bool {
        let guard = self.state.lock();
        let Ok(guard) = guard else {
            return false;
        };
        guard.stream_open
    }

    fn select_device(&self, device_name: Option<String>) -> Result<OutputStreamInfo, String> {
        if let Some(name) = device_name.as_deref() {
            self.resolve_named_device(name)?;
        } else {
            self.resolve_default_device()?;
        }

        let mut state = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?;
        state.stream_open = false;
        state.output_sample_rate = None;
        state.error = None;

        Ok(OutputStreamInfo {
            device_id: state.device_id.clone(),
            device_name: state.device_name.clone(),
            output_sample_rate: None,
        })
    }

    fn select_device_by_id(&self, device_id: Option<String>) -> Result<OutputStreamInfo, String> {
        if let Some(device_id) = device_id.as_deref() {
            self.resolve_device_by_id(device_id)?;
        } else {
            self.resolve_default_device()?;
        }

        let mut state = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?;
        state.stream_open = false;
        state.output_sample_rate = None;
        state.error = None;

        Ok(OutputStreamInfo {
            device_id: state.device_id.clone(),
            device_name: state.device_name.clone(),
            output_sample_rate: None,
        })
    }

    fn create_sink(&self) -> Result<(Arc<dyn AudioSink>, OutputStreamInfo), String> {
        self.ensure_device_selected()?;
        let sink = WasapiSharedRawSink::new(
            self.state.clone(),
            self.output_quantization_mode_bits.clone(),
        );
        let info = self.current_info();
        Ok((Arc::new(sink), info))
    }

    fn take_error(&self) -> Option<AudioOutputError> {
        let mut guard = self.state.lock().ok()?;
        guard.error.take()
    }

    fn set_transport_mode(&self, mode: NativeAudioTransportMode) {
        if let Ok(mut guard) = self.state.lock() {
            guard.transport_mode = mode;
        }
    }

    fn set_output_quantization_mode(&self, mode: NativeAudioOutputQuantizationMode) {
        self.output_quantization_mode_bits
            .store(quantization_mode_to_bits(mode), Ordering::Release);
        if let Ok(mut guard) = self.state.lock() {
            guard.output_quantization_mode = mode;
        }
    }
}

struct DeviceInfo {
    id: String,
    name: String,
}

#[cfg(target_os = "windows")]
fn enumerate_render_devices() -> Result<Vec<DeviceInfo>, String> {
    use windows::Win32::Media::Audio::{
        eRender, IMMDevice, IMMDeviceCollection, IMMDeviceEnumerator, MMDeviceEnumerator,
        DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("Failed to create MMDeviceEnumerator: {e}"))?;

        let collection: IMMDeviceCollection = enumerator
            .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
            .map_err(|e| format!("Failed to enumerate audio endpoints: {e}"))?;

        let count = collection
            .GetCount()
            .map_err(|e| format!("Failed to get endpoints count: {e}"))?;

        let mut devices = Vec::with_capacity(count as usize);
        for index in 0..count {
            let device: IMMDevice = collection
                .Item(index)
                .map_err(|e| format!("Failed to get endpoint {index}: {e}"))?;
            devices.push(get_device_info(&device)?);
        }

        devices.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
        Ok(devices)
    }
}

#[cfg(not(target_os = "windows"))]
fn enumerate_render_devices() -> Result<Vec<DeviceInfo>, String> {
    Ok(Vec::new())
}

#[cfg(target_os = "windows")]
fn resolve_default_render_device() -> Result<DeviceInfo, String> {
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("Failed to create MMDeviceEnumerator: {e}"))?;

        let device: IMMDevice = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("Failed to get default audio endpoint: {e}"))?;

        get_device_info(&device)
    }
}

#[cfg(not(target_os = "windows"))]
fn resolve_default_render_device() -> Result<DeviceInfo, String> {
    Err("WASAPI is only available on Windows".to_string())
}

#[cfg(target_os = "windows")]
fn query_render_device_mix_sample_rate(device_id: &str) -> Result<Option<u32>, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Media::Audio::{
        IAudioClient, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("Failed to create MMDeviceEnumerator: {e}"))?;

        let device_id_wide: Vec<u16> = device_id.encode_utf16().chain(Some(0)).collect();
        let device: IMMDevice = enumerator
            .GetDevice(PCWSTR(device_id_wide.as_ptr()))
            .map_err(|e| format!("Failed to open output device: {e}"))?;

        let audio_client: IAudioClient = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Failed to activate audio client: {e}"))?;

        let mix_ptr = audio_client
            .GetMixFormat()
            .map_err(|e| format!("Failed to query mix format: {e}"))?;

        if mix_ptr.is_null() {
            return Ok(None);
        }

        let mix = &*mix_ptr;
        let sample_rate = if mix.nSamplesPerSec > 0 {
            Some(mix.nSamplesPerSec)
        } else {
            None
        };
        windows::Win32::System::Com::CoTaskMemFree(Some(mix_ptr as *const c_void));
        Ok(sample_rate)
    }
}

#[cfg(not(target_os = "windows"))]
fn query_render_device_mix_sample_rate(_device_id: &str) -> Result<Option<u32>, String> {
    Ok(None)
}

#[cfg(target_os = "windows")]
fn get_device_info(device: &windows::Win32::Media::Audio::IMMDevice) -> Result<DeviceInfo, String> {
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
    use windows::Win32::System::Com::{CoTaskMemFree, STGM_READ};
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;

    unsafe {
        let id_ptr = device
            .GetId()
            .map_err(|e| format!("Failed to get device id: {e}"))?;
        let id = pwstr_to_string(id_ptr);
        CoTaskMemFree(Some(id_ptr.0 as *const c_void));

        let store: IPropertyStore = device
            .OpenPropertyStore(STGM_READ)
            .map_err(|e| format!("Failed to open property store: {e}"))?;
        let value = store
            .GetValue(&PKEY_Device_FriendlyName)
            .map_err(|e| format!("Failed to read device friendly name: {e}"))?;
        let name_ptr = PropVariantToStringAlloc(&value)
            .map_err(|e| format!("Failed to format device friendly name: {e}"))?;
        let name = pwstr_to_string(name_ptr);
        CoTaskMemFree(Some(name_ptr.0 as *const c_void));

        Ok(DeviceInfo { id, name })
    }
}

#[cfg(target_os = "windows")]
fn pwstr_to_string(value: windows::core::PWSTR) -> String {
    if value.0.is_null() {
        return String::new();
    }
    unsafe {
        let mut len = 0usize;
        while *value.0.add(len) != 0 {
            len += 1;
        }
        let slice = std::slice::from_raw_parts(value.0, len);
        String::from_utf16_lossy(slice)
    }
}

#[derive(Clone, Copy, Debug)]
enum WasapiSampleFormat {
    Float32,
    Pcm16,
    Pcm24Packed,
    Pcm24In32,
    Pcm32,
}

#[inline]
fn quantize_pcm24(sample: f32, volume: f32) -> i32 {
    let scaled = sample * (8_388_607.0f32 * volume);
    scaled.round().clamp(-8_388_608.0, 8_388_607.0) as i32
}

#[inline]
fn quantize_pcm16_round(sample: f32, volume: f32) -> i16 {
    let scaled = sample * ((i16::MAX as f32) * volume);
    scaled.round().clamp(i16::MIN as f32, i16::MAX as f32) as i16
}

#[inline]
fn quantize_pcm16_with_mode(
    sample: f32,
    volume: f32,
    mode: NativeAudioOutputQuantizationMode,
    dither_state: &mut u64,
) -> i16 {
    if matches!(mode, NativeAudioOutputQuantizationMode::Round) {
        return quantize_pcm16_round(sample, volume);
    }
    let scaled = sample * ((i16::MAX as f32) * volume) + tpdf_noise_lsb(dither_state);
    scaled.round().clamp(i16::MIN as f32, i16::MAX as f32) as i16
}

#[inline]
fn quantize_pcm32_with_mode(
    sample: f32,
    volume: f32,
    mode: NativeAudioOutputQuantizationMode,
    dither_state: &mut u64,
) -> i32 {
    let mut scaled = sample * ((i32::MAX as f32) * volume);
    if matches!(mode, NativeAudioOutputQuantizationMode::Tpdf) {
        scaled += tpdf_noise_lsb(dither_state);
    }
    scaled.round().clamp(i32::MIN as f32, i32::MAX as f32) as i32
}

#[inline]
fn next_dither_u32(state: &mut u64) -> u32 {
    *state = state
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    (*state >> 32) as u32
}

#[inline]
fn tpdf_noise_lsb(state: &mut u64) -> f32 {
    let a = next_dither_u32(state) as f32 / u32::MAX as f32;
    let b = next_dither_u32(state) as f32 / u32::MAX as f32;
    a - b
}

#[inline]
fn quantize_pcm24_with_mode(
    sample: f32,
    volume: f32,
    mode: NativeAudioOutputQuantizationMode,
    dither_state: &mut u64,
) -> i32 {
    let mut scaled = sample * 8_388_607.0f32 * volume;
    if matches!(mode, NativeAudioOutputQuantizationMode::Tpdf) {
        scaled += tpdf_noise_lsb(dither_state);
    }
    scaled.round().clamp(-8_388_608.0, 8_388_607.0) as i32
}

#[inline]
fn quantize_pcm24_transport_exact(sample: f32, volume: f32) -> i32 {
    quantize_pcm24(sample, volume)
}

#[inline]
fn pack_pcm24_in32(sample: i32) -> i32 {
    sample << 8
}

#[inline]
fn quantize_pcm24_round_in32_buffer(samples: &[f32], out: *mut i32, volume: f32) {
    if samples.is_empty() {
        return;
    }

    let scale = 8_388_607.0f32 * volume;

    #[cfg(target_arch = "x86_64")]
    {
        if std::arch::is_x86_feature_detected!("avx2") {
            unsafe {
                quantize_pcm24_round_in32_buffer_avx2(samples, out, scale);
            }
            return;
        }
        if std::arch::is_x86_feature_detected!("sse2") {
            unsafe {
                quantize_pcm24_round_in32_buffer_sse2(samples, out, scale);
            }
            return;
        }
    }

    for (index, sample) in samples.iter().enumerate() {
        unsafe {
            *out.add(index) = pack_pcm24_in32(quantize_pcm24(*sample, volume));
        }
    }
}

#[inline]
fn write_scaled_f32_buffer(samples: &[f32], out: *mut f32, volume: f32) {
    if samples.is_empty() {
        return;
    }

    if (volume - 1.0).abs() < 1e-8 {
        unsafe {
            std::ptr::copy_nonoverlapping(samples.as_ptr(), out, samples.len());
        }
        return;
    }

    #[cfg(target_arch = "x86_64")]
    {
        if std::arch::is_x86_feature_detected!("avx2") {
            unsafe {
                write_scaled_f32_buffer_avx2(samples, out, volume);
            }
            return;
        }
        if std::arch::is_x86_feature_detected!("sse2") {
            unsafe {
                write_scaled_f32_buffer_sse2(samples, out, volume);
            }
            return;
        }
    }

    for (index, sample) in samples.iter().enumerate() {
        unsafe {
            *out.add(index) = *sample * volume;
        }
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "sse2")]
unsafe fn write_scaled_f32_buffer_sse2(samples: &[f32], out: *mut f32, volume: f32) {
    use std::arch::x86_64::*;

    let mut i = 0usize;
    let len = samples.len();
    let gain = _mm_set1_ps(volume);

    while i + 4 <= len {
        let ptr = samples.as_ptr().add(i);
        let x = _mm_loadu_ps(ptr);
        let y = _mm_mul_ps(x, gain);
        _mm_storeu_ps(out.add(i), y);
        i += 4;
    }

    while i < len {
        *out.add(i) = *samples.get_unchecked(i) * volume;
        i += 1;
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn write_scaled_f32_buffer_avx2(samples: &[f32], out: *mut f32, volume: f32) {
    use std::arch::x86_64::*;

    let mut i = 0usize;
    let len = samples.len();
    let gain = _mm256_set1_ps(volume);

    while i + 8 <= len {
        let ptr = samples.as_ptr().add(i);
        let x = _mm256_loadu_ps(ptr);
        let y = _mm256_mul_ps(x, gain);
        _mm256_storeu_ps(out.add(i), y);
        i += 8;
    }

    if i < len {
        write_scaled_f32_buffer_sse2(&samples[i..], out.add(i), volume);
    }
}

#[inline]
fn quantize_pcm16_round_buffer(samples: &[f32], out: *mut i16, volume: f32) {
    if samples.is_empty() {
        return;
    }

    let scale = (i16::MAX as f32) * volume;

    #[cfg(target_arch = "x86_64")]
    {
        if std::arch::is_x86_feature_detected!("avx2") {
            unsafe {
                quantize_pcm16_round_buffer_avx2(samples, out, scale);
            }
            return;
        }
        if std::arch::is_x86_feature_detected!("sse2") {
            unsafe {
                quantize_pcm16_round_buffer_sse2(samples, out, scale);
            }
            return;
        }
    }

    for (index, sample) in samples.iter().enumerate() {
        unsafe {
            *out.add(index) = quantize_pcm16_round(*sample, volume);
        }
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "sse2")]
unsafe fn quantize_pcm16_round_buffer_sse2(samples: &[f32], out: *mut i16, scale: f32) {
    use std::arch::x86_64::*;

    let mut i = 0usize;
    let len = samples.len();
    let scale_vec = _mm_set1_ps(scale);
    let min_vec = _mm_set1_ps(i16::MIN as f32);
    let max_vec = _mm_set1_ps(i16::MAX as f32);
    let half_vec = _mm_set1_ps(0.5);
    let sign_mask = _mm_set1_ps(-0.0);

    while i + 4 <= len {
        let ptr = samples.as_ptr().add(i);
        let x = _mm_loadu_ps(ptr);
        let scaled = _mm_mul_ps(x, scale_vec);
        let clamped = _mm_min_ps(_mm_max_ps(scaled, min_vec), max_vec);
        let signed_half = _mm_or_ps(half_vec, _mm_and_ps(clamped, sign_mask));
        let rounded = _mm_cvttps_epi32(_mm_add_ps(clamped, signed_half));
        let packed = _mm_packs_epi32(rounded, rounded);
        _mm_storel_epi64(out.add(i) as *mut __m128i, packed);
        i += 4;
    }

    while i < len {
        let scaled = *samples.get_unchecked(i) * scale;
        *out.add(i) = scaled.round().clamp(i16::MIN as f32, i16::MAX as f32) as i16;
        i += 1;
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn quantize_pcm16_round_buffer_avx2(samples: &[f32], out: *mut i16, scale: f32) {
    use std::arch::x86_64::*;

    let mut i = 0usize;
    let len = samples.len();
    let scale_vec = _mm256_set1_ps(scale);
    let min_vec = _mm256_set1_ps(i16::MIN as f32);
    let max_vec = _mm256_set1_ps(i16::MAX as f32);
    let half_vec = _mm256_set1_ps(0.5);
    let sign_mask = _mm256_set1_ps(-0.0);

    while i + 8 <= len {
        let ptr = samples.as_ptr().add(i);
        let x = _mm256_loadu_ps(ptr);
        let scaled = _mm256_mul_ps(x, scale_vec);
        let clamped = _mm256_min_ps(_mm256_max_ps(scaled, min_vec), max_vec);
        let signed_half = _mm256_or_ps(half_vec, _mm256_and_ps(clamped, sign_mask));
        let rounded = _mm256_cvttps_epi32(_mm256_add_ps(clamped, signed_half));
        let lo = _mm256_castsi256_si128(rounded);
        let hi = _mm256_extracti128_si256(rounded, 1);
        let packed = _mm_packs_epi32(lo, hi);
        _mm_storeu_si128(out.add(i) as *mut __m128i, packed);
        i += 8;
    }

    if i < len {
        quantize_pcm16_round_buffer_sse2(&samples[i..], out.add(i), scale);
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "sse2")]
unsafe fn quantize_pcm24_round_in32_buffer_sse2(samples: &[f32], out: *mut i32, scale: f32) {
    use std::arch::x86_64::*;

    let mut i = 0usize;
    let len = samples.len();
    let scale_vec = _mm_set1_ps(scale);
    let min_vec = _mm_set1_ps(-8_388_608.0);
    let max_vec = _mm_set1_ps(8_388_607.0);
    let half_vec = _mm_set1_ps(0.5);
    let sign_mask = _mm_set1_ps(-0.0);

    while i + 4 <= len {
        let ptr = samples.as_ptr().add(i);
        let x = _mm_loadu_ps(ptr);
        let scaled = _mm_mul_ps(x, scale_vec);
        let clamped = _mm_min_ps(_mm_max_ps(scaled, min_vec), max_vec);
        let signed_half = _mm_or_ps(half_vec, _mm_and_ps(clamped, sign_mask));
        let rounded = _mm_cvttps_epi32(_mm_add_ps(clamped, signed_half));
        let packed = _mm_slli_epi32(rounded, 8);
        _mm_storeu_si128(out.add(i) as *mut __m128i, packed);
        i += 4;
    }

    while i < len {
        let scaled = *samples.get_unchecked(i) * scale;
        let quantized = scaled.round().clamp(-8_388_608.0, 8_388_607.0) as i32;
        *out.add(i) = pack_pcm24_in32(quantized);
        i += 1;
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn quantize_pcm24_round_in32_buffer_avx2(samples: &[f32], out: *mut i32, scale: f32) {
    use std::arch::x86_64::*;

    let mut i = 0usize;
    let len = samples.len();
    let scale_vec = _mm256_set1_ps(scale);
    let min_vec = _mm256_set1_ps(-8_388_608.0);
    let max_vec = _mm256_set1_ps(8_388_607.0);
    let half_vec = _mm256_set1_ps(0.5);
    let sign_mask = _mm256_set1_ps(-0.0);

    while i + 8 <= len {
        let ptr = samples.as_ptr().add(i);
        let x = _mm256_loadu_ps(ptr);
        let scaled = _mm256_mul_ps(x, scale_vec);
        let clamped = _mm256_min_ps(_mm256_max_ps(scaled, min_vec), max_vec);
        let signed_half = _mm256_or_ps(half_vec, _mm256_and_ps(clamped, sign_mask));
        let rounded = _mm256_cvttps_epi32(_mm256_add_ps(clamped, signed_half));
        let packed = _mm256_slli_epi32(rounded, 8);
        _mm256_storeu_si256(out.add(i) as *mut __m256i, packed);
        i += 8;
    }

    if i < len {
        quantize_pcm24_round_in32_buffer_sse2(&samples[i..], out.add(i), scale);
    }
}

#[inline]
fn pack_pcm24_packed_bytes(sample: i32) -> [u8; 3] {
    let bytes = sample.to_le_bytes();
    [bytes[0], bytes[1], bytes[2]]
}

#[cfg(test)]
mod tests {
    use super::{
        exclusive_render_pop_wait_timeout, is_transient_shared_raw_error, pack_pcm24_in32,
        pack_pcm24_packed_bytes, parse_env_bool_wasapi, quantize_pcm16_round,
        quantize_pcm16_round_buffer, quantize_pcm16_with_mode, quantize_pcm24,
        quantize_pcm24_round_in32_buffer, quantize_pcm24_transport_exact, quantize_pcm24_with_mode,
        quantize_pcm32_with_mode, select_low_latency_period,
        shared_raw_low_latency_prefill_floor_samples, shared_raw_render_pop_wait_timeout,
        write_scaled_f32_buffer, AudioOutputError, NativeAudioOutputQuantizationMode,
        AUDIO_OUTPUT_WASAPI_EXCLUSIVE_RENDER_FAILED, AUDIO_OUTPUT_WASAPI_SHARED_RAW_INIT_FAILED,
        AUDIO_OUTPUT_WASAPI_SHARED_RAW_OPEN_FAILED,
        AUDIO_OUTPUT_WASAPI_SHARED_RAW_UNSUPPORTED_FORMAT,
    };
    use std::time::Duration;

    #[test]
    fn pcm24_quantize_clamps_and_rounds() {
        assert_eq!(quantize_pcm24(1.0, 1.0), 8_388_607);
        assert_eq!(quantize_pcm24(-1.0, 1.0), -8_388_607);
        assert_eq!(quantize_pcm24(2.0, 1.0), 8_388_607);
        assert_eq!(quantize_pcm24(-2.0, 1.0), -8_388_608);
        assert_eq!(quantize_pcm24(0.5, 1.0), 4_194_304);
    }

    #[test]
    fn pcm24_packed_bytes_match_expected_layout() {
        assert_eq!(pack_pcm24_packed_bytes(8_388_607), [0xff, 0xff, 0x7f]);
        assert_eq!(pack_pcm24_packed_bytes(-8_388_608), [0x00, 0x00, 0x80]);
        assert_eq!(pack_pcm24_packed_bytes(-8_388_607), [0x01, 0x00, 0x80]);
    }

    #[test]
    fn pcm24_in32_is_left_justified() {
        assert_eq!(pack_pcm24_in32(8_388_607), 0x7f_ff_ff_00);
        assert_eq!(pack_pcm24_in32(-8_388_608), i32::MIN);
        assert_eq!(pack_pcm24_in32(-8_388_607), 0x80_00_01_00u32 as i32);
    }

    #[test]
    fn transport_exact_pcm24_quantize_matches_legacy_rounding() {
        let vectors = [0.0f32, 0.125, -0.125, 0.5, -0.5, 0.9999, -1.0, 1.2, -1.2];
        for sample in vectors {
            assert_eq!(
                quantize_pcm24_transport_exact(sample, 1.0),
                quantize_pcm24(sample, 1.0)
            );
        }
    }

    #[test]
    fn transport_exact_pcm24_preserves_sample_mode_for_grid_values() {
        let mut seed = 0x9e37_79b9_7f4a_7c15u64;
        let mut vectors = vec![
            -8_388_607i32,
            -8_000_000,
            -4_194_304,
            -1_048_576,
            -16_384,
            -1,
            0,
            1,
            16_384,
            1_048_576,
            4_194_304,
            8_000_000,
            8_388_607,
        ];

        for _ in 0..4096 {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            let raw = ((seed >> 16) & 0x00ff_ffff) as i32;
            let centered = raw - 8_388_607;
            vectors.push(centered.clamp(-8_388_607, 8_388_607));
        }

        for sample_i24 in vectors {
            let normalized = (sample_i24 as f32) / 8_388_608.0;
            let expected = quantize_pcm24(normalized, 1.0);
            let quantized = quantize_pcm24_transport_exact(normalized, 1.0);
            assert_eq!(quantized, expected);

            let packed_in32 = pack_pcm24_in32(expected);
            assert_eq!(packed_in32 & 0xff, 0);
        }
    }

    #[test]
    fn pcm24_tpdf_quantization_is_deterministic_with_same_seed() {
        let mut seed_a = 0x1234_5678_9abc_def0u64;
        let mut seed_b = 0x1234_5678_9abc_def0u64;

        let a = quantize_pcm24_with_mode(
            0.000_001,
            1.0,
            NativeAudioOutputQuantizationMode::Tpdf,
            &mut seed_a,
        );
        let b = quantize_pcm24_with_mode(
            0.000_001,
            1.0,
            NativeAudioOutputQuantizationMode::Tpdf,
            &mut seed_b,
        );

        assert_eq!(a, b);
    }

    #[test]
    fn pcm16_tpdf_quantization_is_deterministic_with_same_seed() {
        let mut seed_a = 0x1234_5678_1111_2222u64;
        let mut seed_b = 0x1234_5678_1111_2222u64;

        let a = quantize_pcm16_with_mode(
            0.000_1,
            1.0,
            NativeAudioOutputQuantizationMode::Tpdf,
            &mut seed_a,
        );
        let b = quantize_pcm16_with_mode(
            0.000_1,
            1.0,
            NativeAudioOutputQuantizationMode::Tpdf,
            &mut seed_b,
        );

        assert_eq!(a, b);
    }

    #[test]
    fn pcm32_tpdf_quantization_is_deterministic_with_same_seed() {
        let mut seed_a = 0xabcd_ef98_7654_3210u64;
        let mut seed_b = 0xabcd_ef98_7654_3210u64;

        let a = quantize_pcm32_with_mode(
            0.000_001,
            1.0,
            NativeAudioOutputQuantizationMode::Tpdf,
            &mut seed_a,
        );
        let b = quantize_pcm32_with_mode(
            0.000_001,
            1.0,
            NativeAudioOutputQuantizationMode::Tpdf,
            &mut seed_b,
        );

        assert_eq!(a, b);
    }

    #[test]
    fn pcm24_in32_round_buffer_matches_scalar_quantize() {
        let samples = [
            -1.2f32, -1.0, -0.75, -0.25, -0.0001, 0.0, 0.0001, 0.25, 0.5, 0.75, 0.9999, 1.1,
        ];
        let volume = 0.87f32;
        let mut out = vec![0i32; samples.len()];

        quantize_pcm24_round_in32_buffer(&samples, out.as_mut_ptr(), volume);

        for (index, sample) in samples.iter().enumerate() {
            assert_eq!(out[index], pack_pcm24_in32(quantize_pcm24(*sample, volume)));
        }
    }

    #[test]
    fn pcm16_round_buffer_matches_scalar_quantize() {
        let samples = [
            -1.2f32, -1.0, -0.7, -0.25, -0.01, 0.0, 0.01, 0.25, 0.5, 0.7, 0.9999, 1.2,
        ];
        let volume = 0.91f32;
        let mut out = vec![0i16; samples.len()];

        quantize_pcm16_round_buffer(&samples, out.as_mut_ptr(), volume);

        for (index, sample) in samples.iter().enumerate() {
            assert_eq!(out[index], quantize_pcm16_round(*sample, volume));
        }
    }

    #[test]
    fn scaled_f32_buffer_matches_scalar() {
        let samples = [-1.0f32, -0.3, 0.0, 0.25, 0.75, 1.0];
        let mut out = vec![0.0f32; samples.len()];
        let volume = 0.83f32;
        write_scaled_f32_buffer(&samples, out.as_mut_ptr(), volume);

        for (index, sample) in samples.iter().enumerate() {
            assert!((out[index] - (*sample * volume)).abs() <= 1e-6);
        }
    }

    #[test]
    fn select_low_latency_period_rounds_up_to_fundamental() {
        assert_eq!(select_low_latency_period(48, 448, 4), 48);
        assert_eq!(select_low_latency_period(48, 480, 16), 48);
        assert_eq!(select_low_latency_period(50, 480, 16), 64);
        assert_eq!(select_low_latency_period(1, 480, 1), 1);
    }

    #[test]
    fn select_low_latency_period_clamps_and_handles_bounds() {
        assert_eq!(select_low_latency_period(500, 480, 16), 480);
        assert_eq!(select_low_latency_period(0, 0, 0), 0);
        assert_eq!(select_low_latency_period(0, 480, 0), 0);
        assert_eq!(select_low_latency_period(48, 480, 0), 48);
    }

    #[test]
    fn parse_env_bool_wasapi_uses_default_when_missing() {
        assert!(parse_env_bool_wasapi(
            "PMP_TEST_NONEXISTENT_KEY_12345",
            true
        ));
        assert!(!parse_env_bool_wasapi(
            "PMP_TEST_NONEXISTENT_KEY_12345",
            false
        ));
    }

    #[test]
    fn parse_env_bool_wasapi_invalid_value_falls_back_to_default() {
        std::env::set_var("PMP_TEST_PARSE_ENV_BOOL_WASAPI", "maybe");
        assert!(parse_env_bool_wasapi(
            "PMP_TEST_PARSE_ENV_BOOL_WASAPI",
            true
        ));
        assert!(!parse_env_bool_wasapi(
            "PMP_TEST_PARSE_ENV_BOOL_WASAPI",
            false
        ));
        std::env::remove_var("PMP_TEST_PARSE_ENV_BOOL_WASAPI");
    }

    #[test]
    fn shared_raw_low_latency_prefill_floor_has_reasonable_bounds() {
        let floor = shared_raw_low_latency_prefill_floor_samples(48_000, 2, Some(48));
        assert!(floor >= 9_600, "should keep at least ~100ms startup floor");
        assert!(floor <= 30_720, "should cap startup floor to ~320ms");
        assert_eq!(
            shared_raw_low_latency_prefill_floor_samples(48_000, 2, None),
            0
        );
    }

    #[test]
    fn shared_raw_render_pop_wait_timeout_is_only_enabled_for_low_latency() {
        assert_eq!(
            shared_raw_render_pop_wait_timeout(48_000, None),
            Duration::ZERO
        );

        let wait = shared_raw_render_pop_wait_timeout(48_000, Some(48));
        assert!(wait > Duration::ZERO);
        assert!(wait <= Duration::from_micros(1_500));
    }

    #[test]
    fn exclusive_render_pop_wait_timeout_stays_within_callback_budget() {
        let wait = exclusive_render_pop_wait_timeout(48_000, 480);
        assert!(wait >= Duration::from_micros(200));
        assert!(wait <= Duration::from_micros(2_000));

        let tiny = exclusive_render_pop_wait_timeout(48_000, 48);
        assert!(tiny >= Duration::from_micros(200));
        assert!(tiny <= Duration::from_micros(2_000));
    }

    #[test]
    fn transient_error_detection_classifies_correctly() {
        assert!(!is_transient_shared_raw_error(&AudioOutputError {
            code: AUDIO_OUTPUT_WASAPI_SHARED_RAW_UNSUPPORTED_FORMAT,
            message: "test".to_string(),
        }));
        assert!(!is_transient_shared_raw_error(&AudioOutputError {
            code: AUDIO_OUTPUT_WASAPI_SHARED_RAW_INIT_FAILED,
            message: "test".to_string(),
        }));
        assert!(is_transient_shared_raw_error(&AudioOutputError {
            code: AUDIO_OUTPUT_WASAPI_SHARED_RAW_OPEN_FAILED,
            message: "test".to_string(),
        }));
        assert!(is_transient_shared_raw_error(&AudioOutputError {
            code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_RENDER_FAILED,
            message: "test".to_string(),
        }));
    }
}

#[cfg(target_os = "windows")]
struct WasapiStream {
    audio_client: windows::Win32::Media::Audio::IAudioClient,
    render_client: windows::Win32::Media::Audio::IAudioRenderClient,
    event_handle: windows::Win32::Foundation::HANDLE,
    buffer_frame_count: u32,
    channels: u16,
    sample_rate: u32,
    sample_format: WasapiSampleFormat,
    transport_mode: NativeAudioTransportMode,
    mode: WasapiStreamMode,
    started: bool,
    low_latency_period_frames: Option<u32>,
}

#[cfg(target_os = "windows")]
impl WasapiStream {
    fn stop(&mut self) {
        if self.started {
            let _ = unsafe { self.audio_client.Stop() };
            // Some shared RAW drivers hang on Reset() under rapid seeks / state changes.
            // Exclusive mode relies on Reset() to drop already-queued frames, but shared RAW
            // will instead clear our render queue and let the engine drain naturally.
            if matches!(self.mode, WasapiStreamMode::Exclusive) {
                let _ = unsafe { self.audio_client.Reset() };
            }
            self.started = false;
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for WasapiStream {
    fn drop(&mut self) {
        self.stop();
        unsafe {
            if matches!(self.mode, WasapiStreamMode::Exclusive) {
                let _ = self.audio_client.Reset();
            }
            let _ = windows::Win32::Foundation::CloseHandle(self.event_handle);
        }
    }
}

struct SinkInner {
    backend_state: Arc<Mutex<BackendState>>,
    output_quantization_mode_bits: Arc<AtomicU32>,
    device_id: Option<String>,
    queue: Mutex<VecDeque<BoxedSource>>,
    render_queue: AudioRingBuffer,
    flush_epoch: AtomicU64,
    producer_thread: Mutex<Option<JoinHandle<()>>>,
    producer_stop_tx: Mutex<Option<mpsc::Sender<()>>>,
    producer_source: Mutex<Option<BoxedSource>>,
    playing: AtomicBool,
    stopped: AtomicBool,
    volume_bits: AtomicU32,
    is_empty: AtomicBool,
    thread: Mutex<Option<JoinHandle<()>>>,
}

pub struct WasapiExclusiveSink {
    inner: Arc<SinkInner>,
}

struct SharedRawSinkInner {
    backend_state: Arc<Mutex<BackendState>>,
    output_quantization_mode_bits: Arc<AtomicU32>,
    device_id: Option<String>,
    queue: Mutex<VecDeque<BoxedSource>>,
    render_queue: AudioRingBuffer,
    flush_epoch: AtomicU64,
    producer_thread: Mutex<Option<JoinHandle<()>>>,
    producer_stop_tx: Mutex<Option<mpsc::Sender<()>>>,
    producer_source: Mutex<Option<BoxedSource>>,
    playing: AtomicBool,
    stopped: AtomicBool,
    volume_bits: AtomicU32,
    is_empty: AtomicBool,
    thread: Mutex<Option<JoinHandle<()>>>,
}

pub struct WasapiSharedRawSink {
    inner: Arc<SharedRawSinkInner>,
}

#[cfg(target_os = "windows")]
struct MmcssRegistration {
    handle: windows::Win32::Foundation::HANDLE,
}

#[cfg(target_os = "windows")]
impl MmcssRegistration {
    fn register() -> Option<Self> {
        use windows::core::w;
        use windows::Win32::System::Threading::{
            AvSetMmThreadCharacteristicsW, AvSetMmThreadPriority,
        };

        unsafe {
            let mut task_index = 0u32;
            let handle = AvSetMmThreadCharacteristicsW(w!("Pro Audio"), &mut task_index)
                .or_else(|_| AvSetMmThreadCharacteristicsW(w!("Audio"), &mut task_index))
                .ok()?;

            let _ = AvSetMmThreadPriority(
                handle,
                windows::Win32::System::Threading::AVRT_PRIORITY_HIGH,
            );
            Some(Self { handle })
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for MmcssRegistration {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::System::Threading::AvRevertMmThreadCharacteristics(self.handle);
        }
    }
}

impl WasapiExclusiveSink {
    fn new(
        backend_state: Arc<Mutex<BackendState>>,
        output_quantization_mode_bits: Arc<AtomicU32>,
    ) -> Self {
        let device_id = backend_state
            .lock()
            .ok()
            .and_then(|state| state.device_id.clone());
        reset_output_callback_metrics();
        let render_queue = AudioRingBuffer::new(48_000 * 2 * 2);
        render_queue.try_lock_memory_pages();
        Self {
            inner: Arc::new(SinkInner {
                backend_state,
                output_quantization_mode_bits,
                device_id,
                queue: Mutex::new(VecDeque::new()),
                render_queue,
                flush_epoch: AtomicU64::new(0),
                producer_thread: Mutex::new(None),
                producer_stop_tx: Mutex::new(None),
                producer_source: Mutex::new(None),
                playing: AtomicBool::new(false),
                stopped: AtomicBool::new(false),
                volume_bits: AtomicU32::new(1.0f32.to_bits()),
                is_empty: AtomicBool::new(true),
                thread: Mutex::new(None),
            }),
        }
    }

    fn ensure_thread_started(inner: &Arc<SinkInner>) {
        let mut guard = inner.thread.lock().unwrap();
        if guard.is_some() {
            return;
        }
        let inner_clone = inner.clone();
        *guard = Some(thread::spawn(move || run_sink_thread(inner_clone)));
    }

    fn stop_producer(inner: &Arc<SinkInner>) {
        if let Ok(mut stop_tx_guard) = inner.producer_stop_tx.lock() {
            if let Some(stop_tx) = stop_tx_guard.take() {
                let _ = stop_tx.send(());
            }
        }

        if let Ok(mut join_guard) = inner.producer_thread.lock() {
            if let Some(handle) = join_guard.take() {
                let _ = handle.join();
            }
        }

        inner.render_queue.clear();
    }

    fn start_producer_for_source(inner: &Arc<SinkInner>, source: BoxedSource) {
        Self::stop_producer(inner);

        inner.render_queue.clear();

        if let Ok(mut source_guard) = inner.producer_source.lock() {
            *source_guard = Some(source);
        }

        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        if let Ok(mut stop_tx_guard) = inner.producer_stop_tx.lock() {
            *stop_tx_guard = Some(stop_tx);
        }

        let inner_clone = inner.clone();
        let handle = thread::spawn(move || {
            let _priority_guard =
                crate::audio::threading::promote_current_thread_for_audio_decode();
            let mut local: Vec<f32> = Vec::with_capacity(
                buffer_policy::output_producer_chunk_samples(RealtimePressureProfile::Critical),
            );

            let mut source = {
                let Ok(mut guard) = inner_clone.producer_source.lock() else {
                    inner_clone.render_queue.mark_finished();
                    return;
                };
                guard.take()
            };

            let Some(mut source) = source.take() else {
                inner_clone.render_queue.mark_finished();
                return;
            };

            let channels = source.channels().max(1) as usize;
            let mut adaptive_state = buffer_policy::TransferAdaptiveState::default();
            let mut observed_flush_epoch = inner_clone.flush_epoch.load(Ordering::Acquire);
            let mut observed_render_clear_epoch = inner_clone.render_queue.clear_epoch();

            while !inner_clone.stopped.load(Ordering::Acquire) {
                if stop_rx.try_recv().is_ok() {
                    break;
                }

                let current_flush_epoch = inner_clone.flush_epoch.load(Ordering::Acquire);
                if current_flush_epoch != observed_flush_epoch {
                    observed_flush_epoch = current_flush_epoch;
                    observed_render_clear_epoch = inner_clone.render_queue.clear_epoch();
                    local.clear();
                    adaptive_state = buffer_policy::TransferAdaptiveState::default();
                }

                let current_render_clear_epoch = inner_clone.render_queue.clear_epoch();
                if current_render_clear_epoch != observed_render_clear_epoch {
                    observed_render_clear_epoch = current_render_clear_epoch;
                    local.clear();
                    adaptive_state = buffer_policy::TransferAdaptiveState::default();
                }

                let queue_capacity = inner_clone.render_queue.capacity_samples().max(channels);
                let render_len = inner_clone.render_queue.len_samples();
                let profile = crate::audio::realtime_scheduler::SCHEDULER.profile();
                crate::audio::threading::apply_audio_decode_pressure_profile(profile);

                let adaptive = buffer_policy::adaptive_transfer_strategy(
                    queue_capacity,
                    channels,
                    profile,
                    render_len,
                    render_len,
                    &mut adaptive_state,
                );

                let high_watermark = adaptive.high_watermark;
                let chunk_samples = adaptive
                    .chunk_limit
                    .max(buffer_policy::output_producer_chunk_samples(profile));
                let backoff = adaptive.producer_backoff;

                if render_len >= high_watermark {
                    if backoff.is_zero() {
                        thread::yield_now();
                    } else {
                        thread::sleep(backoff);
                    }
                    continue;
                }

                local.clear();
                memory_pool::reserve_f32_capacity(
                    &mut local,
                    chunk_samples,
                    "exclusive.output.producer.local_growth",
                );
                for _ in 0..chunk_samples {
                    match source.next() {
                        Some(sample) => local.push(sample),
                        None => break,
                    }
                }

                if local.is_empty() {
                    inner_clone.render_queue.mark_finished();
                    break;
                }

                let mut start = 0usize;
                let mut discarded_by_clear = false;
                while start < local.len() {
                    let push_result = inner_clone.render_queue.push_interleaved_guarded(
                        &local[start..],
                        channels,
                        observed_render_clear_epoch,
                    );
                    if push_result.cleared {
                        observed_render_clear_epoch = inner_clone.render_queue.clear_epoch();
                        local.clear();
                        adaptive_state = buffer_policy::TransferAdaptiveState::default();
                        discarded_by_clear = true;
                        break;
                    }

                    if push_result.pushed_frames == 0 {
                        if backoff.is_zero() {
                            thread::yield_now();
                        } else {
                            thread::sleep(backoff);
                        }
                        if stop_rx.try_recv().is_ok() {
                            return;
                        }
                        continue;
                    }
                    start = start.saturating_add(push_result.pushed_frames * channels);
                }

                if discarded_by_clear {
                    continue;
                }
            }
        });

        if let Ok(mut join_guard) = inner.producer_thread.lock() {
            *join_guard = Some(handle);
        }
    }
}

impl Drop for WasapiExclusiveSink {
    fn drop(&mut self) {
        self.inner.stopped.store(true, Ordering::Release);
        Self::stop_producer(&self.inner);
        if let Ok(mut guard) = self.inner.thread.lock() {
            if let Some(handle) = guard.take() {
                let _ = handle.join();
            }
        }

        if let Ok(mut state) = self.inner.backend_state.lock() {
            state.stream_open = false;
            state.output_sample_rate = None;
        }
    }
}

impl AudioSink for WasapiExclusiveSink {
    fn append(&self, source: BoxedSource) {
        if let Ok(mut queue) = self.inner.queue.lock() {
            queue.clear();
            queue.push_back(source);
            self.inner.is_empty.store(false, Ordering::Release);
        }
        Self::ensure_thread_started(&self.inner);
    }

    fn play(&self) {
        self.inner.playing.store(true, Ordering::Release);
        Self::ensure_thread_started(&self.inner);
    }

    fn pause(&self) {
        self.inner.playing.store(false, Ordering::Release);
    }

    fn stop(&self) {
        self.inner.stopped.store(true, Ordering::Release);
        Self::stop_producer(&self.inner);
        if let Ok(mut queue) = self.inner.queue.lock() {
            queue.clear();
        }
        self.inner.is_empty.store(true, Ordering::Release);
    }

    fn empty(&self) -> bool {
        self.inner.is_empty.load(Ordering::Acquire)
    }

    fn set_volume(&self, value: f32) {
        self.inner
            .volume_bits
            .store(value.clamp(0.0, 4.0).to_bits(), Ordering::Release);
    }

    fn flush(&self) {
        self.inner.flush_epoch.fetch_add(1, Ordering::Release);
        self.inner.render_queue.clear();
    }
}

fn run_sink_thread(inner: Arc<SinkInner>) {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

    #[cfg(not(target_os = "windows"))]
    {
        inner.is_empty.store(true, Ordering::Release);
        return;
    }

    #[cfg(target_os = "windows")]
    {
        // Best-effort: ensure the render loop gets scheduled with audio-friendly priority to reduce underruns.
        let _mmcss = MmcssRegistration::register();
        if _mmcss.is_none() {
            unsafe {
                let _ = windows::Win32::System::Threading::SetThreadPriority(
                    windows::Win32::System::Threading::GetCurrentThread(),
                    windows::Win32::System::Threading::THREAD_PRIORITY_HIGHEST,
                );
            }
        }
        let mut applied_pressure_profile = crate::audio::realtime_scheduler::SCHEDULER.profile();
        crate::audio::threading::apply_audio_output_pressure_profile(applied_pressure_profile);

        let device_id = match inner.device_id.as_deref() {
            Some(value) => value,
            None => {
                if let Ok(mut state) = inner.backend_state.lock() {
                    state.error = Some(AudioOutputError {
                        code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_NO_DEVICE_SELECTED,
                        message: "No output device selected".to_string(),
                    });
                }
                inner.is_empty.store(true, Ordering::Release);
                return;
            }
        };

        let transport_mode = inner
            .backend_state
            .lock()
            .ok()
            .map(|state| state.transport_mode)
            .unwrap_or(NativeAudioTransportMode::Robust);

        let mut stream: Option<WasapiStream> = None;
        let mut active_channels: u16 = 0;
        let mut active_sample_rate: u32 = 0;
        let mut render_scratch = Vec::<f32>::new();
        let mut declicker = UnderrunDeclicker::new(0);
        let mut callback_timing = CallbackTimingState::default();
        let mut observed_flush_epoch = inner.flush_epoch.load(Ordering::Acquire);

        while !inner.stopped.load(Ordering::Acquire) {
            let queued = match inner.queue.lock() {
                Ok(mut queue) => queue.pop_front(),
                Err(_) => None,
            };

            if let Some(source) = queued {
                let desired_sample_rate = source.sample_rate().max(1);
                let desired_channels = source.channels().max(1);

                let need_open = match stream.as_ref() {
                    Some(stream) => {
                        stream.sample_rate != desired_sample_rate
                            || stream.channels != desired_channels
                    }
                    None => true,
                };

                if need_open {
                    if let Some(stream) = stream.as_mut() {
                        stream.stop();
                    }

                    match open_wasapi_stream(
                        device_id,
                        desired_sample_rate,
                        desired_channels,
                        transport_mode,
                        WasapiStreamMode::Exclusive,
                    ) {
                        Ok(new_stream) => {
                            memory_pool::reserve_f32_capacity(
                                &mut render_scratch,
                                new_stream.buffer_frame_count as usize
                                    * new_stream.channels.max(1) as usize,
                                "exclusive.output.render_scratch_growth",
                            );
                            if let Ok(mut state) = inner.backend_state.lock() {
                                state.output_sample_rate = Some(new_stream.sample_rate);
                                state.stream_open = true;
                                state.error = None;
                            }
                            callback_timing.reset_for_stream(
                                new_stream.buffer_frame_count,
                                new_stream.sample_rate,
                            );
                            active_channels = new_stream.channels;
                            active_sample_rate = new_stream.sample_rate;
                            declicker.ensure_channels(active_channels as usize);
                            stream = Some(new_stream);
                        }
                        Err(err) => {
                            if let Ok(mut state) = inner.backend_state.lock() {
                                state.stream_open = false;
                                state.output_sample_rate = None;
                                state.error = Some(err);
                            }
                            inner.is_empty.store(true, Ordering::Release);
                            return;
                        }
                    }
                }

                WasapiExclusiveSink::start_producer_for_source(&inner, source);
                if let Some(active_stream) = stream.as_mut() {
                    active_stream.stop();
                    callback_timing.clear_last_wake();
                }
            }

            if stream.is_none() {
                if inner.queue.lock().map(|q| q.is_empty()).unwrap_or(true) {
                    inner.is_empty.store(true, Ordering::Release);
                    thread::sleep(Duration::from_millis(20));
                    continue;
                }
                inner.is_empty.store(false, Ordering::Release);
                continue;
            }

            let Some(stream) = stream.as_mut() else {
                continue;
            };

            let current_flush_epoch = inner.flush_epoch.load(Ordering::Acquire);
            if current_flush_epoch != observed_flush_epoch {
                observed_flush_epoch = current_flush_epoch;
                stream.stop();
                callback_timing.clear_last_wake();
                inner.render_queue.clear();
            }

            let playing = inner.playing.load(Ordering::Acquire);
            if playing && !stream.started {
                declicker.on_intentional_silence(active_channels as usize, active_sample_rate);
                if let Err(err) = start_stream_with_prefill(
                    stream,
                    inner.as_ref(),
                    active_channels,
                    active_sample_rate,
                    &mut render_scratch,
                    &mut declicker,
                ) {
                    if let Ok(mut state) = inner.backend_state.lock() {
                        state.error = Some(err);
                    }
                    inner.is_empty.store(true, Ordering::Release);
                    return;
                }
            }

            if !stream.started {
                thread::sleep(Duration::from_millis(5));
                continue;
            }

            if let Err(err) = render_once(
                stream,
                inner.as_ref(),
                &mut render_scratch,
                &mut callback_timing,
                &mut declicker,
            ) {
                if let Ok(mut state) = inner.backend_state.lock() {
                    state.error = Some(err);
                }
                inner.is_empty.store(true, Ordering::Release);
                return;
            }

            let current_profile = crate::audio::realtime_scheduler::SCHEDULER.profile();
            if current_profile != applied_pressure_profile {
                crate::audio::threading::apply_audio_output_pressure_profile(current_profile);
                applied_pressure_profile = current_profile;
            }

            if inner.render_queue.is_finished_and_empty()
                && inner
                    .queue
                    .lock()
                    .map(|queue| queue.is_empty())
                    .unwrap_or(true)
            {
                inner.is_empty.store(true, Ordering::Release);
            }
        }
    }
}

fn run_shared_raw_sink_thread(inner: Arc<SharedRawSinkInner>) {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

    #[cfg(not(target_os = "windows"))]
    {
        inner.is_empty.store(true, Ordering::Release);
        return;
    }

    #[cfg(target_os = "windows")]
    {
        let _mmcss = MmcssRegistration::register();
        if _mmcss.is_none() {
            unsafe {
                let _ = windows::Win32::System::Threading::SetThreadPriority(
                    windows::Win32::System::Threading::GetCurrentThread(),
                    windows::Win32::System::Threading::THREAD_PRIORITY_HIGHEST,
                );
            }
        }
        let mut applied_pressure_profile = crate::audio::realtime_scheduler::SCHEDULER.profile();
        crate::audio::threading::apply_audio_output_pressure_profile(applied_pressure_profile);

        let device_id = match inner.device_id.as_deref() {
            Some(value) => value,
            None => {
                if let Ok(mut state) = inner.backend_state.lock() {
                    state.error = Some(AudioOutputError {
                        code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_NO_DEVICE_SELECTED,
                        message: "No output device selected".to_string(),
                    });
                }
                inner.is_empty.store(true, Ordering::Release);
                return;
            }
        };

        let transport_mode = inner
            .backend_state
            .lock()
            .ok()
            .map(|state| state.transport_mode)
            .unwrap_or(NativeAudioTransportMode::Robust);

        let mut stream: Option<WasapiStream> = None;
        let mut active_channels: u16 = 0;
        let mut active_sample_rate: u32 = 0;
        let mut render_scratch = Vec::<f32>::new();
        let mut declicker = UnderrunDeclicker::new(0);
        let mut callback_timing = CallbackTimingState::default();
        let mut observed_flush_epoch = inner.flush_epoch.load(Ordering::Acquire);
        let mut render_retry_count = 0u32;
        let mut retry_open_stream = false;

        while !inner.stopped.load(Ordering::Acquire) {
            if retry_open_stream {
                if let Some(stream) = stream.as_mut() {
                    stream.stop();
                }
                stream = None;
            }

            let queued = match inner.queue.lock() {
                Ok(mut queue) => queue.pop_front(),
                Err(_) => None,
            };

            if let Some(source) = queued {
                let desired_sample_rate = source.sample_rate().max(1);
                let desired_channels = source.channels().max(1);

                let need_open = retry_open_stream
                    || match stream.as_ref() {
                        Some(stream) => {
                            stream.sample_rate != desired_sample_rate
                                || stream.channels != desired_channels
                        }
                        None => true,
                    };

                if need_open {
                    if let Some(stream) = stream.as_mut() {
                        stream.stop();
                    }

                    match open_wasapi_stream(
                        device_id,
                        desired_sample_rate,
                        desired_channels,
                        transport_mode,
                        WasapiStreamMode::SharedRaw,
                    ) {
                        Ok(new_stream) => {
                            if let Some(period_frames) = new_stream.low_latency_period_frames {
                                eprintln!(
                                    "[NativeAudio][wasapi-shared-raw] Negotiated low-latency period_frames={period_frames}"
                                );
                            }
                            memory_pool::reserve_f32_capacity(
                                &mut render_scratch,
                                new_stream.buffer_frame_count as usize
                                    * new_stream.channels.max(1) as usize,
                                "shared_raw.output.render_scratch_growth",
                            );
                            if let Ok(mut state) = inner.backend_state.lock() {
                                state.output_sample_rate = Some(new_stream.sample_rate);
                                state.stream_open = true;
                                state.error = None;
                            }
                            callback_timing.reset_for_stream(
                                new_stream.buffer_frame_count,
                                new_stream.sample_rate,
                            );
                            active_channels = new_stream.channels;
                            active_sample_rate = new_stream.sample_rate;
                            declicker.ensure_channels(active_channels as usize);
                            stream = Some(new_stream);
                            render_retry_count = 0;
                            retry_open_stream = false;
                        }
                        Err(err) => {
                            if retry_open_stream
                                && is_transient_shared_raw_error(&err)
                                && render_retry_count < SHARED_RAW_MAX_RENDER_RETRIES
                            {
                                render_retry_count = render_retry_count.saturating_add(1);
                                let delay_ms = SHARED_RAW_RETRY_BASE_DELAY_MS
                                    .saturating_mul(1u64 << render_retry_count.min(3));
                                thread::sleep(Duration::from_millis(delay_ms));
                                continue;
                            }

                            if let Ok(mut state) = inner.backend_state.lock() {
                                state.stream_open = false;
                                state.output_sample_rate = None;
                                state.error = Some(err);
                            }
                            inner.is_empty.store(true, Ordering::Release);
                            return;
                        }
                    }
                }

                WasapiSharedRawSink::start_producer_for_source(&inner, source);
                if let Some(active_stream) = stream.as_mut() {
                    active_stream.stop();
                    callback_timing.clear_last_wake();
                }
            }

            if retry_open_stream
                && stream.is_none()
                && active_channels > 0
                && active_sample_rate > 0
            {
                match open_wasapi_stream(
                    device_id,
                    active_sample_rate,
                    active_channels,
                    transport_mode,
                    WasapiStreamMode::SharedRaw,
                ) {
                    Ok(new_stream) => {
                        if let Some(period_frames) = new_stream.low_latency_period_frames {
                            eprintln!(
                                "[NativeAudio][wasapi-shared-raw] Negotiated low-latency period_frames={period_frames}"
                            );
                        }
                        memory_pool::reserve_f32_capacity(
                            &mut render_scratch,
                            new_stream.buffer_frame_count as usize
                                * new_stream.channels.max(1) as usize,
                            "shared_raw.output.render_scratch_growth",
                        );
                        if let Ok(mut state) = inner.backend_state.lock() {
                            state.output_sample_rate = Some(new_stream.sample_rate);
                            state.stream_open = true;
                            state.error = None;
                        }
                        callback_timing.reset_for_stream(
                            new_stream.buffer_frame_count,
                            new_stream.sample_rate,
                        );
                        declicker.ensure_channels(new_stream.channels.max(1) as usize);
                        active_channels = new_stream.channels;
                        active_sample_rate = new_stream.sample_rate;
                        stream = Some(new_stream);
                        retry_open_stream = false;
                    }
                    Err(err) => {
                        if !is_transient_shared_raw_error(&err)
                            || render_retry_count >= SHARED_RAW_MAX_RENDER_RETRIES
                        {
                            if let Ok(mut state) = inner.backend_state.lock() {
                                state.stream_open = false;
                                state.output_sample_rate = None;
                                state.error = Some(err);
                            }
                            inner.is_empty.store(true, Ordering::Release);
                            return;
                        }

                        render_retry_count = render_retry_count.saturating_add(1);
                        let delay_ms = SHARED_RAW_RETRY_BASE_DELAY_MS
                            .saturating_mul(1u64 << render_retry_count.min(3));
                        thread::sleep(Duration::from_millis(delay_ms));
                        continue;
                    }
                }
            }

            if stream.is_none() {
                if inner.queue.lock().map(|q| q.is_empty()).unwrap_or(true) {
                    inner.is_empty.store(true, Ordering::Release);
                    thread::sleep(Duration::from_millis(20));
                    continue;
                }
                inner.is_empty.store(false, Ordering::Release);
                continue;
            }

            let Some(stream) = stream.as_mut() else {
                continue;
            };

            let current_flush_epoch = inner.flush_epoch.load(Ordering::Acquire);
            if current_flush_epoch != observed_flush_epoch {
                observed_flush_epoch = current_flush_epoch;
                stream.stop();
                callback_timing.clear_last_wake();
                inner.render_queue.clear();
            }

            let playing = inner.playing.load(Ordering::Acquire);
            if playing && !stream.started {
                declicker.on_intentional_silence(active_channels as usize, active_sample_rate);
                if let Err(err) = start_stream_with_prefill_shared_raw(
                    stream,
                    inner.as_ref(),
                    active_channels,
                    active_sample_rate,
                    &mut render_scratch,
                    &mut declicker,
                ) {
                    if is_transient_shared_raw_error(&err)
                        && render_retry_count < SHARED_RAW_MAX_RENDER_RETRIES
                    {
                        render_retry_count = render_retry_count.saturating_add(1);
                        stream.stop();
                        callback_timing.clear_last_wake();
                        retry_open_stream = true;
                        let delay_ms = SHARED_RAW_RETRY_BASE_DELAY_MS
                            .saturating_mul(1u64 << render_retry_count.min(3));
                        thread::sleep(Duration::from_millis(delay_ms));
                        continue;
                    }

                    if let Ok(mut state) = inner.backend_state.lock() {
                        state.error = Some(err);
                    }
                    inner.is_empty.store(true, Ordering::Release);
                    return;
                }
            } else if !playing && stream.started {
                stream.stop();
                callback_timing.clear_last_wake();
                thread::sleep(Duration::from_millis(10));
                continue;
            }

            if !stream.started {
                thread::sleep(Duration::from_millis(5));
                continue;
            }

            if let Err(err) = render_once_shared_raw(
                stream,
                inner.as_ref(),
                &mut render_scratch,
                &mut callback_timing,
                &mut declicker,
            ) {
                if is_transient_shared_raw_error(&err)
                    && render_retry_count < SHARED_RAW_MAX_RENDER_RETRIES
                {
                    render_retry_count = render_retry_count.saturating_add(1);
                    stream.stop();
                    callback_timing.clear_last_wake();
                    retry_open_stream = true;
                    let delay_ms = SHARED_RAW_RETRY_BASE_DELAY_MS
                        .saturating_mul(1u64 << render_retry_count.min(3));
                    thread::sleep(Duration::from_millis(delay_ms));
                    continue;
                }

                if let Ok(mut state) = inner.backend_state.lock() {
                    state.error = Some(err);
                }
                inner.is_empty.store(true, Ordering::Release);
                return;
            }

            render_retry_count = 0;

            let current_profile = crate::audio::realtime_scheduler::SCHEDULER.profile();
            if current_profile != applied_pressure_profile {
                crate::audio::threading::apply_audio_output_pressure_profile(current_profile);
                applied_pressure_profile = current_profile;
            }

            if inner.render_queue.is_finished_and_empty()
                && inner
                    .queue
                    .lock()
                    .map(|queue| queue.is_empty())
                    .unwrap_or(true)
            {
                inner.is_empty.store(true, Ordering::Release);
            }
        }
    }
}

impl WasapiSharedRawSink {
    fn new(
        backend_state: Arc<Mutex<BackendState>>,
        output_quantization_mode_bits: Arc<AtomicU32>,
    ) -> Self {
        let device_id = backend_state
            .lock()
            .ok()
            .and_then(|state| state.device_id.clone());
        reset_output_callback_metrics();
        let render_queue = AudioRingBuffer::new(
            buffer_policy::recommended_render_queue_capacity_samples(Some(48_000), 2)
                .max(48_000 * 2 * 4),
        );
        render_queue.try_lock_memory_pages();
        Self {
            inner: Arc::new(SharedRawSinkInner {
                backend_state,
                output_quantization_mode_bits,
                device_id,
                queue: Mutex::new(VecDeque::new()),
                render_queue,
                flush_epoch: AtomicU64::new(0),
                producer_thread: Mutex::new(None),
                producer_stop_tx: Mutex::new(None),
                producer_source: Mutex::new(None),
                playing: AtomicBool::new(false),
                stopped: AtomicBool::new(false),
                volume_bits: AtomicU32::new(1.0f32.to_bits()),
                is_empty: AtomicBool::new(true),
                thread: Mutex::new(None),
            }),
        }
    }

    fn ensure_thread_started(inner: &Arc<SharedRawSinkInner>) {
        let mut guard = inner.thread.lock().unwrap();
        if guard.is_some() {
            return;
        }
        let inner_clone = inner.clone();
        *guard = Some(thread::spawn(move || {
            run_shared_raw_sink_thread(inner_clone)
        }));
    }

    fn stop_producer(inner: &Arc<SharedRawSinkInner>) {
        if let Ok(mut stop_tx_guard) = inner.producer_stop_tx.lock() {
            if let Some(stop_tx) = stop_tx_guard.take() {
                let _ = stop_tx.send(());
            }
        }

        if let Ok(mut join_guard) = inner.producer_thread.lock() {
            if let Some(handle) = join_guard.take() {
                let _ = handle.join();
            }
        }

        inner.render_queue.clear();
    }

    fn start_producer_for_source(inner: &Arc<SharedRawSinkInner>, source: BoxedSource) {
        Self::stop_producer(inner);

        inner.render_queue.clear();

        if let Ok(mut source_guard) = inner.producer_source.lock() {
            *source_guard = Some(source);
        }

        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        if let Ok(mut stop_tx_guard) = inner.producer_stop_tx.lock() {
            *stop_tx_guard = Some(stop_tx);
        }

        let inner_clone = inner.clone();
        let handle = thread::spawn(move || {
            let _priority_guard =
                crate::audio::threading::promote_current_thread_for_audio_decode();
            let mut local: Vec<f32> = Vec::with_capacity(
                buffer_policy::output_producer_chunk_samples(RealtimePressureProfile::Critical),
            );

            let mut source = {
                let Ok(mut guard) = inner_clone.producer_source.lock() else {
                    inner_clone.render_queue.mark_finished();
                    return;
                };
                guard.take()
            };

            let Some(mut source) = source.take() else {
                inner_clone.render_queue.mark_finished();
                return;
            };

            let channels = source.channels().max(1) as usize;
            let mut adaptive_state = buffer_policy::TransferAdaptiveState::default();
            let mut observed_flush_epoch = inner_clone.flush_epoch.load(Ordering::Acquire);
            let mut observed_render_clear_epoch = inner_clone.render_queue.clear_epoch();

            while !inner_clone.stopped.load(Ordering::Acquire) {
                if stop_rx.try_recv().is_ok() {
                    break;
                }

                let current_flush_epoch = inner_clone.flush_epoch.load(Ordering::Acquire);
                if current_flush_epoch != observed_flush_epoch {
                    observed_flush_epoch = current_flush_epoch;
                    observed_render_clear_epoch = inner_clone.render_queue.clear_epoch();
                    local.clear();
                    adaptive_state = buffer_policy::TransferAdaptiveState::default();
                }

                let current_render_clear_epoch = inner_clone.render_queue.clear_epoch();
                if current_render_clear_epoch != observed_render_clear_epoch {
                    observed_render_clear_epoch = current_render_clear_epoch;
                    local.clear();
                    adaptive_state = buffer_policy::TransferAdaptiveState::default();
                }

                let queue_capacity = inner_clone.render_queue.capacity_samples().max(channels);
                let render_len = inner_clone.render_queue.len_samples();
                let profile = crate::audio::realtime_scheduler::SCHEDULER.profile();
                crate::audio::threading::apply_audio_decode_pressure_profile(profile);

                let adaptive = buffer_policy::adaptive_transfer_strategy(
                    queue_capacity,
                    channels,
                    profile,
                    render_len,
                    render_len,
                    &mut adaptive_state,
                );

                let high_watermark = adaptive.high_watermark;
                let chunk_samples = adaptive
                    .chunk_limit
                    .max(buffer_policy::output_producer_chunk_samples(profile));
                let backoff = adaptive.producer_backoff;

                if render_len >= high_watermark {
                    if backoff.is_zero() {
                        thread::yield_now();
                    } else {
                        thread::sleep(backoff);
                    }
                    continue;
                }

                local.clear();
                memory_pool::reserve_f32_capacity(
                    &mut local,
                    chunk_samples,
                    "shared_raw.output.producer.local_growth",
                );
                for _ in 0..chunk_samples {
                    match source.next() {
                        Some(sample) => local.push(sample),
                        None => break,
                    }
                }

                if local.is_empty() {
                    inner_clone.render_queue.mark_finished();
                    break;
                }

                let mut start = 0usize;
                let mut discarded_by_clear = false;
                while start < local.len() {
                    let push_result = inner_clone.render_queue.push_interleaved_guarded(
                        &local[start..],
                        channels,
                        observed_render_clear_epoch,
                    );
                    if push_result.cleared {
                        observed_render_clear_epoch = inner_clone.render_queue.clear_epoch();
                        local.clear();
                        adaptive_state = buffer_policy::TransferAdaptiveState::default();
                        discarded_by_clear = true;
                        break;
                    }

                    if push_result.pushed_frames == 0 {
                        if backoff.is_zero() {
                            thread::yield_now();
                        } else {
                            thread::sleep(backoff);
                        }
                        if stop_rx.try_recv().is_ok() {
                            return;
                        }
                        continue;
                    }
                    start = start.saturating_add(push_result.pushed_frames * channels);
                }

                if discarded_by_clear {
                    continue;
                }
            }
        });

        if let Ok(mut join_guard) = inner.producer_thread.lock() {
            *join_guard = Some(handle);
        }
    }
}

impl Drop for WasapiSharedRawSink {
    fn drop(&mut self) {
        self.inner.stopped.store(true, Ordering::Release);
        Self::stop_producer(&self.inner);
        if let Ok(mut guard) = self.inner.thread.lock() {
            if let Some(handle) = guard.take() {
                let _ = handle.join();
            }
        }

        if let Ok(mut state) = self.inner.backend_state.lock() {
            state.stream_open = false;
            state.output_sample_rate = None;
        }
    }
}

impl AudioSink for WasapiSharedRawSink {
    fn append(&self, source: BoxedSource) {
        if let Ok(mut queue) = self.inner.queue.lock() {
            queue.clear();
            queue.push_back(source);
            self.inner.is_empty.store(false, Ordering::Release);
        }
        Self::ensure_thread_started(&self.inner);
    }

    fn play(&self) {
        self.inner.playing.store(true, Ordering::Release);
        Self::ensure_thread_started(&self.inner);
    }

    fn pause(&self) {
        self.inner.playing.store(false, Ordering::Release);
    }

    fn stop(&self) {
        self.inner.stopped.store(true, Ordering::Release);
        Self::stop_producer(&self.inner);
        if let Ok(mut queue) = self.inner.queue.lock() {
            queue.clear();
        }
        self.inner.is_empty.store(true, Ordering::Release);
    }

    fn empty(&self) -> bool {
        self.inner.is_empty.load(Ordering::Acquire)
    }

    fn set_volume(&self, value: f32) {
        self.inner
            .volume_bits
            .store(value.clamp(0.0, 4.0).to_bits(), Ordering::Release);
    }

    fn flush(&self) {
        self.inner.flush_epoch.fetch_add(1, Ordering::Release);
        self.inner.render_queue.clear();
    }
}

#[cfg(target_os = "windows")]
fn start_stream_with_prefill(
    stream: &mut WasapiStream,
    inner: &SinkInner,
    channels: u16,
    sample_rate: u32,
    scratch: &mut Vec<f32>,
    declicker: &mut UnderrunDeclicker,
) -> Result<(), AudioOutputError> {
    let prefill_samples = buffer_policy::wasapi_start_prefill_samples(
        sample_rate,
        channels,
        stream.buffer_frame_count,
        false,
    );
    let prefill_timeout = buffer_policy::wasapi_start_prefill_timeout(false);
    inner
        .render_queue
        .wait_for_samples(prefill_samples, prefill_timeout);

    let volume = f32::from_bits(inner.volume_bits.load(Ordering::Acquire));
    let output_quantization_mode = inner
        .backend_state
        .lock()
        .ok()
        .map(|state| state.output_quantization_mode)
        .unwrap_or(NativeAudioOutputQuantizationMode::Round);
    render_frames(
        stream,
        stream.buffer_frame_count,
        inner,
        true,
        volume,
        output_quantization_mode,
        scratch,
        declicker,
    )?;
    unsafe {
        stream.audio_client.Start().map_err(|e| AudioOutputError {
            code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_OPEN_FAILED,
            message: format!("Failed to start audio client: {e}"),
        })?;
    }
    stream.started = true;
    Ok(())
}

#[cfg(target_os = "windows")]
fn start_stream_with_prefill_shared_raw(
    stream: &mut WasapiStream,
    inner: &SharedRawSinkInner,
    channels: u16,
    sample_rate: u32,
    scratch: &mut Vec<f32>,
    declicker: &mut UnderrunDeclicker,
) -> Result<(), AudioOutputError> {
    let mut prefill_samples = buffer_policy::wasapi_start_prefill_samples(
        sample_rate,
        channels,
        stream.buffer_frame_count,
        true,
    );
    let low_latency_prefill_floor = shared_raw_low_latency_prefill_floor_samples(
        sample_rate,
        channels,
        stream.low_latency_period_frames,
    );
    if low_latency_prefill_floor > 0 {
        prefill_samples = prefill_samples.max(low_latency_prefill_floor);
    }
    prefill_samples = prefill_samples.min(inner.render_queue.capacity_samples());

    let prefill_timeout = buffer_policy::wasapi_start_prefill_timeout(true);
    inner
        .render_queue
        .wait_for_samples(prefill_samples, prefill_timeout);

    let volume = f32::from_bits(inner.volume_bits.load(Ordering::Acquire));
    let output_quantization_mode = inner
        .backend_state
        .lock()
        .ok()
        .map(|state| state.output_quantization_mode)
        .unwrap_or(NativeAudioOutputQuantizationMode::Round);
    render_frames_shared_raw(
        stream,
        stream.buffer_frame_count,
        inner,
        true,
        volume,
        output_quantization_mode,
        scratch,
        declicker,
    )?;
    unsafe {
        stream.audio_client.Start().map_err(|e| AudioOutputError {
            code: AUDIO_OUTPUT_WASAPI_SHARED_RAW_OPEN_FAILED,
            message: format!("Failed to start shared raw audio client: {e}"),
        })?;
    }
    stream.started = true;
    Ok(())
}

#[cfg(target_os = "windows")]
fn render_once(
    stream: &mut WasapiStream,
    inner: &SinkInner,
    scratch: &mut Vec<f32>,
    callback_timing: &mut CallbackTimingState,
    declicker: &mut UnderrunDeclicker,
) -> Result<(), AudioOutputError> {
    use windows::Win32::Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows::Win32::Media::Audio::AUDCLNT_BUFFERFLAGS_SILENT;
    use windows::Win32::System::Threading::WaitForSingleObject;

    let wait = unsafe { WaitForSingleObject(stream.event_handle, 50) };
    if wait == WAIT_TIMEOUT {
        CALLBACK_WAIT_TIMEOUT_COUNT.fetch_add(1, Ordering::Relaxed);
        diagnostics::record_event_throttled(
            "exclusive.callback.wait_timeout",
            50,
            stream.buffer_frame_count as u64,
            &CALLBACK_WAIT_TIMEOUT_TIMELINE_GATE_MS,
            200,
        );
        return Ok(());
    }
    if wait != WAIT_OBJECT_0 {
        return Err(AudioOutputError {
            code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_RENDER_FAILED,
            message: format!("WaitForSingleObject returned unexpected value: {wait:?}"),
        });
    }

    let playing = inner.playing.load(Ordering::Acquire);
    let volume = f32::from_bits(inner.volume_bits.load(Ordering::Acquire));
    let output_quantization_mode =
        quantization_mode_from_bits(inner.output_quantization_mode_bits.load(Ordering::Acquire));
    let frames = stream.buffer_frame_count;

    if !playing || inner.render_queue.is_finished_and_empty() {
        declicker.on_intentional_silence(stream.channels.max(1) as usize, stream.sample_rate);
        unsafe {
            stream
                .render_client
                .GetBuffer(frames)
                .map_err(|e| AudioOutputError {
                    code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_RENDER_FAILED,
                    message: format!("Failed to acquire render buffer: {e}"),
                })?;
            stream
                .render_client
                .ReleaseBuffer(frames, AUDCLNT_BUFFERFLAGS_SILENT.0 as u32)
                .map_err(|e| AudioOutputError {
                    code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_RENDER_FAILED,
                    message: format!("Failed to release silent buffer: {e}"),
                })?;
        }
        return Ok(());
    }

    callback_timing.on_callback_wake();

    let started = Instant::now();
    render_frames(
        stream,
        frames,
        inner,
        true,
        volume,
        output_quantization_mode,
        scratch,
        declicker,
    )?;
    let elapsed_us = started.elapsed().as_micros().min(u32::MAX as u128) as u32;
    record_callback_render_cost(elapsed_us);
    Ok(())
}

#[cfg(target_os = "windows")]
fn render_once_shared_raw(
    stream: &mut WasapiStream,
    inner: &SharedRawSinkInner,
    scratch: &mut Vec<f32>,
    callback_timing: &mut CallbackTimingState,
    declicker: &mut UnderrunDeclicker,
) -> Result<(), AudioOutputError> {
    use windows::Win32::Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows::Win32::Media::Audio::AUDCLNT_BUFFERFLAGS_SILENT;
    use windows::Win32::System::Threading::WaitForSingleObject;

    let wait = unsafe { WaitForSingleObject(stream.event_handle, 50) };
    if wait == WAIT_TIMEOUT {
        CALLBACK_WAIT_TIMEOUT_COUNT.fetch_add(1, Ordering::Relaxed);
        diagnostics::record_event_throttled(
            "shared-raw.callback.wait_timeout",
            50,
            stream.buffer_frame_count as u64,
            &CALLBACK_WAIT_TIMEOUT_TIMELINE_GATE_MS,
            200,
        );
        return Ok(());
    }
    if wait != WAIT_OBJECT_0 {
        return Err(AudioOutputError {
            code: AUDIO_OUTPUT_WASAPI_SHARED_RAW_OPEN_FAILED,
            message: format!("WaitForSingleObject returned unexpected value: {wait:?}"),
        });
    }

    let playing = inner.playing.load(Ordering::Acquire);
    let volume = f32::from_bits(inner.volume_bits.load(Ordering::Acquire));
    let output_quantization_mode =
        quantization_mode_from_bits(inner.output_quantization_mode_bits.load(Ordering::Acquire));

    let padding = unsafe {
        stream
            .audio_client
            .GetCurrentPadding()
            .map_err(|e| AudioOutputError {
                code: AUDIO_OUTPUT_WASAPI_SHARED_RAW_OPEN_FAILED,
                message: format!("Failed to query current padding: {e}"),
            })?
    };

    let frames = stream.buffer_frame_count.saturating_sub(padding);
    if frames == 0 {
        return Ok(());
    }

    if !playing || inner.render_queue.is_finished_and_empty() {
        declicker.on_intentional_silence(stream.channels.max(1) as usize, stream.sample_rate);
        unsafe {
            stream
                .render_client
                .GetBuffer(frames)
                .map_err(|e| AudioOutputError {
                    code: AUDIO_OUTPUT_WASAPI_SHARED_RAW_OPEN_FAILED,
                    message: format!("Failed to acquire shared raw render buffer: {e}"),
                })?;
            stream
                .render_client
                .ReleaseBuffer(frames, AUDCLNT_BUFFERFLAGS_SILENT.0 as u32)
                .map_err(|e| AudioOutputError {
                    code: AUDIO_OUTPUT_WASAPI_SHARED_RAW_OPEN_FAILED,
                    message: format!("Failed to release shared raw silent buffer: {e}"),
                })?;
        }
        return Ok(());
    }

    callback_timing.on_callback_wake();

    let started = Instant::now();
    render_frames_shared_raw(
        stream,
        frames,
        inner,
        true,
        volume,
        output_quantization_mode,
        scratch,
        declicker,
    )?;
    let elapsed_us = started.elapsed().as_micros().min(u32::MAX as u128) as u32;
    record_callback_render_cost(elapsed_us);
    Ok(())
}

#[cfg(target_os = "windows")]
fn render_frames(
    stream: &mut WasapiStream,
    frames: u32,
    inner: &SinkInner,
    consume: bool,
    volume: f32,
    output_quantization_mode: NativeAudioOutputQuantizationMode,
    scratch: &mut Vec<f32>,
    declicker: &mut UnderrunDeclicker,
) -> Result<(), AudioOutputError> {
    let channels = stream.channels.max(1) as usize;
    let total_samples = frames as usize * channels;
    scratch.clear();
    memory_pool::reserve_f32_capacity(
        scratch,
        total_samples,
        "exclusive.output.render_scratch_growth",
    );

    let mut available_samples = 0usize;
    let mut underrun = false;
    if consume {
        let profile = SCHEDULER.profile();
        let retry_attempts = callback_pop_retry_attempts(profile).max(1);
        let retry_spins = callback_pop_retry_spins(profile);
        let retry_wait =
            exclusive_render_pop_wait_timeout(stream.sample_rate, stream.buffer_frame_count);
        let mut popped = inner
            .render_queue
            .pop_chunk_into(scratch, total_samples, Duration::ZERO);
        let mut popped_samples = popped.popped;
        let mut popped_finished = popped.finished;
        for _ in 1..retry_attempts {
            if popped_samples >= total_samples || popped_finished {
                break;
            }
            for _ in 0..retry_spins {
                std::hint::spin_loop();
            }

            let missing = total_samples.saturating_sub(popped_samples);
            if missing == 0 {
                break;
            }

            popped = if popped_samples == 0 {
                if *CALLBACK_POP_RT_SPIN_WAIT {
                    inner
                        .render_queue
                        .pop_chunk_into_realtime(scratch, total_samples, retry_wait)
                } else {
                    inner
                        .render_queue
                        .pop_chunk_into(scratch, total_samples, retry_wait)
                }
            } else if *CALLBACK_POP_RT_SPIN_WAIT {
                inner
                    .render_queue
                    .pop_chunk_append_into_realtime(scratch, missing, retry_wait)
            } else {
                inner
                    .render_queue
                    .pop_chunk_append_into(scratch, missing, retry_wait)
            };

            if popped_samples == 0 {
                popped_samples = popped.popped;
            } else {
                popped_samples = popped_samples.saturating_add(popped.popped);
            }
            popped_finished = popped_finished || popped.finished;
        }
        available_samples = popped_samples;
        if popped_samples == 0 && popped_finished {
            return Ok(());
        }
        if popped_samples < total_samples {
            underrun = true;
            let missing_samples = total_samples.saturating_sub(popped_samples);
            let missing_frames = (missing_samples / channels.max(1)).max(1) as u64;
            CALLBACK_RENDER_QUEUE_UNDERRUN_EVENTS.fetch_add(1, Ordering::Relaxed);
            CALLBACK_RENDER_QUEUE_UNDERRUN_FRAMES.fetch_add(missing_frames, Ordering::Relaxed);
            diagnostics::record_event_throttled(
                "exclusive.output.render_underrun",
                missing_frames,
                frames as u64,
                &CALLBACK_RENDER_UNDERRUN_TIMELINE_GATE_MS,
                120,
            );
        }
    }

    declicker.process_render_buffer(
        scratch,
        frames,
        stream.sample_rate,
        channels,
        available_samples,
        underrun && consume,
    );

    unsafe {
        let mut dither_state = QUANTIZATION_RNG_STATE
            .fetch_add(0x9E37_79B9_7F4A_7C15, Ordering::Relaxed)
            .wrapping_add(frames as u64)
            .wrapping_add(channels as u64);
        let buffer = stream
            .render_client
            .GetBuffer(frames)
            .map_err(|e| AudioOutputError {
                code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_RENDER_FAILED,
                message: format!("Failed to acquire render buffer: {e}"),
            })?;

        match stream.sample_format {
            WasapiSampleFormat::Float32 => {
                let out = buffer as *mut f32;
                if consume {
                    write_scaled_f32_buffer(&scratch[..total_samples], out, volume);
                } else {
                    for index in 0..total_samples {
                        *out.add(index) = 0.0;
                    }
                }
            }
            WasapiSampleFormat::Pcm16 => {
                let out = buffer as *mut i16;
                if consume
                    && matches!(
                        output_quantization_mode,
                        NativeAudioOutputQuantizationMode::Round
                    )
                {
                    quantize_pcm16_round_buffer(&scratch[..total_samples], out, volume);
                } else {
                    for index in 0..total_samples {
                        let sample = if consume { scratch[index] } else { 0.0 };
                        let quantized = quantize_pcm16_with_mode(
                            sample,
                            volume,
                            output_quantization_mode,
                            &mut dither_state,
                        );
                        *out.add(index) = quantized;
                    }
                }
            }
            WasapiSampleFormat::Pcm32 => {
                let out = buffer as *mut i32;
                for index in 0..total_samples {
                    let sample = if consume { scratch[index] } else { 0.0 };
                    let quantized = quantize_pcm32_with_mode(
                        sample,
                        volume,
                        output_quantization_mode,
                        &mut dither_state,
                    );
                    *out.add(index) = quantized;
                }
            }
            WasapiSampleFormat::Pcm24In32 => {
                let out = buffer as *mut i32;
                if consume
                    && !matches!(
                        stream.transport_mode,
                        NativeAudioTransportMode::TransportExact
                    )
                    && matches!(
                        output_quantization_mode,
                        NativeAudioOutputQuantizationMode::Round
                    )
                {
                    quantize_pcm24_round_in32_buffer(&scratch[..total_samples], out, volume);
                } else {
                    for index in 0..total_samples {
                        let sample = if consume { scratch[index] } else { 0.0 };
                        let quantized = if matches!(
                            stream.transport_mode,
                            NativeAudioTransportMode::TransportExact
                        ) {
                            quantize_pcm24_transport_exact(sample, volume)
                        } else {
                            quantize_pcm24_with_mode(
                                sample,
                                volume,
                                output_quantization_mode,
                                &mut dither_state,
                            )
                        };
                        *out.add(index) = pack_pcm24_in32(quantized);
                    }
                }
            }
            WasapiSampleFormat::Pcm24Packed => {
                let out = buffer as *mut u8;
                for index in 0..total_samples {
                    let sample = if consume { scratch[index] } else { 0.0 };
                    let quantized = quantize_pcm24_with_mode(
                        sample,
                        volume,
                        output_quantization_mode,
                        &mut dither_state,
                    );
                    let bytes = pack_pcm24_packed_bytes(quantized);
                    let offset = index * 3;
                    *out.add(offset) = bytes[0];
                    *out.add(offset + 1) = bytes[1];
                    *out.add(offset + 2) = bytes[2];
                }
            }
        }

        stream
            .render_client
            .ReleaseBuffer(frames, 0)
            .map_err(|e| AudioOutputError {
                code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_RENDER_FAILED,
                message: format!("Failed to release render buffer: {e}"),
            })?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn render_frames_shared_raw(
    stream: &mut WasapiStream,
    frames: u32,
    inner: &SharedRawSinkInner,
    consume: bool,
    volume: f32,
    output_quantization_mode: NativeAudioOutputQuantizationMode,
    scratch: &mut Vec<f32>,
    declicker: &mut UnderrunDeclicker,
) -> Result<(), AudioOutputError> {
    let channels = stream.channels.max(1) as usize;
    let total_samples = frames as usize * channels;
    scratch.clear();
    memory_pool::reserve_f32_capacity(
        scratch,
        total_samples,
        "shared_raw.output.render_scratch_growth",
    );

    let mut available_samples = 0usize;
    let mut underrun = false;
    if consume {
        let profile = SCHEDULER.profile();
        let retry_attempts = callback_pop_retry_attempts(profile).max(1);
        let retry_spins = callback_pop_retry_spins(profile);
        let retry_wait = shared_raw_render_pop_wait_timeout(
            stream.sample_rate,
            stream.low_latency_period_frames,
        );
        let mut popped = inner
            .render_queue
            .pop_chunk_into(scratch, total_samples, Duration::ZERO);
        let mut popped_samples = popped.popped;
        let mut popped_finished = popped.finished;
        for _ in 1..retry_attempts {
            if popped_samples >= total_samples || popped_finished {
                break;
            }
            for _ in 0..retry_spins {
                std::hint::spin_loop();
            }

            let missing = total_samples.saturating_sub(popped_samples);
            if missing == 0 {
                break;
            }

            popped = if popped_samples == 0 {
                if *CALLBACK_POP_RT_SPIN_WAIT {
                    inner
                        .render_queue
                        .pop_chunk_into_realtime(scratch, total_samples, retry_wait)
                } else {
                    inner
                        .render_queue
                        .pop_chunk_into(scratch, total_samples, retry_wait)
                }
            } else if *CALLBACK_POP_RT_SPIN_WAIT {
                inner
                    .render_queue
                    .pop_chunk_append_into_realtime(scratch, missing, retry_wait)
            } else {
                inner
                    .render_queue
                    .pop_chunk_append_into(scratch, missing, retry_wait)
            };

            if popped_samples == 0 {
                popped_samples = popped.popped;
            } else {
                popped_samples = popped_samples.saturating_add(popped.popped);
            }
            popped_finished = popped_finished || popped.finished;
        }
        available_samples = popped_samples;
        if popped_samples == 0 && popped_finished {
            return Ok(());
        }
        if popped_samples < total_samples {
            underrun = true;
            let missing_samples = total_samples.saturating_sub(popped_samples);
            let missing_frames = (missing_samples / channels.max(1)).max(1) as u64;
            CALLBACK_RENDER_QUEUE_UNDERRUN_EVENTS.fetch_add(1, Ordering::Relaxed);
            CALLBACK_RENDER_QUEUE_UNDERRUN_FRAMES.fetch_add(missing_frames, Ordering::Relaxed);
            diagnostics::record_event_throttled(
                "shared-raw.output.render_underrun",
                missing_frames,
                frames as u64,
                &CALLBACK_RENDER_UNDERRUN_TIMELINE_GATE_MS,
                120,
            );
        }
    }

    declicker.process_render_buffer(
        scratch,
        frames,
        stream.sample_rate,
        channels,
        available_samples,
        underrun && consume,
    );

    unsafe {
        let mut dither_state = QUANTIZATION_RNG_STATE
            .fetch_add(0xD1B5_4A32_D192_ED03, Ordering::Relaxed)
            .wrapping_add(frames as u64)
            .wrapping_add(channels as u64)
            .wrapping_add(1);
        let buffer = stream
            .render_client
            .GetBuffer(frames)
            .map_err(|e| AudioOutputError {
                code: AUDIO_OUTPUT_WASAPI_SHARED_RAW_OPEN_FAILED,
                message: format!("Failed to acquire shared raw render buffer: {e}"),
            })?;

        match stream.sample_format {
            WasapiSampleFormat::Float32 => {
                let out = buffer as *mut f32;
                if consume {
                    write_scaled_f32_buffer(&scratch[..total_samples], out, volume);
                } else {
                    for index in 0..total_samples {
                        *out.add(index) = 0.0;
                    }
                }
            }
            WasapiSampleFormat::Pcm16 => {
                let out = buffer as *mut i16;
                if consume
                    && matches!(
                        output_quantization_mode,
                        NativeAudioOutputQuantizationMode::Round
                    )
                {
                    quantize_pcm16_round_buffer(&scratch[..total_samples], out, volume);
                } else {
                    for index in 0..total_samples {
                        let sample = if consume { scratch[index] } else { 0.0 };
                        let quantized = quantize_pcm16_with_mode(
                            sample,
                            volume,
                            output_quantization_mode,
                            &mut dither_state,
                        );
                        *out.add(index) = quantized;
                    }
                }
            }
            WasapiSampleFormat::Pcm32 => {
                let out = buffer as *mut i32;
                for index in 0..total_samples {
                    let sample = if consume { scratch[index] } else { 0.0 };
                    let quantized = quantize_pcm32_with_mode(
                        sample,
                        volume,
                        output_quantization_mode,
                        &mut dither_state,
                    );
                    *out.add(index) = quantized;
                }
            }
            WasapiSampleFormat::Pcm24In32 => {
                let out = buffer as *mut i32;
                if consume
                    && !matches!(
                        stream.transport_mode,
                        NativeAudioTransportMode::TransportExact
                    )
                    && matches!(
                        output_quantization_mode,
                        NativeAudioOutputQuantizationMode::Round
                    )
                {
                    quantize_pcm24_round_in32_buffer(&scratch[..total_samples], out, volume);
                } else {
                    for index in 0..total_samples {
                        let sample = if consume { scratch[index] } else { 0.0 };
                        let quantized = if matches!(
                            stream.transport_mode,
                            NativeAudioTransportMode::TransportExact
                        ) {
                            quantize_pcm24_transport_exact(sample, volume)
                        } else {
                            quantize_pcm24_with_mode(
                                sample,
                                volume,
                                output_quantization_mode,
                                &mut dither_state,
                            )
                        };
                        *out.add(index) = pack_pcm24_in32(quantized);
                    }
                }
            }
            WasapiSampleFormat::Pcm24Packed => {
                let out = buffer as *mut u8;
                for index in 0..total_samples {
                    let sample = if consume { scratch[index] } else { 0.0 };
                    let quantized = quantize_pcm24_with_mode(
                        sample,
                        volume,
                        output_quantization_mode,
                        &mut dither_state,
                    );
                    let bytes = pack_pcm24_packed_bytes(quantized);
                    let offset = index * 3;
                    *out.add(offset) = bytes[0];
                    *out.add(offset + 1) = bytes[1];
                    *out.add(offset + 2) = bytes[2];
                }
            }
        }

        stream
            .render_client
            .ReleaseBuffer(frames, 0)
            .map_err(|e| AudioOutputError {
                code: AUDIO_OUTPUT_WASAPI_SHARED_RAW_OPEN_FAILED,
                message: format!("Failed to release shared raw render buffer: {e}"),
            })?;
    }

    Ok(())
}

fn select_low_latency_period(min: u32, max: u32, fundamental: u32) -> u32 {
    if min > max {
        return max;
    }
    let fundamental = fundamental.max(1);
    let period = min
        .saturating_add(fundamental.saturating_sub(1))
        .saturating_div(fundamental)
        .saturating_mul(fundamental);
    period.clamp(min, max)
}

#[cfg(target_os = "windows")]
fn open_wasapi_stream(
    device_id: &str,
    sample_rate: u32,
    channels: u16,
    transport_mode: NativeAudioTransportMode,
    stream_mode: WasapiStreamMode,
) -> Result<WasapiStream, AudioOutputError> {
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::Foundation::BOOL;
    use windows::Win32::Media::Audio::{
        AudioCategory_Media, AudioClientProperties, IAudioClient, IAudioClient2, IAudioClient3,
        IAudioRenderClient, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
        AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED, AUDCLNT_E_UNSUPPORTED_FORMAT,
        AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
        AUDCLNT_STREAMOPTIONS_RAW, WAVEFORMATEX, WAVEFORMATEXTENSIBLE, WAVEFORMATEXTENSIBLE_0,
        WAVE_FORMAT_PCM,
    };
    use windows::Win32::Media::KernelStreaming::{
        KSAUDIO_SPEAKER_DIRECTOUT, KSDATAFORMAT_SUBTYPE_PCM, SPEAKER_FRONT_CENTER,
        SPEAKER_FRONT_LEFT, SPEAKER_FRONT_RIGHT, WAVE_FORMAT_EXTENSIBLE,
    };
    use windows::Win32::Media::Multimedia::{
        KSDATAFORMAT_SUBTYPE_IEEE_FLOAT, WAVE_FORMAT_IEEE_FLOAT,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Threading::CreateEventW;

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let is_shared_raw = matches!(stream_mode, WasapiStreamMode::SharedRaw);
        let backend_log_label = if is_shared_raw {
            "wasapi-shared-raw"
        } else {
            "wasapi-exclusive"
        };
        let open_failed_code = if is_shared_raw {
            AUDIO_OUTPUT_WASAPI_SHARED_RAW_OPEN_FAILED
        } else {
            AUDIO_OUTPUT_WASAPI_EXCLUSIVE_OPEN_FAILED
        };
        let unsupported_code = if is_shared_raw {
            AUDIO_OUTPUT_WASAPI_SHARED_RAW_UNSUPPORTED_FORMAT
        } else {
            AUDIO_OUTPUT_WASAPI_EXCLUSIVE_UNSUPPORTED_FORMAT
        };
        let init_failed_code = if is_shared_raw {
            AUDIO_OUTPUT_WASAPI_SHARED_RAW_INIT_FAILED
        } else {
            AUDIO_OUTPUT_WASAPI_EXCLUSIVE_OPEN_FAILED
        };
        let device_not_found_code = if is_shared_raw {
            AUDIO_OUTPUT_WASAPI_SHARED_RAW_OPEN_FAILED
        } else {
            AUDIO_OUTPUT_WASAPI_EXCLUSIVE_DEVICE_NOT_FOUND
        };
        let share_mode = if is_shared_raw {
            AUDCLNT_SHAREMODE_SHARED
        } else {
            AUDCLNT_SHAREMODE_EXCLUSIVE
        };
        let stream_flags = AUDCLNT_STREAMFLAGS_EVENTCALLBACK;
        let low_latency_enabled =
            parse_env_bool_wasapi("PMP_AUDIO_WASAPI_LOW_LATENCY_ENABLED", true);

        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| {
                AudioOutputError {
                    code: open_failed_code,
                    message: format!("Failed to create MMDeviceEnumerator: {e}"),
                }
            })?;

        let device_id_wide: Vec<u16> = device_id.encode_utf16().chain(Some(0)).collect();
        let device: IMMDevice = enumerator
            .GetDevice(PCWSTR(device_id_wide.as_ptr()))
            .map_err(|e| AudioOutputError {
                code: device_not_found_code,
                message: format!("Failed to open output device: {e}"),
            })?;

        #[repr(C, align(8))]
        struct AlignedWaveFormatExtensible(WAVEFORMATEXTENSIBLE);

        enum WaveFormatAttempt {
            Ex(WAVEFORMATEX),
            Ext(AlignedWaveFormatExtensible),
        }

        impl WaveFormatAttempt {
            fn as_ptr(&self) -> *const WAVEFORMATEX {
                match self {
                    Self::Ex(format) => format as *const WAVEFORMATEX,
                    Self::Ext(format) => {
                        &format.0 as *const WAVEFORMATEXTENSIBLE as *const WAVEFORMATEX
                    }
                }
            }

            fn format_tag_bits_channels_rate(&self) -> (u16, u16, u16, u32) {
                let format = unsafe { &*self.as_ptr() };
                (
                    format.wFormatTag,
                    format.wBitsPerSample,
                    format.nChannels,
                    format.nSamplesPerSec,
                )
            }
        }

        struct FormatAttempt {
            label: &'static str,
            sample_format: WasapiSampleFormat,
            wave_format: WaveFormatAttempt,
        }

        fn build_wave_format_ex(
            w_format_tag: u16,
            sample_rate: u32,
            channels: u16,
            bytes_per_sample: u16,
        ) -> WAVEFORMATEX {
            let block_align = channels.saturating_mul(bytes_per_sample).max(1);
            let bits_per_sample = bytes_per_sample.saturating_mul(8);
            WAVEFORMATEX {
                wFormatTag: w_format_tag,
                nChannels: channels,
                nSamplesPerSec: sample_rate,
                nAvgBytesPerSec: sample_rate.saturating_mul(block_align as u32),
                nBlockAlign: block_align,
                wBitsPerSample: bits_per_sample,
                cbSize: 0,
            }
        }

        fn build_wave_format_extensible(
            sample_rate: u32,
            channels: u16,
            bytes_per_sample: u16,
            valid_bits_per_sample: u16,
            channel_mask: u32,
            sub_format: windows::core::GUID,
        ) -> WaveFormatAttempt {
            let cb_size = (std::mem::size_of::<WAVEFORMATEXTENSIBLE>()
                - std::mem::size_of::<WAVEFORMATEX>()) as u16;
            let block_align = channels.saturating_mul(bytes_per_sample).max(1);
            let bits_per_sample = bytes_per_sample.saturating_mul(8);

            WaveFormatAttempt::Ext(AlignedWaveFormatExtensible(WAVEFORMATEXTENSIBLE {
                Format: WAVEFORMATEX {
                    wFormatTag: WAVE_FORMAT_EXTENSIBLE as u16,
                    nChannels: channels,
                    nSamplesPerSec: sample_rate,
                    nAvgBytesPerSec: sample_rate.saturating_mul(block_align as u32),
                    nBlockAlign: block_align,
                    wBitsPerSample: bits_per_sample,
                    cbSize: cb_size,
                },
                Samples: WAVEFORMATEXTENSIBLE_0 {
                    wValidBitsPerSample: valid_bits_per_sample,
                },
                dwChannelMask: channel_mask,
                SubFormat: sub_format,
            }))
        }

        let speaker_mask = match channels {
            1 => SPEAKER_FRONT_CENTER,
            2 => SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT,
            _ => KSAUDIO_SPEAKER_DIRECTOUT,
        };
        let mask_candidates = if channels <= 2 {
            vec![speaker_mask, KSAUDIO_SPEAKER_DIRECTOUT]
        } else {
            vec![KSAUDIO_SPEAKER_DIRECTOUT]
        };

        let mut candidates = Vec::new();
        for mask in mask_candidates {
            let mask_label = if mask == KSAUDIO_SPEAKER_DIRECTOUT {
                "directout"
            } else {
                "speakers"
            };

            candidates.push(FormatAttempt {
                label: if mask_label == "directout" {
                    "Float32 (extensible, directout)"
                } else {
                    "Float32 (extensible, speakers)"
                },
                sample_format: WasapiSampleFormat::Float32,
                wave_format: build_wave_format_extensible(
                    sample_rate,
                    channels,
                    4,
                    32,
                    mask,
                    KSDATAFORMAT_SUBTYPE_IEEE_FLOAT,
                ),
            });

            candidates.push(FormatAttempt {
                label: if mask_label == "directout" {
                    "PCM32 (extensible, directout)"
                } else {
                    "PCM32 (extensible, speakers)"
                },
                sample_format: WasapiSampleFormat::Pcm32,
                wave_format: build_wave_format_extensible(
                    sample_rate,
                    channels,
                    4,
                    32,
                    mask,
                    KSDATAFORMAT_SUBTYPE_PCM,
                ),
            });

            candidates.push(FormatAttempt {
                label: if mask_label == "directout" {
                    "PCM24 (extensible, 24-in-32, directout)"
                } else {
                    "PCM24 (extensible, 24-in-32, speakers)"
                },
                sample_format: WasapiSampleFormat::Pcm24In32,
                wave_format: build_wave_format_extensible(
                    sample_rate,
                    channels,
                    4,
                    24,
                    mask,
                    KSDATAFORMAT_SUBTYPE_PCM,
                ),
            });

            candidates.push(FormatAttempt {
                label: if mask_label == "directout" {
                    "PCM24 (extensible, packed, directout)"
                } else {
                    "PCM24 (extensible, packed, speakers)"
                },
                sample_format: WasapiSampleFormat::Pcm24Packed,
                wave_format: build_wave_format_extensible(
                    sample_rate,
                    channels,
                    3,
                    24,
                    mask,
                    KSDATAFORMAT_SUBTYPE_PCM,
                ),
            });

            candidates.push(FormatAttempt {
                label: if mask_label == "directout" {
                    "PCM16 (extensible, directout)"
                } else {
                    "PCM16 (extensible, speakers)"
                },
                sample_format: WasapiSampleFormat::Pcm16,
                wave_format: build_wave_format_extensible(
                    sample_rate,
                    channels,
                    2,
                    16,
                    mask,
                    KSDATAFORMAT_SUBTYPE_PCM,
                ),
            });

            if matches!(transport_mode, NativeAudioTransportMode::TransportExact) {
                continue;
            }
        }

        if !matches!(transport_mode, NativeAudioTransportMode::TransportExact) {
            candidates.push(FormatAttempt {
                label: "Float32 (waveex)",
                sample_format: WasapiSampleFormat::Float32,
                wave_format: WaveFormatAttempt::Ex(build_wave_format_ex(
                    WAVE_FORMAT_IEEE_FLOAT as u16,
                    sample_rate,
                    channels,
                    4,
                )),
            });

            candidates.push(FormatAttempt {
                label: "PCM32 (waveex)",
                sample_format: WasapiSampleFormat::Pcm32,
                wave_format: WaveFormatAttempt::Ex(build_wave_format_ex(
                    WAVE_FORMAT_PCM as u16,
                    sample_rate,
                    channels,
                    4,
                )),
            });

            candidates.push(FormatAttempt {
                label: "PCM24 (waveex, packed)",
                sample_format: WasapiSampleFormat::Pcm24Packed,
                wave_format: WaveFormatAttempt::Ex(build_wave_format_ex(
                    WAVE_FORMAT_PCM as u16,
                    sample_rate,
                    channels,
                    3,
                )),
            });

            candidates.push(FormatAttempt {
                label: "PCM16 (waveex)",
                sample_format: WasapiSampleFormat::Pcm16,
                wave_format: WaveFormatAttempt::Ex(build_wave_format_ex(
                    WAVE_FORMAT_PCM as u16,
                    sample_rate,
                    channels,
                    2,
                )),
            });
        }

        if matches!(transport_mode, NativeAudioTransportMode::TransportExact) {
            candidates.sort_by_key(|attempt| match attempt.sample_format {
                WasapiSampleFormat::Pcm24In32 => 0,
                WasapiSampleFormat::Pcm32 => 1,
                WasapiSampleFormat::Pcm24Packed => 2,
                WasapiSampleFormat::Float32 => 3,
                WasapiSampleFormat::Pcm16 => 4,
            });
        }
        let mut last_error: Option<AudioOutputError> = None;

        fn query_mix_format_rate_channels(
            audio_client: &IAudioClient,
        ) -> Option<(u32, u16, u16, u16)> {
            let mix_ptr = unsafe { audio_client.GetMixFormat().ok()? };
            if mix_ptr.is_null() {
                return None;
            }
            let mix = unsafe { &*mix_ptr };
            let result = (
                mix.nSamplesPerSec,
                mix.nChannels,
                mix.wBitsPerSample,
                mix.wFormatTag,
            );
            unsafe {
                windows::Win32::System::Com::CoTaskMemFree(Some(mix_ptr as *const c_void));
            }
            Some(result)
        }

        for attempt in candidates {
            let audio_client: IAudioClient =
                device
                    .Activate(CLSCTX_ALL, None)
                    .map_err(|e| AudioOutputError {
                        code: open_failed_code,
                        message: format!("Failed to activate audio client: {e}"),
                    })?;

            if is_shared_raw {
                let raw_props = AudioClientProperties {
                    cbSize: std::mem::size_of::<AudioClientProperties>() as u32,
                    bIsOffload: BOOL(0),
                    eCategory: AudioCategory_Media,
                    Options: AUDCLNT_STREAMOPTIONS_RAW,
                };
                let audio_client2 = match audio_client.cast::<IAudioClient2>() {
                    Ok(value) => value,
                    Err(e) => {
                        last_error = Some(AudioOutputError {
                            code: init_failed_code,
                            message: format!(
                                "Failed to query IAudioClient2 for RAW mode ({backend_log_label}, format={}): {e}",
                                attempt.label
                            ),
                        });
                        continue;
                    }
                };
                if let Err(e) = audio_client2.SetClientProperties(&raw_props as *const _) {
                    last_error = Some(AudioOutputError {
                        code: init_failed_code,
                        message: format!(
                            "Failed to enable RAW mode for {backend_log_label} (format={}): {e}",
                            attempt.label
                        ),
                    });
                    continue;
                }

                let mut closest_match: *mut WAVEFORMATEX = std::ptr::null_mut();
                let support_hr = audio_client.IsFormatSupported(
                    share_mode,
                    attempt.wave_format.as_ptr(),
                    Some(&mut closest_match),
                );
                if !support_hr.is_ok() {
                    if !closest_match.is_null() {
                        windows::Win32::System::Com::CoTaskMemFree(Some(
                            closest_match as *const c_void,
                        ));
                    }
                    let (tag, bits, ch, rate) = attempt.wave_format.format_tag_bits_channels_rate();
                    let mix_hint = query_mix_format_rate_channels(&audio_client)
                        .map(|(mix_rate, mix_channels, mix_bits, mix_tag)| {
                            format!(
                                "mix(rate={mix_rate}, channels={mix_channels}, bits={mix_bits}, tag=0x{mix_tag:04X})"
                            )
                        })
                        .unwrap_or_else(|| "mix(unknown)".to_string());
                    last_error = Some(AudioOutputError {
                        code: unsupported_code,
                        message: format!(
                            "Unsupported RAW format for {backend_log_label}: {} (rate={rate}, channels={ch}, bits={bits}, tag=0x{tag:04X}, {})",
                            attempt.label,
                            mix_hint
                        ),
                    });
                    continue;
                }
                if !closest_match.is_null() {
                    windows::Win32::System::Com::CoTaskMemFree(Some(
                        closest_match as *const c_void,
                    ));
                }
            }

            if is_shared_raw && low_latency_enabled {
                if let Ok(low_latency_client) = device.Activate::<IAudioClient>(CLSCTX_ALL, None) {
                    let raw_props = AudioClientProperties {
                        cbSize: std::mem::size_of::<AudioClientProperties>() as u32,
                        bIsOffload: BOOL(0),
                        eCategory: AudioCategory_Media,
                        Options: AUDCLNT_STREAMOPTIONS_RAW,
                    };
                    let low_latency_raw_ready = match low_latency_client.cast::<IAudioClient2>() {
                        Ok(client2) => {
                            if let Err(err) = client2.SetClientProperties(&raw_props as *const _) {
                                eprintln!(
                                    "[NativeAudio][wasapi-shared-raw] IAudioClient3 path failed to reapply RAW properties: {err}, falling back"
                                );
                                false
                            } else {
                                true
                            }
                        }
                        Err(_) => {
                            eprintln!(
                                "[NativeAudio][wasapi-shared-raw] IAudioClient3 path could not query IAudioClient2, falling back"
                            );
                            false
                        }
                    };

                    if low_latency_raw_ready {
                        if let Ok(audio_client3) = low_latency_client.cast::<IAudioClient3>() {
                            let mut default_period_frames: u32 = 0;
                            let mut fundamental_period_frames: u32 = 0;
                            let mut min_period_frames: u32 = 0;
                            let mut max_period_frames: u32 = 0;

                            if audio_client3
                                .GetSharedModeEnginePeriod(
                                    attempt.wave_format.as_ptr(),
                                    &mut default_period_frames,
                                    &mut fundamental_period_frames,
                                    &mut min_period_frames,
                                    &mut max_period_frames,
                                )
                                .is_ok()
                            {
                                let selected_period = select_low_latency_period(
                                    min_period_frames,
                                    max_period_frames,
                                    fundamental_period_frames,
                                );

                                eprintln!(
                                "[NativeAudio][wasapi-shared-raw] IAudioClient3 periods: default={} fundamental={} min={} max={} selected={}",
                                default_period_frames,
                                fundamental_period_frames,
                                min_period_frames,
                                max_period_frames,
                                selected_period
                            );

                                match CreateEventW(None, false, false, PCWSTR::null()) {
                                    Ok(event_handle) => {
                                        match audio_client3.InitializeSharedAudioStream(
                                            stream_flags,
                                            selected_period,
                                            attempt.wave_format.as_ptr(),
                                            None,
                                        ) {
                                            Ok(()) => {
                                                if let Err(err) =
                                                    low_latency_client.SetEventHandle(event_handle)
                                                {
                                                    let _ = windows::Win32::Foundation::CloseHandle(
                                                        event_handle,
                                                    );
                                                    eprintln!(
                                                    "[NativeAudio][wasapi-shared-raw] IAudioClient3 SetEventHandle failed: {err}, falling back"
                                                );
                                                } else {
                                                    match low_latency_client.GetBufferSize() {
                                                        Ok(buffer_frame_count) => {
                                                            match low_latency_client.GetService() {
                                                                Ok(render_client) => {
                                                                    eprintln!(
                                                                    "[NativeAudio][wasapi-shared-raw] IAudioClient3 low-latency stream: format={} channels={} sample_rate={} period_frames={} buffer_frames={}",
                                                                    attempt.label,
                                                                    channels,
                                                                    sample_rate,
                                                                    selected_period,
                                                                    buffer_frame_count
                                                                );
                                                                    return Ok(WasapiStream {
                                                                        audio_client:
                                                                            low_latency_client,
                                                                        render_client,
                                                                        event_handle,
                                                                        buffer_frame_count,
                                                                        channels,
                                                                        sample_rate,
                                                                        sample_format: attempt
                                                                            .sample_format,
                                                                        transport_mode,
                                                                        mode: stream_mode,
                                                                        started: false,
                                                                        low_latency_period_frames:
                                                                            Some(selected_period),
                                                                    });
                                                                }
                                                                Err(err) => {
                                                                    let _ = windows::Win32::Foundation::CloseHandle(event_handle);
                                                                    eprintln!(
                                                                    "[NativeAudio][wasapi-shared-raw] IAudioClient3 GetService failed: {err}, falling back"
                                                                );
                                                                }
                                                            }
                                                        }
                                                        Err(err) => {
                                                            let _ =
                                                            windows::Win32::Foundation::CloseHandle(
                                                                event_handle,
                                                            );
                                                            eprintln!(
                                                            "[NativeAudio][wasapi-shared-raw] IAudioClient3 GetBufferSize failed: {err}, falling back"
                                                        );
                                                        }
                                                    }
                                                }
                                            }
                                            Err(err) => {
                                                let _ = windows::Win32::Foundation::CloseHandle(
                                                    event_handle,
                                                );
                                                eprintln!(
                                                "[NativeAudio][wasapi-shared-raw] IAudioClient3 InitializeSharedAudioStream failed: {err}, falling back to classic path"
                                            );
                                            }
                                        }
                                    }
                                    Err(err) => {
                                        eprintln!(
                                        "[NativeAudio][wasapi-shared-raw] IAudioClient3 CreateEventW failed: {err}, falling back"
                                    );
                                    }
                                }
                            } else {
                                eprintln!(
                                "[NativeAudio][wasapi-shared-raw] IAudioClient3 GetSharedModeEnginePeriod failed, falling back"
                            );
                            }
                        } else {
                            eprintln!(
                                "[NativeAudio][wasapi-shared-raw] IAudioClient3 not available, falling back to classic path"
                            );
                        }
                    }
                } else {
                    eprintln!(
                        "[NativeAudio][wasapi-shared-raw] Failed to activate dedicated client for IAudioClient3, falling back"
                    );
                }
            }

            let mut default_period = 0i64;
            let mut min_period = 0i64;
            if let Err(e) =
                audio_client.GetDevicePeriod(Some(&mut default_period), Some(&mut min_period))
            {
                last_error = Some(AudioOutputError {
                    code: open_failed_code,
                    message: format!("Failed to query device period: {e}"),
                });
                continue;
            }

            let buffer_candidates: Vec<i64> = if is_shared_raw {
                vec![3_000_000, 2_400_000, 1_800_000, 1_200_000, 800_000]
            } else {
                let base_periodicity = default_period.max(min_period).max(200_000);
                vec![
                    base_periodicity.saturating_mul(4),
                    base_periodicity.saturating_mul(8),
                    base_periodicity.saturating_mul(2),
                    base_periodicity,
                ]
            };

            for buffer_duration in buffer_candidates {
                let event_handle =
                    CreateEventW(None, false, false, PCWSTR::null()).map_err(|e| {
                        AudioOutputError {
                            code: open_failed_code,
                            message: format!("Failed to create audio event handle: {e}"),
                        }
                    })?;

                let periodicity = if is_shared_raw { 0 } else { buffer_duration };
                let init = audio_client.Initialize(
                    share_mode,
                    stream_flags,
                    buffer_duration,
                    periodicity,
                    attempt.wave_format.as_ptr(),
                    None,
                );
                if let Err(e) = init {
                    let _ = windows::Win32::Foundation::CloseHandle(event_handle);

                    if is_shared_raw && e.code() == AUDCLNT_E_UNSUPPORTED_FORMAT {
                        let (tag, bits, ch, rate) =
                            attempt.wave_format.format_tag_bits_channels_rate();
                        let mix_hint = query_mix_format_rate_channels(&audio_client)
                            .map(|(mix_rate, mix_channels, mix_bits, mix_tag)| {
                                format!(
                                    "mix(rate={mix_rate}, channels={mix_channels}, bits={mix_bits}, tag=0x{mix_tag:04X})"
                                )
                            })
                            .unwrap_or_else(|| "mix(unknown)".to_string());
                        last_error = Some(AudioOutputError {
                            code: unsupported_code,
                            message: format!(
                                "Failed to init {backend_log_label} stream (unsupported format={}, rate={rate}, channels={ch}, bits={bits}, tag=0x{tag:04X}, duration={buffer_duration}, {mix_hint})",
                                attempt.label,
                            ),
                        });
                        continue;
                    }

                    if !is_shared_raw && e.code() == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED {
                        let aligned_frames = match audio_client.GetBufferSize() {
                            Ok(value) => value,
                            Err(get_err) => {
                                last_error = Some(AudioOutputError {
                                    code: unsupported_code,
                                    message: format!(
                                        "Failed to query aligned buffer size after AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED (format={}, duration={buffer_duration}): {get_err}",
                                        attempt.label
                                    ),
                                });
                                continue;
                            }
                        };

                        let sample_rate_u64 = sample_rate.max(1) as u64;
                        let aligned_duration = ((10_000_000u64
                            .saturating_mul(aligned_frames as u64)
                            .saturating_add(sample_rate_u64 / 2))
                            / sample_rate_u64)
                            .max(1) as i64;

                        let aligned_audio_client: IAudioClient = device
                            .Activate(CLSCTX_ALL, None)
                            .map_err(|err| AudioOutputError {
                                code: open_failed_code,
                                message: format!("Failed to activate audio client: {err}"),
                            })?;

                        let aligned_event_handle = CreateEventW(None, false, false, PCWSTR::null())
                            .map_err(|err| AudioOutputError {
                                code: open_failed_code,
                                message: format!("Failed to create audio event handle: {err}"),
                            })?;

                        let aligned_init = aligned_audio_client.Initialize(
                            share_mode,
                            stream_flags,
                            aligned_duration,
                            aligned_duration,
                            attempt.wave_format.as_ptr(),
                            None,
                        );
                        if let Err(aligned_err) = aligned_init {
                            let _ = windows::Win32::Foundation::CloseHandle(aligned_event_handle);
                            last_error = Some(AudioOutputError {
                                code: unsupported_code,
                                message: format!(
                                    "Failed to init aligned {backend_log_label} stream (format={}, duration={aligned_duration}, frames={aligned_frames}): {aligned_err}",
                                    attempt.label
                                ),
                            });
                            continue;
                        }

                        if let Err(err) = aligned_audio_client.SetEventHandle(aligned_event_handle)
                        {
                            let _ = windows::Win32::Foundation::CloseHandle(aligned_event_handle);
                            last_error = Some(AudioOutputError {
                                code: open_failed_code,
                                message: format!("Failed to set event handle: {err}"),
                            });
                            continue;
                        }

                        let buffer_frame_count =
                            aligned_audio_client.GetBufferSize().map_err(|err| {
                                let _ =
                                    windows::Win32::Foundation::CloseHandle(aligned_event_handle);
                                AudioOutputError {
                                    code: open_failed_code,
                                    message: format!("Failed to get buffer size: {err}"),
                                }
                            })?;

                        let render_client: IAudioRenderClient = aligned_audio_client
                            .GetService()
                            .map_err(|err| {
                            let _ = windows::Win32::Foundation::CloseHandle(aligned_event_handle);
                            AudioOutputError {
                                code: open_failed_code,
                                message: format!("Failed to get render client: {err}"),
                            }
                        })?;

                        eprintln!(
                            "[NativeAudio][{backend_log_label}] Open stream: format={} channels={} sample_rate={} frames={} buffer_duration_100ns={}",
                            attempt.label,
                            channels,
                            sample_rate,
                            buffer_frame_count,
                            aligned_duration
                        );
                        return Ok(WasapiStream {
                            audio_client: aligned_audio_client,
                            render_client,
                            event_handle: aligned_event_handle,
                            buffer_frame_count,
                            channels,
                            sample_rate,
                            sample_format: attempt.sample_format,
                            transport_mode,
                            mode: stream_mode,
                            started: false,
                            low_latency_period_frames: None,
                        });
                    }

                    last_error = Some(AudioOutputError {
                        code: init_failed_code,
                        message: format!(
                            "Failed to init {backend_log_label} stream (format={}, duration={buffer_duration}): {e}",
                            attempt.label
                        ),
                    });
                    continue;
                }

                if let Err(err) = audio_client.SetEventHandle(event_handle) {
                    let _ = windows::Win32::Foundation::CloseHandle(event_handle);
                    last_error = Some(AudioOutputError {
                        code: open_failed_code,
                        message: format!("Failed to set event handle: {err}"),
                    });
                    continue;
                }

                let buffer_frame_count = audio_client.GetBufferSize().map_err(|err| {
                    let _ = windows::Win32::Foundation::CloseHandle(event_handle);
                    AudioOutputError {
                        code: open_failed_code,
                        message: format!("Failed to get buffer size: {err}"),
                    }
                })?;

                let render_client: IAudioRenderClient =
                    audio_client.GetService().map_err(|err| {
                        let _ = windows::Win32::Foundation::CloseHandle(event_handle);
                        AudioOutputError {
                            code: open_failed_code,
                            message: format!("Failed to get render client: {err}"),
                        }
                    })?;

                eprintln!(
                    "[NativeAudio][{backend_log_label}] Open stream: format={} channels={} sample_rate={} frames={} buffer_duration_100ns={}",
                    attempt.label,
                    channels,
                    sample_rate,
                    buffer_frame_count,
                    buffer_duration
                );
                return Ok(WasapiStream {
                    audio_client,
                    render_client,
                    event_handle,
                    buffer_frame_count,
                    channels,
                    sample_rate,
                    sample_format: attempt.sample_format,
                    transport_mode,
                    mode: stream_mode,
                    started: false,
                    low_latency_period_frames: None,
                });
            }
        }

        Err(last_error.unwrap_or(AudioOutputError {
            code: unsupported_code,
            message: format!("No supported {backend_log_label} output format found"),
        }))
    }
}
