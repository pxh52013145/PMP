use serde::Serialize;
use std::{
    path::PathBuf,
    sync::atomic::Ordering,
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::AppHandle;

use crate::audio::events::{NativeAudioErrorPayload, NativeAudioStatePayload};
use crate::audio::emitter;
use crate::audio::output::{default_backend, AudioOutputBackend, RODIO_CPAL_BACKEND_ID};
#[cfg(target_os = "windows")]
use crate::audio::output::{wasapi_backend, wasapi_exclusive_backend, WASAPI_BACKEND_ID, WASAPI_EXCLUSIVE_BACKEND_ID};
#[cfg(all(target_os = "windows", feature = "asio-sdk"))]
use crate::audio::output::{asio_backend, ASIO_BACKEND_ID};
use crate::audio::engine::{ENGINE, PlaybackState};
use crate::dsp_graph::DspGraphNode;
use crate::vst_shm::ShmRing;

pub use crate::audio::engine::NativeAudioComponentsStatePayload;

pub use crate::audio::pipeline::{DspNodeConfig, EqBandConfig};

#[cfg(any())]
mod legacy_native_audio_dsp_pipeline {
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
    gain_db: f32,
    replay_gain_db: f32,
    gain_linear: f32,
    eq_bands: Vec<EqBandConfig>,
    limiter_threshold_db: Option<f32>,
    vst_nodes: Vec<crate::vst_dsp::VstNodeKey>,
}

impl Default for DspRuntimeConfig {
    fn default() -> Self {
        Self {
            gain_db: 0.0,
            replay_gain_db: 0.0,
            gain_linear: 1.0,
            eq_bands: Vec::new(),
            limiter_threshold_db: None,
            vst_nodes: Vec::new(),
        }
    }
}

struct DspRuntime {
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
    fn new() -> Self {
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
        let version = self.slow_version.fetch_add(1, Ordering::AcqRel).saturating_add(1);
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

    fn request_reset(&self) {
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

    fn snapshot(&self) -> DspRuntimeConfig {
        let gain_db = load_atomic_f32(&self.gain_db_bits);
        let replay_gain_db = load_atomic_f32(&self.replay_gain_db_bits);
        let gain_linear = load_atomic_f32(&self.gain_linear_bits);
        let slow = self.slow_config();

        DspRuntimeConfig {
            gain_db,
            replay_gain_db,
            gain_linear,
            eq_bands: slow.eq_bands.clone(),
            limiter_threshold_db: slow.limiter_threshold_db,
            vst_nodes: slow.vst_nodes.clone(),
        }
    }

    fn apply_chain(&self, chain: &[DspNodeConfig]) -> f32 {
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
        store_atomic_f32(
            &self.gain_linear_bits,
            gain_db_to_linear(total_gain_db),
        );

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

    fn set_replay_gain_db(&self, replay_gain_db: f32) -> f32 {
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

    fn set_vst_nodes(&self, nodes: Vec<crate::vst_dsp::VstNodeKey>) {
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

        for sample in frame.iter_mut() {
            *sample *= self.gain;
        }
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

struct DspProcessingSource<S>
where
    S: Source<Item = f32> + Send,
{
    inner: S,
    channels: u16,
    sample_rate: u32,
    duration: Option<Duration>,
    dsp: Arc<DspRuntime>,
    tap: SpectrumTap,
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

    fn new(inner: S, dsp: Arc<DspRuntime>, tap: SpectrumTap) -> Self {
        let channels = inner.channels().max(1);
        let sample_rate = inner.sample_rate().max(1);
        tap.set_sample_rate(sample_rate);
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
                    gain_db: 0.0,
                    replay_gain_db: 0.0,
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
            tap,
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
        for node in &mut self.vst_nodes {
            node.process_interleaved_in_place(&mut self.local);
        }
        self.apply_fade_in();
        self.tap
            .push_interleaved(&self.local, self.channels.max(1) as usize);
        true
    }
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
struct SpectrumTap {
    inner: Arc<Mutex<SpectrumTapInner>>,
}

struct SpectrumTapInner {
    window: VecDeque<f32>,
    capacity: usize,
    sample_rate: u32,
}

impl SpectrumTap {
    fn new(capacity: usize) -> Self {
        Self {
            inner: Arc::new(Mutex::new(SpectrumTapInner {
                window: VecDeque::with_capacity(capacity),
                capacity,
                sample_rate: 0,
            })),
        }
    }

    fn set_sample_rate(&self, sample_rate: u32) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.sample_rate = sample_rate;
        }
    }

    fn clear(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.window.clear();
        }
    }

    fn push_interleaved(&self, samples: &[f32], channels: usize) {
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

    fn snapshot(&self) -> Option<(Vec<f32>, u32)> {
        let inner = self.inner.lock().ok()?;
        if inner.sample_rate == 0 || inner.window.is_empty() {
            return None;
        }
        Some((inner.window.iter().copied().collect(), inner.sample_rate))
    }
}

}

pub fn load(app_handle: &AppHandle, path: Option<String>) -> Result<(), String> {
    emitter::ensure_started(app_handle);
    let track_path = path.ok_or_else(|| "No path provided".to_string())?;
    let result = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        engine.clear_error();
        engine.set_state(PlaybackState::Loading);
        match engine.load(PathBuf::from(&track_path)) {
            Ok(()) => Ok(engine.build_state_payload(false)),
            Err(err) => {
                engine.set_error("NATIVE_AUDIO_LOAD_FAILED", err.clone());
                Err((err, engine.build_state_payload(false)))
            }
        }
    };

    match result {
        Ok(payload) => {
            emitter::emit_state(app_handle, payload)?;
            Ok(())
        }
        Err((err, payload)) => {
            let maybe_error = match (
                payload.error_seq,
                payload.error_code.clone(),
                payload.error_message.clone(),
            ) {
                (Some(seq), Some(code), Some(message)) => {
                    Some(NativeAudioErrorPayload { seq, code, message })
                }
                _ => None,
            };
            emitter::emit_state(app_handle, payload)?;
            if let Some(error_payload) = maybe_error {
                emitter::emit_error(app_handle, error_payload)?;
            }
            Err(err)
        }
    }
}

pub fn crossfade_to(app_handle: &AppHandle, path: String, duration_ms: u64) -> Result<(), String> {
    emitter::ensure_started(app_handle);
    let (result, payload) = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        let result = engine
            .crossfade_to(PathBuf::from(&path), duration_ms)
            .map_err(|err| {
                engine.set_error("NATIVE_AUDIO_CROSSFADE_FAILED", err.clone());
                err
            });
        (result, engine.build_state_payload(false))
    };

    let maybe_error = match (
        payload.error_seq,
        payload.error_code.clone(),
        payload.error_message.clone(),
    ) {
        (Some(seq), Some(code), Some(message)) => {
            Some(NativeAudioErrorPayload { seq, code, message })
        }
        _ => None,
    };

    emitter::emit_state(app_handle, payload)?;
    if let Err(err) = result {
        if let Some(error_payload) = maybe_error {
            emitter::emit_error(app_handle, error_payload)?;
        }
        return Err(err);
    }
    Ok(())
}

pub fn play(app_handle: &AppHandle) -> Result<(), String> {
    emitter::ensure_started(app_handle);
    let (result, payload) = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        let result = engine.play().map_err(|err| {
            engine.set_error("NATIVE_AUDIO_PLAY_FAILED", err.clone());
            err
        });
        (result, engine.build_state_payload(false))
    };
    let maybe_error = match (
        payload.error_seq,
        payload.error_code.clone(),
        payload.error_message.clone(),
    ) {
        (Some(seq), Some(code), Some(message)) => {
            Some(NativeAudioErrorPayload { seq, code, message })
        }
        _ => None,
    };
    emitter::emit_state(app_handle, payload)?;
    if let Err(err) = result {
        if let Some(error_payload) = maybe_error {
            emitter::emit_error(app_handle, error_payload)?;
        }
        return Err(err);
    }
    Ok(())
}

pub fn pause(app_handle: &AppHandle) -> Result<(), String> {
    emitter::ensure_started(app_handle);
    let (result, payload) = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        let result = engine.pause().map_err(|err| {
            engine.set_error("NATIVE_AUDIO_PAUSE_FAILED", err.clone());
            err
        });
        (result, engine.build_state_payload(false))
    };
    let maybe_error = match (
        payload.error_seq,
        payload.error_code.clone(),
        payload.error_message.clone(),
    ) {
        (Some(seq), Some(code), Some(message)) => {
            Some(NativeAudioErrorPayload { seq, code, message })
        }
        _ => None,
    };
    emitter::emit_state(app_handle, payload)?;
    if let Err(err) = result {
        if let Some(error_payload) = maybe_error {
            emitter::emit_error(app_handle, error_payload)?;
        }
        return Err(err);
    }
    Ok(())
}

pub fn stop(app_handle: &AppHandle) -> Result<(), String> {
    emitter::ensure_started(app_handle);
    let payload = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        engine.stop();
        engine.build_state_payload(false)
    };
    let maybe_error = match (
        payload.error_seq,
        payload.error_code.clone(),
        payload.error_message.clone(),
    ) {
        (Some(seq), Some(code), Some(message)) => {
            Some(NativeAudioErrorPayload { seq, code, message })
        }
        _ => None,
    };

    emitter::emit_state(app_handle, payload)?;
    if let Some(error_payload) = maybe_error {
        emitter::emit_error(app_handle, error_payload)?;
    }
    Ok(())
}

