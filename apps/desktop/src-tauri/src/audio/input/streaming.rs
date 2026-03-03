use std::f32::consts::FRAC_PI_2;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use once_cell::sync::Lazy;
use rodio::Source;

use crate::audio::buffer::AudioRingBuffer;
use crate::audio::buffer_policy;
use crate::audio::bulk_source::BulkSource;
use crate::audio::control_plane::{
    CommandRx, CommandTryRecvError, CommandTx, ControlCommand, ControlCommandPriority,
};
use crate::audio::diagnostics;
use crate::audio::memory_pool;
use crate::audio::realtime_scheduler::RealtimePressureProfile;

static STREAMING_UNDERRUN_EVENTS: AtomicU64 = AtomicU64::new(0);
static STREAMING_UNDERRUN_FRAMES: AtomicU64 = AtomicU64::new(0);

static TRANSFER_LOW_WATERMARK_SAMPLES: AtomicU64 = AtomicU64::new(0);
static TRANSFER_RENDER_LOW_HIT_COUNT: AtomicU64 = AtomicU64::new(0);
static TRANSFER_DECODE_LOW_HIT_COUNT: AtomicU64 = AtomicU64::new(0);
static RENDER_QUEUE_PAGE_LOCK_SUCCESS: AtomicU64 = AtomicU64::new(0);
static RENDER_QUEUE_PAGE_LOCK_FAILURE: AtomicU64 = AtomicU64::new(0);
static TRANSFER_ADAPTATION_LEVEL: AtomicU64 = AtomicU64::new(0);
static TRANSFER_OSCILLATION_STREAK: AtomicU64 = AtomicU64::new(0);
static TRANSFER_RENDER_LOW_TIMELINE_GATE_MS: AtomicU64 = AtomicU64::new(0);
static TRANSFER_DECODE_LOW_TIMELINE_GATE_MS: AtomicU64 = AtomicU64::new(0);
static STREAMING_UNDERRUN_TIMELINE_GATE_MS: AtomicU64 = AtomicU64::new(0);

pub(crate) fn streaming_underrun_stats() -> (u64, u64) {
    (
        STREAMING_UNDERRUN_EVENTS.load(Ordering::Relaxed),
        STREAMING_UNDERRUN_FRAMES.load(Ordering::Relaxed),
    )
}

pub(crate) struct StreamingPlayback {
    pub buffer: AudioRingBuffer,
    pub render_queue: AudioRingBuffer,
    pub command_tx: CommandTx<DecoderCommand>,
    pub shutdown_tx: StreamingShutdownTx,
    pub error: Arc<Mutex<Option<String>>>,
}

fn transfer_target_samples(
    render_len: usize,
    low_watermark: usize,
    high_watermark: usize,
    chunk_limit: usize,
    channels: usize,
    profile: RealtimePressureProfile,
) -> usize {
    let channels = channels.max(1);
    let low = low_watermark.max(channels);
    let high = high_watermark.max(low);
    let chunk_limit = chunk_limit.max(channels);

    let refill_anchor = match profile {
        RealtimePressureProfile::Normal => {
            let span = high.saturating_sub(low);
            low.saturating_add((span.saturating_mul(2)) / 3)
        }
        RealtimePressureProfile::Guarded | RealtimePressureProfile::Critical => high,
    };

    let desired = if render_len <= low {
        high.saturating_sub(render_len)
    } else {
        refill_anchor.saturating_sub(render_len)
    };

    let min_quantum = match profile {
        RealtimePressureProfile::Normal => channels.saturating_mul(256),
        RealtimePressureProfile::Guarded => channels.saturating_mul(512),
        RealtimePressureProfile::Critical => channels.saturating_mul(2048),
    };

    desired.max(min_quantum).max(channels).min(chunk_limit)
}

pub(crate) fn streaming_transfer_stats() -> (u64, u64, u64, bool, u64, u64) {
    (
        TRANSFER_LOW_WATERMARK_SAMPLES.load(Ordering::Relaxed),
        TRANSFER_RENDER_LOW_HIT_COUNT.load(Ordering::Relaxed),
        TRANSFER_DECODE_LOW_HIT_COUNT.load(Ordering::Relaxed),
        RENDER_QUEUE_PAGE_LOCK_SUCCESS.load(Ordering::Relaxed)
            > RENDER_QUEUE_PAGE_LOCK_FAILURE.load(Ordering::Relaxed),
        TRANSFER_ADAPTATION_LEVEL.load(Ordering::Relaxed),
        TRANSFER_OSCILLATION_STREAK.load(Ordering::Relaxed),
    )
}

#[derive(Clone)]
pub(crate) struct StreamingShutdownTx {
    decoder_tx: CommandTx<DecoderCommand>,
    transfer_tx: CommandTx<TransferCommand>,
}

