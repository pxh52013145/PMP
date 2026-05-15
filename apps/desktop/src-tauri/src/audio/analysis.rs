use std::fs::File;
use std::path::Path;
use std::time::Instant;

use serde::Serialize;
use symphonia::core::{
    audio::SampleBuffer,
    codecs::DecoderOptions,
    errors::Error as SymphoniaError,
    formats::FormatOptions,
    io::{MediaSourceStream, MediaSourceStreamOptions},
    meta::MetadataOptions,
    probe::Hint,
};

use super::input::{pick_symphonia_audio_track, AudioInputError};

const DEFAULT_SEGMENT_COUNT: usize = 1440;
const MIN_SEGMENT_COUNT: usize = 64;
const MAX_SEGMENT_COUNT: usize = 4096;
const UNKNOWN_DURATION_CHUNK_FRAMES: u64 = 2048;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioPeakRmsSegmentPayload {
    pub min: u16,
    pub max: u16,
    pub peak: u16,
    pub rms: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioPeakRmsAnalysisPayload {
    pub version: u32,
    pub segment_count: usize,
    pub duration: f64,
    pub sample_rate: u32,
    pub channels: usize,
    pub frame_count: u64,
    pub decoded_frames: u64,
    pub analyzed_samples: u64,
    pub elapsed_ms: u64,
    pub segments: Vec<NativeAudioPeakRmsSegmentPayload>,
}

#[derive(Debug)]
struct SegmentAccumulator {
    min: f32,
    max: f32,
    peak: f32,
    square_sum: f64,
    count: u64,
}

impl SegmentAccumulator {
    fn new() -> Self {
        Self {
            min: 1.0,
            max: -1.0,
            peak: 0.0,
            square_sum: 0.0,
            count: 0,
        }
    }

    fn push(&mut self, sample: f32) {
        let sample = if sample.is_finite() {
            sample.clamp(-1.0, 1.0)
        } else {
            0.0
        };
        self.min = self.min.min(sample);
        self.max = self.max.max(sample);
        self.peak = self.peak.max(sample.abs());
        self.square_sum += (sample as f64) * (sample as f64);
        self.count = self.count.saturating_add(1);
    }

    fn finish(&self) -> NativeAudioPeakRmsSegmentPayload {
        if self.count == 0 {
            return NativeAudioPeakRmsSegmentPayload {
                min: quantize_bipolar(0.0),
                max: quantize_bipolar(0.0),
                peak: 0,
                rms: 0,
            };
        }

        NativeAudioPeakRmsSegmentPayload {
            min: quantize_bipolar(self.min),
            max: quantize_bipolar(self.max),
            peak: quantize_unipolar(self.peak),
            rms: quantize_unipolar((self.square_sum / self.count as f64).sqrt() as f32),
        }
    }

    fn merge(&mut self, other: &SegmentAccumulator) {
        if other.count == 0 {
            return;
        }
        self.min = self.min.min(other.min);
        self.max = self.max.max(other.max);
        self.peak = self.peak.max(other.peak);
        self.square_sum += other.square_sum;
        self.count = self.count.saturating_add(other.count);
    }
}

fn quantize_unipolar(value: f32) -> u16 {
    let normalized = if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        0.0
    };
    (normalized * u16::MAX as f32).round() as u16
}

fn quantize_bipolar(value: f32) -> u16 {
    let normalized = if value.is_finite() {
        ((value.clamp(-1.0, 1.0) + 1.0) * 0.5).clamp(0.0, 1.0)
    } else {
        0.5
    };
    (normalized * u16::MAX as f32).round() as u16
}

fn normalize_segment_count(segment_count: Option<usize>) -> usize {
    segment_count
        .unwrap_or(DEFAULT_SEGMENT_COUNT)
        .clamp(MIN_SEGMENT_COUNT, MAX_SEGMENT_COUNT)
}

fn open_format(
    path: &Path,
) -> Result<Box<dyn symphonia::core::formats::FormatReader>, AudioInputError> {
    let file = File::open(path).map_err(|error| {
        AudioInputError::new(
            "AUDIO_ANALYSIS_OPEN_FAILED",
            format!("Failed to open file for analysis: {error}"),
        )
    })?;
    let mss = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }
    let format_options = FormatOptions {
        prebuild_seek_index: false,
        seek_index_fill_rate: 0,
        enable_gapless: false,
    };
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &format_options, &MetadataOptions::default())
        .map_err(|error| {
            AudioInputError::new(
                "AUDIO_ANALYSIS_PROBE_FAILED",
                format!("Failed to probe audio file for analysis: {error}"),
            )
        })?;
    Ok(probed.format)
}