pub fn sync_queue(
    app_handle: &AppHandle,
    queue: Vec<String>,
    current_index: i32,
) -> Result<(), String> {
    emitter::ensure_started(app_handle);
    let payload = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        let paths = queue.into_iter().map(PathBuf::from).collect::<Vec<_>>();
        engine.sync_queue_state(paths, current_index);
        engine.build_state_payload(false)
    };
    emitter::emit_state(app_handle, payload)?;
    Ok(())
}

pub fn seek(app_handle: &AppHandle, time: f64) -> Result<(), String> {
    emitter::ensure_started(app_handle);
    let (result, payload) = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        let result = engine.seek(time).map_err(|err| {
            engine.set_error("NATIVE_AUDIO_SEEK_FAILED", err.clone());
            err
        });
        (result, engine.build_state_payload(false))
    };
    let maybe_error = match (
        payload.error_seq,
        payload.error_code.clone(),
        payload.error_message.clone(),
    ) {
        (Some(seq), Some(code), Some(message)) => {
            Some(NativeAudioErrorPayload { seq, code, message })
        }
        _ => None,
    };
    emitter::emit_state(app_handle, payload)?;
    if let Err(err) = result {
        if let Some(error_payload) = maybe_error {
            emitter::emit_error(app_handle, error_payload)?;
        }
        return Err(err);
    }
    Ok(())
}

// Legacy symphonia buffer decode (moved into `crate::audio::input::symphonia`).
#[cfg(any())]
struct DecodedAudioBuffer {
    source: SharedSamplesSource,
    samples: Arc<Vec<f32>>,
    channels: u16,
    sample_rate: u32,
    bit_depth: Option<u32>,
    duration: f64,
}

