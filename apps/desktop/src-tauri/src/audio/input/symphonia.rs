use std::collections::VecDeque;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::mpsc;
use std::sync::atomic::{AtomicU64, Ordering};
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

static STREAMING_UNDERRUN_EVENTS: AtomicU64 = AtomicU64::new(0);
static STREAMING_UNDERRUN_FRAMES: AtomicU64 = AtomicU64::new(0);

pub(crate) fn streaming_underrun_stats() -> (u64, u64) {
    (
        STREAMING_UNDERRUN_EVENTS.load(Ordering::Relaxed),
        STREAMING_UNDERRUN_FRAMES.load(Ordering::Relaxed),
    )
}

#[derive(Clone)]
pub(crate) struct AudioRingBuffer {
    inner: Arc<(Mutex<AudioRingBufferInner>, Condvar, Condvar)>,
}

struct AudioRingBufferInner {
    data: VecDeque<f32>,
    capacity: usize,
    finished: bool,
}

#[derive(Clone, Copy, Debug)]
struct PopChunkResult {
    popped: usize,
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

    fn pop_chunk_into(
        &self,
        out: &mut Vec<f32>,
        max_samples: usize,
        wait_timeout: Duration,
    ) -> PopChunkResult {
        out.clear();

        if max_samples == 0 {
            return PopChunkResult {
                popped: 0,
                finished: self.is_finished_and_empty(),
            };
        }

        let (lock, available, space) = &*self.inner;
        let mut inner = if wait_timeout.is_zero() {
            match lock.try_lock() {
                Ok(inner) => inner,
                Err(_) => {
                    return PopChunkResult {
                        popped: 0,
                        finished: false,
                    };
                }
            }
        } else {
            lock.lock().expect("ring buffer lock poisoned")
        };

        if !wait_timeout.is_zero() && inner.data.is_empty() && !inner.finished {
            inner = match available.wait_timeout(inner, wait_timeout) {
                Ok((guard, _)) => guard,
                Err(poisoned) => poisoned.into_inner().0,
            };
        }

        let count = inner.data.len().min(max_samples);
        if count == 0 {
            return PopChunkResult {
                popped: 0,
                finished: inner.finished && inner.data.is_empty(),
            };
        }

        if out.capacity() < count {
            out.reserve(count);
        }

        for _ in 0..count {
            let Some(sample) = inner.data.pop_front() else {
                break;
            };
            out.push(sample);
        }

        space.notify_all();

        PopChunkResult {
            popped: out.len(),
            finished: inner.finished && inner.data.is_empty(),
        }
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

#[derive(Clone, Copy, Debug, Default)]
struct DrainedDecoderCommands {
    shutdown: bool,
    seek_target: Option<f64>,
}

fn drain_decoder_commands(command_rx: &mpsc::Receiver<DecoderCommand>) -> DrainedDecoderCommands {
    let mut result = DrainedDecoderCommands::default();

    loop {
        match command_rx.try_recv() {
            Ok(DecoderCommand::Shutdown) => {
                result.shutdown = true;
                result.seek_target = None;
                return result;
            }
            Ok(DecoderCommand::Seek(target)) => {
                result.seek_target = Some(target);
            }
            Err(mpsc::TryRecvError::Empty) => break,
            Err(mpsc::TryRecvError::Disconnected) => {
                result.shutdown = true;
                result.seek_target = None;
                return result;
            }
        }
    }

    result
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
    const CHUNK_SAMPLES: usize = 8192;
    const SILENCE_FRAMES: usize = 64;

    pub fn new(buffer: AudioRingBuffer, channels: u16, sample_rate: u32, duration: f64) -> Self {
        Self {
            buffer,
            channels: channels.max(1),
            sample_rate: sample_rate.max(1),
            duration,
            local: Vec::with_capacity(Self::CHUNK_SAMPLES),
            local_index: 0,
        }
    }
}

impl Iterator for StreamingSamplesSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.local_index >= self.local.len() {
            let channels = self.channels.max(1) as usize;
            let result = self.buffer.pop_chunk_into(
                &mut self.local,
                Self::CHUNK_SAMPLES,
                Duration::from_millis(0),
            );
            self.local_index = 0;

            if result.popped == 0 {
                if result.finished {
                    return None;
                }

                STREAMING_UNDERRUN_EVENTS.fetch_add(1, Ordering::Relaxed);
                STREAMING_UNDERRUN_FRAMES
                    .fetch_add(Self::SILENCE_FRAMES as u64, Ordering::Relaxed);

                let silence_samples = (Self::SILENCE_FRAMES * channels).max(1);
                self.local.resize(silence_samples, 0.0);
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

    let cache_key = crate::audio::resample_cache::key_for_resample(path, output_sample_rate);

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
        let mut cache_key = cache_key;
        let mut cache_handle: Option<crate::audio::resample_cache::StreamingCacheHandle> = None;
        let mut channels_usize: usize = 0;
        let mut effective_sample_rate: u32 = 0;
        let mut meta_delivered = false;

        'decode_loop: loop {
            let drained = drain_decoder_commands(&command_rx);
            if drained.shutdown {
                buffer_clone.mark_finished();
                return;
            }
            if let Some(target) = drained.seek_target {
                buffer_clone.clear();
                pending_trim_frames_out = 0;
                cache_handle = None;
                cache_key = None;

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
                        pending_trim_frames_out = (delta * effective_sample_rate as f64) as usize;
                    }

                    decoder = match symphonia::default::get_codecs()
                        .make(&track.codec_params, &DecoderOptions::default())
                    {
                        Ok(decoder) => decoder,
                        Err(err) => {
                            if let Ok(mut guard) = error_clone.lock() {
                                if guard.is_none() {
                                    *guard = Some(format!("Failed to create decoder: {err}"));
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
                    if let Some(handle) = cache_handle.take() {
                        handle.finalize();
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

                            if cache_handle.is_none()
                                && requested_sample_rate == effective_sample_rate
                            {
                                if let Some(key) = cache_key.take() {
                                    cache_handle =
                                        crate::audio::resample_cache::start_streaming_cache(
                                            key,
                                            channels_usize as u16,
                                            effective_sample_rate,
                                            bit_depth,
                                        );
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

                            if offset > 0 {
                                if offset >= out_interleaved.len() {
                                    continue;
                                }
                                out_interleaved = out_interleaved.split_off(offset);
                                offset = 0;
                            }

                            while offset < out_interleaved.len() {
                                let drained = drain_decoder_commands(&command_rx);
                                if drained.shutdown {
                                    buffer_clone.mark_finished();
                                    return;
                                }
                                if let Some(target) = drained.seek_target {
                                    buffer_clone.clear();
                                    pending_trim_frames_out = 0;
                                    cache_handle = None;
                                    cache_key = None;

                                    let seek_to = SeekTo::Time {
                                        time: Time::from(target.max(0.0)),
                                        track_id: Some(track_id),
                                    };

                                    if let Ok(seeked) = format.seek(SeekMode::Accurate, seek_to) {
                                        if let Some(time_base) = track.codec_params.time_base {
                                            let required =
                                                time_base.calc_time(seeked.required_ts);
                                            let actual = time_base.calc_time(seeked.actual_ts);
                                            let required_seconds =
                                                required.seconds as f64 + required.frac;
                                            let actual_seconds =
                                                actual.seconds as f64 + actual.frac;
                                            let delta =
                                                (required_seconds - actual_seconds).max(0.0);
                                            pending_trim_frames_out =
                                                (delta * effective_sample_rate as f64) as usize;
                                        }

                                        decoder = match symphonia::default::get_codecs().make(
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

                                let remaining = &out_interleaved[offset..];
                                let frames_pushed =
                                    buffer_clone.push_interleaved(remaining, channels);
                                if frames_pushed == 0 {
                                    continue;
                                }
                                offset += frames_pushed * channels;
                            }

                            if let Some(handle) = cache_handle.as_ref() {
                                let ok = handle.try_append(out_interleaved);
                                if !ok {
                                    cache_handle = None;
                                }
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
                    if let Some(handle) = cache_handle.take() {
                        handle.finalize();
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

fn start_cached_pcm_stream(
    cached: crate::audio::resample_cache::CachedPcmInfo,
) -> Result<(StreamingSamplesSource, AudioInputMeta, StreamingPlayback), AudioInputError> {
    let channels = cached.channels as usize;
    if channels == 0 || cached.sample_rate == 0 {
        return Err(AudioInputError::new(
            "AUDIO_INPUT_SYMPHONIA_CACHE_INVALID",
            "Invalid cached PCM metadata",
        ));
    }

    let total_samples: usize = cached.sample_count.try_into().map_err(|_| {
        AudioInputError::new(
            "AUDIO_INPUT_SYMPHONIA_CACHE_TOO_LARGE",
            "Cached PCM is too large to stream on this platform",
        )
    })?;
    if total_samples == 0 || total_samples % channels != 0 {
        return Err(AudioInputError::new(
            "AUDIO_INPUT_SYMPHONIA_CACHE_INVALID",
            "Cached PCM sample count is invalid",
        ));
    }

    let frames_total = total_samples / channels;
    let duration = frames_total as f64 / cached.sample_rate as f64;

    let buffer = AudioRingBuffer::new(352_800);
    let (command_tx, command_rx) = mpsc::channel::<DecoderCommand>();
    let error = Arc::new(Mutex::new(None::<String>));

    let meta = AudioInputMeta {
        channels: cached.channels,
        sample_rate: cached.sample_rate,
        bit_depth: cached.bit_depth,
        duration,
    };

    let buffer_clone = buffer.clone();
    let error_clone = error.clone();
    let path = cached.path.clone();
    let sample_rate = cached.sample_rate;

    std::thread::spawn(move || {
        let result = (|| -> Result<(), String> {
            let mut file = File::open(&path).map_err(|e| format!("Failed to open cache file: {e}"))?;
            let header_bytes = 32u64;
            file.seek(SeekFrom::Start(header_bytes))
                .map_err(|e| format!("Failed to seek cache file: {e}"))?;

            let mut current_sample: usize = 0;
            let mut bytes: Vec<u8> = Vec::new();
            let mut out_interleaved: Vec<f32> = Vec::new();

            const READ_FRAMES_CHUNK: usize = 4_096;
            let chunk_samples = READ_FRAMES_CHUNK * channels;

            loop {
                let drained = drain_decoder_commands(&command_rx);
                if drained.shutdown {
                    buffer_clone.mark_finished();
                    return Ok(());
                }
                if let Some(target) = drained.seek_target {
                    buffer_clone.clear();
                    let target = target.max(0.0);
                    let start_frame = (target * sample_rate as f64) as usize;
                    let start_frame = start_frame.min(frames_total.saturating_sub(1));
                    current_sample = start_frame * channels;
                    let offset = header_bytes + (current_sample as u64).saturating_mul(4);
                    file.seek(SeekFrom::Start(offset))
                        .map_err(|e| format!("Failed to seek cache file: {e}"))?;
                }

                if current_sample >= total_samples {
                    buffer_clone.mark_finished();
                    return Ok(());
                }

                let remaining_samples = total_samples - current_sample;
                let mut read_samples = remaining_samples.min(chunk_samples);
                read_samples = read_samples.saturating_sub(read_samples % channels);
                if read_samples == 0 {
                    buffer_clone.mark_finished();
                    return Ok(());
                }

                bytes.resize(read_samples * 4, 0u8);
                file.read_exact(&mut bytes)
                    .map_err(|e| format!("Failed to read cache samples: {e}"))?;

                out_interleaved.clear();
                out_interleaved.reserve(read_samples);
                for chunk in bytes.chunks_exact(4) {
                    out_interleaved.push(f32::from_le_bytes(
                        chunk
                            .try_into()
                            .map_err(|_| "Failed to parse cached PCM sample".to_string())?,
                    ));
                }

                let mut pushed_samples = 0usize;
                while pushed_samples < out_interleaved.len() {
                    let drained = drain_decoder_commands(&command_rx);
                    if drained.shutdown {
                        buffer_clone.mark_finished();
                        return Ok(());
                    }
                    if let Some(target) = drained.seek_target {
                        buffer_clone.clear();
                        let target = target.max(0.0);
                        let start_frame = (target * sample_rate as f64) as usize;
                        let start_frame = start_frame.min(frames_total.saturating_sub(1));
                        current_sample = start_frame * channels;
                        let offset = header_bytes + (current_sample as u64).saturating_mul(4);
                        file.seek(SeekFrom::Start(offset))
                            .map_err(|e| format!("Failed to seek cache file: {e}"))?;
                        break;
                    }

                    let remaining = &out_interleaved[pushed_samples..];
                    let frames_pushed = buffer_clone.push_interleaved(remaining, channels);
                    if frames_pushed == 0 {
                        std::thread::sleep(Duration::from_millis(5));
                        continue;
                    }
                    pushed_samples += frames_pushed * channels;
                    current_sample = current_sample.saturating_add(frames_pushed * channels);
                }
            }
        })();

        if let Err(err) = result {
            if let Ok(mut guard) = error_clone.lock() {
                *guard = Some(err);
            }
            buffer_clone.mark_finished();
        }
    });

    Ok((
        StreamingSamplesSource::new(buffer.clone(), meta.channels, meta.sample_rate, meta.duration),
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
        let cache_key = crate::audio::resample_cache::key_for_resample(path, output_sample_rate);
        if let Some(key) = cache_key.as_deref() {
            if let Some(cached) = crate::audio::resample_cache::try_get_info(key) {
                if let Ok((source, meta, streaming)) = start_cached_pcm_stream(cached) {
                    return Ok(AudioInputOpenResult {
                        input_id: self.id(),
                        meta,
                        kind: AudioInputKind::Streaming(streaming),
                        source: Box::new(source),
                    });
                }
            }
        }

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_buffer_pop_chunk_into_preserves_order_and_reports_finished() {
        let buffer = AudioRingBuffer::new(64);
        let channels = 1usize;
        let input = (0..10usize).map(|i| i as f32).collect::<Vec<_>>();

        let pushed = buffer.push_interleaved(&input, channels);
        assert_eq!(pushed, 10);

        let mut out = Vec::with_capacity(16);
        let result = buffer.pop_chunk_into(&mut out, 4, Duration::from_millis(0));
        assert_eq!(result.popped, 4);
        assert!(!result.finished);
        assert_eq!(out, vec![0.0, 1.0, 2.0, 3.0]);

        buffer.mark_finished();

        out.clear();
        let result = buffer.pop_chunk_into(&mut out, 32, Duration::from_millis(0));
        assert_eq!(result.popped, 6);
        assert!(result.finished);
        assert_eq!(out, vec![4.0, 5.0, 6.0, 7.0, 8.0, 9.0]);

        out.clear();
        let result = buffer.pop_chunk_into(&mut out, 32, Duration::from_millis(0));
        assert_eq!(result.popped, 0);
        assert!(result.finished);
        assert!(out.is_empty());
    }

    #[test]
    fn streaming_samples_source_emits_silence_until_samples_arrive_then_finishes() {
        let buffer = AudioRingBuffer::new(512);
        let mut source = StreamingSamplesSource::new(buffer.clone(), 2, 48_000, 0.0);

        for _ in 0..8 {
            assert_eq!(source.next(), Some(0.0));
        }

        let samples = vec![0.5f32, 0.5, 0.6, 0.6];
        let pushed = buffer.push_interleaved(&samples, 2);
        assert_eq!(pushed, 2);

        let mut saw_sample = false;
        for _ in 0..1024 {
            let Some(value) = source.next() else {
                break;
            };
            if (value - 0.5).abs() < 1e-6 {
                saw_sample = true;
                break;
            }
        }
        assert!(saw_sample, "expected buffered samples to reach the consumer");

        buffer.mark_finished();

        let mut finished = false;
        for _ in 0..4096 {
            if source.next().is_none() {
                finished = true;
                break;
            }
        }
        assert!(finished, "expected stream to finish after buffer is drained");
    }

    #[test]
    fn drain_decoder_commands_keeps_last_seek_and_stops_on_shutdown() {
        let (tx, rx) = mpsc::channel::<DecoderCommand>();
        tx.send(DecoderCommand::Seek(1.0)).unwrap();
        tx.send(DecoderCommand::Seek(2.0)).unwrap();
        tx.send(DecoderCommand::Seek(3.5)).unwrap();

        let drained = drain_decoder_commands(&rx);
        assert!(!drained.shutdown);
        assert_eq!(drained.seek_target, Some(3.5));

        tx.send(DecoderCommand::Seek(4.0)).unwrap();
        tx.send(DecoderCommand::Shutdown).unwrap();
        tx.send(DecoderCommand::Seek(5.0)).unwrap();

        let drained = drain_decoder_commands(&rx);
        assert!(drained.shutdown);
        assert_eq!(drained.seek_target, None);
    }
}
