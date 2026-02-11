use rodio::Source;
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        Arc, Condvar, Mutex,
    },
    time::Duration,
};

use crate::audio::atomic_f32::{load_atomic_f32, store_atomic_f32};
use crate::audio::output::BoxedSource;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EqBandKind {
    Peaking,
    LowShelf,
    HighShelf,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EqBandConfig {
    kind: EqBandKind,
    frequency_hz: f32,
    q: f32,
    gain_db: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum DspNodeConfig {
    Gain {
        db: f32,
    },
    Eq {
        bands: Vec<EqBandConfig>,
    },
    Limiter {
        #[serde(rename = "thresholdDb")]
        threshold_db: f32,
    },
    Vst {
        id: String,
        #[serde(rename = "pluginId")]
        plugin_id: String,
    },
}

fn gain_db_to_linear(db: f32) -> f32 {
    10.0f32.powf(db / 20.0)
}

#[derive(Clone, Debug, Default, PartialEq)]
struct DspSlowConfig {
    eq_bands: Vec<EqBandConfig>,
    limiter_threshold_db: Option<f32>,
    vst_nodes: Vec<crate::vst_dsp::VstNodeKey>,
}

#[derive(Clone, Debug)]
struct DspRuntimeConfig {
    gain_linear: f32,
    eq_bands: Vec<EqBandConfig>,
    limiter_threshold_db: Option<f32>,
    vst_nodes: Vec<crate::vst_dsp::VstNodeKey>,
}

impl Default for DspRuntimeConfig {
    fn default() -> Self {
        Self {
            gain_linear: 1.0,
            eq_bands: Vec::new(),
            limiter_threshold_db: None,
            vst_nodes: Vec::new(),
        }
    }
}

pub(crate) struct DspRuntime {
    slow_config: Mutex<Arc<DspSlowConfig>>,
    slow_version: AtomicU64,
    slow_update_lock: Mutex<()>,
    slow_update_cv: Condvar,
    gain_db_bits: AtomicU32,
    replay_gain_db_bits: AtomicU32,
    gain_linear_bits: AtomicU32,
    reset_serial: AtomicU64,
}

impl DspRuntime {
    pub(crate) fn new() -> Self {
        Self {
            slow_config: Mutex::new(Arc::new(DspSlowConfig::default())),
            slow_version: AtomicU64::new(1),
            slow_update_lock: Mutex::new(()),
            slow_update_cv: Condvar::new(),
            gain_db_bits: AtomicU32::new(0.0f32.to_bits()),
            replay_gain_db_bits: AtomicU32::new(0.0f32.to_bits()),
            gain_linear_bits: AtomicU32::new(1.0f32.to_bits()),
            reset_serial: AtomicU64::new(1),
        }
    }

    fn version(&self) -> u64 {
        self.slow_version.load(Ordering::Acquire)
    }

    fn bump_slow_version(&self) -> u64 {
        let _guard = match self.slow_update_lock.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let version = self
            .slow_version
            .fetch_add(1, Ordering::AcqRel)
            .saturating_add(1);
        self.slow_update_cv.notify_all();
        version
    }

    fn wait_for_slow_version_change(&self, last_seen: u64, stop: &AtomicBool) -> u64 {
        let mut guard = match self.slow_update_lock.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        while !stop.load(Ordering::Acquire) {
            let current = self.version();
            if current != last_seen {
                return current;
            }

            guard = match self.slow_update_cv.wait(guard) {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
        }

        self.version()
    }

    fn wake_slow_update_waiters(&self) {
        let _guard = match self.slow_update_lock.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        self.slow_update_cv.notify_all();
    }

    fn reset_serial(&self) -> u64 {
        self.reset_serial.load(Ordering::Acquire)
    }

    pub(crate) fn request_reset(&self) {
        self.reset_serial.fetch_add(1, Ordering::AcqRel);
    }

    fn gain_linear(&self) -> f32 {
        load_atomic_f32(&self.gain_linear_bits)
    }

    fn slow_config(&self) -> Arc<DspSlowConfig> {
        match self.slow_config.lock() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    #[cfg(test)]
    fn gain_db(&self) -> f32 {
        let gain_db = load_atomic_f32(&self.gain_db_bits);
        if gain_db.is_finite() {
            gain_db
        } else {
            0.0
        }
    }

    #[cfg(test)]
    fn replay_gain_db(&self) -> f32 {
        let replay_gain_db = load_atomic_f32(&self.replay_gain_db_bits);
        if replay_gain_db.is_finite() {
            replay_gain_db
        } else {
            0.0
        }
    }

    fn snapshot(&self) -> DspRuntimeConfig {
        let gain_linear = load_atomic_f32(&self.gain_linear_bits);
        let slow = self.slow_config();

        DspRuntimeConfig {
            gain_linear,
            eq_bands: slow.eq_bands.clone(),
            limiter_threshold_db: slow.limiter_threshold_db,
            vst_nodes: slow.vst_nodes.clone(),
        }
    }

    pub(crate) fn apply_chain(&self, chain: &[DspNodeConfig]) -> f32 {
        let mut gain_db = 0.0f32;
        let mut eq_bands: Vec<EqBandConfig> = Vec::new();
        let mut limiter_threshold_db: Option<f32> = None;

        for node in chain {
            match node {
                DspNodeConfig::Gain { db } => gain_db += *db,
                DspNodeConfig::Eq { bands } => {
                    for band in bands {
                        if !band.frequency_hz.is_finite() {
                            continue;
                        }
                        let q = if band.q.is_finite() { band.q } else { 0.707 };
                        let gain_db = if band.gain_db.is_finite() { band.gain_db } else { 0.0 };
                        eq_bands.push(EqBandConfig {
                            kind: band.kind,
                            frequency_hz: band.frequency_hz,
                            q,
                            gain_db,
                        });
                    }
                }
                DspNodeConfig::Limiter { threshold_db } => {
                    if threshold_db.is_finite() {
                        limiter_threshold_db = Some(threshold_db.clamp(-30.0, 0.0));
                    } else {
                        limiter_threshold_db = None;
                    }
                }
                DspNodeConfig::Vst { .. } => {}
            }
        }

        let gain_db = gain_db.clamp(-60.0, 12.0);
        store_atomic_f32(&self.gain_db_bits, gain_db);

        let replay_gain_db = load_atomic_f32(&self.replay_gain_db_bits);
        let replay_gain_db = if replay_gain_db.is_finite() {
            replay_gain_db
        } else {
            0.0
        };
        let total_gain_db = (gain_db + replay_gain_db).clamp(-60.0, 12.0);
        store_atomic_f32(&self.gain_linear_bits, gain_db_to_linear(total_gain_db));

        let mut guard = match self.slow_config.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let current = guard.as_ref();
        if current.eq_bands != eq_bands || current.limiter_threshold_db != limiter_threshold_db {
            *guard = Arc::new(DspSlowConfig {
                eq_bands,
                limiter_threshold_db,
                vst_nodes: current.vst_nodes.clone(),
            });
            self.bump_slow_version();
        }

        gain_db
    }

    pub(crate) fn set_replay_gain_db(&self, replay_gain_db: f32) -> f32 {
        let replay_gain_db = if replay_gain_db.is_finite() {
            replay_gain_db.clamp(-30.0, 30.0)
        } else {
            0.0
        };

        store_atomic_f32(&self.replay_gain_db_bits, replay_gain_db);
        let gain_db = load_atomic_f32(&self.gain_db_bits);
        let gain_db = if gain_db.is_finite() { gain_db } else { 0.0 };
        let total_gain_db = (gain_db + replay_gain_db).clamp(-60.0, 12.0);
        store_atomic_f32(&self.gain_linear_bits, gain_db_to_linear(total_gain_db));
        replay_gain_db
    }

    pub(crate) fn set_vst_nodes(&self, nodes: Vec<crate::vst_dsp::VstNodeKey>) {
        let mut guard = match self.slow_config.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let current = guard.as_ref();
        if current.vst_nodes == nodes {
            return;
        }

        *guard = Arc::new(DspSlowConfig {
            eq_bands: current.eq_bands.clone(),
            limiter_threshold_db: current.limiter_threshold_db,
            vst_nodes: nodes,
        });
        self.bump_slow_version();
    }
}

#[derive(Clone, Copy, Debug)]
struct BiquadCoeffs {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
}

impl BiquadCoeffs {
    fn identity() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
        }
    }

    fn from_eq_band(band: &EqBandConfig, sample_rate: u32) -> Self {
        let fs = sample_rate as f32;
        if fs <= 0.0 {
            return Self::identity();
        }

        let nyquist = fs * 0.5;
        let mut f0 = band.frequency_hz;
        if !f0.is_finite() {
            return Self::identity();
        }
        f0 = f0.clamp(10.0, nyquist.max(10.0) - 10.0);

        let mut q = band.q;
        if !q.is_finite() {
            q = 0.707;
        }
        q = q.clamp(0.1, 8.0);

        let gain_db = if band.gain_db.is_finite() {
            band.gain_db.clamp(-24.0, 24.0)
        } else {
            0.0
        };

        let w0 = 2.0 * std::f32::consts::PI * (f0 / fs);
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();

        match band.kind {
            EqBandKind::Peaking => {
                let a = 10.0f32.powf(gain_db / 40.0);
                let alpha = sin_w0 / (2.0 * q);
                let b0 = 1.0 + alpha * a;
                let b1 = -2.0 * cos_w0;
                let b2 = 1.0 - alpha * a;
                let a0 = 1.0 + alpha / a;
                let a1 = -2.0 * cos_w0;
                let a2 = 1.0 - alpha / a;
                normalize_biquad(b0, b1, b2, a0, a1, a2)
            }
            EqBandKind::LowShelf => {
                let a = 10.0f32.powf(gain_db / 40.0);
                let slope = q.clamp(0.1, 4.0);
                let alpha = sin_w0 / 2.0 * ((a + 1.0 / a) * (1.0 / slope - 1.0) + 2.0).sqrt();
                let beta = 2.0 * a.sqrt() * alpha;
                let b0 = a * ((a + 1.0) - (a - 1.0) * cos_w0 + beta);
                let b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0);
                let b2 = a * ((a + 1.0) - (a - 1.0) * cos_w0 - beta);
                let a0 = (a + 1.0) + (a - 1.0) * cos_w0 + beta;
                let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0);
                let a2 = (a + 1.0) + (a - 1.0) * cos_w0 - beta;
                normalize_biquad(b0, b1, b2, a0, a1, a2)
            }
            EqBandKind::HighShelf => {
                let a = 10.0f32.powf(gain_db / 40.0);
                let slope = q.clamp(0.1, 4.0);
                let alpha = sin_w0 / 2.0 * ((a + 1.0 / a) * (1.0 / slope - 1.0) + 2.0).sqrt();
                let beta = 2.0 * a.sqrt() * alpha;
                let b0 = a * ((a + 1.0) + (a - 1.0) * cos_w0 + beta);
                let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0);
                let b2 = a * ((a + 1.0) + (a - 1.0) * cos_w0 - beta);
                let a0 = (a + 1.0) - (a - 1.0) * cos_w0 + beta;
                let a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cos_w0);
                let a2 = (a + 1.0) - (a - 1.0) * cos_w0 - beta;
                normalize_biquad(b0, b1, b2, a0, a1, a2)
            }
        }
    }
}