#[cfg(any())]
fn decode_track_to_buffer(
    path: &Path,
    output_sample_rate: Option<u32>,
) -> Result<DecodedAudioBuffer, String> {
    let file = File::open(path).map_err(|e| format!("Failed to open file: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("Failed to probe format: {e}"))?;
    let mut format = probed.format;
    let track =
        pick_audio_track(format.as_ref()).ok_or_else(|| "No audio track found".to_string())?;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("Failed to create decoder: {e}"))?;

    let track_id = track.id;
    let mut sample_buf: Option<SampleBuffer<f32>> = None;
    let mut samples: Vec<f32> = Vec::new();
    let mut channels = track
        .codec_params
        .channels
        .map(|ch| ch.count())
        .unwrap_or_default();
    let mut sample_rate = track.codec_params.sample_rate.unwrap_or(44_100);
    let bit_depth = track
        .codec_params
        .bits_per_sample
        .or(track.codec_params.bits_per_coded_sample);

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(SymphoniaError::ResetRequired) => {
                return Err("Decoder reset required".into());
            }
            Err(err) => return Err(format!("Failed to read packet: {err}")),
        };

        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                if sample_buf.is_none() {
                    channels = spec.channels.count();
                    sample_rate = spec.rate;
                    sample_buf = Some(SampleBuffer::<f32>::new(decoded.capacity() as u64, spec));
                }

                if let Some(buf) = &mut sample_buf {
                    buf.copy_interleaved_ref(decoded);
                    samples.extend_from_slice(buf.samples());
                }
            }
            Err(SymphoniaError::IoError(err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(err) => return Err(format!("Failed to decode packet: {err}")),
        }
    }

    if channels == 0 || samples.is_empty() {
        return Err("No audio samples decoded".into());
    }

    let frames = samples.len() / channels;
    let duration = frames as f64 / sample_rate as f64;

    let target_sample_rate = output_sample_rate.unwrap_or(sample_rate);
    let (samples, sample_rate) = if target_sample_rate != sample_rate {
        let params = SincInterpolationParameters {
            sinc_len: 256,
            f_cutoff: 0.95,
            interpolation: SincInterpolationType::Cubic,
            oversampling_factor: 128,
            window: WindowFunction::BlackmanHarris2,
        };
        let ratio = target_sample_rate as f64 / sample_rate as f64;
        let chunk_size = 2048usize;
        let mut resampler = SincFixedIn::<f32>::new(ratio, 1.0, params, chunk_size, channels)
            .map_err(|e| format!("Failed to init resampler: {e}"))?;

        let mut per_channel: Vec<Vec<f32>> = (0..channels).map(|_| Vec::new()).collect();
        let frames_in = samples.len() / channels;
        for frame in 0..frames_in {
            for ch in 0..channels {
                per_channel[ch].push(samples[frame * channels + ch]);
            }
        }

        let expected_out_frames = ((frames_in as f64) * ratio).round().max(0.0) as usize;
        let mut out_per_channel: Vec<Vec<f32>> = (0..channels).map(|_| Vec::new()).collect();

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

            let output_block = resampler
                .process(&input_block, None)
                .map_err(|e| format!("Resample failed: {e}"))?;

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

        (out_interleaved, target_sample_rate)
    } else {
        (samples, sample_rate)
    };

    let shared = Arc::new(samples);
    Ok(DecodedAudioBuffer {
        source: SharedSamplesSource::new(shared.clone(), channels as u16, sample_rate, 0),
        samples: shared,
        channels: channels as u16,
        sample_rate,
        bit_depth,
        duration,
    })
}

pub fn set_volume(app_handle: &AppHandle, volume: f32) -> Result<(), String> {
    emitter::ensure_started(app_handle);
    let clamped = volume.clamp(0.0, 1.0);
    let payload = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        engine.set_volume(clamped);
        engine.build_state_payload(false)
    };
    emitter::emit_state(app_handle, payload)?;
    Ok(())
}

pub fn set_mute(app_handle: &AppHandle, muted: bool) -> Result<(), String> {
    emitter::ensure_started(app_handle);
    let payload = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        engine.set_mute(muted);
        engine.build_state_payload(false)
    };
    emitter::emit_state(app_handle, payload)?;
    Ok(())
}

pub fn set_gain(app_handle: &AppHandle, gain_db: f32) -> Result<(), String> {
    emitter::ensure_started(app_handle);
    let payload = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        engine.set_gain(gain_db);
        engine.build_state_payload(false)
    };
    emitter::emit_state(app_handle, payload)?;
    Ok(())
}

pub fn set_replay_gain(app_handle: &AppHandle, replay_gain_db: Option<f32>) -> Result<(), String> {
    emitter::ensure_started(app_handle);
    let payload = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        engine.set_replay_gain(replay_gain_db.unwrap_or(0.0));
        engine.build_state_payload(false)
    };
    emitter::emit_state(app_handle, payload)?;
    Ok(())
}

pub fn set_dsp_chain(app_handle: &AppHandle, chain: Vec<DspNodeConfig>) -> Result<(), String> {
    emitter::ensure_started(app_handle);

    let (sample_rate, vst_enabled, playback_active) = {
        let engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        let sample_rate = engine
            .output_sample_rate()
            .or_else(|| engine.output_backend().current_info().output_sample_rate)
            .unwrap_or(48_000)
            .max(1);
        let playback_active = matches!(
            engine.playback_state(),
            PlaybackState::Playing | PlaybackState::Loading
        );
        (sample_rate, engine.vst_enabled(), playback_active)
    };

    let channels = 2usize;

    let buffer_profile = crate::vst_settings::get_settings(app_handle)
        .ok()
        .map(|settings| settings.buffer_profile)
        .unwrap_or_default();
    let latency_frames =
        crate::vst_settings::buffer_profile_latency_frames(buffer_profile, sample_rate);
    let capacity_frames = latency_frames.saturating_add(2048).max(8192u32);

    let mut desired_vst_node_ids = Vec::new();
    let mut vst_keys: Vec<crate::vst_dsp::VstNodeKey> = Vec::new();

    for node in &chain {
        let DspNodeConfig::Vst { id, plugin_id } = node else {
            continue;
        };

        if !vst_enabled {
            continue;
        }

        desired_vst_node_ids.push(id.clone());

        if !playback_active {
            continue;
        }

        match crate::vst_runtime::ensure_audio_session(
            id.as_str(),
            plugin_id.as_str(),
            sample_rate,
            channels,
            capacity_frames,
        ) {
            Ok(info) => {
                vst_keys.push(crate::vst_dsp::VstNodeKey {
                    node_id: id.clone(),
                    plugin_id: plugin_id.clone(),
                    shm_in_name: info.shm_in_name,
                    shm_out_name: info.shm_out_name,
                    sample_rate: info.sample_rate,
                    channels: info.channels as u32,
                    capacity_frames: info.capacity_frames,
                    latency_frames,
                });
            }
            Err(err) => {
                eprintln!(
                    "[NativeAudio][VST] ensure session failed (node={id}, plugin={plugin_id}): {err}"
                );
            }
        }
    }

    crate::vst_runtime::dispose_sessions_except(&desired_vst_node_ids);

    let payload = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        engine.set_dsp_chain(chain);
        engine.set_vst_nodes(vst_keys);
        engine.build_state_payload(false)
    };
    emitter::emit_state(app_handle, payload)?;
    Ok(())
}

