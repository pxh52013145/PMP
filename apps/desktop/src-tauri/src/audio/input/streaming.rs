use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use rodio::Source;

use crate::audio::buffer::AudioRingBuffer;
use crate::audio::diagnostics;
use crate::audio::realtime_scheduler::RealtimePressureProfile;

static STREAMING_UNDERRUN_EVENTS: AtomicU64 = AtomicU64::new(0);
static STREAMING_UNDERRUN_FRAMES: AtomicU64 = AtomicU64::new(0);

static TRANSFER_LOW_WATERMARK_SAMPLES: AtomicU64 = AtomicU64::new(0);
static TRANSFER_RENDER_LOW_HIT_COUNT: AtomicU64 = AtomicU64::new(0);
static TRANSFER_DECODE_LOW_HIT_COUNT: AtomicU64 = AtomicU64::new(0);
static RENDER_QUEUE_PAGE_LOCK_SUCCESS: AtomicU64 = AtomicU64::new(0);
static RENDER_QUEUE_PAGE_LOCK_FAILURE: AtomicU64 = AtomicU64::new(0);
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
    pub command_tx: mpsc::Sender<DecoderCommand>,
    pub shutdown_tx: StreamingShutdownTx,
    pub error: Arc<Mutex<Option<String>>>,
}

pub(crate) fn streaming_transfer_stats() -> (u64, u64, u64, bool) {
    (
        TRANSFER_LOW_WATERMARK_SAMPLES.load(Ordering::Relaxed),
        TRANSFER_RENDER_LOW_HIT_COUNT.load(Ordering::Relaxed),
        TRANSFER_DECODE_LOW_HIT_COUNT.load(Ordering::Relaxed),
        RENDER_QUEUE_PAGE_LOCK_SUCCESS.load(Ordering::Relaxed)
            > RENDER_QUEUE_PAGE_LOCK_FAILURE.load(Ordering::Relaxed),
    )
}

#[derive(Clone)]
pub(crate) struct StreamingShutdownTx {
    decoder_tx: mpsc::Sender<DecoderCommand>,
    transfer_tx: mpsc::Sender<TransferCommand>,
}