fn normalize_biquad(b0: f32, b1: f32, b2: f32, a0: f32, a1: f32, a2: f32) -> BiquadCoeffs {
    if !a0.is_finite() || a0.abs() < 1e-12 {
        return BiquadCoeffs::identity();
    }
    let inv_a0 = 1.0 / a0;
    let b0 = (b0 * inv_a0).clamp(-16.0, 16.0);
    let b1 = (b1 * inv_a0).clamp(-16.0, 16.0);
    let b2 = (b2 * inv_a0).clamp(-16.0, 16.0);
    let a1 = (a1 * inv_a0).clamp(-16.0, 16.0);
    let a2 = (a2 * inv_a0).clamp(-16.0, 16.0);
    if !b0.is_finite()
        || !b1.is_finite()
        || !b2.is_finite()
        || !a1.is_finite()
        || !a2.is_finite()
    {
        return BiquadCoeffs::identity();
    }
    BiquadCoeffs { b0, b1, b2, a1, a2 }
}

#[derive(Clone, Copy, Debug, Default)]
struct BiquadState {
    z1: f32,
    z2: f32,
}

impl BiquadState {
    fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }

    fn process(&mut self, x: f32, c: &BiquadCoeffs) -> f32 {
        // Direct Form II Transposed.
        let y = c.b0 * x + self.z1;
        self.z1 = c.b1 * x - c.a1 * y + self.z2;
        self.z2 = c.b2 * x - c.a2 * y;
        y
    }
}