pub fn set_vst_enabled(app_handle: &AppHandle, enabled: bool) -> Result<(), String> {
    emitter::ensure_started(app_handle);
    let chain = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        engine.set_vst_enabled(enabled);
        engine.clone_dsp_chain()
    };

    set_dsp_chain(app_handle, chain)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VstWarmupNodeReport {
    pub node_id: String,
    pub plugin_id: String,
    pub state: String,
    pub message: Option<String>,
    pub elapsed_ms: u64,
    pub primed_frames: u64,
}

fn is_playback_active() -> Result<bool, String> {
    let engine = ENGINE
        .lock()
        .map_err(|_| "Audio engine is locked".to_string())?;
    Ok(matches!(
        engine.playback_state(),
        PlaybackState::Playing | PlaybackState::Loading
    ))
}

pub fn vst_warmup(app_handle: &AppHandle) -> Result<Vec<VstWarmupNodeReport>, String> {
    const WARMUP_WAIT_ACTIVE_TIMEOUT: Duration = Duration::from_secs(90);
    const WARMUP_PRIME_MS: u64 = 600;
    const WARMUP_DRAIN_TIMEOUT: Duration = Duration::from_secs(4);
    const BLOCK_FRAMES: usize = 512;
    const DEMO_VST_PLUGIN_ID: &str = "demo.gain";

    if is_playback_active()? {
        return Err("VST warmup is only available while not playing".to_string());
    }

    let graph = crate::dsp_graph::get_dsp_graph(app_handle)?;
    let mut targets = Vec::<(String, String)>::new();
    for node in &graph.nodes {
        let DspGraphNode::Vst {
            id,
            enabled,
            plugin_id,
            ..
        } = node
        else {
            continue;
        };

        if !*enabled {
            continue;
        }
        let node_id = id.trim();
        let plugin_id = plugin_id.trim();
        if node_id.is_empty() || plugin_id.is_empty() || plugin_id == DEMO_VST_PLUGIN_ID {
            continue;
        }
        targets.push((node_id.to_string(), plugin_id.to_string()));
    }

    if targets.is_empty() {
        return Ok(Vec::new());
    }

    let sample_rate = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        engine.resolve_output_sample_rate()
    };

    let channels = 2usize;

    let buffer_profile = crate::vst_settings::get_settings(app_handle)
        .ok()
        .map(|settings| settings.buffer_profile)
        .unwrap_or_default();
    let latency_frames =
        crate::vst_settings::buffer_profile_latency_frames(buffer_profile, sample_rate);
    let capacity_frames = latency_frames.saturating_add(2048).max(8192u32);

    let mut reports = Vec::with_capacity(targets.len());

    for (node_id, plugin_id) in targets.into_iter() {
        if is_playback_active()? {
            return Err("VST warmup aborted: playback started".to_string());
        }

        let started_at = Instant::now();

        let info = match crate::vst_runtime::ensure_audio_session(
            node_id.as_str(),
            plugin_id.as_str(),
            sample_rate,
            channels,
            capacity_frames,
        ) {
            Ok(info) => info,
            Err(err) => {
                reports.push(VstWarmupNodeReport {
                    node_id,
                    plugin_id,
                    state: "error".to_string(),
                    message: Some(err),
                    elapsed_ms: started_at.elapsed().as_millis() as u64,
                    primed_frames: 0,
                });
                continue;
            }
        };

        let shm_in = match ShmRing::open(info.shm_in_name.as_str()) {
            Ok(ring) => ring,
            Err(err) => {
                reports.push(VstWarmupNodeReport {
                    node_id,
                    plugin_id,
                    state: "error".to_string(),
                    message: Some(err),
                    elapsed_ms: started_at.elapsed().as_millis() as u64,
                    primed_frames: 0,
                });
                continue;
            }
        };
        let shm_out = match ShmRing::open(info.shm_out_name.as_str()) {
            Ok(ring) => ring,
            Err(err) => {
                reports.push(VstWarmupNodeReport {
                    node_id,
                    plugin_id,
                    state: "error".to_string(),
                    message: Some(err),
                    elapsed_ms: started_at.elapsed().as_millis() as u64,
                    primed_frames: 0,
                });
                continue;
            }
        };

        let wait_deadline = Instant::now() + WARMUP_WAIT_ACTIVE_TIMEOUT;
        loop {
            if is_playback_active()? {
                return Err("VST warmup aborted: playback started".to_string());
            }

            let header = shm_in.header();
            if header.is_plugin_error() {
                break;
            }
            if header.is_processing_active() {
                break;
            }
            if Instant::now() >= wait_deadline {
                break;
            }
            std::thread::sleep(Duration::from_millis(40));
        }

        let header = shm_in.header();
        if header.is_plugin_error() {
            reports.push(VstWarmupNodeReport {
                node_id,
                plugin_id,
                state: "error".to_string(),
                message: Some("Sidecar reported plugin error".to_string()),
                elapsed_ms: started_at.elapsed().as_millis() as u64,
                primed_frames: 0,
            });
            continue;
        }

        if !header.is_processing_active() {
            reports.push(VstWarmupNodeReport {
                node_id,
                plugin_id,
                state: "timeout".to_string(),
                message: Some("Timed out waiting for VST processing to start".to_string()),
                elapsed_ms: started_at.elapsed().as_millis() as u64,
                primed_frames: 0,
            });
            continue;
        }

        // Flush any buffered output from previous runs.
        {
            let out_header = shm_out.header();
            let out_write = out_header.write_index.load(Ordering::Acquire);
            out_header.read_index.store(out_write, Ordering::Release);
        }

        let warmup_frames = ((info.sample_rate as u64).saturating_mul(WARMUP_PRIME_MS) / 1000)
            .max(1)
            .min((info.sample_rate as u64).saturating_mul(4)) as usize;

        let channels = shm_in.channels().max(1);
        let mut buffer = vec![0.0f32; BLOCK_FRAMES.saturating_mul(channels)];
        let mut remaining_frames = warmup_frames;
        let mut primed_frames: u64 = 0;
        let mut target_write = shm_in.header().write_index.load(Ordering::Acquire);

        while remaining_frames > 0 {
            if is_playback_active()? {
                return Err("VST warmup aborted: playback started".to_string());
            }

            let frames = remaining_frames.min(BLOCK_FRAMES).max(1);
            let needed = frames.saturating_mul(channels);
            if buffer.len() != needed {
                buffer.resize(needed, 0.0);
            } else {
                buffer.fill(0.0);
            }

            if shm_in.try_write_interleaved_all(&buffer) {
                remaining_frames = remaining_frames.saturating_sub(frames);
                primed_frames = primed_frames.saturating_add(frames as u64);
                target_write = target_write.saturating_add(frames as u64);
            } else {
                std::thread::sleep(Duration::from_millis(2));
            }

            let out_header = shm_out.header();
            let out_write = out_header.write_index.load(Ordering::Acquire);
            out_header.read_index.store(out_write, Ordering::Release);
        }

        let drain_deadline = Instant::now() + WARMUP_DRAIN_TIMEOUT;
        while Instant::now() < drain_deadline {
            if is_playback_active()? {
                return Err("VST warmup aborted: playback started".to_string());
            }

            let read = shm_in.header().read_index.load(Ordering::Acquire);
            if read >= target_write {
                break;
            }

            let out_header = shm_out.header();
            let out_write = out_header.write_index.load(Ordering::Acquire);
            out_header.read_index.store(out_write, Ordering::Release);

            std::thread::sleep(Duration::from_millis(2));
        }

        {
            let out_header = shm_out.header();
            let out_write = out_header.write_index.load(Ordering::Acquire);
            out_header.read_index.store(out_write, Ordering::Release);
        }

        reports.push(VstWarmupNodeReport {
            node_id,
            plugin_id,
            state: "ok".to_string(),
            message: None,
            elapsed_ms: started_at.elapsed().as_millis() as u64,
            primed_frames,
        });
    }

    Ok(reports)
}

