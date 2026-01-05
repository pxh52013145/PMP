use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::time::Duration;

use ::rodio::decoder::Decoder;
use ::rodio::Source;

use crate::audio::output::BoxedSource;

use super::{
    AudioInput, AudioInputError, AudioInputKind, AudioInputMeta, AudioInputOpenResult,
    RODIO_INPUT_ID,
};

#[derive(Default)]
pub(crate) struct RodioInput;

pub(crate) fn open_source_at(
    path: &Path,
    seconds: f64,
) -> Result<(BoxedSource, f64), AudioInputError> {
    let file = File::open(path).map_err(|e| {
        AudioInputError::new(
            "AUDIO_INPUT_RODIO_OPEN_FAILED",
            format!("Failed to open file: {e}"),
        )
    })?;
    let decoder = Decoder::new(BufReader::new(file)).map_err(|e| {
        AudioInputError::new(
            "AUDIO_INPUT_RODIO_DECODE_FAILED",
            format!("Failed to decode audio file: {e}"),
        )
    })?;
    let duration = decoder
        .total_duration()
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);

    let seconds = seconds.max(0.0);
    let source: BoxedSource = if seconds > 0.0 {
        Box::new(
            decoder
                .skip_duration(Duration::from_secs_f64(seconds))
                .convert_samples::<f32>(),
        )
    } else {
        Box::new(decoder.convert_samples::<f32>())
    };

    Ok((source, duration))
}

impl AudioInput for RodioInput {
    fn id(&self) -> &'static str {
        RODIO_INPUT_ID
    }

    fn open(
        &self,
        path: &Path,
        _output_sample_rate: Option<u32>,
    ) -> Result<AudioInputOpenResult, AudioInputError> {
        let (source, duration) = open_source_at(path, 0.0)?;
        Ok(AudioInputOpenResult {
            input_id: self.id(),
            meta: AudioInputMeta {
                channels: 0,
                sample_rate: 0,
                bit_depth: None,
                duration,
            },
            kind: AudioInputKind::Rodio,
            source,
        })
    }
}