#[derive(Clone, Debug)]
struct EqBandProcessor {
    coeffs: BiquadCoeffs,
    states: Vec<BiquadState>,
}

impl EqBandProcessor {
    fn new(coeffs: BiquadCoeffs, channels: usize) -> Self {
        Self {
            coeffs,
            states: vec![BiquadState::default(); channels.max(1)],
        }
    }

    fn reset(&mut self) {
        for state in &mut self.states {
            state.reset();
        }
    }

    fn process(&mut self, x: f32, channel: usize) -> f32 {
        let idx = channel.min(self.states.len().saturating_sub(1));
        self.states[idx].process(x, &self.coeffs)
    }
}

#[derive(Clone, Debug, Default)]
struct EqProcessor {
    bands: Vec<EqBandProcessor>,
}

impl EqProcessor {
    fn from_config(bands: &[EqBandConfig], sample_rate: u32, channels: usize) -> Self {
        let mut out = Self { bands: Vec::new() };
        for band in bands {
            let coeffs = BiquadCoeffs::from_eq_band(band, sample_rate);
            out.bands.push(EqBandProcessor::new(coeffs, channels));
        }
        out
    }

    fn reset(&mut self) {
        for band in &mut self.bands {
            band.reset();
        }
    }

    fn process_sample(&mut self, mut x: f32, channel: usize) -> f32 {
        for band in &mut self.bands {
            x = band.process(x, channel);
        }
        x
    }

    fn is_empty(&self) -> bool {
        self.bands.is_empty()
    }
}

#[derive(Clone, Debug)]
struct LimiterProcessor {
    threshold: f32,
    release_step: f32,
    gain: f32,
}

impl LimiterProcessor {
    fn new(threshold_db: f32, sample_rate: u32) -> Option<Self> {
        if !threshold_db.is_finite() {
            return None;
        }
        let sample_rate = sample_rate.max(1) as f32;
        let threshold = gain_db_to_linear(threshold_db.clamp(-30.0, 0.0)).max(0.0);
        if threshold <= 0.0 {
            return None;
        }

        let release_time_sec = 0.05f32; // 50ms
        let release_step = (1.0 / (sample_rate * release_time_sec)).clamp(0.000_001, 1.0);
        Some(Self {
            threshold,
            release_step,
            gain: 1.0,
        })
    }

    fn reset(&mut self) {
        self.gain = 1.0;
    }

    fn process_frame_in_place(&mut self, frame: &mut [f32]) {
        let mut peak = 0.0f32;
        for sample in frame.iter() {
            peak = peak.max(sample.abs());
        }

        let desired_gain = if peak > self.threshold && peak.is_finite() {
            (self.threshold / peak).clamp(0.0, 1.0)
        } else {
            1.0
        };

        if desired_gain < self.gain {
            // Instant attack.
            self.gain = desired_gain;
        } else if self.gain < 1.0 {
            // Slow release.
            self.gain = (self.gain + self.release_step).min(desired_gain).min(1.0);
        } else {
            self.gain = 1.0;
        }

        if (self.gain - 1.0).abs() < 1e-6 {
            return;
        }

        #[cfg(target_arch = "x86_64")]
        {
            if std::arch::is_x86_feature_detected!("avx2") {
                unsafe {
                    simd_mul_in_place_avx2(frame, self.gain);
                }
                return;
            }
            if std::arch::is_x86_feature_detected!("sse2") {
                unsafe {
                    simd_mul_in_place_sse2(frame, self.gain);
                }
                return;
            }
        }

        scalar_mul_in_place(frame, self.gain);
    }
}