fn available_output_backend_ids() -> Vec<&'static str> {
    let mut ids = vec![RODIO_CPAL_BACKEND_ID];
    #[cfg(target_os = "windows")]
    {
        ids.push(WASAPI_BACKEND_ID);
        ids.push(WASAPI_EXCLUSIVE_BACKEND_ID);
        #[cfg(feature = "asio-sdk")]
        {
            ids.push(ASIO_BACKEND_ID);
        }
    }
    ids
}

fn create_output_backend_by_id(id: &str) -> Option<Arc<dyn AudioOutputBackend>> {
    match id {
        RODIO_CPAL_BACKEND_ID => Some(default_backend()),
        #[cfg(target_os = "windows")]
        WASAPI_BACKEND_ID => Some(wasapi_backend()),
        #[cfg(target_os = "windows")]
        WASAPI_EXCLUSIVE_BACKEND_ID => Some(wasapi_exclusive_backend()),
        #[cfg(all(target_os = "windows", feature = "asio-sdk"))]
        ASIO_BACKEND_ID => Some(asio_backend()),
        _ => None,
    }
}

pub fn list_output_backends() -> Result<Vec<String>, String> {
    Ok(available_output_backend_ids()
        .into_iter()
        .map(|id| id.to_string())
        .collect())
}

pub fn list_audio_inputs() -> Result<Vec<String>, String> {
    let ids = {
        let engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        engine.list_input_ids()
    };

    Ok(ids.into_iter().map(|id| id.to_string()).collect())
}

pub fn get_audio_components_state() -> Result<NativeAudioComponentsStatePayload, String> {
    let engine = ENGINE
        .lock()
        .map_err(|_| "Audio engine is locked".to_string())?;
    Ok(engine.build_components_payload())
}

