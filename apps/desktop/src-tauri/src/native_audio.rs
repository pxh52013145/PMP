use once_cell::sync::{Lazy, OnceCell};
use rodio::{decoder::Decoder, OutputStream, OutputStreamHandle, Sink, Source};
use rodio::cpal::traits::{DeviceTrait, HostTrait};
use rustfft::{num_complex::Complex, FftPlanner};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    fs::File,
    io::BufReader,
    path::{Path, PathBuf},
    sync::Arc,
    sync::Condvar,
    sync::Mutex,
    sync::mpsc,
    time::{Duration, Instant},
};
use symphonia::core::{
    audio::SampleBuffer,
    codecs::DecoderOptions,
    errors::Error as SymphoniaError,
    formats::FormatOptions,
    formats::{SeekMode, SeekTo},
    io::{MediaSourceStream, MediaSourceStreamOptions},
    meta::MetadataOptions,
    probe::Hint,
    units::Time,
};
use tauri::AppHandle;
use tauri::Manager;

static ENGINE: Lazy<Mutex<NativeAudioEngine>> = Lazy::new(|| Mutex::new(NativeAudioEngine::new()));
static APP_HANDLE: OnceCell<AppHandle> = OnceCell::new();
static EMITTER_STARTED: OnceCell<()> = OnceCell::new();
static STREAM_STATE: Lazy<Mutex<StreamState>> = Lazy::new(|| Mutex::new(StreamState::default()));

#[derive(Default)]
struct StreamState {
    handle: Option<OutputStreamHandle>,
    device_name: Option<String>,
}

fn open_output_stream_handle(
    preferred_device_name: Option<&str>,
) -> Result<(OutputStreamHandle, Option<String>), String> {
    let host = rodio::cpal::default_host();

    if let Some(preferred) = preferred_device_name {
        let devices = host
            .output_devices()
            .map_err(|e| format!("Failed to enumerate output devices: {e}"))?;
        for device in devices {
            let Ok(name) = device.name() else {
                continue;
            };
            if name != preferred {
                continue;
            }
            let (stream, handle) = OutputStream::try_from_device(&device)
                .map_err(|e| format!("Failed to init output device '{preferred}': {e}"))?;
            std::mem::forget(stream);
            return Ok((handle, Some(name)));
        }
        return Err(format!("Output device not found: {preferred}"));
    }

    if let Some(device) = host.default_output_device() {
        let device_name = device.name().ok();
        if let Ok((stream, handle)) = OutputStream::try_from_device(&device) {
            std::mem::forget(stream);
            return Ok((handle, device_name));
        }
    }

    let devices = host
        .output_devices()
        .map_err(|e| format!("Failed to enumerate output devices: {e}"))?;
    for device in devices {
        let device_name = device.name().ok();
        if let Ok((stream, handle)) = OutputStream::try_from_device(&device) {
            std::mem::forget(stream);
            return Ok((handle, device_name));
        }
    }

    Err("No usable output device found".into())
}

fn ensure_stream_handle() -> Result<(OutputStreamHandle, Option<String>), String> {
    let mut state = STREAM_STATE
        .lock()
        .map_err(|_| "Audio stream state is locked".to_string())?;
    if let Some(handle) = state.handle.clone() {
        return Ok((handle, state.device_name.clone()));
    }

    let (handle, device_name) = open_output_stream_handle(state.device_name.as_deref())?;
    state.handle = Some(handle.clone());
    state.device_name = device_name.clone();
    Ok((handle, device_name))
}

