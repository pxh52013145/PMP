use once_cell::sync::{Lazy, OnceCell};
use rodio::{decoder::Decoder, OutputStream, OutputStreamHandle, Sink, Source};
use rustfft::{num_complex::Complex, FftPlanner};
use serde::Serialize;
use std::{
    fs::File,
    io::BufReader,
    path::{Path, PathBuf},
    sync::Arc,
    sync::Mutex,
    time::{Duration, Instant},
};
use symphonia::core::{
    audio::SampleBuffer,
    codecs::DecoderOptions,
    errors::Error as SymphoniaError,
    formats::FormatOptions,
    io::{MediaSourceStream, MediaSourceStreamOptions},
    meta::MetadataOptions,
    probe::Hint,
};
use tauri::AppHandle;
use tauri::Manager;

static ENGINE: Lazy<Mutex<NativeAudioEngine>> = Lazy::new(|| Mutex::new(NativeAudioEngine::new()));
static APP_HANDLE: OnceCell<AppHandle> = OnceCell::new();
static EMITTER_STARTED: OnceCell<()> = OnceCell::new();

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct NativeAudioStatePayload {
    playback_state: String,
    volume: f32,
    muted: bool,
    track_path: Option<String>,
    current_time: f64,
    duration: f64,
    sample_rate: Option<u32>,
    queue: Option<Vec<String>>,
    current_index: Option<i32>,
    ended: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct NativeAudioSpectrumPayload {
    bins: Vec<f32>,
}

struct NativeAudioEngine {
    stream_handle: Option<OutputStreamHandle>,
    sink: Option<Sink>,
    current_track: Option<PathBuf>,
    queue: Vec<PathBuf>,
    current_index: i32,
    queue_initialized: bool,
    current_position: f64,
    duration: f64,
    base_position: f64,
    playback_started_at: Option<Instant>,
    decoded_samples: Option<Arc<Vec<f32>>>,
    decoded_channels: u16,
    decoded_sample_rate: u32,
    volume: f32,
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
            current_position: 0.0,
            duration: 0.0,
            base_position: 0.0,
            playback_started_at: None,
            decoded_samples: None,
            decoded_channels: 0,
            decoded_sample_rate: 0,
            volume: 0.7,
            muted: false,
            playback_state: PlaybackState::Idle,
        }
    }

    fn set_state(&mut self, state: PlaybackState) {
        self.playback_state = state;
    }

    fn load(&mut self, path: PathBuf) -> Result<(), String> {
        self.stop();
        let (stream, stream_handle) =
            OutputStream::try_default().map_err(|e| format!("Failed to init output: {e}"))?;
        let sink =
            Sink::try_new(&stream_handle).map_err(|e| format!("Failed to create sink: {e}"))?;

        match decode_track_to_buffer(&path) {
            Ok(decoded) => {
                self.duration = decoded.duration;
                self.decoded_samples = Some(decoded.samples.clone());
                self.decoded_channels = decoded.channels;
                self.decoded_sample_rate = decoded.sample_rate;
                sink.append(decoded.source);
            }
            Err(err) => {
                eprintln!(
                    "[NativeAudio] Symphonia decode failed, falling back to rodio decoder: {err}"
                );
                let file = File::open(&path).map_err(|e| format!("Failed to open file: {e}"))?;
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
            }
        }
        sink.pause();
        sink.set_volume(if self.muted { 0.0 } else { self.volume });

        self.stream_handle = Some(stream_handle);
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

        std::mem::forget(stream);
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
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
        self.stream_handle = None;
        self.current_track = None;
        self.current_position = 0.0;
        self.duration = 0.0;
        self.base_position = 0.0;
        self.decoded_samples = None;
        self.decoded_channels = 0;
        self.decoded_sample_rate = 0;
        self.set_state(PlaybackState::Stopped);
    }

    fn sync_queue_state(&mut self, queue: Vec<PathBuf>, current_index: i32) {
        self.queue_initialized = true;
        self.queue = queue;
        let max_index = (self.queue.len() as i32).saturating_sub(1);
        self.current_index = current_index.clamp(-1, max_index);
    }

    fn seek(&mut self, seconds: f64) -> Result<(), String> {
        self.sync_clock();
        let track_path = self
            .current_track
            .clone()
            .ok_or_else(|| "No track loaded".to_string())?;
        let stream_handle = self
            .stream_handle
            .as_ref()
            .ok_or_else(|| "Audio stream not initialized".to_string())?;
        let target = seconds.max(0.0);
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

        let resume_playing = matches!(self.playback_state, PlaybackState::Playing);
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
        let samples = self.decoded_samples.as_ref()?.clone();
        if self.decoded_channels == 0 || self.decoded_sample_rate == 0 {
            return None;
        }
        Some(SpectrumSnapshot {
            samples,
            channels: self.decoded_channels,
            sample_rate: self.decoded_sample_rate,
            current_time: self.current_position.max(0.0),
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
        if !self.muted {
            if let Some(sink) = &self.sink {
                sink.set_volume(volume);
            }
        }
    }

    fn set_mute(&mut self, muted: bool) {
        self.muted = muted;
        if let Some(sink) = &self.sink {
            if muted {
                sink.set_volume(0.0);
            } else {
                sink.set_volume(self.volume);
            }
        }
    }

    fn build_state_payload(&self, ended: bool) -> NativeAudioStatePayload {
        NativeAudioStatePayload {
            playback_state: self.playback_state.as_str().to_string(),
            volume: self.volume,
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
    samples: Arc<Vec<f32>>,
    channels: u16,
    sample_rate: u32,
    current_time: f64,
}

fn compute_spectrum(
    fft: &std::sync::Arc<dyn rustfft::Fft<f32>>,
    snapshot: &SpectrumSnapshot,
) -> Option<NativeAudioSpectrumPayload> {
    let channels = snapshot.channels as usize;
    let sample_rate = snapshot.sample_rate as usize;
    if channels == 0 || sample_rate == 0 {
        return None;
    }

    let window_size = 1024usize;
    let start_frame = (snapshot.current_time * sample_rate as f64) as usize;
    let start_sample = start_frame.saturating_mul(channels);
    if start_sample >= snapshot.samples.len() {
        return None;
    }

    let mut input: Vec<Complex<f32>> = Vec::with_capacity(window_size);
    for frame in 0..window_size {
        let sample_index = start_sample + frame * channels;
        if sample_index + (channels - 1) >= snapshot.samples.len() {
            input.push(Complex::new(0.0, 0.0));
            continue;
        }
        let mut sum = 0.0f32;
        for channel in 0..channels {
            sum += snapshot.samples[sample_index + channel];
        }
        let mono = sum / channels as f32;
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