pub fn select_output_backend(
    app_handle: &AppHandle,
    backend_id: Option<String>,
) -> Result<NativeAudioComponentsStatePayload, String> {
    emitter::ensure_started(app_handle);

    let requested = backend_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let target_id = requested.unwrap_or(RODIO_CPAL_BACKEND_ID);

    let Some(target_backend) = create_output_backend_by_id(target_id) else {
        let message = format!("Unknown output backend id: {target_id}");
        let (state_payload, maybe_error) = {
            let mut engine = ENGINE
                .lock()
                .map_err(|_| "Audio engine is locked".to_string())?;
            engine.record_error("NATIVE_AUDIO_BACKEND_SELECT_FAILED", message.clone());
            let state_payload = engine.build_state_payload(false);
            let maybe_error = match (
                state_payload.error_seq,
                state_payload.error_code.clone(),
                state_payload.error_message.clone(),
            ) {
                (Some(seq), Some(code), Some(message)) => {
                    Some(NativeAudioErrorPayload { seq, code, message })
                }
                _ => None,
            };
            (state_payload, maybe_error)
        };

        emitter::emit_state(app_handle, state_payload)?;
        if let Some(error_payload) = maybe_error {
            emitter::emit_error(app_handle, error_payload)?;
        }
        return Err(message);
    };

    let (result, state_payload, components_payload, maybe_error) = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;

        let result = engine.switch_output_backend(target_backend).map_err(|err| {
            engine.record_error("NATIVE_AUDIO_REBUILD_SINK_FAILED", err.clone());
            err
        });

        let state_payload = engine.build_state_payload(false);
        let components_payload = engine.build_components_payload();
        let maybe_error = match (
            state_payload.error_seq,
            state_payload.error_code.clone(),
            state_payload.error_message.clone(),
        ) {
            (Some(seq), Some(code), Some(message)) => {
                Some(NativeAudioErrorPayload { seq, code, message })
            }
            _ => None,
        };

        (result, state_payload, components_payload, maybe_error)
    };

    emitter::emit_state(app_handle, state_payload)?;
    if let Err(err) = result {
        if let Some(error_payload) = maybe_error {
            emitter::emit_error(app_handle, error_payload)?;
        }
        return Err(err);
    }

    Ok(components_payload)
}

pub fn select_audio_input(
    app_handle: &AppHandle,
    input_id: Option<String>,
) -> Result<NativeAudioComponentsStatePayload, String> {
    emitter::ensure_started(app_handle);

    let (result, state_payload, components_payload, maybe_error) = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;

        let result = engine.set_preferred_input_id(input_id).map_err(|err| {
            engine.set_error("NATIVE_AUDIO_INPUT_SELECT_FAILED", err.clone());
            err
        });

        let state_payload = engine.build_state_payload(false);
        let components_payload = engine.build_components_payload();
        let maybe_error = match (
            state_payload.error_seq,
            state_payload.error_code.clone(),
            state_payload.error_message.clone(),
        ) {
            (Some(seq), Some(code), Some(message)) => {
                Some(NativeAudioErrorPayload { seq, code, message })
            }
            _ => None,
        };

        (result, state_payload, components_payload, maybe_error)
    };

    emitter::emit_state(app_handle, state_payload)?;
    if let Err(err) = result {
        if let Some(error_payload) = maybe_error {
            emitter::emit_error(app_handle, error_payload)?;
        }
        return Err(err);
    }

    Ok(components_payload)
}

pub fn list_output_devices() -> Result<Vec<String>, String> {
    let output_backend = {
        let engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        engine.output_backend()
    };

    output_backend.list_devices()
}

pub fn open_asio_control_panel(device_name: Option<String>) -> Result<(), String> {
    #[cfg(all(target_os = "windows", feature = "asio-sdk"))]
    {
        crate::audio::output::open_asio_control_panel(device_name)
    }

    #[cfg(not(all(target_os = "windows", feature = "asio-sdk")))]
    {
        let _ = device_name;
        Err("ASIO control panel is unavailable in this build".to_string())
    }
}

pub fn select_output_device(
    app_handle: &AppHandle,
    device_name: Option<String>,
) -> Result<(), String> {
    emitter::ensure_started(app_handle);

    let output_backend = {
        let engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        engine.output_backend()
    };

    let already_selected = output_backend.is_stream_open()
        && match device_name.as_deref() {
            Some(requested) => output_backend
                .current_info()
                .device_name
                .as_deref()
                .is_some_and(|current| current == requested),
            None => {
                output_backend.current_info().device_name == output_backend.default_device_name()
            }
        };

    if already_selected {
        let payload = {
            let engine = ENGINE
                .lock()
                .map_err(|_| "Audio engine is locked".to_string())?;
            engine.build_state_payload(false)
        };
        emitter::emit_state(app_handle, payload)?;
        return Ok(());
    }

    let output_info = match output_backend.select_device(device_name.clone()) {
        Ok(value) => value,
        Err(err) => {
            let payload = {
                let mut engine = ENGINE
                    .lock()
                    .map_err(|_| "Audio engine is locked".to_string())?;
                engine.set_error("NATIVE_AUDIO_DEVICE_SELECT_FAILED", err.clone());
                engine.build_state_payload(false)
            };

            let maybe_error = match (
                payload.error_seq,
                payload.error_code.clone(),
                payload.error_message.clone(),
            ) {
                (Some(seq), Some(code), Some(message)) => {
                    Some(NativeAudioErrorPayload { seq, code, message })
                }
                _ => None,
            };

            emitter::emit_state(app_handle, payload)?;
            if let Some(error_payload) = maybe_error {
                emitter::emit_error(app_handle, error_payload)?;
            }
            return Err(err);
        }
    };

    let payload = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;

        engine.apply_selected_output_device(output_info);
        engine.build_state_payload(false)
    };

    emitter::emit_state(app_handle, payload)?;
    Ok(())
}

#[derive(Clone, Debug)]
pub(crate) struct AudioSmokeOptions {
    pub path: PathBuf,
    pub backend_id: Option<String>,
    pub device_name: Option<String>,
    pub input_id: Option<String>,
    pub play_ms: u64,
    pub switch_backends: Vec<String>,
    pub switch_interval_ms: u64,
    pub switch_tracks: Vec<PathBuf>,
    pub switch_track_interval_ms: u64,
    pub crossfade_ms: u64,
    pub seek_seconds: f64,
    pub seek_count: u32,
    pub seek_interval_ms: u64,
}

