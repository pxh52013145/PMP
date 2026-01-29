use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rodio::Source;

use crate::audio::buffer::AudioRingBuffer;

static STREAMING_UNDERRUN_EVENTS: AtomicU64 = AtomicU64::new(0);
static STREAMING_UNDERRUN_FRAMES: AtomicU64 = AtomicU64::new(0);

pub(crate) fn streaming_underrun_stats() -> (u64, u64) {
    (
        STREAMING_UNDERRUN_EVENTS.load(Ordering::Relaxed),
        STREAMING_UNDERRUN_FRAMES.load(Ordering::Relaxed),
    )
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

