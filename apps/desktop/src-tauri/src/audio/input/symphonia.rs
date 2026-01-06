use std::collections::VecDeque;
use std::fs::File;
use std::path::Path;
use std::sync::mpsc;
use std::sync::Arc;
use std::sync::Condvar;
use std::sync::Mutex;
use std::time::Duration;

use rodio::Source;
use symphonia::core::{
    audio::SampleBuffer,
    codecs::DecoderOptions,
    errors::Error as SymphoniaError,
    formats::FormatOptions,
    formats::{FormatReader, SeekMode, SeekTo, Track},
    io::{MediaSourceStream, MediaSourceStreamOptions},
    meta::MetadataOptions,
    probe::Hint,
    units::Time,
};

use super::{
    AudioInput, AudioInputError, AudioInputKind, AudioInputMeta, AudioInputOpenResult,
    SYMPHONIA_INPUT_ID,
};

#[derive(Clone)]
pub(crate) struct AudioRingBuffer {
    inner: Arc<(Mutex<AudioRingBufferInner>, Condvar, Condvar)>,
}

struct AudioRingBufferInner {
    data: VecDeque<f32>,
    capacity: usize,
    finished: bool,
}

impl AudioRingBuffer {
    pub fn new(capacity: usize) -> Self {
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

    pub fn clear(&self) {
        let (lock, _available, space) = &*self.inner;
        let mut inner = lock.lock().expect("ring buffer lock poisoned");
        inner.data.clear();
        inner.finished = false;
        space.notify_all();
    }

    pub fn mark_finished(&self) {
        let (lock, available, _space) = &*self.inner;
        let mut inner = lock.lock().expect("ring buffer lock poisoned");
        inner.finished = true;
        available.notify_all();
    }

    pub fn len_samples(&self) -> usize {
        let (lock, _available, _space) = &*self.inner;
        let inner = lock.lock().expect("ring buffer lock poisoned");
        inner.data.len()
    }

    pub fn wait_for_samples(&self, min_samples: usize, timeout: Duration) {
        if min_samples == 0 {
            return;
        }

        let (lock, available, _space) = &*self.inner;
        let mut inner = lock.lock().expect("ring buffer lock poisoned");

        while inner.data.len() < min_samples && !inner.finished {
            let (guard, wait_result) = match available.wait_timeout(inner, timeout) {
                Ok(value) => value,
                Err(_) => break,
            };
            inner = guard;
            if wait_result.timed_out() {
                break;
            }
        }
    }

    pub fn pop_chunk(&self, max_samples: usize, wait_timeout: Duration) -> Vec<f32> {
        if max_samples == 0 {
            return Vec::new();
        }

        let (lock, available, space) = &*self.inner;
        let mut inner = lock.lock().expect("ring buffer lock poisoned");

        if inner.data.is_empty() && !inner.finished {
            inner = match available.wait_timeout(inner, wait_timeout) {
                Ok((guard, _)) => guard,
                Err(poisoned) => poisoned.into_inner().0,
            };
        }

        let count = inner.data.len().min(max_samples);
        if count == 0 {
            return Vec::new();
        }

        let mut out = Vec::with_capacity(count);
        for _ in 0..count {
            if let Some(sample) = inner.data.pop_front() {
                out.push(sample);
            } else {
                break;
            }
        }
        space.notify_all();
        out
    }

    pub fn is_finished_and_empty(&self) -> bool {
        let (lock, _available, _space) = &*self.inner;
        let inner = lock.lock().expect("ring buffer lock poisoned");
        inner.finished && inner.data.is_empty()
    }

    pub fn push_interleaved(&self, samples: &[f32], channels: usize) -> usize {
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

pub(crate) struct StreamingPlayback {
    pub buffer: AudioRingBuffer,
    pub command_tx: mpsc::Sender<DecoderCommand>,
    pub error: Arc<Mutex<Option<String>>>,
}

pub(crate) enum DecoderCommand {
    Seek(f64),
    Shutdown,
}

#[derive(Clone)]
pub(crate) struct StreamingSamplesSource {
    buffer: AudioRingBuffer,
    channels: u16,
    sample_rate: u32,
    duration: f64,
    local: Vec<f32>,
    local_index: usize,
}

impl StreamingSamplesSource {
    pub fn new(buffer: AudioRingBuffer, channels: u16, sample_rate: u32, duration: f64) -> Self {
        Self {
            buffer,
            channels,
            sample_rate,
            duration,
            local: Vec::new(),
            local_index: 0,
        }
    }
}

impl Iterator for StreamingSamplesSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.local_index >= self.local.len() {
            if self.buffer.is_finished_and_empty() {
                return None;
            }

            self.local = self.buffer.pop_chunk(8192, Duration::from_millis(20));
            self.local_index = 0;

            if self.local.is_empty() {
                if self.buffer.is_finished_and_empty() {
                    return None;
                }
                return Some(0.0);
            }
        }

        let sample = self.local[self.local_index];
        self.local_index += 1;
        Some(sample)
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

#[derive(Clone)]
pub(crate) struct SharedSamplesSource {
    samples: Arc<Vec<f32>>,
    channels: u16,
    sample_rate: u32,
    position: usize,
}

impl SharedSamplesSource {
    pub fn new(samples: Arc<Vec<f32>>, channels: u16, sample_rate: u32, position: usize) -> Self {
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
        Some(Duration::from_secs_f64(
            frames as f64 / self.sample_rate as f64,
        ))
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

fn track_is_audio_like(track: &Track) -> bool {
    track.codec_params.sample_rate.is_some()
        || track.codec_params.channels.is_some()
        || track.codec_params.bits_per_sample.is_some()
        || track.codec_params.bits_per_coded_sample.is_some()
}

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

fn start_symphonia_stream(
    path: &Path,
    output_sample_rate: Option<u32>,
) -> Result<(StreamingSamplesSource, AudioInputMeta, StreamingPlayback), AudioInputError> {
    let buffer = AudioRingBuffer::new(352_800);

    let (command_tx, command_rx) = mpsc::channel::<DecoderCommand>();
    let (meta_tx, meta_rx) = mpsc::channel::<Result<AudioInputMeta, String>>();

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
        let mut resampler: Option<crate::audio::resample::StreamingResampler> = None;
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
                                match crate::audio::resample::StreamingResampler::new(
                                    input_sample_rate,
                                    requested_sample_rate,
                                    channels_usize,
                                    resample_chunk_frames,
                                ) {
                                    Ok(instance) => {
                                        resampler = Some(instance);
                                        effective_sample_rate = requested_sample_rate;
                                    }
                                    Err(err) => {
                                        eprintln!(
                                            "[NativeAudio] Failed to init resampler, falling back: [{}] {}",
                                            err.code, err.message
                                        );
                                    }
                                }
                            }

                            let duration = track
                                .codec_params
                                .n_frames
                                .map(|frames| frames as f64 / input_sample_rate as f64)
                                .unwrap_or(0.0);
                            let _ = meta_tx.send(Ok(AudioInputMeta {
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
                            let mut offset = 0usize;
                            if let Some(resampler) = resampler.as_mut() {
                                out_interleaved = resampler.process_interleaved(slice);

                                let out_frames = out_interleaved.len() / channels_usize.max(1);
                                if pending_trim_frames_out > 0 && channels_usize > 0 {
                                    let trim_now = pending_trim_frames_out.min(out_frames);
                                    offset = trim_now * channels_usize;
                                    pending_trim_frames_out =
                                        pending_trim_frames_out.saturating_sub(trim_now);
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
        Ok(value) => value.map_err(|message| {
            AudioInputError::new("AUDIO_INPUT_SYMPHONIA_OPEN_FAILED", message)
        })?,
        Err(err) => {
            let _ = command_tx.send(DecoderCommand::Shutdown);
            return Err(AudioInputError::new(
                "AUDIO_INPUT_SYMPHONIA_OPEN_TIMEOUT",
                format!("Timed out initializing decoder: {err}"),
            ));
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

struct DecodedAudioBuffer {
    samples: Arc<Vec<f32>>,
    channels: u16,
    sample_rate: u32,
    bit_depth: Option<u32>,
    duration: f64,
}

fn decode_track_to_buffer(
    path: &Path,
    output_sample_rate: Option<u32>,
) -> Result<DecodedAudioBuffer, AudioInputError> {
    let cache_key = crate::audio::resample_cache::key_for_resample(path, output_sample_rate);
    if let Some(key) = cache_key.as_deref() {
        if let Some(cached) = crate::audio::resample_cache::try_load(key) {
            let frames = cached.samples.len() / cached.channels as usize;
            let duration = frames as f64 / cached.sample_rate as f64;
            return Ok(DecodedAudioBuffer {
                samples: cached.samples,
                channels: cached.channels,
                sample_rate: cached.sample_rate,
                bit_depth: cached.bit_depth,
                duration,
            });
        }
    }

    let file = File::open(path).map_err(|e| {
        AudioInputError::new(
            "AUDIO_INPUT_SYMPHONIA_OPEN_FAILED",
            format!("Failed to open file: {e}"),
        )
    })?;
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
        .map_err(|e| {
            AudioInputError::new(
                "AUDIO_INPUT_SYMPHONIA_PROBE_FAILED",
                format!("Failed to probe format: {e}"),
            )
        })?;
    let mut format = probed.format;
    let track = pick_audio_track(format.as_ref()).ok_or_else(|| {
        AudioInputError::new("AUDIO_INPUT_SYMPHONIA_NO_TRACK", "No audio track found")
    })?;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| {
            AudioInputError::new(
                "AUDIO_INPUT_SYMPHONIA_DECODE_FAILED",
                format!("Failed to create decoder: {e}"),
            )
        })?;

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
                return Err(AudioInputError::new(
                    "AUDIO_INPUT_SYMPHONIA_RESET_REQUIRED",
                    "Decoder reset required",
                ));
            }
            Err(err) => {
                return Err(AudioInputError::new(
                    "AUDIO_INPUT_SYMPHONIA_DECODE_FAILED",
                    format!("Failed to read packet: {err}"),
                ))
            }
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
            Err(err) => {
                return Err(AudioInputError::new(
                    "AUDIO_INPUT_SYMPHONIA_DECODE_FAILED",
                    format!("Failed to decode packet: {err}"),
                ))
            }
        }
    }

    if channels == 0 || samples.is_empty() {
        return Err(AudioInputError::new(
            "AUDIO_INPUT_SYMPHONIA_NO_SAMPLES",
            "No audio samples decoded",
        ));
    }

    let frames = samples.len() / channels;
    let duration = frames as f64 / sample_rate as f64;

    let target_sample_rate = output_sample_rate.unwrap_or(sample_rate);
    let (samples, sample_rate) = if target_sample_rate != sample_rate {
        let samples = crate::audio::resample::resample_interleaved_f32(
            &samples,
            sample_rate,
            target_sample_rate,
            channels,
        )
        .map_err(|err| AudioInputError::new(err.code, err.message))?;

        (samples, target_sample_rate)
    } else {
        (samples, sample_rate)
    };

    let shared = Arc::new(samples);
    if let Some(key) = cache_key {
        crate::audio::resample_cache::store_async(
            key,
            shared.clone(),
            channels as u16,
            sample_rate,
            bit_depth,
        );
    }
    Ok(DecodedAudioBuffer {
        samples: shared,
        channels: channels as u16,
        sample_rate,
        bit_depth,
        duration,
    })
}

#[derive(Default)]
pub(crate) struct SymphoniaInput;

impl AudioInput for SymphoniaInput {
    fn id(&self) -> &'static str {
        SYMPHONIA_INPUT_ID
    }

    fn open(
        &self,
        path: &Path,
        output_sample_rate: Option<u32>,
    ) -> Result<AudioInputOpenResult, AudioInputError> {
        match start_symphonia_stream(path, output_sample_rate) {
            Ok((source, meta, streaming)) => Ok(AudioInputOpenResult {
                input_id: self.id(),
                meta,
                kind: AudioInputKind::Streaming(streaming),
                source: Box::new(source),
            }),
            Err(stream_err) => match decode_track_to_buffer(path, output_sample_rate) {
                Ok(decoded) => {
                    let source = Box::new(SharedSamplesSource::new(
                        decoded.samples.clone(),
                        decoded.channels,
                        decoded.sample_rate,
                        0,
                    ));
                    Ok(AudioInputOpenResult {
                        input_id: self.id(),
                        meta: AudioInputMeta {
                            channels: decoded.channels,
                            sample_rate: decoded.sample_rate,
                            bit_depth: decoded.bit_depth,
                            duration: decoded.duration,
                        },
                        kind: AudioInputKind::Decoded {
                            samples: decoded.samples,
                        },
                        source,
                    })
                }
                Err(buffer_err) => Err(AudioInputError::new(
                    "AUDIO_INPUT_SYMPHONIA_OPEN_FAILED",
                    format!(
                        "Streaming open failed: {}; buffer decode failed: {}",
                        stream_err.message, buffer_err.message
                    ),
                )),
            },
        }
    }
}
