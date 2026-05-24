use std::fs::File;
use std::path::Path;

use symphonia::core::{
    codecs::DecoderOptions,
    errors::Error as SymphoniaError,
    formats::{FormatOptions, FormatReader, SeekMode, SeekTo, Track},
    io::{MediaSourceStream, MediaSourceStreamOptions},
    meta::MetadataOptions,
    probe::{Hint, ProbeResult},
    units::Time,
};

pub(crate) fn build_hint_from_extension(extension: Option<&str>) -> Hint {
    let mut hint = Hint::new();
    if let Some(extension) = extension {
        hint.with_extension(extension);
    }
    hint
}

pub(crate) fn build_hint_from_path(path: &Path) -> Hint {
    build_hint_from_extension(path.extension().and_then(|value| value.to_str()))
}

pub(crate) fn probe_local_format(
    path: &Path,
    format_options: &FormatOptions,
    metadata_options: &MetadataOptions,
) -> Result<ProbeResult, String> {
    let file = File::open(path).map_err(|error| format!("Failed to open file: {error}"))?;
    let mss = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());
    let hint = build_hint_from_path(path);
    symphonia::default::get_probe()
        .format(&hint, mss, format_options, metadata_options)
        .map_err(|error| format!("Failed to probe format: {error}"))
}

pub(crate) fn track_is_audio_like(track: &Track) -> bool {
    track.codec_params.sample_rate.is_some()
        || track.codec_params.channels.is_some()
        || track.codec_params.bits_per_sample.is_some()
        || track.codec_params.bits_per_coded_sample.is_some()
}

pub(crate) fn pick_audio_track<'a>(format: &'a dyn FormatReader) -> Option<&'a Track> {
    let tracks = format.tracks();
    let default = format.default_track();
    if let Some(track) = default {
        if track_is_audio_like(track) {
            return Some(track);
        }
    }
    tracks
        .iter()
        .find(|track| track_is_audio_like(track))
        .or(default)
        .or_else(|| tracks.first())
}

pub(crate) fn duration_from_track_params(track: &Track) -> Option<f64> {
    track
        .codec_params
        .n_frames
        .and_then(|frames| {
            track
                .codec_params
                .sample_rate
                .filter(|sample_rate| *sample_rate > 0)
                .map(|sample_rate| frames as f64 / sample_rate as f64)
        })
        .filter(|duration| *duration > 0.0)
}

pub(crate) fn duration_from_track_or_estimate(
    format: &mut dyn FormatReader,
    track: &Track,
) -> Option<f64> {
    duration_from_track_params(track).or_else(|| estimate_duration_from_reader(format, track))
}

pub(crate) fn probe_local_duration(path: &Path) -> Option<f64> {
    let mut probed =
        probe_local_format(path, &FormatOptions::default(), &MetadataOptions::default()).ok()?;
    let track = pick_audio_track(probed.format.as_ref())?.clone();
    duration_from_track_or_estimate(probed.format.as_mut(), &track)
}

pub(crate) fn estimate_duration_from_reader(
    format: &mut dyn FormatReader,
    track: &Track,
) -> Option<f64> {
    if let Some(time_base) = track.codec_params.time_base {
        let mut first_ts: Option<u64> = None;
        let mut last_end_ts: Option<u64> = None;

        loop {
            let packet = match format.next_packet() {
                Ok(packet) => packet,
                Err(SymphoniaError::IoError(error))
                    if error.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    break;
                }
                Err(SymphoniaError::ResetRequired) => return None,
                Err(_) => return None,
            };

            if packet.track_id() != track.id {
                continue;
            }

            let packet_start_ts = packet.ts();
            let packet_end_ts = packet_start_ts.saturating_add(packet.dur());
            first_ts.get_or_insert(packet_start_ts);
            last_end_ts = Some(match last_end_ts {
                Some(existing) => existing.max(packet_end_ts),
                None => packet_end_ts,
            });
        }

        if let (Some(start_ts), Some(end_ts)) = (first_ts, last_end_ts) {
            let duration = time_base.calc_time(end_ts.saturating_sub(start_ts));
            let duration = duration.seconds as f64 + duration.frac;
            if duration > 0.0 {
                return Some(duration);
            }
        }
    }

    let seek_to = SeekTo::Time {
        time: Time::from(0.0),
        track_id: Some(track.id),
    };
    if format.seek(SeekMode::Accurate, seek_to).is_err() {
        return None;
    }

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .ok()?;
    let sample_rate = track.codec_params.sample_rate.filter(|value| *value > 0)?;
    let mut decoded_frames: u64 = 0;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(SymphoniaError::ResetRequired) => return None,
            Err(_) => return None,
        };

        if packet.track_id() != track.id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(decoded) => {
                decoded_frames = decoded_frames.saturating_add(decoded.frames() as u64);
            }
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(SymphoniaError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(_) => return None,
        }
    }

    if decoded_frames == 0 {
        return None;
    }

    Some(decoded_frames as f64 / sample_rate as f64)
}
