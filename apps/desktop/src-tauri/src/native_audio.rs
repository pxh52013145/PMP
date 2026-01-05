use once_cell::sync::{Lazy, OnceCell};
use rodio::Source;
use rustfft::{num_complex::Complex, FftPlanner};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
    sync::mpsc,
    sync::Arc,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::AppHandle;
use tauri::Manager;

use crate::audio::input::{
    open_rodio_source_at, AudioInputKind, AudioInputRegistry, DecoderCommand, SharedSamplesSource,
    StreamingPlayback, StreamingSamplesSource,
};
use crate::audio::output::{default_backend, AudioOutputBackend, AudioSink, RODIO_CPAL_BACKEND_ID};

static ENGINE: Lazy<Mutex<NativeAudioEngine>> = Lazy::new(|| Mutex::new(NativeAudioEngine::new()));
static APP_HANDLE: OnceCell<AppHandle> = OnceCell::new();
static EMITTER_STARTED: OnceCell<()> = OnceCell::new();
static LAST_EMITTED_ERROR_SEQ: AtomicU64 = AtomicU64::new(0);

fn store_atomic_f32(target: &AtomicU32, value: f32) {
    target.store(value.to_bits(), Ordering::Release);
}

fn load_atomic_f32(target: &AtomicU32) -> f32 {
    f32::from_bits(target.load(Ordering::Acquire))
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct NativeAudioStatePayload {
    playback_state: String,
    volume: f32,
    gain_db: f32,
    replay_gain_db: f32,
    muted: bool,
    track_path: Option<String>,
    current_time: f64,
    duration: f64,
    sample_rate: Option<u32>,
    bit_depth: Option<u32>,
    device: Option<String>,
    queue: Option<Vec<String>>,
    current_index: Option<i32>,
    ended: bool,
    error_seq: Option<u64>,
    error_code: Option<String>,
    error_message: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct NativeAudioSpectrumPayload {
    bins: Vec<f32>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct NativeAudioErrorPayload {
    seq: u64,
    code: String,
    message: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioComponentsStatePayload {
    output_backend_id: String,
    output_device: Option<String>,
    output_sample_rate: Option<u32>,
    preferred_input_id: Option<String>,
    active_input_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EqBandKind {
    Peaking,
    LowShelf,
    HighShelf,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
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
    config: Mutex<DspRuntimeConfig>,
    config_version: AtomicU64,
    reset_serial: AtomicU64,
}

impl DspRuntime {
    fn new() -> Self {
        Self {
            config: Mutex::new(DspRuntimeConfig::default()),
            config_version: AtomicU64::new(1),
            reset_serial: AtomicU64::new(1),
        }
    }

    fn version(&self) -> u64 {
        self.config_version.load(Ordering::Acquire)
    }

    fn reset_serial(&self) -> u64 {
        self.reset_serial.load(Ordering::Acquire)
    }

    fn request_reset(&self) {
        self.reset_serial.fetch_add(1, Ordering::AcqRel);
    }

    fn snapshot(&self) -> DspRuntimeConfig {
        self.config
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }

    fn apply_chain(&self, chain: &[DspNodeConfig]) -> f32 {
        let mut gain_db = 0.0f32;
        let mut eq_bands: Vec<EqBandConfig> = Vec::new();
        let mut limiter_threshold_db: Option<f32> = None;

        for node in chain {
            match node {
                DspNodeConfig::Gain { db } => gain_db += *db,
                DspNodeConfig::Eq { bands } => eq_bands.extend(bands.clone()),
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
        let replay_gain_db = self
            .config
            .lock()
            .map(|guard| guard.replay_gain_db)
            .unwrap_or(0.0);
        let total_gain_db = (gain_db + replay_gain_db).clamp(-60.0, 12.0);
        let gain_linear = gain_db_to_linear(total_gain_db);

        if let Ok(mut guard) = self.config.lock() {
            guard.gain_db = gain_db;
            guard.replay_gain_db = replay_gain_db;
            guard.gain_linear = gain_linear;
            guard.eq_bands = eq_bands;
            guard.limiter_threshold_db = limiter_threshold_db;
        }
        self.config_version.fetch_add(1, Ordering::AcqRel);

        gain_db
    }

    fn set_replay_gain_db(&self, replay_gain_db: f32) -> f32 {
        let replay_gain_db = if replay_gain_db.is_finite() {
            replay_gain_db.clamp(-30.0, 30.0)
        } else {
            0.0
        };

        if let Ok(mut guard) = self.config.lock() {
            guard.replay_gain_db = replay_gain_db;
            let total_gain_db = (guard.gain_db + replay_gain_db).clamp(-60.0, 12.0);
            guard.gain_linear = gain_db_to_linear(total_gain_db);
        }
        self.config_version.fetch_add(1, Ordering::AcqRel);
        replay_gain_db
    }

    fn set_vst_nodes(&self, nodes: Vec<crate::vst_dsp::VstNodeKey>) {
        if let Ok(mut guard) = self.config.lock() {
            guard.vst_nodes = nodes;
        }
        self.config_version.fetch_add(1, Ordering::AcqRel);
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
    local_index: usize,
}

impl<S> DspProcessingSource<S>
where
    S: Source<Item = f32> + Send,
{
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
        let vst_nodes = vst_keys
            .iter()
            .cloned()
            .map(|key| crate::vst_dsp::VstDspNode::new(crate::vst_dsp::VstNodeSpec { key }))
            .collect();

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
            local: Vec::new(),
            local_index: 0,
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
        let version = self.dsp.version();
        if version != self.processor_version {
            let snapshot = self.dsp.snapshot();
            self.processor = DspChainProcessor::from_runtime_config(
                &snapshot,
                self.sample_rate,
                self.channels as usize,
            );

            if snapshot.vst_nodes != self.vst_keys {
                self.vst_keys = snapshot.vst_nodes.clone();
                self.vst_nodes = self
                    .vst_keys
                    .iter()
                    .cloned()
                    .map(|key| crate::vst_dsp::VstDspNode::new(crate::vst_dsp::VstNodeSpec { key }))
                    .collect();
                self.begin_fade_in();
            }
            self.processor_version = version;
        }

        let reset_serial = self.dsp.reset_serial();
        if reset_serial != self.processor_reset_serial {
            self.processor.reset();
            for node in &mut self.vst_nodes {
                node.reset();
            }
            self.begin_fade_in();
            self.processor_reset_serial = reset_serial;
        }
    }

    fn refill_local(&mut self) -> bool {
        self.local.clear();
        self.local_index = 0;

        const CHUNK_SAMPLES: usize = 8192;
        for _ in 0..CHUNK_SAMPLES {
            match self.inner.next() {
                Some(sample) => self.local.push(sample),
                None => break,
            }
        }

        if self.local.is_empty() {
            return false;
        }

        self.ensure_processor_uptodate();
        self.processor.process_interleaved_in_place(&mut self.local);
        for node in &mut self.vst_nodes {
            node.process_interleaved_in_place(&mut self.local);
        }
        self.apply_fade_in();
        self.tap
            .push_interleaved(&self.local, self.channels.max(1) as usize);
        true
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
        let mut inner = match self.inner.lock() {
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

struct ActiveCrossfade {
    cancel: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
    old_sink: Arc<dyn AudioSink>,
    old_streaming_command_tx: Option<mpsc::Sender<DecoderCommand>>,
}

struct NativeAudioEngine {
    input_registry: AudioInputRegistry,
    preferred_input_id: Option<String>,
    active_input_id: Option<String>,
    output_backend: Arc<dyn AudioOutputBackend>,
    sink: Option<Arc<dyn AudioSink>>,
    active_crossfade: Option<ActiveCrossfade>,
    current_track: Option<PathBuf>,
    queue: Vec<PathBuf>,
    current_index: i32,
    queue_initialized: bool,
    streaming: Option<StreamingPlayback>,
    current_position: f64,
    duration: f64,
    base_position: f64,
    playback_started_at: Option<Instant>,
    decoded_samples: Option<Arc<Vec<f32>>>,
    decoded_channels: u16,
    decoded_sample_rate: u32,
    decoded_bit_depth: Option<u32>,
    output_sample_rate: Option<u32>,
    device_name: Option<String>,
    volume: f32,
    gain_db: f32,
    replay_gain_db: f32,
    dsp_chain: Vec<DspNodeConfig>,
    dsp_runtime: Arc<DspRuntime>,
    spectrum_tap: SpectrumTap,
    muted: bool,
    effective_volume_bits: Arc<AtomicU32>,
    playback_state: PlaybackState,
    error_seq_counter: u64,
    last_error_seq: u64,
    last_error_code: Option<String>,
    last_error_message: Option<String>,
}

#[derive(Clone, Copy)]
enum PlaybackState {
    Idle,
    Loading,
    Playing,
    Paused,
    Stopped,
    Error,
}

impl PlaybackState {
    fn as_str(&self) -> &'static str {
        match self {
            PlaybackState::Idle => "idle",
            PlaybackState::Loading => "loading",
            PlaybackState::Playing => "playing",
            PlaybackState::Paused => "paused",
            PlaybackState::Stopped => "stopped",
            PlaybackState::Error => "error",
        }
    }
}

impl NativeAudioEngine {
    fn new() -> Self {
        Self::new_with_backend(default_backend())
    }

    fn new_with_backend(output_backend: Arc<dyn AudioOutputBackend>) -> Self {
        eprintln!("[NativeAudio] Output backend: {}", output_backend.id());
        Self {
            input_registry: AudioInputRegistry::default(),
            preferred_input_id: None,
            active_input_id: None,
            output_backend,
            sink: None,
            active_crossfade: None,
            current_track: None,
            queue: Vec::new(),
            current_index: -1,
            queue_initialized: false,
            streaming: None,
            current_position: 0.0,
            duration: 0.0,
            base_position: 0.0,
            playback_started_at: None,
            decoded_samples: None,
            decoded_channels: 0,
            decoded_sample_rate: 0,
            decoded_bit_depth: None,
            output_sample_rate: None,
            device_name: None,
            volume: 0.7,
            gain_db: 0.0,
            replay_gain_db: 0.0,
            dsp_chain: Vec::new(),
            dsp_runtime: Arc::new(DspRuntime::new()),
            spectrum_tap: SpectrumTap::new(1024),
            muted: false,
            effective_volume_bits: Arc::new(AtomicU32::new(0.7f32.to_bits())),
            playback_state: PlaybackState::Idle,
            error_seq_counter: 1,
            last_error_seq: 0,
            last_error_code: None,
            last_error_message: None,
        }
    }

    fn clear_error(&mut self) {
        self.last_error_code = None;
        self.last_error_message = None;
    }

    fn set_error(&mut self, code: &str, message: String) {
        self.error_seq_counter = self.error_seq_counter.saturating_add(1);
        self.last_error_seq = self.error_seq_counter;
        self.last_error_code = Some(code.to_string());
        self.last_error_message = Some(message);
        self.playback_state = PlaybackState::Error;
    }

    fn effective_volume(&self) -> f32 {
        if self.muted {
            0.0
        } else {
            self.volume.clamp(0.0, 4.0)
        }
    }

    fn apply_effective_volume(&mut self) {
        let effective = self.effective_volume();
        store_atomic_f32(self.effective_volume_bits.as_ref(), effective);

        if let Some(crossfade) = self.active_crossfade.as_ref() {
            if crossfade.finished.load(Ordering::Acquire) {
                self.active_crossfade = None;
            }
        }

        if self.active_crossfade.is_some() {
            return;
        }

        if let Some(sink) = &self.sink {
            sink.set_volume(effective);
        }
    }

    fn cancel_crossfade(&mut self) {
        let Some(crossfade) = self.active_crossfade.take() else {
            return;
        };

        crossfade.cancel.store(true, Ordering::Release);
        crossfade.old_sink.stop();
        if let Some(tx) = crossfade.old_streaming_command_tx {
            let _ = tx.send(DecoderCommand::Shutdown);
        }
    }

    fn set_state(&mut self, state: PlaybackState) {
        self.playback_state = state;
    }

    fn shutdown_streaming(&mut self) {
        if let Some(streaming) = self.streaming.take() {
            let _ = streaming.command_tx.send(DecoderCommand::Shutdown);
        }
    }

    fn load(&mut self, path: PathBuf) -> Result<(), String> {
        self.cancel_crossfade();
        self.sync_clock();
        self.clear_error();
        self.spectrum_tap.clear();
        self.dsp_runtime.request_reset();
        if let Some(old_sink) = self.sink.take() {
            old_sink.stop();
        }
        self.shutdown_streaming();

        let (sink, output_info) = self.output_backend.create_sink()?;
        self.output_sample_rate = output_info.output_sample_rate;
        self.device_name = output_info
            .device_name
            .clone()
            .or_else(|| self.device_name.clone())
            .or_else(|| self.output_backend.default_device_name());
        sink.pause();

        let opened = self
            .input_registry
            .open_prefer(
                &path,
                self.output_sample_rate,
                self.preferred_input_id.as_deref(),
            )
            .map_err(|err| format!("[{}] {}", err.code, err.message))?;
        eprintln!("[NativeAudio] Input: {}", opened.input_id);
        self.active_input_id = Some(opened.input_id.to_string());

        self.duration = opened.meta.duration;
        self.decoded_channels = opened.meta.channels;
        self.decoded_sample_rate = opened.meta.sample_rate;
        self.decoded_bit_depth = opened.meta.bit_depth;
        self.decoded_samples = None;
        self.streaming = None;

        match opened.kind {
            AudioInputKind::Streaming(streaming) => {
                self.streaming = Some(streaming);
            }
            AudioInputKind::Decoded { samples } => {
                self.decoded_samples = Some(samples);
            }
            AudioInputKind::Rodio => {}
        }

        sink.append(Box::new(DspProcessingSource::new(
            opened.source,
            self.dsp_runtime.clone(),
            self.spectrum_tap.clone(),
        )));

        if self.device_name.is_none() {
            self.device_name = self.output_backend.default_device_name();
        }

        sink.pause();
        sink.set_volume(self.effective_volume());

        self.sink = Some(sink);
        self.current_track = Some(path.clone());

        if !self.queue_initialized {
            self.queue_initialized = true;
        }
        if self.queue.is_empty() {
            self.queue.push(path.clone());
            self.current_index = 0;
        } else if let Some(index) = self.queue.iter().position(|entry| entry == &path) {
            self.current_index = index as i32;
        } else {
            self.queue.push(path.clone());
            self.current_index = (self.queue.len() as i32).saturating_sub(1);
        }

        self.current_position = 0.0;
        self.base_position = 0.0;
        self.playback_started_at = None;
        self.set_state(PlaybackState::Paused);
        Ok(())
    }

    fn crossfade_to(&mut self, path: PathBuf, duration_ms: u64) -> Result<(), String> {
        let was_playing = matches!(self.playback_state, PlaybackState::Playing);
        // VST nodes currently run as out-of-process sidecars and are not safe to drive from two
        // concurrent sinks during crossfade; fall back to non-crossfade load for stability.
        let has_vst = self
            .dsp_chain
            .iter()
            .any(|node| matches!(node, DspNodeConfig::Vst { .. }));
        let can_crossfade = was_playing && self.sink.is_some() && duration_ms > 0 && !has_vst;
        if !can_crossfade {
            self.load(path)?;
            if was_playing {
                self.play()?;
            }
            return Ok(());
        }

        self.cancel_crossfade();
        self.clear_error();
        self.spectrum_tap.clear();

        let (new_sink, output_info) = self.output_backend.create_sink()?;
        self.output_sample_rate = output_info.output_sample_rate;
        self.device_name = output_info
            .device_name
            .clone()
            .or_else(|| self.device_name.clone())
            .or_else(|| self.output_backend.default_device_name());
        new_sink.pause();

        let mut new_streaming: Option<StreamingPlayback> = None;
        let mut decoded_samples: Option<Arc<Vec<f32>>> = None;

        let opened = self
            .input_registry
            .open_prefer(
                &path,
                self.output_sample_rate,
                self.preferred_input_id.as_deref(),
            )
            .map_err(|err| format!("[{}] {}", err.code, err.message))?;
        eprintln!("[NativeAudio] Input: {}", opened.input_id);
        let active_input_id = opened.input_id.to_string();

        let duration = opened.meta.duration;
        let decoded_channels = opened.meta.channels;
        let decoded_sample_rate = opened.meta.sample_rate;
        let decoded_bit_depth = opened.meta.bit_depth;

        match opened.kind {
            AudioInputKind::Streaming(streaming) => {
                new_streaming = Some(streaming);
            }
            AudioInputKind::Decoded { samples } => {
                decoded_samples = Some(samples);
            }
            AudioInputKind::Rodio => {}
        }

        new_sink.append(Box::new(DspProcessingSource::new(
            opened.source,
            self.dsp_runtime.clone(),
            self.spectrum_tap.clone(),
        )));

        if self.device_name.is_none() {
            self.device_name = self.output_backend.default_device_name();
        }

        let base_volume = self.effective_volume();
        store_atomic_f32(self.effective_volume_bits.as_ref(), base_volume);

        new_sink.pause();
        new_sink.set_volume(0.0);

        // For streaming playback, wait for a small prebuffer to reduce underrun clicks/noise.
        if let Some(streaming) = &new_streaming {
            let channels = decoded_channels.max(1) as usize;
            let target_frames = 2048usize; // ~46ms @ 44.1kHz
            let target_samples = target_frames * channels;
            if streaming.buffer.len_samples() < target_samples {
                streaming
                    .buffer
                    .wait_for_samples(target_samples, Duration::from_millis(250));
            }
        }

        new_sink.play();

        let old_sink = self
            .sink
            .replace(new_sink.clone())
            .ok_or_else(|| "No track loaded".to_string())?;
        let old_streaming = std::mem::replace(&mut self.streaming, new_streaming);
        let old_streaming_command_tx = old_streaming.map(|streaming| streaming.command_tx.clone());

        self.current_track = Some(path.clone());
        self.duration = duration;
        self.decoded_samples = decoded_samples;
        self.decoded_channels = decoded_channels;
        self.decoded_sample_rate = decoded_sample_rate;
        self.decoded_bit_depth = decoded_bit_depth;
        self.active_input_id = Some(active_input_id);

        if !self.queue_initialized {
            self.queue_initialized = true;
        }
        if self.queue.is_empty() {
            self.queue.push(path.clone());
            self.current_index = 0;
        } else if let Some(index) = self.queue.iter().position(|entry| entry == &path) {
            self.current_index = index as i32;
        } else {
            self.queue.push(path.clone());
            self.current_index = (self.queue.len() as i32).saturating_sub(1);
        }

        self.current_position = 0.0;
        self.base_position = 0.0;
        self.playback_started_at = Some(Instant::now());
        self.set_state(PlaybackState::Playing);

        let duration = Duration::from_millis(duration_ms.clamp(1, 30_000));
        let cancel = Arc::new(AtomicBool::new(false));
        let finished = Arc::new(AtomicBool::new(false));
        let base_bits = self.effective_volume_bits.clone();
        let cancel_thread = cancel.clone();
        let finished_thread = finished.clone();
        let new_sink_thread = new_sink;
        let old_sink_thread = old_sink.clone();
        let old_tx_thread = old_streaming_command_tx.clone();

        std::thread::spawn(move || {
            let start = Instant::now();
            let step = Duration::from_millis(10);
            loop {
                if cancel_thread.load(Ordering::Acquire) {
                    break;
                }
                let elapsed = start.elapsed();
                let t = if duration.as_nanos() == 0 {
                    1.0f32
                } else {
                    (elapsed.as_secs_f32() / duration.as_secs_f32()).clamp(0.0, 1.0)
                };

                let mut base = load_atomic_f32(base_bits.as_ref());
                if !base.is_finite() {
                    base = 0.0;
                }
                base = base.max(0.0);

                old_sink_thread.set_volume(base * (1.0 - t));
                new_sink_thread.set_volume(base * t);

                if t >= 1.0 {
                    break;
                }
                std::thread::sleep(step);
            }

            let mut base = load_atomic_f32(base_bits.as_ref());
            if !base.is_finite() {
                base = 0.0;
            }
            base = base.max(0.0);

            new_sink_thread.set_volume(base);
            old_sink_thread.set_volume(0.0);
            old_sink_thread.stop();
            if let Some(tx) = old_tx_thread {
                let _ = tx.send(DecoderCommand::Shutdown);
            }
            finished_thread.store(true, Ordering::Release);
        });

        self.active_crossfade = Some(ActiveCrossfade {
            cancel,
            finished,
            old_sink,
            old_streaming_command_tx,
        });

        Ok(())
    }

    fn play(&mut self) -> Result<(), String> {
        if let Some(sink) = &self.sink {
            // For streaming playback, wait for a small prebuffer to reduce underrun clicks/noise.
            if let Some(streaming) = &self.streaming {
                let channels = self.decoded_channels.max(1) as usize;
                let target_frames = 2048usize; // ~46ms @ 44.1kHz
                let target_samples = target_frames * channels;
                if streaming.buffer.len_samples() < target_samples {
                    streaming
                        .buffer
                        .wait_for_samples(target_samples, Duration::from_millis(250));
                }
            }

            sink.play();
            if let Some(crossfade) = self.active_crossfade.as_ref() {
                crossfade.old_sink.play();
            }
            self.set_state(PlaybackState::Playing);
            if self.playback_started_at.is_none() {
                self.base_position = self.current_position;
                self.playback_started_at = Some(Instant::now());
            }
            Ok(())
        } else {
            Err("No track loaded".into())
        }
    }

    fn pause(&mut self) -> Result<(), String> {
        if let Some(sink) = &self.sink {
            sink.pause();
            if let Some(crossfade) = self.active_crossfade.as_ref() {
                crossfade.old_sink.pause();
            }
            self.sync_clock();
            self.set_state(PlaybackState::Paused);
            Ok(())
        } else {
            Err("No track loaded".into())
        }
    }

    fn stop(&mut self) {
        self.cancel_crossfade();
        self.sync_clock();
        self.spectrum_tap.clear();
        self.dsp_runtime.request_reset();

        if let Some(streaming) = &self.streaming {
            streaming.buffer.clear();
            let _ = streaming.command_tx.send(DecoderCommand::Seek(0.0));
            if let Some(sink) = &self.sink {
                sink.pause();
            }
        } else if self.current_track.is_some() && self.output_backend.is_stream_open() {
            let track_path = self.current_track.clone().expect("checked is_some");
            let sink = self.output_backend.create_sink().ok().map(|(sink, _)| sink);

            if let Some(sink) = sink {
                if let (Some(samples), channels, sample_rate) = (
                    self.decoded_samples.clone(),
                    self.decoded_channels,
                    self.decoded_sample_rate,
                ) {
                    sink.append(Box::new(DspProcessingSource::new(
                        SharedSamplesSource::new(samples, channels, sample_rate, 0),
                        self.dsp_runtime.clone(),
                        self.spectrum_tap.clone(),
                    )));
                } else if let Ok((source, _)) = open_rodio_source_at(&track_path, 0.0) {
                    sink.append(Box::new(DspProcessingSource::new(
                        source,
                        self.dsp_runtime.clone(),
                        self.spectrum_tap.clone(),
                    )));
                }
                sink.pause();
                sink.set_volume(self.effective_volume());
                if let Some(old) = self.sink.replace(sink) {
                    old.stop();
                }
            }
        } else if let Some(sink) = &self.sink {
            sink.pause();
        }

        self.current_position = 0.0;
        self.base_position = 0.0;
        self.playback_started_at = None;
        self.set_state(PlaybackState::Stopped);
    }

    fn sync_queue_state(&mut self, queue: Vec<PathBuf>, current_index: i32) {
        self.queue_initialized = true;
        self.queue = queue;
        let max_index = (self.queue.len() as i32).saturating_sub(1);
        self.current_index = current_index.clamp(-1, max_index);

        if self.queue.is_empty() || self.current_index < 0 {
            self.cancel_crossfade();
            self.sync_clock();
            self.spectrum_tap.clear();
            self.dsp_runtime.request_reset();
            if let Some(sink) = self.sink.take() {
                sink.stop();
            }
            self.shutdown_streaming();
            self.current_track = None;
            self.active_input_id = None;
            self.current_position = 0.0;
            self.base_position = 0.0;
            self.playback_started_at = None;
            self.duration = 0.0;
            self.decoded_samples = None;
            self.decoded_channels = 0;
            self.decoded_sample_rate = 0;
            self.decoded_bit_depth = None;
            self.set_state(PlaybackState::Stopped);
        }
    }

    fn seek(&mut self, seconds: f64) -> Result<(), String> {
        self.cancel_crossfade();
        self.sync_clock();
        self.spectrum_tap.clear();
        self.dsp_runtime.request_reset();
        let track_path = self
            .current_track
            .clone()
            .ok_or_else(|| "No track loaded".to_string())?;
        let target = seconds.max(0.0);
        let resume_playing = matches!(self.playback_state, PlaybackState::Playing);

        if let Some(streaming) = &self.streaming {
            streaming.buffer.clear();
            self.spectrum_tap.clear();
            self.dsp_runtime.request_reset();
            let _ = streaming.command_tx.send(DecoderCommand::Seek(target));

            if resume_playing {
                if let Some(sink) = &self.sink {
                    sink.play();
                }
                self.base_position = target;
                self.playback_started_at = Some(Instant::now());
            } else {
                self.base_position = target;
                self.playback_started_at = None;
            }

            self.current_position = target;
            return Ok(());
        }

        let (sink, output_info) = self.output_backend.create_sink()?;
        self.output_sample_rate = output_info.output_sample_rate;
        self.device_name = output_info
            .device_name
            .clone()
            .or_else(|| self.device_name.clone())
            .or_else(|| self.output_backend.default_device_name());
        sink.pause();

        if let (Some(samples), channels, sample_rate) = (
            self.decoded_samples.clone(),
            self.decoded_channels,
            self.decoded_sample_rate,
        ) {
            let start_sample = ((target * sample_rate as f64) as usize) * channels as usize;
            let source = SharedSamplesSource::new(samples, channels, sample_rate, start_sample);
            sink.append(Box::new(DspProcessingSource::new(
                source,
                self.dsp_runtime.clone(),
                self.spectrum_tap.clone(),
            )));
        } else {
            let (source, _) = open_rodio_source_at(&track_path, target)
                .map_err(|err| format!("[{}] {}", err.code, err.message))?;
            sink.append(Box::new(DspProcessingSource::new(
                source,
                self.dsp_runtime.clone(),
                self.spectrum_tap.clone(),
            )));
        }
        sink.set_volume(self.effective_volume());

        if resume_playing {
            sink.play();
            self.base_position = target;
            self.playback_started_at = Some(Instant::now());
        } else {
            self.base_position = target;
            self.playback_started_at = None;
        }

        if let Some(old_sink) = self.sink.replace(sink) {
            old_sink.stop();
        }

        self.current_position = target;
        Ok(())
    }

    fn snapshot_for_spectrum(&self) -> Option<SpectrumSnapshot> {
        let (window, sample_rate) = self.spectrum_tap.snapshot()?;
        Some(SpectrumSnapshot {
            sample_rate,
            window,
        })
    }

    fn update_position_from_clock(&mut self) {
        let Some(started_at) = self.playback_started_at else {
            return;
        };
        let elapsed = started_at.elapsed().as_secs_f64();
        let mut next = self.base_position + elapsed;
        if self.duration > 0.0 {
            next = next.min(self.duration);
        }
        self.current_position = next;
    }

    fn sync_clock(&mut self) {
        self.update_position_from_clock();
        self.base_position = self.current_position;
        self.playback_started_at = None;
    }

    fn tick(&mut self) -> bool {
        if let Some(crossfade) = self.active_crossfade.as_ref() {
            if crossfade.finished.load(Ordering::Acquire) {
                self.active_crossfade = None;
                self.apply_effective_volume();
            }
        }

        let streaming_error = if let Some(streaming) = self.streaming.as_ref() {
            if let Ok(mut guard) = streaming.error.lock() {
                guard.take()
            } else {
                None
            }
        } else {
            None
        };

        if let Some(message) = streaming_error {
            if let Some(sink) = &self.sink {
                sink.pause();
            }
            self.sync_clock();
            self.set_error("NATIVE_AUDIO_STREAM_ERROR", message);
            return true;
        }

        if !matches!(self.playback_state, PlaybackState::Playing) {
            return false;
        }
        self.update_position_from_clock();
        let Some(sink) = &self.sink else {
            return false;
        };
        if sink.empty() {
            self.current_position = self.duration;
            self.base_position = self.current_position;
            self.playback_started_at = None;
            self.set_state(PlaybackState::Stopped);
        }
        true
    }

    fn set_volume(&mut self, volume: f32) {
        self.volume = volume;
        self.apply_effective_volume();
    }

    fn set_mute(&mut self, muted: bool) {
        self.muted = muted;
        self.apply_effective_volume();
    }

    fn set_gain(&mut self, gain_db: f32) {
        self.gain_db = gain_db.clamp(-60.0, 12.0);

        // Keep non-gain nodes while replacing gain with a single node.
        let mut next_chain = Vec::with_capacity(self.dsp_chain.len().max(1));
        next_chain.push(DspNodeConfig::Gain { db: self.gain_db });
        for node in &self.dsp_chain {
            if !matches!(node, DspNodeConfig::Gain { .. }) {
                next_chain.push(node.clone());
            }
        }
        self.dsp_chain = next_chain;
        self.gain_db = self.dsp_runtime.apply_chain(&self.dsp_chain);
    }

    fn set_replay_gain(&mut self, replay_gain_db: f32) {
        self.replay_gain_db = self.dsp_runtime.set_replay_gain_db(replay_gain_db);
    }

    fn set_dsp_chain(&mut self, chain: Vec<DspNodeConfig>) {
        self.dsp_chain = chain;
        self.gain_db = self.dsp_runtime.apply_chain(&self.dsp_chain);
    }

    fn set_preferred_input_id(&mut self, input_id: Option<String>) -> Result<(), String> {
        let input_id = input_id.and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        });

        if let Some(id) = input_id.as_deref() {
            if !self.input_registry.contains_id(id) {
                return Err(format!("Unknown audio input id: {id}"));
            }
        }

        self.preferred_input_id = input_id;
        Ok(())
    }

    fn build_state_payload(&self, ended: bool) -> NativeAudioStatePayload {
        NativeAudioStatePayload {
            playback_state: self.playback_state.as_str().to_string(),
            volume: self.volume,
            gain_db: self.gain_db,
            replay_gain_db: self.replay_gain_db,
            muted: self.muted,
            track_path: self
                .current_track
                .as_ref()
                .and_then(|path| path.to_str().map(|s| s.to_string())),
            current_time: self.current_position,
            duration: self.duration,
            sample_rate: if self.decoded_sample_rate > 0 {
                Some(self.decoded_sample_rate)
            } else {
                None
            },
            bit_depth: self.decoded_bit_depth,
            device: self.device_name.clone(),
            queue: if self.queue_initialized {
                Some(
                    self.queue
                        .iter()
                        .filter_map(|path| path.to_str().map(|s| s.to_string()))
                        .collect(),
                )
            } else {
                None
            },
            current_index: if self.queue_initialized {
                Some(self.current_index)
            } else {
                None
            },
            ended,
            error_seq: self
                .last_error_code
                .as_ref()
                .map(|_| self.last_error_seq)
                .filter(|seq| *seq > 0),
            error_code: self.last_error_code.clone(),
            error_message: self.last_error_message.clone(),
        }
    }

    fn build_components_payload(&self) -> NativeAudioComponentsStatePayload {
        NativeAudioComponentsStatePayload {
            output_backend_id: self.output_backend.id().to_string(),
            output_device: self.device_name.clone(),
            output_sample_rate: self.output_sample_rate,
            preferred_input_id: self.preferred_input_id.clone(),
            active_input_id: self.active_input_id.clone(),
        }
    }

    fn rebuild_sink_on_new_device(&mut self) -> Result<(), String> {
        self.cancel_crossfade();
        let Some(track_path) = self.current_track.clone() else {
            return Ok(());
        };

        let target = self.current_position.max(0.0);
        let resume_playing = matches!(self.playback_state, PlaybackState::Playing);

        self.sync_clock();
        if let Some(old_sink) = self.sink.take() {
            old_sink.stop();
        }

        let (sink, output_info) = self.output_backend.create_sink()?;
        self.output_sample_rate = output_info.output_sample_rate;
        self.device_name = output_info
            .device_name
            .clone()
            .or_else(|| self.device_name.clone())
            .or_else(|| self.output_backend.default_device_name());

        self.spectrum_tap.clear();
        self.dsp_runtime.request_reset();

        if let Some(streaming) = &self.streaming {
            streaming.buffer.clear();
            let _ = streaming.command_tx.send(DecoderCommand::Seek(target));
            let source = StreamingSamplesSource::new(
                streaming.buffer.clone(),
                self.decoded_channels.max(1),
                self.decoded_sample_rate.max(1),
                self.duration,
            );
            sink.append(Box::new(DspProcessingSource::new(
                source,
                self.dsp_runtime.clone(),
                self.spectrum_tap.clone(),
            )));
        } else if let Some(samples) = self.decoded_samples.clone() {
            let channels = self.decoded_channels.max(1);
            let sample_rate = self.decoded_sample_rate.max(1);
            let start_sample = ((target * sample_rate as f64) as usize) * channels as usize;
            sink.append(Box::new(DspProcessingSource::new(
                SharedSamplesSource::new(samples, channels, sample_rate, start_sample),
                self.dsp_runtime.clone(),
                self.spectrum_tap.clone(),
            )));
        } else {
            let (source, _) = open_rodio_source_at(&track_path, target)
                .map_err(|err| format!("[{}] {}", err.code, err.message))?;
            sink.append(Box::new(DspProcessingSource::new(
                source,
                self.dsp_runtime.clone(),
                self.spectrum_tap.clone(),
            )));
        }

        sink.pause();
        sink.set_volume(self.effective_volume());

        if resume_playing {
            sink.play();
            self.base_position = target;
            self.playback_started_at = Some(Instant::now());
        } else {
            self.base_position = target;
            self.playback_started_at = None;
        }

        self.current_position = target;
        self.sink = Some(sink);
        Ok(())
    }
}

fn emit_state(app_handle: &AppHandle, payload: NativeAudioStatePayload) -> Result<(), String> {
    app_handle
        .emit_all("native_audio_state", payload)
        .map_err(|e| format!("Failed to emit state: {e}"))
}

fn emit_spectrum(
    app_handle: &AppHandle,
    payload: NativeAudioSpectrumPayload,
) -> Result<(), String> {
    app_handle
        .emit_all("native_audio_spectrum", payload)
        .map_err(|e| format!("Failed to emit spectrum: {e}"))
}

fn mark_error_emitted(seq: u64) -> bool {
    if seq == 0 {
        return false;
    }
    loop {
        let prev = LAST_EMITTED_ERROR_SEQ.load(Ordering::Acquire);
        if seq <= prev {
            return false;
        }
        if LAST_EMITTED_ERROR_SEQ
            .compare_exchange(prev, seq, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            return true;
        }
    }
}

fn emit_error(app_handle: &AppHandle, payload: NativeAudioErrorPayload) -> Result<(), String> {
    if !mark_error_emitted(payload.seq) {
        return Ok(());
    }
    app_handle
        .emit_all("native_audio_error", payload)
        .map_err(|e| format!("Failed to emit error: {e}"))
}

#[derive(Clone)]
struct SpectrumSnapshot {
    sample_rate: u32,
    window: Vec<f32>,
}

fn compute_spectrum(
    fft: &std::sync::Arc<dyn rustfft::Fft<f32>>,
    snapshot: &SpectrumSnapshot,
) -> Option<NativeAudioSpectrumPayload> {
    let sample_rate = snapshot.sample_rate as usize;
    if sample_rate == 0 {
        return None;
    }

    let window_size = 1024usize;
    let mut input: Vec<Complex<f32>> = Vec::with_capacity(window_size);
    for frame in 0..window_size {
        let mono = snapshot.window.get(frame).copied().unwrap_or(0.0);
        let hann =
            0.5 - 0.5 * ((2.0 * std::f32::consts::PI * frame as f32) / window_size as f32).cos();
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

    Some(NativeAudioSpectrumPayload { bins: mags })
}

// Legacy symphonia implementation (moved into `crate::audio::input::symphonia`).
#[cfg(any())]
fn track_is_audio_like(track: &Track) -> bool {
    track.codec_params.sample_rate.is_some()
        || track.codec_params.channels.is_some()
        || track.codec_params.bits_per_sample.is_some()
        || track.codec_params.bits_per_coded_sample.is_some()
}

#[cfg(any())]
fn pick_audio_track<'a>(format: &'a dyn FormatReader) -> Option<&'a Track> {
    let tracks = format.tracks();
    let default = format.default_track();
    if let Some(track) = default {
        if track_is_audio_like(track) {
            return Some(track);
        }
    }
    tracks
        .iter()
        .find(|t| track_is_audio_like(t))
        .or(default)
        .or_else(|| tracks.first())
}

#[cfg(any())]
fn start_symphonia_stream(
    path: &Path,
    output_sample_rate: Option<u32>,
) -> Result<(StreamingSamplesSource, DecoderMeta, StreamingPlayback), String> {
    let buffer = AudioRingBuffer::new(352_800);

    let (command_tx, command_rx) = mpsc::channel::<DecoderCommand>();
    let (meta_tx, meta_rx) = mpsc::channel::<Result<DecoderMeta, String>>();

    let path = path.to_path_buf();
    let buffer_clone = buffer.clone();
    let error = Arc::new(Mutex::new(None::<String>));
    let error_clone = error.clone();

    std::thread::spawn(move || {
        let init = (|| -> Result<(Box<dyn FormatReader>, Track), String> {
            let file = File::open(&path).map_err(|e| format!("Failed to open file: {e}"))?;
            let mss = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());
            let mut hint = Hint::new();
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                hint.with_extension(ext);
            }
            let format_options = FormatOptions {
                prebuild_seek_index: false,
                seek_index_fill_rate: 5,
                enable_gapless: false,
            };
            let probed = symphonia::default::get_probe()
                .format(&hint, mss, &format_options, &MetadataOptions::default())
                .map_err(|e| format!("Failed to probe format: {e}"))?;
            let format = probed.format;
            let track = pick_audio_track(format.as_ref())
                .ok_or_else(|| "No audio track found".to_string())?
                .clone();
            Ok((format, track))
        })();

        let (mut format, track) = match init {
            Ok(value) => value,
            Err(err) => {
                if let Ok(mut guard) = error_clone.lock() {
                    *guard = Some(err.clone());
                }
                let _ = meta_tx.send(Err(err));
                buffer_clone.mark_finished();
                return;
            }
        };

        let bit_depth = track
            .codec_params
            .bits_per_sample
            .or(track.codec_params.bits_per_coded_sample);

        let track_id = track.id;
        let mut decoder = match symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
        {
            Ok(decoder) => decoder,
            Err(err) => {
                let message = format!("Failed to create decoder: {err}");
                if let Ok(mut guard) = error_clone.lock() {
                    *guard = Some(message.clone());
                }
                let _ = meta_tx.send(Err(message));
                buffer_clone.mark_finished();
                return;
            }
        };

        let mut sample_buf: Option<SampleBuffer<f32>> = None;
        let mut pending_trim_frames_out: usize = 0;

        let resample_chunk_frames = 1024usize;
        let mut resampler: Option<SincFixedIn<f32>> = None;
        let mut resampler_input: Vec<Vec<f32>> = Vec::new();
        let mut channels_usize: usize = 0;
        let mut effective_sample_rate: u32 = 0;
        let mut meta_delivered = false;

        'decode_loop: loop {
            while let Ok(cmd) = command_rx.try_recv() {
                match cmd {
                    DecoderCommand::Shutdown => {
                        buffer_clone.mark_finished();
                        return;
                    }
                    DecoderCommand::Seek(target) => {
                        buffer_clone.clear();
                        pending_trim_frames_out = 0;

                        let seek_to = SeekTo::Time {
                            time: Time::from(target.max(0.0)),
                            track_id: Some(track_id),
                        };

                        if let Ok(seeked) = format.seek(SeekMode::Accurate, seek_to) {
                            if let Some(time_base) = track.codec_params.time_base {
                                let required = time_base.calc_time(seeked.required_ts);
                                let actual = time_base.calc_time(seeked.actual_ts);
                                let required_seconds = required.seconds as f64 + required.frac;
                                let actual_seconds = actual.seconds as f64 + actual.frac;
                                let delta = (required_seconds - actual_seconds).max(0.0);
                                pending_trim_frames_out =
                                    (delta * effective_sample_rate as f64) as usize;
                            }

                            decoder = match symphonia::default::get_codecs()
                                .make(&track.codec_params, &DecoderOptions::default())
                            {
                                Ok(decoder) => decoder,
                                Err(err) => {
                                    if let Ok(mut guard) = error_clone.lock() {
                                        if guard.is_none() {
                                            *guard =
                                                Some(format!("Failed to create decoder: {err}"));
                                        }
                                    }
                                    buffer_clone.mark_finished();
                                    return;
                                }
                            };
                            sample_buf = None;
                            if let Some(r) = resampler.as_mut() {
                                r.reset();
                            }
                            for ch in &mut resampler_input {
                                ch.clear();
                            }
                        }
                    }
                }
            }

            let packet = match format.next_packet() {
                Ok(packet) => packet,
                Err(SymphoniaError::IoError(err))
                    if err.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    if !meta_delivered {
                        let message = "No audio packets decoded".to_string();
                        if let Ok(mut guard) = error_clone.lock() {
                            *guard = Some(message.clone());
                        }
                        let _ = meta_tx.send(Err(message));
                    }
                    buffer_clone.mark_finished();
                    return;
                }
                Err(SymphoniaError::ResetRequired) => {
                    if !meta_delivered {
                        let message = "Decoder reset required".to_string();
                        if let Ok(mut guard) = error_clone.lock() {
                            *guard = Some(message.clone());
                        }
                        let _ = meta_tx.send(Err(message));
                    }
                    buffer_clone.mark_finished();
                    return;
                }
                Err(err) => {
                    if !meta_delivered {
                        let message = format!("Failed to read packet: {err}");
                        if let Ok(mut guard) = error_clone.lock() {
                            *guard = Some(message.clone());
                        }
                        let _ = meta_tx.send(Err(message));
                    }
                    buffer_clone.mark_finished();
                    return;
                }
            };

            if packet.track_id() != track_id {
                continue;
            }

            match decoder.decode(&packet) {
                Ok(decoded) => {
                    let spec = *decoded.spec();
                    if sample_buf.is_none() {
                        sample_buf =
                            Some(SampleBuffer::<f32>::new(decoded.capacity() as u64, spec));
                    }

                    if let Some(buf) = &mut sample_buf {
                        buf.copy_interleaved_ref(decoded);
                        let channels = spec.channels.count().max(1);
                        if !meta_delivered {
                            channels_usize = channels;
                            let input_sample_rate = spec.rate.max(1);
                            effective_sample_rate = input_sample_rate;

                            let requested_sample_rate =
                                output_sample_rate.unwrap_or(input_sample_rate);
                            if requested_sample_rate != input_sample_rate {
                                let params = SincInterpolationParameters {
                                    sinc_len: 256,
                                    f_cutoff: 0.95,
                                    interpolation: SincInterpolationType::Cubic,
                                    oversampling_factor: 128,
                                    window: WindowFunction::BlackmanHarris2,
                                };
                                let resample_ratio =
                                    requested_sample_rate as f64 / input_sample_rate as f64;
                                match SincFixedIn::<f32>::new(
                                    resample_ratio,
                                    1.0,
                                    params,
                                    resample_chunk_frames,
                                    channels_usize,
                                ) {
                                    Ok(instance) => {
                                        resampler = Some(instance);
                                        resampler_input =
                                            (0..channels_usize).map(|_| Vec::new()).collect();
                                        effective_sample_rate = requested_sample_rate;
                                    }
                                    Err(err) => {
                                        eprintln!(
                                            "[NativeAudio] Failed to init resampler, falling back: {err}"
                                        );
                                    }
                                }
                            }

                            let duration = track
                                .codec_params
                                .n_frames
                                .map(|frames| frames as f64 / input_sample_rate as f64)
                                .unwrap_or(0.0);
                            let _ = meta_tx.send(Ok(DecoderMeta {
                                channels: channels_usize as u16,
                                sample_rate: effective_sample_rate,
                                bit_depth,
                                duration,
                            }));
                            eprintln!(
                                "[NativeAudio] Stream init: channels={} in_sr={input_sample_rate} out_sr={effective_sample_rate} resample={}",
                                channels_usize,
                                resampler.is_some()
                            );
                            meta_delivered = true;
                        }
                        let all = buf.samples();
                        let total_frames = all.len() / channels;
                        if total_frames > 0 {
                            let slice = all;

                            // Resample to device mix rate to avoid rodio's low-quality resampler artifacts.
                            let mut out_interleaved: Vec<f32> = Vec::new();
                            if let Some(resampler) = resampler.as_mut() {
                                // deinterleave
                                let frames = slice.len() / channels;
                                for frame in 0..frames {
                                    for ch in 0..channels {
                                        resampler_input[ch].push(slice[frame * channels + ch]);
                                    }
                                }

                                while channels_usize > 0
                                    && resampler_input.len() == channels_usize
                                    && resampler_input
                                        .iter()
                                        .all(|channel| channel.len() >= resample_chunk_frames)
                                {
                                    let mut input_block: Vec<Vec<f32>> =
                                        Vec::with_capacity(channels_usize);
                                    for ch in 0..channels_usize {
                                        let drained: Vec<f32> = resampler_input[ch]
                                            .drain(0..resample_chunk_frames)
                                            .collect();
                                        input_block.push(drained);
                                    }

                                    let output_blocks = match resampler.process(&input_block, None)
                                    {
                                        Ok(value) => value,
                                        Err(_) => break,
                                    };

                                    let out_frames =
                                        output_blocks.get(0).map(|v| v.len()).unwrap_or(0);
                                    if out_frames == 0 {
                                        continue;
                                    }

                                    let mut start_out_frame = 0usize;
                                    if pending_trim_frames_out > 0 {
                                        let trim_now = pending_trim_frames_out.min(out_frames);
                                        start_out_frame = trim_now;
                                        pending_trim_frames_out =
                                            pending_trim_frames_out.saturating_sub(trim_now);
                                    }

                                    for frame in start_out_frame..out_frames {
                                        for ch in 0..channels_usize {
                                            if let Some(sample) = output_blocks[ch].get(frame) {
                                                out_interleaved.push(*sample);
                                            }
                                        }
                                    }
                                }
                            } else {
                                // No resampling: apply pending trim in input frames.
                                let mut start_frame = 0usize;
                                if pending_trim_frames_out > 0 {
                                    let trim_now = pending_trim_frames_out.min(total_frames);
                                    start_frame = trim_now;
                                    pending_trim_frames_out =
                                        pending_trim_frames_out.saturating_sub(trim_now);
                                }
                                let start_index = start_frame * channels;
                                if start_index < slice.len() {
                                    out_interleaved.extend_from_slice(&slice[start_index..]);
                                }
                            }

                            let mut offset = 0usize;
                            while offset < out_interleaved.len() {
                                if let Ok(cmd) = command_rx.try_recv() {
                                    match cmd {
                                        DecoderCommand::Shutdown => {
                                            buffer_clone.mark_finished();
                                            return;
                                        }
                                        DecoderCommand::Seek(target) => {
                                            buffer_clone.clear();
                                            pending_trim_frames_out = 0;

                                            let seek_to = SeekTo::Time {
                                                time: Time::from(target.max(0.0)),
                                                track_id: Some(track_id),
                                            };

                                            if let Ok(seeked) =
                                                format.seek(SeekMode::Accurate, seek_to)
                                            {
                                                if let Some(time_base) =
                                                    track.codec_params.time_base
                                                {
                                                    let required =
                                                        time_base.calc_time(seeked.required_ts);
                                                    let actual =
                                                        time_base.calc_time(seeked.actual_ts);
                                                    let required_seconds =
                                                        required.seconds as f64 + required.frac;
                                                    let actual_seconds =
                                                        actual.seconds as f64 + actual.frac;
                                                    let delta = (required_seconds - actual_seconds)
                                                        .max(0.0);
                                                    pending_trim_frames_out = (delta
                                                        * effective_sample_rate as f64)
                                                        as usize;
                                                }

                                                decoder = match symphonia::default::get_codecs()
                                                    .make(
                                                        &track.codec_params,
                                                        &DecoderOptions::default(),
                                                    ) {
                                                    Ok(decoder) => decoder,
                                                    Err(_) => {
                                                        buffer_clone.mark_finished();
                                                        return;
                                                    }
                                                };
                                                sample_buf = None;
                                                if let Some(r) = resampler.as_mut() {
                                                    r.reset();
                                                }
                                                for ch in &mut resampler_input {
                                                    ch.clear();
                                                }
                                            }

                                            continue 'decode_loop;
                                        }
                                    }
                                }

                                let remaining = &out_interleaved[offset..];
                                let frames_pushed =
                                    buffer_clone.push_interleaved(remaining, channels);
                                if frames_pushed == 0 {
                                    continue;
                                }
                                offset += frames_pushed * channels;
                            }
                        }
                    }
                }
                Err(SymphoniaError::DecodeError(_)) => continue,
                Err(SymphoniaError::IoError(err))
                    if err.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    if !meta_delivered {
                        let message = "No audio samples decoded".to_string();
                        if let Ok(mut guard) = error_clone.lock() {
                            *guard = Some(message.clone());
                        }
                        let _ = meta_tx.send(Err(message));
                    }
                    buffer_clone.mark_finished();
                    return;
                }
                Err(err) => {
                    if !meta_delivered {
                        let message = format!("Decoder error: {err}");
                        if let Ok(mut guard) = error_clone.lock() {
                            if guard.is_none() {
                                *guard = Some(message.clone());
                            }
                        }
                        let _ = meta_tx.send(Err(message));
                    }
                    if let Ok(mut guard) = error_clone.lock() {
                        if guard.is_none() {
                            *guard = Some(format!("Decoder error: {err}"));
                        }
                    }
                    buffer_clone.mark_finished();
                    return;
                }
            }
        }
    });

    let meta = match meta_rx.recv_timeout(Duration::from_secs(2)) {
        Ok(value) => value?,
        Err(err) => {
            let _ = command_tx.send(DecoderCommand::Shutdown);
            return Err(format!("Timed out initializing decoder: {err}"));
        }
    };

    Ok((
        StreamingSamplesSource::new(
            buffer.clone(),
            meta.channels,
            meta.sample_rate,
            meta.duration,
        ),
        meta,
        StreamingPlayback {
            buffer,
            command_tx,
            error,
        },
    ))
}

fn init_emitter(app_handle: &AppHandle) {
    let _ = APP_HANDLE.set(app_handle.clone());
    if EMITTER_STARTED.set(()).is_err() {
        return;
    }

    std::thread::spawn(|| {
        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(1024);

        loop {
            std::thread::sleep(Duration::from_millis(250));
            let Some(app_handle) = APP_HANDLE.get().cloned() else {
                continue;
            };

            let Some((state_payload, spectrum_snapshot)) = (|| {
                let mut engine = ENGINE.lock().ok()?;
                let was_playing = matches!(engine.playback_state, PlaybackState::Playing);
                let ticked = engine.tick();
                if !ticked {
                    return None;
                }
                let is_stopped = matches!(engine.playback_state, PlaybackState::Stopped);
                let ended = was_playing && is_stopped;
                Some((
                    engine.build_state_payload(ended),
                    engine.snapshot_for_spectrum(),
                ))
            })() else {
                continue;
            };

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
            let _ = emit_state(&app_handle, state_payload);
            if let Some(error_payload) = maybe_error {
                let _ = emit_error(&app_handle, error_payload);
            }
            if let Some(snapshot) = spectrum_snapshot {
                if let Some(spectrum) = compute_spectrum(&fft, &snapshot) {
                    let _ = emit_spectrum(&app_handle, spectrum);
                }
            }
        }
    });
}

pub fn load(app_handle: &AppHandle, path: Option<String>) -> Result<(), String> {
    init_emitter(app_handle);
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
            emit_state(app_handle, payload)?;
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
            emit_state(app_handle, payload)?;
            if let Some(error_payload) = maybe_error {
                emit_error(app_handle, error_payload)?;
            }
            Err(err)
        }
    }
}

