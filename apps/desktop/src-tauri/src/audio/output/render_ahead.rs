use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use rodio::Source;

use crate::audio::buffer::AudioRingBuffer;
use crate::audio::diagnostics;
use crate::audio::realtime_scheduler::RealtimePressureProfile;

use super::BoxedSource;

static SHARED_RENDER_UNDERRUN_EVENTS: AtomicU64 = AtomicU64::new(0);
static SHARED_RENDER_UNDERRUN_FRAMES: AtomicU64 = AtomicU64::new(0);
static SHARED_RENDER_LOW_HIT_COUNT: AtomicU64 = AtomicU64::new(0);
static SHARED_RENDER_LOW_WATERMARK_SAMPLES: AtomicU64 = AtomicU64::new(0);
static SHARED_RENDER_LOW_TIMELINE_GATE_MS: AtomicU64 = AtomicU64::new(0);
static SHARED_RENDER_UNDERRUN_TIMELINE_GATE_MS: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct SharedRenderAheadMetricsSnapshot {
    pub render_underrun_events: u64,
    pub render_underrun_frames: u64,
    pub render_low_hit_count: u64,
    pub render_low_watermark_samples: u64,
}

pub(crate) fn shared_render_ahead_metrics() -> SharedRenderAheadMetricsSnapshot {
    SharedRenderAheadMetricsSnapshot {
        render_underrun_events: SHARED_RENDER_UNDERRUN_EVENTS.load(Ordering::Relaxed),
        render_underrun_frames: SHARED_RENDER_UNDERRUN_FRAMES.load(Ordering::Relaxed),
        render_low_hit_count: SHARED_RENDER_LOW_HIT_COUNT.load(Ordering::Relaxed),
        render_low_watermark_samples: SHARED_RENDER_LOW_WATERMARK_SAMPLES.load(Ordering::Relaxed),
    }
}

