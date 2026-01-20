use rustfft::num_complex::Complex;
use std::sync::Arc;

use crate::audio::pipeline::SpectrumSnapshot;

pub(crate) const SPECTRUM_WINDOW_SIZE: usize = 1024;
pub(crate) const SPECTRUM_BINS: usize = 128;

pub(crate) struct SpectrumComputer {
    hann: [f32; SPECTRUM_WINDOW_SIZE],
    input: [Complex<f32>; SPECTRUM_WINDOW_SIZE],
    mags: [f32; SPECTRUM_BINS],
}

impl SpectrumComputer {
    pub fn new() -> Self {
        let mut hann = [0.0f32; SPECTRUM_WINDOW_SIZE];
        let denom = SPECTRUM_WINDOW_SIZE as f32;
        for frame in 0..SPECTRUM_WINDOW_SIZE {
            hann[frame] =
                0.5 - 0.5 * ((2.0 * std::f32::consts::PI * frame as f32) / denom).cos();
        }

        Self {
            hann,
            input: [Complex::new(0.0, 0.0); SPECTRUM_WINDOW_SIZE],
            mags: [0.0f32; SPECTRUM_BINS],
        }
    }

    pub fn compute_bins(
        &mut self,
        fft: &Arc<dyn rustfft::Fft<f32>>,
        snapshot: &SpectrumSnapshot,
    ) -> Option<&[f32]> {
        if snapshot.sample_rate == 0 {
            return None;
        }

        for frame in 0..SPECTRUM_WINDOW_SIZE {
            let mono = snapshot.window.get(frame).copied().unwrap_or(0.0);
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
        for mag in self.mags.iter_mut() {
            *mag = (*mag / denom).clamp(0.0, 1.0);
        }

        Some(&self.mags)
    }
}