#[inline]
fn scalar_mul_in_place(samples: &mut [f32], gain: f32) {
    for sample in samples.iter_mut() {
        *sample *= gain;
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "sse2")]
unsafe fn simd_mul_in_place_sse2(samples: &mut [f32], gain: f32) {
    use std::arch::x86_64::*;

    let mut i = 0usize;
    let len = samples.len();
    let gain_vec = _mm_set1_ps(gain);

    while i + 4 <= len {
        let ptr = unsafe { samples.as_mut_ptr().add(i) };
        let x = _mm_loadu_ps(ptr);
        let y = _mm_mul_ps(x, gain_vec);
        _mm_storeu_ps(ptr, y);
        i += 4;
    }

    if i < len {
        scalar_mul_in_place(&mut samples[i..], gain);
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn simd_mul_in_place_avx2(samples: &mut [f32], gain: f32) {
    use std::arch::x86_64::*;

    let mut i = 0usize;
    let len = samples.len();
    let gain_vec = _mm256_set1_ps(gain);

    while i + 8 <= len {
        let ptr = unsafe { samples.as_mut_ptr().add(i) };
        let x = _mm256_loadu_ps(ptr);
        let y = _mm256_mul_ps(x, gain_vec);
        _mm256_storeu_ps(ptr, y);
        i += 8;
    }

    if i < len {
        simd_mul_in_place_sse2(&mut samples[i..], gain);
    }
}

#[derive(Clone, Debug)]
struct DspChainProcessor {
    gain_linear: f32,
    eq: EqProcessor,
    limiter: Option<LimiterProcessor>,
    channels: usize,
    scratch_frame: Vec<f32>,
}

impl Default for DspChainProcessor {
    fn default() -> Self {
        Self {
            gain_linear: 1.0,
            eq: EqProcessor::default(),
            limiter: None,
            channels: 0,
            scratch_frame: Vec::new(),
        }
    }
}

impl DspChainProcessor {
    fn from_runtime_config(config: &DspRuntimeConfig, sample_rate: u32, channels: usize) -> Self {
        let eq = EqProcessor::from_config(&config.eq_bands, sample_rate, channels);
        let limiter = config
            .limiter_threshold_db
            .and_then(|db| LimiterProcessor::new(db, sample_rate));
        Self {
            gain_linear: config.gain_linear,
            eq,
            limiter,
            channels,
            scratch_frame: vec![0.0; channels.max(1)],
        }
    }

    fn reset(&mut self) {
        self.eq.reset();
        if let Some(limiter) = &mut self.limiter {
            limiter.reset();
        }
    }

    fn process_interleaved_in_place(&mut self, samples: &mut [f32]) {
        let channels = self.channels.max(1);
        let gain = self.gain_linear;
        let has_eq = !self.eq.is_empty();
        let has_limiter = self.limiter.is_some();
        if (gain - 1.0).abs() < 1e-6 && !has_eq && !has_limiter {
            return;
        }

        if !has_eq && !has_limiter {
            if (gain - 1.0).abs() < 1e-6 {
                return;
            }

            #[cfg(target_arch = "x86_64")]
            {
                if std::arch::is_x86_feature_detected!("avx2") {
                    unsafe {
                        simd_mul_in_place_avx2(samples, gain);
                    }
                    return;
                }
                if std::arch::is_x86_feature_detected!("sse2") {
                    unsafe {
                        simd_mul_in_place_sse2(samples, gain);
                    }
                    return;
                }
            }

            scalar_mul_in_place(samples, gain);
            return;
        }

        let frames = samples.len() / channels;
        let limit = frames * channels;
        if self.scratch_frame.len() < channels {
            self.scratch_frame.resize(channels, 0.0);
        }

        for frame in 0..frames {
            let base = frame * channels;
            for ch in 0..channels {
                let idx = base + ch;
                let mut x = samples[idx] * gain;
                if has_eq {
                    x = self.eq.process_sample(x, ch);
                }
                self.scratch_frame[ch] = x;
            }

            if let Some(limiter) = &mut self.limiter {
                limiter.process_frame_in_place(&mut self.scratch_frame[..channels]);
            }

            for ch in 0..channels {
                samples[base + ch] = self.scratch_frame[ch];
            }
        }

        // Preserve any trailing samples if the buffer isn't interleaved as expected.
        for idx in limit..samples.len() {
            let ch = idx % channels;
            let mut x = samples[idx] * gain;
            if has_eq {
                x = self.eq.process_sample(x, ch);
            }
            if let Some(limiter) = &mut self.limiter {
                let mut frame = [x];
                limiter.process_frame_in_place(&mut frame);
                x = frame[0];
            }
            samples[idx] = x;
        }
    }
}

struct PreparedDspUpdate {
    version: u64,
    processor: DspChainProcessor,
    vst_keys: Vec<crate::vst_dsp::VstNodeKey>,
    vst_nodes: Option<Vec<crate::vst_dsp::VstDspNode>>,
}

pub(crate) struct DspProcessingSource<S>
where
    S: Source<Item = f32> + Send,
{
    inner: S,
    channels: u16,
    sample_rate: u32,
    duration: Option<Duration>,
    dsp: Arc<DspRuntime>,
    pre_tap: SpectrumTap,
    post_tap: SpectrumTap,
    processor: DspChainProcessor,
    processor_version: u64,
    processor_reset_serial: u64,
    vst_keys: Vec<crate::vst_dsp::VstNodeKey>,
    vst_nodes: Vec<crate::vst_dsp::VstDspNode>,
    fade_in_remaining_frames: u32,
    fade_in_total_frames: u32,
    local: Vec<f32>,
    update_scratch: Vec<f32>,
    local_index: usize,
    pending_update: Arc<Mutex<Option<PreparedDspUpdate>>>,
    pending_update_stop: Arc<AtomicBool>,
}

impl<S> DspProcessingSource<S>
where
    S: Source<Item = f32> + Send,
{
    const CHUNK_SAMPLES: usize = 4096;

    pub(crate) fn new(
        inner: S,
        dsp: Arc<DspRuntime>,
        pre_tap: SpectrumTap,
        post_tap: SpectrumTap,
    ) -> Self {
        let channels = inner.channels().max(1);
        let sample_rate = inner.sample_rate().max(1);
        pre_tap.set_sample_rate(sample_rate);
        post_tap.set_sample_rate(sample_rate);
        let duration = inner.total_duration();

        let processor_version = dsp.version();
        let processor_reset_serial = dsp.reset_serial();
        let snapshot = dsp.snapshot();
        let processor =
            DspChainProcessor::from_runtime_config(&snapshot, sample_rate, channels as usize);
        let vst_keys = snapshot.vst_nodes.clone();
        let builder_last_vst_keys = vst_keys.clone();
        let vst_nodes = vst_keys
            .iter()
            .cloned()
            .map(|key| crate::vst_dsp::VstDspNode::new(crate::vst_dsp::VstNodeSpec { key }))
            .collect();

        let pending_update: Arc<Mutex<Option<PreparedDspUpdate>>> = Arc::new(Mutex::new(None));
        let pending_update_stop = Arc::new(AtomicBool::new(false));

        let pending_update_thread = pending_update.clone();
        let pending_stop_thread = pending_update_stop.clone();
        let dsp_thread = dsp.clone();
        let sample_rate_thread = sample_rate;
        let channels_thread = channels;
        let builder_last_seen_version = processor_version;

        std::thread::spawn(move || {
            let channels_usize = channels_thread.max(1) as usize;
            let mut last_seen_version = builder_last_seen_version;
            let mut last_vst_keys = builder_last_vst_keys;

            loop {
                if pending_stop_thread.load(Ordering::Acquire) {
                    break;
                }

                let version =
                    dsp_thread.wait_for_slow_version_change(last_seen_version, &pending_stop_thread);
                if pending_stop_thread.load(Ordering::Acquire) {
                    break;
                }
                if version == last_seen_version {
                    continue;
                }
                last_seen_version = version;

                let slow = dsp_thread.slow_config();
                let config = DspRuntimeConfig {
                    gain_linear: 1.0,
                    eq_bands: slow.eq_bands.clone(),
                    limiter_threshold_db: slow.limiter_threshold_db,
                    vst_nodes: Vec::new(),
                };
                let processor = DspChainProcessor::from_runtime_config(
                    &config,
                    sample_rate_thread,
                    channels_usize,
                );

                let vst_keys = slow.vst_nodes.clone();
                let vst_nodes = if vst_keys != last_vst_keys {
                    last_vst_keys = vst_keys.clone();
                    Some(
                        vst_keys
                            .iter()
                            .cloned()
                            .map(|key| {
                                crate::vst_dsp::VstDspNode::new(crate::vst_dsp::VstNodeSpec { key })
                            })
                            .collect(),
                    )
                } else {
                    None
                };

                let mut guard = match pending_update_thread.lock() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                *guard = Some(PreparedDspUpdate {
                    version,
                    processor,
                    vst_keys,
                    vst_nodes,
                });
            }
        });

        Self {
            inner,
            channels,
            sample_rate,
            duration,
            dsp,
            pre_tap,
            post_tap,
            processor,
            processor_version,
            processor_reset_serial,
            vst_keys,
            vst_nodes,
            fade_in_remaining_frames: 0,
            fade_in_total_frames: 0,
            local: Vec::with_capacity(Self::CHUNK_SAMPLES),
            update_scratch: Vec::with_capacity(Self::CHUNK_SAMPLES),
            local_index: 0,
            pending_update,
            pending_update_stop,
        }
    }

    fn begin_fade_in(&mut self) {
        const RAMP_MS: u64 = 5;
        let frames = ((self.sample_rate as u64).saturating_mul(RAMP_MS) / 1000)
            .max(1)
            .min(2048) as u32;
        self.fade_in_remaining_frames = frames;
        self.fade_in_total_frames = frames;
    }

    fn apply_fade_in(&mut self) {
        if self.fade_in_remaining_frames == 0 {
            return;
        }
        let channels = self.channels.max(1) as usize;
        let frames = self.local.len() / channels;
        if frames == 0 {
            self.fade_in_remaining_frames = 0;
            return;
        }

        let total = self.fade_in_total_frames.max(1);
        let remaining = self.fade_in_remaining_frames.min(frames as u32);
        let already = total.saturating_sub(self.fade_in_remaining_frames);

        for frame in 0..remaining as usize {
            let gain = ((already + frame as u32 + 1) as f32 / total as f32).min(1.0);
            let base = frame * channels;
            for ch in 0..channels {
                let idx = base + ch;
                if idx < self.local.len() {
                    self.local[idx] *= gain;
                }
            }
        }

        self.fade_in_remaining_frames = self.fade_in_remaining_frames.saturating_sub(remaining);
    }

    fn ensure_processor_uptodate(&mut self) {
        let gain_linear = self.dsp.gain_linear();
        let gain_linear = if gain_linear.is_finite() {
            gain_linear
        } else {
            1.0
        };

        let reset_serial = self.dsp.reset_serial();
        if reset_serial != self.processor_reset_serial {
            self.processor.reset();
            for node in &mut self.vst_nodes {
                node.reset();
            }
            self.begin_fade_in();
            self.processor_reset_serial = reset_serial;
        }

        self.processor.gain_linear = gain_linear;
    }

    fn take_pending_update(&mut self) -> Option<PreparedDspUpdate> {
        let Ok(mut guard) = self.pending_update.try_lock() else {
            return None;
        };
        guard.take()
    }

    fn maybe_apply_update_on_refill(&mut self) -> bool {
        let Some(update) = self.take_pending_update() else {
            return false;
        };
        let current_version = self.dsp.version();
        if update.version != current_version || update.version <= self.processor_version {
            return false;
        }

        let gain_linear = self.dsp.gain_linear();
        let gain_linear = if gain_linear.is_finite() {
            gain_linear
        } else {
            1.0
        };

        let channels = self.channels.max(1) as usize;
        if channels == 0 {
            return false;
        }

        if let Some(vst_nodes) = update.vst_nodes {
            self.processor = update.processor;
            self.processor.gain_linear = gain_linear;
            self.vst_keys = update.vst_keys;
            self.vst_nodes = vst_nodes;
            self.processor_version = update.version;
            self.begin_fade_in();
            return false;
        }

        // EQ/Limiter update only: crossfade between old and new processor outputs to avoid clicks.
        let crossfade_frames = ((self.sample_rate as u64).saturating_mul(5) / 1000)
            .max(1)
            .min(2048) as usize;
        let frames = self.local.len() / channels;
        if frames == 0 {
            self.processor = update.processor;
            self.processor.gain_linear = gain_linear;
            self.processor_version = update.version;
            return false;
        }
        let crossfade_frames = crossfade_frames.min(frames);
        let crossfade_samples = crossfade_frames.saturating_mul(channels).min(self.local.len());

        self.update_scratch.clear();
        self.update_scratch.extend_from_slice(&self.local);

        let mut next_processor = update.processor;
        next_processor.gain_linear = gain_linear;
        next_processor.process_interleaved_in_place(&mut self.local);

        if crossfade_samples > 0 {
            self.processor.gain_linear = gain_linear;
            self.processor
                .process_interleaved_in_place(&mut self.update_scratch[..crossfade_samples]);

            let denom = crossfade_frames.max(1) as f32;
            for frame in 0..crossfade_frames {
                let t = ((frame as f32) + 1.0) / denom;
                let a = 1.0 - t;
                let base = frame * channels;
                for ch in 0..channels {
                    let idx = base + ch;
                    if idx >= crossfade_samples {
                        break;
                    }
                    self.local[idx] = self.update_scratch[idx] * a + self.local[idx] * t;
                }
            }
        }

        self.processor = next_processor;
        self.processor_version = update.version;
        true
    }

    fn refill_local(&mut self) -> bool {
        self.local.clear();
        self.local_index = 0;

        for _ in 0..Self::CHUNK_SAMPLES {
            match self.inner.next() {
                Some(sample) => self.local.push(sample),
                None => break,
            }
        }

        if self.local.is_empty() {
            return false;
        }

        let processor_already_applied = self.maybe_apply_update_on_refill();
        self.ensure_processor_uptodate();
        if !processor_already_applied {
            self.processor.process_interleaved_in_place(&mut self.local);
        }
        self.pre_tap
            .push_interleaved(&self.local, self.channels.max(1) as usize);
        for node in &mut self.vst_nodes {
            node.process_interleaved_in_place(&mut self.local);
        }
        self.apply_fade_in();
        self.post_tap
            .push_interleaved(&self.local, self.channels.max(1) as usize);
        true
    }
}

pub(crate) fn boxed_with_dsp<S>(
    source: S,
    dsp: Arc<DspRuntime>,
    pre_tap: SpectrumTap,
    post_tap: SpectrumTap,
) -> BoxedSource
where
    S: Source<Item = f32> + Send + 'static,
{
    Box::new(DspProcessingSource::new(source, dsp, pre_tap, post_tap))
}

impl<S> Drop for DspProcessingSource<S>
where
    S: Source<Item = f32> + Send,
{
    fn drop(&mut self) {
        self.pending_update_stop.store(true, Ordering::Release);
        self.dsp.wake_slow_update_waiters();
    }
}

impl<S> Iterator for DspProcessingSource<S>
where
    S: Source<Item = f32> + Send,
{
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.local_index >= self.local.len() {
            if !self.refill_local() {
                return None;
            }
        }
        let out = self.local[self.local_index];
        self.local_index += 1;
        Some(out)
    }
}

impl<S> Source for DspProcessingSource<S>
where
    S: Source<Item = f32> + Send,
{
    fn current_frame_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        self.duration
    }
}