pub fn crossfade_to(app_handle: &AppHandle, path: String, duration_ms: u64) -> Result<(), String> {
    init_emitter(app_handle);
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

    emit_state(app_handle, payload)?;
    if let Err(err) = result {
        if let Some(error_payload) = maybe_error {
            emit_error(app_handle, error_payload)?;
        }
        return Err(err);
    }
    Ok(())
}

pub fn play(app_handle: &AppHandle) -> Result<(), String> {
    init_emitter(app_handle);
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
    emit_state(app_handle, payload)?;
    if let Err(err) = result {
        if let Some(error_payload) = maybe_error {
            emit_error(app_handle, error_payload)?;
        }
        return Err(err);
    }
    Ok(())
}

pub fn pause(app_handle: &AppHandle) -> Result<(), String> {
    init_emitter(app_handle);
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
    emit_state(app_handle, payload)?;
    if let Err(err) = result {
        if let Some(error_payload) = maybe_error {
            emit_error(app_handle, error_payload)?;
        }
        return Err(err);
    }
    Ok(())
}

pub fn stop(app_handle: &AppHandle) -> Result<(), String> {
    init_emitter(app_handle);
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

    emit_state(app_handle, payload)?;
    if let Some(error_payload) = maybe_error {
        emit_error(app_handle, error_payload)?;
    }
    Ok(())
}

