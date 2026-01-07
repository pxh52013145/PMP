use std::path::Path;
use std::sync::mpsc;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;

use dsf::DsfFile;

use super::symphonia::{AudioRingBuffer, DecoderCommand, StreamingPlayback, StreamingSamplesSource};
use super::{
    AudioInput, AudioInputError, AudioInputKind, AudioInputMeta, AudioInputOpenResult,
};

const MAX_PCM_SAMPLE_RATE: u32 = 384_000;

fn pick_decimation_factor(dsd_rate: u32) -> Result<u32, AudioInputError> {
    if dsd_rate == 0 {
        return Err(AudioInputError::new(
            "AUDIO_INPUT_SACD_INVALID_SAMPLE_RATE",
            "DSD sample rate must be > 0",
        ));
    }

    // Pick the smallest decimation factor (best quality) that keeps PCM sample rate reasonable.
    for factor in [32u32, 64, 128, 256] {
        if dsd_rate % factor != 0 {
            continue;
        }
        let pcm_rate = dsd_rate / factor;
        if pcm_rate == 0 {
            continue;
        }
        if pcm_rate <= MAX_PCM_SAMPLE_RATE {
            return Ok(factor);
        }
    }

    Err(AudioInputError::new(
        "AUDIO_INPUT_SACD_UNSUPPORTED_SAMPLE_RATE",
        format!("Unsupported DSD sample rate: {dsd_rate} Hz"),
    ))
}

fn dsd_ones_to_pcm(ones: u32, total_bits: u32) -> f32 {
    if total_bits == 0 {
        return 0.0;
    }
    let ones = ones as f32;
    let total = total_bits as f32;
    (ones * 2.0 - total) / total
}