#[derive(Clone)]
pub(crate) struct SpectrumTap {
    inner: Arc<Mutex<SpectrumTapInner>>,
}

struct SpectrumTapInner {
    window: VecDeque<f32>,
    capacity: usize,
    sample_rate: u32,
}

impl SpectrumTap {
    pub(crate) fn new(capacity: usize) -> Self {
        Self {
            inner: Arc::new(Mutex::new(SpectrumTapInner {
                window: VecDeque::with_capacity(capacity),
                capacity,
                sample_rate: 0,
            })),
        }
    }

    pub(crate) fn set_sample_rate(&self, sample_rate: u32) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.sample_rate = sample_rate;
        }
    }

    pub(crate) fn clear(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.window.clear();
        }
    }

    pub(crate) fn push_interleaved(&self, samples: &[f32], channels: usize) {
        if channels == 0 {
            return;
        }
        let mut inner = match self.inner.try_lock() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        let frames = samples.len() / channels;
        for frame in 0..frames {
            let mut sum = 0.0f32;
            for ch in 0..channels {
                sum += samples[frame * channels + ch];
            }
            let mono = sum / channels as f32;
            if inner.window.len() >= inner.capacity {
                inner.window.pop_front();
            }
            inner.window.push_back(mono);
        }
    }

    pub(crate) fn snapshot(&self) -> Option<(Vec<f32>, u32)> {
        let inner = self.inner.lock().ok()?;
        if inner.sample_rate == 0 || inner.window.is_empty() {
            return None;
        }
        Some((inner.window.iter().copied().collect(), inner.sample_rate))
    }
}