pub fn sync_queue(
    app_handle: &AppHandle,
    queue: Vec<String>,
    current_index: i32,
) -> Result<(), String> {
    init_emitter(app_handle);
    let payload = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        let paths = queue.into_iter().map(PathBuf::from).collect::<Vec<_>>();
        engine.sync_queue_state(paths, current_index);
        engine.build_state_payload(false)
    };
    emit_state(app_handle, payload)?;
    Ok(())
}

pub fn seek(app_handle: &AppHandle, time: f64) -> Result<(), String> {
    init_emitter(app_handle);
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
    emit_state(app_handle, payload)?;
    if let Err(err) = result {
        if let Some(error_payload) = maybe_error {
            emit_error(app_handle, error_payload)?;
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
    init_emitter(app_handle);
    let clamped = volume.clamp(0.0, 1.0);
    let payload = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        engine.set_volume(clamped);
        engine.build_state_payload(false)
    };
    emit_state(app_handle, payload)?;
    Ok(())
}

pub fn set_mute(app_handle: &AppHandle, muted: bool) -> Result<(), String> {
    init_emitter(app_handle);
    let payload = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        engine.set_mute(muted);
        engine.build_state_payload(false)
    };
    emit_state(app_handle, payload)?;
    Ok(())
}

pub fn set_gain(app_handle: &AppHandle, gain_db: f32) -> Result<(), String> {
    init_emitter(app_handle);
    let payload = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        engine.set_gain(gain_db);
        engine.build_state_payload(false)
    };
    emit_state(app_handle, payload)?;
    Ok(())
}

