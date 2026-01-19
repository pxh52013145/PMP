#[cfg(all(target_os = "windows", feature = "asio-sdk"))]
pub fn maybe_run_from_cli() -> Option<i32> {
    let args = std::env::args().collect::<Vec<_>>();
    let wants_diag = args.iter().any(|arg| arg == "--asio-diag");
    let wants_tone = args.iter().any(|arg| arg == "--asio-tone");

    if !wants_diag && !wants_tone {
        return None;
    }

    match run_from_args(&args, wants_diag, wants_tone) {
        Ok(()) => Some(0),
        Err(err) => {
            eprintln!("[asio-diag] {err}");
            Some(1)
        }
    }
}

#[cfg(not(all(target_os = "windows", feature = "asio-sdk")))]
pub fn maybe_run_from_cli() -> Option<i32> {
    None
}

#[cfg(all(target_os = "windows", feature = "asio-sdk"))]
fn run_from_args(args: &[String], wants_diag: bool, wants_tone: bool) -> Result<(), String> {
    if wants_diag {
        run_diag()?;
    }
    if wants_tone {
        run_tone(args)?;
    }
    Ok(())
}

#[cfg(all(target_os = "windows", feature = "asio-sdk"))]
fn run_diag() -> Result<(), String> {
    use rodio::cpal::traits::{DeviceTrait, HostTrait};

    println!("==> cpal_asio_output_devices");
    let host = rodio::cpal::host_from_id(rodio::cpal::HostId::Asio)
        .map_err(|e| format!("Failed to init cpal ASIO host: {e}"))?;
    let mut cpal_devices = Vec::new();
    match host.output_devices() {
        Ok(devices) => {
            for device in devices {
                match device.name() {
                    Ok(name) => cpal_devices.push(name),
                    Err(err) => cpal_devices.push(format!("<name_error:{err}>")),
                }
            }
        }
        Err(err) => {
            println!("cpal_asio_output_devices_error: {err}");
        }
    }
    println!("{cpal_devices:?}");

    let default_name = host.default_output_device().and_then(|d| d.name().ok());
    println!("cpal_asio_default_output_device: {default_name:?}");

    let asio = asio_sys::Asio::new();
    let names = asio.driver_names();
    println!("==> asio_driver_names");
    println!("{names:?}");

    println!("\n==> asio_load_driver");
    for name in names {
        print!("- {name}: ");
        match asio.load_driver(&name) {
            Ok(driver) => {
                let channels = driver.channels().map_err(|e| format!("{name}: channels: {e}"))?;
                let sample_rate =
                    driver.sample_rate().map_err(|e| format!("{name}: sample_rate: {e}"))?;
                println!("ok (ins={}, outs={}, rate={})", channels.ins, channels.outs, sample_rate);
                let destroyed = driver
                    .destroy()
                    .map_err(|e| format!("{name}: destroy failed: {e}"))?;
                if !destroyed {
                    return Err(format!("{name}: driver still has active handles"));
                }
            }
            Err(err) => {
                println!("{err}");
            }
        }
    }

    Ok(())
}