fn default_output_device_name() -> Option<String> {
    rodio::cpal::default_host()
        .default_output_device()
        .and_then(|device| device.name().ok())
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct NativeAudioStatePayload {
    playback_state: String,
    volume: f32,
    gain_db: f32,
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
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct NativeAudioSpectrumPayload {
    bins: Vec<f32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum DspNodeConfig {
    Gain { db: f32 },
}

#[derive(Clone)]
struct AudioRingBuffer {
    inner: Arc<(Mutex<AudioRingBufferInner>, Condvar, Condvar)>,
}

struct AudioRingBufferInner {
    data: VecDeque<f32>,
    capacity: usize,
    finished: bool,
}

impl AudioRingBuffer {
    fn new(capacity: usize) -> Self {
        Self {
            inner: Arc::new((
                Mutex::new(AudioRingBufferInner {
                    data: VecDeque::with_capacity(capacity.min(65_536)),
                    capacity,
                    finished: false,
                }),
                Condvar::new(),
                Condvar::new(),
            )),
        }
    }

    fn clear(&self) {
        let (lock, _available, space) = &*self.inner;
        let mut inner = lock.lock().expect("ring buffer lock poisoned");
        inner.data.clear();
        inner.finished = false;
        space.notify_all();
    }

    fn mark_finished(&self) {
        let (lock, available, _space) = &*self.inner;
        let mut inner = lock.lock().expect("ring buffer lock poisoned");
        inner.finished = true;
        available.notify_all();
    }

    fn pop_sample(&self) -> Option<f32> {
        let (lock, _available, space) = &*self.inner;
        let mut inner = lock.lock().expect("ring buffer lock poisoned");
        let sample = inner.data.pop_front();
        if sample.is_some() {
            space.notify_one();
        }
        sample
    }

    fn is_finished_and_empty(&self) -> bool {
        let (lock, _available, _space) = &*self.inner;
        let inner = lock.lock().expect("ring buffer lock poisoned");
        inner.finished && inner.data.is_empty()
    }

    fn push_interleaved(&self, samples: &[f32], channels: usize) -> usize {
        if channels == 0 {
            return 0;
        }
        let total_frames = samples.len() / channels;
        if total_frames == 0 {
            return 0;
        }

        let (lock, available, space) = &*self.inner;
        let mut inner = match lock.lock() {
            Ok(inner) => inner,
            Err(_) => return 0,
        };

        let mut free_samples = inner.capacity.saturating_sub(inner.data.len());
        if free_samples < channels {
            let (guard, timeout) = match space.wait_timeout(inner, Duration::from_millis(10)) {
                Ok(value) => value,
                Err(_) => return 0,
            };
            inner = guard;
            if timeout.timed_out() {
                return 0;
            }
            free_samples = inner.capacity.saturating_sub(inner.data.len());
            if free_samples < channels {
                return 0;
            }
        }

        let free_frames = free_samples / channels;
        let frames_to_push = free_frames.min(total_frames);
        let samples_to_push = frames_to_push * channels;
        inner
            .data
            .extend(samples.iter().take(samples_to_push).copied());
        available.notify_all();
        frames_to_push
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

struct StreamingPlayback {
    buffer: AudioRingBuffer,
    tap: SpectrumTap,
    command_tx: mpsc::Sender<DecoderCommand>,
}

enum DecoderCommand {
    Seek(f64),
    Shutdown,
}

struct DecoderMeta {
    channels: u16,
    sample_rate: u32,
    bit_depth: Option<u32>,
    duration: f64,
}

#[derive(Clone)]
struct StreamingSamplesSource {
    buffer: AudioRingBuffer,
    channels: u16,
    sample_rate: u32,
    duration: f64,
}

impl StreamingSamplesSource {
    fn new(buffer: AudioRingBuffer, channels: u16, sample_rate: u32, duration: f64) -> Self {
        Self {
            buffer,
            channels,
            sample_rate,
            duration,
        }
    }
}

impl Iterator for StreamingSamplesSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.buffer.is_finished_and_empty() {
            return None;
        }
        match self.buffer.pop_sample() {
            Some(sample) => Some(sample),
            None => Some(0.0),
        }
    }
}

impl Source for StreamingSamplesSource {
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
        if self.duration > 0.0 {
            Some(Duration::from_secs_f64(self.duration))
        } else {
            None
        }
    }
}

struct NativeAudioEngine {
    stream_handle: Option<OutputStreamHandle>,
    sink: Option<Sink>,
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
    device_name: Option<String>,
    volume: f32,
    gain_db: f32,
    dsp_chain: Vec<DspNodeConfig>,
    muted: bool,
    playback_state: PlaybackState,
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
        Self {
            stream_handle: None,
            sink: None,
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
            device_name: None,
            volume: 0.7,
            gain_db: 0.0,
            dsp_chain: Vec::new(),
            muted: false,
            playback_state: PlaybackState::Idle,
        }
    }

    fn gain_linear(&self) -> f32 {
        let db = self.gain_db.clamp(-60.0, 12.0);
        10.0f32.powf(db / 20.0)
    }

    fn effective_volume(&self) -> f32 {
        if self.muted {
            0.0
        } else {
            (self.volume * self.gain_linear()).clamp(0.0, 4.0)
        }
    }

    fn apply_effective_volume(&self) {
        if let Some(sink) = &self.sink {
            sink.set_volume(self.effective_volume());
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
        self.sync_clock();
        if let Some(old_sink) = self.sink.take() {
            old_sink.stop();
        }
        self.shutdown_streaming();

        if self.stream_handle.is_none() {
            let (handle, device_name) = ensure_stream_handle()?;
            self.stream_handle = Some(handle);
            self.device_name = device_name.or_else(default_output_device_name);
        }

        let stream_handle = self
            .stream_handle
            .as_ref()
            .ok_or_else(|| "Audio stream not initialized".to_string())?;
        let sink =
            Sink::try_new(stream_handle).map_err(|e| format!("Failed to create sink: {e}"))?;

        let mut used_streaming = false;
        if let Ok((source, meta, streaming)) = start_symphonia_stream(&path) {
            used_streaming = true;
            self.duration = meta.duration;
            self.decoded_samples = None;
            self.decoded_channels = meta.channels;
            self.decoded_sample_rate = meta.sample_rate;
            self.decoded_bit_depth = meta.bit_depth;
            sink.append(source);
            self.streaming = Some(streaming);
        }

        if !used_streaming {
            match decode_track_to_buffer(&path) {
                Ok(decoded) => {
                    self.duration = decoded.duration;
                    self.decoded_samples = Some(decoded.samples.clone());
                    self.decoded_channels = decoded.channels;
                    self.decoded_sample_rate = decoded.sample_rate;
                    self.decoded_bit_depth = decoded.bit_depth;
                    sink.append(decoded.source);
                }
                Err(err) => {
                    eprintln!(
                        "[NativeAudio] Symphonia decode failed, falling back to rodio decoder: {err}"
                    );
                    let file =
                        File::open(&path).map_err(|e| format!("Failed to open file: {e}"))?;
                    let decoder = Decoder::new(BufReader::new(file))
                        .map_err(|e| format!("Failed to decode audio file: {e}"))?;
                    self.duration = decoder
                        .total_duration()
                        .map(|duration| duration.as_secs_f64())
                        .unwrap_or(0.0);
                    sink.append(decoder.convert_samples::<f32>());
                    self.decoded_samples = None;
                    self.decoded_channels = 0;
                    self.decoded_sample_rate = 0;
                    self.decoded_bit_depth = None;
                }
            }
        }

        if self.device_name.is_none() {
            self.device_name = default_output_device_name();
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

    fn play(&mut self) -> Result<(), String> {
        if let Some(sink) = &self.sink {
            sink.play();
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
            self.sync_clock();
            self.set_state(PlaybackState::Paused);
            Ok(())
        } else {
            Err("No track loaded".into())
        }
    }

    fn stop(&mut self) {
        self.sync_clock();

        if let Some(streaming) = &self.streaming {
            streaming.buffer.clear();
            streaming.tap.clear();
            let _ = streaming.command_tx.send(DecoderCommand::Seek(0.0));
            if let Some(sink) = &self.sink {
                sink.pause();
            }
        } else if self.current_track.is_some() && self.stream_handle.is_some() {
            let track_path = self.current_track.clone().expect("checked is_some");
            let stream_handle = self
                .stream_handle
                .as_ref()
                .ok_or_else(|| "Audio stream not initialized".to_string())
                .ok();

            if let Some(stream_handle) = stream_handle {
                if let Ok(sink) = Sink::try_new(stream_handle) {
                    if let (Some(samples), channels, sample_rate) = (
                        self.decoded_samples.clone(),
                        self.decoded_channels,
                        self.decoded_sample_rate,
                    ) {
                        sink.append(SharedSamplesSource::new(samples, channels, sample_rate, 0));
                    } else if let Ok(file) = File::open(&track_path) {
                        if let Ok(decoder) = Decoder::new(BufReader::new(file)) {
                            sink.append(decoder.convert_samples::<f32>());
                        }
                    }
                    sink.pause();
                    sink.set_volume(self.effective_volume());
                    if let Some(old) = self.sink.replace(sink) {
                        old.stop();
                    }
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
            self.sync_clock();
            if let Some(sink) = self.sink.take() {
                sink.stop();
            }
            self.shutdown_streaming();
            self.current_track = None;
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
        self.sync_clock();
        let track_path = self
            .current_track
            .clone()
            .ok_or_else(|| "No track loaded".to_string())?;
        let target = seconds.max(0.0);
        let resume_playing = matches!(self.playback_state, PlaybackState::Playing);

        if let Some(streaming) = &self.streaming {
            streaming.buffer.clear();
            streaming.tap.clear();
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

        let stream_handle = self
            .stream_handle
            .as_ref()
            .ok_or_else(|| "Audio stream not initialized".to_string())?;
        let sink = Sink::try_new(stream_handle).map_err(|e| format!("Failed to create sink: {e}"))?;

        if let (Some(samples), channels, sample_rate) = (
            self.decoded_samples.clone(),
            self.decoded_channels,
            self.decoded_sample_rate,
        ) {
            let start_sample = ((target * sample_rate as f64) as usize) * channels as usize;
            let source = SharedSamplesSource::new(samples, channels, sample_rate, start_sample);
            sink.append(source);
        } else {
            let file = File::open(&track_path).map_err(|e| format!("Failed to open file: {e}"))?;
            let decoder = Decoder::new(BufReader::new(file))
                .map_err(|e| format!("Failed to decode audio file: {e}"))?;
            let skipped = decoder.skip_duration(Duration::from_secs_f64(target));
            sink.append(skipped);
        }
        sink.pause();
        sink.set_volume(if self.muted { 0.0 } else { self.volume });

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
        if let Some(streaming) = &self.streaming {
            let (window, sample_rate) = streaming.tap.snapshot()?;
            return Some(SpectrumSnapshot { sample_rate, window });
        }

        let samples = self.decoded_samples.as_ref()?.clone();
        if self.decoded_channels == 0 || self.decoded_sample_rate == 0 {
            return None;
        }

        let channels = self.decoded_channels as usize;
        let sample_rate = self.decoded_sample_rate;
        let window_size = 1024usize;
        let start_sample =
            ((self.current_position.max(0.0) * sample_rate as f64) as usize) * channels;

        let mut window = Vec::with_capacity(window_size);
        for frame in 0..window_size {
            let idx = start_sample + frame * channels;
            if idx + channels.saturating_sub(1) >= samples.len() {
                window.push(0.0);
                continue;
            }
            let mut sum = 0.0f32;
            for ch in 0..channels {
                sum += samples[idx + ch];
            }
            window.push(sum / channels as f32);
        }

        Some(SpectrumSnapshot { sample_rate, window })
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
        self.dsp_chain = vec![DspNodeConfig::Gain { db: self.gain_db }];
        self.apply_effective_volume();
    }

    fn set_dsp_chain(&mut self, chain: Vec<DspNodeConfig>) {
        let mut gain_db = 0.0;
        for node in &chain {
            match node {
                DspNodeConfig::Gain { db } => gain_db += *db,
            }
        }
        self.dsp_chain = chain;
        self.gain_db = gain_db.clamp(-60.0, 12.0);
        self.apply_effective_volume();
    }

    fn build_state_payload(&self, ended: bool) -> NativeAudioStatePayload {
        NativeAudioStatePayload {
            playback_state: self.playback_state.as_str().to_string(),
            volume: self.volume,
            gain_db: self.gain_db,
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
        }
    }

    fn rebuild_sink_on_new_device(&mut self) -> Result<(), String> {
        let Some(track_path) = self.current_track.clone() else {
            return Ok(());
        };
        let stream_handle = self
            .stream_handle
            .as_ref()
            .ok_or_else(|| "Audio stream not initialized".to_string())?
            .clone();

        let target = self.current_position.max(0.0);
        let resume_playing = matches!(self.playback_state, PlaybackState::Playing);

        self.sync_clock();
        if let Some(old_sink) = self.sink.take() {
            old_sink.stop();
        }

        let sink =
            Sink::try_new(&stream_handle).map_err(|e| format!("Failed to create sink: {e}"))?;

        if let Some(streaming) = &self.streaming {
            streaming.buffer.clear();
            streaming.tap.clear();
            let _ = streaming.command_tx.send(DecoderCommand::Seek(target));
            let source = StreamingSamplesSource::new(
                streaming.buffer.clone(),
                self.decoded_channels.max(1),
                self.decoded_sample_rate.max(1),
                self.duration,
            );
            sink.append(source);
        } else if let Some(samples) = self.decoded_samples.clone() {
            let channels = self.decoded_channels.max(1);
            let sample_rate = self.decoded_sample_rate.max(1);
            let start_sample = ((target * sample_rate as f64) as usize) * channels as usize;
            sink.append(SharedSamplesSource::new(samples, channels, sample_rate, start_sample));
        } else {
            let file = File::open(&track_path).map_err(|e| format!("Failed to open file: {e}"))?;
            let decoder = Decoder::new(BufReader::new(file))
                .map_err(|e| format!("Failed to decode audio file: {e}"))?;
            let skipped = decoder.skip_duration(Duration::from_secs_f64(target));
            sink.append(skipped);
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

fn emit_spectrum(app_handle: &AppHandle, payload: NativeAudioSpectrumPayload) -> Result<(), String> {
    app_handle
        .emit_all("native_audio_spectrum", payload)
        .map_err(|e| format!("Failed to emit spectrum: {e}"))
}

#[derive(Clone)]
struct SharedSamplesSource {
    samples: Arc<Vec<f32>>,
    channels: u16,
    sample_rate: u32,
    position: usize,
}

impl SharedSamplesSource {
    fn new(samples: Arc<Vec<f32>>, channels: u16, sample_rate: u32, position: usize) -> Self {
        Self {
            samples,
            channels,
            sample_rate,
            position,
        }
    }

    fn compute_total_duration(&self) -> Option<Duration> {
        let channels = self.channels as usize;
        if channels == 0 || self.sample_rate == 0 {
            return None;
        }
        let frames = self.samples.len() / channels;
        Some(Duration::from_secs_f64(frames as f64 / self.sample_rate as f64))
    }
}

impl Iterator for SharedSamplesSource {
    type Item = f32;
    fn next(&mut self) -> Option<Self::Item> {
        if self.position >= self.samples.len() {
            return None;
        }
        let out = self.samples[self.position];
        self.position += 1;
        Some(out)
    }
}

impl Source for SharedSamplesSource {
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
        self.compute_total_duration()
    }
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
        let avg = if end > start { acc / (end - start) as f32 } else { 0.0 };
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

fn start_symphonia_stream(
    path: &Path,
) -> Result<(StreamingSamplesSource, DecoderMeta, StreamingPlayback), String> {
    let buffer = AudioRingBuffer::new(352_800);
    let tap = SpectrumTap::new(1024);

    let (command_tx, command_rx) = mpsc::channel::<DecoderCommand>();
    let (meta_tx, meta_rx) = mpsc::channel::<Result<DecoderMeta, String>>();

    let path = path.to_path_buf();
    let buffer_clone = buffer.clone();
    let tap_clone = tap.clone();

    std::thread::spawn(move || {
        let init = (|| -> Result<(Box<dyn symphonia::core::formats::FormatReader>, symphonia::core::formats::Track), String> {
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
            let track = format
                .default_track()
                .ok_or_else(|| "No audio track found".to_string())?
                .clone();
            Ok((format, track))
        })();

        let (mut format, track) = match init {
            Ok(value) => value,
            Err(err) => {
                let _ = meta_tx.send(Err(err));
                buffer_clone.mark_finished();
                return;
            }
        };

        let sample_rate = track.codec_params.sample_rate.unwrap_or(44_100);
        let channels = track
            .codec_params
            .channels
            .map(|ch| ch.count() as u16)
            .unwrap_or(2);
        let bit_depth = track
            .codec_params
            .bits_per_sample
            .or(track.codec_params.bits_per_coded_sample);
        let duration = track
            .codec_params
            .n_frames
            .map(|frames| frames as f64 / sample_rate as f64)
            .unwrap_or(0.0);

        let _ = meta_tx.send(Ok(DecoderMeta {
            channels,
            sample_rate,
            bit_depth,
            duration,
        }));
        tap_clone.set_sample_rate(sample_rate);

        let track_id = track.id;
        let mut decoder = match symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
        {
            Ok(decoder) => decoder,
            Err(_) => {
                buffer_clone.mark_finished();
                return;
            }
        };

        let mut sample_buf: Option<SampleBuffer<f32>> = None;
        let mut pending_trim_frames: usize = 0;

        'decode_loop: loop {
            while let Ok(cmd) = command_rx.try_recv() {
                match cmd {
                    DecoderCommand::Shutdown => {
                        buffer_clone.mark_finished();
                        return;
                    }
                    DecoderCommand::Seek(target) => {
                        buffer_clone.clear();
                        tap_clone.clear();
                        pending_trim_frames = 0;

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
                                pending_trim_frames = (delta * sample_rate as f64) as usize;
                            }

                            decoder = match symphonia::default::get_codecs()
                                .make(&track.codec_params, &DecoderOptions::default())
                            {
                                Ok(decoder) => decoder,
                                Err(_) => {
                                    buffer_clone.mark_finished();
                                    return;
                                }
                            };
                            sample_buf = None;
                        }
                    }
                }
            }

            let packet = match format.next_packet() {
                Ok(packet) => packet,
                Err(SymphoniaError::IoError(err))
                    if err.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    buffer_clone.mark_finished();
                    return;
                }
                Err(SymphoniaError::ResetRequired) => {
                    buffer_clone.mark_finished();
                    return;
                }
                Err(_) => {
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
                        sample_buf = Some(SampleBuffer::<f32>::new(decoded.capacity() as u64, spec));
                    }

                    if let Some(buf) = &mut sample_buf {
                        buf.copy_interleaved_ref(decoded);
                        let channels = spec.channels.count().max(1);
                        let all = buf.samples();
                        let total_frames = all.len() / channels;
                        let mut start_frame = 0usize;
                        if pending_trim_frames > 0 {
                            let trim_now = pending_trim_frames.min(total_frames);
                            start_frame = trim_now;
                            pending_trim_frames = pending_trim_frames.saturating_sub(trim_now);
                        }
                        let start_index = start_frame * channels;
                        if start_index < all.len() {
                            let slice = &all[start_index..];
                            let mut offset = 0usize;
                            while offset < slice.len() {
                                if let Ok(cmd) = command_rx.try_recv() {
                                    match cmd {
                                        DecoderCommand::Shutdown => {
                                            buffer_clone.mark_finished();
                                            return;
                                        }
                                        DecoderCommand::Seek(target) => {
                                            buffer_clone.clear();
                                            tap_clone.clear();
                                            pending_trim_frames = 0;

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
                                                    pending_trim_frames = (delta * sample_rate as f64) as usize;
                                                }

                                                decoder = match symphonia::default::get_codecs()
                                                    .make(&track.codec_params, &DecoderOptions::default())
                                                {
                                                    Ok(decoder) => decoder,
                                                    Err(_) => {
                                                        buffer_clone.mark_finished();
                                                        return;
                                                    }
                                                };
                                                sample_buf = None;
                                            }

                                            continue 'decode_loop;
                                        }
                                    }
                                }

                                let remaining = &slice[offset..];
                                let frames_pushed = buffer_clone.push_interleaved(remaining, channels);
                                if frames_pushed == 0 {
                                    continue;
                                }
                                let pushed_samples = frames_pushed * channels;
                                let pushed = &remaining[..pushed_samples];
                                tap_clone.push_interleaved(pushed, channels);
                                offset += pushed_samples;
                            }
                        }
                    }
                }
                Err(SymphoniaError::DecodeError(_)) => continue,
                Err(SymphoniaError::IoError(err))
                    if err.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    buffer_clone.mark_finished();
                    return;
                }
                Err(_) => {
                    buffer_clone.mark_finished();
                    return;
                }
            }
        }
    });

    let meta = meta_rx
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "Timed out initializing decoder".to_string())??;

    Ok((
        StreamingSamplesSource::new(buffer.clone(), meta.channels, meta.sample_rate, meta.duration),
        meta,
        StreamingPlayback {
            buffer,
            tap,
            command_tx,
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
                Some((engine.build_state_payload(ended), engine.snapshot_for_spectrum()))
            })() else {
                continue;
            };

            let _ = emit_state(&app_handle, state_payload);
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
        engine.set_state(PlaybackState::Loading);
        match engine.load(PathBuf::from(&track_path)) {
            Ok(()) => Ok(engine.build_state_payload(false)),
            Err(err) => {
                engine.set_state(PlaybackState::Error);
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
            emit_state(app_handle, payload)?;
            Err(err)
        }
    }
}

pub fn play(app_handle: &AppHandle) -> Result<(), String> {
    init_emitter(app_handle);
    let (result, payload) = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        let result = engine.play();
        (result, engine.build_state_payload(false))
    };
    emit_state(app_handle, payload)?;
    result
}

pub fn pause(app_handle: &AppHandle) -> Result<(), String> {
    init_emitter(app_handle);
    let (result, payload) = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        let result = engine.pause();
        (result, engine.build_state_payload(false))
    };
    emit_state(app_handle, payload)?;
    result
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
    emit_state(app_handle, payload)?;
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
        let result = engine.seek(time);
        (result, engine.build_state_payload(false))
    };
    emit_state(app_handle, payload)?;
    result?;
    Ok(())
}