pub fn set_replay_gain(app_handle: &AppHandle, replay_gain_db: Option<f32>) -> Result<(), String> {
    init_emitter(app_handle);
    let payload = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        engine.set_replay_gain(replay_gain_db.unwrap_or(0.0));
        engine.build_state_payload(false)
    };
    emit_state(app_handle, payload)?;
    Ok(())
}

pub fn set_dsp_chain(app_handle: &AppHandle, chain: Vec<DspNodeConfig>) -> Result<(), String> {
    init_emitter(app_handle);

    let sample_rate = {
        let engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        engine.output_sample_rate.unwrap_or(48_000).max(1)
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

        desired_vst_node_ids.push(id.clone());
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
        engine.dsp_runtime.set_vst_nodes(vst_keys);
        engine.build_state_payload(false)
    };
    emit_state(app_handle, payload)?;
    Ok(())
}

fn available_output_backend_ids() -> [&'static str; 1] {
    [RODIO_CPAL_BACKEND_ID]
}

fn create_output_backend_by_id(id: &str) -> Option<Arc<dyn AudioOutputBackend>> {
    match id {
        RODIO_CPAL_BACKEND_ID => Some(default_backend()),
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
        engine.input_registry.list_ids()
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
    init_emitter(app_handle);

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
            engine.set_error("NATIVE_AUDIO_BACKEND_SELECT_FAILED", message.clone());
            let state_payload = engine.build_state_payload(false);
            let maybe_error = match (
                state_payload.error_seq,
                state_payload.error_code.clone(),
                state_payload.error_message.clone(),
            ) {
                (Some(seq), Some(code), Some(message)) => Some(NativeAudioErrorPayload {
                    seq,
                    code,
                    message,
                }),
                _ => None,
            };
            (state_payload, maybe_error)
        };

        emit_state(app_handle, state_payload)?;
        if let Some(error_payload) = maybe_error {
            emit_error(app_handle, error_payload)?;
        }
        return Err(message);
    };

    let (result, state_payload, components_payload, maybe_error) = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;

        let mut result: Result<(), String> = Ok(());
        if engine.output_backend.id() != target_id {
            engine.output_backend = target_backend;
            engine.device_name = None;
            if let Err(err) = engine.rebuild_sink_on_new_device() {
                engine.set_error("NATIVE_AUDIO_REBUILD_SINK_FAILED", err.clone());
                result = Err(err);
            }
        }

        let state_payload = engine.build_state_payload(false);
        let components_payload = engine.build_components_payload();
        let maybe_error = match (
            state_payload.error_seq,
            state_payload.error_code.clone(),
            state_payload.error_message.clone(),
        ) {
            (Some(seq), Some(code), Some(message)) => Some(NativeAudioErrorPayload {
                seq,
                code,
                message,
            }),
            _ => None,
        };

        (result, state_payload, components_payload, maybe_error)
    };

    emit_state(app_handle, state_payload)?;
    if let Err(err) = result {
        if let Some(error_payload) = maybe_error {
            emit_error(app_handle, error_payload)?;
        }
        return Err(err);
    }

    Ok(components_payload)
}

