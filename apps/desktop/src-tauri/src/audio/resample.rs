use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};
use crate::audio::policy::NativeAudioHqSrcPhaseMode;

#[derive(Clone, Debug)]
pub(crate) struct ResampleError {
    pub code: &'static str,
    pub message: String,
}

impl ResampleError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

fn default_sinc_params() -> SincInterpolationParameters {
    SincInterpolationParameters {
        sinc_len: 256,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Cubic,
        oversampling_factor: 128,
        window: WindowFunction::BlackmanHarris2,
    }
}

fn sinc_params_for_hq_mode(enabled: bool, phase_mode: NativeAudioHqSrcPhaseMode) -> SincInterpolationParameters {
    if !enabled {
        return default_sinc_params();
    }

    match phase_mode {
        NativeAudioHqSrcPhaseMode::Linear => SincInterpolationParameters {
            sinc_len: 384,
            f_cutoff: 0.97,
            interpolation: SincInterpolationType::Cubic,
            oversampling_factor: 256,
            window: WindowFunction::BlackmanHarris2,
        },
        NativeAudioHqSrcPhaseMode::Intermediate => SincInterpolationParameters {
            sinc_len: 320,
            f_cutoff: 0.965,
            interpolation: SincInterpolationType::Cubic,
            oversampling_factor: 192,
            window: WindowFunction::BlackmanHarris2,
        },
        NativeAudioHqSrcPhaseMode::Minimum => SincInterpolationParameters {
            sinc_len: 256,
            f_cutoff: 0.95,
            interpolation: SincInterpolationType::Quadratic,
            oversampling_factor: 128,
            window: WindowFunction::BlackmanHarris2,
        },
    }
}

pub(crate) fn resample_interleaved_f32(
    samples: &[f32],
    input_sample_rate: u32,
    output_sample_rate: u32,
    channels: usize,
) -> Result<Vec<f32>, ResampleError> {
    resample_interleaved_f32_with_policy(
        samples,
        input_sample_rate,
        output_sample_rate,
        channels,
        true,
        NativeAudioHqSrcPhaseMode::Linear,
    )
}

pub(crate) fn resample_interleaved_f32_with_policy(
    samples: &[f32],
    input_sample_rate: u32,
    output_sample_rate: u32,
    channels: usize,
    hq_enabled: bool,
    hq_phase_mode: NativeAudioHqSrcPhaseMode,
) -> Result<Vec<f32>, ResampleError> {
    if channels == 0 {
        return Err(ResampleError::new(
            "AUDIO_INPUT_RESAMPLE_INVALID_CHANNELS",
            "Channels must be > 0",
        ));
    }

    let input_sample_rate = input_sample_rate.max(1);
    let output_sample_rate = output_sample_rate.max(1);
    if input_sample_rate == output_sample_rate {
        return Ok(samples.to_vec());
    }

    let frames_in = samples.len() / channels;
    if frames_in == 0 {
        return Ok(Vec::new());
    }

    let params = sinc_params_for_hq_mode(hq_enabled, hq_phase_mode);

    let ratio = output_sample_rate as f64 / input_sample_rate as f64;
    let chunk_size = 2048usize;
    let mut resampler =
        SincFixedIn::<f32>::new(ratio, 1.0, params, chunk_size, channels).map_err(|e| {
            ResampleError::new(
                "AUDIO_INPUT_RESAMPLER_INIT_FAILED",
                format!("Failed to init resampler: {e}"),
            )
        })?;

    let expected_out_frames = ((frames_in as f64) * ratio).round().max(0.0) as usize;
    let mut out_interleaved =
        Vec::with_capacity(expected_out_frames.saturating_mul(channels.max(1)));

    let mut scratch_in: Vec<Vec<f32>> = (0..channels)
        .map(|_| Vec::with_capacity(chunk_size))
        .collect();
    let mut output = resampler.output_buffer_allocate(true);

    let mut start = 0usize;
    while start < frames_in {
        let end = (start + chunk_size).min(frames_in);
        let block_len = end - start;

        for channel in &mut scratch_in {
            channel.clear();
        }

        for frame in start..end {
            let base = frame * channels;
            for ch in 0..channels {
                scratch_in[ch].push(samples[base + ch]);
            }
        }

        if block_len < chunk_size {
            for channel in &mut scratch_in {
                channel.resize(chunk_size, 0.0);
            }
        }

        let (_in_frames, out_frames) =
            resampler
                .process_into_buffer(&scratch_in, &mut output, None)
                .map_err(|e| {
                    ResampleError::new(
                        "AUDIO_INPUT_RESAMPLE_FAILED",
                        format!("Resample failed: {e}"),
                    )
                })?;

        for frame in 0..out_frames {
            for ch in 0..channels {
                out_interleaved.push(output[ch][frame]);
            }
        }

        start = end;
    }

    let out_frames_total = out_interleaved.len() / channels;
    let out_frames = expected_out_frames.min(out_frames_total);
    out_interleaved.truncate(out_frames * channels);

    Ok(out_interleaved)
}