fn audio_smoke_error_from_state(payload: &NativeAudioStatePayload) -> Option<NativeAudioErrorPayload> {
    match (
        payload.error_seq,
        payload.error_code.as_deref(),
        payload.error_message.as_deref(),
    ) {
        (Some(seq), Some(code), Some(message)) => Some(NativeAudioErrorPayload {
            seq,
            code: code.to_string(),
            message: message.to_string(),
        }),
        _ => None,
    }
}

fn audio_smoke_print_json<T: Serialize>(label: &str, value: &T) {
    match serde_json::to_string(value) {
        Ok(json) => println!("{label}: {json}"),
        Err(err) => println!("{label}: <json_error: {err}>"),
    }
}

fn audio_smoke_print_state(payload: &NativeAudioStatePayload) {
    audio_smoke_print_json("native_audio_state", payload);
    if let Some(error_payload) = audio_smoke_error_from_state(payload) {
        audio_smoke_print_json("native_audio_error", &error_payload);
    }
}

fn audio_smoke_step_result(
    step: &str,
    result: Result<(), String>,
    payload: NativeAudioStatePayload,
) -> Result<(), String> {
    println!("\n==> {step}");
    audio_smoke_print_state(&payload);

    if let Err(error) = result {
        return Err(error);
    }

    if let Some(error_payload) = audio_smoke_error_from_state(&payload) {
        return Err(format!("{}: {}", error_payload.code, error_payload.message));
    }

    Ok(())
}