struct DecodedAudioBuffer {
    source: SharedSamplesSource,
    samples: Arc<Vec<f32>>,
    channels: u16,
    sample_rate: u32,
    bit_depth: Option<u32>,
    duration: f64,
}

fn decode_track_to_buffer(path: &Path) -> Result<DecodedAudioBuffer, String> {
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
    let track = format
        .default_track()
        .ok_or_else(|| "No audio track found".to_string())?;
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

pub fn set_dsp_chain(app_handle: &AppHandle, chain: Vec<DspNodeConfig>) -> Result<(), String> {
    init_emitter(app_handle);
    let payload = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;
        engine.set_dsp_chain(chain);
        engine.build_state_payload(false)
    };
    emit_state(app_handle, payload)?;
    Ok(())
}

pub fn list_output_devices() -> Result<Vec<String>, String> {
    let host = rodio::cpal::default_host();
    let devices = host
        .output_devices()
        .map_err(|e| format!("Failed to enumerate output devices: {e}"))?;

    let mut names = Vec::new();
    for device in devices {
        if let Ok(name) = device.name() {
            names.push(name);
        }
    }
    names.sort();
    names.dedup();
    Ok(names)
}

pub fn select_output_device(app_handle: &AppHandle, device_name: Option<String>) -> Result<(), String> {
    init_emitter(app_handle);

    let (handle, resolved_name) = open_output_stream_handle(device_name.as_deref())?;
    {
        let mut state = STREAM_STATE
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?;
        state.handle = Some(handle.clone());
        state.device_name = device_name.clone();
    }

    let payload = {
        let mut engine = ENGINE
            .lock()
            .map_err(|_| "Audio engine is locked".to_string())?;

        engine.sync_clock();
        engine.stream_handle = Some(handle);
        engine.device_name = resolved_name
            .or(device_name)
            .or_else(default_output_device_name);

        engine
            .rebuild_sink_on_new_device()
            .unwrap_or_else(|err| {
                eprintln!("[NativeAudio] Failed to rebuild sink after device change: {err}");
            });

        engine.build_state_payload(false)
    };

    emit_state(app_handle, payload)?;
    Ok(())
}
