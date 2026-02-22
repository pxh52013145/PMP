use std::path::Path;
use std::sync::mpsc;
use std::sync::Arc;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use dsf::DsfFile;

use crate::audio::dsd2pcm::Dsd2PcmContext;

use crate::audio::buffer::AudioRingBuffer;
use crate::audio::buffer_policy;

use super::streaming::{
    drain_decoder_commands, spawn_render_transfer_worker, try_lock_render_queue_hot_path,
    DecoderCommand, StreamingPlayback, StreamingSamplesSource, StreamingShutdownTx,
    TransferCommand,
};
use super::{
    AudioInput, AudioInputDecodeMode, AudioInputError, AudioInputKind, AudioInputMeta,
    AudioInputOpenResult, AudioInputSrcPolicy,
};

const MAX_PCM_SAMPLE_RATE: u32 = 384_000;
const SACD_DSD_TO_PCM_DECIMATOR_TAPS: usize = 255;
const SACD_DSD_TO_PCM_MAX_CUTOFF_HZ: f32 = 20_000.0;
const SACD_DSD_TO_PCM_CUTOFF_NYQUIST_RATIO: f32 = 0.45;
const SACD_DSD2PCM_MIN_CHUNK_FRAMES: usize = 4096;

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

fn dsd_lowpass_cutoff_hz(base_pcm_rate: u32) -> f32 {
    let base_pcm_rate = base_pcm_rate.max(1) as f32;
    let nyquist = base_pcm_rate * 0.5;
    let cutoff =
        (nyquist * SACD_DSD_TO_PCM_CUTOFF_NYQUIST_RATIO).min(SACD_DSD_TO_PCM_MAX_CUTOFF_HZ);
    cutoff.clamp(2000.0, nyquist * 0.99)
}

fn blackman_window(n: usize, len: usize) -> f32 {
    if len <= 1 {
        return 1.0;
    }
    let a0 = 0.42f32;
    let a1 = 0.5f32;
    let a2 = 0.08f32;
    let phase = 2.0 * std::f32::consts::PI * (n as f32) / ((len - 1) as f32);
    a0 - a1 * phase.cos() + a2 * (2.0 * phase).cos()
}

fn design_lowpass_fir(sample_rate: u32, cutoff_hz: f32, taps: usize) -> Vec<f32> {
    let taps = taps.max(3) | 1; // ensure odd
    let sample_rate = sample_rate.max(1) as f32;
    let cutoff_hz = cutoff_hz.clamp(1.0, (sample_rate * 0.5) * 0.99);
    let fc = cutoff_hz / sample_rate; // cycles/sample (0..0.5)

    let mid = (taps / 2) as i32;
    let mut coeffs: Vec<f32> = Vec::with_capacity(taps);

    for n in 0..taps {
        let t = (n as i32) - mid;
        let x = 2.0 * fc * (t as f32);
        let sinc = if x.abs() < 1e-8 {
            1.0
        } else {
            (std::f32::consts::PI * x).sin() / (std::f32::consts::PI * x)
        };
        let ideal = 2.0 * fc * sinc;
        let window = blackman_window(n, taps);
        coeffs.push(ideal * window);
    }

    let sum: f32 = coeffs.iter().sum();
    if sum.abs() > 1e-12 {
        for c in &mut coeffs {
            *c /= sum;
        }
    }

    coeffs
}

struct StreamingFirDecimator {
    taps: Vec<f32>,
    history: Vec<f32>,
    pos: usize,
    channels: usize,
    decimation: usize,
    phase: usize,
}

impl StreamingFirDecimator {
    fn new(
        input_sample_rate: u32,
        output_sample_rate: u32,
        channels: usize,
        decimation: usize,
    ) -> Self {
        let channels = channels.max(1);
        let decimation = decimation.max(1);
        let cutoff = dsd_lowpass_cutoff_hz(output_sample_rate);
        let taps = design_lowpass_fir(input_sample_rate, cutoff, SACD_DSD_TO_PCM_DECIMATOR_TAPS);
        let history = vec![0.0; taps.len().saturating_mul(channels)];

        Self {
            taps,
            history,
            pos: 0,
            channels,
            decimation,
            phase: 0,
        }
    }