pub(crate) fn run_audio_smoke(options: AudioSmokeOptions) -> Result<(), String> {
    println!("==> native_audio_list_output_backends");
    let backends = list_output_backends()?;
    audio_smoke_print_json("native_audio_list_output_backends", &backends);

    let select_backend = {
        let requested = options
            .backend_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let target_id = requested.unwrap_or(RODIO_CPAL_BACKEND_ID);

        let (result, payload) = match create_output_backend_by_id(target_id) {
            Some(target_backend) => {
                let (result, payload) = {
                    let mut engine = ENGINE
                        .lock()
                        .map_err(|_| "Audio engine is locked".to_string())?;
                    engine.clear_error();

                    let result = engine.switch_output_backend(target_backend).map_err(|error| {
                        engine.set_error("NATIVE_AUDIO_REBUILD_SINK_FAILED", error.clone());
                        error
                    });

                    let payload = engine.build_state_payload(false);
                    (result, payload)
                };
                (result, payload)
            }
            None => {
                let message = format!("Unknown output backend id: {target_id}");
                let payload = {
                    let mut engine = ENGINE
                        .lock()
                        .map_err(|_| "Audio engine is locked".to_string())?;
                    engine.clear_error();
                    engine.set_error("NATIVE_AUDIO_BACKEND_SELECT_FAILED", message.clone());
                    engine.build_state_payload(false)
                };
                (Err(message), payload)
            }
        };

        (result, payload)
    };

    audio_smoke_step_result(
        "native_audio_select_output_backend",
        select_backend.0,
        select_backend.1,
    )?;

    println!("\n==> native_audio_list_devices");
    let devices = list_output_devices()?;
    audio_smoke_print_json("native_audio_list_devices", &devices);

    let select_device = {
        let output_backend = {
            let engine = ENGINE
                .lock()
                .map_err(|_| "Audio engine is locked".to_string())?;
            engine.output_backend()
        };

        let already_selected = output_backend.is_stream_open()
            && match options.device_name.as_deref() {
                Some(requested) => output_backend
                    .current_info()
                    .device_name
                    .as_deref()
                    .is_some_and(|current| current == requested),
                None => output_backend.current_info().device_name == output_backend.default_device_name(),
            };

        if already_selected {
            let payload = {
                let mut engine = ENGINE
                    .lock()
                    .map_err(|_| "Audio engine is locked".to_string())?;
                engine.clear_error();
                engine.build_state_payload(false)
            };
            (Ok(()), payload)
        } else {
            match output_backend.select_device(options.device_name.clone()) {
                Ok(output_info) => {
                    let payload = {
                        let mut engine = ENGINE
                            .lock()
                            .map_err(|_| "Audio engine is locked".to_string())?;

                        engine.clear_error();
                        engine.apply_selected_output_device(output_info);

                        engine.build_state_payload(false)
                    };
                    (Ok(()), payload)
                }
                Err(error) => {
                    let payload = {
                        let mut engine = ENGINE
                            .lock()
                            .map_err(|_| "Audio engine is locked".to_string())?;
                        engine.clear_error();
                        engine.set_error("NATIVE_AUDIO_DEVICE_SELECT_FAILED", error.clone());
                        engine.build_state_payload(false)
                    };
                    (Err(error), payload)
                }
            }
        }
    };

    audio_smoke_step_result("native_audio_select_device", select_device.0, select_device.1)?;

    println!("\n==> native_audio_list_audio_inputs");
    let inputs = list_audio_inputs()?;
    audio_smoke_print_json("native_audio_list_audio_inputs", &inputs);

    let select_input = {
        let (result, payload) = {
            let mut engine = ENGINE
                .lock()
                .map_err(|_| "Audio engine is locked".to_string())?;
            engine.clear_error();
            let result = engine.set_preferred_input_id(options.input_id.clone()).map_err(|err| {
                engine.set_error("NATIVE_AUDIO_INPUT_SELECT_FAILED", err.clone());
                err
            });
            let payload = engine.build_state_payload(false);
            (result, payload)
        };
        (result, payload)
    };
    audio_smoke_step_result(
        "native_audio_select_audio_input",
        select_input.0,
        select_input.1,
    )?;

    let load_step = {
        let result = {
            let mut engine = ENGINE
                .lock()
                .map_err(|_| "Audio engine is locked".to_string())?;
            engine.clear_error();
            engine.set_state(PlaybackState::Loading);
            match engine.load(options.path.clone()) {
                Ok(()) => Ok(()),
                Err(error) => {
                    engine.set_error("NATIVE_AUDIO_LOAD_FAILED", error.clone());
                    Err(error)
                }
            }
        };
        let payload = {
            let engine = ENGINE
                .lock()
                .map_err(|_| "Audio engine is locked".to_string())?;
            engine.build_state_payload(false)
        };
        (result, payload)
    };
    let loaded_duration = load_step.1.duration;
    audio_smoke_step_result("native_audio_load", load_step.0, load_step.1)?;

    let play_step = {
        let (result, payload) = {
            let mut engine = ENGINE
                .lock()
                .map_err(|_| "Audio engine is locked".to_string())?;
            engine.clear_error();
            let result = engine.play().map_err(|err| {
                engine.set_error("NATIVE_AUDIO_PLAY_FAILED", err.clone());
                err
            });
            let payload = engine.build_state_payload(false);
            (result, payload)
        };
        (result, payload)
    };
    audio_smoke_step_result("native_audio_play", play_step.0, play_step.1)?;

    std::thread::sleep(Duration::from_millis(options.play_ms));
    let tick_snapshot = {
        let payload = {
            let mut engine = ENGINE
                .lock()
                .map_err(|_| "Audio engine is locked".to_string())?;
            let _ = engine.tick();
            engine.build_state_payload(false)
        };
        (Ok(()), payload)
    };
    audio_smoke_step_result("native_audio_state (after play)", tick_snapshot.0, tick_snapshot.1)?;

    if !options.switch_backends.is_empty() {
        for (index, target_id) in options.switch_backends.iter().enumerate() {
            let step_name = format!(
                "native_audio_switch_output_backend[{}/{}]",
                index + 1,
                options.switch_backends.len()
            );

            let (result, payload) = match create_output_backend_by_id(target_id) {
                Some(target_backend) => {
                    let (result, payload) = {
                        let mut engine = ENGINE
                            .lock()
                            .map_err(|_| "Audio engine is locked".to_string())?;
                        engine.clear_error();

                        let result = engine.switch_output_backend(target_backend).map_err(|error| {
                            engine.set_error("NATIVE_AUDIO_REBUILD_SINK_FAILED", error.clone());
                            error
                        });

                        let payload = engine.build_state_payload(false);
                        (result, payload)
                    };
                    (result, payload)
                }
                None => {
                    let message = format!("Unknown output backend id: {target_id}");
                    let payload = {
                        let mut engine = ENGINE
                            .lock()
                            .map_err(|_| "Audio engine is locked".to_string())?;
                        engine.clear_error();
                        engine.set_error("NATIVE_AUDIO_BACKEND_SELECT_FAILED", message.clone());
                        engine.build_state_payload(false)
                    };
                    (Err(message), payload)
                }
            };

            audio_smoke_step_result(&step_name, result, payload)?;
            if options.switch_interval_ms > 0 {
                std::thread::sleep(Duration::from_millis(options.switch_interval_ms));
            }
        }
    }

    if !options.switch_tracks.is_empty() {
        for (index, track) in options.switch_tracks.iter().enumerate() {
            let step_name = format!(
                "native_audio_switch_track[{}/{}]",
                index + 1,
                options.switch_tracks.len()
            );

            let (result, payload) = {
                let mut engine = ENGINE
                    .lock()
                    .map_err(|_| "Audio engine is locked".to_string())?;
                engine.clear_error();
                let result = engine
                    .crossfade_to(track.clone(), options.crossfade_ms)
                    .map_err(|error| {
                        engine.set_error("NATIVE_AUDIO_CROSSFADE_FAILED", error.clone());
                        error
                    });
                let payload = engine.build_state_payload(false);
                (result, payload)
            };

            audio_smoke_step_result(&step_name, result, payload)?;
            if options.switch_track_interval_ms > 0 {
                std::thread::sleep(Duration::from_millis(options.switch_track_interval_ms));
            }
        }
    }

    let seek_count = options.seek_count.max(1);
    for index in 0..seek_count {
        let target = if index % 2 == 0 {
            options.seek_seconds
        } else if loaded_duration.is_finite() && loaded_duration > 0.0 {
            (loaded_duration - options.seek_seconds).max(0.0)
        } else {
            options.seek_seconds
        };
        let target = if loaded_duration.is_finite() && loaded_duration > 0.0 {
            target.max(0.0).min(loaded_duration)
        } else {
            target.max(0.0)
        };

        let seek_step = {
            let (result, payload) = {
                let mut engine = ENGINE
                    .lock()
                    .map_err(|_| "Audio engine is locked".to_string())?;
                engine.clear_error();
                let result = engine.seek(target).map_err(|err| {
                    engine.set_error("NATIVE_AUDIO_SEEK_FAILED", err.clone());
                    err
                });
                let payload = engine.build_state_payload(false);
                (result, payload)
            };
            (result, payload)
        };
        let step_name = format!("native_audio_seek[{}/{}]", index + 1, seek_count);
        audio_smoke_step_result(&step_name, seek_step.0, seek_step.1)?;

        if options.seek_interval_ms > 0 {
            std::thread::sleep(Duration::from_millis(options.seek_interval_ms));
        }
    }

    std::thread::sleep(Duration::from_millis(150));
    let stop_step = {
        let payload = {
            let mut engine = ENGINE
                .lock()
                .map_err(|_| "Audio engine is locked".to_string())?;
            engine.clear_error();
            engine.stop();
            engine.build_state_payload(false)
        };
        (Ok(()), payload)
    };
    audio_smoke_step_result("native_audio_stop", stop_step.0, stop_step.1)?;

    // Ensure the output stream thread is terminated so `--audio-smoke` exits cleanly.
    let output_backend = {
        let engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        engine.output_backend()
    };
    output_backend.close_stream();

    Ok(())
}
