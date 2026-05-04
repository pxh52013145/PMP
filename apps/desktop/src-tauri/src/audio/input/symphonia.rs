use std::fs::File;
use std::path::Path;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::time::Instant;

use symphonia::core::{
    audio::SampleBuffer,
    codecs::DecoderOptions,
    errors::Error as SymphoniaError,
    formats::FormatOptions,
    formats::{FormatReader, SeekMode, SeekTo, Track},
    io::{MediaSource, MediaSourceStream, MediaSourceStreamOptions},
    meta::MetadataOptions,
    probe::Hint,
    units::Time,
};

use super::{
    AudioInput, AudioInputDecodeMode, AudioInputError, AudioInputKind, AudioInputMeta,
    AudioInputOpenResult, AudioInputSrcPolicy, SYMPHONIA_INPUT_ID,
};

use crate::audio::buffer::AudioRingBuffer;
use crate::audio::buffer_policy;
use crate::audio::control_plane::command_channel;
use crate::audio::diagnostics;
use crate::audio::realtime_memory_guard::{new_guarded_ring_buffer, AudioRealtimeMemoryRole};

use super::streaming::{
    drain_decoder_commands, spawn_render_transfer_worker, try_lock_render_queue_hot_path,
    DecoderCommand, SharedSamplesSource, StreamingPlayback, StreamingSamplesSource,
    StreamingShutdownTx, TransferCommand,
};

fn is_full_decode_fallback_enabled() -> bool {
    match std::env::var("PMP_AUDIO_ALLOW_FULL_DECODE_FALLBACK") {
        Ok(value) => {
            let normalized = value.trim().to_ascii_lowercase();
            normalized == "1" || normalized == "true" || normalized == "yes" || normalized == "on"
        }
        Err(_) => false,
    }
}

fn parse_env_bool(key: &str, default_value: bool) -> bool {
    std::env::var(key)
        .ok()
        .and_then(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            match normalized.as_str() {
                "1" | "true" | "yes" | "on" => Some(true),
                "0" | "false" | "no" | "off" => Some(false),
                _ => None,
            }
        })
        .unwrap_or(default_value)
}

fn parse_env_f64(key: &str, default_value: f64, min: f64, max: f64) -> f64 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<f64>().ok())
        .filter(|value| value.is_finite())
        .unwrap_or(default_value)
        .clamp(min, max)
}

