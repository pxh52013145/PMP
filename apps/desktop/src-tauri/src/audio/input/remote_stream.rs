use std::path::Path;

use super::{
    AudioInput, AudioInputDecodeMode, AudioInputError, AudioInputKind, AudioInputLocator,
    AudioInputOpenResult, AudioInputSrcPolicy, SymphoniaInput, SymphoniaStreamingMediaSource,
    REMOTE_STREAM_INPUT_ID,
};

#[derive(Default)]
pub(crate) struct RemoteStreamInput;

impl AudioInput for RemoteStreamInput {
    fn id(&self) -> &'static str {
        REMOTE_STREAM_INPUT_ID
    }

    fn open(
        &self,
        path: &Path,
        output_sample_rate: Option<u32>,
        decode_mode: AudioInputDecodeMode,
        src_policy: AudioInputSrcPolicy,
    ) -> Result<AudioInputOpenResult, AudioInputError> {
        let locator =
            crate::audio::source::lookup_remote_stream_input_locator(path).ok_or_else(|| {
                AudioInputError::new("REMOTE_STREAM_LOCATOR_MISSING", "No remote stream locator")
            })?;
        self.open_locator(
            &AudioInputLocator::RemoteStream(locator),
            output_sample_rate,
            decode_mode,
            src_policy,
        )
    }

    fn open_locator(
        &self,
        locator: &AudioInputLocator,
        output_sample_rate: Option<u32>,
        decode_mode: AudioInputDecodeMode,
        src_policy: AudioInputSrcPolicy,
    ) -> Result<AudioInputOpenResult, AudioInputError> {
        let AudioInputLocator::RemoteStream(locator) = locator else {
            return Err(AudioInputError::new(
                "REMOTE_STREAM_LOCATOR_UNSUPPORTED",
                "Remote stream input requires a remote stream locator",
            ));
        };

        crate::audio::diagnostics::record_event(
            "transport.source.remote.input_open",
            (locator.range_requests == Some(true)) as u64,
            (locator.seekable == Some(true)) as u64,
        );

        if decode_mode == AudioInputDecodeMode::FullTrack {
            let cache_path =
                crate::audio::source::materialize_remote_stream_input_locator_complete(locator)
                    .map_err(|message| {
                        AudioInputError::new("REMOTE_STREAM_MATERIALIZE_FAILED", message)
                    })?;
            let mut opened = SymphoniaInput::default().open(
                &cache_path,
                output_sample_rate,
                decode_mode,
                src_policy,
            )?;
            opened.input_id = REMOTE_STREAM_INPUT_ID;
            return Ok(opened);
        }

        let (source, extension) = crate::audio::source::open_remote_stream_media_source(locator)
            .map_err(|message| AudioInputError::new("REMOTE_STREAM_OPEN_FAILED", message))?;
        let mut opened = super::open_streaming_media_source(
            SymphoniaStreamingMediaSource { source, extension },
            output_sample_rate,
            src_policy,
        )?;
        opened.input_id = REMOTE_STREAM_INPUT_ID;
        if matches!(opened.kind, AudioInputKind::Streaming(_)) {
            crate::audio::diagnostics::record_event(
                "transport.source.remote.streaming_open",
                opened.meta.sample_rate as u64,
                opened.meta.channels as u64,
            );
        }
        Ok(opened)
    }
}
