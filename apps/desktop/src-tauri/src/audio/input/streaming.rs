use std::cell::UnsafeCell;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use rodio::Source;

static STREAMING_UNDERRUN_EVENTS: AtomicU64 = AtomicU64::new(0);
static STREAMING_UNDERRUN_FRAMES: AtomicU64 = AtomicU64::new(0);

pub(crate) fn streaming_underrun_stats() -> (u64, u64) {
    (
        STREAMING_UNDERRUN_EVENTS.load(Ordering::Relaxed),
        STREAMING_UNDERRUN_FRAMES.load(Ordering::Relaxed),
    )
}

#[derive(Clone)]
pub(crate) struct AudioRingBuffer {
    inner: Arc<AudioRingBufferInner>,
}

struct AudioRingBufferInner {
    capacity: usize,
    data_ptr: *mut f32,
    _data: UnsafeCell<Box<[f32]>>,
    read_pos: AtomicU64,
    write_pos: AtomicU64,
    finished: AtomicBool,
    wait_lock: Mutex<()>,
    available: Condvar,
    space: Condvar,
}

unsafe impl Send for AudioRingBufferInner {}
unsafe impl Sync for AudioRingBufferInner {}

#[derive(Clone, Copy, Debug)]
struct PopChunkResult {
    popped: usize,
    finished: bool,
}

impl AudioRingBuffer {
    pub fn new(capacity: usize) -> Self {
        let capacity = capacity.max(1);
        let mut data = vec![0.0f32; capacity].into_boxed_slice();
        let data_ptr = data.as_mut_ptr();

        Self {
            inner: Arc::new(AudioRingBufferInner {
                capacity,
                data_ptr,
                _data: UnsafeCell::new(data),
                read_pos: AtomicU64::new(0),
                write_pos: AtomicU64::new(0),
                finished: AtomicBool::new(false),
                wait_lock: Mutex::new(()),
                available: Condvar::new(),
                space: Condvar::new(),
            }),
        }
    }

    pub fn recommended_capacity_samples(sample_rate: Option<u32>, channels: u16) -> usize {
        const DEFAULT_SAMPLE_RATE: u32 = 44_100;
        const TARGET_SECONDS: u64 = 4;
        const MIN_SAMPLES: u64 = 32_768;
        const MAX_SAMPLES: u64 = 8_000_000;

        let sample_rate = sample_rate.unwrap_or(DEFAULT_SAMPLE_RATE).max(1) as u64;
        let channels = channels.max(1) as u64;
        sample_rate
            .saturating_mul(TARGET_SECONDS)
            .saturating_mul(channels)
            .clamp(MIN_SAMPLES, MAX_SAMPLES) as usize
    }

    pub fn clear(&self) {
        let write = self.inner.write_pos.load(Ordering::Acquire);
        self.inner.read_pos.store(write, Ordering::Release);
        self.inner.finished.store(false, Ordering::Release);
        self.inner.space.notify_all();
    }

    pub fn mark_finished(&self) {
        self.inner.finished.store(true, Ordering::Release);
        self.inner.available.notify_all();
    }

    pub fn len_samples(&self) -> usize {
        let read = self.inner.read_pos.load(Ordering::Acquire);
        let write = self.inner.write_pos.load(Ordering::Acquire);
        (write.saturating_sub(read) as usize).min(self.inner.capacity)
    }

    pub fn capacity_samples(&self) -> usize {
        self.inner.capacity
    }

    pub fn wait_for_samples(&self, min_samples: usize, timeout: Duration) {
        if min_samples == 0 {
            return;
        }

        let mut guard = self
            .inner
            .wait_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        while self.len_samples() < min_samples && !self.inner.finished.load(Ordering::Acquire) {
            let (next, wait_result) = match self.inner.available.wait_timeout(guard, timeout) {
                Ok(value) => value,
                Err(poisoned) => poisoned.into_inner(),
            };
            guard = next;
            if wait_result.timed_out() {
                break;
            }
        }
    }

    fn pop_chunk_into(
        &self,
        out: &mut Vec<f32>,
        max_samples: usize,
        wait_timeout: Duration,
    ) -> PopChunkResult {
        out.clear();

        if max_samples == 0 {
            return PopChunkResult {
                popped: 0,
                finished: self.is_finished_and_empty(),
            };
        }

        if !wait_timeout.is_zero()
            && self.len_samples() == 0
            && !self.inner.finished.load(Ordering::Acquire)
        {
            let guard = self
                .inner
                .wait_lock
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let _ = self.inner.available.wait_timeout(guard, wait_timeout);
        }

        let read = self.inner.read_pos.load(Ordering::Acquire);
        let write = self.inner.write_pos.load(Ordering::Acquire);
        let available = write.saturating_sub(read) as usize;
        if available == 0 {
            return PopChunkResult {
                popped: 0,
                finished: self.inner.finished.load(Ordering::Acquire),
            };
        }

        let count = available.min(max_samples).min(self.inner.capacity);
        if out.capacity() < count {
            out.reserve(count.saturating_sub(out.len()));
        }

        unsafe {
            out.set_len(count);
            let dst = out.as_mut_ptr();
            let start = (read as usize) % self.inner.capacity;
            let first = (self.inner.capacity - start).min(count);
            ptr::copy_nonoverlapping(self.inner.data_ptr.add(start), dst, first);
            if first < count {
                ptr::copy_nonoverlapping(self.inner.data_ptr, dst.add(first), count - first);
            }
        }

        let new_read = read.saturating_add(count as u64);
        self.inner.read_pos.store(new_read, Ordering::Release);
        self.inner.space.notify_all();

        let finished = self.inner.finished.load(Ordering::Acquire)
            && self.inner.write_pos.load(Ordering::Acquire) == new_read;

        PopChunkResult {
            popped: count,
            finished,
        }
    }