impl StreamingShutdownTx {
    pub fn new(
        decoder_tx: mpsc::Sender<DecoderCommand>,
        transfer_tx: mpsc::Sender<TransferCommand>,
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

fn transfer_wait(profile: RealtimePressureProfile) -> Duration {
    match profile {
        RealtimePressureProfile::Normal => Duration::from_millis(2),
        RealtimePressureProfile::Guarded => Duration::from_millis(1),
        RealtimePressureProfile::Critical => Duration::from_millis(0),
    }
}

fn transfer_chunk_samples(profile: RealtimePressureProfile) -> usize {
    match profile {
        RealtimePressureProfile::Normal => 8_192,
        RealtimePressureProfile::Guarded => 12_288,
        RealtimePressureProfile::Critical => 16_384,
    }
}

fn transfer_backoff(profile: RealtimePressureProfile) -> Duration {
    match profile {
        RealtimePressureProfile::Normal => Duration::from_millis(1),
        RealtimePressureProfile::Guarded => Duration::from_millis(0),
        RealtimePressureProfile::Critical => Duration::from_millis(0),
    }
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
    command_rx: mpsc::Receiver<TransferCommand>,
    thread_name: &str,
) -> Result<(), String> {
    let channels = channels.max(1) as usize;
    let capacity = render_queue.capacity_samples().max(channels);
    let low_watermark = ((capacity * 3) / 10).max(channels * 128).min(capacity);
    let high_watermark = ((capacity * 8) / 10).max(low_watermark).min(capacity);
    TRANSFER_LOW_WATERMARK_SAMPLES.store(low_watermark as u64, Ordering::Relaxed);

    thread::Builder::new()
        .name(thread_name.to_string())
        .spawn(move || {
            let _priority_guard =
                crate::audio::threading::promote_current_thread_for_audio_transfer();
            let mut transfer_block: Vec<f32> = Vec::with_capacity(8_192);

            loop {
                match command_rx.try_recv() {
                    Ok(TransferCommand::Shutdown) | Err(mpsc::TryRecvError::Disconnected) => {
                        render_queue.mark_finished();
                        break;
                    }
                    Err(mpsc::TryRecvError::Empty) => {}
                }

                let profile = crate::audio::realtime_scheduler::SCHEDULER.profile();
                crate::audio::threading::apply_audio_transfer_pressure_profile(profile);
                let chunk_limit = transfer_chunk_samples(profile);
                let wait_timeout = transfer_wait(profile);
                let backoff = transfer_backoff(profile);

                if decode_reservoir.is_finished_and_empty() {
                    // Keep the transfer worker alive even after end-of-stream so a subsequent
                    // interactive seek can clear the reservoir and resume playback without
                    // forcing a full pipeline rebuild.
                    render_queue.mark_finished();
                    if backoff.is_zero() {
                        thread::sleep(Duration::from_millis(10));
                    } else {
                        thread::sleep(backoff.max(Duration::from_millis(5)));
                    }
                    continue;
                }

                let render_len = render_queue.len_samples();
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

                if decode_reservoir.len_samples() <= low_watermark {
                    TRANSFER_DECODE_LOW_HIT_COUNT.fetch_add(1, Ordering::Relaxed);
                    diagnostics::record_event_throttled(
                        "shared.transfer.decode_low_watermark",
                        decode_reservoir.len_samples() as u64,
                        low_watermark as u64,
                        &TRANSFER_DECODE_LOW_TIMELINE_GATE_MS,
                        180,
                    );
                }

                let target_samples = if render_len <= low_watermark {
                    high_watermark.saturating_sub(render_len)
                } else {
                    low_watermark.saturating_sub(render_len)
                }
                .max(channels)
                .min(chunk_limit);

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
                    render_queue.mark_finished();
                    break;
                }

                if transfer.popped == 0 {
                    thread::yield_now();
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

pub(crate) enum TransferCommand {
    Shutdown,
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct DrainedDecoderCommands {
    pub shutdown: bool,
    pub seek_target: Option<f64>,
}

pub(crate) fn drain_decoder_commands(
    command_rx: &mpsc::Receiver<DecoderCommand>,
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
            Err(mpsc::TryRecvError::Empty) => break,
            Err(mpsc::TryRecvError::Disconnected) => {
                result.shutdown = true;
                result.seek_target = None;
                return result;
            }
        }
    }

    result
}

#[derive(Clone)]
pub(crate) struct StreamingSamplesSource {
    render_queue: AudioRingBuffer,
    channels: u16,
    sample_rate: u32,
    duration: f64,
    local: Vec<f32>,
    local_index: usize,
    last_samples: Vec<f32>,
    needs_fade_in: bool,
}

impl StreamingSamplesSource {
    const CHUNK_SAMPLES: usize = 8192;
    const SILENCE_FRAMES: usize = 64;

    pub fn new(
        render_queue: AudioRingBuffer,
        channels: u16,
        sample_rate: u32,
        duration: f64,
    ) -> Self {
        let channels = channels.max(1);
        Self {
            render_queue,
            channels,
            sample_rate: sample_rate.max(1),
            duration,
            local: Vec::with_capacity(Self::CHUNK_SAMPLES),
            local_index: 0,
            last_samples: vec![0.0; channels as usize],
            needs_fade_in: false,
        }
    }
}

impl Iterator for StreamingSamplesSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.local_index >= self.local.len() {
            let channels = self.channels.max(1) as usize;
            let result = self.render_queue.pop_chunk_into(
                &mut self.local,
                Self::CHUNK_SAMPLES,
                Duration::from_millis(0),
            );
            self.local_index = 0;

            if result.popped == 0 {
                if result.finished {
                    return None;
                }

                STREAMING_UNDERRUN_EVENTS.fetch_add(1, Ordering::Relaxed);
                STREAMING_UNDERRUN_FRAMES.fetch_add(Self::SILENCE_FRAMES as u64, Ordering::Relaxed);
                diagnostics::record_event_throttled(
                    "shared.output.render_underrun",
                    Self::SILENCE_FRAMES as u64,
                    channels as u64,
                    &STREAMING_UNDERRUN_TIMELINE_GATE_MS,
                    120,
                );

                self.needs_fade_in = true;
                let silence_frames = Self::SILENCE_FRAMES.max(1);
                let silence_samples = (silence_frames * channels).max(1);
                self.local.resize(silence_samples, 0.0);

                let denom = (silence_frames.saturating_sub(1)).max(1) as f32;
                for frame in 0..silence_frames {
                    let gain = 1.0 - (frame as f32 / denom);
                    let base = frame * channels;
                    for channel in 0..channels {
                        self.local[base + channel] = self.last_samples[channel] * gain;
                    }
                }
            } else if self.needs_fade_in {
                let fade_frames = (self.local.len() / channels).min(Self::SILENCE_FRAMES);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streaming_samples_source_emits_silence_until_samples_arrive_then_finishes() {
        let buffer = AudioRingBuffer::new(512);
        let render_queue = AudioRingBuffer::new(512);
        let (_transfer_tx, transfer_rx) = mpsc::channel::<TransferCommand>();
        spawn_render_transfer_worker(
            buffer.clone(),
            render_queue.clone(),
            2,
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
        for _ in 0..1024 {
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
    fn drain_decoder_commands_keeps_last_seek_and_stops_on_shutdown() {
        let (tx, rx) = mpsc::channel::<DecoderCommand>();
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
}
