use rustfft::num_complex::Complex;
use std::sync::Arc;

use crate::audio::pipeline::SpectrumSnapshot;

pub(crate) fn compute_spectrum_bins(
    fft: &Arc<dyn rustfft::Fft<f32>>,
    snapshot: &SpectrumSnapshot,
) -> Option<Vec<f32>> {
    if snapshot.sample_rate == 0 {
        return None;
    }

    let window_size = 1024usize;
    let mut input: Vec<Complex<f32>> = Vec::with_capacity(window_size);
    for frame in 0..window_size {
        let mono = snapshot.window.get(frame).copied().unwrap_or(0.0);
        let hann = 0.5
            - 0.5 * ((2.0 * std::f32::consts::PI * frame as f32) / window_size as f32).cos();
        input.push(Complex::new(mono * hann, 0.0));
    }

    fft.process(&mut input);

    let half = window_size / 2;
    let bins = 128usize;
    let group = (half / bins).max(1);

    let mut mags = vec![0.0f32; bins];
    let mut max_mag = 0.0f32;
    for i in 0..bins {
        let start = i * group;
        let end = ((i + 1) * group).min(half);
        let mut acc = 0.0f32;
        for k in start..end {
            let c = input[k];
            let mag = (c.re * c.re + c.im * c.im).sqrt();
            acc += mag;
        }
        let avg = if end > start {
            acc / (end - start) as f32
        } else {
            0.0
        };
        mags[i] = avg;
        if avg > max_mag {
            max_mag = avg;
        }
    }

    let denom = if max_mag > 1e-9 { max_mag } else { 1.0 };
    for mag in mags.iter_mut() {
        *mag = (*mag / denom).clamp(0.0, 1.0);
    }

    Some(mags)
}

