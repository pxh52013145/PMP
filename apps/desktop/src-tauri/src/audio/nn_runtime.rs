//! Neural network runtime trait and types for audio DSP integration.
//!
//! This module defines the contract for NN inference backends (ONNX, Candle, etc.)
//! that can be plugged into the audio DSP pipeline. The design supports:
//! - Block-based processing (aligned to DSP chunk size)
//! - CPU and GPU inference backends
//! - Latency-aware scheduling with bypass-on-overrun
//! - Hot model swapping via the existing DspRuntime slow-update mechanism

use serde::{Deserialize, Serialize};
use std::fmt;

/// Device target for NN inference.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum NnDevice {
    Cpu,
    #[cfg(feature = "nn-cuda")]
    Cuda,
    #[cfg(target_os = "windows")]
    DirectMl,
}

impl Default for NnDevice {
    fn default() -> Self {
        Self::Cpu
    }
}

/// Specification for loading an NN model.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NnModelSpec {
    pub model_id: String,
    pub model_path: String,
    pub device: NnDevice,
    /// Maximum allowed inference time per block before bypass kicks in.
    pub latency_budget_ms: f32,
    /// Whether to bypass (pass through dry signal) when inference overruns.
    pub bypass_on_overrun: bool,
}

/// Error type for NN operations.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NnError {
    pub code: &'static str,
    pub message: String,
}

impl fmt::Display for NnError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for NnError {}

/// Trait that NN inference backends must implement.
///
/// Implementations MUST:
/// - Pre-allocate all memory at construction time (no allocation in `infer`)
/// - Be `Send` (may be moved to a worker thread)
/// - Return errors gracefully (never panic in `infer`)
pub(crate) trait NnRuntime: Send + 'static {
    /// Required input block size in frames (not samples).
    fn block_size_frames(&self) -> usize;

    /// Number of audio channels this model expects.
    fn channels(&self) -> usize;

    /// Lookahead latency in frames introduced by this model.
    /// Used for latency compensation in the pipeline.
    fn latency_frames(&self) -> usize;

    /// Run inference on a block of interleaved f32 samples.
    ///
    /// `input` and `output` are interleaved audio buffers of size
    /// `block_size_frames() * channels()`.
    ///
    /// Returns Ok(()) on success. On error, `output` should be left
    /// in a valid state (zeroed or copied from input for bypass).
    fn infer(&mut self, input: &[f32], output: &mut [f32]) -> Result<(), NnError>;

    /// Reset internal state (e.g., after seek or track change).
    fn reset(&mut self);

    /// Whether the model is ready for inference.
    /// Returns false during loading, warm-up, or after error.
    fn is_ready(&self) -> bool;

    /// Inference device.
    fn device(&self) -> NnDevice;
}

/// A no-op NN runtime for testing. Copies input to output.
#[derive(Debug)]
pub(crate) struct PassthroughNnRuntime {
    block_size_frames: usize,
    channels: usize,
}

impl PassthroughNnRuntime {
    pub(crate) fn new(block_size_frames: usize, channels: usize) -> Self {
        Self {
            block_size_frames: block_size_frames.max(1),
            channels: channels.max(1),
        }
    }
}

impl NnRuntime for PassthroughNnRuntime {
    fn block_size_frames(&self) -> usize {
        self.block_size_frames
    }

    fn channels(&self) -> usize {
        self.channels
    }

    fn latency_frames(&self) -> usize {
        0
    }

    fn infer(&mut self, input: &[f32], output: &mut [f32]) -> Result<(), NnError> {
        let len = input.len().min(output.len());
        output[..len].copy_from_slice(&input[..len]);
        Ok(())
    }

    fn reset(&mut self) {}

    fn is_ready(&self) -> bool {
        true
    }

    fn device(&self) -> NnDevice {
        NnDevice::Cpu
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passthrough_runtime_copies_input_to_output() {
        let mut runtime = PassthroughNnRuntime::new(512, 2);
        assert!(runtime.is_ready());
        assert_eq!(runtime.block_size_frames(), 512);
        assert_eq!(runtime.channels(), 2);
        assert_eq!(runtime.latency_frames(), 0);

        let input = vec![0.5f32; 1024];
        let mut output = vec![0.0f32; 1024];
        runtime
            .infer(&input, &mut output)
            .expect("infer should work");
        assert_eq!(input, output);
    }

    #[test]
    fn passthrough_runtime_reset_is_safe() {
        let mut runtime = PassthroughNnRuntime::new(256, 1);
        runtime.reset();
        assert!(runtime.is_ready());
    }

    #[test]
    fn nn_model_spec_serialization_roundtrip() {
        let spec = NnModelSpec {
            model_id: "test-denoiser".to_string(),
            model_path: "/path/to/model.onnx".to_string(),
            device: NnDevice::Cpu,
            latency_budget_ms: 10.0,
            bypass_on_overrun: true,
        };

        let json = serde_json::to_string(&spec).expect("serialize spec");
        let deserialized: NnModelSpec = serde_json::from_str(&json).expect("deserialize spec");
        assert_eq!(spec, deserialized);
    }
}
