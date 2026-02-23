use std::sync::mpsc;

use rodio::source::UniformSourceIterator;
use rodio::Source;

use crate::audio::bulk_source::BulkSource;
use crate::audio::input::StreamingShutdownTx;
use crate::audio::output::BoxedSource;

pub(crate) enum MixerCommand {
    CrossfadeTo {
        next: BoxedSource,
        old_shutdown_tx: Option<StreamingShutdownTx>,
        duration_frames: u64,
    },
    CancelCrossfade,
}

#[derive(Clone)]
pub(crate) struct PlaybackMixerController {
    tx: mpsc::Sender<MixerCommand>,
}

impl PlaybackMixerController {
    pub(crate) fn crossfade_to(
        &self,
        next: BoxedSource,
        old_shutdown_tx: Option<StreamingShutdownTx>,
        duration_frames: u64,
    ) -> Result<(), String> {
        self.tx
            .send(MixerCommand::CrossfadeTo {
                next,
                old_shutdown_tx,
                duration_frames,
            })
            .map_err(|_| "Playback mixer is unavailable".to_string())
    }

    pub(crate) fn cancel_crossfade(&self) {
        let _ = self.tx.send(MixerCommand::CancelCrossfade);
    }
}

pub(crate) fn coerce_source_format(
    source: BoxedSource,
    target_channels: u16,
    target_sample_rate: u32,
) -> BoxedSource {
    let target_channels = target_channels.max(1);
    let target_sample_rate = target_sample_rate.max(1);

    let current_channels = source.channels().max(1);
    let current_rate = source.sample_rate().max(1);

    if current_channels == target_channels && current_rate == target_sample_rate {
        return source;
    }

    Box::new(UniformSourceIterator::<BoxedSource, f32>::new(
        source,
        target_channels,
        target_sample_rate,
    ))
}

struct ActiveCrossfade {
    next: BoxedSource,
    old_shutdown_tx: Option<StreamingShutdownTx>,
    frames_total: u64,
    frame_pos: u64,
}

pub(crate) struct PlaybackMixerSource {
    rx: mpsc::Receiver<MixerCommand>,
    channels: u16,
    sample_rate: u32,
    current: BoxedSource,
    crossfade: Option<ActiveCrossfade>,
    local: Vec<f32>,
    local_index: usize,
    frame_channel: u16,
    current_gain: f32,
    next_gain: f32,
}

impl PlaybackMixerSource {
    const CHUNK_SAMPLES: usize = 4096;

    pub(crate) fn new(
        current: BoxedSource,
        channels: u16,
        sample_rate: u32,
    ) -> (PlaybackMixerController, Self) {
        let (tx, rx) = mpsc::channel();
        let controller = PlaybackMixerController { tx };

        (
            controller,
            Self {
                rx,
                channels: channels.max(1),
                sample_rate: sample_rate.max(1),
                current,
                crossfade: None,
                local: Vec::with_capacity(Self::CHUNK_SAMPLES),
                local_index: 0,
                frame_channel: 0,
                current_gain: 1.0,
                next_gain: 0.0,
            },
        )
    }

    fn poll_commands(&mut self) {
        loop {
            match self.rx.try_recv() {
                Ok(MixerCommand::CancelCrossfade) => self.finish_crossfade(true),
                Ok(MixerCommand::CrossfadeTo {
                    next,
                    old_shutdown_tx,
                    duration_frames,
                }) => {
                    // If a crossfade is already active, finish it immediately so the audio path
                    // stays single-source before starting a new transition.
                    self.finish_crossfade(true);
                    let frames_total = duration_frames.max(1);
                    self.crossfade = Some(ActiveCrossfade {
                        next,
                        old_shutdown_tx,
                        frames_total,
                        frame_pos: 0,
                    });
                    self.frame_channel = 0;
                    self.current_gain = 1.0;
                    self.next_gain = 0.0;
                }
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => break,
            }
        }
    }

    fn finish_crossfade(&mut self, jump_to_next: bool) {
        let Some(mut crossfade) = self.crossfade.take() else {
            return;
        };

        if jump_to_next {
            self.current = crossfade.next;
        }

        if let Some(tx) = crossfade.old_shutdown_tx.take() {
            tx.shutdown();
        }

        self.frame_channel = 0;
        self.current_gain = 1.0;
        self.next_gain = 0.0;
    }

    fn begin_frame(&mut self) {
        let Some(crossfade) = self.crossfade.as_mut() else {
            self.current_gain = 1.0;
            self.next_gain = 0.0;
            return;
        };

        if crossfade.frames_total == 0 {
            self.finish_crossfade(true);
            return;
        }

        if crossfade.frame_pos >= crossfade.frames_total {
            self.finish_crossfade(true);
            return;
        }

        let denom = crossfade.frames_total.max(1) as f32;
        let t = (crossfade.frame_pos as f32 / denom).clamp(0.0, 1.0);
        self.current_gain = 1.0 - t;
        self.next_gain = t;

        crossfade.frame_pos = crossfade.frame_pos.saturating_add(1);
    }

    fn refill_local(&mut self) -> bool {
        self.local.clear();
        self.local_index = 0;

        self.poll_commands();

        let channels = self.channels.max(1);
        let channels_usize = channels as usize;
        if channels_usize == 0 {
            return false;
        }

        for _ in 0..Self::CHUNK_SAMPLES {
            if self.frame_channel == 0 {
                self.begin_frame();
            }

            let current_sample = self.current.next();
            let next_sample = self.crossfade.as_mut().and_then(|state| state.next.next());

            if current_sample.is_none() && next_sample.is_none() {
                if self.local.is_empty() {
                    return false;
                }
                break;
            }

            let current_value = current_sample.unwrap_or(0.0);
            let next_value = next_sample.unwrap_or(0.0);
            let mixed = current_value * self.current_gain + next_value * self.next_gain;
            self.local.push(mixed);

            self.frame_channel = (self.frame_channel + 1) % channels;

            if self.crossfade.is_some() {
                if let Some(state) = self.crossfade.as_ref() {
                    if state.frame_pos >= state.frames_total && self.frame_channel == 0 {
                        self.finish_crossfade(true);
                    }
                }
            }
        }

        !self.local.is_empty()
    }
}

impl Iterator for PlaybackMixerSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.local_index >= self.local.len() {
            if !self.refill_local() {
                return None;
            }
        }

        let out = self.local[self.local_index];
        self.local_index += 1;
        Some(out)
    }
}

impl BulkSource for PlaybackMixerSource {
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
            written += to_copy;
        }
        written
    }
}

impl Source for PlaybackMixerSource {
    fn current_frame_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<std::time::Duration> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playback_mixer_bulk_fill_matches_input_without_crossfade() {
        let samples = vec![0.25f32, -0.25, 0.5, -0.5, 0.75, -0.75];
        let source: BoxedSource = Box::new(rodio::buffer::SamplesBuffer::new(
            2,
            48_000,
            samples.clone(),
        ));
        let (_controller, mut mixer) = PlaybackMixerSource::new(source, 2, 48_000);

        let mut out = vec![0.0f32; samples.len()];
        let filled = mixer.fill_buffer(&mut out);

        assert_eq!(filled, samples.len());
        assert_eq!(out, samples);
        assert_eq!(mixer.fill_buffer(&mut out), 0);
    }
}