#[derive(Clone)]
pub(crate) struct SpectrumSnapshot {
    pub sample_rate: u32,
    pub window: Vec<f32>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    #[test]
    fn dsp_runtime_applies_gain_nodes() {
        let runtime = DspRuntime::new();
        let gain_db = runtime.apply_chain(&[DspNodeConfig::Gain { db: -6.0 }]);
        assert!((gain_db + 6.0).abs() < 1e-6);

        let snapshot = runtime.snapshot();
        assert!((runtime.gain_db() + 6.0).abs() < 1e-6);
        assert!((snapshot.gain_linear - gain_db_to_linear(-6.0)).abs() < 1e-6);
    }

    #[test]
    fn dsp_runtime_replay_gain_updates_gain_linear() {
        let runtime = DspRuntime::new();
        let _ = runtime.apply_chain(&[DspNodeConfig::Gain { db: 0.0 }]);

        let replay_gain_db = runtime.set_replay_gain_db(-6.0);
        assert!((replay_gain_db + 6.0).abs() < 1e-6);

        let snapshot = runtime.snapshot();
        assert!((runtime.gain_db() - 0.0).abs() < 1e-6);
        assert!((runtime.replay_gain_db() + 6.0).abs() < 1e-6);
        assert!((snapshot.gain_linear - gain_db_to_linear(-6.0)).abs() < 1e-6);

        let _ = runtime.apply_chain(&[DspNodeConfig::Gain { db: 3.0 }]);
        let snapshot = runtime.snapshot();
        assert!((runtime.gain_db() - 3.0).abs() < 1e-6);
        assert!((runtime.replay_gain_db() + 6.0).abs() < 1e-6);
        assert!((snapshot.gain_linear - gain_db_to_linear(-3.0)).abs() < 1e-6);
    }

