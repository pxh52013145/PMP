use rodio::Source;
use serde::{Deserialize, Serialize};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        Arc, Condvar, Mutex,
    },
    time::{Duration, Instant},
};

use crate::audio::atomic_f32::{load_atomic_f32, store_atomic_f32};
use crate::audio::bulk_source::BulkSource;
use crate::audio::output::BoxedSource;
use crate::audio::resample::lerp_scalar;

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
    PitchShift {
        semitones: f32,
    },
    Tempo {
        rate: f32,
        #[serde(rename = "preservePitch")]
        preserve_pitch: bool,
    },
    Vst {
        id: String,
        #[serde(rename = "pluginId")]
        plugin_id: String,
    },
    NeuralEffect {
        #[serde(rename = "modelId")]
        model_id: String,
        #[serde(rename = "modelPath")]
        model_path: String,
        #[serde(rename = "latencyBudgetMs")]
        latency_budget_ms: f32,
        #[serde(rename = "gpuEnabled")]
        gpu_enabled: bool,
        #[serde(rename = "bypassOnOverrun")]
        bypass_on_overrun: bool,
    },
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct TimePitchConfig {
    speed_rate: f32,
    pitch_semitones: f32,
}

impl Default for TimePitchConfig {
    fn default() -> Self {
        Self {
            speed_rate: 1.0,
            pitch_semitones: 0.0,
        }
    }
}

impl TimePitchConfig {
    fn sanitized(speed_rate: f32, pitch_semitones: f32) -> Self {
        let speed_rate = if speed_rate.is_finite() {
            speed_rate.clamp(0.25, 4.0)
        } else {
            1.0
        };
        let pitch_semitones = if pitch_semitones.is_finite() {
            pitch_semitones.clamp(-36.0, 36.0)
        } else {
            0.0
        };
        Self {
            speed_rate,
            pitch_semitones,
        }
    }

    fn has_speed(self) -> bool {
        (self.speed_rate - 1.0).abs() > 1e-4
    }

    fn has_pitch(self) -> bool {
        self.pitch_semitones.abs() > 1e-3
    }

    fn is_active(self) -> bool {
        self.has_speed() || self.has_pitch()
    }
}

fn gain_db_to_linear(db: f32) -> f32 {
    10.0f32.powf(db / 20.0)
}

const DYNAMIC_GAIN_TARGET_DBFS: f32 = -20.0;
const DYNAMIC_GAIN_GATE_DBFS: f32 = -56.0;
const DYNAMIC_GAIN_MAX_BOOST_DB: f32 = 6.0;
const DYNAMIC_GAIN_MAX_CUT_DB: f32 = 9.0;
const DYNAMIC_GAIN_ATTACK_MS: f32 = 12.0;
const DYNAMIC_GAIN_RELEASE_MS: f32 = 380.0;
const DYNAMIC_GAIN_RMS_WINDOW_MS: f32 = 120.0;
const DYNAMIC_GAIN_PEAK_RELEASE_MS: f32 = 80.0;
const DYNAMIC_GAIN_TRANSIENT_HOLD_MS: f32 = 12.0;
const DYNAMIC_GAIN_TRANSIENT_CREST_THRESHOLD: f32 = 3.8;
const DYNAMIC_GAIN_TRANSIENT_BOOST_DAMP: f32 = 0.35;
const DYNAMIC_GAIN_UNITY_DEADBAND_DB: f32 = 0.7;
const DYNAMIC_GAIN_HEADROOM_DBFS: f32 = -1.0;
static DSP_REFILL_BUDGET_TIMELINE_GATE_MS: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Default, PartialEq)]
struct DspSlowConfig {
    eq_bands: Vec<EqBandConfig>,
    limiter_threshold_db: Option<f32>,
    time_pitch: TimePitchConfig,
    vst_nodes: Vec<crate::vst_dsp::VstNodeKey>,
}

#[derive(Clone, Debug)]
struct DspRuntimeConfig {
    gain_linear: f32,
    eq_bands: Vec<EqBandConfig>,
    limiter_threshold_db: Option<f32>,
    time_pitch: TimePitchConfig,
    vst_nodes: Vec<crate::vst_dsp::VstNodeKey>,
}

