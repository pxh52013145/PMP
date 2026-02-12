use std::path::Path;
use std::sync::Arc;

use crate::audio::output::BoxedSource;
use crate::audio::policy::{NativeAudioHqSrcPhaseMode, NativeAudioSrcBackend, NativeAudioSrcMode};

mod rodio;
mod sacd;
mod streaming;
mod symphonia;

pub(crate) use rodio::{open_source_at as open_rodio_source_at, RodioInput};
pub(crate) use sacd::SacdInput;
pub(crate) use streaming::{
    streaming_transfer_stats, streaming_underrun_stats, DecoderCommand, SharedSamplesSource,
    StreamingPlayback, StreamingSamplesSource, StreamingShutdownTx,
};
pub(crate) use symphonia::SymphoniaInput;

pub(crate) const SYMPHONIA_INPUT_ID: &str = "symphonia";
pub(crate) const RODIO_INPUT_ID: &str = "rodio";
pub(crate) const SACD_INPUT_ID: &str = "sacd";

#[derive(Clone, Debug)]
pub(crate) struct AudioInputMeta {
    pub channels: u16,
    pub sample_rate: u32,
    pub source_sample_rate: u32,
    pub bit_depth: Option<u32>,
    pub duration: f64,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct AudioInputSrcPolicy {
    pub hq_src_enabled: bool,
    pub hq_src_phase_mode: NativeAudioHqSrcPhaseMode,
    pub src_mode: NativeAudioSrcMode,
    pub src_backend: NativeAudioSrcBackend,
    pub src_target_sample_rate: Option<u32>,
}

impl Default for AudioInputSrcPolicy {
    fn default() -> Self {
        Self {
            hq_src_enabled: true,
            hq_src_phase_mode: NativeAudioHqSrcPhaseMode::Linear,
            src_mode: NativeAudioSrcMode::MatchOutput,
            src_backend: NativeAudioSrcBackend::Rubato,
            src_target_sample_rate: None,
        }
    }
}

fn sanitize_target_sample_rate(sample_rate: Option<u32>) -> Option<u32> {
    sample_rate
        .filter(|rate| *rate > 0)
        .map(|rate| rate.clamp(8_000, 768_000))
}

pub(crate) fn resolve_audio_input_target_sample_rate(
    output_sample_rate: Option<u32>,
    src_policy: AudioInputSrcPolicy,
) -> Option<u32> {
    let output_sample_rate = sanitize_target_sample_rate(output_sample_rate);
    match src_policy.src_mode {
        NativeAudioSrcMode::SourceNative => None,
        NativeAudioSrcMode::MatchOutput => output_sample_rate,
        NativeAudioSrcMode::TargetRate => {
            sanitize_target_sample_rate(src_policy.src_target_sample_rate).or(output_sample_rate)
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct AudioInputError {
    pub code: &'static str,
    pub message: String,
}

impl AudioInputError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

pub(crate) enum AudioInputKind {
    Streaming(StreamingPlayback),
    Decoded { samples: Arc<Vec<f32>> },
    Rodio,
}

pub(crate) struct AudioInputOpenResult {
    pub input_id: &'static str,
    pub meta: AudioInputMeta,
    pub kind: AudioInputKind,
    pub source: BoxedSource,
}

pub(crate) trait AudioInput: Send + Sync {
    fn id(&self) -> &'static str;
    fn open(
        &self,
        path: &Path,
        output_sample_rate: Option<u32>,
        src_policy: AudioInputSrcPolicy,
    ) -> Result<AudioInputOpenResult, AudioInputError>;
}

pub(crate) struct AudioInputRegistry {
    inputs: Vec<Arc<dyn AudioInput>>,
}

impl AudioInputRegistry {
    pub fn new() -> Self {
        Self { inputs: Vec::new() }
    }

    pub fn with_defaults() -> Self {
        let mut registry = Self::new();
        registry.register(Arc::new(SacdInput::default()));
        registry.register(Arc::new(SymphoniaInput::default()));
        registry.register(Arc::new(RodioInput::default()));
        registry
    }

    pub fn register(&mut self, input: Arc<dyn AudioInput>) {
        self.inputs.push(input);
    }

    pub fn list_ids(&self) -> Vec<&'static str> {
        self.inputs.iter().map(|input| input.id()).collect()
    }

    pub fn contains_id(&self, id: &str) -> bool {
        self.inputs.iter().any(|input| input.id() == id)
    }

    pub fn open_prefer(
        &self,
        path: &Path,
        output_sample_rate: Option<u32>,
        preferred_id: Option<&str>,
        src_policy: AudioInputSrcPolicy,
    ) -> Result<AudioInputOpenResult, AudioInputError> {
        if self.inputs.is_empty() {
            return Err(AudioInputError::new(
                "AUDIO_INPUT_NO_INPUTS",
                "No audio inputs registered",
            ));
        }

        let mut attempts: Vec<(String, AudioInputError)> = Vec::new();
        if let Some(preferred) = preferred_id {
            if let Some(input) = self.inputs.iter().find(|input| input.id() == preferred) {
                match input.open(path, output_sample_rate, src_policy) {
                    Ok(result) => return Ok(result),
                    Err(err) => attempts.push((input.id().to_string(), err)),
                }
            }
        }

        for input in &self.inputs {
            if preferred_id.is_some_and(|preferred| preferred == input.id()) {
                continue;
            }

            match input.open(path, output_sample_rate, src_policy) {
                Ok(result) => return Ok(result),
                Err(err) => attempts.push((input.id().to_string(), err)),
            }
        }

        let mut message = String::from("All audio inputs failed to open track");
        for (id, err) in attempts {
            message.push_str(&format!("; {id}: [{}] {}", err.code, err.message));
        }

        Err(AudioInputError::new("AUDIO_INPUT_OPEN_FAILED", message))
    }
}

impl Default for AudioInputRegistry {
    fn default() -> Self {
        Self::with_defaults()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FailInput;

    impl AudioInput for FailInput {
        fn id(&self) -> &'static str {
            "fail"
        }

        fn open(
            &self,
            _path: &Path,
            _output_sample_rate: Option<u32>,
            _src_policy: AudioInputSrcPolicy,
        ) -> Result<AudioInputOpenResult, AudioInputError> {
            Err(AudioInputError::new("FAIL", "nope"))
        }
    }

    struct OkInput;

    impl AudioInput for OkInput {
        fn id(&self) -> &'static str {
            "ok"
        }

        fn open(
            &self,
            _path: &Path,
            _output_sample_rate: Option<u32>,
            _src_policy: AudioInputSrcPolicy,
        ) -> Result<AudioInputOpenResult, AudioInputError> {
            let source = ::rodio::buffer::SamplesBuffer::new(2, 48_000, vec![0.0f32; 256]);
            Ok(AudioInputOpenResult {
                input_id: self.id(),
                meta: AudioInputMeta {
                    channels: 2,
                    sample_rate: 48_000,
                    source_sample_rate: 48_000,
                    bit_depth: None,
                    duration: 0.0,
                },
                kind: AudioInputKind::Decoded {
                    samples: Arc::new(vec![0.0f32; 256]),
                },
                source: Box::new(source),
            })
        }
    }

    #[test]
    fn registry_falls_back_to_next_input() {
        let mut registry = AudioInputRegistry::new();
        registry.register(Arc::new(FailInput));
        registry.register(Arc::new(OkInput));

        let result = registry
            .open_prefer(
                Path::new("dummy.wav"),
                None,
                None,
                AudioInputSrcPolicy::default(),
            )
            .expect("open should succeed");

        assert_eq!(result.input_id, "ok");
    }

    #[test]
    fn registry_prefers_requested_input_id() {
        let mut registry = AudioInputRegistry::new();
        registry.register(Arc::new(FailInput));
        registry.register(Arc::new(OkInput));

        let result = registry
            .open_prefer(
                Path::new("dummy.wav"),
                None,
                Some("ok"),
                AudioInputSrcPolicy::default(),
            )
            .expect("open should succeed");

        assert_eq!(result.input_id, "ok");
    }

    #[test]
    fn registry_returns_stable_error_code_when_all_fail() {
        let mut registry = AudioInputRegistry::new();
        registry.register(Arc::new(FailInput));

        let err = registry
            .open_prefer(
                Path::new("dummy.wav"),
                None,
                None,
                AudioInputSrcPolicy::default(),
            )
            .err()
            .expect("open should fail");
        assert_eq!(err.code, "AUDIO_INPUT_OPEN_FAILED");
    }
}