impl StreamingShutdownTx {
    pub fn new(
        decoder_tx: CommandTx<DecoderCommand>,
        transfer_tx: CommandTx<TransferCommand>,
    ) -> Self {
        Self {
            decoder_tx,
            transfer_tx,
        }
    }

    pub fn shutdown(&self) {
        let _ = self.transfer_tx.send(TransferCommand::Shutdown);
        let _ = self.decoder_tx.send(DecoderCommand::Shutdown);
    }
}

fn env_bool(name: &str, default_value: bool) -> bool {
    match std::env::var(name) {
        Ok(value) => {
            let normalized = value.trim().to_ascii_lowercase();
            matches!(normalized.as_str(), "1" | "true" | "yes" | "on")
        }
        Err(_) => default_value,
    }
}

fn env_u32(name: &str, default_value: u32, min: u32, max: u32) -> u32 {
    match std::env::var(name) {
        Ok(value) => value
            .trim()
            .parse::<u32>()
            .ok()
            .unwrap_or(default_value)
            .clamp(min, max),
        Err(_) => default_value,
    }
}

#[derive(Clone, Copy, Debug)]
struct BurstFillPolicy {
    enabled: bool,
    enter_hits: u32,
    hold_loops: u32,
    chunk_boost_percent: u32,
}