pub fn select_audio_input(
    app_handle: &AppHandle,
    input_id: Option<String>,
) -> Result<NativeAudioComponentsStatePayload, String> {
    init_emitter(app_handle);

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
            (Some(seq), Some(code), Some(message)) => Some(NativeAudioErrorPayload {
                seq,
                code,
                message,
            }),
            _ => None,
        };

        (result, state_payload, components_payload, maybe_error)
    };

    emit_state(app_handle, state_payload)?;
    if let Err(err) = result {
        if let Some(error_payload) = maybe_error {
            emit_error(app_handle, error_payload)?;
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
        engine.output_backend.clone()
    };

    output_backend.list_devices()
}

pub fn select_output_device(
    app_handle: &AppHandle,
    device_name: Option<String>,
) -> Result<(), String> {
    init_emitter(app_handle);

    let output_backend = {
        let engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        engine.output_backend.clone()
    };

    let already_selected = output_backend.is_stream_open()
        && match device_name.as_deref() {
            Some(requested) => output_backend
                .current_info()
                .device_name
                .as_deref()
                .is_some_and(|current| current == requested),
            None => output_backend.current_info().device_name == output_backend.default_device_name(),
        };

    if already_selected {
        let payload = {
            let engine = ENGINE
                .lock()
                .map_err(|_| "Audio engine is locked".to_string())?;
            engine.build_state_payload(false)
        };
        emit_state(app_handle, payload)?;
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

            emit_state(app_handle, payload)?;
            if let Some(error_payload) = maybe_error {
                emit_error(app_handle, error_payload)?;
            }
            return Err(err);
        }
    };

    let payload = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;

        engine.sync_clock();
        engine.output_sample_rate = output_info.output_sample_rate;
        engine.device_name = output_info
            .device_name
            .clone()
            .or_else(|| engine.device_name.clone())
            .or_else(|| engine.output_backend.default_device_name());

        if let Err(err) = engine.rebuild_sink_on_new_device() {
            engine.set_error("NATIVE_AUDIO_REBUILD_SINK_FAILED", err);
        }

        engine.build_state_payload(false)
    };

    emit_state(app_handle, payload)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dsp_runtime_applies_gain_nodes() {
        let runtime = DspRuntime::new();
        let gain_db = runtime.apply_chain(&[DspNodeConfig::Gain { db: -6.0 }]);
        assert!((gain_db + 6.0).abs() < 1e-6);

        let snapshot = runtime.snapshot();
        assert!((snapshot.gain_db + 6.0).abs() < 1e-6);
        assert!((snapshot.gain_linear - gain_db_to_linear(-6.0)).abs() < 1e-6);
    }

    #[test]
    fn dsp_runtime_replay_gain_updates_gain_linear() {
        let runtime = DspRuntime::new();
        let _ = runtime.apply_chain(&[DspNodeConfig::Gain { db: 0.0 }]);

        let replay_gain_db = runtime.set_replay_gain_db(-6.0);
        assert!((replay_gain_db + 6.0).abs() < 1e-6);

        let snapshot = runtime.snapshot();
        assert!((snapshot.gain_db - 0.0).abs() < 1e-6);
        assert!((snapshot.replay_gain_db + 6.0).abs() < 1e-6);
        assert!((snapshot.gain_linear - gain_db_to_linear(-6.0)).abs() < 1e-6);

        let _ = runtime.apply_chain(&[DspNodeConfig::Gain { db: 3.0 }]);
        let snapshot = runtime.snapshot();
        assert!((snapshot.gain_db - 3.0).abs() < 1e-6);
        assert!((snapshot.replay_gain_db + 6.0).abs() < 1e-6);
        assert!((snapshot.gain_linear - gain_db_to_linear(-3.0)).abs() < 1e-6);
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
            gain_db,
            replay_gain_db: 0.0,
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
            gain_db: 0.0,
            replay_gain_db: 0.0,
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
}
