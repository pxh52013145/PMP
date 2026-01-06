use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};

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

pub(crate) fn resample_interleaved_f32(
    samples: &[f32],
    input_sample_rate: u32,
    output_sample_rate: u32,
    channels: usize,
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

    let params = SincInterpolationParameters {
        sinc_len: 256,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Cubic,
        oversampling_factor: 128,
        window: WindowFunction::BlackmanHarris2,
    };

    let ratio = output_sample_rate as f64 / input_sample_rate as f64;
    let chunk_size = 2048usize;
    let mut resampler =
        SincFixedIn::<f32>::new(ratio, 1.0, params, chunk_size, channels).map_err(|e| {
            ResampleError::new(
                "AUDIO_INPUT_RESAMPLER_INIT_FAILED",
                format!("Failed to init resampler: {e}"),
            )
        })?;

    let mut per_channel: Vec<Vec<f32>> = (0..channels)
        .map(|_| Vec::with_capacity(frames_in))
        .collect();
    for frame in 0..frames_in {
        for ch in 0..channels {
            per_channel[ch].push(samples[frame * channels + ch]);
        }
    }

    let expected_out_frames = ((frames_in as f64) * ratio).round().max(0.0) as usize;
    let mut out_per_channel: Vec<Vec<f32>> = (0..channels)
        .map(|_| Vec::with_capacity(expected_out_frames))
        .collect();

    let mut start = 0usize;
    while start < frames_in {
        let end = (start + chunk_size).min(frames_in);
        let block_len = end - start;

        let mut input_block: Vec<Vec<f32>> = Vec::with_capacity(channels);
        for ch in 0..channels {
            let mut block = per_channel[ch][start..end].to_vec();
            if block_len < chunk_size {
                block.resize(chunk_size, 0.0);
            }
            input_block.push(block);
        }

        let output_block = resampler.process(&input_block, None).map_err(|e| {
            ResampleError::new(
                "AUDIO_INPUT_RESAMPLE_FAILED",
                format!("Resample failed: {e}"),
            )
        })?;

        for ch in 0..channels {
            out_per_channel[ch].extend_from_slice(&output_block[ch]);
        }

        start = end;
    }

    let out_frames_total = out_per_channel.get(0).map(|v| v.len()).unwrap_or(0);
    let out_frames = expected_out_frames.min(out_frames_total);
    let mut out_interleaved = Vec::with_capacity(out_frames * channels);
    for frame in 0..out_frames {
        for ch in 0..channels {
            if let Some(sample) = out_per_channel[ch].get(frame) {
                out_interleaved.push(*sample);
            }
        }
    }

    Ok(out_interleaved)
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
}