    pub fn is_finished_and_empty(&self) -> bool {
        self.inner.finished.load(Ordering::Acquire) && self.len_samples() == 0
    }

    pub fn push_interleaved(&self, samples: &[f32], channels: usize) -> usize {
        if channels == 0 {
            return 0;
        }
        let total_frames = samples.len() / channels;
        if total_frames == 0 {
            return 0;
        }

        let mut waited = false;

        loop {
            let read = self.inner.read_pos.load(Ordering::Acquire);
            let write = self.inner.write_pos.load(Ordering::Acquire);
            let used = write.saturating_sub(read) as usize;
            let free_samples = self.inner.capacity.saturating_sub(used);
            let free_frames = free_samples / channels;
            if free_frames == 0 {
                if waited {
                    return 0;
                }
                waited = true;
                let guard = self
                    .inner
                    .wait_lock
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                let _ = self
                    .inner
                    .space
                    .wait_timeout(guard, Duration::from_millis(10));
                continue;
            }

            let frames_to_push = free_frames.min(total_frames);
            let samples_to_push = frames_to_push * channels;
            if samples_to_push == 0 {
                return 0;
            }

            unsafe {
                let start = (write as usize) % self.inner.capacity;
                let first = (self.inner.capacity - start).min(samples_to_push);
                ptr::copy_nonoverlapping(samples.as_ptr(), self.inner.data_ptr.add(start), first);
                if first < samples_to_push {
                    ptr::copy_nonoverlapping(
                        samples.as_ptr().add(first),
                        self.inner.data_ptr,
                        samples_to_push - first,
                    );
                }
            }

            self.inner.write_pos.store(
                write.saturating_add(samples_to_push as u64),
                Ordering::Release,
            );
            self.inner.available.notify_all();
            return frames_to_push;
        }
    }
}

pub(crate) struct StreamingPlayback {
    pub buffer: AudioRingBuffer,
    pub command_tx: mpsc::Sender<DecoderCommand>,
    pub error: Arc<Mutex<Option<String>>>,
}

pub(crate) enum DecoderCommand {
    Seek(f64),
    Shutdown,
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct DrainedDecoderCommands {
    pub shutdown: bool,
    pub seek_target: Option<f64>,
}

pub(crate) fn drain_decoder_commands(command_rx: &mpsc::Receiver<DecoderCommand>) -> DrainedDecoderCommands {
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
    buffer: AudioRingBuffer,
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

    pub fn new(buffer: AudioRingBuffer, channels: u16, sample_rate: u32, duration: f64) -> Self {
        let channels = channels.max(1);
        Self {
            buffer,
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
            let result = self.buffer.pop_chunk_into(
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
    fn ring_buffer_pop_chunk_into_preserves_order_and_reports_finished() {
        let buffer = AudioRingBuffer::new(64);
        let channels = 1usize;
        let input = (0..10usize).map(|i| i as f32).collect::<Vec<_>>();

        let pushed = buffer.push_interleaved(&input, channels);
        assert_eq!(pushed, 10);

        let mut out = Vec::with_capacity(16);
        let result = buffer.pop_chunk_into(&mut out, 4, Duration::from_millis(0));
        assert_eq!(result.popped, 4);
        assert!(!result.finished);
        assert_eq!(out, vec![0.0, 1.0, 2.0, 3.0]);

        buffer.mark_finished();

        out.clear();
        let result = buffer.pop_chunk_into(&mut out, 32, Duration::from_millis(0));
        assert_eq!(result.popped, 6);
        assert!(result.finished);
        assert_eq!(out, vec![4.0, 5.0, 6.0, 7.0, 8.0, 9.0]);

        out.clear();
        let result = buffer.pop_chunk_into(&mut out, 32, Duration::from_millis(0));
        assert_eq!(result.popped, 0);
        assert!(result.finished);
        assert!(out.is_empty());
    }

    #[test]
    fn streaming_samples_source_emits_silence_until_samples_arrive_then_finishes() {
        let buffer = AudioRingBuffer::new(512);
        let mut source = StreamingSamplesSource::new(buffer.clone(), 2, 48_000, 0.0);

        for _ in 0..8 {
            assert_eq!(source.next(), Some(0.0));
        }

        let samples = vec![0.5f32, 0.5, 0.6, 0.6];
        let pushed = buffer.push_interleaved(&samples, 2);
        assert_eq!(pushed, 2);

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
        assert!(saw_sample, "expected buffered samples to reach the consumer");

        buffer.mark_finished();

        let mut finished = false;
        for _ in 0..4096 {
            if source.next().is_none() {
                finished = true;
                break;
            }
        }
        assert!(finished, "expected stream to finish after buffer is drained");
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

