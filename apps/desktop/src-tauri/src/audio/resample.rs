use crate::audio::policy::{NativeAudioHqSrcPhaseMode, NativeAudioSrcBackend};
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

fn default_sinc_params() -> SincInterpolationParameters {
    SincInterpolationParameters {
        sinc_len: 256,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Cubic,
        oversampling_factor: 128,
        window: WindowFunction::BlackmanHarris2,
    }
}

fn sinc_params_for_hq_mode(
    enabled: bool,
    phase_mode: NativeAudioHqSrcPhaseMode,
) -> SincInterpolationParameters {
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

#[cfg(test)]
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
        NativeAudioSrcBackend::Rubato,
    )
}

pub(crate) fn resample_interleaved_f32_with_policy(
    samples: &[f32],
    input_sample_rate: u32,
    output_sample_rate: u32,
    channels: usize,
    hq_enabled: bool,
    hq_phase_mode: NativeAudioHqSrcPhaseMode,
    backend: NativeAudioSrcBackend,
) -> Result<Vec<f32>, ResampleError> {
    resample_interleaved_f32_with_backend(
        samples,
        input_sample_rate,
        output_sample_rate,
        channels,
        hq_enabled,
        hq_phase_mode,
        backend,
    )
}

pub(crate) fn resample_interleaved_f32_with_backend(
    samples: &[f32],
    input_sample_rate: u32,
    output_sample_rate: u32,
    channels: usize,
    hq_enabled: bool,
    hq_phase_mode: NativeAudioHqSrcPhaseMode,
    backend: NativeAudioSrcBackend,
) -> Result<Vec<f32>, ResampleError> {
    match backend {
        NativeAudioSrcBackend::Rubato => resample_interleaved_f32_rubato(
            samples,
            input_sample_rate,
            output_sample_rate,
            channels,
            hq_enabled,
            hq_phase_mode,
        ),
        NativeAudioSrcBackend::LinearSimd => resample_interleaved_f32_linear_simd(
            samples,
            input_sample_rate,
            output_sample_rate,
            channels,
        ),
    }
}

fn resample_interleaved_f32_rubato(
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

        let (_in_frames, out_frames) = resampler
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

#[inline]
pub(crate) fn lerp_scalar(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "sse2")]
unsafe fn lerp_stereo_sse(a_l: f32, a_r: f32, b_l: f32, b_r: f32, t: f32) -> (f32, f32) {
    use std::arch::x86_64::*;

    let a = _mm_set_ps(0.0, 0.0, a_r, a_l);
    let b = _mm_set_ps(0.0, 0.0, b_r, b_l);
    let frac = _mm_set1_ps(t);
    let out = _mm_add_ps(a, _mm_mul_ps(_mm_sub_ps(b, a), frac));
    let mut tmp = [0.0f32; 4];
    _mm_storeu_ps(tmp.as_mut_ptr(), out);
    (tmp[0], tmp[1])
}

fn resample_interleaved_f32_linear_simd(
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

    let ratio = output_sample_rate as f64 / input_sample_rate as f64;
    let frames_out = ((frames_in as f64) * ratio).round().max(1.0) as usize;
    let step = input_sample_rate as f64 / output_sample_rate as f64;
    let mut out = Vec::<f32>::with_capacity(frames_out.saturating_mul(channels));

    for out_frame in 0..frames_out {
        let src_pos = out_frame as f64 * step;
        let i0 = src_pos.floor() as usize;
        let i1 = (i0 + 1).min(frames_in.saturating_sub(1));
        let frac = (src_pos - i0 as f64) as f32;

        let base0 = i0.saturating_mul(channels);
        let base1 = i1.saturating_mul(channels);

        if channels == 2 {
            #[cfg(target_arch = "x86_64")]
            {
                if std::arch::is_x86_feature_detected!("sse2") {
                    let (l, r) = unsafe {
                        lerp_stereo_sse(
                            samples[base0],
                            samples[base0 + 1],
                            samples[base1],
                            samples[base1 + 1],
                            frac,
                        )
                    };
                    out.push(l);
                    out.push(r);
                    continue;
                }
            }
        }

        for ch in 0..channels {
            out.push(lerp_scalar(samples[base0 + ch], samples[base1 + ch], frac));
        }
    }

    Ok(out)
}

