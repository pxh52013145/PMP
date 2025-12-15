use once_cell::sync::Lazy;
use rodio::{
    buffer::SamplesBuffer, decoder::Decoder, OutputStream, OutputStreamHandle, Sink, Source,
};
use serde::Serialize;
use std::{
    fs::File,
    io::BufReader,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
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

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct NativeAudioStatePayload {
    playback_state: String,
    volume: f32,
    muted: bool,
    current_track: Option<String>,
    current_time: f64,
}

struct NativeAudioEngine {
    stream_handle: Option<OutputStreamHandle>,
    sink: Option<Sink>,
    current_track: Option<PathBuf>,
    current_position: f64,
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
            current_position: 0.0,
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
            Ok(buffer) => sink.append(buffer),
            Err(err) => {
                eprintln!(
                    "[NativeAudio] Symphonia decode failed, falling back to rodio decoder: {err}"
                );
                let file = File::open(&path).map_err(|e| format!("Failed to open file: {e}"))?;
                let decoder = Decoder::new(BufReader::new(file))
                    .map_err(|e| format!("Failed to decode audio file: {e}"))?;
                sink.append(decoder.convert_samples::<f32>());
            }
        }
        sink.pause();
        sink.set_volume(if self.muted { 0.0 } else { self.volume });

        self.stream_handle = Some(stream_handle);
        self.sink = Some(sink);
        self.current_track = Some(path);
        self.current_position = 0.0;
        self.set_state(PlaybackState::Paused);

        std::mem::forget(stream);
        Ok(())
    }

    fn play(&mut self) -> Result<(), String> {
        if let Some(sink) = &self.sink {
            sink.play();
            self.set_state(PlaybackState::Playing);
            Ok(())
        } else {
            Err("No track loaded".into())
        }
    }

    fn pause(&mut self) -> Result<(), String> {
        if let Some(sink) = &self.sink {
            sink.pause();
            self.set_state(PlaybackState::Paused);
            Ok(())
        } else {
            Err("No track loaded".into())
        }
    }

    fn stop(&mut self) {
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
        self.stream_handle = None;
        self.current_track = None;
        self.current_position = 0.0;
        self.set_state(PlaybackState::Stopped);
    }

    fn seek(&mut self, seconds: f64) -> Result<(), String> {
        let track_path = self
            .current_track
            .clone()
            .ok_or_else(|| "No track loaded".to_string())?;
        let stream_handle = self
            .stream_handle
            .as_ref()
            .ok_or_else(|| "Audio stream not initialized".to_string())?;
        let target = seconds.max(0.0);
        let file = File::open(&track_path).map_err(|e| format!("Failed to open file: {e}"))?;
        let decoder = Decoder::new(BufReader::new(file))
            .map_err(|e| format!("Failed to decode audio file: {e}"))?;
        let skipped = decoder.skip_duration(Duration::from_secs_f64(target));
        let sink =
            Sink::try_new(stream_handle).map_err(|e| format!("Failed to create sink: {e}"))?;
        sink.append(skipped);
        sink.pause();
        sink.set_volume(if self.muted { 0.0 } else { self.volume });

        let resume_playing = matches!(self.playback_state, PlaybackState::Playing);
        if resume_playing {
            sink.play();
        }

        if let Some(old_sink) = self.sink.replace(sink) {
            old_sink.stop();
        }

        self.current_position = target;
        Ok(())
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

    fn emit_state(&self, app_handle: &AppHandle) -> Result<(), String> {
        let payload = NativeAudioStatePayload {
            playback_state: self.playback_state.as_str().to_string(),
            volume: self.volume,
            muted: self.muted,
            current_track: self
                .current_track
                .as_ref()
                .and_then(|path| path.to_str().map(|s| s.to_string())),
            current_time: self.current_position,
        };

        app_handle
            .emit_all("native_audio_state", payload)
            .map_err(|e| format!("Failed to emit state: {e}"))
    }
}

pub fn load(app_handle: &AppHandle, path: Option<String>) -> Result<(), String> {
    let track_path = path.ok_or_else(|| "No path provided".to_string())?;
    let mut engine = ENGINE
        .lock()
        .map_err(|_| "Audio engine is locked".to_string())?;
    engine.set_state(PlaybackState::Loading);
    match engine.load(PathBuf::from(&track_path)) {
        Ok(()) => {
            engine.emit_state(app_handle)?;
            Ok(())
        }
        Err(err) => {
            engine.set_state(PlaybackState::Error);
            engine.emit_state(app_handle)?;
            Err(err)
        }
    }
}

pub fn play(app_handle: &AppHandle) -> Result<(), String> {
    let mut engine = ENGINE
        .lock()
        .map_err(|_| "Audio engine is locked".to_string())?;
    let result = engine.play();
    engine.emit_state(app_handle)?;
    result
}

pub fn pause(app_handle: &AppHandle) -> Result<(), String> {
    let mut engine = ENGINE
        .lock()
        .map_err(|_| "Audio engine is locked".to_string())?;
    let result = engine.pause();
    engine.emit_state(app_handle)?;
    result
}

pub fn stop(app_handle: &AppHandle) -> Result<(), String> {
    let mut engine = ENGINE
        .lock()
        .map_err(|_| "Audio engine is locked".to_string())?;
    engine.stop();
    engine.emit_state(app_handle)?;
    Ok(())
}

pub fn seek(app_handle: &AppHandle, time: f64) -> Result<(), String> {
    let mut engine = ENGINE
        .lock()
        .map_err(|_| "Audio engine is locked".to_string())?;
    engine.seek(time)?;
    engine.emit_state(app_handle)?;
    Ok(())
}

fn decode_track_to_buffer(path: &Path) -> Result<SamplesBuffer<f32>, String> {
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

    Ok(SamplesBuffer::new(channels as u16, sample_rate, samples))
}

pub fn set_volume(app_handle: &AppHandle, volume: f32) -> Result<(), String> {
    let clamped = volume.clamp(0.0, 1.0);
    let mut engine = ENGINE
        .lock()
        .map_err(|_| "Audio engine is locked".to_string())?;
    engine.set_volume(clamped);
    engine.emit_state(app_handle)?;
    Ok(())
}

pub fn set_mute(app_handle: &AppHandle, muted: bool) -> Result<(), String> {
    let mut engine = ENGINE
        .lock()
        .map_err(|_| "Audio engine is locked".to_string())?;
    engine.set_mute(muted);
    engine.emit_state(app_handle)?;
    Ok(())
}