impl Default for DspRuntimeConfig {
    fn default() -> Self {
        Self {
            gain_linear: 1.0,
            eq_bands: Vec::new(),
            limiter_threshold_db: None,
            time_pitch: TimePitchConfig::default(),
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
    playback_rate_bits: AtomicU32,
    dynamic_gain_enabled: AtomicBool,
    dynamic_gain_db_bits: AtomicU32,
    reset_serial: AtomicU64,
    pipeline_latency_frames: AtomicU64,
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
            playback_rate_bits: AtomicU32::new(1.0f32.to_bits()),
            dynamic_gain_enabled: AtomicBool::new(false),
            dynamic_gain_db_bits: AtomicU32::new(0.0f32.to_bits()),
            reset_serial: AtomicU64::new(1),
            pipeline_latency_frames: AtomicU64::new(0),
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

    pub(crate) fn dynamic_gain_enabled(&self) -> bool {
        self.dynamic_gain_enabled.load(Ordering::Acquire)
    }

    pub(crate) fn set_dynamic_gain_enabled(&self, enabled: bool) -> bool {
        let previous = self.dynamic_gain_enabled.swap(enabled, Ordering::AcqRel);
        if previous != enabled {
            self.request_reset();
            if !enabled {
                store_atomic_f32(&self.dynamic_gain_db_bits, 0.0);
            }
        }
        enabled
    }

    pub(crate) fn dynamic_gain_db(&self) -> f32 {
        let value = load_atomic_f32(&self.dynamic_gain_db_bits);
        if value.is_finite() {
            value
        } else {
            0.0
        }
    }

    pub(crate) fn playback_rate(&self) -> f32 {
        let value = load_atomic_f32(&self.playback_rate_bits);
        if value.is_finite() {
            value.clamp(0.25, 4.0)
        } else {
            1.0
        }
    }

    fn update_dynamic_gain_db(&self, dynamic_gain_db: f32) {
        let normalized = if dynamic_gain_db.is_finite() {
            dynamic_gain_db.clamp(-30.0, 18.0)
        } else {
            0.0
        };
        store_atomic_f32(&self.dynamic_gain_db_bits, normalized);
    }

    fn update_pipeline_latency_frames(&self, latency_frames: usize) {
        self.pipeline_latency_frames.store(
            latency_frames.min(u64::MAX as usize) as u64,
            Ordering::Release,
        );
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
            time_pitch: slow.time_pitch,
            vst_nodes: slow.vst_nodes.clone(),
        }
    }

    pub(crate) fn apply_chain(&self, chain: &[DspNodeConfig]) -> f32 {
        let mut gain_db = 0.0f32;
        let mut eq_bands: Vec<EqBandConfig> = Vec::new();
        let mut limiter_threshold_db: Option<f32> = None;
        let mut speed_rate = 1.0f32;
        let mut pitch_semitones = 0.0f32;

        for node in chain {
            match node {
                DspNodeConfig::Gain { db } => gain_db += *db,
                DspNodeConfig::Eq { bands } => {
                    for band in bands {
                        if !band.frequency_hz.is_finite() {
                            continue;
                        }
                        let q = if band.q.is_finite() { band.q } else { 0.707 };
                        let gain_db = if band.gain_db.is_finite() {
                            band.gain_db
                        } else {
                            0.0
                        };
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
                DspNodeConfig::PitchShift { semitones } => {
                    if semitones.is_finite() {
                        pitch_semitones += semitones.clamp(-24.0, 24.0);
                    }
                }
                DspNodeConfig::Tempo {
                    rate,
                    preserve_pitch,
                } => {
                    if rate.is_finite() {
                        let rate = rate.clamp(0.25, 4.0);
                        speed_rate = (speed_rate * rate).clamp(0.25, 4.0);
                        if *preserve_pitch {
                            pitch_semitones += -12.0 * rate.log2();
                        }
                    }
                }
                DspNodeConfig::Vst { .. } => {}
                DspNodeConfig::NeuralEffect { .. } => {}
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

        let time_pitch = TimePitchConfig::sanitized(speed_rate, pitch_semitones);
        store_atomic_f32(&self.playback_rate_bits, time_pitch.speed_rate);

        let mut guard = match self.slow_config.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let current = guard.as_ref();
        if current.eq_bands != eq_bands
            || current.limiter_threshold_db != limiter_threshold_db
            || current.time_pitch != time_pitch
        {
            *guard = Arc::new(DspSlowConfig {
                eq_bands,
                limiter_threshold_db,
                time_pitch,
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
            time_pitch: current.time_pitch,
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
    if !b0.is_finite() || !b1.is_finite() || !b2.is_finite() || !a1.is_finite() || !a2.is_finite() {
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

    #[cfg(target_arch = "x86_64")]
    fn can_use_stereo_simd(&self, simd_level: SimdLevel) -> bool {
        self.states.len() == 2 && !matches!(simd_level, SimdLevel::Scalar)
    }

    #[cfg(target_arch = "x86_64")]
    #[target_feature(enable = "sse2")]
    unsafe fn process_stereo_frame_sse2(&mut self, left: f32, right: f32) -> (f32, f32) {
        use std::arch::x86_64::*;

        let c = &self.coeffs;
        let x = _mm_set_ps(0.0, 0.0, right, left);
        let z1 = _mm_set_ps(0.0, 0.0, self.states[1].z1, self.states[0].z1);
        let z2 = _mm_set_ps(0.0, 0.0, self.states[1].z2, self.states[0].z2);

        let b0_vec = _mm_set1_ps(c.b0);
        let y = _mm_add_ps(_mm_mul_ps(b0_vec, x), z1);

        let b1_vec = _mm_set1_ps(c.b1);
        let a1_vec = _mm_set1_ps(c.a1);
        let new_z1 = _mm_add_ps(_mm_sub_ps(_mm_mul_ps(b1_vec, x), _mm_mul_ps(a1_vec, y)), z2);

        let b2_vec = _mm_set1_ps(c.b2);
        let a2_vec = _mm_set1_ps(c.a2);
        let new_z2 = _mm_sub_ps(_mm_mul_ps(b2_vec, x), _mm_mul_ps(a2_vec, y));

        let mut y_out = [0.0f32; 4];
        _mm_storeu_ps(y_out.as_mut_ptr(), y);
        let mut z1_out = [0.0f32; 4];
        _mm_storeu_ps(z1_out.as_mut_ptr(), new_z1);
        let mut z2_out = [0.0f32; 4];
        _mm_storeu_ps(z2_out.as_mut_ptr(), new_z2);

        self.states[0].z1 = z1_out[0];
        self.states[0].z2 = z2_out[0];
        self.states[1].z1 = z1_out[1];
        self.states[1].z2 = z2_out[1];

        (y_out[0], y_out[1])
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

    #[cfg(target_arch = "x86_64")]
    fn can_use_stereo_simd(&self, simd_level: SimdLevel) -> bool {
        self.bands
            .iter()
            .all(|band| band.can_use_stereo_simd(simd_level))
    }

    #[cfg(target_arch = "x86_64")]
    fn process_stereo_frame_simd(&mut self, left: f32, right: f32) -> (f32, f32) {
        let mut l = left;
        let mut r = right;
        for band in &mut self.bands {
            unsafe {
                let (new_l, new_r) = band.process_stereo_frame_sse2(l, r);
                l = new_l;
                r = new_r;
            }
        }
        (l, r)
    }

    fn is_empty(&self) -> bool {
        self.bands.is_empty()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SimdLevel {
    Scalar,
    #[cfg(target_arch = "x86_64")]
    Sse2,
    #[cfg(target_arch = "x86_64")]
    Avx2,
}

fn detect_simd_level() -> SimdLevel {
    #[cfg(target_arch = "x86_64")]
    {
        if std::arch::is_x86_feature_detected!("avx2") {
            return SimdLevel::Avx2;
        }
        if std::arch::is_x86_feature_detected!("sse2") {
            return SimdLevel::Sse2;
        }
    }

    SimdLevel::Scalar
}

#[derive(Clone, Debug)]
struct LimiterProcessor {
    threshold: f32,
    release_step: f32,
    gain: f32,
    simd_level: SimdLevel,
}

impl LimiterProcessor {
    fn new(threshold_db: f32, sample_rate: u32, simd_level: SimdLevel) -> Option<Self> {
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
            simd_level,
        })
    }

    fn reset(&mut self) {
        self.gain = 1.0;
    }

    fn process_frame_in_place(&mut self, frame: &mut [f32]) {
        let peak = peak_abs_with_simd(frame, self.simd_level);

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

        mul_in_place_with_simd(frame, self.gain, self.simd_level);
    }
}

#[derive(Clone, Debug)]
struct DynamicGainProcessor {
    enabled: bool,
    target_rms: f32,
    gate_rms: f32,
    min_gain: f32,
    max_gain: f32,
    headroom_peak: f32,
    attack_coeff: f32,
    release_coeff: f32,
    rms_coeff: f32,
    peak_release_coeff: f32,
    unity_deadband_ratio: f32,
    transient_crest_threshold: f32,
    transient_boost_damp: f32,
    transient_hold_samples: usize,
    transient_hold_remaining: usize,
    rms_env_sq: f32,
    peak_env: f32,
    current_gain: f32,
}

impl DynamicGainProcessor {
    fn new(sample_rate: u32) -> Self {
        let sample_rate = sample_rate.max(1) as f32;
        let attack_coeff = smoothing_coeff_from_ms(DYNAMIC_GAIN_ATTACK_MS, sample_rate);
        let release_coeff = smoothing_coeff_from_ms(DYNAMIC_GAIN_RELEASE_MS, sample_rate);
        let rms_coeff = smoothing_coeff_from_ms(DYNAMIC_GAIN_RMS_WINDOW_MS, sample_rate);
        let peak_release_coeff = smoothing_coeff_from_ms(DYNAMIC_GAIN_PEAK_RELEASE_MS, sample_rate);
        let target_rms = gain_db_to_linear(DYNAMIC_GAIN_TARGET_DBFS).max(1.0e-6);
        let gate_rms = gain_db_to_linear(DYNAMIC_GAIN_GATE_DBFS).max(1.0e-7);
        let max_gain = gain_db_to_linear(DYNAMIC_GAIN_MAX_BOOST_DB).max(1.0);
        let min_gain = gain_db_to_linear(-DYNAMIC_GAIN_MAX_CUT_DB).clamp(0.01, 1.0);
        let headroom_peak = gain_db_to_linear(DYNAMIC_GAIN_HEADROOM_DBFS).clamp(0.25, 1.0);
        let unity_deadband_ratio = gain_db_to_linear(DYNAMIC_GAIN_UNITY_DEADBAND_DB).max(1.0);
        let transient_hold_samples =
            ((sample_rate * (DYNAMIC_GAIN_TRANSIENT_HOLD_MS / 1000.0)).round() as usize).max(1);

        Self {
            enabled: false,
            target_rms,
            gate_rms,
            min_gain,
            max_gain,
            headroom_peak,
            attack_coeff,
            release_coeff,
            rms_coeff,
            peak_release_coeff,
            unity_deadband_ratio,
            transient_crest_threshold: DYNAMIC_GAIN_TRANSIENT_CREST_THRESHOLD,
            transient_boost_damp: DYNAMIC_GAIN_TRANSIENT_BOOST_DAMP.clamp(0.0, 1.0),
            transient_hold_samples,
            transient_hold_remaining: 0,
            rms_env_sq: target_rms * target_rms,
            peak_env: target_rms,
            current_gain: 1.0,
        }
    }

    fn set_enabled(&mut self, enabled: bool) {
        if self.enabled == enabled {
            return;
        }
        self.enabled = enabled;
        if !enabled {
            self.reset();
        }
    }

    fn is_enabled(&self) -> bool {
        self.enabled
    }

    fn current_gain_db(&self) -> f32 {
        linear_to_gain_db(self.current_gain)
    }

    fn reset(&mut self) {
        self.current_gain = 1.0;
        self.transient_hold_remaining = 0;
        self.rms_env_sq = self.target_rms * self.target_rms;
        self.peak_env = self.target_rms;
    }

    fn process_frame_in_place(&mut self, frame: &mut [f32], simd_level: SimdLevel) {
        if !self.enabled || frame.is_empty() {
            return;
        }

        let frame_rms = rms_abs_with_simd(frame, simd_level);
        let frame_peak = peak_abs_with_simd(frame, simd_level).max(frame_rms);

        let energy = frame_rms * frame_rms;
        self.rms_env_sq =
            (self.rms_coeff * self.rms_env_sq + (1.0 - self.rms_coeff) * energy).max(1.0e-12);
        self.peak_env = frame_peak.max(self.peak_env * self.peak_release_coeff);

        let envelope_rms = self.rms_env_sq.sqrt().max(1.0e-6);

        if frame_peak > envelope_rms * self.transient_crest_threshold {
            self.transient_hold_remaining = self.transient_hold_samples;
        } else if self.transient_hold_remaining > 0 {
            self.transient_hold_remaining = self.transient_hold_remaining.saturating_sub(1);
        }

        let mut desired_gain = if !envelope_rms.is_finite() || envelope_rms <= self.gate_rms {
            1.0
        } else {
            (self.target_rms / envelope_rms).clamp(self.min_gain, self.max_gain)
        };

        if desired_gain > 1.0 {
            let crest = self.peak_env / envelope_rms;
            if crest.is_finite() && crest > self.transient_crest_threshold {
                let excess = (crest - self.transient_crest_threshold).clamp(0.0, 6.0);
                let attenuation = 1.0 / (1.0 + 0.45 * excess);
                desired_gain = 1.0 + (desired_gain - 1.0) * attenuation;
            }

            if self.transient_hold_remaining > 0 {
                desired_gain = 1.0 + (desired_gain - 1.0) * self.transient_boost_damp;
            }
        }

        let peak_limited_gain =
            (self.headroom_peak / self.peak_env.max(1.0e-6)).clamp(self.min_gain, self.max_gain);
        desired_gain = desired_gain.min(peak_limited_gain);

        if desired_gain > 1.0 / self.unity_deadband_ratio
            && desired_gain < self.unity_deadband_ratio
        {
            desired_gain = 1.0;
        }

        let coeff = if desired_gain < self.current_gain {
            self.attack_coeff
        } else {
            self.release_coeff
        };
        self.current_gain = (coeff * self.current_gain + (1.0 - coeff) * desired_gain)
            .clamp(self.min_gain, self.max_gain);

        let instant_peak_limited_gain =
            (self.headroom_peak / frame_peak.max(1.0e-6)).clamp(self.min_gain, self.max_gain);
        self.current_gain = self.current_gain.min(instant_peak_limited_gain);

        if (self.current_gain - 1.0).abs() < 1.0e-5 {
            return;
        }

        scalar_mul_in_place(frame, self.current_gain);
    }
}

#[inline]
fn smoothing_coeff_from_ms(time_ms: f32, sample_rate: f32) -> f32 {
    if !time_ms.is_finite() || time_ms <= 0.0 {
        return 0.0;
    }
    let tau = (time_ms / 1000.0).max(0.001);
    (-1.0 / (tau * sample_rate.max(1.0)))
        .exp()
        .clamp(0.0, 0.999_999)
}

#[inline]
fn linear_to_gain_db(gain: f32) -> f32 {
    if !gain.is_finite() || gain <= 0.0 {
        return -120.0;
    }
    20.0 * gain.log10()
}

#[inline]
#[allow(dead_code)]
fn rms_abs(samples: &[f32]) -> f32 {
    rms_abs_with_simd(samples, detect_simd_level())
}

#[inline]
fn rms_abs_with_simd(samples: &[f32], simd_level: SimdLevel) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }

    #[cfg(target_arch = "x86_64")]
    {
        match simd_level {
            SimdLevel::Avx2 => unsafe {
                return rms_abs_avx2(samples);
            },
            SimdLevel::Sse2 => unsafe {
                return rms_abs_sse2(samples);
            },
            SimdLevel::Scalar => {}
        }
    }

    #[cfg(not(target_arch = "x86_64"))]
    let _ = simd_level;

    let mut sum_sq = 0.0f32;
    for sample in samples {
        sum_sq += sample * sample;
    }

    (sum_sq / samples.len() as f32).sqrt()
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "sse2")]
unsafe fn rms_abs_sse2(samples: &[f32]) -> f32 {
    use std::arch::x86_64::*;

    let mut i = 0usize;
    let len = samples.len();
    let mut sum_vec = _mm_setzero_ps();

    while i + 4 <= len {
        let ptr = samples.as_ptr().add(i);
        let x = _mm_loadu_ps(ptr);
        sum_vec = _mm_add_ps(sum_vec, _mm_mul_ps(x, x));
        i += 4;
    }

    let mut tmp = [0.0f32; 4];
    _mm_storeu_ps(tmp.as_mut_ptr(), sum_vec);
    let mut sum_sq = tmp[0] + tmp[1] + tmp[2] + tmp[3];

    while i < len {
        let s = *samples.get_unchecked(i);
        sum_sq += s * s;
        i += 1;
    }

    if len == 0 {
        0.0
    } else {
        (sum_sq / len as f32).sqrt()
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn rms_abs_avx2(samples: &[f32]) -> f32 {
    use std::arch::x86_64::*;

    let mut i = 0usize;
    let len = samples.len();
    let mut sum_vec = _mm256_setzero_ps();

    while i + 8 <= len {
        let ptr = samples.as_ptr().add(i);
        let x = _mm256_loadu_ps(ptr);
        sum_vec = _mm256_add_ps(sum_vec, _mm256_mul_ps(x, x));
        i += 8;
    }

    let mut tmp = [0.0f32; 8];
    _mm256_storeu_ps(tmp.as_mut_ptr(), sum_vec);
    let mut sum_sq = 0.0f32;
    for value in tmp {
        sum_sq += value;
    }

    if i < len {
        let remaining_rms = rms_abs_sse2(&samples[i..]);
        let remaining_len = len - i;
        sum_sq += remaining_rms * remaining_rms * remaining_len as f32;
    }

    if len == 0 {
        0.0
    } else {
        (sum_sq / len as f32).sqrt()
    }
}

#[allow(dead_code)]
#[inline]
fn peak_abs(samples: &[f32]) -> f32 {
    peak_abs_with_simd(samples, detect_simd_level())
}

#[inline]
fn peak_abs_with_simd(samples: &[f32], simd_level: SimdLevel) -> f32 {
    #[cfg(target_arch = "x86_64")]
    {
        match simd_level {
            SimdLevel::Avx2 => unsafe {
                return peak_abs_avx2(samples);
            },
            SimdLevel::Sse2 => unsafe {
                return peak_abs_sse2(samples);
            },
            SimdLevel::Scalar => {}
        }
    }

    #[cfg(not(target_arch = "x86_64"))]
    let _ = simd_level;

    let mut peak = 0.0f32;
    for sample in samples {
        peak = peak.max(sample.abs());
    }
    peak
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "sse2")]
unsafe fn peak_abs_sse2(samples: &[f32]) -> f32 {
    use std::arch::x86_64::*;

    let mut i = 0usize;
    let len = samples.len();
    let sign_mask = _mm_set1_ps(-0.0);
    let mut max_vec = _mm_setzero_ps();

    while i + 4 <= len {
        let ptr = samples.as_ptr().add(i);
        let x = _mm_loadu_ps(ptr);
        let abs = _mm_andnot_ps(sign_mask, x);
        max_vec = _mm_max_ps(max_vec, abs);
        i += 4;
    }

    let mut tmp = [0.0f32; 4];
    _mm_storeu_ps(tmp.as_mut_ptr(), max_vec);
    let mut peak = tmp[0].max(tmp[1]).max(tmp[2]).max(tmp[3]);

    while i < len {
        peak = peak.max(samples.get_unchecked(i).abs());
        i += 1;
    }

    peak
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn peak_abs_avx2(samples: &[f32]) -> f32 {
    use std::arch::x86_64::*;

    let mut i = 0usize;
    let len = samples.len();
    let sign_mask = _mm256_set1_ps(-0.0);
    let mut max_vec = _mm256_setzero_ps();

    while i + 8 <= len {
        let ptr = samples.as_ptr().add(i);
        let x = _mm256_loadu_ps(ptr);
        let abs = _mm256_andnot_ps(sign_mask, x);
        max_vec = _mm256_max_ps(max_vec, abs);
        i += 8;
    }

    let mut tmp = [0.0f32; 8];
    _mm256_storeu_ps(tmp.as_mut_ptr(), max_vec);
    let mut peak = 0.0f32;
    for value in tmp {
        peak = peak.max(value);
    }

    if i < len {
        peak = peak.max(peak_abs_sse2(&samples[i..]));
    }

    peak
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

#[inline]
fn mul_in_place_with_simd(samples: &mut [f32], gain: f32, simd_level: SimdLevel) {
    #[cfg(target_arch = "x86_64")]
    {
        match simd_level {
            SimdLevel::Avx2 => unsafe {
                simd_mul_in_place_avx2(samples, gain);
                return;
            },
            SimdLevel::Sse2 => unsafe {
                simd_mul_in_place_sse2(samples, gain);
                return;
            },
            SimdLevel::Scalar => {}
        }
    }

    #[cfg(not(target_arch = "x86_64"))]
    let _ = simd_level;

    scalar_mul_in_place(samples, gain);
}

#[derive(Clone, Debug)]
struct LinearRateProcessor {
    rate: f64,
    src_pos: f64,
    carry: Vec<f32>,
    has_carry: bool,
}

impl LinearRateProcessor {
    fn new(rate: f32, channels: usize) -> Self {
        Self {
            rate: sanitize_tempo_rate(rate) as f64,
            src_pos: 0.0,
            carry: vec![0.0; channels.max(1)],
            has_carry: false,
        }
    }

    fn set_rate(&mut self, rate: f32, channels: usize) {
        let rate = sanitize_tempo_rate(rate) as f64;
        if (self.rate - rate).abs() > 1e-6 {
            self.src_pos = 0.0;
            self.has_carry = false;
        }
        self.rate = rate;
        if self.carry.len() < channels {
            self.carry.resize(channels, 0.0);
        }
    }

    fn reset(&mut self) {
        self.src_pos = 0.0;
        self.has_carry = false;
    }

    fn process_interleaved_into(&mut self, input: &[f32], channels: usize, output: &mut Vec<f32>) {
        output.clear();
        let channels = channels.max(1);
        let frames_in = input.len() / channels;
        if frames_in == 0 {
            return;
        }
        if self.carry.len() < channels {
            self.carry.resize(channels, 0.0);
        }

        let had_carry = self.has_carry;
        let max_frame = if had_carry {
            frames_in
        } else {
            frames_in.saturating_sub(1)
        };
        if max_frame == 0 {
            let base = (frames_in - 1) * channels;
            self.carry[..channels].copy_from_slice(&input[base..base + channels]);
            self.has_carry = true;
            return;
        }

        let estimated_frames = ((frames_in as f64) / self.rate).ceil().max(1.0) as usize;
        let estimated_samples = estimated_frames.saturating_mul(channels);
        if output.capacity() < estimated_samples {
            crate::audio::memory_pool::reserve_f32_capacity(
                output,
                estimated_samples,
                "dsp.tempo.output_growth",
            );
        }

        while self.src_pos < max_frame as f64 {
            let i0 = self.src_pos.floor() as usize;
            let i1 = (i0 + 1).min(max_frame);
            let frac = (self.src_pos - i0 as f64) as f32;

            for ch in 0..channels {
                let a = self.sample_at(input, channels, had_carry, ch, i0);
                let b = self.sample_at(input, channels, had_carry, ch, i1);
                output.push(lerp_scalar(a, b, frac));
            }
            self.src_pos += self.rate;
        }

        let consumed_span = frames_in as f64 - if had_carry { 0.0 } else { 1.0 };
        self.src_pos -= consumed_span;
        if self.src_pos < 0.0 {
            self.src_pos = 0.0;
        }

        let base = (frames_in - 1) * channels;
        self.carry[..channels].copy_from_slice(&input[base..base + channels]);
        self.has_carry = true;
    }

    fn sample_at(
        &self,
        input: &[f32],
        channels: usize,
        had_carry: bool,
        channel: usize,
        frame: usize,
    ) -> f32 {
        if had_carry {
            if frame == 0 {
                self.carry[channel]
            } else {
                input[(frame - 1) * channels + channel]
            }
        } else {
            input[frame * channels + channel]
        }
    }
}

#[derive(Clone, Debug)]
struct DelayLinePitchShifter {
    semitones: f32,
    ratio: f32,
    channels: usize,
    max_delay_frames: usize,
    phase: f32,
    write_frame: usize,
    buffers: Vec<Vec<f32>>,
}

impl DelayLinePitchShifter {
    fn new(semitones: f32, sample_rate: u32, channels: usize) -> Self {
        let mut out = Self {
            semitones: 0.0,
            ratio: 1.0,
            channels: channels.max(1),
            max_delay_frames: 1,
            phase: 0.0,
            write_frame: 0,
            buffers: Vec::new(),
        };
        out.configure(semitones, sample_rate, channels);
        out
    }

    fn configure(&mut self, semitones: f32, sample_rate: u32, channels: usize) {
        let semitones = if semitones.is_finite() {
            semitones.clamp(-36.0, 36.0)
        } else {
            0.0
        };
        let channels = channels.max(1);
        let max_delay_frames = ((sample_rate.max(1) as f32) * 0.05)
            .round()
            .clamp(256.0, 4096.0) as usize;
        let ratio = 2.0f32.powf(semitones / 12.0).clamp(0.125, 8.0);

        let topology_changed =
            self.channels != channels || self.max_delay_frames != max_delay_frames;
        let pitch_changed = (self.semitones - semitones).abs() > 1e-3;

        self.semitones = semitones;
        self.ratio = ratio;
        self.channels = channels;
        self.max_delay_frames = max_delay_frames;

        if topology_changed {
            let len = self.buffer_len();
            self.buffers = (0..channels).map(|_| vec![0.0; len]).collect();
            self.write_frame = 0;
            self.phase = 0.0;
        } else if pitch_changed {
            self.phase = 0.0;
        }
    }

    fn reset(&mut self) {
        self.phase = 0.0;
        self.write_frame = 0;
        for channel in &mut self.buffers {
            channel.fill(0.0);
        }
    }

    fn latency_frames(&self) -> usize {
        if self.is_active() {
            self.max_delay_frames
        } else {
            0
        }
    }

    fn is_active(&self) -> bool {
        self.semitones.abs() > 1e-3 && (self.ratio - 1.0).abs() > 1e-4
    }

    fn buffer_len(&self) -> usize {
        self.max_delay_frames.saturating_add(8).max(16)
    }

    fn process_interleaved_in_place(&mut self, samples: &mut [f32]) {
        if !self.is_active() {
            return;
        }
        let channels = self.channels.max(1);
        let frames = samples.len() / channels;
        if frames == 0 {
            return;
        }
        let len = self.buffer_len();
        if self.buffers.len() != channels || self.buffers.iter().any(|channel| channel.len() != len)
        {
            self.buffers = (0..channels).map(|_| vec![0.0; len]).collect();
            self.write_frame %= len;
        }

        let phase_step =
            ((self.ratio - 1.0).abs() / self.max_delay_frames.max(1) as f32).clamp(1.0e-6, 0.25);

        for frame in 0..frames {
            let write_idx = self.write_frame % len;
            let base = frame * channels;
            for ch in 0..channels {
                self.buffers[ch][write_idx] = samples[base + ch];
            }

            let phase_a = self.phase;
            let phase_b = (self.phase + 0.5) % 1.0;
            let weight_a = pitch_window_weight(phase_a);
            let weight_b = pitch_window_weight(phase_b);
            let norm = (weight_a + weight_b).max(1.0e-6);

            for ch in 0..channels {
                let a = self.read_tap(ch, phase_a);
                let b = self.read_tap(ch, phase_b);
                samples[base + ch] = (a * weight_a + b * weight_b) / norm;
            }

            self.phase += phase_step;
            if self.phase >= 1.0 {
                self.phase -= 1.0;
            }
            self.write_frame = (self.write_frame + 1) % len;
        }
    }

    fn read_tap(&self, channel: usize, phase: f32) -> f32 {
        let len = self.buffer_len();
        let delay = if self.ratio >= 1.0 {
            self.max_delay_frames as f32 * (1.0 - phase)
        } else {
            self.max_delay_frames as f32 * phase
        } + 2.0;
        let write_idx = self.write_frame % len;
        let mut read_pos = write_idx as f32 - delay;
        while read_pos < 0.0 {
            read_pos += len as f32;
        }
        while read_pos >= len as f32 {
            read_pos -= len as f32;
        }
        let i0 = read_pos.floor() as usize % len;
        let i1 = (i0 + 1) % len;
        let frac = read_pos - i0 as f32;
        lerp_scalar(self.buffers[channel][i0], self.buffers[channel][i1], frac)
    }
}

fn pitch_window_weight(phase: f32) -> f32 {
    let phase = phase.clamp(0.0, 1.0);
    let s = (std::f32::consts::PI * phase).sin();
    s * s
}

fn sanitize_tempo_rate(rate: f32) -> f32 {
    if rate.is_finite() {
        rate.clamp(0.25, 4.0)
    } else {
        1.0
    }
}

#[derive(Clone, Debug)]
struct TimePitchProcessor {
    config: TimePitchConfig,
    sample_rate: u32,
    rate: LinearRateProcessor,
    pitch: DelayLinePitchShifter,
    scratch: Vec<f32>,
}

impl TimePitchProcessor {
    fn new(config: TimePitchConfig, sample_rate: u32, channels: usize) -> Self {
        let channels = channels.max(1);
        let config = TimePitchConfig::sanitized(config.speed_rate, config.pitch_semitones);
        Self {
            config,
            sample_rate: sample_rate.max(1),
            rate: LinearRateProcessor::new(config.speed_rate, channels),
            pitch: DelayLinePitchShifter::new(config.pitch_semitones, sample_rate, channels),
            scratch: Vec::new(),
        }
    }

    fn reset(&mut self) {
        self.rate.reset();
        self.pitch.reset();
    }

    fn latency_frames(&self) -> usize {
        self.pitch.latency_frames()
    }

    fn has_time_pitch(&self) -> bool {
        self.config.is_active()
    }

    fn has_variable_length(&self) -> bool {
        self.config.has_speed()
    }

    fn process_interleaved(&mut self, samples: &mut Vec<f32>, channels: usize) {
        let channels = channels.max(1);
        if self.config.has_speed() {
            self.rate.set_rate(self.config.speed_rate, channels);
            self.rate
                .process_interleaved_into(samples, channels, &mut self.scratch);
            std::mem::swap(samples, &mut self.scratch);
        }

        if self.config.has_pitch() && !samples.is_empty() {
            self.pitch
                .configure(self.config.pitch_semitones, self.sample_rate, channels);
            self.pitch.process_interleaved_in_place(samples);
        }
    }
}

#[derive(Clone, Debug)]
struct DspChainProcessor {
    gain_linear: f32,
    eq: EqProcessor,
    time_pitch: TimePitchProcessor,
    dynamic_gain: DynamicGainProcessor,
    limiter: Option<LimiterProcessor>,
    simd_level: SimdLevel,
    channels: usize,
    scratch_frame: Vec<f32>,
}

impl Default for DspChainProcessor {
    fn default() -> Self {
        Self {
            gain_linear: 1.0,
            eq: EqProcessor::default(),
            time_pitch: TimePitchProcessor::new(TimePitchConfig::default(), 48_000, 1),
            dynamic_gain: DynamicGainProcessor::new(48_000),
            limiter: None,
            simd_level: detect_simd_level(),
            channels: 0,
            scratch_frame: Vec::new(),
        }
    }
}

impl DspChainProcessor {
    fn from_runtime_config(config: &DspRuntimeConfig, sample_rate: u32, channels: usize) -> Self {
        let eq = EqProcessor::from_config(&config.eq_bands, sample_rate, channels);
        let time_pitch = TimePitchProcessor::new(config.time_pitch, sample_rate, channels);
        let simd_level = detect_simd_level();
        let limiter = config
            .limiter_threshold_db
            .and_then(|db| LimiterProcessor::new(db, sample_rate, simd_level));
        Self {
            gain_linear: config.gain_linear,
            eq,
            time_pitch,
            dynamic_gain: DynamicGainProcessor::new(sample_rate),
            limiter,
            simd_level,
            channels,
            scratch_frame: vec![0.0; channels.max(1)],
        }
    }

    fn reset(&mut self) {
        self.eq.reset();
        self.time_pitch.reset();
        self.dynamic_gain.reset();
        if let Some(limiter) = &mut self.limiter {
            limiter.reset();
        }
    }

    fn has_time_pitch(&self) -> bool {
        self.time_pitch.has_time_pitch()
    }

    fn has_variable_length(&self) -> bool {
        self.time_pitch.has_variable_length()
    }

    fn latency_frames(&self) -> usize {
        self.time_pitch.latency_frames()
    }

    fn process_interleaved(&mut self, samples: &mut Vec<f32>) -> f32 {
        let channels = self.channels.max(1);
        if self.time_pitch.has_time_pitch() {
            self.time_pitch.process_interleaved(samples, channels);
        }
        self.process_interleaved_in_place(samples)
    }

    fn process_interleaved_in_place(&mut self, samples: &mut [f32]) -> f32 {
        let channels = self.channels.max(1);
        let gain = self.gain_linear;
        let has_eq = !self.eq.is_empty();
        let has_dynamic_gain = self.dynamic_gain.is_enabled();
        let has_limiter = self.limiter.is_some();
        #[cfg(target_arch = "x86_64")]
        let use_stereo_eq_simd =
            has_eq && channels == 2 && self.eq.can_use_stereo_simd(self.simd_level);
        #[cfg(not(target_arch = "x86_64"))]
        let use_stereo_eq_simd = false;

        if (gain - 1.0).abs() < 1e-6 && !has_eq && !has_dynamic_gain && !has_limiter {
            return self.dynamic_gain.current_gain_db();
        }

        if !has_eq && !has_dynamic_gain && !has_limiter {
            if (gain - 1.0).abs() < 1e-6 {
                return self.dynamic_gain.current_gain_db();
            }

            mul_in_place_with_simd(samples, gain, self.simd_level);
            return self.dynamic_gain.current_gain_db();
        }

        let frames = samples.len() / channels;
        let limit = frames * channels;
        if self.scratch_frame.len() < channels {
            self.scratch_frame.resize(channels, 0.0);
        }

        for frame in 0..frames {
            let base = frame * channels;
            if use_stereo_eq_simd {
                #[cfg(target_arch = "x86_64")]
                {
                    let (left, right) = self
                        .eq
                        .process_stereo_frame_simd(samples[base] * gain, samples[base + 1] * gain);
                    self.scratch_frame[0] = left;
                    self.scratch_frame[1] = right;
                }
            } else {
                for ch in 0..channels {
                    let idx = base + ch;
                    let mut x = samples[idx] * gain;
                    if has_eq {
                        x = self.eq.process_sample(x, ch);
                    }
                    self.scratch_frame[ch] = x;
                }
            }

            if has_dynamic_gain {
                self.dynamic_gain
                    .process_frame_in_place(&mut self.scratch_frame[..channels], self.simd_level);
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
            if has_dynamic_gain {
                let mut frame = [x];
                self.dynamic_gain
                    .process_frame_in_place(&mut frame, self.simd_level);
                x = frame[0];
            }
            if let Some(limiter) = &mut self.limiter {
                let mut frame = [x];
                limiter.process_frame_in_place(&mut frame);
                x = frame[0];
            }
            samples[idx] = x;
        }

        self.dynamic_gain.current_gain_db()
    }
}

struct PreparedDspUpdate {
    version: u64,
    processor: DspChainProcessor,
    requires_fade_transition: bool,
    vst_keys: Vec<crate::vst_dsp::VstNodeKey>,
    vst_nodes: Option<Vec<crate::vst_dsp::VstDspNode>>,
}

pub(crate) struct DspProcessingSource<S>
where
    S: Source<Item = f32> + BulkSource + Send,
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
    S: Source<Item = f32> + BulkSource + Send,
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
        let builder_last_time_pitch = snapshot.time_pitch;
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
            let mut last_time_pitch = builder_last_time_pitch;

            loop {
                if pending_stop_thread.load(Ordering::Acquire) {
                    break;
                }

                let version = dsp_thread
                    .wait_for_slow_version_change(last_seen_version, &pending_stop_thread);
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
                    time_pitch: slow.time_pitch,
                    vst_nodes: Vec::new(),
                };
                let processor = DspChainProcessor::from_runtime_config(
                    &config,
                    sample_rate_thread,
                    channels_usize,
                );

                let vst_keys = slow.vst_nodes.clone();
                let time_pitch_changed = slow.time_pitch != last_time_pitch;
                last_time_pitch = slow.time_pitch;
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
                let requires_fade_transition = time_pitch_changed || vst_nodes.is_some();

                let mut guard = match pending_update_thread.lock() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                *guard = Some(PreparedDspUpdate {
                    version,
                    processor,
                    requires_fade_transition,
                    vst_keys,
                    vst_nodes,
                });
            }
        });

        let local = Vec::with_capacity(Self::CHUNK_SAMPLES);
        let update_scratch = Vec::with_capacity(local.capacity());

        dsp.update_pipeline_latency_frames(0);

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
            local,
            update_scratch,
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
        self.processor
            .dynamic_gain
            .set_enabled(self.dsp.dynamic_gain_enabled());
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

        if update.requires_fade_transition
            || self.processor.has_time_pitch()
            || update.processor.has_time_pitch()
            || update.processor.has_variable_length()
        {
            self.processor = update.processor;
            self.processor.gain_linear = gain_linear;
            self.processor
                .dynamic_gain
                .set_enabled(self.dsp.dynamic_gain_enabled());
            self.vst_keys = update.vst_keys;
            if let Some(vst_nodes) = update.vst_nodes {
                self.vst_nodes = vst_nodes;
            }
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
            self.processor
                .dynamic_gain
                .set_enabled(self.dsp.dynamic_gain_enabled());
            self.processor_version = update.version;
            return false;
        }
        let crossfade_frames = crossfade_frames.min(frames);
        let crossfade_samples = crossfade_frames
            .saturating_mul(channels)
            .min(self.local.len());

        self.update_scratch.clear();
        crate::audio::memory_pool::reserve_f32_capacity(
            &mut self.update_scratch,
            self.local.len(),
            "dsp.update_scratch.growth",
        );
        self.update_scratch.extend_from_slice(&self.local);

        let mut next_processor = update.processor;
        next_processor.gain_linear = gain_linear;
        next_processor
            .dynamic_gain
            .set_enabled(self.dsp.dynamic_gain_enabled());
        let dynamic_gain_db = next_processor.process_interleaved_in_place(&mut self.local);
        self.dsp.update_dynamic_gain_db(dynamic_gain_db);

        if crossfade_samples > 0 {
            self.processor.gain_linear = gain_linear;
            self.processor
                .dynamic_gain
                .set_enabled(self.dsp.dynamic_gain_enabled());
            let _ = self
                .processor
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

    /// Total NN latency in frames from all active NN nodes.
    fn nn_total_latency_frames(&self) -> usize {
        // Will be populated when NN nodes are integrated into the processing chain.
        // For now, returns 0 (no NN nodes active).
        0
    }

    fn pipeline_total_latency_frames(&self) -> usize {
        self.nn_total_latency_frames()
            .saturating_add(self.processor.latency_frames())
    }

    fn refill_local(&mut self) -> bool {
        let refill_start = Instant::now();
        self.local.clear();
        self.local_index = 0;

        self.local.resize(Self::CHUNK_SAMPLES, 0.0);
        let filled = self.inner.fill_buffer(self.local.as_mut_slice());
        self.local.truncate(filled);

        if self.local.is_empty() {
            return false;
        }

        let processor_already_applied = self.maybe_apply_update_on_refill();
        self.ensure_processor_uptodate();
        if !processor_already_applied {
            let dynamic_gain_db = self.processor.process_interleaved(&mut self.local);
            self.dsp.update_dynamic_gain_db(dynamic_gain_db);
        }
        self.pre_tap
            .push_interleaved(&self.local, self.channels.max(1) as usize);
        for node in &mut self.vst_nodes {
            node.process_interleaved_in_place(&mut self.local);
        }
        self.apply_fade_in();
        self.post_tap
            .push_interleaved(&self.local, self.channels.max(1) as usize);

        self.dsp
            .update_pipeline_latency_frames(self.pipeline_total_latency_frames());

        let refill_elapsed_us = refill_start.elapsed().as_micros().min(u64::MAX as u128) as u64;
        let chunk_frames = self.local.len() / (self.channels.max(1) as usize);
        let budget_us = if self.sample_rate > 0 && chunk_frames > 0 {
            ((chunk_frames as u64) * 1_000_000 * 80) / (self.sample_rate as u64 * 100)
        } else {
            0
        };
        if budget_us > 0 && refill_elapsed_us > budget_us {
            crate::audio::diagnostics::record_event_throttled(
                "dsp.refill.budget_exceeded",
                refill_elapsed_us,
                budget_us,
                &DSP_REFILL_BUDGET_TIMELINE_GATE_MS,
                200,
            );
        }
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
    S: Source<Item = f32> + BulkSource + Send + 'static,
{
    Box::new(DspProcessingSource::new(source, dsp, pre_tap, post_tap))
}

impl<S> Drop for DspProcessingSource<S>
where
    S: Source<Item = f32> + BulkSource + Send,
{
    fn drop(&mut self) {
        self.pending_update_stop.store(true, Ordering::Release);
        self.dsp.update_pipeline_latency_frames(0);
        self.dsp.wake_slow_update_waiters();
    }
}

impl<S> Iterator for DspProcessingSource<S>
where
    S: Source<Item = f32> + BulkSource + Send,
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
    S: Source<Item = f32> + BulkSource + Send,
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
    inner: Arc<Mutex<SpectrumTapRing>>,
}

struct SpectrumTapRing {
    data: Box<[f32]>,
    write_pos: usize,
    count: usize,
    capacity: usize,
    sample_rate: u32,
}

impl SpectrumTapRing {
    fn new(capacity: usize) -> Self {
        let capacity = capacity.max(1);
        Self {
            data: vec![0.0f32; capacity].into_boxed_slice(),
            write_pos: 0,
            count: 0,
            capacity,
            sample_rate: 0,
        }
    }

    fn push(&mut self, sample: f32) {
        self.data[self.write_pos] = sample;
        self.write_pos = (self.write_pos + 1) % self.capacity;
        if self.count < self.capacity {
            self.count += 1;
        }
    }

    fn push_mono_slice(&mut self, samples: &[f32]) {
        for &sample in samples {
            self.push(sample);
        }
    }

    fn snapshot_to_vec(&self) -> Vec<f32> {
        if self.count == 0 {
            return Vec::new();
        }

        let mut result = Vec::with_capacity(self.count);
        let start = if self.count < self.capacity {
            0
        } else {
            self.write_pos
        };

        for i in 0..self.count {
            result.push(self.data[(start + i) % self.capacity]);
        }

        result
    }

    fn clear(&mut self) {
        self.write_pos = 0;
        self.count = 0;
    }
}

impl SpectrumTap {
    pub(crate) fn new(capacity: usize) -> Self {
        Self {
            inner: Arc::new(Mutex::new(SpectrumTapRing::new(capacity))),
        }
    }

    pub(crate) fn set_sample_rate(&self, sample_rate: u32) {
        if let Ok(mut ring) = self.inner.lock() {
            ring.sample_rate = sample_rate;
        }
    }

    pub(crate) fn clear(&self) {
        if let Ok(mut ring) = self.inner.lock() {
            ring.clear();
        }
    }

    pub(crate) fn push_interleaved(&self, samples: &[f32], channels: usize) {
        if channels == 0 || samples.is_empty() {
            return;
        }

        let frames = samples.len() / channels;
        if frames == 0 {
            return;
        }

        const STACK_FRAMES: usize = 4096;
        let mut mono_stack = [0.0f32; STACK_FRAMES];
        let mut mono_heap = Vec::new();
        let mono = if frames <= STACK_FRAMES {
            &mut mono_stack[..frames]
        } else {
            mono_heap.resize(frames, 0.0);
            mono_heap.as_mut_slice()
        };

        for frame in 0..frames {
            let base = frame * channels;
            let mut sum = 0.0f32;
            for ch in 0..channels {
                sum += samples[base + ch];
            }
            mono[frame] = sum / channels as f32;
        }

        let mut ring = match self.inner.try_lock() {
            Ok(ring) => ring,
            Err(_) => return,
        };
        ring.push_mono_slice(mono);
    }

    pub(crate) fn snapshot(&self) -> Option<(Vec<f32>, u32)> {
        let ring = self.inner.try_lock().ok()?;
        if ring.sample_rate == 0 || ring.count == 0 {
            return None;
        }
        Some((ring.snapshot_to_vec(), ring.sample_rate))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn deterministic_samples(len: usize, seed: u32) -> Vec<f32> {
        let mut state = seed;
        let mut out = Vec::with_capacity(len);
        for _ in 0..len {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let unit = state as f32 / u32::MAX as f32;
            out.push(unit * 2.0 - 1.0);
        }
        out
    }

    fn rms_abs_scalar_reference(samples: &[f32]) -> f32 {
        if samples.is_empty() {
            return 0.0;
        }

        let mut sum_sq = 0.0f32;
        for sample in samples {
            sum_sq += sample * sample;
        }

        (sum_sq / samples.len() as f32).sqrt()
    }

    #[derive(Clone)]
    struct SequenceSource {
        samples: Vec<f32>,
        position: usize,
        channels: u16,
        sample_rate: u32,
    }

    impl Iterator for SequenceSource {
        type Item = f32;

        fn next(&mut self) -> Option<Self::Item> {
            if self.position >= self.samples.len() {
                return None;
            }
            let sample = self.samples[self.position];
            self.position += 1;
            Some(sample)
        }
    }

    impl Source for SequenceSource {
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

    impl BulkSource for SequenceSource {}

    #[test]
    fn bulk_fill_matches_next_iteration() {
        let samples = vec![0.1f32, -0.2, 0.3, -0.4, 0.5, -0.6];
        let mut iter_source = SequenceSource {
            samples: samples.clone(),
            position: 0,
            channels: 2,
            sample_rate: 48_000,
        };
        let mut bulk_source = iter_source.clone();

        let expected: Vec<f32> = std::iter::from_fn(|| iter_source.next()).collect();
        let mut actual = vec![0.0f32; samples.len()];
        let filled = bulk_source.fill_buffer(&mut actual);
        actual.truncate(filled);

        assert_eq!(filled, expected.len());
        assert_eq!(actual, expected);
    }

    #[test]
    fn bulk_fill_handles_early_eof() {
        let samples = vec![0.25f32, -0.5, 0.75];
        let mut source = SequenceSource {
            samples: samples.clone(),
            position: 0,
            channels: 1,
            sample_rate: 48_000,
        };

        let mut out = vec![0.0f32; 8];
        let filled = source.fill_buffer(&mut out);

        assert_eq!(filled, samples.len());
        assert_eq!(&out[..filled], samples.as_slice());
    }

    #[test]
    fn bulk_fill_handles_empty_source() {
        let mut source = SequenceSource {
            samples: Vec::new(),
            position: 0,
            channels: 1,
            sample_rate: 48_000,
        };

        let mut out = [0.0f32; 4];
        let filled = source.fill_buffer(&mut out);
        assert_eq!(filled, 0);
    }

    #[derive(Clone)]
    struct CountingBulkSource {
        samples: Vec<f32>,
        position: usize,
        channels: u16,
        sample_rate: u32,
        next_calls: Arc<AtomicUsize>,
        fill_calls: Arc<AtomicUsize>,
    }

    impl Iterator for CountingBulkSource {
        type Item = f32;

        fn next(&mut self) -> Option<Self::Item> {
            self.next_calls.fetch_add(1, Ordering::Relaxed);
            if self.position >= self.samples.len() {
                return None;
            }
            let sample = self.samples[self.position];
            self.position += 1;
            Some(sample)
        }
    }

    impl Source for CountingBulkSource {
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

    impl BulkSource for CountingBulkSource {
        fn fill_buffer(&mut self, buf: &mut [f32]) -> usize {
            self.fill_calls.fetch_add(1, Ordering::Relaxed);
            let available = self.samples.len().saturating_sub(self.position);
            let to_copy = available.min(buf.len());
            let end = self.position + to_copy;
            buf[..to_copy].copy_from_slice(&self.samples[self.position..end]);
            self.position = end;
            to_copy
        }
    }

    #[test]
    fn dsp_processing_refill_uses_bulk_fill_path() {
        let next_calls = Arc::new(AtomicUsize::new(0));
        let fill_calls = Arc::new(AtomicUsize::new(0));
        let source = CountingBulkSource {
            samples: vec![0.25; DspProcessingSource::<CountingBulkSource>::CHUNK_SAMPLES],
            position: 0,
            channels: 2,
            sample_rate: 48_000,
            next_calls: next_calls.clone(),
            fill_calls: fill_calls.clone(),
        };

        let dsp = Arc::new(DspRuntime::new());
        let pre_tap = SpectrumTap::new(8);
        let post_tap = SpectrumTap::new(8);
        let mut processed = DspProcessingSource::new(source, dsp, pre_tap, post_tap);

        assert!(processed.refill_local());
        assert_eq!(fill_calls.load(Ordering::Relaxed), 1);
        assert_eq!(next_calls.load(Ordering::Relaxed), 0);
        assert_eq!(
            processed.local.len(),
            DspProcessingSource::<CountingBulkSource>::CHUNK_SAMPLES
        );
    }

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
    fn dsp_runtime_dynamic_gain_toggle_updates_state_and_reset_serial() {
        let runtime = DspRuntime::new();
        let before_reset = runtime.reset_serial();
        assert!(!runtime.dynamic_gain_enabled());

        runtime.set_dynamic_gain_enabled(true);
        assert!(runtime.dynamic_gain_enabled());
        assert!(runtime.reset_serial() > before_reset);

        runtime.update_dynamic_gain_db(3.5);
        assert!((runtime.dynamic_gain_db() - 3.5).abs() < 1e-6);

        runtime.set_dynamic_gain_enabled(false);
        assert!(!runtime.dynamic_gain_enabled());
        assert!(runtime.dynamic_gain_db().abs() < 1e-6);
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

        impl BulkSource for TestSource {}

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
    fn dsp_processing_source_prewarms_update_scratch_capacity() {
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

        impl BulkSource for TestSource {}

        let dsp = Arc::new(DspRuntime::new());
        let inner = TestSource {
            remaining: 0,
            channels: 2,
            sample_rate: 48_000,
            value: 0.0,
        };
        let pre_tap = SpectrumTap::new(8);
        let post_tap = SpectrumTap::new(8);
        let processed = DspProcessingSource::new(inner, dsp, pre_tap, post_tap);

        assert!(processed.local.capacity() >= DspProcessingSource::<TestSource>::CHUNK_SAMPLES);
        assert!(
            processed.update_scratch.capacity() >= DspProcessingSource::<TestSource>::CHUNK_SAMPLES
        );
        assert!(processed.update_scratch.capacity() >= processed.local.capacity());
    }

    #[test]
    fn refill_local_records_budget_exceeded_diagnostic_event() {
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

        impl BulkSource for TestSource {}

        let before = crate::audio::diagnostics::snapshot_recent_default();
        let before_seq = before.events.last().map(|event| event.seq).unwrap_or(0);
        let dropped_before = before.dropped_events;

        let dsp = Arc::new(DspRuntime::new());
        let mut observed_event = false;
        let mut observed_drop = false;

        for _ in 0..8 {
            DSP_REFILL_BUDGET_TIMELINE_GATE_MS.store(0, Ordering::Relaxed);

            let inner = TestSource {
                remaining: DspProcessingSource::<TestSource>::CHUNK_SAMPLES,
                channels: 1,
                sample_rate: 3_000_000_000,
                value: 0.25,
            };
            let pre_tap = SpectrumTap::new(8);
            let post_tap = SpectrumTap::new(8);
            let mut processed = DspProcessingSource::new(inner, dsp.clone(), pre_tap, post_tap);

            assert!(processed.refill_local());

            let after = crate::audio::diagnostics::snapshot_recent_default();
            observed_event = after
                .events
                .iter()
                .any(|event| event.seq > before_seq && event.kind == "dsp.refill.budget_exceeded");
            observed_drop = after.dropped_events > dropped_before;
            if observed_event || observed_drop {
                break;
            }

            std::thread::yield_now();
        }

        assert!(observed_event || observed_drop);
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

        impl BulkSource for TestSource {}

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

        impl BulkSource for TestSource {}

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

        let crossfade_frames = ((48_000u64).saturating_mul(5) / 1000).max(1).min(2048) as usize;
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
            time_pitch: TimePitchConfig::default(),
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
    fn dsp_runtime_applies_tempo_and_pitch_nodes() {
        let runtime = DspRuntime::new();
        runtime.apply_chain(&[
            DspNodeConfig::Tempo {
                rate: 1.5,
                preserve_pitch: true,
            },
            DspNodeConfig::PitchShift { semitones: 2.0 },
        ]);

        assert!((runtime.playback_rate() - 1.5).abs() < 1e-6);
        let slow = runtime.slow_config();
        assert!((slow.time_pitch.speed_rate - 1.5).abs() < 1e-6);
        let expected_pitch = 2.0 - 12.0 * 1.5f32.log2();
        assert!((slow.time_pitch.pitch_semitones - expected_pitch).abs() < 1e-5);
    }

    #[test]
    fn tempo_processor_changes_output_length() {
        let config = DspRuntimeConfig {
            gain_linear: 1.0,
            eq_bands: Vec::new(),
            limiter_threshold_db: None,
            time_pitch: TimePitchConfig::sanitized(2.0, 0.0),
            vst_nodes: Vec::new(),
        };

        let mut processor = DspChainProcessor::from_runtime_config(&config, 48_000, 2);
        let original_frames = 1024usize;
        let mut samples = vec![0.0f32; original_frames * 2];
        for frame in 0..original_frames {
            samples[frame * 2] = frame as f32 / original_frames as f32;
            samples[frame * 2 + 1] = samples[frame * 2];
        }

        processor.process_interleaved(&mut samples);
        assert!(samples.len() < original_frames * 2);
        assert_eq!(samples.len() % 2, 0);
        assert!(samples.iter().all(|sample| sample.is_finite()));
    }

    #[test]
    fn dsp_chain_limiter_clamps_peaks() {
        let threshold_db = -6.0;
        let config = DspRuntimeConfig {
            gain_linear: 1.0,
            eq_bands: Vec::new(),
            limiter_threshold_db: Some(threshold_db),
            time_pitch: TimePitchConfig::default(),
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
    fn dsp_chain_dynamic_gain_boosts_low_level_frames_when_enabled() {
        let config = DspRuntimeConfig {
            gain_linear: 1.0,
            eq_bands: Vec::new(),
            limiter_threshold_db: None,
            time_pitch: TimePitchConfig::default(),
            vst_nodes: Vec::new(),
        };

        let mut processor = DspChainProcessor::from_runtime_config(&config, 48_000, 2);
        processor.dynamic_gain.set_enabled(true);

        let mut samples = vec![0.01f32; 48_000];
        let dynamic_gain_db = processor.process_interleaved_in_place(&mut samples);

        assert!(dynamic_gain_db > 0.5);
        assert!(samples.iter().all(|sample| *sample >= 0.01));
    }

    #[test]
    fn dynamic_gain_preserves_peak_headroom_on_transients() {
        let config = DspRuntimeConfig {
            gain_linear: 1.0,
            eq_bands: Vec::new(),
            limiter_threshold_db: None,
            time_pitch: TimePitchConfig::default(),
            vst_nodes: Vec::new(),
        };

        let mut processor = DspChainProcessor::from_runtime_config(&config, 48_000, 2);
        processor.dynamic_gain.set_enabled(true);

        let mut samples = vec![0.01f32; 4_096];
        // Inject one high-energy transient frame.
        samples[2_048] = 0.92;
        samples[2_049] = -0.92;

        processor.process_interleaved_in_place(&mut samples);

        let max_abs = samples
            .iter()
            .fold(0.0f32, |acc, sample| acc.max(sample.abs()));
        let headroom_peak = gain_db_to_linear(DYNAMIC_GAIN_HEADROOM_DBFS);

        assert!(max_abs <= headroom_peak + 0.02);
        assert!(max_abs.is_finite());
    }

    #[test]
    fn simd_level_detection_is_stable() {
        assert_eq!(detect_simd_level(), detect_simd_level());
    }

    #[test]
    fn rms_abs_simd_matches_scalar() {
        let lengths = [1usize, 3, 4, 7, 8, 15, 31, 64, 257, 1023];
        for (idx, len) in lengths.iter().enumerate() {
            let seed = 0xC0FF_EE00u32.wrapping_add(idx as u32);
            let samples = deterministic_samples(*len, seed);
            let expected = rms_abs_scalar_reference(&samples);
            let actual = rms_abs(&samples);
            assert!(
                (actual - expected).abs() < 1e-4,
                "len={len} expected={expected} actual={actual}"
            );

            #[cfg(target_arch = "x86_64")]
            {
                if std::arch::is_x86_feature_detected!("sse2") {
                    let sse2 = unsafe { rms_abs_sse2(&samples) };
                    assert!(
                        (sse2 - expected).abs() < 1e-4,
                        "len={len} expected={expected} sse2={sse2}"
                    );
                }
                if std::arch::is_x86_feature_detected!("avx2") {
                    let avx2 = unsafe { rms_abs_avx2(&samples) };
                    assert!(
                        (avx2 - expected).abs() < 1e-4,
                        "len={len} expected={expected} avx2={avx2}"
                    );
                }
            }
        }
    }

    #[test]
    fn rms_abs_handles_empty_and_single() {
        assert_eq!(rms_abs(&[]), 0.0);

        let single = [-0.75f32];
        assert!((rms_abs(&single) - 0.75).abs() < 1e-6);

        #[cfg(target_arch = "x86_64")]
        {
            if std::arch::is_x86_feature_detected!("sse2") {
                assert_eq!(unsafe { rms_abs_sse2(&[]) }, 0.0);
                assert!((unsafe { rms_abs_sse2(&single) } - 0.75).abs() < 1e-6);
            }
            if std::arch::is_x86_feature_detected!("avx2") {
                assert_eq!(unsafe { rms_abs_avx2(&[]) }, 0.0);
                assert!((unsafe { rms_abs_avx2(&single) } - 0.75).abs() < 1e-6);
            }
        }
    }

    #[cfg(target_arch = "x86_64")]
    #[test]
    fn eq_stereo_simd_matches_scalar() {
        let simd_level = detect_simd_level();
        if matches!(simd_level, SimdLevel::Scalar) {
            return;
        }

        let bands = vec![
            EqBandConfig {
                kind: EqBandKind::LowShelf,
                frequency_hz: 110.0,
                q: 0.9,
                gain_db: 2.0,
            },
            EqBandConfig {
                kind: EqBandKind::Peaking,
                frequency_hz: 1_200.0,
                q: 1.2,
                gain_db: -3.5,
            },
            EqBandConfig {
                kind: EqBandKind::HighShelf,
                frequency_hz: 6_500.0,
                q: 0.8,
                gain_db: 1.75,
            },
        ];

        let mut scalar = EqProcessor::from_config(&bands, 48_000, 2);
        let mut simd = scalar.clone();
        assert!(simd.can_use_stereo_simd(simd_level));

        let samples = deterministic_samples(2048, 0x1234_5678);
        for frame in samples.chunks_exact(2) {
            let left = frame[0];
            let right = frame[1];

            let expected_left = scalar.process_sample(left, 0);
            let expected_right = scalar.process_sample(right, 1);

            let (actual_left, actual_right) = simd.process_stereo_frame_simd(left, right);
            assert!((actual_left - expected_left).abs() < 1e-5);
            assert!((actual_right - expected_right).abs() < 1e-5);
        }
    }

    #[test]
    fn peak_abs_matches_scalar_max_abs() {
        let samples = [
            -0.1f32, 0.25, -0.9, 0.0, 0.33, -1.25, 1.1, -0.77, 0.42, -0.56, 0.88,
        ];
        let expected = samples
            .iter()
            .fold(0.0f32, |acc, value| acc.max(value.abs()));
        let actual = peak_abs(&samples);
        assert!((actual - expected).abs() < 1e-6);
    }

    #[test]
    fn spectrum_tap_push_and_snapshot_roundtrip() {
        let tap = SpectrumTap::new(8);
        tap.set_sample_rate(48_000);

        tap.push_interleaved(&[1.0, -1.0, 0.5, 0.0, -0.5, 0.5], 2);
        let (window, sample_rate) = tap.snapshot().expect("snapshot");

        assert_eq!(sample_rate, 48_000);
        assert_eq!(window, vec![0.0, 0.25, 0.0]);
    }

    #[test]
    fn spectrum_tap_circular_overwrites_oldest() {
        let tap = SpectrumTap::new(4);
        tap.set_sample_rate(48_000);

        tap.push_interleaved(
            &[0.0, 0.0, 1.0, 1.0, 2.0, 2.0, 3.0, 3.0, 4.0, 4.0, 5.0, 5.0],
            2,
        );
        let (window, _) = tap.snapshot().expect("snapshot");

        assert_eq!(window, vec![2.0, 3.0, 4.0, 5.0]);
    }

    #[test]
    fn spectrum_tap_snapshot_returns_none_when_empty() {
        let tap = SpectrumTap::new(8);
        tap.set_sample_rate(48_000);

        assert!(tap.snapshot().is_none());
    }

    #[test]
    fn spectrum_tap_clear_resets() {
        let tap = SpectrumTap::new(8);
        tap.set_sample_rate(48_000);

        tap.push_interleaved(&[0.25, 0.25, 0.5, 0.5], 2);
        assert!(tap.snapshot().is_some());

        tap.clear();

        assert!(tap.snapshot().is_none());
    }

    #[test]
    fn spectrum_tap_writer_reader_concurrent_access() {
        let tap = SpectrumTap::new(128);
        tap.set_sample_rate(48_000);

        let writer = tap.clone();
        let reader = tap.clone();
        let done = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let done_writer = done.clone();
        let done_reader = done.clone();

        let writer_handle = std::thread::spawn(move || {
            for frame in 0..2_000usize {
                let sample = frame as f32 * 0.001;
                writer.push_interleaved(&[sample, sample, sample * 0.5, sample * 0.5], 2);
            }
            done_writer.store(true, Ordering::Release);
        });

        let reader_handle = std::thread::spawn(move || {
            let mut saw_snapshot = false;
            for _ in 0..10_000 {
                if let Some((window, sample_rate)) = reader.snapshot() {
                    assert_eq!(sample_rate, 48_000);
                    if !window.is_empty() {
                        saw_snapshot = true;
                    }
                }

                if done_reader.load(Ordering::Acquire) && saw_snapshot {
                    break;
                }
                std::thread::yield_now();
            }
            saw_snapshot
        });

        writer_handle.join().expect("writer join");
        let saw_snapshot = reader_handle.join().expect("reader join");
        assert!(saw_snapshot);
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
