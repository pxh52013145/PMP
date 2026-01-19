use std::path::PathBuf;

use crate::native_audio::{self, AudioSmokeOptions};

pub fn maybe_run_from_cli() -> Option<i32> {
    let args = std::env::args().collect::<Vec<_>>();
    if !args.iter().any(|arg| arg == "--audio-smoke") {
        return None;
    }

    match parse_args(&args) {
        Ok(options) => match native_audio::run_audio_smoke(options) {
            Ok(()) => Some(0),
            Err(error) => {
                eprintln!("[audio-smoke] {error}");
                Some(1)
            }
        },
        Err(error) => {
            eprintln!("[audio-smoke] {error}");
            Some(2)
        }
    }
}

fn parse_args(args: &[String]) -> Result<AudioSmokeOptions, String> {
    let mut path: Option<PathBuf> = None;
    let mut backend_id: Option<String> = None;
    let mut device_name: Option<String> = None;
    let mut input_id: Option<String> = None;
    let mut play_ms: u64 = 800;
    let mut switch_backends: Vec<String> = Vec::new();
    let mut switch_interval_ms: u64 = 250;
    let mut switch_tracks: Vec<PathBuf> = Vec::new();
    let mut switch_track_interval_ms: u64 = 250;
    let mut crossfade_ms: u64 = 0;
    let mut seek_seconds: f64 = 0.5;
    let mut seek_count: u32 = 1;
    let mut seek_interval_ms: u64 = 0;

    let mut index = 1;
    while index < args.len() {
        match args[index].as_str() {
            "--audio-smoke" => {}
            "--path" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "Missing value for --path".to_string())?;
                path = Some(PathBuf::from(value));
                index += 1;
            }
            "--backend-id" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "Missing value for --backend-id".to_string())?;
                backend_id = Some(value.to_string());
                index += 1;
            }
            "--device-name" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "Missing value for --device-name".to_string())?;
                device_name = Some(value.to_string());
                index += 1;
            }
            "--input-id" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "Missing value for --input-id".to_string())?;
                input_id = Some(value.to_string());
                index += 1;
            }
            "--play-ms" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "Missing value for --play-ms".to_string())?;
                play_ms = value
                    .parse::<u64>()
                    .map_err(|_| format!("Invalid --play-ms value: {value}"))?;
                index += 1;
            }
            "--switch-backends" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "Missing value for --switch-backends".to_string())?;
                switch_backends = value
                    .split(',')
                    .map(str::trim)
                    .filter(|entry| !entry.is_empty())
                    .map(|entry| entry.to_string())
                    .collect::<Vec<_>>();
                index += 1;
            }
            "--switch-interval-ms" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "Missing value for --switch-interval-ms".to_string())?;
                switch_interval_ms = value
                    .parse::<u64>()
                    .map_err(|_| format!("Invalid --switch-interval-ms value: {value}"))?;
                index += 1;
            }
            "--switch-tracks" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "Missing value for --switch-tracks".to_string())?;
                switch_tracks = value
                    .split(',')
                    .map(str::trim)
                    .filter(|entry| !entry.is_empty())
                    .map(PathBuf::from)
                    .collect::<Vec<_>>();
                index += 1;
            }
            "--switch-track-interval-ms" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "Missing value for --switch-track-interval-ms".to_string())?;
                switch_track_interval_ms = value
                    .parse::<u64>()
                    .map_err(|_| format!("Invalid --switch-track-interval-ms value: {value}"))?;
                index += 1;
            }
            "--crossfade-ms" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "Missing value for --crossfade-ms".to_string())?;
                crossfade_ms = value
                    .parse::<u64>()
                    .map_err(|_| format!("Invalid --crossfade-ms value: {value}"))?;
                index += 1;
            }
            "--seek-seconds" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "Missing value for --seek-seconds".to_string())?;
                seek_seconds = value
                    .parse::<f64>()
                    .map_err(|_| format!("Invalid --seek-seconds value: {value}"))?;
                index += 1;
            }
            "--seek-count" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "Missing value for --seek-count".to_string())?;
                seek_count = value
                    .parse::<u32>()
                    .map_err(|_| format!("Invalid --seek-count value: {value}"))?;
                index += 1;
            }
            "--seek-interval-ms" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "Missing value for --seek-interval-ms".to_string())?;
                seek_interval_ms = value
                    .parse::<u64>()
                    .map_err(|_| format!("Invalid --seek-interval-ms value: {value}"))?;
                index += 1;
            }
            other => {
                if other.starts_with('-') {
                    return Err(format!("Unknown audio smoke argument: {other}"));
                }
            }
        }
        index += 1;
    }

    let path = path.ok_or_else(|| "Missing required --path for --audio-smoke".to_string())?;

    Ok(AudioSmokeOptions {
        path,
        backend_id,
        device_name,
        input_id,
        play_ms,
        switch_backends,
        switch_interval_ms,
        switch_tracks,
        switch_track_interval_ms,
        crossfade_ms,
        seek_seconds,
        seek_count,
        seek_interval_ms,
    })
}

