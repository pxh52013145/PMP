use rustfft::num_complex::Complex;
use std::sync::Arc;

use crate::audio::{engine::SpectrumFrameSnapshot, events::NativeAudioSpectrumFramePayload};

pub(crate) const SPECTRUM_WINDOW_SIZE: usize = 1024;
pub(crate) const SPECTRUM_BINS: usize = 128;

pub(crate) struct SpectrumComputer {
    hann: [f32; SPECTRUM_WINDOW_SIZE],
    input: [Complex<f32>; SPECTRUM_WINDOW_SIZE],
    mags: [f32; SPECTRUM_BINS],
    bins_u8: [u8; SPECTRUM_BINS],
}

impl SpectrumComputer {
    pub fn new() -> Self {
        let mut hann = [0.0f32; SPECTRUM_WINDOW_SIZE];
        let denom = SPECTRUM_WINDOW_SIZE as f32;
        for frame in 0..SPECTRUM_WINDOW_SIZE {
            hann[frame] = 0.5 - 0.5 * ((2.0 * std::f32::consts::PI * frame as f32) / denom).cos();
        }

        Self {
            hann,
            input: [Complex::new(0.0, 0.0); SPECTRUM_WINDOW_SIZE],
            mags: [0.0f32; SPECTRUM_BINS],
            bins_u8: [0u8; SPECTRUM_BINS],
        }
    }

    pub fn compute_bins_from_window(
        &mut self,
        fft: &Arc<dyn rustfft::Fft<f32>>,
        sample_rate: u32,
        window: &[f32],
    ) -> Option<&[u8]> {
        if sample_rate == 0 {
            return None;
        }

        for frame in 0..SPECTRUM_WINDOW_SIZE {
            let mono = window.get(frame).copied().unwrap_or(0.0);
            self.input[frame].re = mono * self.hann[frame];
            self.input[frame].im = 0.0;
        }

        fft.process(&mut self.input);

        let half = SPECTRUM_WINDOW_SIZE / 2;
        let group = (half / SPECTRUM_BINS).max(1);

        self.mags.fill(0.0);
        let mut max_mag = 0.0f32;
        for i in 0..SPECTRUM_BINS {
            let start = i * group;
            let end = ((i + 1) * group).min(half);
            let mut acc = 0.0f32;
            for k in start..end {
                let c = self.input[k];
                let mag = (c.re * c.re + c.im * c.im).sqrt();
                acc += mag;
            }
            let avg = if end > start {
                acc / (end - start) as f32
            } else {
                0.0
            };
            self.mags[i] = avg;
            if avg > max_mag {
                max_mag = avg;
            }
        }

        let denom = if max_mag > 1e-9 { max_mag } else { 1.0 };
        for (index, mag) in self.mags.iter_mut().enumerate() {
            *mag = (*mag / denom).clamp(0.0, 1.0);
            self.bins_u8[index] = ((*mag) * 255.0).round().clamp(0.0, 255.0) as u8;
        }

        Some(&self.bins_u8)
    }
}

pub(crate) struct DualSpectrumComputer {
    pre: SpectrumComputer,
    post: SpectrumComputer,
}

impl DualSpectrumComputer {
    pub fn new() -> Self {
        Self {
            pre: SpectrumComputer::new(),
            post: SpectrumComputer::new(),
        }
    }

    pub fn compute_pre_frame<'a>(
        &'a mut self,
        fft: &Arc<dyn rustfft::Fft<f32>>,
        snapshot: Option<&SpectrumFrameSnapshot>,
    ) -> Option<NativeAudioSpectrumFramePayload<'a>> {
        self.compute_frame(fft, snapshot, true)
    }

    pub fn compute_post_frame<'a>(
        &'a mut self,
        fft: &Arc<dyn rustfft::Fft<f32>>,
        snapshot: Option<&SpectrumFrameSnapshot>,
    ) -> Option<NativeAudioSpectrumFramePayload<'a>> {
        self.compute_frame(fft, snapshot, false)
    }

    fn compute_frame<'a>(
        &'a mut self,
        fft: &Arc<dyn rustfft::Fft<f32>>,
        snapshot: Option<&SpectrumFrameSnapshot>,
        use_pre: bool,
    ) -> Option<NativeAudioSpectrumFramePayload<'a>> {
        let snapshot = snapshot?;
        let bins = if use_pre {
            self.pre
                .compute_bins_from_window(fft, snapshot.sample_rate, &snapshot.window)?
        } else {
            self.post
                .compute_bins_from_window(fft, snapshot.sample_rate, &snapshot.window)?
        };

        Some(NativeAudioSpectrumFramePayload {
            frame_id: snapshot.frame_id,
            timestamp_ms: snapshot.timestamp_ms,
            tap: snapshot.tap,
            tap_id: Some(match snapshot.tap {
                crate::audio::engine::SpectrumTapKind::PreDsp => "pre-dsp",
                crate::audio::engine::SpectrumTapKind::PostDsp => "post-dsp",
            }),
            sample_rate: snapshot.sample_rate,
            bins,
        })
    }
}