pub fn analyze_peak_rms(
    path: impl AsRef<Path>,
    segment_count: Option<usize>,
) -> Result<NativeAudioPeakRmsAnalysisPayload, AudioInputError> {
    let started_at = Instant::now();
    let segment_count = normalize_segment_count(segment_count);
    let mut format = open_format(path.as_ref())?;
    let track = pick_symphonia_audio_track(format.as_ref())
        .ok_or_else(|| AudioInputError::new("AUDIO_ANALYSIS_NO_TRACK", "No audio track found"))?
        .clone();
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|error| {
            AudioInputError::new(
                "AUDIO_ANALYSIS_DECODER_FAILED",
                format!("Failed to create analysis decoder: {error}"),
            )
        })?;

    let mut sample_buf: Option<SampleBuffer<f32>> = None;
    let mut accumulators = (0..segment_count)
        .map(|_| SegmentAccumulator::new())
        .collect::<Vec<_>>();
    let mut unknown_duration_chunks: Vec<SegmentAccumulator> = Vec::new();
    let mut channels = track
        .codec_params
        .channels
        .map(|value| value.count())
        .unwrap_or(0);
    let mut sample_rate = track.codec_params.sample_rate.unwrap_or(44_100).max(1);
    let estimated_frame_count = track.codec_params.n_frames;
    let known_frame_count = estimated_frame_count.filter(|frames| *frames > 0);
    let mut decoded_frames = 0u64;
    let mut analyzed_samples = 0u64;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(SymphoniaError::ResetRequired) => {
                return Err(AudioInputError::new(
                    "AUDIO_ANALYSIS_RESET_REQUIRED",
                    "Decoder reset required while analyzing audio",
                ));
            }
            Err(error) => {
                return Err(AudioInputError::new(
                    "AUDIO_ANALYSIS_PACKET_FAILED",
                    format!("Failed to read audio packet for analysis: {error}"),
                ));
            }
        };

        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                if sample_buf.is_none() {
                    channels = spec.channels.count().max(1);
                    sample_rate = spec.rate.max(1);
                    sample_buf = Some(SampleBuffer::<f32>::new(decoded.capacity() as u64, spec));
                }

                let Some(buffer) = sample_buf.as_mut() else {
                    continue;
                };
                buffer.copy_interleaved_ref(decoded);
                let channels = channels.max(1);
                let samples = buffer.samples();
                let packet_frames = samples.len() / channels;
                if packet_frames == 0 {
                    continue;
                }

                for frame in 0..packet_frames {
                    let offset = frame * channels;
                    if let Some(total_frames) = known_frame_count {
                        let segment_index = ((decoded_frames + frame as u64) as u128)
                            .saturating_mul(segment_count as u128)
                            .checked_div(total_frames as u128)
                            .unwrap_or(0)
                            .min((segment_count - 1) as u128)
                            as usize;
                        for channel in 0..channels {
                            if let Some(sample) = samples.get(offset + channel) {
                                accumulators[segment_index].push(*sample);
                                analyzed_samples = analyzed_samples.saturating_add(1);
                            }
                        }
                    } else {
                        let chunk_index = ((decoded_frames + frame as u64)
                            / UNKNOWN_DURATION_CHUNK_FRAMES)
                            as usize;
                        while unknown_duration_chunks.len() <= chunk_index {
                            unknown_duration_chunks.push(SegmentAccumulator::new());
                        }
                        if let Some(chunk) = unknown_duration_chunks.get_mut(chunk_index) {
                            for channel in 0..channels {
                                if let Some(sample) = samples.get(offset + channel) {
                                    chunk.push(*sample);
                                    analyzed_samples = analyzed_samples.saturating_add(1);
                                }
                            }
                        }
                    }
                }
                decoded_frames = decoded_frames.saturating_add(packet_frames as u64);
            }
            Err(SymphoniaError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(error) => {
                return Err(AudioInputError::new(
                    "AUDIO_ANALYSIS_DECODE_FAILED",
                    format!("Failed to decode audio packet for analysis: {error}"),
                ));
            }
        }
    }

    if decoded_frames == 0 || analyzed_samples == 0 {
        return Err(AudioInputError::new(
            "AUDIO_ANALYSIS_NO_SAMPLES",
            "No audio samples decoded for analysis",
        ));
    }

    if known_frame_count.is_none() {
        for (chunk_index, chunk) in unknown_duration_chunks.iter().enumerate() {
            if chunk.count == 0 {
                continue;
            }
            let chunk_start = chunk_index as u64 * UNKNOWN_DURATION_CHUNK_FRAMES;
            let chunk_center = chunk_start
                .saturating_add(UNKNOWN_DURATION_CHUNK_FRAMES / 2)
                .min(decoded_frames.saturating_sub(1));
            let segment_index = (chunk_center as u128)
                .saturating_mul(segment_count as u128)
                .checked_div(decoded_frames.max(1) as u128)
                .unwrap_or(0)
                .min((segment_count - 1) as u128) as usize;
            accumulators[segment_index].merge(chunk);
        }
    }

    let duration = estimated_frame_count
        .map(|frames| frames as f64 / sample_rate as f64)
        .unwrap_or_else(|| decoded_frames as f64 / sample_rate as f64);
    let segments = accumulators
        .iter()
        .map(SegmentAccumulator::finish)
        .collect::<Vec<_>>();

    Ok(NativeAudioPeakRmsAnalysisPayload {
        version: 1,
        segment_count,
        duration,
        sample_rate,
        channels: channels.max(1),
        frame_count: estimated_frame_count.unwrap_or(decoded_frames),
        decoded_frames,
        analyzed_samples,
        elapsed_ms: started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
        segments,
    })
}

#[cfg(test)]
mod tests {
    use super::{quantize_bipolar, quantize_unipolar};

    #[test]
    fn quantizers_clamp_to_u16_range() {
        assert_eq!(quantize_unipolar(-1.0), 0);
        assert_eq!(quantize_unipolar(0.0), 0);
        assert_eq!(quantize_unipolar(1.0), u16::MAX);
        assert_eq!(quantize_unipolar(2.0), u16::MAX);
        assert_eq!(quantize_bipolar(-1.0), 0);
        assert_eq!(quantize_bipolar(0.0), 32768);
        assert_eq!(quantize_bipolar(1.0), u16::MAX);
    }
}