impl BurstFillPolicy {
    fn from_env() -> Self {
        Self {
            enabled: env_bool("PMP_AUDIO_TRANSFER_BURST_FILL_ENABLED", true),
            enter_hits: env_u32("PMP_AUDIO_TRANSFER_BURST_ENTER_HITS", 2, 1, 64),
            hold_loops: env_u32("PMP_AUDIO_TRANSFER_BURST_HOLD_LOOPS", 36, 1, 320),
            chunk_boost_percent: env_u32(
                "PMP_AUDIO_TRANSFER_BURST_CHUNK_BOOST_PERCENT",
                250,
                0,
                800,
            ),
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
        let min_ms = env_u32("PMP_AUDIO_UNDERRUN_MASK_MIN_MS", 4, 1, 120);
        let max_ms = env_u32("PMP_AUDIO_UNDERRUN_MASK_MAX_MS", 64, min_ms, 200);
        Self {
            normal_ms: env_u32("PMP_AUDIO_UNDERRUN_MASK_NORMAL_MS", 8, min_ms, max_ms),
            guarded_ms: env_u32("PMP_AUDIO_UNDERRUN_MASK_GUARDED_MS", 14, min_ms, max_ms),
            critical_ms: env_u32("PMP_AUDIO_UNDERRUN_MASK_CRITICAL_MS", 24, min_ms, max_ms),
            streak_boost_ms: env_u32("PMP_AUDIO_UNDERRUN_MASK_STREAK_BOOST_MS", 3, 0, 40),
            min_ms,
            max_ms,
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct StreamingPopRetryPolicy {
    normal_attempts: u32,
    guarded_attempts: u32,
    critical_attempts: u32,
    streak_step: u32,
    max_attempts: u32,
    normal_spins: u32,
    guarded_spins: u32,
    critical_spins: u32,
}

impl StreamingPopRetryPolicy {
    fn from_env() -> Self {
        Self {
            normal_attempts: env_u32("PMP_AUDIO_STREAM_POP_RETRY_NORMAL", 2, 1, 8),
            guarded_attempts: env_u32("PMP_AUDIO_STREAM_POP_RETRY_GUARDED", 3, 1, 8),
            critical_attempts: env_u32("PMP_AUDIO_STREAM_POP_RETRY_CRITICAL", 4, 1, 8),
            streak_step: env_u32("PMP_AUDIO_STREAM_POP_RETRY_STREAK_STEP", 2, 1, 8),
            max_attempts: env_u32("PMP_AUDIO_STREAM_POP_RETRY_MAX", 7, 1, 12),
            normal_spins: env_u32("PMP_AUDIO_STREAM_POP_RETRY_SPIN_NORMAL", 24, 0, 600),
            guarded_spins: env_u32("PMP_AUDIO_STREAM_POP_RETRY_SPIN_GUARDED", 48, 0, 1200),
            critical_spins: env_u32("PMP_AUDIO_STREAM_POP_RETRY_SPIN_CRITICAL", 96, 0, 1600),
        }
    }
}

static UNDERRUN_MASK_POLICY: Lazy<UnderrunMaskPolicy> = Lazy::new(UnderrunMaskPolicy::from_env);
static STREAMING_POP_RETRY_POLICY: Lazy<StreamingPopRetryPolicy> =
    Lazy::new(StreamingPopRetryPolicy::from_env);

fn ms_to_frames(sample_rate: u32, milliseconds: u32) -> usize {
    let rate = sample_rate.max(8_000) as f64;
    ((rate * milliseconds as f64) / 1000.0).round().max(1.0) as usize
}

pub(crate) fn try_lock_render_queue_hot_path(render_queue: &AudioRingBuffer) {
    if !env_bool("PMP_AUDIO_LOCK_RENDER_QUEUE", true) {
        return;
    }

    if render_queue.try_lock_memory_pages() {
        RENDER_QUEUE_PAGE_LOCK_SUCCESS.fetch_add(1, Ordering::Relaxed);
    } else {
        RENDER_QUEUE_PAGE_LOCK_FAILURE.fetch_add(1, Ordering::Relaxed);
        if env_bool("PMP_AUDIO_LOG_PAGE_LOCK_FAILURE", false) {
            eprintln!("[NativeAudio][buffer] Failed to page-lock render queue (best effort).");
        }
    }
}

pub(crate) fn spawn_render_transfer_worker(
    decode_reservoir: AudioRingBuffer,
    render_queue: AudioRingBuffer,
    channels: u16,
    sample_rate: u32,
    command_rx: CommandRx<TransferCommand>,
    thread_name: &str,
) -> Result<(), String> {
    let channels = channels.max(1) as usize;
    let sample_rate = sample_rate.max(1) as f64;
    let capacity = render_queue.capacity_samples().max(channels);
    let (initial_low_watermark, _) = buffer_policy::streaming_transfer_watermarks(
        capacity,
        channels,
        RealtimePressureProfile::Normal,
    );
    TRANSFER_LOW_WATERMARK_SAMPLES.store(initial_low_watermark as u64, Ordering::Relaxed);
    TRANSFER_ADAPTATION_LEVEL.store(0, Ordering::Relaxed);
    TRANSFER_OSCILLATION_STREAK.store(0, Ordering::Relaxed);

    thread::Builder::new()
        .name(thread_name.to_string())
        .spawn(move || {
            let _priority_guard =
                crate::audio::threading::promote_current_thread_for_audio_transfer();
            let mut transfer_block: Vec<f32> = Vec::with_capacity(8_192);
            let mut adaptive_state = buffer_policy::TransferAdaptiveState::default();
            let warmup_strategy = buffer_policy::adaptive_transfer_strategy(
                capacity,
                channels,
                RealtimePressureProfile::Critical,
                0,
                0,
                &mut adaptive_state,
            );
            memory_pool::reserve_f32_capacity(
                &mut transfer_block,
                warmup_strategy.chunk_limit.max(8_192),
                "streaming.transfer.block_prewarm_growth",
            );
            adaptive_state = buffer_policy::TransferAdaptiveState::default();
            let burst_policy = BurstFillPolicy::from_env();
            let mut burst_loops_remaining = 0u32;
            let mut starvation_hits = 0u32;

            loop {
                if transfer_should_shutdown(&command_rx) {
                    render_queue.mark_finished();
                    TRANSFER_ADAPTATION_LEVEL.store(0, Ordering::Relaxed);
                    TRANSFER_OSCILLATION_STREAK.store(0, Ordering::Relaxed);
                    break;
                }

                let render_len = render_queue.len_samples();
                let decode_len = decode_reservoir.len_samples();
                let buffered_ahead_seconds =
                    (render_len as f64) / (sample_rate * (channels as f64).max(1.0));

                let current_profile = crate::audio::realtime_scheduler::SCHEDULER.profile();
                let (hint_low_watermark, _) = buffer_policy::streaming_transfer_watermarks(
                    capacity,
                    channels,
                    current_profile,
                );
                let recovery_hint =
                    render_len <= hint_low_watermark || decode_len <= hint_low_watermark;
                let profile = crate::audio::realtime_scheduler::SCHEDULER
                    .update(buffered_ahead_seconds, recovery_hint);

                let strategy = buffer_policy::adaptive_transfer_strategy(
                    capacity,
                    channels,
                    profile,
                    render_len,
                    decode_len,
                    &mut adaptive_state,
                );

                let low_watermark = strategy.low_watermark;
                let high_watermark = strategy.high_watermark;

                let starving = render_len <= low_watermark || decode_len <= low_watermark;
                if burst_policy.enabled {
                    if starving {
                        starvation_hits = starvation_hits.saturating_add(1);
                    } else {
                        starvation_hits = starvation_hits.saturating_sub(1);
                    }

                    if starvation_hits >= burst_policy.enter_hits {
                        burst_loops_remaining = burst_policy.hold_loops.max(1);
                        starvation_hits = 0;
                    }
                } else {
                    starvation_hits = 0;
                    burst_loops_remaining = 0;
                }

                let burst_active = burst_loops_remaining > 0;
                if burst_loops_remaining > 0 {
                    burst_loops_remaining = burst_loops_remaining.saturating_sub(1);
                }

                TRANSFER_LOW_WATERMARK_SAMPLES.store(low_watermark as u64, Ordering::Relaxed);
                TRANSFER_ADAPTATION_LEVEL
                    .store(strategy.adaptation_level as u64, Ordering::Relaxed);
                TRANSFER_OSCILLATION_STREAK
                    .store(strategy.oscillation_streak as u64, Ordering::Relaxed);
                crate::audio::threading::apply_audio_transfer_pressure_profile(profile);
                let chunk_limit = if burst_active {
                    let boosted = (strategy.chunk_limit as u128).saturating_mul(
                        (100u128).saturating_add(burst_policy.chunk_boost_percent as u128),
                    ) / 100u128;
                    (boosted as usize).clamp(channels, capacity)
                } else {
                    strategy.chunk_limit
                };
                let wait_timeout = if burst_active {
                    Duration::ZERO
                } else {
                    buffer_policy::source_pop_wait_timeout(profile)
                };
                let backoff = if burst_active {
                    Duration::ZERO
                } else {
                    strategy.producer_backoff
                };
                let decode_idle_backoff = strategy.decode_idle_backoff;

                if decode_reservoir.is_finished_and_empty() {
                    // Keep the transfer worker alive even after end-of-stream so a subsequent
                    // interactive seek can clear the reservoir and resume playback without
                    // forcing a full pipeline rebuild.
                    render_queue.mark_finished();
                    thread::sleep(decode_idle_backoff);
                    continue;
                }

                if render_len >= high_watermark {
                    if backoff.is_zero() {
                        thread::yield_now();
                    } else {
                        thread::sleep(backoff);
                    }
                    continue;
                }

                if render_len <= low_watermark {
                    TRANSFER_RENDER_LOW_HIT_COUNT.fetch_add(1, Ordering::Relaxed);
                    diagnostics::record_event_throttled(
                        "shared.transfer.render_low_watermark",
                        render_len as u64,
                        low_watermark as u64,
                        &TRANSFER_RENDER_LOW_TIMELINE_GATE_MS,
                        180,
                    );
                }

                if decode_len <= low_watermark {
                    TRANSFER_DECODE_LOW_HIT_COUNT.fetch_add(1, Ordering::Relaxed);
                    diagnostics::record_event_throttled(
                        "shared.transfer.decode_low_watermark",
                        decode_len as u64,
                        low_watermark as u64,
                        &TRANSFER_DECODE_LOW_TIMELINE_GATE_MS,
                        180,
                    );
                }

                let mut target_samples = transfer_target_samples(
                    render_len,
                    low_watermark,
                    high_watermark,
                    chunk_limit,
                    channels,
                    profile,
                );
                if burst_active {
                    let burst_headroom = capacity.saturating_sub(render_len).max(channels);
                    target_samples = target_samples.max(burst_headroom.min(chunk_limit));
                }

                let transfer = decode_reservoir.pop_chunk_into(
                    &mut transfer_block,
                    target_samples,
                    wait_timeout,
                );

                if transfer.popped > 0 {
                    let frames = transfer.popped / channels;
                    if frames > 0 {
                        let samples_to_push = frames * channels;
                        let mut start = 0usize;
                        while start < samples_to_push {
                            if transfer_should_shutdown(&command_rx) {
                                render_queue.mark_finished();
                                return;
                            }

                            let pushed_frames = render_queue.push_interleaved(
                                &transfer_block[start..samples_to_push],
                                channels,
                            );
                            if pushed_frames == 0 {
                                if backoff.is_zero() {
                                    thread::yield_now();
                                } else {
                                    thread::sleep(backoff);
                                }
                                continue;
                            }
                            start = start.saturating_add(pushed_frames * channels);
                        }
                    }
                }

                if transfer.finished && decode_reservoir.is_finished_and_empty() {
                    // Keep transfer worker alive across EOS so subsequent seek/restart commands can
                    // refill the render queue without requiring a full pipeline rebuild.
                    render_queue.mark_finished();
                    thread::sleep(decode_idle_backoff);
                    continue;
                }

                if transfer.popped == 0 {
                    if backoff.is_zero() {
                        thread::yield_now();
                    } else {
                        thread::sleep(backoff);
                    }
                }
            }
        })
        .map(|_| ())
        .map_err(|err| format!("Failed to spawn transfer worker: {err}"))
}

pub(crate) enum DecoderCommand {
    Seek(f64),
    Shutdown,
}

impl ControlCommand for DecoderCommand {
    fn priority(&self) -> ControlCommandPriority {
        match self {
            Self::Shutdown => ControlCommandPriority::Critical,
            Self::Seek(_) => ControlCommandPriority::Coalescable,
        }
    }
}

pub(crate) enum TransferCommand {
    Shutdown,
}

impl ControlCommand for TransferCommand {
    fn priority(&self) -> ControlCommandPriority {
        match self {
            Self::Shutdown => ControlCommandPriority::Critical,
        }
    }
}

#[inline]
fn transfer_should_shutdown(command_rx: &CommandRx<TransferCommand>) -> bool {
    match command_rx.try_recv() {
        Ok(TransferCommand::Shutdown) | Err(CommandTryRecvError::Disconnected) => true,
        Err(CommandTryRecvError::Empty) => false,
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct DrainedDecoderCommands {
    pub shutdown: bool,
    pub seek_target: Option<f64>,
}

pub(crate) fn drain_decoder_commands(
    command_rx: &CommandRx<DecoderCommand>,
) -> DrainedDecoderCommands {
    let mut result = DrainedDecoderCommands::default();

    loop {
        match command_rx.try_recv() {
            Ok(DecoderCommand::Shutdown) => {
                result.shutdown = true;
                result.seek_target = None;
                return result;
            }
            Ok(DecoderCommand::Seek(target)) => {
                result.seek_target = Some(target);
            }
            Err(CommandTryRecvError::Empty) => break,
            Err(CommandTryRecvError::Disconnected) => {
                result.shutdown = true;
                result.seek_target = None;
                return result;
            }
        }
    }

    result
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

fn streaming_pop_retry_attempts(profile: RealtimePressureProfile, underrun_streak: u32) -> u32 {
    let policy = *STREAMING_POP_RETRY_POLICY;
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

fn streaming_pop_retry_spins(profile: RealtimePressureProfile) -> u32 {
    let policy = *STREAMING_POP_RETRY_POLICY;
    match profile {
        RealtimePressureProfile::Normal => policy.normal_spins,
        RealtimePressureProfile::Guarded => policy.guarded_spins,
        RealtimePressureProfile::Critical => policy.critical_spins,
    }
}

#[cfg(test)]
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

#[derive(Clone)]
pub(crate) struct StreamingSamplesSource {
    render_queue: AudioRingBuffer,
    channels: u16,
    sample_rate: u32,
    duration: f64,
    observed_render_epoch: u64,
    local: Vec<f32>,
    local_index: usize,
    channel_cursor: usize,
    previous_samples: Vec<f32>,
    last_samples: Vec<f32>,
    needs_fade_in: bool,
    pending_fade_in_frames: usize,
    underrun_streak: u32,
    local_is_concealment: bool,
    has_recent_real_audio: bool,
}

impl StreamingSamplesSource {
    const CHUNK_SAMPLES: usize = 8192;

    pub fn new(
        render_queue: AudioRingBuffer,
        channels: u16,
        sample_rate: u32,
        duration: f64,
    ) -> Self {
        let channels = channels.max(1);
        let observed_render_epoch = render_queue.clear_epoch();
        Self {
            render_queue,
            channels,
            sample_rate: sample_rate.max(1),
            duration,
            observed_render_epoch,
            local: Vec::with_capacity(Self::CHUNK_SAMPLES),
            local_index: 0,
            channel_cursor: 0,
            previous_samples: vec![0.0; channels as usize],
            last_samples: vec![0.0; channels as usize],
            needs_fade_in: false,
            pending_fade_in_frames: 0,
            underrun_streak: 0,
            local_is_concealment: false,
            has_recent_real_audio: false,
        }
    }

    fn reset_after_discontinuity(&mut self) {
        self.local.clear();
        self.local_index = 0;
        self.channel_cursor = 0;
        self.previous_samples.fill(0.0);
        self.last_samples.fill(0.0);
        self.needs_fade_in = false;
        self.pending_fade_in_frames = 0;
        self.underrun_streak = 0;
        self.local_is_concealment = false;
        self.has_recent_real_audio = false;
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
}

impl Iterator for StreamingSamplesSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let current_epoch = self.render_queue.clear_epoch();
        if current_epoch != self.observed_render_epoch {
            self.observed_render_epoch = current_epoch;
            self.reset_after_discontinuity();
        }

        if self.local_index >= self.local.len() {
            let channels = self.channels.max(1) as usize;
            let profile = crate::audio::realtime_scheduler::SCHEDULER.profile();
            let mut result = self.render_queue.pop_chunk_into(
                &mut self.local,
                Self::CHUNK_SAMPLES,
                buffer_policy::source_pop_wait_timeout(profile),
            );
            let retry_attempts =
                streaming_pop_retry_attempts(profile, self.underrun_streak.saturating_add(1))
                    .max(1);
            let retry_spins = streaming_pop_retry_spins(profile);
            for _ in 1..retry_attempts {
                if result.popped > 0 || result.finished {
                    break;
                }
                for _ in 0..retry_spins {
                    std::hint::spin_loop();
                }
                result = self.render_queue.pop_chunk_into(
                    &mut self.local,
                    Self::CHUNK_SAMPLES,
                    Duration::ZERO,
                );
            }
            self.local_index = 0;

            if result.popped == 0 {
                if result.finished {
                    return None;
                }

                self.underrun_streak = self.underrun_streak.saturating_add(1);
                let silence_frames = adaptive_underrun_silence_frames(
                    crate::audio::realtime_scheduler::SCHEDULER.profile(),
                    self.underrun_streak,
                    self.sample_rate,
                );

                STREAMING_UNDERRUN_EVENTS.fetch_add(1, Ordering::Relaxed);
                STREAMING_UNDERRUN_FRAMES.fetch_add(silence_frames as u64, Ordering::Relaxed);
                diagnostics::record_event_throttled(
                    "shared.output.render_underrun",
                    silence_frames as u64,
                    channels as u64,
                    &STREAMING_UNDERRUN_TIMELINE_GATE_MS,
                    120,
                );

                self.needs_fade_in = true;
                self.pending_fade_in_frames = silence_frames;
                let silence_samples = (silence_frames * channels).max(1);
                self.local.resize(silence_samples, 0.0);

                if self.underrun_streak == 1 && self.has_recent_real_audio {
                    for frame in 0..silence_frames {
                        let gain = equal_power_fade_out_gain(frame, silence_frames);
                        let base = frame * channels;
                        for channel in 0..channels {
                            self.local[base + channel] = self.last_samples[channel] * gain;
                        }
                    }
                }
                self.local_is_concealment = true;
            } else if self.needs_fade_in {
                self.underrun_streak = 0;
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
                self.local_is_concealment = false;
                self.has_recent_real_audio = true;
            } else {
                self.underrun_streak = 0;
                self.local_is_concealment = false;
                self.has_recent_real_audio = true;
            }
        }

        let sample_index = self.local_index;
        let sample = self.local[sample_index];
        self.local_index += 1;
        if !self.local_is_concealment {
            self.track_sample_history(sample);
        }
        Some(sample)
    }
}

impl BulkSource for StreamingSamplesSource {
    fn fill_buffer(&mut self, buf: &mut [f32]) -> usize {
        let mut written = 0usize;
        while written < buf.len() {
            if self.local_index >= self.local.len() {
                let Some(sample) = self.next() else {
                    break;
                };
                buf[written] = sample;
                written += 1;
                continue;
            }

            let available = self.local.len().saturating_sub(self.local_index);
            let to_copy = available.min(buf.len().saturating_sub(written));
            let start = self.local_index;
            let end = start + to_copy;
            buf[written..written + to_copy].copy_from_slice(&self.local[start..end]);
            self.local_index = end;

            if !self.local_is_concealment {
                for &sample in &buf[written..written + to_copy] {
                    self.track_sample_history(sample);
                }
            }

            written += to_copy;
        }
        written
    }
}

impl Source for StreamingSamplesSource {
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
        if self.duration > 0.0 {
            Some(Duration::from_secs_f64(self.duration))
        } else {
            None
        }
    }
}

#[derive(Clone)]
pub(crate) struct SharedSamplesSource {
    samples: Arc<Vec<f32>>,
    channels: u16,
    sample_rate: u32,
    position: usize,
}

impl SharedSamplesSource {
    pub fn new(samples: Arc<Vec<f32>>, channels: u16, sample_rate: u32, position: usize) -> Self {
        Self {
            samples,
            channels,
            sample_rate,
            position,
        }
    }

    fn compute_total_duration(&self) -> Option<Duration> {
        let channels = self.channels as usize;
        if channels == 0 || self.sample_rate == 0 {
            return None;
        }
        let frames = self.samples.len() / channels;
        Some(Duration::from_secs_f64(
            frames as f64 / self.sample_rate as f64,
        ))
    }
}

impl Iterator for SharedSamplesSource {
    type Item = f32;
    fn next(&mut self) -> Option<Self::Item> {
        if self.position >= self.samples.len() {
            return None;
        }
        let out = self.samples[self.position];
        self.position += 1;
        Some(out)
    }
}

impl Source for SharedSamplesSource {
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
        self.compute_total_duration()
    }
}

impl BulkSource for SharedSamplesSource {
    fn fill_buffer(&mut self, buf: &mut [f32]) -> usize {
        if self.position >= self.samples.len() {
            return 0;
        }

        let available = self.samples.len().saturating_sub(self.position);
        let to_copy = available.min(buf.len());
        let end = self.position + to_copy;
        buf[..to_copy].copy_from_slice(&self.samples[self.position..end]);
        self.position = end;
        to_copy
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_samples_source_bulk_fill_matches_samples() {
        let samples = Arc::new(vec![0.1f32, -0.2, 0.3, -0.4, 0.5]);
        let mut source = SharedSamplesSource::new(samples.clone(), 1, 48_000, 0);
        let mut out = vec![0.0f32; samples.len()];

        let filled = source.fill_buffer(&mut out);

        assert_eq!(filled, samples.len());
        assert_eq!(out, *samples);
        assert_eq!(source.fill_buffer(&mut out), 0);
    }

    #[test]
    fn streaming_samples_source_bulk_fill_reads_render_queue() {
        let render_queue = AudioRingBuffer::new(512);
        let samples = vec![0.1f32, -0.1, 0.2, -0.2, 0.3, -0.3, 0.4, -0.4];
        let pushed = render_queue.push_interleaved(&samples, 2);
        assert_eq!(pushed * 2, samples.len());
        render_queue.mark_finished();

        let mut source = StreamingSamplesSource::new(render_queue, 2, 48_000, 0.0);
        let mut out = vec![0.0f32; samples.len()];
        let filled = source.fill_buffer(&mut out);

        assert_eq!(filled, samples.len());
        assert_eq!(out, samples);
    }

    #[test]
    fn streaming_samples_source_emits_silence_until_samples_arrive_then_finishes() {
        let buffer = AudioRingBuffer::new(512);
        let render_queue = AudioRingBuffer::new(512);
        let (_transfer_tx, transfer_rx) =
            crate::audio::control_plane::command_channel::<TransferCommand>();
        spawn_render_transfer_worker(
            buffer.clone(),
            render_queue.clone(),
            2,
            48_000,
            transfer_rx,
            "test-transfer-worker",
        )
        .expect("transfer worker should start");
        let mut source = StreamingSamplesSource::new(render_queue.clone(), 2, 48_000, 0.0);

        for _ in 0..8 {
            assert_eq!(source.next(), Some(0.0));
        }

        let samples = vec![0.5f32, 0.5, 0.6, 0.6];
        let pushed = buffer.push_interleaved(&samples, 2);
        assert_eq!(pushed, 2);
        render_queue.wait_for_samples(2, Duration::from_millis(50));

        let mut saw_sample = false;
        for _ in 0..16_384 {
            let Some(value) = source.next() else {
                break;
            };
            if value.abs() > 1e-4 {
                saw_sample = true;
                break;
            }
        }
        assert!(
            saw_sample,
            "expected buffered samples to reach the consumer"
        );

        buffer.mark_finished();

        let mut finished = false;
        for _ in 0..4096 {
            if source.next().is_none() {
                finished = true;
                break;
            }
        }
        assert!(
            finished,
            "expected stream to finish after buffer is drained"
        );
    }

    #[test]
    fn streaming_samples_source_resets_history_after_render_queue_clear() {
        let render_queue = AudioRingBuffer::new(512);
        let seed = vec![0.8f32; 256];
        let pushed = render_queue.push_interleaved(&seed, 2);
        assert!(pushed > 0);

        let mut source = StreamingSamplesSource::new(render_queue.clone(), 2, 48_000, 0.0);
        let mut saw_real = false;
        for _ in 0..64 {
            if let Some(sample) = source.next() {
                if sample.abs() > 1e-3 {
                    saw_real = true;
                }
            }
        }
        assert!(saw_real, "expected to consume seeded real samples");

        render_queue.clear();

        let first_after_clear = source.next().unwrap_or(0.0);
        assert!(
            first_after_clear.abs() <= 1e-6,
            "after queue clear, concealment should restart from silence instead of stale history"
        );
    }

    #[test]
    fn drain_decoder_commands_keeps_last_seek_and_stops_on_shutdown() {
        let (tx, rx) = crate::audio::control_plane::command_channel::<DecoderCommand>();
        tx.send(DecoderCommand::Seek(1.0)).unwrap();
        tx.send(DecoderCommand::Seek(2.0)).unwrap();
        tx.send(DecoderCommand::Seek(3.5)).unwrap();

        let drained = drain_decoder_commands(&rx);
        assert!(!drained.shutdown);
        assert_eq!(drained.seek_target, Some(3.5));

        tx.send(DecoderCommand::Seek(4.0)).unwrap();
        tx.send(DecoderCommand::Shutdown).unwrap();
        tx.send(DecoderCommand::Seek(5.0)).unwrap();

        let drained = drain_decoder_commands(&rx);
        assert!(drained.shutdown);
        assert_eq!(drained.seek_target, None);
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
    fn streaming_pop_retry_attempts_scale_with_pressure_and_streak() {
        let normal = streaming_pop_retry_attempts(RealtimePressureProfile::Normal, 1);
        let guarded = streaming_pop_retry_attempts(RealtimePressureProfile::Guarded, 1);
        let critical = streaming_pop_retry_attempts(RealtimePressureProfile::Critical, 1);

        assert!(normal <= guarded);
        assert!(guarded <= critical);

        let streaked = streaming_pop_retry_attempts(RealtimePressureProfile::Critical, 9);
        assert!(streaked >= critical);
    }

    #[test]
    fn streaming_predictive_concealment_stays_finite_and_bounded() {
        for frame in 0..64 {
            let sample = predictive_concealment_sample(0.92, -0.35, frame, 64);
            assert!(sample.is_finite());
            assert!(sample <= 1.0);
            assert!(sample >= -1.0);
        }
    }

    #[test]
    fn transfer_target_samples_normal_profile_prefers_low_watermark() {
        let target = transfer_target_samples(
            97_920,
            46_080,
            103_680,
            12_288,
            2,
            RealtimePressureProfile::Normal,
        );

        assert_eq!(target, 512);
    }

    #[test]
    fn transfer_target_samples_guarded_profile_prefers_high_watermark() {
        let target = transfer_target_samples(
            97_920,
            46_080,
            103_680,
            12_288,
            2,
            RealtimePressureProfile::Guarded,
        );

        assert_eq!(target, 5_760);
    }

    #[test]
    fn transfer_target_samples_is_bounded_by_chunk_limit() {
        let target = transfer_target_samples(
            10_000,
            46_080,
            103_680,
            1_024,
            2,
            RealtimePressureProfile::Critical,
        );

        assert_eq!(target, 1_024);
    }

    #[test]
    fn transfer_worker_stays_alive_across_finished_boundary_for_seek_recovery() {
        let decode_reservoir = AudioRingBuffer::new(8_192);
        let render_queue = AudioRingBuffer::new(8_192);
        let (command_tx, command_rx) =
            crate::audio::control_plane::command_channel::<TransferCommand>();

        spawn_render_transfer_worker(
            decode_reservoir.clone(),
            render_queue.clone(),
            2,
            48_000,
            command_rx,
            "streaming-transfer-test-seek-recovery",
        )
        .expect("spawn transfer worker");

        let first = vec![0.25f32; 1_024];
        let pushed_first = decode_reservoir.push_interleaved(&first, 2);
        assert!(pushed_first > 0);
        decode_reservoir.mark_finished();

        render_queue.wait_for_samples(512, Duration::from_millis(400));
        assert!(render_queue.len_samples() > 0);

        let mut drained = Vec::new();
        let _ = render_queue.pop_chunk_into(&mut drained, 8_192, Duration::from_millis(0));

        // Simulate interactive seek: clear finished flags and push fresh decoded samples.
        decode_reservoir.clear();
        render_queue.clear();
        let second = vec![0.75f32; 1_024];
        let pushed_second = decode_reservoir.push_interleaved(&second, 2);
        assert!(pushed_second > 0);

        render_queue.wait_for_samples(512, Duration::from_millis(500));
        assert!(
            render_queue.len_samples() > 0,
            "transfer worker should keep running after EOS and forward post-seek samples"
        );

        let _ = command_tx.send(TransferCommand::Shutdown);
    }

    #[test]
    fn transfer_worker_shutdown_does_not_stall_when_render_queue_is_pressure_full() {
        let channels = 2usize;
        let decode_reservoir = AudioRingBuffer::new(8_192);
        let render_queue = AudioRingBuffer::new(2_048);
        let (command_tx, command_rx) =
            crate::audio::control_plane::command_channel::<TransferCommand>();

        // Prefill render queue near the guarded high band so min transfer quantum can exceed free
        // headroom and force partial writes in the transfer loop.
        let prefill = vec![0.0f32; 1_600];
        let prefilled = render_queue.push_interleaved(&prefill, channels);
        assert_eq!(prefilled * channels, 1_600);

        let pending = vec![0.25f32; 4_096];
        let pushed = decode_reservoir.push_interleaved(&pending, channels);
        assert!(pushed > 0);

        spawn_render_transfer_worker(
            decode_reservoir.clone(),
            render_queue.clone(),
            channels as u16,
            48_000,
            command_rx,
            "streaming-transfer-test-shutdown-liveness",
        )
        .expect("spawn transfer worker");

        std::thread::sleep(Duration::from_millis(30));
        let _ = command_tx.send(TransferCommand::Shutdown);

        let deadline = std::time::Instant::now() + Duration::from_millis(300);
        let mut finished_in_time = false;
        while std::time::Instant::now() < deadline {
            if render_queue.is_finished() {
                finished_in_time = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }

        // Best-effort cleanup in case of regressions to avoid leaking a running thread in tests.
        if !finished_in_time {
            render_queue.clear();
            let _ = command_tx.send(TransferCommand::Shutdown);
            std::thread::sleep(Duration::from_millis(80));
        }

        assert!(
            finished_in_time,
            "transfer worker should honor shutdown even under render-queue backpressure"
        );
    }
}