fn stream_init_timeout() -> Duration {
    const DEFAULT_TIMEOUT_MS: u64 = 2_200;
    const MIN_TIMEOUT_MS: u64 = 300;
    const MAX_TIMEOUT_MS: u64 = 8_000;

    let timeout_ms = std::env::var("PMP_AUDIO_STREAM_INIT_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
    Duration::from_millis(timeout_ms)
}

fn remote_stream_init_timeout() -> Duration {
    const DEFAULT_TIMEOUT_MS: u64 = 12_000;
    const MIN_TIMEOUT_MS: u64 = 1_000;
    const MAX_TIMEOUT_MS: u64 = 30_000;

    let timeout_ms = std::env::var("PMP_AUDIO_REMOTE_STREAM_INIT_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
    Duration::from_millis(timeout_ms)
}

pub(crate) struct SymphoniaStreamingMediaSource {
    pub source: Box<dyn MediaSource>,
    pub extension: Option<String>,
}

enum SymphoniaStreamInput {
    Path(PathBuf),
    MediaSource(SymphoniaStreamingMediaSource),
}

impl SymphoniaStreamInput {
    fn into_media_source_stream(self) -> Result<(MediaSourceStream, Option<String>), String> {
        match self {
            Self::Path(path) => {
                let file = File::open(&path).map_err(|e| format!("Failed to open file: {e}"))?;
                let extension = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(str::to_string);
                let mss =
                    MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());
                Ok((mss, extension))
            }
            Self::MediaSource(input) => {
                let mss = MediaSourceStream::new(input.source, MediaSourceStreamOptions::default());
                Ok((mss, input.extension))
            }
        }
    }
}

fn streaming_full_track_initial_capacity_samples(
    output_sample_rate: Option<u32>,
    default_capacity: usize,
    budget_samples: usize,
    estimated_required_samples: Option<usize>,
) -> usize {
    let requested_capacity = estimated_required_samples
        .map(|required| required.min(budget_samples).max(default_capacity))
        .unwrap_or(default_capacity)
        .clamp(default_capacity, budget_samples.max(default_capacity));

    if parse_env_bool("PMP_AUDIO_STREAMING_FULLTRACK_PREALLOCATE_FULL", false) {
        return requested_capacity;
    }

    let initial_seconds = parse_env_f64(
        "PMP_AUDIO_STREAMING_FULLTRACK_INITIAL_SECONDS",
        12.0,
        6.0,
        300.0,
    );
    let sample_rate = output_sample_rate.unwrap_or(44_100).max(1) as f64;
    let assumed_channels = 2.0f64;
    let initial_capacity = ((sample_rate * assumed_channels * initial_seconds).ceil() as usize)
        .clamp(default_capacity, budget_samples.max(default_capacity));

    requested_capacity
        .min(initial_capacity)
        .max(default_capacity)
}

fn streaming_default_capacity_samples(
    output_sample_rate: Option<u32>,
    default_capacity: usize,
    budget_samples: usize,
) -> usize {
    let base_seconds = parse_env_f64("PMP_AUDIO_STREAMING_RESERVOIR_SECONDS", 8.0, 4.0, 120.0);
    let sample_rate = output_sample_rate.unwrap_or(44_100).max(1) as f64;
    let rate_scale = streaming_reservoir_rate_scale(sample_rate);
    let channels = 2.0f64;

    ((sample_rate * channels * base_seconds * rate_scale).ceil() as usize)
        .clamp(default_capacity, budget_samples.max(default_capacity))
}

fn streaming_reservoir_rate_scale(sample_rate: f64) -> f64 {
    // Memory-first policy for local-file desktop playback:
    // higher sample-rate content carries significantly larger per-second data volume,
    // so we shorten effective reservoir seconds to avoid disproportionate RSS growth.
    if sample_rate >= 352_800.0 {
        0.50
    } else if sample_rate >= 192_000.0 {
        0.62
    } else if sample_rate >= 96_000.0 {
        0.82
    } else {
        1.0
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

fn full_track_buffer_budget_samples() -> usize {
    // Default budget is intentionally conservative: full-track decoding can easily allocate
    // hundreds of MB for longer tracks (f32 interleaved PCM). Streaming is the preferred
    // decode mode for desktop playback; this budget is only for the optional full-track path.
    const DEFAULT_BUDGET_MIB: usize = 64;
    const MIN_BUDGET_MIB: usize = 16;
    const MAX_BUDGET_MIB: usize = 4096;

    let budget_mib = std::env::var("PMP_AUDIO_FULL_TRACK_BUFFER_BUDGET_MIB")
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(DEFAULT_BUDGET_MIB)
        .clamp(MIN_BUDGET_MIB, MAX_BUDGET_MIB);

    let bytes = (budget_mib as u128)
        .saturating_mul(1024)
        .saturating_mul(1024);
    let samples = bytes / (std::mem::size_of::<f32>() as u128);
    samples.clamp(32_768, usize::MAX as u128) as usize
}

fn estimate_full_track_required_samples(
    path: &Path,
    output_sample_rate: Option<u32>,
    src_policy: AudioInputSrcPolicy,
) -> Option<usize> {
    let file = File::open(path).ok()?;
    let mss = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .ok()?;
    let format = probed.format;
    let track = pick_audio_track(format.as_ref())?;

    let channels = track.codec_params.channels.map(|value| value.count())?;
    let source_rate = track.codec_params.sample_rate?;
    let frame_count = track.codec_params.n_frames?;

    let target_rate = super::resolve_audio_input_target_sample_rate(output_sample_rate, src_policy)
        .unwrap_or(source_rate)
        .max(1);

    let source_rate_u128 = source_rate.max(1) as u128;
    let target_rate_u128 = target_rate.max(1) as u128;
    let frame_count_u128 = frame_count as u128;
    let target_frames = if target_rate_u128 == source_rate_u128 {
        frame_count_u128
    } else {
        frame_count_u128
            .saturating_mul(target_rate_u128)
            .saturating_add(source_rate_u128.saturating_sub(1))
            / source_rate_u128
    };

    let estimated_samples = target_frames.saturating_mul(channels.max(1) as u128);
    Some(estimated_samples.clamp(1, usize::MAX as u128) as usize)
}

fn start_symphonia_stream(
    path: &Path,
    output_sample_rate: Option<u32>,
    src_policy: AudioInputSrcPolicy,
    decode_reservoir_capacity_samples: Option<usize>,
) -> Result<(StreamingSamplesSource, AudioInputMeta, StreamingPlayback), AudioInputError> {
    start_symphonia_stream_from_input(
        SymphoniaStreamInput::Path(path.to_path_buf()),
        output_sample_rate,
        src_policy,
        decode_reservoir_capacity_samples,
        None,
    )
}

fn start_symphonia_stream_from_input(
    input: SymphoniaStreamInput,
    output_sample_rate: Option<u32>,
    src_policy: AudioInputSrcPolicy,
    decode_reservoir_capacity_samples: Option<usize>,
    init_timeout_override: Option<Duration>,
) -> Result<(StreamingSamplesSource, AudioInputMeta, StreamingPlayback), AudioInputError> {
    let open_started_at = Instant::now();
    let default_capacity = AudioRingBuffer::recommended_capacity_samples(output_sample_rate, 2);
    let max_capacity = full_track_buffer_budget_samples().max(default_capacity);
    let decode_capacity = decode_reservoir_capacity_samples
        .unwrap_or(default_capacity)
        .clamp(default_capacity, max_capacity);
    let buffer = new_guarded_ring_buffer(decode_capacity, AudioRealtimeMemoryRole::DecodeReservoir);
    let render_queue_capacity =
        buffer_policy::recommended_render_queue_capacity_samples(output_sample_rate, 2)
            .min(buffer.capacity_samples().max(16_384));
    let render_queue = AudioRingBuffer::new(render_queue_capacity);
    diagnostics::record_event(
        "stream.open.begin",
        decode_capacity as u64,
        render_queue_capacity as u64,
    );
    try_lock_render_queue_hot_path(&render_queue);

    let (command_tx, command_rx) = command_channel::<DecoderCommand>();
    let (transfer_tx, transfer_rx) = command_channel::<TransferCommand>();
    let (meta_tx, meta_rx) = mpsc::channel::<Result<AudioInputMeta, String>>();

    let buffer_clone = buffer.clone();
    let render_queue_clone = render_queue.clone();
    let error = Arc::new(Mutex::new(None::<String>));
    let error_clone = error.clone();

    std::thread::Builder::new()
        .name("pmpm-symphonia-decoder".into())
        .spawn(move || {
            let _priority_guard = crate::audio::threading::promote_current_thread_for_audio_decode();
            crate::audio::threading::apply_audio_decode_pressure_profile(
                crate::audio::realtime_scheduler::SCHEDULER.profile(),
            );

        let init = (|| -> Result<(Box<dyn FormatReader>, Track), String> {
            let (mss, extension) = input.into_media_source_stream()?;
            let mut hint = Hint::new();
            if let Some(ext) = extension.as_deref() {
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
        let mut out_interleaved: Vec<f32> = Vec::with_capacity(16_384);

        let resample_chunk_frames = 1024usize;
        let mut resampler: Option<crate::audio::resample::StreamingResampler> = None;
        let mut channels_usize: usize = 0;
        let mut effective_sample_rate: u32 = 0;
        let mut meta_delivered = false;

        if let (Some(pre_channels), Some(input_sample_rate)) = (
            track
                .codec_params
                .channels
                .map(|value| value.count())
                .filter(|value| *value > 0),
            track.codec_params.sample_rate.filter(|value| *value > 0),
        ) {
            channels_usize = pre_channels;
            effective_sample_rate = input_sample_rate;

            let requested_sample_rate = output_sample_rate.unwrap_or(input_sample_rate);
            if requested_sample_rate != input_sample_rate {
                match crate::audio::resample::StreamingResampler::new_with_policy(
                    input_sample_rate,
                    requested_sample_rate,
                    channels_usize,
                    resample_chunk_frames,
                    src_policy.hq_src_enabled,
                    src_policy.hq_src_phase_mode,
                    src_policy.src_backend,
                ) {
                    Ok(instance) => {
                        let resampler_delay = instance.output_delay();
                        resampler = Some(instance);
                        if resampler_delay > 0 {
                            pending_trim_frames_out =
                                pending_trim_frames_out.saturating_add(resampler_delay);
                        }
                        effective_sample_rate = requested_sample_rate;
                    }
                    Err(err) => {
                        crate::backend_telemetry::warn_global(
                            "audio",
                            "audio.input.resampler.init-from-codec.failed",
                            crate::backend_telemetry::BackendTelemetryOptions::new()
                                .component("audio::input::symphonia")
                                .message(err.message)
                                .field("code", serde_json::json!(err.code)),
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
                source_sample_rate: input_sample_rate,
                bit_depth,
                duration,
            }));
            meta_delivered = true;
        }

        'decode_loop: loop {
            let profile = crate::audio::realtime_scheduler::SCHEDULER.profile();
            crate::audio::threading::apply_audio_decode_pressure_profile(
                profile,
            );
            let decode_backoff = buffer_policy::decode_push_backoff(profile);
            let eof_wait_backoff = decode_backoff.max(Duration::from_millis(10));
            let drained = drain_decoder_commands(&command_rx);
            if drained.shutdown {
                buffer_clone.mark_finished();
                return;
            }
            if let Some(target) = drained.seek_target {
                buffer_clone.clear();
                render_queue_clone.clear();
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
                        pending_trim_frames_out =
                            pending_trim_frames_out.saturating_add(r.output_delay());
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
                        buffer_clone.mark_finished();
                        return;
                    }

                    // End-of-stream: keep decoder alive so interactive seeks near the tail do not
                    // disconnect the command channel and force slow pipeline rebuilds.
                    buffer_clone.mark_finished();
                    loop {
                        std::thread::sleep(eof_wait_backoff);
                        let drained = drain_decoder_commands(&command_rx);
                        if drained.shutdown {
                            return;
                        }
                        if let Some(target) = drained.seek_target {
                            buffer_clone.clear();
                            render_queue_clone.clear();
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
                                    pending_trim_frames_out =
                                        pending_trim_frames_out.saturating_add(r.output_delay());
                                }
                            }

                            continue 'decode_loop;
                        }
                    }
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
                                match crate::audio::resample::StreamingResampler::new_with_policy(
                                    input_sample_rate,
                                    requested_sample_rate,
                                    channels_usize,
                                    resample_chunk_frames,
                                    src_policy.hq_src_enabled,
                                    src_policy.hq_src_phase_mode,
                                    src_policy.src_backend,
                                ) {
                                    Ok(instance) => {
                                        let resampler_delay = instance.output_delay();
                                        resampler = Some(instance);
                                        if resampler_delay > 0 {
                                            pending_trim_frames_out = pending_trim_frames_out
                                                .saturating_add(resampler_delay);
                                        }
                                        effective_sample_rate = requested_sample_rate;
                                    }
                                    Err(err) => {
                                        crate::backend_telemetry::warn_global(
                                            "audio",
                                            "audio.input.resampler.init.failed",
                                            crate::backend_telemetry::BackendTelemetryOptions::new()
                                                .component("audio::input::symphonia")
                                                .message(err.message)
                                                .field("code", serde_json::json!(err.code)),
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
                                source_sample_rate: input_sample_rate,
                                bit_depth,
                                duration,
                            }));
                            crate::backend_telemetry::debug_global(
                                "audio",
                                "audio.input.stream.initialized",
                                crate::backend_telemetry::BackendTelemetryOptions::new()
                                    .component("audio::input::symphonia")
                                    .field("channels", serde_json::json!(channels_usize))
                                    .field("inputSampleRate", serde_json::json!(input_sample_rate))
                                    .field("outputSampleRate", serde_json::json!(effective_sample_rate))
                                    .field("resample", serde_json::json!(resampler.is_some())),
                            );
                            meta_delivered = true;
                        }
                        let all = buf.samples();
                        let total_frames = all.len() / channels;
                        if total_frames > 0 {
                            let slice = all;

                            if let Some(active_resampler) = resampler.as_mut() {
                                // Resample to device mix rate to avoid rodio's low-quality resampler artifacts.
                                active_resampler
                                    .process_interleaved_into(slice, &mut out_interleaved);

                                let out_frames = out_interleaved.len() / channels_usize.max(1);
                                let mut offset_samples = 0usize;
                                if pending_trim_frames_out > 0 && channels_usize > 0 {
                                    let trim_now = pending_trim_frames_out.min(out_frames);
                                    offset_samples = trim_now * channels_usize;
                                    pending_trim_frames_out =
                                        pending_trim_frames_out.saturating_sub(trim_now);
                                }

                                while offset_samples < out_interleaved.len() {
                                    let drained = drain_decoder_commands(&command_rx);
                                    if drained.shutdown {
                                        buffer_clone.mark_finished();
                                        return;
                                    }
                                    if let Some(target) = drained.seek_target {
                                        buffer_clone.clear();
                                        render_queue_clone.clear();
                                        pending_trim_frames_out = 0;

                                        let seek_to = SeekTo::Time {
                                            time: Time::from(target.max(0.0)),
                                            track_id: Some(track_id),
                                        };

                                        if let Ok(seeked) = format.seek(SeekMode::Accurate, seek_to)
                                        {
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
                                            active_resampler.reset();
                                            pending_trim_frames_out = pending_trim_frames_out
                                                .saturating_add(active_resampler.output_delay());
                                        }

                                        continue 'decode_loop;
                                    }

                                    let remaining = &out_interleaved[offset_samples..];
                                    let frames_pushed =
                                        buffer_clone.push_interleaved(remaining, channels);
                                    if frames_pushed == 0 {
                                        if decode_backoff.is_zero() {
                                            std::thread::yield_now();
                                        } else {
                                            std::thread::sleep(decode_backoff);
                                        }
                                        continue;
                                    }
                                    offset_samples += frames_pushed * channels;
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
                                let mut offset_samples = start_frame * channels;

                                while offset_samples < slice.len() {
                                    let drained = drain_decoder_commands(&command_rx);
                                    if drained.shutdown {
                                        buffer_clone.mark_finished();
                                        return;
                                    }
                                    if let Some(target) = drained.seek_target {
                                        buffer_clone.clear();
                                        render_queue_clone.clear();
                                        pending_trim_frames_out = 0;

                                        let seek_to = SeekTo::Time {
                                            time: Time::from(target.max(0.0)),
                                            track_id: Some(track_id),
                                        };

                                        if let Ok(seeked) = format.seek(SeekMode::Accurate, seek_to)
                                        {
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
                                                pending_trim_frames_out = pending_trim_frames_out
                                                    .saturating_add(r.output_delay());
                                            }
                                        }

                                        continue 'decode_loop;
                                    }

                                    let remaining = &slice[offset_samples..];
                                    let frames_pushed =
                                        buffer_clone.push_interleaved(remaining, channels);
                                    if frames_pushed == 0 {
                                        if decode_backoff.is_zero() {
                                            std::thread::yield_now();
                                        } else {
                                            std::thread::sleep(decode_backoff);
                                        }
                                        continue;
                                    }
                                    offset_samples += frames_pushed * channels;
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
                        buffer_clone.mark_finished();
                        return;
                    }

                    buffer_clone.mark_finished();
                    loop {
                        std::thread::sleep(eof_wait_backoff);
                        let drained = drain_decoder_commands(&command_rx);
                        if drained.shutdown {
                            return;
                        }
                        if let Some(target) = drained.seek_target {
                            buffer_clone.clear();
                            render_queue_clone.clear();
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
                                    pending_trim_frames_out = pending_trim_frames_out
                                        .saturating_add(r.output_delay());
                                }
                            }

                            continue 'decode_loop;
                        }
                    }
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
        })
        .map_err(|e| {
            AudioInputError::new(
                "AUDIO_INPUT_SYMPHONIA_OPEN_FAILED",
                format!("Failed to spawn decoder thread: {e}"),
            )
        })?;

    let init_timeout = init_timeout_override.unwrap_or_else(stream_init_timeout);
    let meta = match meta_rx.recv_timeout(init_timeout) {
        Ok(value) => value.map_err(|message| {
            AudioInputError::new("AUDIO_INPUT_SYMPHONIA_OPEN_FAILED", message)
        })?,
        Err(err) => {
            let _ = command_tx.send(DecoderCommand::Shutdown);
            diagnostics::record_event(
                "stream.open.timeout",
                open_started_at.elapsed().as_millis().min(u64::MAX as u128) as u64,
                init_timeout.as_millis().min(u64::MAX as u128) as u64,
            );
            return Err(AudioInputError::new(
                "AUDIO_INPUT_SYMPHONIA_OPEN_TIMEOUT",
                format!(
                    "Timed out initializing decoder after {} ms: {err}",
                    init_timeout.as_millis()
                ),
            ));
        }
    };
    diagnostics::record_event(
        "stream.open.ready",
        open_started_at.elapsed().as_millis().min(u64::MAX as u128) as u64,
        (meta.sample_rate as u64).max(1),
    );

    if let Err(err) = spawn_render_transfer_worker(
        buffer.clone(),
        render_queue.clone(),
        meta.channels,
        meta.sample_rate,
        transfer_rx,
        "pmpm-symphonia-transfer",
    ) {
        let _ = transfer_tx.send(TransferCommand::Shutdown);
        let _ = command_tx.send(DecoderCommand::Shutdown);
        diagnostics::record_event(
            "stream.open.transfer_spawn_failed",
            open_started_at.elapsed().as_millis().min(u64::MAX as u128) as u64,
            0,
        );
        return Err(AudioInputError::new(
            "AUDIO_INPUT_SYMPHONIA_OPEN_FAILED",
            err,
        ));
    }
    diagnostics::record_event(
        "stream.open.transfer_ready",
        open_started_at.elapsed().as_millis().min(u64::MAX as u128) as u64,
        render_queue.capacity_samples() as u64,
    );

    Ok((
        StreamingSamplesSource::new(
            render_queue.clone(),
            meta.channels,
            meta.sample_rate,
            meta.duration,
        ),
        meta,
        StreamingPlayback {
            buffer,
            render_queue,
            shutdown_tx: StreamingShutdownTx::new(command_tx.clone(), transfer_tx),
            command_tx,
            error,
        },
    ))
}

struct DecodedAudioBuffer {
    samples: Arc<Vec<f32>>,
    channels: u16,
    source_sample_rate: u32,
    sample_rate: u32,
    bit_depth: Option<u32>,
    duration: f64,
}

fn decoded_to_open_result(
    input_id: &'static str,
    decoded: DecodedAudioBuffer,
) -> AudioInputOpenResult {
    let source = Box::new(SharedSamplesSource::new(
        decoded.samples.clone(),
        decoded.channels,
        decoded.sample_rate,
        0,
    ));

    AudioInputOpenResult {
        input_id,
        meta: AudioInputMeta {
            channels: decoded.channels,
            sample_rate: decoded.sample_rate,
            source_sample_rate: decoded.source_sample_rate,
            bit_depth: decoded.bit_depth,
            duration: decoded.duration,
        },
        kind: AudioInputKind::Decoded {
            samples: decoded.samples,
        },
        source,
    }
}

fn decode_track_to_buffer(
    path: &Path,
    output_sample_rate: Option<u32>,
    src_policy: AudioInputSrcPolicy,
    decode_budget_samples: Option<usize>,
) -> Result<DecodedAudioBuffer, AudioInputError> {
    let budget_samples = decode_budget_samples.unwrap_or(usize::MAX).max(1);
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
    if let (Some(channels), Some(source_rate), Some(frame_count)) = (
        track.codec_params.channels.map(|ch| ch.count()),
        track.codec_params.sample_rate,
        track.codec_params.n_frames,
    ) {
        let target_rate =
            super::resolve_audio_input_target_sample_rate(output_sample_rate, src_policy)
                .unwrap_or(source_rate)
                .max(1);
        let source_rate_u128 = source_rate.max(1) as u128;
        let target_rate_u128 = target_rate.max(1) as u128;
        let frame_count_u128 = frame_count as u128;
        let target_frames = if target_rate_u128 == source_rate_u128 {
            frame_count_u128
        } else {
            frame_count_u128
                .saturating_mul(target_rate_u128)
                .saturating_add(source_rate_u128.saturating_sub(1))
                / source_rate_u128
        };
        let estimated_samples = target_frames.saturating_mul(channels.max(1) as u128);
        let reserve_samples = estimated_samples
            .min(budget_samples as u128)
            .clamp(0, usize::MAX as u128) as usize;
        if reserve_samples > 0 {
            let _ = samples.try_reserve_exact(reserve_samples);
        }
    }
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
                    if samples.len() > budget_samples {
                        return Err(AudioInputError::new(
                            "AUDIO_INPUT_SYMPHONIA_FULL_TRACK_TOO_LARGE",
                            format!(
                                "Full-track decode exceeded budget: {} samples (budget={} samples)",
                                samples.len(),
                                budget_samples
                            ),
                        ));
                    }
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

    let source_sample_rate = sample_rate;
    let target_sample_rate = output_sample_rate.unwrap_or(sample_rate);
    let (samples, sample_rate) = if target_sample_rate != sample_rate {
        let samples = crate::audio::resample::resample_interleaved_f32_with_policy(
            &samples,
            sample_rate,
            target_sample_rate,
            channels,
            src_policy.hq_src_enabled,
            src_policy.hq_src_phase_mode,
            src_policy.src_backend,
        )
        .map_err(|err| AudioInputError::new(err.code, err.message))?;

        if samples.len() > budget_samples {
            return Err(AudioInputError::new(
                "AUDIO_INPUT_SYMPHONIA_FULL_TRACK_TOO_LARGE",
                format!(
                    "Full-track decode exceeded budget after SRC: {} samples (budget={} samples)",
                    samples.len(),
                    budget_samples
                ),
            ));
        }

        (samples, target_sample_rate)
    } else {
        (samples, sample_rate)
    };

    let shared = Arc::new(samples);
    Ok(DecodedAudioBuffer {
        samples: shared,
        channels: channels as u16,
        source_sample_rate,
        sample_rate,
        bit_depth,
        duration,
    })
}

#[derive(Default)]
pub(crate) struct SymphoniaInput;

pub(crate) fn open_streaming_media_source(
    input: SymphoniaStreamingMediaSource,
    output_sample_rate: Option<u32>,
    src_policy: AudioInputSrcPolicy,
) -> Result<AudioInputOpenResult, AudioInputError> {
    let budget_samples = full_track_buffer_budget_samples();
    let default_streaming_capacity =
        AudioRingBuffer::recommended_capacity_samples(output_sample_rate, 2);
    let streaming_default_capacity = Some(streaming_default_capacity_samples(
        output_sample_rate,
        default_streaming_capacity,
        budget_samples,
    ));

    let (source, meta, streaming) = start_symphonia_stream_from_input(
        SymphoniaStreamInput::MediaSource(input),
        output_sample_rate,
        src_policy,
        streaming_default_capacity,
        Some(remote_stream_init_timeout()),
    )?;

    Ok(AudioInputOpenResult {
        input_id: SYMPHONIA_INPUT_ID,
        meta,
        kind: AudioInputKind::Streaming(streaming),
        source: Box::new(source),
    })
}

impl AudioInput for SymphoniaInput {
    fn id(&self) -> &'static str {
        SYMPHONIA_INPUT_ID
    }

    fn open(
        &self,
        path: &Path,
        output_sample_rate: Option<u32>,
        decode_mode: AudioInputDecodeMode,
        src_policy: AudioInputSrcPolicy,
    ) -> Result<AudioInputOpenResult, AudioInputError> {
        let budget_samples = full_track_buffer_budget_samples();
        let default_streaming_capacity =
            AudioRingBuffer::recommended_capacity_samples(output_sample_rate, 2);
        let streaming_default_capacity = Some(streaming_default_capacity_samples(
            output_sample_rate,
            default_streaming_capacity,
            budget_samples,
        ));

        match decode_mode {
            AudioInputDecodeMode::FullTrack => {
                if let Some(required) =
                    estimate_full_track_required_samples(path, output_sample_rate, src_policy)
                {
                    if required > budget_samples {
                        match start_symphonia_stream(
                            path,
                            output_sample_rate,
                            src_policy,
                            streaming_default_capacity,
                        ) {
                            Ok((source, meta, streaming)) => {
                                return Ok(AudioInputOpenResult {
                                    input_id: self.id(),
                                    meta,
                                    kind: AudioInputKind::Streaming(streaming),
                                    source: Box::new(source),
                                });
                            }
                            Err(stream_err) => {
                                return Err(AudioInputError::new(
                                    "AUDIO_INPUT_SYMPHONIA_FULL_TRACK_TOO_LARGE",
                                    format!(
                                        "Full-track decode estimate exceeded budget: required={} samples (budget={} samples); streaming open failed: {}",
                                        required, budget_samples, stream_err.message
                                    ),
                                ));
                            }
                        }
                    }
                }

                match decode_track_to_buffer(
                    path,
                    output_sample_rate,
                    src_policy,
                    Some(budget_samples),
                ) {
                    Ok(decoded) => Ok(decoded_to_open_result(self.id(), decoded)),
                    Err(buffer_err) => {
                        match start_symphonia_stream(
                            path,
                            output_sample_rate,
                            src_policy,
                            streaming_default_capacity,
                        ) {
                            Ok((source, meta, streaming)) => Ok(AudioInputOpenResult {
                                input_id: self.id(),
                                meta,
                                kind: AudioInputKind::Streaming(streaming),
                                source: Box::new(source),
                            }),
                            Err(stream_err) => Err(AudioInputError::new(
                                "AUDIO_INPUT_SYMPHONIA_OPEN_FAILED",
                                format!(
                                    "Full-track decode failed: {}; streaming open failed: {}",
                                    buffer_err.message, stream_err.message
                                ),
                            )),
                        }
                    }
                }
            }
            AudioInputDecodeMode::StreamingFullTrack => {
                let estimated_required =
                    estimate_full_track_required_samples(path, output_sample_rate, src_policy);
                let selected_capacity = streaming_full_track_initial_capacity_samples(
                    output_sample_rate,
                    default_streaming_capacity,
                    budget_samples,
                    estimated_required,
                );
                diagnostics::record_event(
                    "stream.open.fulltrack_capacity",
                    selected_capacity as u64,
                    estimated_required.unwrap_or(0) as u64,
                );
                let full_track_streaming_capacity = Some(selected_capacity);

                match start_symphonia_stream(
                    path,
                    output_sample_rate,
                    src_policy,
                    full_track_streaming_capacity,
                ) {
                    Ok((source, meta, streaming)) => Ok(AudioInputOpenResult {
                        input_id: self.id(),
                        meta,
                        kind: AudioInputKind::Streaming(streaming),
                        source: Box::new(source),
                    }),
                    Err(stream_err) => Err(AudioInputError::new(
                        "AUDIO_INPUT_SYMPHONIA_OPEN_FAILED",
                        format!(
                            "Progressive full-track streaming open failed: {}",
                            stream_err.message
                        ),
                    )),
                }
            }
            AudioInputDecodeMode::Streaming => {
                match start_symphonia_stream(
                    path,
                    output_sample_rate,
                    src_policy,
                    streaming_default_capacity,
                ) {
                    Ok((source, meta, streaming)) => Ok(AudioInputOpenResult {
                        input_id: self.id(),
                        meta,
                        kind: AudioInputKind::Streaming(streaming),
                        source: Box::new(source),
                    }),
                    Err(stream_err) => {
                        let allow_fallback = is_full_decode_fallback_enabled();
                        if !allow_fallback {
                            return Err(stream_err);
                        }

                        match decode_track_to_buffer(
                            path,
                            output_sample_rate,
                            src_policy,
                            Some(budget_samples),
                        ) {
                            Ok(decoded) => Ok(decoded_to_open_result(self.id(), decoded)),
                            Err(buffer_err) => Err(AudioInputError::new(
                                "AUDIO_INPUT_SYMPHONIA_OPEN_FAILED",
                                format!(
                                    "Streaming open failed: {}; buffer decode failed: {}",
                                    stream_err.message, buffer_err.message
                                ),
                            )),
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn write_wav_i16_stereo_lcg(path: &Path, sample_rate: u32, frames: usize) {
        let channels = 2u16;
        let bits_per_sample = 16u16;
        let block_align = channels * (bits_per_sample / 8);
        let byte_rate = sample_rate * block_align as u32;
        let data_bytes = frames as u32 * block_align as u32;
        let riff_chunk_size = 36u32 + data_bytes;

        let mut file = File::create(path).expect("create wav");
        file.write_all(b"RIFF").unwrap();
        file.write_all(&riff_chunk_size.to_le_bytes()).unwrap();
        file.write_all(b"WAVE").unwrap();
        file.write_all(b"fmt ").unwrap();
        file.write_all(&16u32.to_le_bytes()).unwrap();
        file.write_all(&1u16.to_le_bytes()).unwrap();
        file.write_all(&channels.to_le_bytes()).unwrap();
        file.write_all(&sample_rate.to_le_bytes()).unwrap();
        file.write_all(&byte_rate.to_le_bytes()).unwrap();
        file.write_all(&block_align.to_le_bytes()).unwrap();
        file.write_all(&bits_per_sample.to_le_bytes()).unwrap();
        file.write_all(b"data").unwrap();
        file.write_all(&data_bytes.to_le_bytes()).unwrap();

        let mut left_state: u32 = 0x1234_5678;
        let mut right_state: u32 = 0xDEAD_BEEF;

        for _ in 0..frames {
            left_state = left_state.wrapping_mul(1664525).wrapping_add(1013904223);
            right_state = right_state.wrapping_mul(1664525).wrapping_add(1013904223);

            let left_raw = (left_state >> 16) as i16;
            let right_raw = (right_state >> 16) as i16;
            let left = ((left_raw as i32) / 2) as i16;
            let right = ((right_raw as i32) / 2) as i16;

            file.write_all(&left.to_le_bytes()).unwrap();
            file.write_all(&right.to_le_bytes()).unwrap();
        }
    }

    #[test]
    fn decode_mode_matrix_prefers_streaming_path_when_available() {
        let tmp_dir = std::env::temp_dir();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time ok")
            .as_nanos();
        let path = tmp_dir.join(format!("pmp_symphonia_stream_mode_{nonce}.wav"));

        write_wav_i16_stereo_lcg(&path, 48_000, 4_800);

        let input = SymphoniaInput::default();
        for decode_mode in [
            AudioInputDecodeMode::Streaming,
            AudioInputDecodeMode::FullTrack,
        ] {
            let opened = input
                .open(
                    &path,
                    Some(48_000),
                    decode_mode,
                    AudioInputSrcPolicy::default(),
                )
                .expect("open should succeed");

            let duration = opened.meta.duration;
            match (decode_mode, opened.kind) {
                (AudioInputDecodeMode::Streaming, AudioInputKind::Streaming(streaming)) => {
                    assert!(duration > 0.0);
                    streaming.shutdown_tx.shutdown();
                }
                (AudioInputDecodeMode::FullTrack, AudioInputKind::Decoded { .. }) => {
                    assert!(duration > 0.0);
                }
                (mode, AudioInputKind::Rodio) => {
                    panic!("decode mode {:?} should not fall back to rodio", mode)
                }
                (mode, _kind) => {
                    panic!("decode mode {:?} opened unexpected kind", mode)
                }
            };
        }

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn offline_render_decode_resample_is_deterministic() {
        let tmp_dir = std::env::temp_dir();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time ok")
            .as_nanos();
        let path = tmp_dir.join(format!("pmp_offline_render_{nonce}.wav"));

        let input_rate = 48_000u32;
        let frames = 4_800usize; // 0.1s
        write_wav_i16_stereo_lcg(&path, input_rate, frames);

        let decoded =
            decode_track_to_buffer(&path, Some(44_100), AudioInputSrcPolicy::default(), None)
                .expect("offline decode");
        assert_eq!(decoded.channels, 2);
        assert_eq!(decoded.sample_rate, 44_100);
        assert_eq!(decoded.samples.len(), 4_410 * 2);
        assert!(decoded.samples.iter().all(|sample| sample.is_finite()));

        let mut hasher = Sha256::new();
        for sample in decoded.samples.iter() {
            hasher.update(sample.to_le_bytes());
        }
        let digest = hasher.finalize();
        let mut hex = String::with_capacity(digest.len() * 2);
        for byte in digest {
            hex.push_str(&format!("{byte:02x}"));
        }

        assert_eq!(
            hex, "81b3efc29ef481951f337884ebca4929b670343adb5476a8bca7a2f3c54dd598",
            "offline render output changed; if intentional, update the golden hash"
        );

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn full_track_budget_default_is_conservative() {
        let prev = std::env::var("PMP_AUDIO_FULL_TRACK_BUFFER_BUDGET_MIB").ok();
        std::env::remove_var("PMP_AUDIO_FULL_TRACK_BUFFER_BUDGET_MIB");

        let budget = full_track_buffer_budget_samples();

        if let Some(prev) = prev {
            std::env::set_var("PMP_AUDIO_FULL_TRACK_BUFFER_BUDGET_MIB", prev);
        } else {
            std::env::remove_var("PMP_AUDIO_FULL_TRACK_BUFFER_BUDGET_MIB");
        }

        assert_eq!(budget, 64 * 1024 * 1024 / std::mem::size_of::<f32>());
    }

    #[test]
    fn streaming_default_capacity_scales_with_sample_rate() {
        let prev = std::env::var("PMP_AUDIO_STREAMING_RESERVOIR_SECONDS").ok();
        std::env::remove_var("PMP_AUDIO_STREAMING_RESERVOIR_SECONDS");

        let budget = full_track_buffer_budget_samples();
        let low_default = AudioRingBuffer::recommended_capacity_samples(Some(44_100), 2);
        let high_default = AudioRingBuffer::recommended_capacity_samples(Some(192_000), 2);

        let low = streaming_default_capacity_samples(Some(44_100), low_default, budget);
        let high = streaming_default_capacity_samples(Some(192_000), high_default, budget);

        if let Some(prev) = prev {
            std::env::set_var("PMP_AUDIO_STREAMING_RESERVOIR_SECONDS", prev);
        } else {
            std::env::remove_var("PMP_AUDIO_STREAMING_RESERVOIR_SECONDS");
        }

        assert!(low >= low_default);
        assert!(high >= high_default);
        assert!(high > low);
    }

    #[test]
    fn streaming_default_capacity_applies_high_rate_scale() {
        let prev = std::env::var("PMP_AUDIO_STREAMING_RESERVOIR_SECONDS").ok();
        std::env::remove_var("PMP_AUDIO_STREAMING_RESERVOIR_SECONDS");

        let budget_samples = usize::MAX / 2;
        let default_floor = 32_768usize;
        let sample_rate = 192_000f64;
        let channels = 2.0f64;
        let base_seconds = 8.0f64;
        let unscaled = (sample_rate * channels * base_seconds).ceil() as usize;

        let scaled = streaming_default_capacity_samples(
            Some(sample_rate as u32),
            default_floor,
            budget_samples,
        );

        if let Some(prev) = prev {
            std::env::set_var("PMP_AUDIO_STREAMING_RESERVOIR_SECONDS", prev);
        } else {
            std::env::remove_var("PMP_AUDIO_STREAMING_RESERVOIR_SECONDS");
        }

        assert!(scaled < unscaled);
        assert!(scaled >= default_floor);
    }
}