pub(crate) struct StreamingResampler {
    channels: usize,
    chunk_frames: usize,
    resampler: SincFixedIn<f32>,
    input: Vec<Vec<f32>>,
    scratch_in: Vec<Vec<f32>>,
    output: Vec<Vec<f32>>,
}

impl StreamingResampler {
    fn new_inner(
        input_sample_rate: u32,
        output_sample_rate: u32,
        channels: usize,
        chunk_frames: usize,
        params: SincInterpolationParameters,
    ) -> Result<Self, ResampleError> {
        if channels == 0 {
            return Err(ResampleError::new(
                "AUDIO_INPUT_RESAMPLE_INVALID_CHANNELS",
                "Channels must be > 0",
            ));
        }
        if chunk_frames == 0 {
            return Err(ResampleError::new(
                "AUDIO_INPUT_RESAMPLE_INVALID_CHUNK",
                "Chunk frames must be > 0",
            ));
        }

        let input_sample_rate = input_sample_rate.max(1);
        let output_sample_rate = output_sample_rate.max(1);
        let ratio = output_sample_rate as f64 / input_sample_rate as f64;
        let resampler = SincFixedIn::<f32>::new(ratio, 1.0, params, chunk_frames, channels)
            .map_err(|e| {
                ResampleError::new(
                    "AUDIO_INPUT_RESAMPLER_INIT_FAILED",
                    format!("Failed to init resampler: {e}"),
                )
            })?;

        let input = (0..channels)
            .map(|_| Vec::with_capacity(chunk_frames * 2))
            .collect();
        let scratch_in = (0..channels)
            .map(|_| Vec::with_capacity(chunk_frames))
            .collect();
        let output = resampler.output_buffer_allocate(true);

        Ok(Self {
            channels,
            chunk_frames,
            resampler,
            input,
            scratch_in,
            output,
        })
    }

    pub fn new(
        input_sample_rate: u32,
        output_sample_rate: u32,
        channels: usize,
        chunk_frames: usize,
    ) -> Result<Self, ResampleError> {
        let params = default_sinc_params();
        Self::new_inner(
            input_sample_rate,
            output_sample_rate,
            channels,
            chunk_frames,
            params,
        )
    }

    pub fn reset(&mut self) {
        self.resampler.reset();
        for channel in &mut self.input {
            channel.clear();
        }
        for channel in &mut self.scratch_in {
            channel.clear();
        }
    }