    fn reset(&mut self) {
        self.pos = 0;
        self.phase = 0;
        for value in &mut self.history {
            *value = 0.0;
        }
    }

    fn process_interleaved(&mut self, input: &[f32]) -> Vec<f32> {
        if self.channels == 0 || self.taps.is_empty() {
            return Vec::new();
        }

        let frames = input.len() / self.channels;
        if frames == 0 {
            return Vec::new();
        }

        let taps_len = self.taps.len();
        let expected_out_frames = (frames + self.decimation - 1) / self.decimation;
        let mut out: Vec<f32> = Vec::with_capacity(expected_out_frames * self.channels);

        for frame in 0..frames {
            for ch in 0..self.channels {
                let sample = input[frame * self.channels + ch];
                let base = ch * taps_len;
                self.history[base + self.pos] = sample;
            }

            if self.phase == 0 {
                for ch in 0..self.channels {
                    let base = ch * taps_len;
                    let mut acc = 0.0f32;
                    let mut idx = self.pos;
                    for tap in &self.taps {
                        acc += *tap * self.history[base + idx];
                        idx = if idx == 0 { taps_len - 1 } else { idx - 1 };
                    }
                    out.push(acc);
                }
            }

            self.pos += 1;
            if self.pos >= taps_len {
                self.pos = 0;
            }

            self.phase += 1;
            if self.phase >= self.decimation {
                self.phase = 0;
            }
        }

        out
    }
}