pub(crate) struct StreamingResampler {
    channels: usize,
    chunk_frames: usize,
    backend: StreamingResamplerBackend,
    input: Vec<Vec<f32>>,
    scratch_in: Vec<Vec<f32>>,
    output: Vec<Vec<f32>>,
}

enum StreamingResamplerBackend {
    Rubato(SincFixedIn<f32>),
    LinearSimd(LinearStreamingResamplerState),
}

struct LinearStreamingResamplerState {
    step: f64,
    src_pos: f64,
    carry: Vec<f32>,
    has_carry: bool,
}

impl StreamingResampler {
    fn new_inner_rubato(
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
            backend: StreamingResamplerBackend::Rubato(resampler),
            input,
            scratch_in,
            output,
        })
    }

    fn new_inner_linear_simd(
        input_sample_rate: u32,
        output_sample_rate: u32,
        channels: usize,
        chunk_frames: usize,
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
        let step = input_sample_rate as f64 / output_sample_rate as f64;

        let input = (0..channels)
            .map(|_| Vec::with_capacity(chunk_frames * 2))
            .collect();
        let scratch_in = (0..channels)
            .map(|_| Vec::with_capacity(chunk_frames))
            .collect();

        Ok(Self {
            channels,
            chunk_frames,
            backend: StreamingResamplerBackend::LinearSimd(LinearStreamingResamplerState {
                step,
                src_pos: 0.0,
                carry: vec![0.0; channels],
                has_carry: false,
            }),
            input,
            scratch_in,
            output: Vec::new(),
        })
    }

    #[cfg(test)]
    pub fn new(
        input_sample_rate: u32,
        output_sample_rate: u32,
        channels: usize,
        chunk_frames: usize,
    ) -> Result<Self, ResampleError> {
        let params = default_sinc_params();
        Self::new_inner_rubato(
            input_sample_rate,
            output_sample_rate,
            channels,
            chunk_frames,
            params,
        )
    }

    pub fn new_with_policy(
        input_sample_rate: u32,
        output_sample_rate: u32,
        channels: usize,
        chunk_frames: usize,
        hq_enabled: bool,
        hq_phase_mode: NativeAudioHqSrcPhaseMode,
        backend: NativeAudioSrcBackend,
    ) -> Result<Self, ResampleError> {
        match backend {
            NativeAudioSrcBackend::Rubato => {
                let params = sinc_params_for_hq_mode(hq_enabled, hq_phase_mode);
                Self::new_inner_rubato(
                    input_sample_rate,
                    output_sample_rate,
                    channels,
                    chunk_frames,
                    params,
                )
            }
            NativeAudioSrcBackend::LinearSimd => Self::new_inner_linear_simd(
                input_sample_rate,
                output_sample_rate,
                channels,
                chunk_frames,
            ),
        }
    }

    pub fn reset(&mut self) {
        match &mut self.backend {
            StreamingResamplerBackend::Rubato(resampler) => resampler.reset(),
            StreamingResamplerBackend::LinearSimd(state) => {
                state.src_pos = 0.0;
                state.has_carry = false;
            }
        }
        for channel in &mut self.input {
            channel.clear();
        }
        for channel in &mut self.scratch_in {
            channel.clear();
        }
    }

    pub fn output_delay(&self) -> usize {
        match &self.backend {
            StreamingResamplerBackend::Rubato(resampler) => resampler.output_delay(),
            StreamingResamplerBackend::LinearSimd(_) => 0,
        }
    }

    pub fn process_interleaved_into(
        &mut self,
        input_interleaved: &[f32],
        out_interleaved: &mut Vec<f32>,
    ) {
        out_interleaved.clear();
        let frames = input_interleaved.len() / self.channels;
        if frames == 0 {
            return;
        }

        if out_interleaved.capacity() < input_interleaved.len() {
            crate::audio::memory_pool::reserve_f32_capacity(
                out_interleaved,
                input_interleaved.len(),
                "memory_pool.resample.output_growth",
            );
        }
        for frame in 0..frames {
            for ch in 0..self.channels {
                self.input[ch].push(input_interleaved[frame * self.channels + ch]);
            }
        }

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

            match &mut self.backend {
                StreamingResamplerBackend::Rubato(resampler) => {
                    let (_in_frames, out_frames) = match resampler.process_into_buffer(
                        &self.scratch_in,
                        &mut self.output,
                        None,
                    ) {
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
                StreamingResamplerBackend::LinearSimd(state) => {
                    let frames_in = self.scratch_in[0].len();
                    if frames_in == 0 {
                        continue;
                    }

                    let had_carry = state.has_carry;
                    let max_frame = if had_carry {
                        frames_in
                    } else {
                        frames_in.saturating_sub(1)
                    };

                    if max_frame == 0 {
                        for ch in 0..self.channels {
                            state.carry[ch] = self.scratch_in[ch][frames_in - 1];
                        }
                        state.has_carry = true;
                        continue;
                    }

                    while state.src_pos < max_frame as f64 {
                        let i0 = state.src_pos.floor() as usize;
                        let i1 = (i0 + 1).min(max_frame);
                        let frac = (state.src_pos - i0 as f64) as f32;

                        let sample_at = |channel: usize, frame: usize| -> f32 {
                            if had_carry {
                                if frame == 0 {
                                    state.carry[channel]
                                } else {
                                    self.scratch_in[channel][frame - 1]
                                }
                            } else {
                                self.scratch_in[channel][frame]
                            }
                        };

                        if self.channels == 2 {
                            #[cfg(target_arch = "x86_64")]
                            {
                                if std::arch::is_x86_feature_detected!("sse2") {
                                    let (l, r) = unsafe {
                                        lerp_stereo_sse(
                                            sample_at(0, i0),
                                            sample_at(1, i0),
                                            sample_at(0, i1),
                                            sample_at(1, i1),
                                            frac,
                                        )
                                    };
                                    out_interleaved.push(l);
                                    out_interleaved.push(r);
                                    state.src_pos += state.step;
                                    continue;
                                }
                            }
                        }

                        for ch in 0..self.channels {
                            out_interleaved.push(lerp_scalar(
                                sample_at(ch, i0),
                                sample_at(ch, i1),
                                frac,
                            ));
                        }
                        state.src_pos += state.step;
                    }

                    let shift = frames_in as f64 - if had_carry { 0.0 } else { 1.0 };
                    state.src_pos -= shift;
                    if state.src_pos < 0.0 {
                        state.src_pos = 0.0;
                    }

                    for ch in 0..self.channels {
                        state.carry[ch] = self.scratch_in[ch][frames_in - 1];
                    }
                    state.has_carry = true;
                }
            }
        }
    }

    pub fn process_interleaved(&mut self, input_interleaved: &[f32]) -> Vec<f32> {
        let mut out_interleaved: Vec<f32> = Vec::new();
        self.process_interleaved_into(input_interleaved, &mut out_interleaved);
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
        let expected_without_flush = expected - resampler.output_delay() as isize;
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
                NativeAudioSrcBackend::Rubato,
            )
            .expect("hq resample");
            assert!(!out.is_empty());
            assert!(out.iter().all(|sample| sample.is_finite()));
        }
    }

    #[test]
    fn linear_simd_backend_produces_finite_output() {
        let channels = 2usize;
        let in_sr = 44_100u32;
        let out_sr = 48_000u32;
        let frames_in = 2_048usize;

        let mut input = vec![0.0f32; frames_in * channels];
        for frame in 0..frames_in {
            let t = frame as f32 / in_sr as f32;
            let sample = (2.0 * std::f32::consts::PI * 440.0 * t).sin();
            input[frame * channels] = sample;
            input[frame * channels + 1] = sample;
        }

        let out = resample_interleaved_f32_with_policy(
            &input,
            in_sr,
            out_sr,
            channels,
            false,
            NativeAudioHqSrcPhaseMode::Linear,
            NativeAudioSrcBackend::LinearSimd,
        )
        .expect("linear-simd resample");

        assert!(!out.is_empty());
        assert!(out.iter().all(|sample| sample.is_finite()));
        assert_eq!(out.len() % channels, 0);
    }

    #[test]
    fn streaming_linear_simd_produces_output() {
        let channels = 2usize;
        let in_sr = 44_100u32;
        let out_sr = 48_000u32;
        let chunk_frames = 256usize;

        let mut resampler = StreamingResampler::new_with_policy(
            in_sr,
            out_sr,
            channels,
            chunk_frames,
            false,
            NativeAudioHqSrcPhaseMode::Linear,
            NativeAudioSrcBackend::LinearSimd,
        )
        .expect("init ok");

        let input = vec![0.1f32; chunk_frames * channels * 3];
        let out = resampler.process_interleaved(&input);
        assert!(!out.is_empty());
        assert!(out.iter().all(|sample| sample.is_finite()));
        assert_eq!(out.len() % channels, 0);
    }

    #[test]
    fn streaming_linear_simd_matches_offline_without_boundary_glitch() {
        let channels = 2usize;
        let in_sr = 44_100u32;
        let out_sr = 48_000u32;
        let chunk_frames = 256usize;
        let total_frames = chunk_frames * 24;

        let mut input = vec![0.0f32; total_frames * channels];
        for frame in 0..total_frames {
            let t = frame as f32 / in_sr as f32;
            let sample = (2.0 * std::f32::consts::PI * 997.0 * t).sin() * 0.7;
            input[frame * channels] = sample;
            input[frame * channels + 1] = sample;
        }

        let offline = resample_interleaved_f32_with_policy(
            &input,
            in_sr,
            out_sr,
            channels,
            false,
            NativeAudioHqSrcPhaseMode::Linear,
            NativeAudioSrcBackend::LinearSimd,
        )
        .expect("offline linear-simd");

        let mut streaming = StreamingResampler::new_with_policy(
            in_sr,
            out_sr,
            channels,
            chunk_frames,
            false,
            NativeAudioHqSrcPhaseMode::Linear,
            NativeAudioSrcBackend::LinearSimd,
        )
        .expect("streaming linear-simd init");

        let mut streamed = Vec::new();
        for chunk in input.chunks(chunk_frames * channels) {
            streamed.extend_from_slice(&streaming.process_interleaved(chunk));
        }

        let aligned = streamed.len().min(offline.len());
        assert!(aligned > channels * 128, "aligned={aligned}");

        let mut max_abs_err = 0.0f32;
        let mut sum_abs_err = 0.0f64;
        let mut compared = 0usize;
        for index in (channels * 8)..aligned {
            let err = (streamed[index] - offline[index]).abs();
            max_abs_err = max_abs_err.max(err);
            sum_abs_err += err as f64;
            compared += 1;
        }

        let mean_abs_err = if compared > 0 {
            sum_abs_err / compared as f64
        } else {
            0.0
        };

        assert!(
            max_abs_err < 0.03,
            "max_abs_err={max_abs_err} streamed_len={} offline_len={}",
            streamed.len(),
            offline.len()
        );
        assert!(
            mean_abs_err < 0.006,
            "mean_abs_err={mean_abs_err} streamed_len={} offline_len={}",
            streamed.len(),
            offline.len()
        );
    }
}