    #[test]
    fn dsp_processing_source_applies_gain_updates_without_version_bump() {
        #[derive(Clone)]
        struct TestSource {
            remaining: usize,
            channels: u16,
            sample_rate: u32,
            value: f32,
        }

        impl Iterator for TestSource {
            type Item = f32;

            fn next(&mut self) -> Option<Self::Item> {
                if self.remaining == 0 {
                    return None;
                }
                self.remaining -= 1;
                Some(self.value)
            }
        }

        impl Source for TestSource {
            fn current_frame_len(&self) -> Option<usize> {
                None
            }

            fn channels(&self) -> u16 {
                self.channels
            }

            fn sample_rate(&self) -> u32 {
                self.sample_rate
            }

            fn total_duration(&self) -> Option<Duration> {
                None
            }
        }

        let dsp = Arc::new(DspRuntime::new());
        let _ = dsp.apply_chain(&[DspNodeConfig::Gain { db: 0.0 }]);
        let version_before = dsp.version();

        let inner = TestSource {
            remaining: DspProcessingSource::<TestSource>::CHUNK_SAMPLES * 2,
            channels: 2,
            sample_rate: 48_000,
            value: 0.5,
        };
        let pre_tap = SpectrumTap::new(8);
        let post_tap = SpectrumTap::new(8);
        let mut processed = DspProcessingSource::new(inner, dsp.clone(), pre_tap, post_tap);

        let first = processed.next().expect("first sample");
        assert!((first - 0.5).abs() < 1e-6);

        for _ in 1..DspProcessingSource::<TestSource>::CHUNK_SAMPLES {
            processed.next().expect("first chunk sample");
        }

        let _ = dsp.apply_chain(&[DspNodeConfig::Gain { db: -6.0 }]);
        assert_eq!(dsp.version(), version_before);

        let second = processed.next().expect("second chunk sample");
        let expected = 0.5 * gain_db_to_linear(-6.0);
        assert!((second - expected).abs() < 1e-6);
    }

    #[test]
    fn dsp_processing_source_does_not_block_on_slow_config_contention() {
        #[derive(Clone)]
        struct TestSource {
            remaining: usize,
            channels: u16,
            sample_rate: u32,
            value: f32,
        }

        impl Iterator for TestSource {
            type Item = f32;

            fn next(&mut self) -> Option<Self::Item> {
                if self.remaining == 0 {
                    return None;
                }
                self.remaining -= 1;
                Some(self.value)
            }
        }

        impl Source for TestSource {
            fn current_frame_len(&self) -> Option<usize> {
                None
            }

            fn channels(&self) -> u16 {
                self.channels
            }

            fn sample_rate(&self) -> u32 {
                self.sample_rate
            }

            fn total_duration(&self) -> Option<Duration> {
                None
            }
        }

        let dsp = Arc::new(DspRuntime::new());
        let inner = TestSource {
            remaining: DspProcessingSource::<TestSource>::CHUNK_SAMPLES,
            channels: 2,
            sample_rate: 48_000,
            value: 0.25,
        };
        let pre_tap = SpectrumTap::new(8);
        let post_tap = SpectrumTap::new(8);
        let mut processed = DspProcessingSource::new(inner, dsp.clone(), pre_tap, post_tap);

        let guard = dsp.slow_config.lock().expect("slow config lock");
        dsp.slow_version.fetch_add(1, Ordering::AcqRel);

        let sample = processed.next().expect("processed sample");
        drop(guard);

        assert!((sample - 0.25).abs() < 1e-6);
    }