    pub fn process_interleaved(&mut self, input_interleaved: &[f32]) -> Vec<f32> {
        let frames = input_interleaved.len() / self.channels;
        for frame in 0..frames {
            for ch in 0..self.channels {
                self.input[ch].push(input_interleaved[frame * self.channels + ch]);
            }
        }

        let mut out_interleaved: Vec<f32> = Vec::new();
        while self
            .input
            .iter()
            .all(|channel| channel.len() >= self.chunk_frames)
        {
            for ch in 0..self.channels {
                self.scratch_in[ch].clear();
                if self.input[ch].len() == self.chunk_frames {
                    std::mem::swap(&mut self.scratch_in[ch], &mut self.input[ch]);
                } else {
                    self.scratch_in[ch].extend(self.input[ch].drain(0..self.chunk_frames));
                }
            }

            let (_in_frames, out_frames) =
                match self
                    .resampler
                    .process_into_buffer(&self.scratch_in, &mut self.output, None)
                {
                    Ok(value) => value,
                    Err(_) => break,
                };
            if out_frames == 0 {
                continue;
            }

            for frame in 0..out_frames {
                for ch in 0..self.channels {
                    out_interleaved.push(self.output[ch][frame]);
                }
            }
        }

        out_interleaved
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_rejects_zero_channels() {
        let err = resample_interleaved_f32(&[0.0, 0.0], 44_100, 48_000, 0)
            .expect_err("expected invalid channels");
        assert_eq!(err.code, "AUDIO_INPUT_RESAMPLE_INVALID_CHANNELS");
    }

    #[test]
    fn resample_returns_identity_when_sample_rate_matches() {
        let input = vec![0.0f32, 0.1, -0.2, 0.3];
        let out = resample_interleaved_f32(&input, 48_000, 48_000, 2).expect("resample ok");
        assert_eq!(out, input);
    }

    #[test]
    fn resample_stereo_length_scales_with_ratio() {
        let channels = 2usize;
        let in_sr = 44_100u32;
        let out_sr = 48_000u32;
        let frames_in = 4_410usize; // 0.1s

        let mut input = vec![0.0f32; frames_in * channels];
        for frame in 0..frames_in {
            let t = frame as f32 / in_sr as f32;
            let sample = (2.0 * std::f32::consts::PI * 440.0 * t).sin();
            input[frame * channels] = sample;
            input[frame * channels + 1] = sample;
        }

        let out = resample_interleaved_f32(&input, in_sr, out_sr, channels).expect("resample ok");
        assert!(out.iter().all(|v| v.is_finite()));

        let frames_out = out.len() / channels;
        let expected = ((frames_in as f64) * (out_sr as f64 / in_sr as f64)).round() as isize;
        let delta = (frames_out as isize - expected).abs();
        assert!(delta <= 2, "frames_out={frames_out} expected={expected}");
    }

    #[test]
    fn streaming_resampler_emits_frames_only_after_full_chunk() {
        let channels = 2usize;
        let chunk_frames = 256usize;
        let in_sr = 44_100u32;
        let out_sr = 48_000u32;

        let mut resampler =
            StreamingResampler::new(in_sr, out_sr, channels, chunk_frames).expect("init ok");

        let first = vec![0.0f32; (chunk_frames / 2) * channels];
        let out = resampler.process_interleaved(&first);
        assert!(out.is_empty());

        let second = vec![0.0f32; (chunk_frames / 2) * channels];
        let out = resampler.process_interleaved(&second);
        assert!(!out.is_empty());
        assert_eq!(out.len() % channels, 0);
    }

    #[test]
    fn streaming_resampler_length_scales_with_ratio() {
        let channels = 2usize;
        let chunk_frames = 512usize;
        let in_sr = 44_100u32;
        let out_sr = 48_000u32;
        let frames_in = chunk_frames * 4;

        let mut input = vec![0.0f32; frames_in * channels];
        for frame in 0..frames_in {
            let t = frame as f32 / in_sr as f32;
            let sample = (2.0 * std::f32::consts::PI * 440.0 * t).sin();
            input[frame * channels] = sample;
            input[frame * channels + 1] = sample;
        }

        let mut resampler =
            StreamingResampler::new(in_sr, out_sr, channels, chunk_frames).expect("init ok");

        let mut out = Vec::new();
        for chunk in input.chunks(300 * channels) {
            out.extend_from_slice(&resampler.process_interleaved(chunk));
        }

        assert!(out.iter().all(|v| v.is_finite()));
        assert_eq!(out.len() % channels, 0);

        let frames_out = out.len() / channels;
        let expected = ((frames_in as f64) * (out_sr as f64 / in_sr as f64)).round() as isize;
        let expected_without_flush = expected - resampler.resampler.output_delay() as isize;
        let delta = (frames_out as isize - expected_without_flush).abs();
        assert!(
            delta <= 4,
            "frames_out={frames_out} expected={expected_without_flush} (unflushed)"
        );
    }

    #[test]
    fn hq_mode_variants_produce_finite_output() {
        let channels = 2usize;
        let in_sr = 44_100u32;
        let out_sr = 48_000u32;
        let frames_in = 2_048usize;

        let mut input = vec![0.0f32; frames_in * channels];
        for frame in 0..frames_in {
            let t = frame as f32 / in_sr as f32;
            let sample = (2.0 * std::f32::consts::PI * 880.0 * t).sin();
            input[frame * channels] = sample;
            input[frame * channels + 1] = sample;
        }

        for phase in [
            NativeAudioHqSrcPhaseMode::Linear,
            NativeAudioHqSrcPhaseMode::Intermediate,
            NativeAudioHqSrcPhaseMode::Minimum,
        ] {
            let out = resample_interleaved_f32_with_policy(
                &input,
                in_sr,
                out_sr,
                channels,
                true,
                phase,
            )
            .expect("hq resample");
            assert!(!out.is_empty());
            assert!(out.iter().all(|sample| sample.is_finite()));
        }
    }
}
