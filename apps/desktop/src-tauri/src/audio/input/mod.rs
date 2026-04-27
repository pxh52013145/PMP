use std::path::Path;
use std::sync::Arc;

use crate::audio::output::BoxedSource;
use crate::audio::policy::{NativeAudioHqSrcPhaseMode, NativeAudioSrcBackend, NativeAudioSrcMode};

mod remote_stream;
mod rodio;
mod sacd;
mod streaming;
mod symphonia;

pub(crate) use remote_stream::RemoteStreamInput;
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
pub(crate) const REMOTE_STREAM_INPUT_ID: &str = "remote-stream";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AudioInputDecodeMode {
    Streaming,
    FullTrack,
    // Transport fast-start path: begin playback via streaming immediately,
    // while allowing decoder-side buffering to grow toward full-track budget.
    StreamingFullTrack,
}

impl Default for AudioInputDecodeMode {
    fn default() -> Self {
        Self::Streaming
    }
}

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

#[derive(Clone, Debug)]
pub(crate) enum AudioInputLocator {
    File(std::path::PathBuf),
    RemoteStream(crate::audio::source::RemoteStreamInputLocator),
}

impl AudioInputLocator {
    pub fn from_path(path: &Path) -> Self {
        crate::audio::source::lookup_remote_stream_input_locator(path)
            .map(Self::RemoteStream)
            .unwrap_or_else(|| Self::File(path.to_path_buf()))
    }
}

pub(crate) trait AudioInput: Send + Sync {
    fn id(&self) -> &'static str;
    fn open(
        &self,
        path: &Path,
        output_sample_rate: Option<u32>,
        decode_mode: AudioInputDecodeMode,
        src_policy: AudioInputSrcPolicy,
    ) -> Result<AudioInputOpenResult, AudioInputError>;

    fn open_locator(
        &self,
        locator: &AudioInputLocator,
        output_sample_rate: Option<u32>,
        decode_mode: AudioInputDecodeMode,
        src_policy: AudioInputSrcPolicy,
    ) -> Result<AudioInputOpenResult, AudioInputError> {
        match locator {
            AudioInputLocator::File(path) => {
                self.open(path, output_sample_rate, decode_mode, src_policy)
            }
            AudioInputLocator::RemoteStream(_) => Err(AudioInputError::new(
                "AUDIO_INPUT_LOCATOR_UNSUPPORTED",
                format!(
                    "Input '{}' does not support remote stream locators",
                    self.id()
                ),
            )),
        }
    }
}

#[derive(Clone)]
pub(crate) struct AudioInputRegistry {
    inputs: Vec<Arc<dyn AudioInput>>,
}

impl AudioInputRegistry {
    pub fn new() -> Self {
        Self { inputs: Vec::new() }
    }

    pub fn with_defaults() -> Self {
        let mut registry = Self::new();
        registry.register(Arc::new(RemoteStreamInput));
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
        decode_mode: AudioInputDecodeMode,
        src_policy: AudioInputSrcPolicy,
    ) -> Result<AudioInputOpenResult, AudioInputError> {
        let locator = AudioInputLocator::from_path(path);
        self.open_locator_prefer(
            &locator,
            output_sample_rate,
            preferred_id,
            decode_mode,
            src_policy,
        )
    }

    pub fn open_locator_prefer(
        &self,
        locator: &AudioInputLocator,
        output_sample_rate: Option<u32>,
        preferred_id: Option<&str>,
        decode_mode: AudioInputDecodeMode,
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
                match input.open_locator(locator, output_sample_rate, decode_mode, src_policy) {
                    Ok(result) => return Ok(result),
                    Err(err) => attempts.push((input.id().to_string(), err)),
                }
            }
        }

        for input in &self.inputs {
            if preferred_id.is_some_and(|preferred| preferred == input.id()) {
                continue;
            }

            match input.open_locator(locator, output_sample_rate, decode_mode, src_policy) {
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
            _decode_mode: AudioInputDecodeMode,
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
            _decode_mode: AudioInputDecodeMode,
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

    struct FullTrackOnlyInput;

    impl AudioInput for FullTrackOnlyInput {
        fn id(&self) -> &'static str {
            "full-track-only"
        }

        fn open(
            &self,
            _path: &Path,
            _output_sample_rate: Option<u32>,
            decode_mode: AudioInputDecodeMode,
            _src_policy: AudioInputSrcPolicy,
        ) -> Result<AudioInputOpenResult, AudioInputError> {
            if decode_mode != AudioInputDecodeMode::FullTrack {
                return Err(AudioInputError::new(
                    "UNSUPPORTED_MODE",
                    "full-track mode required",
                ));
            }
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
                AudioInputDecodeMode::Streaming,
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
                AudioInputDecodeMode::Streaming,
                AudioInputSrcPolicy::default(),
            )
            .expect("open should succeed");

        assert_eq!(result.input_id, "ok");
    }

    #[test]
    fn registry_forwards_decode_mode_to_inputs() {
        let mut registry = AudioInputRegistry::new();
        registry.register(Arc::new(FullTrackOnlyInput));
        registry.register(Arc::new(OkInput));

        let result = registry
            .open_prefer(
                Path::new("dummy.wav"),
                None,
                None,
                AudioInputDecodeMode::FullTrack,
                AudioInputSrcPolicy::default(),
            )
            .expect("open should succeed");

        assert_eq!(result.input_id, "full-track-only");
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
                AudioInputDecodeMode::Streaming,
                AudioInputSrcPolicy::default(),
            )
            .err()
            .expect("open should fail");
        assert_eq!(err.code, "AUDIO_INPUT_OPEN_FAILED");
    }

    #[test]
    fn locator_from_path_uses_registered_remote_stream_identity() {
        let identity = Path::new("netease://song/input-locator");
        let locator = crate::audio::source::RemoteStreamInputLocator {
            cache_root: std::env::temp_dir(),
            stream_url: "https://cdn.example.com/audio/input-locator.flac".to_string(),
            source_locator: Some("netease://song/input-locator".to_string()),
            connector_id: Some("netease".to_string()),
            mime_type: Some("audio/flac".to_string()),
            headers: None,
            expires_at_ms: None,
            seekable: Some(true),
            range_requests: Some(true),
        };
        let registered = crate::audio::source::register_remote_stream_input_locator(locator);
        assert_eq!(registered, identity);

        match AudioInputLocator::from_path(identity) {
            AudioInputLocator::RemoteStream(locator) => {
                assert_eq!(
                    locator.stream_url,
                    "https://cdn.example.com/audio/input-locator.flac"
                );
                assert_eq!(locator.range_requests, Some(true));
            }
            AudioInputLocator::File(_) => panic!("registered locator should be remote-stream"),
        }
    }
}