    #[test]
    fn dsp_processing_source_applies_limiter_update_after_async_rebuild() {
        #[derive(Clone)]
        struct TestSource {
            remaining: usize,
            channels: u16,
            sample_rate: u32,
            value: f32,
        }

        impl Iterator for TestSource {
            type Item = f32;

            fn next(&mut self) -> Option<Self::Item> {
                if self.remaining == 0 {
                    return None;
                }
                self.remaining -= 1;
                Some(self.value)
            }
        }

        impl Source for TestSource {
            fn current_frame_len(&self) -> Option<usize> {
                None
            }

            fn channels(&self) -> u16 {
                self.channels
            }

            fn sample_rate(&self) -> u32 {
                self.sample_rate
            }

            fn total_duration(&self) -> Option<Duration> {
                None
            }
        }

        let dsp = Arc::new(DspRuntime::new());
        let _ = dsp.apply_chain(&[DspNodeConfig::Gain { db: 0.0 }]);

        let inner = TestSource {
            remaining: DspProcessingSource::<TestSource>::CHUNK_SAMPLES * 2,
            channels: 2,
            sample_rate: 48_000,
            value: 1.0,
        };
        let pre_tap = SpectrumTap::new(8);
        let post_tap = SpectrumTap::new(8);
        let mut processed = DspProcessingSource::new(inner, dsp.clone(), pre_tap, post_tap);

        for _ in 0..DspProcessingSource::<TestSource>::CHUNK_SAMPLES {
            processed.next().expect("first chunk sample");
        }

        let _ = dsp.apply_chain(&[
            DspNodeConfig::Gain { db: 0.0 },
            DspNodeConfig::Limiter { threshold_db: -6.0 },
        ]);

        std::thread::sleep(Duration::from_millis(40));

        let crossfade_frames = ((48_000u64).saturating_mul(5) / 1000)
            .max(1)
            .min(2048) as usize;
        let crossfade_samples = crossfade_frames * 2;
        for _ in 0..crossfade_samples {
            processed.next().expect("crossfade sample");
        }

        let sample = processed.next().expect("post-update sample");
        let expected = gain_db_to_linear(-6.0);
        assert!((sample - expected).abs() < 1e-6);
    }

    #[test]
    fn peaking_eq_zero_db_yields_unity_transfer() {
        let band = EqBandConfig {
            kind: EqBandKind::Peaking,
            frequency_hz: 1_000.0,
            q: 1.0,
            gain_db: 0.0,
        };
        let coeffs = BiquadCoeffs::from_eq_band(&band, 48_000);

        assert!(coeffs.b0.is_finite());
        assert!(coeffs.b1.is_finite());
        assert!(coeffs.b2.is_finite());
        assert!(coeffs.a1.is_finite());
        assert!(coeffs.a2.is_finite());

        assert!((coeffs.b0 - 1.0).abs() < 1e-5);
        assert!((coeffs.b1 - coeffs.a1).abs() < 1e-5);
        assert!((coeffs.b2 - coeffs.a2).abs() < 1e-5);
    }

    #[test]
    fn dsp_chain_gain_only_scales_samples() {
        let gain_db = 6.0;
        let config = DspRuntimeConfig {
            gain_linear: gain_db_to_linear(gain_db),
            eq_bands: Vec::new(),
            limiter_threshold_db: None,
            vst_nodes: Vec::new(),
        };

        let mut processor = DspChainProcessor::from_runtime_config(&config, 48_000, 2);
        let mut samples = vec![0.1, -0.1, 0.25, -0.25];
        processor.process_interleaved_in_place(&mut samples);

        let scale = gain_db_to_linear(gain_db);
        assert!((samples[0] - 0.1 * scale).abs() < 1e-6);
        assert!((samples[1] + 0.1 * scale).abs() < 1e-6);
        assert!((samples[2] - 0.25 * scale).abs() < 1e-6);
        assert!((samples[3] + 0.25 * scale).abs() < 1e-6);
    }

    #[test]
    fn dsp_chain_limiter_clamps_peaks() {
        let threshold_db = -6.0;
        let config = DspRuntimeConfig {
            gain_linear: 1.0,
            eq_bands: Vec::new(),
            limiter_threshold_db: Some(threshold_db),
            vst_nodes: Vec::new(),
        };

        let mut processor = DspChainProcessor::from_runtime_config(&config, 48_000, 2);
        let mut samples = vec![1.0, -1.0];
        processor.process_interleaved_in_place(&mut samples);

        let threshold = gain_db_to_linear(threshold_db);
        assert!((samples[0].abs() - threshold).abs() < 1e-6);
        assert!((samples[1].abs() - threshold).abs() < 1e-6);
    }

    #[test]
    fn spectrum_tap_drops_samples_when_contended() {
        let tap = SpectrumTap::new(8);
        tap.set_sample_rate(48_000);

        let guard = tap.inner.lock().expect("tap lock");
        tap.push_interleaved(&[0.25, 0.25, 0.5, 0.5], 2);
        drop(guard);

        assert!(tap.snapshot().is_none());

        tap.push_interleaved(&[1.0, -1.0, 0.5, 0.5], 2);
        let (window, sample_rate) = tap.snapshot().expect("snapshot");
        assert_eq!(sample_rate, 48_000);
        assert_eq!(window.len(), 2);
        assert!(window[1] > 0.4);
    }
}