#[cfg(test)]
fn reset_shared_render_ahead_metrics() {
    SHARED_RENDER_UNDERRUN_EVENTS.store(0, Ordering::Relaxed);
    SHARED_RENDER_UNDERRUN_FRAMES.store(0, Ordering::Relaxed);
    SHARED_RENDER_LOW_HIT_COUNT.store(0, Ordering::Relaxed);
    SHARED_RENDER_LOW_WATERMARK_SAMPLES.store(0, Ordering::Relaxed);
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

fn producer_chunk_samples(profile: RealtimePressureProfile) -> usize {
    match profile {
        RealtimePressureProfile::Normal => 8192,
        RealtimePressureProfile::Guarded => 12288,
        RealtimePressureProfile::Critical => 16384,
    }
}

fn producer_backoff_duration(profile: RealtimePressureProfile) -> Duration {
    match profile {
        RealtimePressureProfile::Normal => Duration::from_millis(1),
        RealtimePressureProfile::Guarded => Duration::from_millis(0),
        RealtimePressureProfile::Critical => Duration::from_millis(0),
    }
}

fn render_pop_wait_timeout(profile: RealtimePressureProfile) -> Duration {
    let _ = profile;
    Duration::from_millis(0)
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
        parse_env_seconds("PMP_AUDIO_SHARED_RENDER_AHEAD_SECONDS", 1.8, 0.3, 6.0);
    let prebuffer_samples =
        ((sample_rate as f64) * (channels as f64) * prebuffer_seconds).ceil() as usize;
    let capacity_samples = prebuffer_samples.clamp(16_384, 2_000_000);

    let queue = AudioRingBuffer::new(capacity_samples.max(channels as usize * 256));
    queue.try_lock_memory_pages();

    SHARED_RENDER_LOW_WATERMARK_SAMPLES.store(
        ((queue.capacity_samples() * 3) / 10).max(channels as usize * 128) as u64,
        Ordering::Relaxed,
    );

    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let producer = spawn_producer_thread(source, queue.clone(), stop_rx, seek_epoch.clone());

    let prebuffer_target_seconds = parse_env_seconds(
        "PMP_AUDIO_SHARED_RENDER_AHEAD_PREROLL_SECONDS",
        0.12,
        0.02,
        0.8,
    );
    let prebuffer_target =
        ((sample_rate as f64) * (channels as f64) * prebuffer_target_seconds).ceil() as usize;
    queue.wait_for_samples(
        prebuffer_target.max(channels as usize * 32),
        Duration::from_millis(300),
    );

    let observed_seek_epoch = seek_epoch.load(Ordering::Acquire);

    Box::new(RenderAheadSource {
        queue,
        channels,
        sample_rate,
        duration,
        seek_epoch,
        observed_seek_epoch,
        local: Vec::with_capacity(8192),
        local_index: 0,
        last_samples: vec![0.0; channels as usize],
        needs_fade_in: false,
        stop_tx: Some(stop_tx),
        producer: Some(producer),
    })
}

fn spawn_producer_thread(
    mut source: BoxedSource,
    queue: AudioRingBuffer,
    stop_rx: mpsc::Receiver<()>,
    seek_epoch: Arc<AtomicU64>,
) -> JoinHandle<()> {
    let name = "pmpm-shared-render-ahead".to_string();
    let builder = thread::Builder::new().name(name);
    let queue_for_error = queue.clone();

    builder
        .spawn(move || {
            let _priority_guard =
                crate::audio::threading::promote_current_thread_for_audio_decode();
            let channels = source.channels().max(1) as usize;
            let high_watermark = ((queue.capacity_samples() * 8) / 10)
                .max(channels * 256)
                .min(queue.capacity_samples());

            let mut block = Vec::<f32>::with_capacity(4096);
            let mut observed_seek_epoch = seek_epoch.load(Ordering::Acquire);

            loop {
                if stop_rx.try_recv().is_ok() {
                    break;
                }

                let current_epoch = seek_epoch.load(Ordering::Acquire);
                if current_epoch != observed_seek_epoch {
                    observed_seek_epoch = current_epoch;
                    queue.clear();
                    block.clear();
                }

                let profile = crate::audio::realtime_scheduler::SCHEDULER.profile();
                crate::audio::threading::apply_audio_decode_pressure_profile(profile);
                let backoff = producer_backoff_duration(profile);

                if queue.len_samples() >= high_watermark {
                    if backoff.is_zero() {
                        thread::yield_now();
                    } else {
                        thread::sleep(backoff);
                    }
                    continue;
                }

                let chunk_samples = producer_chunk_samples(profile);
                block.clear();
                let mut seek_flushed = false;
                for _ in 0..chunk_samples {
                    let current_epoch = seek_epoch.load(Ordering::Acquire);
                    if current_epoch != observed_seek_epoch {
                        observed_seek_epoch = current_epoch;
                        queue.clear();
                        block.clear();
                        seek_flushed = true;
                        break;
                    }
                    match source.next() {
                        Some(sample) => block.push(sample),
                        None => break,
                    }
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
                        break;
                    }

                    let pushed_frames = queue.push_interleaved(&block[start..], channels);
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

            queue.mark_finished();
        })
        .unwrap_or_else(|_| thread::spawn(move || queue_for_error.mark_finished()))
}

struct RenderAheadSource {
    queue: AudioRingBuffer,
    channels: u16,
    sample_rate: u32,
    duration: Option<Duration>,
    seek_epoch: Arc<AtomicU64>,
    observed_seek_epoch: u64,
    local: Vec<f32>,
    local_index: usize,
    last_samples: Vec<f32>,
    needs_fade_in: bool,
    stop_tx: Option<mpsc::Sender<()>>,
    producer: Option<JoinHandle<()>>,
}

impl RenderAheadSource {
    const POP_CHUNK_SAMPLES: usize = 4096;
    const SILENCE_FRAMES_ON_UNDERRUN: usize = 96;

    fn refill_local(&mut self) -> bool {
        let current_epoch = self.seek_epoch.load(Ordering::Acquire);
        if current_epoch != self.observed_seek_epoch {
            self.observed_seek_epoch = current_epoch;
            self.queue.clear();
            self.local.clear();
            self.local_index = 0;
            for sample in &mut self.last_samples {
                *sample = 0.0;
            }
            self.needs_fade_in = true;
        }

        self.local.clear();
        self.local_index = 0;

        let low_watermark = SHARED_RENDER_LOW_WATERMARK_SAMPLES.load(Ordering::Relaxed) as usize;
        if low_watermark > 0 && self.queue.len_samples() <= low_watermark {
            SHARED_RENDER_LOW_HIT_COUNT.fetch_add(1, Ordering::Relaxed);
            diagnostics::record_event_throttled(
                "shared.render_ahead.low_watermark",
                self.queue.len_samples() as u64,
                low_watermark as u64,
                &SHARED_RENDER_LOW_TIMELINE_GATE_MS,
                160,
            );
        }

        let pop = self.queue.pop_chunk_into(
            &mut self.local,
            Self::POP_CHUNK_SAMPLES,
            render_pop_wait_timeout(crate::audio::realtime_scheduler::SCHEDULER.profile()),
        );

        if pop.popped > 0 {
            if self.needs_fade_in {
                let channels = self.channels.max(1) as usize;
                let fade_frames =
                    (self.local.len() / channels).min(Self::SILENCE_FRAMES_ON_UNDERRUN);
                if fade_frames > 0 {
                    let denom = (fade_frames.saturating_sub(1)).max(1) as f32;
                    for frame in 0..fade_frames {
                        let gain = frame as f32 / denom;
                        let base = frame * channels;
                        for channel in 0..channels {
                            self.local[base + channel] *= gain;
                        }
                    }
                }
                self.needs_fade_in = false;
            }
            return true;
        }

        if pop.finished {
            return false;
        }

        let channels = self.channels.max(1) as usize;
        self.needs_fade_in = true;
        let silence_samples = channels * Self::SILENCE_FRAMES_ON_UNDERRUN;
        self.local.resize(silence_samples, 0.0);
        let denom = (Self::SILENCE_FRAMES_ON_UNDERRUN.saturating_sub(1)).max(1) as f32;
        for frame in 0..Self::SILENCE_FRAMES_ON_UNDERRUN {
            let gain = 1.0 - (frame as f32 / denom);
            let base = frame * channels;
            for channel in 0..channels {
                self.local[base + channel] = self.last_samples[channel] * gain;
            }
        }
        SHARED_RENDER_UNDERRUN_EVENTS.fetch_add(1, Ordering::Relaxed);
        SHARED_RENDER_UNDERRUN_FRAMES
            .fetch_add(Self::SILENCE_FRAMES_ON_UNDERRUN as u64, Ordering::Relaxed);
        diagnostics::record_event_throttled(
            "shared.render_ahead.underrun",
            Self::SILENCE_FRAMES_ON_UNDERRUN as u64,
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

        let channels = self.channels.max(1) as usize;
        let channel = sample_index % channels;
        if let Some(last) = self.last_samples.get_mut(channel) {
            *last = sample;
        }

        Some(sample)
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
    fn render_ahead_source_yields_samples() {
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
}
