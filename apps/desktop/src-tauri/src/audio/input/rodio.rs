use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::time::Duration;

use rodio::decoder::Decoder;
use rodio::Source;

use crate::audio::output::BoxedSource;

use super::{
    AudioInput, AudioInputDecodeMode, AudioInputError, AudioInputKind, AudioInputMeta,
    AudioInputOpenResult, AudioInputSrcPolicy, RODIO_INPUT_ID,
};

#[derive(Default)]
pub(crate) struct RodioInput;

pub(crate) fn open_source_at(
    path: &Path,
    seconds: f64,
) -> Result<(BoxedSource, AudioInputMeta), AudioInputError> {
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
    let channels = decoder.channels().max(1);
    let sample_rate = decoder.sample_rate().max(1);

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

    Ok((
        source,
        AudioInputMeta {
            channels,
            sample_rate,
            source_sample_rate: sample_rate,
            bit_depth: None,
            duration,
        },
    ))
}

impl AudioInput for RodioInput {
    fn id(&self) -> &'static str {
        RODIO_INPUT_ID
    }

    fn open(
        &self,
        path: &Path,
        _output_sample_rate: Option<u32>,
        _decode_mode: AudioInputDecodeMode,
        _src_policy: AudioInputSrcPolicy,
    ) -> Result<AudioInputOpenResult, AudioInputError> {
        let (source, meta) = open_source_at(path, 0.0)?;
        Ok(AudioInputOpenResult {
            input_id: self.id(),
            meta,
            kind: AudioInputKind::Rodio,
            source,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::Source;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn write_wav_i16_stereo(path: &Path, sample_rate: u32, frames: usize) {
        let channels = 2u16;
        let bits_per_sample = 16u16;
        let block_align = channels * (bits_per_sample / 8);
        let byte_rate = sample_rate * block_align as u32;
        let data_bytes = frames as u32 * block_align as u32;
        let riff_chunk_size = 36u32 + data_bytes;

        let mut file = File::create(path).expect("create wav");
        file.write_all(b"RIFF").unwrap();
        file.write_all(&riff_chunk_size.to_le_bytes()).unwrap();
        file.write_all(b"WAVE").unwrap();
        file.write_all(b"fmt ").unwrap();
        file.write_all(&16u32.to_le_bytes()).unwrap();
        file.write_all(&1u16.to_le_bytes()).unwrap();
        file.write_all(&channels.to_le_bytes()).unwrap();
        file.write_all(&sample_rate.to_le_bytes()).unwrap();
        file.write_all(&byte_rate.to_le_bytes()).unwrap();
        file.write_all(&block_align.to_le_bytes()).unwrap();
        file.write_all(&bits_per_sample.to_le_bytes()).unwrap();
        file.write_all(b"data").unwrap();
        file.write_all(&data_bytes.to_le_bytes()).unwrap();

        for frame in 0..frames {
            let sample = (((frame as f32) / (frames as f32)) * 0.8 * i16::MAX as f32) as i16;
            file.write_all(&sample.to_le_bytes()).unwrap();
            file.write_all(&sample.to_le_bytes()).unwrap();
        }
    }

    #[test]
    fn open_source_reports_meta() {
        let tmp_dir = std::env::temp_dir();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time ok")
            .as_nanos();
        let path = tmp_dir.join(format!("pmp_rodio_meta_{nonce}.wav"));

        write_wav_i16_stereo(&path, 44_100, 44_100);

        let (source, meta) = open_source_at(&path, 0.0).expect("open source");
        assert_eq!(meta.channels, 2);
        assert_eq!(meta.sample_rate, 44_100);
        assert!(
            meta.duration > 0.9 && meta.duration < 1.1,
            "duration={}",
            meta.duration
        );

        assert_eq!(source.channels(), 2);
        assert_eq!(source.sample_rate(), 44_100);

        let _ = std::fs::remove_file(&path);
    }
}
