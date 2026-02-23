//! Asynchronous double-buffered NN processing node for the audio DSP pipeline.
//!
//! Architecture:
//! - DSP thread pushes input blocks into a lock-free ring
//! - Worker thread pulls blocks, runs inference, and pushes processed blocks
//! - DSP thread consumes processed blocks when available
//! - On overrun, the node bypasses to dry signal with a short fade-in recovery

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use crate::audio::buffer::AudioRingBuffer;
use crate::audio::diagnostics;
use crate::audio::nn_runtime::NnRuntime;

static NN_INFERENCE_OVERRUN_EVENTS: AtomicU64 = AtomicU64::new(0);
static NN_INFERENCE_TOTAL_US: AtomicU64 = AtomicU64::new(0);
static NN_INFERENCE_COUNT: AtomicU64 = AtomicU64::new(0);
static NN_INFERENCE_TIMELINE_GATE_MS: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct NnProcessorStats {
    pub overrun_events: u64,
    pub total_inference_us: u64,
    pub inference_count: u64,
}

pub(crate) fn nn_processor_stats() -> NnProcessorStats {
    NnProcessorStats {
        overrun_events: NN_INFERENCE_OVERRUN_EVENTS.load(Ordering::Relaxed),
        total_inference_us: NN_INFERENCE_TOTAL_US.load(Ordering::Relaxed),
        inference_count: NN_INFERENCE_COUNT.load(Ordering::Relaxed),
    }
}

/// An NN DSP node that runs inference asynchronously with bypass-on-overrun.
pub(crate) struct NnDspNode {
    input_ring: AudioRingBuffer,
    output_ring: AudioRingBuffer,
    stop: Arc<AtomicBool>,
    channels: usize,
    block_samples: usize,
    latency_frames: usize,
    bypass_on_overrun: bool,
    fade_frames: usize,
    in_bypass: bool,
    output_scratch: Vec<f32>,
}

impl NnDspNode {
    /// Create a new NN DSP node and spawn its worker thread.
    pub(crate) fn new(
        runtime: Box<dyn NnRuntime>,
        sample_rate: u32,
        bypass_on_overrun: bool,
    ) -> Self {
        let channels = runtime.channels().max(1);
        let block_frames = runtime.block_size_frames().max(1);
        let block_samples = block_frames.saturating_mul(channels);
        let latency_frames = runtime.latency_frames();
        let sample_rate = sample_rate.max(1);

        // Ring capacity: 4 blocks of headroom.
        let ring_capacity = block_samples.saturating_mul(4).max(1);
        let input_ring = AudioRingBuffer::new(ring_capacity);
        let output_ring = AudioRingBuffer::new(ring_capacity);

        let stop = Arc::new(AtomicBool::new(false));
        let fade_frames = ((sample_rate as usize).saturating_mul(5) / 1000)
            .max(1)
            .min(2048);

        let worker_input = input_ring.clone();
        let worker_output = output_ring.clone();
        let worker_stop = stop.clone();

        thread::Builder::new()
            .name("pmpm-nn-inference".to_string())
            .spawn(move || {
                Self::worker_loop(
                    runtime,
                    worker_input,
                    worker_output,
                    worker_stop,
                    block_samples,
                    channels,
                );
            })
            .expect("failed to spawn NN inference worker");

        Self {
            input_ring,
            output_ring,
            stop,
            channels,
            block_samples,
            latency_frames,
            bypass_on_overrun,
            fade_frames,
            in_bypass: false,
            output_scratch: Vec::with_capacity(block_samples),
        }
    }

    fn worker_loop(
        mut runtime: Box<dyn NnRuntime>,
        input_ring: AudioRingBuffer,
        output_ring: AudioRingBuffer,
        stop: Arc<AtomicBool>,
        block_samples: usize,
        channels: usize,
    ) {
        let mut input_buf = vec![0.0f32; block_samples];
        let mut output_buf = vec![0.0f32; block_samples];
        let mut pop_scratch = Vec::with_capacity(block_samples);
        let block_frames = block_samples / channels.max(1);

        loop {
            if stop.load(Ordering::Acquire) {
                break;
            }

            if input_ring.len_samples() < block_samples {
                thread::sleep(Duration::from_millis(1));
                continue;
            }

            let pop = input_ring.pop_chunk_into(
                &mut pop_scratch,
                block_samples,
                Duration::from_millis(2),
            );
            if pop.popped < block_samples {
                continue;
            }

            input_buf[..block_samples].copy_from_slice(&pop_scratch[..block_samples]);

            let started = Instant::now();
            let result = runtime.infer(
                &input_buf[..block_samples],
                &mut output_buf[..block_samples],
            );
            let elapsed_us = started.elapsed().as_micros().min(u64::MAX as u128) as u64;

            NN_INFERENCE_COUNT.fetch_add(1, Ordering::Relaxed);
            NN_INFERENCE_TOTAL_US.fetch_add(elapsed_us, Ordering::Relaxed);

            let produced = match result {
                Ok(()) => &output_buf[..block_samples],
                Err(_) => {
                    output_buf[..block_samples].copy_from_slice(&input_buf[..block_samples]);
                    NN_INFERENCE_OVERRUN_EVENTS.fetch_add(1, Ordering::Relaxed);
                    diagnostics::record_event_throttled(
                        "nn.inference.error",
                        elapsed_us,
                        block_frames as u64,
                        &NN_INFERENCE_TIMELINE_GATE_MS,
                        200,
                    );
                    &output_buf[..block_samples]
                }
            };

            let pushed_frames = output_ring.push_interleaved(produced, channels);
            if pushed_frames < block_frames {
                NN_INFERENCE_OVERRUN_EVENTS.fetch_add(1, Ordering::Relaxed);
                diagnostics::record_event_throttled(
                    "nn.inference.output_backpressure",
                    pushed_frames as u64,
                    block_frames as u64,
                    &NN_INFERENCE_TIMELINE_GATE_MS,
                    200,
                );
            }
        }
    }

