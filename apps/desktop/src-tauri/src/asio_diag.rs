#[cfg(all(target_os = "windows", feature = "asio-sdk"))]
pub fn maybe_run_from_cli() -> Option<i32> {
    let args = std::env::args().collect::<Vec<_>>();
    if !args.iter().any(|arg| arg == "--asio-diag") {
        return None;
    }

    match run_diag() {
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