#[cfg(all(target_os = "windows", feature = "asio-sdk"))]
fn run_tone(args: &[String]) -> Result<(), String> {
    use rodio::cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use rodio::cpal::{SampleFormat, StreamConfig, SupportedStreamConfig};
    use std::f32::consts::TAU;
    use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    let requested_device = args
        .iter()
        .position(|arg| arg == "--asio-tone-device")
        .and_then(|index| args.get(index + 1))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let seconds = args
        .iter()
        .position(|arg| arg == "--asio-tone-seconds")
        .and_then(|index| args.get(index + 1))
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(5)
        .max(1);

    let freq_hz = args
        .iter()
        .position(|arg| arg == "--asio-tone-freq-hz")
        .and_then(|index| args.get(index + 1))
        .and_then(|value| value.parse::<f32>().ok())
        .unwrap_or(440.0)
        .max(1.0);

    let host = rodio::cpal::host_from_id(rodio::cpal::HostId::Asio)
        .map_err(|e| format!("Failed to init cpal ASIO host: {e}"))?;

    let device = if let Some(name) = requested_device.as_deref() {
        let devices = host
            .output_devices()
            .map_err(|e| format!("Failed to enumerate output devices: {e}"))?;
        let mut found = None;
        for device in devices {
            let Ok(device_name) = device.name() else {
                continue;
            };
            let normalized = device_name.trim();
            if normalized != name && !normalized.eq_ignore_ascii_case(name) && device_name != name {
                continue;
            }
            found = Some(device);
            break;
        }
        found.ok_or_else(|| format!("ASIO output device '{name}' not found"))?
    } else {
        host.default_output_device()
            .ok_or_else(|| "No ASIO output device available".to_string())?
    };

    let device_name = device.name().ok();
    let default_config = device
        .default_output_config()
        .map_err(|e| format!("Failed to query default output config: {e}"))?;
    let channels = default_config.channels().max(1);
    let supported_config = SupportedStreamConfig::new(
        channels,
        default_config.sample_rate(),
        *default_config.buffer_size(),
        default_config.sample_format(),
    );
    let stream_config = StreamConfig {
        channels: supported_config.channels(),
        sample_rate: supported_config.sample_rate(),
        buffer_size: rodio::cpal::BufferSize::Default,
    };

    println!("==> asio_tone");
    println!("device: {device_name:?}");
    println!(
        "config: {}ch @ {}Hz ({:?})",
        stream_config.channels,
        stream_config.sample_rate.0,
        supported_config.sample_format()
    );

    let error_callback = |err| eprintln!("[asio-tone] stream error: {err}");

    let sample_rate_f = stream_config.sample_rate.0 as f32;
    let channels_usize = stream_config.channels as usize;
    let phase_inc = TAU * freq_hz / sample_rate_f.max(1.0);
    let amplitude = 0.20f32;

    let callback_calls = Arc::new(AtomicU64::new(0));
    let peak_bits = Arc::new(AtomicU32::new(0.0f32.to_bits()));

    let stream = match supported_config.sample_format() {
        SampleFormat::F32 => {
            let callback_calls_handle = callback_calls.clone();
            let peak_bits_handle = peak_bits.clone();
            let mut phase = 0.0f32;
            device.build_output_stream(
                &stream_config,
                move |data: &mut [f32], _| {
                    let mut local_peak = 0.0f32;
                    for frame in data.chunks_mut(channels_usize.max(1)) {
                        let sample = (phase).sin() * amplitude;
                        phase = (phase + phase_inc) % TAU;
                        local_peak = local_peak.max(sample.abs());
                        for channel in frame.iter_mut() {
                            *channel = sample;
                        }
                    }
                    callback_calls_handle.fetch_add(1, Ordering::Relaxed);
                    peak_bits_handle.store(local_peak.to_bits(), Ordering::Relaxed);
                },
                error_callback,
                None,
            )
        }
        SampleFormat::I16 => {
            let callback_calls_handle = callback_calls.clone();
            let peak_bits_handle = peak_bits.clone();
            let mut phase = 0.0f32;
            device.build_output_stream(
                &stream_config,
                move |data: &mut [i16], _| {
                    let mut local_peak = 0.0f32;
                    for frame in data.chunks_mut(channels_usize.max(1)) {
                        let sample = (phase).sin() * amplitude;
                        phase = (phase + phase_inc) % TAU;
                        local_peak = local_peak.max(sample.abs());
                        let quantized = (sample * i16::MAX as f32) as i16;
                        for channel in frame.iter_mut() {
                            *channel = quantized;
                        }
                    }
                    callback_calls_handle.fetch_add(1, Ordering::Relaxed);
                    peak_bits_handle.store(local_peak.to_bits(), Ordering::Relaxed);
                },
                error_callback,
                None,
            )
        }
        SampleFormat::I32 => {
            let callback_calls_handle = callback_calls.clone();
            let peak_bits_handle = peak_bits.clone();
            let mut phase = 0.0f32;
            device.build_output_stream(
                &stream_config,
                move |data: &mut [i32], _| {
                    let mut local_peak = 0.0f32;
                    for frame in data.chunks_mut(channels_usize.max(1)) {
                        let sample = (phase).sin() * amplitude;
                        phase = (phase + phase_inc) % TAU;
                        local_peak = local_peak.max(sample.abs());
                        let quantized = (sample * i32::MAX as f32) as i32;
                        for channel in frame.iter_mut() {
                            *channel = quantized;
                        }
                    }
                    callback_calls_handle.fetch_add(1, Ordering::Relaxed);
                    peak_bits_handle.store(local_peak.to_bits(), Ordering::Relaxed);
                },
                error_callback,
                None,
            )
        }
        other => return Err(format!("Unsupported sample format for tone test: {other:?}")),
    }
    .map_err(|e| format!("Failed to build ASIO output stream: {e}"))?;

    stream.play().map_err(|e| format!("Failed to start stream: {e}"))?;

    let mut last_calls = 0u64;
    for second in 1..=seconds {
        std::thread::sleep(Duration::from_secs(1));
        let calls = callback_calls.load(Ordering::Relaxed);
        let delta = calls.saturating_sub(last_calls);
        last_calls = calls;
        let peak = f32::from_bits(peak_bits.load(Ordering::Relaxed));
        println!(
            "[asio-tone] t={}s callbacks={} (+{}) peak={:.3}",
            second, calls, delta, peak
        );
    }

    drop(stream);
    Ok(())
}