    /// Process interleaved samples in-place.
    /// If output is available from the worker, use it (with fade transition).
    /// Otherwise, bypass (keep dry signal).
    pub(crate) fn process_interleaved_in_place(&mut self, samples: &mut [f32]) {
        if samples.is_empty() {
            return;
        }

        let channels = self.channels.max(1);
        let frames = samples.len() / channels;
        if frames == 0 {
            return;
        }

        let pushed_frames = self.input_ring.push_interleaved(samples, channels);
        if pushed_frames < frames {
            NN_INFERENCE_OVERRUN_EVENTS.fetch_add(1, Ordering::Relaxed);
            diagnostics::record_event_throttled(
                "nn.inference.input_backpressure",
                pushed_frames as u64,
                frames as u64,
                &NN_INFERENCE_TIMELINE_GATE_MS,
                200,
            );
        }

        let required_samples = frames.saturating_mul(channels);
        let available = self.output_ring.len_samples();
        if available >= required_samples {
            let pop = self.output_ring.pop_chunk_into(
                &mut self.output_scratch,
                required_samples,
                Duration::ZERO,
            );

            if pop.popped >= required_samples {
                if !self.in_bypass {
                    samples.copy_from_slice(&self.output_scratch[..required_samples]);
                    return;
                }

                self.in_bypass = false;
                let fade_len = self.fade_frames.min(samples.len() / channels.max(1));
                if fade_len == 0 {
                    samples.copy_from_slice(&self.output_scratch[..required_samples]);
                    return;
                }

                for frame in 0..fade_len {
                    let t = (frame as f32 + 1.0) / fade_len as f32;
                    let a = 1.0 - t;
                    let base = frame * channels;
                    for ch in 0..channels {
                        let idx = base + ch;
                        if idx < samples.len() {
                            samples[idx] = samples[idx] * a + self.output_scratch[idx] * t;
                        }
                    }
                }

                let copy_from = fade_len * channels;
                if copy_from < samples.len() {
                    let samples_len = samples.len();
                    samples[copy_from..]
                        .copy_from_slice(&self.output_scratch[copy_from..samples_len]);
                }
                return;
            }
        }

        if self.bypass_on_overrun {
            self.enter_bypass(available as u64, required_samples as u64);
        }
    }

    fn enter_bypass(&mut self, available_samples: u64, requested_samples: u64) {
        if self.in_bypass {
            return;
        }

        self.in_bypass = true;
        NN_INFERENCE_OVERRUN_EVENTS.fetch_add(1, Ordering::Relaxed);
        diagnostics::record_event_throttled(
            "nn.inference.overrun",
            available_samples,
            requested_samples,
            &NN_INFERENCE_TIMELINE_GATE_MS,
            200,
        );
    }

    pub(crate) fn latency_frames(&self) -> usize {
        self.latency_frames
    }

    pub(crate) fn reset(&mut self) {
        self.input_ring.clear();
        self.output_ring.clear();
        self.in_bypass = false;
        self.output_scratch.clear();
    }

    pub(crate) fn block_samples(&self) -> usize {
        self.block_samples
    }
}

impl Drop for NnDspNode {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::nn_runtime::PassthroughNnRuntime;

    #[test]
    fn nn_dsp_node_passthrough_produces_finite_output() {
        let runtime = Box::new(PassthroughNnRuntime::new(512, 2));
        let mut node = NnDspNode::new(runtime, 48_000, true);

        let mut block = vec![0.5f32; 1024];
        for _ in 0..4 {
            node.process_interleaved_in_place(&mut block);
            thread::sleep(Duration::from_millis(10));
        }

        let mut test_block = vec![0.75f32; 1024];
        node.process_interleaved_in_place(&mut test_block);
        assert!(test_block.iter().all(|sample| sample.is_finite()));
        assert_eq!(node.latency_frames(), 0);
        assert_eq!(node.block_samples(), 1024);
    }

    #[test]
    fn nn_dsp_node_reset_clears_state() {
        let runtime = Box::new(PassthroughNnRuntime::new(256, 2));
        let mut node = NnDspNode::new(runtime, 48_000, true);

        let mut block = vec![0.5f32; 512];
        node.process_interleaved_in_place(&mut block);

        node.reset();
        assert_eq!(node.input_ring.len_samples(), 0);
        assert_eq!(node.output_ring.len_samples(), 0);
        assert!(!node.in_bypass);
    }

    #[test]
    fn nn_processor_stats_are_observable() {
        let before = nn_processor_stats();

        let runtime = Box::new(PassthroughNnRuntime::new(128, 2));
        let mut node = NnDspNode::new(runtime, 48_000, true);
        let mut block = vec![0.25f32; 256];

        let started = Instant::now();
        while started.elapsed() < Duration::from_millis(500) {
            node.process_interleaved_in_place(&mut block);
            thread::sleep(Duration::from_millis(5));
            let after = nn_processor_stats();
            if after.inference_count > before.inference_count {
                return;
            }
        }

        panic!("nn inference worker did not publish stats in time");
    }
}