fn start_dsf_stream(
    path: &Path,
    output_sample_rate: Option<u32>,
    src_policy: AudioInputSrcPolicy,
) -> Result<(StreamingSamplesSource, AudioInputMeta, StreamingPlayback), AudioInputError> {
    let buffer = AudioRingBuffer::new(AudioRingBuffer::recommended_capacity_samples(
        output_sample_rate,
        2,
    ));
    let render_queue_capacity =
        buffer_policy::recommended_render_queue_capacity_samples(output_sample_rate, 2)
            .min(buffer.capacity_samples().max(16_384));
    let render_queue = AudioRingBuffer::new(render_queue_capacity);
    try_lock_render_queue_hot_path(&render_queue);

    let (command_tx, command_rx) = mpsc::channel::<DecoderCommand>();
    let (transfer_tx, transfer_rx) = mpsc::channel::<TransferCommand>();
    let (meta_tx, meta_rx) = mpsc::channel::<Result<AudioInputMeta, String>>();

    let path = path.to_path_buf();
    let buffer_clone = buffer.clone();
    let render_queue_clone = render_queue.clone();
    let error = Arc::new(Mutex::new(None::<String>));
    let error_clone = error.clone();

    thread::Builder::new()
        .name("pmpm-sacd-dsf-decoder".into())
        .spawn(move || {
            let _priority_guard =
                crate::audio::threading::promote_current_thread_for_audio_decode();
            crate::audio::threading::apply_audio_decode_pressure_profile(
                crate::audio::realtime_scheduler::SCHEDULER.profile(),
            );

            let meta_tx_panic = meta_tx.clone();
            let buffer_panic = buffer_clone.clone();
            let error_panic = error_clone.clone();

            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let init = (|| -> Result<(DsfFile, usize, u32, u64, u32), String> {
                    let file =
                        DsfFile::open(&path).map_err(|e| format!("Failed to open DSF: {e:?}"))?;
                    let fmt = file.fmt_chunk();
                    let channels = fmt.channel_num() as usize;
                    let dsd_rate = fmt.sampling_frequency();
                    let sample_count_raw = fmt.sample_count();
                    let samples_per_frame = u64::from(fmt.block_size_per_channel())
                        .saturating_mul(8)
                        .max(1);
                    // The dsf crate's streaming iterator assumes the sample count is aligned to full frames
                    // (4096 bytes per channel => 32768 1-bit samples per frame). Some files report a
                    // non-aligned count, which can trigger a debug assertion near EOF. Clamp to the last
                    // full frame to avoid panics and stuck playback.
                    let sample_count =
                        (sample_count_raw / samples_per_frame).saturating_mul(samples_per_frame);
                    if sample_count == 0 {
                        return Err("Invalid DSF sample count".to_string());
                    }
                    let decimation_factor = pick_decimation_factor(dsd_rate)
                        .map_err(|e| format!("[{}] {}", e.code, e.message))?;
                    Ok((file, channels, dsd_rate, sample_count, decimation_factor))
                })();

                let (mut dsf_file, channels, dsd_rate, sample_count, decimation_factor) = match init
                {
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
                    source_sample_rate: base_pcm_rate,
                    bit_depth: Some(1),
                    duration,
                };
                let _ = meta_tx.send(Ok(meta.clone()));

                let dsd_byte_rate = if dsd_rate % 8 == 0 { dsd_rate / 8 } else { 0 };
                if dsd_byte_rate == 0 {
                    if let Ok(mut guard) = error_clone.lock() {
                        *guard = Some(format!("Unsupported DSD sample rate: {dsd_rate} Hz"));
                    }
                    buffer_clone.mark_finished();
                    return;
                }

                let decimation_ratio = (decimation_factor / 8).max(1) as usize;
                let mut dsd2pcm: Vec<Dsd2PcmContext> =
                    (0..channels).map(|_| Dsd2PcmContext::default()).collect();
                let mut decimator = StreamingFirDecimator::new(
                    dsd_byte_rate,
                    base_pcm_rate,
                    channels,
                    decimation_ratio,
                );

                let resample_chunk_frames = 256usize;
                let mut resampler: Option<crate::audio::resample::StreamingResampler> =
                    if target_pcm_rate != base_pcm_rate {
                        crate::audio::resample::StreamingResampler::new_with_policy(
                            base_pcm_rate,
                            target_pcm_rate,
                            channels,
                            resample_chunk_frames,
                            src_policy.hq_src_enabled,
                            src_policy.hq_src_phase_mode,
                            src_policy.src_backend,
                        )
                        .ok()
                    } else {
                        None
                    };

                let mut stage1_chunk_frames =
                    SACD_DSD2PCM_MIN_CHUNK_FRAMES.max(resample_chunk_frames * decimation_ratio);
                stage1_chunk_frames = stage1_chunk_frames.saturating_sub(stage1_chunk_frames % 4);
                let stage1_chunk_samples = stage1_chunk_frames.saturating_mul(channels);

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

                let mut pcm8_chunk: Vec<f32> = Vec::with_capacity(stage1_chunk_samples);
                let mut words: Vec<u32> = vec![0u32; channels];

                'decode_loop: loop {
                    let profile = crate::audio::realtime_scheduler::SCHEDULER.profile();
                    crate::audio::threading::apply_audio_decode_pressure_profile(profile);
                    let decode_backoff = buffer_policy::decode_push_backoff(profile);
                    let eof_wait_backoff = decode_backoff.max(Duration::from_millis(10));
                    let drained = drain_decoder_commands(&command_rx);
                    if drained.shutdown {
                        buffer_clone.mark_finished();
                        return;
                    }
                    if let Some(target) = drained.seek_target {
                        buffer_clone.clear();
                        pcm8_chunk.clear();
                        for ctx in &mut dsd2pcm {
                            ctx.reset();
                        }
                        decimator.reset();
                        if let Some(r) = resampler.as_mut() {
                            r.reset();
                        }

                        let desired_dsd_sample = (target.max(0.0) * dsd_rate as f64) as u64;
                        let desired_dsd_sample =
                            desired_dsd_sample.min(sample_count.saturating_sub(1));
                        let aligned = if decimation_factor > 0 {
                            decimation_factor as u64
                                * (desired_dsd_sample / decimation_factor as u64)
                        } else {
                            0
                        };
                        let _ = iter.set_sample_index(aligned);
                    }

                    let mut reached_eof = false;
                    'decode: while pcm8_chunk.len() < stage1_chunk_samples {
                        if iter.sample_index() >= sample_count {
                            reached_eof = true;
                            break 'decode;
                        }

                        for channel_index in 0..channels {
                            let Some(word) = iter.next() else {
                                reached_eof = true;
                                break 'decode;
                            };
                            words[channel_index] = word;
                        }

                        // Each u32 represents 4 bytes per channel, i.e. 32 DSD 1-bit samples. The dsd2pcm
                        // stage consumes bytes and outputs PCM at dsd_rate/8 (one float per byte).
                        for byte_index in 0..4usize {
                            for channel_index in 0..channels {
                                let byte =
                                    ((words[channel_index] >> (byte_index * 8)) & 0xFF) as u8;
                                let value = dsd2pcm[channel_index].translate_byte_msbf(byte);
                                pcm8_chunk.push(value);
                            }

                            if pcm8_chunk.len() >= stage1_chunk_samples {
                                break 'decode;
                            }
                        }
                    }

                    if pcm8_chunk.is_empty() {
                        if reached_eof {
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
                                    pcm8_chunk.clear();
                                    for ctx in &mut dsd2pcm {
                                        ctx.reset();
                                    }
                                    decimator.reset();
                                    if let Some(r) = resampler.as_mut() {
                                        r.reset();
                                    }

                                    let desired_dsd_sample =
                                        (target.max(0.0) * dsd_rate as f64) as u64;
                                    let desired_dsd_sample =
                                        desired_dsd_sample.min(sample_count.saturating_sub(1));
                                    let aligned = if decimation_factor > 0 {
                                        decimation_factor as u64
                                            * (desired_dsd_sample / decimation_factor as u64)
                                    } else {
                                        0
                                    };
                                    let _ = iter.set_sample_index(aligned);
                                    continue 'decode_loop;
                                }
                            }
                        }
                        continue;
                    }

                    if reached_eof && pcm8_chunk.len() < stage1_chunk_samples {
                        let missing_samples = stage1_chunk_samples - pcm8_chunk.len();
                        let missing_frames = missing_samples / channels;
                        for _ in 0..missing_frames {
                            for ch in 0..channels {
                                pcm8_chunk.push(dsd2pcm[ch].translate_byte_msbf(0x00));
                            }
                        }
                    }

                    let base_pcm = decimator.process_interleaved(&pcm8_chunk);
                    pcm8_chunk.clear();

                    let out_interleaved = if let Some(r) = resampler.as_mut() {
                        r.process_interleaved(&base_pcm)
                    } else {
                        base_pcm
                    };

                    if out_interleaved.is_empty() {
                        if reached_eof {
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
                                    pcm8_chunk.clear();
                                    for ctx in &mut dsd2pcm {
                                        ctx.reset();
                                    }
                                    decimator.reset();
                                    if let Some(r) = resampler.as_mut() {
                                        r.reset();
                                    }

                                    let desired_dsd_sample =
                                        (target.max(0.0) * dsd_rate as f64) as u64;
                                    let desired_dsd_sample =
                                        desired_dsd_sample.min(sample_count.saturating_sub(1));
                                    let aligned = if decimation_factor > 0 {
                                        decimation_factor as u64
                                            * (desired_dsd_sample / decimation_factor as u64)
                                    } else {
                                        0
                                    };
                                    let _ = iter.set_sample_index(aligned);
                                    continue 'decode_loop;
                                }
                            }
                        }
                        continue;
                    }

                    let mut offset = 0usize;
                    while offset < out_interleaved.len() {
                        let drained = drain_decoder_commands(&command_rx);
                        if drained.shutdown {
                            buffer_clone.mark_finished();
                            return;
                        }
                        if let Some(target) = drained.seek_target {
                            buffer_clone.clear();
                            render_queue_clone.clear();
                            pcm8_chunk.clear();
                            for ctx in &mut dsd2pcm {
                                ctx.reset();
                            }
                            decimator.reset();
                            if let Some(r) = resampler.as_mut() {
                                r.reset();
                            }

                            let desired_dsd_sample = (target.max(0.0) * dsd_rate as f64) as u64;
                            let desired_dsd_sample =
                                desired_dsd_sample.min(sample_count.saturating_sub(1));
                            let aligned = if decimation_factor > 0 {
                                decimation_factor as u64
                                    * (desired_dsd_sample / decimation_factor as u64)
                            } else {
                                0
                            };
                            let _ = iter.set_sample_index(aligned);
                            continue 'decode_loop;
                        }

                        let remaining = &out_interleaved[offset..];
                        let frames_pushed = buffer_clone.push_interleaved(remaining, channels);
                        if frames_pushed == 0 {
                            if decode_backoff.is_zero() {
                                std::thread::yield_now();
                            } else {
                                std::thread::sleep(decode_backoff);
                            }
                            continue;
                        }
                        offset += frames_pushed * channels;
                    }

                    if reached_eof {
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
                                pcm8_chunk.clear();
                                for ctx in &mut dsd2pcm {
                                    ctx.reset();
                                }
                                decimator.reset();
                                if let Some(r) = resampler.as_mut() {
                                    r.reset();
                                }

                                let desired_dsd_sample = (target.max(0.0) * dsd_rate as f64) as u64;
                                let desired_dsd_sample =
                                    desired_dsd_sample.min(sample_count.saturating_sub(1));
                                let aligned = if decimation_factor > 0 {
                                    decimation_factor as u64
                                        * (desired_dsd_sample / decimation_factor as u64)
                                } else {
                                    0
                                };
                                let _ = iter.set_sample_index(aligned);
                                continue 'decode_loop;
                            }
                        }
                    }
                }
            }));

            if let Err(payload) = result {
                let panic_message = if let Some(message) = payload.downcast_ref::<&str>() {
                    message.to_string()
                } else if let Some(message) = payload.downcast_ref::<String>() {
                    message.clone()
                } else {
                    "Unknown panic".to_string()
                };
                let message = format!("DSF decoder panicked: {panic_message}");
                if let Ok(mut guard) = error_panic.lock() {
                    *guard = Some(message.clone());
                }
                let _ = meta_tx_panic.send(Err(message.clone()));
                buffer_panic.mark_finished();
            }
        })
        .map_err(|e| {
            AudioInputError::new(
                "AUDIO_INPUT_SACD_OPEN_FAILED",
                format!("Failed to spawn DSF decoder thread: {e}"),
            )
        })?;

    let meta = match meta_rx.recv_timeout(Duration::from_secs(2)) {
        Ok(value) => value
            .map_err(|message| AudioInputError::new("AUDIO_INPUT_SACD_OPEN_FAILED", message))?,
        Err(err) => {
            let _ = command_tx.send(DecoderCommand::Shutdown);
            return Err(AudioInputError::new(
                "AUDIO_INPUT_SACD_OPEN_TIMEOUT",
                format!("Timed out initializing DSF decoder: {err}"),
            ));
        }
    };

    if let Err(err) = spawn_render_transfer_worker(
        buffer.clone(),
        render_queue.clone(),
        meta.channels,
        meta.sample_rate,
        transfer_rx,
        "pmpm-sacd-transfer",
    ) {
        let _ = transfer_tx.send(TransferCommand::Shutdown);
        let _ = command_tx.send(DecoderCommand::Shutdown);
        return Err(AudioInputError::new("AUDIO_INPUT_SACD_OPEN_FAILED", err));
    }

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
        _decode_mode: AudioInputDecodeMode,
        src_policy: AudioInputSrcPolicy,
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

        let (source, meta, streaming) = start_dsf_stream(path, output_sample_rate, src_policy)?;

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
        let opened = input
            .open(
                &path,
                None,
                AudioInputDecodeMode::Streaming,
                AudioInputSrcPolicy::default(),
            )
            .expect("open dsf");
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
        let opened = input
            .open(
                &path,
                None,
                AudioInputDecodeMode::Streaming,
                AudioInputSrcPolicy::default(),
            )
            .expect("open dsf");
        let AudioInputKind::Streaming(streaming) = opened.kind else {
            panic!("expected streaming kind");
        };

        streaming
            .render_queue
            .wait_for_samples(2048, Duration::from_millis(1_500));

        let channels = opened.meta.channels as usize;
        let mut iter = opened.source;
        let warmup_samples = SACD_DSD_TO_PCM_DECIMATOR_TAPS * channels;
        for _ in 0..warmup_samples {
            let sample = iter.next().unwrap_or(0.0);
            assert!(sample.is_finite());
        }

        let mut saw_high = false;
        for _ in 0..4096 {
            let sample = iter.next().unwrap_or(0.0);
            assert!(sample.is_finite());
            if sample > 0.2 {
                saw_high = true;
                break;
            }
        }
        assert!(saw_high, "expected high samples after warm-up");

        streaming.shutdown_tx.shutdown();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn dsf_silence_pattern_decodes_near_zero() {
        let tmp_dir = std::env::temp_dir();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time ok")
            .as_nanos();
        let path = tmp_dir.join(format!("pmp_test_{nonce}.dsf"));

        // DSD "digital silence" often looks like a fast alternating pattern.
        write_minimal_dsf_stereo(&path, 2_822_400, 0xAA);

        let input = SacdInput::default();
        let opened = input
            .open(
                &path,
                None,
                AudioInputDecodeMode::Streaming,
                AudioInputSrcPolicy::default(),
            )
            .expect("open dsf");
        let AudioInputKind::Streaming(streaming) = opened.kind else {
            panic!("expected streaming kind");
        };

        streaming
            .render_queue
            .wait_for_samples(2048, Duration::from_millis(1_500));

        let channels = opened.meta.channels as usize;
        let mut iter = opened.source;

        let warmup_samples = SACD_DSD_TO_PCM_DECIMATOR_TAPS * channels;
        for _ in 0..warmup_samples {
            let sample = iter.next().unwrap_or(0.0);
            assert!(sample.is_finite());
        }

        let sample_count = 4096usize * channels;
        let mut sum = 0.0f64;
        let mut sum_sq = 0.0f64;
        for _ in 0..sample_count {
            let sample = iter.next().unwrap_or(0.0) as f64;
            sum += sample;
            sum_sq += sample * sample;
        }
        let mean = sum / (sample_count as f64).max(1.0);
        let rms = (sum_sq / (sample_count as f64).max(1.0)).sqrt();

        assert!(mean.abs() < 0.02, "mean={mean}");
        assert!(rms < 0.05, "rms={rms}");

        streaming.shutdown_tx.shutdown();
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
        let opened = input
            .open(
                &path,
                None,
                AudioInputDecodeMode::Streaming,
                AudioInputSrcPolicy::default(),
            )
            .expect("open dsf");
        let AudioInputKind::Streaming(streaming) = opened.kind else {
            panic!("expected streaming kind");
        };

        streaming
            .render_queue
            .wait_for_samples(128, Duration::from_millis(800));

        let duration = opened.meta.duration;
        let channels = opened.meta.channels as usize;
        let mut iter = opened.source;
        let warmup_samples = SACD_DSD_TO_PCM_DECIMATOR_TAPS * channels;
        for _ in 0..warmup_samples {
            let sample = iter.next().unwrap_or(0.0);
            assert!(sample.is_finite());
        }
        let mut saw_positive = false;
        for _ in 0..4096 {
            let sample = iter.next().unwrap_or(0.0);
            assert!(sample.is_finite());
            if sample > 0.2 {
                saw_positive = true;
                break;
            }
        }
        assert!(saw_positive, "expected positive samples before seek");

        let seek_target = duration * 0.75;
        let _ = streaming.command_tx.send(DecoderCommand::Seek(seek_target));
        streaming
            .render_queue
            .wait_for_samples(256, Duration::from_millis(1_500));

        let mut saw_negative = false;
        for _ in 0..8192 {
            let sample = iter.next().unwrap_or(0.0);
            if sample < -0.2 {
                saw_negative = true;
                break;
            }
        }
        assert!(saw_negative, "expected negative samples after seek");

        streaming.shutdown_tx.shutdown();
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
        let opened = input
            .open(
                &path,
                Some(48_000),
                AudioInputDecodeMode::Streaming,
                AudioInputSrcPolicy::default(),
            )
            .expect("open dsf");
        assert_eq!(opened.meta.sample_rate, 48_000);

        let AudioInputKind::Streaming(streaming) = opened.kind else {
            panic!("expected streaming kind");
        };

        streaming
            .render_queue
            .wait_for_samples(256, Duration::from_millis(1_500));

        let mut iter = opened.source;
        let mut saw_high = false;
        for _ in 0..8192 {
            let Some(sample) = iter.next() else { break };
            assert!(sample.is_finite());
            if sample > 0.2 {
                saw_high = true;
                break;
            }
        }
        assert!(saw_high, "expected audible samples after resample");

        streaming.shutdown_tx.shutdown();
        let _ = std::fs::remove_file(&path);
    }
}
