use std::fs::File;
use std::path::Path;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

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

use crate::audio::buffer::AudioRingBuffer;

use super::streaming::{
    drain_decoder_commands, DecoderCommand, SharedSamplesSource, StreamingPlayback, StreamingSamplesSource,
};

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
    let buffer = AudioRingBuffer::new(AudioRingBuffer::recommended_capacity_samples(
        output_sample_rate,
        2,
    ));

    let (command_tx, command_rx) = mpsc::channel::<DecoderCommand>();
    let (meta_tx, meta_rx) = mpsc::channel::<Result<AudioInputMeta, String>>();

    let path = path.to_path_buf();
    let buffer_clone = buffer.clone();
    let error = Arc::new(Mutex::new(None::<String>));
    let error_clone = error.clone();

    std::thread::Builder::new()
        .name("pmpm-symphonia-decoder".into())
        .spawn(move || {
            let _priority_guard = crate::audio::threading::promote_current_thread_for_audio_decode();

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
            let drained = drain_decoder_commands(&command_rx);
            if drained.shutdown {
                buffer_clone.mark_finished();
                return;
            }
            if let Some(target) = drained.seek_target {
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
        })
        .map_err(|e| {
            AudioInputError::new(
                "AUDIO_INPUT_SYMPHONIA_OPEN_FAILED",
                format!("Failed to spawn decoder thread: {e}"),
            )
        })?;

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
            left_state = left_state
                .wrapping_mul(1664525)
                .wrapping_add(1013904223);
            right_state = right_state
                .wrapping_mul(1664525)
                .wrapping_add(1013904223);

            let left_raw = (left_state >> 16) as i16;
            let right_raw = (right_state >> 16) as i16;
            let left = ((left_raw as i32) / 2) as i16;
            let right = ((right_raw as i32) / 2) as i16;

            file.write_all(&left.to_le_bytes()).unwrap();
            file.write_all(&right.to_le_bytes()).unwrap();
        }
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

        let decoded = decode_track_to_buffer(&path, Some(44_100)).expect("offline decode");
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
            hex,
            "051084cb673efd34323dc0630dbfefc5ab3e810457a65586c1bb5e66c834a7b2",
            "offline render output changed; if intentional, update the golden hash"
        );

        let _ = std::fs::remove_file(&path);
    }
}