fn start_dsf_stream(
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
        let init = (|| -> Result<(DsfFile, usize, u32, u64, u32), String> {
            let file = DsfFile::open(&path).map_err(|e| format!("Failed to open DSF: {e:?}"))?;
            let fmt = file.fmt_chunk();
            let channels = fmt.channel_num() as usize;
            let dsd_rate = fmt.sampling_frequency();
            let sample_count = fmt.sample_count();
            let decimation_factor = pick_decimation_factor(dsd_rate)
                .map_err(|e| format!("[{}] {}", e.code, e.message))?;
            Ok((file, channels, dsd_rate, sample_count, decimation_factor))
        })();

        let (mut dsf_file, channels, dsd_rate, sample_count, decimation_factor) = match init {
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

        if channels == 0 {
            let message = "Invalid DSF channel count".to_string();
            if let Ok(mut guard) = error_clone.lock() {
                *guard = Some(message.clone());
            }
            let _ = meta_tx.send(Err(message));
            buffer_clone.mark_finished();
            return;
        }

        let base_pcm_rate = dsd_rate / decimation_factor;
        let target_pcm_rate = output_sample_rate.unwrap_or(base_pcm_rate).max(1);
        let duration = if dsd_rate > 0 {
            (sample_count as f64) / (dsd_rate as f64)
        } else {
            0.0
        };

        let meta = AudioInputMeta {
            channels: channels as u16,
            sample_rate: target_pcm_rate,
            bit_depth: Some(1),
            duration,
        };
        let _ = meta_tx.send(Ok(meta.clone()));

        let mut cache_handle: Option<crate::audio::resample_cache::StreamingCacheHandle> = None;
        if let Some(key) = cache_key {
            cache_handle = crate::audio::resample_cache::start_streaming_cache(
                key,
                channels as u16,
                target_pcm_rate,
                meta.bit_depth,
            );
        }

        let resample_chunk_frames = 1024usize;
        let mut resampler: Option<crate::audio::resample::StreamingResampler> =
            if target_pcm_rate != base_pcm_rate {
                crate::audio::resample::StreamingResampler::new(
                    base_pcm_rate,
                    target_pcm_rate,
                    channels,
                    resample_chunk_frames,
                )
                .ok()
            } else {
                None
            };

        let mut iter = match dsf_file.interleaved_u32_samples_iter() {
            Ok(iter) => iter,
            Err(err) => {
                if let Ok(mut guard) = error_clone.lock() {
                    *guard = Some(format!("Failed to read DSF samples: {err:?}"));
                }
                buffer_clone.mark_finished();
                return;
            }
        };

        let words_per_pcm_sample = (decimation_factor / 32).max(1) as usize;
        let bits_per_pcm_sample = (words_per_pcm_sample as u32) * 32u32;
        let dsd_bits_per_pcm_sample = (words_per_pcm_sample as u64) * 32u64;

        let mut pcm_chunk: Vec<f32> = Vec::with_capacity(resample_chunk_frames * channels);
        let mut ones_per_channel: Vec<u32> = vec![0u32; channels];

        loop {
            while let Ok(cmd) = command_rx.try_recv() {
                match cmd {
                    DecoderCommand::Shutdown => {
                        if let Some(handle) = cache_handle.take() {
                            handle.finalize();
                        }
                        buffer_clone.mark_finished();
                        return;
                    }
                    DecoderCommand::Seek(target) => {
                        buffer_clone.clear();
                        pcm_chunk.clear();
                        for value in &mut ones_per_channel {
                            *value = 0;
                        }
                        if let Some(r) = resampler.as_mut() {
                            r.reset();
                        }
                        cache_handle = None;

                        let desired_dsd_sample = (target.max(0.0) * dsd_rate as f64) as u64;
                        let desired_dsd_sample =
                            desired_dsd_sample.min(sample_count.saturating_sub(1));
                        let aligned = if decimation_factor > 0 {
                            decimation_factor as u64 * (desired_dsd_sample / decimation_factor as u64)
                        } else {
                            0
                        };
                        if iter.set_sample_index(aligned).is_err() {
                            continue;
                        }
                    }
                }
            }

            let mut reached_eof = false;
            'decode: while pcm_chunk.len() < resample_chunk_frames * channels {
                if iter
                    .sample_index()
                    .saturating_add(dsd_bits_per_pcm_sample)
                    > sample_count
                {
                    reached_eof = true;
                    break 'decode;
                }

                for value in &mut ones_per_channel {
                    *value = 0;
                }

                for _ in 0..words_per_pcm_sample {
                    for channel_index in 0..channels {
                        let Some(word) = iter.next() else {
                            reached_eof = true;
                            break 'decode;
                        };
                        ones_per_channel[channel_index] =
                            ones_per_channel[channel_index].saturating_add(word.count_ones());
                    }
                }

                for channel_index in 0..channels {
                    pcm_chunk.push(dsd_ones_to_pcm(
                        ones_per_channel[channel_index],
                        bits_per_pcm_sample,
                    ));
                }
            }

            if pcm_chunk.is_empty() {
                if reached_eof {
                    if let Some(handle) = cache_handle.take() {
                        handle.finalize();
                    }
                    buffer_clone.mark_finished();
                    return;
                }
                continue;
            }

            let out_interleaved = if let Some(r) = resampler.as_mut() {
                let input = std::mem::take(&mut pcm_chunk);
                let out = r.process_interleaved(&input);
                pcm_chunk = input;
                pcm_chunk.clear();
                out
            } else {
                std::mem::replace(&mut pcm_chunk, Vec::with_capacity(resample_chunk_frames * channels))
            };

            if out_interleaved.is_empty() {
                if reached_eof {
                    if let Some(handle) = cache_handle.take() {
                        handle.finalize();
                    }
                    buffer_clone.mark_finished();
                    return;
                }
                continue;
            }

            let mut offset = 0usize;
            while offset < out_interleaved.len() {
                let remaining = &out_interleaved[offset..];
                let frames_pushed = buffer_clone.push_interleaved(remaining, channels);
                if frames_pushed == 0 {
                    std::thread::sleep(Duration::from_millis(5));
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

            if reached_eof {
                if let Some(handle) = cache_handle.take() {
                    handle.finalize();
                }
                buffer_clone.mark_finished();
                return;
            }
        }
    });

    let meta = match meta_rx.recv_timeout(Duration::from_secs(2)) {
        Ok(value) => value.map_err(|message| AudioInputError::new("AUDIO_INPUT_SACD_OPEN_FAILED", message))?,
        Err(err) => {
            let _ = command_tx.send(DecoderCommand::Shutdown);
            return Err(AudioInputError::new(
                "AUDIO_INPUT_SACD_OPEN_TIMEOUT",
                format!("Timed out initializing DSF decoder: {err}"),
            ));
        }
    };

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

#[derive(Default)]
pub(crate) struct SacdInput;

impl AudioInput for SacdInput {
    fn id(&self) -> &'static str {
        super::SACD_INPUT_ID
    }

    fn open(
        &self,
        path: &Path,
        output_sample_rate: Option<u32>,
    ) -> Result<AudioInputOpenResult, AudioInputError> {
        let ext = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();

        if ext != "dsf" {
            return Err(AudioInputError::new(
                "AUDIO_INPUT_SACD_UNSUPPORTED_PATH",
                "Not a DSF file",
            ));
        }

        let cache_key = crate::audio::resample_cache::key_for_resample(path, output_sample_rate);
        if let Some(key) = cache_key.as_deref() {
            if let Some(cached) = crate::audio::resample_cache::try_load(key) {
                let frames = cached.samples.len() / cached.channels as usize;
                let duration = if cached.sample_rate > 0 {
                    frames as f64 / cached.sample_rate as f64
                } else {
                    0.0
                };
                let source = Box::new(super::symphonia::SharedSamplesSource::new(
                    cached.samples.clone(),
                    cached.channels,
                    cached.sample_rate,
                    0,
                ));

                return Ok(AudioInputOpenResult {
                    input_id: self.id(),
                    meta: AudioInputMeta {
                        channels: cached.channels,
                        sample_rate: cached.sample_rate,
                        bit_depth: cached.bit_depth,
                        duration,
                    },
                    kind: AudioInputKind::Decoded {
                        samples: cached.samples,
                    },
                    source,
                });
            }
        }

        let (source, meta, streaming) = start_dsf_stream(path, output_sample_rate)?;

        Ok(AudioInputOpenResult {
            input_id: self.id(),
            meta,
            kind: AudioInputKind::Streaming(streaming),
            source: Box::new(source),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn write_minimal_dsf_stereo(path: &Path, dsd_rate: u32, fill: u8) {
        let channels = 2u32;
        let bits_per_sample = 1u32; // triggers reverse_bits in dsf crate
        let block_size = 4096u32;
        let samples_per_block = 8u64 * block_size as u64;
        let sample_count = samples_per_block; // 1 frame

        let data_bytes = (channels as u64) * (block_size as u64);
        let file_size = 28u64 + 52u64 + 12u64 + data_bytes;
        let data_chunk_size = 12u64 + data_bytes;

        let mut file = File::create(path).expect("create dsf");

        // DSD chunk (28 bytes)
        file.write_all(b"DSD ").unwrap();
        file.write_all(&28u64.to_le_bytes()).unwrap(); // chunk size
        file.write_all(&file_size.to_le_bytes()).unwrap();
        file.write_all(&0u64.to_le_bytes()).unwrap(); // metadata offset

        // FMT chunk (52 bytes)
        file.write_all(b"fmt ").unwrap();
        file.write_all(&52u64.to_le_bytes()).unwrap(); // chunk size
        file.write_all(&1u32.to_le_bytes()).unwrap(); // format version
        file.write_all(&0u32.to_le_bytes()).unwrap(); // format id
        file.write_all(&2u32.to_le_bytes()).unwrap(); // channel type: stereo
        file.write_all(&channels.to_le_bytes()).unwrap();
        file.write_all(&dsd_rate.to_le_bytes()).unwrap();
        file.write_all(&bits_per_sample.to_le_bytes()).unwrap();
        file.write_all(&sample_count.to_le_bytes()).unwrap();
        file.write_all(&block_size.to_le_bytes()).unwrap();
        file.write_all(&0u32.to_le_bytes()).unwrap(); // reserved

        // DATA chunk header (12 bytes)
        file.write_all(b"data").unwrap();
        file.write_all(&data_chunk_size.to_le_bytes()).unwrap();

        // sample data: 1 frame = channels * 4096 bytes
        let block = vec![fill; block_size as usize];
        for _ in 0..channels {
            file.write_all(&block).unwrap();
        }
    }

    fn write_minimal_dsf_stereo_split(path: &Path, dsd_rate: u32, first: u8, second: u8) {
        let channels = 2u32;
        let bits_per_sample = 1u32; // triggers reverse_bits in dsf crate
        let block_size = 4096u32;
        let samples_per_block = 8u64 * block_size as u64;
        let sample_count = samples_per_block; // 1 frame

        let data_bytes = (channels as u64) * (block_size as u64);
        let file_size = 28u64 + 52u64 + 12u64 + data_bytes;
        let data_chunk_size = 12u64 + data_bytes;

        let mut file = File::create(path).expect("create dsf");

        // DSD chunk (28 bytes)
        file.write_all(b"DSD ").unwrap();
        file.write_all(&28u64.to_le_bytes()).unwrap(); // chunk size
        file.write_all(&file_size.to_le_bytes()).unwrap();
        file.write_all(&0u64.to_le_bytes()).unwrap(); // metadata offset

        // FMT chunk (52 bytes)
        file.write_all(b"fmt ").unwrap();
        file.write_all(&52u64.to_le_bytes()).unwrap(); // chunk size
        file.write_all(&1u32.to_le_bytes()).unwrap(); // format version
        file.write_all(&0u32.to_le_bytes()).unwrap(); // format id
        file.write_all(&2u32.to_le_bytes()).unwrap(); // channel type: stereo
        file.write_all(&channels.to_le_bytes()).unwrap();
        file.write_all(&dsd_rate.to_le_bytes()).unwrap();
        file.write_all(&bits_per_sample.to_le_bytes()).unwrap();
        file.write_all(&sample_count.to_le_bytes()).unwrap();
        file.write_all(&block_size.to_le_bytes()).unwrap();
        file.write_all(&0u32.to_le_bytes()).unwrap(); // reserved

        // DATA chunk header (12 bytes)
        file.write_all(b"data").unwrap();
        file.write_all(&data_chunk_size.to_le_bytes()).unwrap();

        // sample data: 1 frame = channels * 4096 bytes
        let half = (block_size as usize).saturating_div(2);
        let mut block = vec![first; block_size as usize];
        for byte in block.iter_mut().skip(half) {
            *byte = second;
        }
        for _ in 0..channels {
            file.write_all(&block).unwrap();
        }
    }

    #[test]
    fn pick_decimation_factor_prefers_quality_under_max_pcm_rate() {
        assert_eq!(pick_decimation_factor(2_822_400).unwrap(), 32); // 88.2kHz
        assert_eq!(pick_decimation_factor(3_072_000).unwrap(), 32); // 96kHz
        assert_eq!(pick_decimation_factor(11_289_600).unwrap(), 32); // 352.8kHz
        assert_eq!(pick_decimation_factor(12_288_000).unwrap(), 32); // 384kHz
        assert_eq!(pick_decimation_factor(22_579_200).unwrap(), 64); // 352.8kHz (32 would exceed)
        assert_eq!(pick_decimation_factor(24_576_000).unwrap(), 64); // 384kHz (32 would exceed)
    }

    #[test]
    fn dsf_input_reports_expected_pcm_rate() {
        let tmp_dir = std::env::temp_dir();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time ok")
            .as_nanos();
        let path = tmp_dir.join(format!("pmp_test_{nonce}.dsf"));

        write_minimal_dsf_stereo(&path, 2_822_400, 0xAA);

        let input = SacdInput::default();
        let opened = input.open(&path, None).expect("open dsf");
        assert_eq!(opened.meta.channels, 2);
        assert_eq!(opened.meta.sample_rate, 88_200);
        assert!(opened.meta.duration > 0.0);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn dsf_decode_emits_pcm_samples() {
        let tmp_dir = std::env::temp_dir();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time ok")
            .as_nanos();
        let path = tmp_dir.join(format!("pmp_test_{nonce}.dsf"));

        // All ones => +1.0 after averaging.
        write_minimal_dsf_stereo(&path, 2_822_400, 0xFF);

        let input = SacdInput::default();
        let opened = input.open(&path, None).expect("open dsf");
        let AudioInputKind::Streaming(streaming) = opened.kind else {
            panic!("expected streaming kind");
        };

        streaming
            .buffer
            .wait_for_samples(64, Duration::from_millis(200));

        let mut iter = opened.source.take(32);
        for _ in 0..32 {
            let sample = iter.next().unwrap_or(0.0);
            assert!(sample.is_finite());
            assert!(sample > 0.8, "sample={sample}");
        }

        let _ = streaming.command_tx.send(DecoderCommand::Shutdown);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn dsf_seek_jumps_to_expected_region() {
        let tmp_dir = std::env::temp_dir();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time ok")
            .as_nanos();
        let path = tmp_dir.join(format!("pmp_test_{nonce}.dsf"));

        // First half = ones (+1.0), second half = zeros (-1.0).
        write_minimal_dsf_stereo_split(&path, 2_822_400, 0xFF, 0x00);

        let input = SacdInput::default();
        let opened = input.open(&path, None).expect("open dsf");
        let AudioInputKind::Streaming(streaming) = opened.kind else {
            panic!("expected streaming kind");
        };

        streaming
            .buffer
            .wait_for_samples(128, Duration::from_millis(200));

        let duration = opened.meta.duration;
        let mut iter = opened.source;
        let first = iter.next().unwrap_or(0.0);
        assert!(first.is_finite());
        assert!(first > 0.8, "first sample={first}");

        let seek_target = duration * 0.75;
        let _ = streaming.command_tx.send(DecoderCommand::Seek(seek_target));
        streaming
            .buffer
            .wait_for_samples(256, Duration::from_millis(500));

        let mut saw_negative = false;
        for _ in 0..8192 {
            let sample = iter.next().unwrap_or(0.0);
            if sample < -0.8 {
                saw_negative = true;
                break;
            }
        }
        assert!(saw_negative, "expected negative samples after seek");

        let _ = streaming.command_tx.send(DecoderCommand::Shutdown);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn dsf_resamples_to_requested_output_rate() {
        let tmp_dir = std::env::temp_dir();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time ok")
            .as_nanos();
        let path = tmp_dir.join(format!("pmp_test_{nonce}.dsf"));

        write_minimal_dsf_stereo(&path, 2_822_400, 0xFF);

        let input = SacdInput::default();
        let opened = input.open(&path, Some(48_000)).expect("open dsf");
        assert_eq!(opened.meta.sample_rate, 48_000);

        let AudioInputKind::Streaming(streaming) = opened.kind else {
            panic!("expected streaming kind");
        };

        streaming
            .buffer
            .wait_for_samples(128, Duration::from_millis(500));

        let mut iter = opened.source.take(64);
        for _ in 0..64 {
            let sample = iter.next().unwrap_or(0.0);
            assert!(sample.is_finite());
            assert!(sample > 0.2, "sample={sample}");
        }

        let _ = streaming.command_tx.send(DecoderCommand::Shutdown);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn dsd_ones_to_pcm_maps_extremes() {
        assert!((dsd_ones_to_pcm(0, 32) + 1.0).abs() < 1e-6);
        assert!((dsd_ones_to_pcm(32, 32) - 1.0).abs() < 1e-6);
        assert!(dsd_ones_to_pcm(16, 32).abs() < 1e-6);
    }
}
