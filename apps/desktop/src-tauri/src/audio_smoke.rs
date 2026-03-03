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
    let mut stress_cpu_threads: u32 = 0;
    let mut max_underrun_events: Option<u64> = None;
    let mut max_underrun_frames: Option<u64> = None;
    let mut max_output_wait_timeout_count: Option<u64> = None;
    let mut max_output_callback_jitter_p99_us: Option<u32> = None;
    let mut max_control_queue_critical_overflow_events: Option<u64> = None;
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
            "--stress-cpu-threads" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "Missing value for --stress-cpu-threads".to_string())?;
                stress_cpu_threads = value
                    .parse::<u32>()
                    .map_err(|_| format!("Invalid --stress-cpu-threads value: {value}"))?;
                index += 1;
            }
            "--max-underrun-events" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "Missing value for --max-underrun-events".to_string())?;
                max_underrun_events = Some(
                    value
                        .parse::<u64>()
                        .map_err(|_| format!("Invalid --max-underrun-events value: {value}"))?,
                );
                index += 1;
            }
            "--max-underrun-frames" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "Missing value for --max-underrun-frames".to_string())?;
                max_underrun_frames = Some(
                    value
                        .parse::<u64>()
                        .map_err(|_| format!("Invalid --max-underrun-frames value: {value}"))?,
                );
                index += 1;
            }
            "--max-output-wait-timeout-count" => {
                let value = args.get(index + 1).ok_or_else(|| {
                    "Missing value for --max-output-wait-timeout-count".to_string()
                })?;
                max_output_wait_timeout_count = Some(value.parse::<u64>().map_err(|_| {
                    format!("Invalid --max-output-wait-timeout-count value: {value}")
                })?);
                index += 1;
            }
            "--max-output-callback-jitter-p99-us" => {
                let value = args.get(index + 1).ok_or_else(|| {
                    "Missing value for --max-output-callback-jitter-p99-us".to_string()
                })?;
                max_output_callback_jitter_p99_us = Some(value.parse::<u32>().map_err(|_| {
                    format!("Invalid --max-output-callback-jitter-p99-us value: {value}")
                })?);
                index += 1;
            }
            "--max-control-queue-critical-overflow-events" => {
                let value = args.get(index + 1).ok_or_else(|| {
                    "Missing value for --max-control-queue-critical-overflow-events".to_string()
                })?;
                max_control_queue_critical_overflow_events =
                    Some(value.parse::<u64>().map_err(|_| {
                        format!(
                            "Invalid --max-control-queue-critical-overflow-events value: {value}"
                        )
                    })?);
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
        stress_cpu_threads,
        max_underrun_events,
        max_underrun_frames,
        max_output_wait_timeout_count,
        max_output_callback_jitter_p99_us,
        max_control_queue_critical_overflow_events,
    })
}

#[cfg(test)]
mod tests {
    use super::parse_args;

    #[test]
    fn parse_args_supports_extended_threshold_options() {
        let args = vec![
            "pmp".to_string(),
            "--audio-smoke".to_string(),
            "--path".to_string(),
            "demo.wav".to_string(),
            "--max-underrun-events".to_string(),
            "3".to_string(),
            "--max-underrun-frames".to_string(),
            "2048".to_string(),
            "--max-output-wait-timeout-count".to_string(),
            "2".to_string(),
            "--max-output-callback-jitter-p99-us".to_string(),
            "5000".to_string(),
            "--max-control-queue-critical-overflow-events".to_string(),
            "1".to_string(),
        ];

        let options = parse_args(&args).expect("expected args to parse");
        assert_eq!(options.max_underrun_events, Some(3));
        assert_eq!(options.max_underrun_frames, Some(2048));
        assert_eq!(options.max_output_wait_timeout_count, Some(2));
        assert_eq!(options.max_output_callback_jitter_p99_us, Some(5000));
        assert_eq!(options.max_control_queue_critical_overflow_events, Some(1));
    }

    #[test]
    fn parse_args_rejects_invalid_extended_threshold_value() {
        let args = vec![
            "pmp".to_string(),
            "--audio-smoke".to_string(),
            "--path".to_string(),
            "demo.wav".to_string(),
            "--max-output-callback-jitter-p99-us".to_string(),
            "oops".to_string(),
        ];

        let error = parse_args(&args).expect_err("expected parse to fail");
        assert!(error.contains("Invalid --max-output-callback-jitter-p99-us value"));
    }
}
