use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use std::fs::File;

use tauri::AppHandle;

static IMPORT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct KindConfig {
    label: &'static str,
    max_bytes: u64,
    allowed_exts: &'static [&'static str],
    default_ext: &'static str,
}

fn kind_config(kind: &str) -> Option<KindConfig> {
    match kind {
        "image" => Some(KindConfig {
            label: "image",
            max_bytes: 5 * 1024 * 1024,
            allowed_exts: &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"],
            default_ext: "png",
        }),
        "video" => Some(KindConfig {
            label: "video",
            max_bytes: 20 * 1024 * 1024,
            allowed_exts: &["mp4", "webm", "ogg", "mov"],
            default_ext: "mp4",
        }),
        _ => None,
    }
}

fn format_bytes_as_mb(bytes: u64) -> String {
    format!("{:.2}MB", bytes as f64 / 1024.0 / 1024.0)
}

fn min_gif_delay_cs_for_max_fps(max_fps: u16) -> Result<u16, String> {
    if max_fps == 0 {
        return Err("gifMaxFps must be greater than 0".to_string());
    }
    if max_fps > 60 {
        return Err("gifMaxFps must be <= 60".to_string());
    }

    // delay unit is centiseconds (1/100s), so ceil(100/fps)
    let min_delay = (100u16.saturating_add(max_fps).saturating_sub(1)) / max_fps;
    Ok(min_delay.max(1))
}

fn rewrite_gif_with_min_delay(source: &PathBuf, dest: &PathBuf, min_delay_cs: u16) -> Result<(), String> {
    let mut decoder_opts = gif::DecodeOptions::new();
    decoder_opts.set_color_output(gif::ColorOutput::Indexed);

    let input = File::open(source).map_err(|e| format!("Unable to open GIF: {e}"))?;
    let mut decoder = decoder_opts
        .read_info(input)
        .map_err(|e| format!("Unable to decode GIF header: {e}"))?;

    let width = decoder.width();
    let height = decoder.height();
    let global_palette = decoder.global_palette().unwrap_or(&[]);

    let mut output = File::create(dest).map_err(|e| format!("Unable to create GIF output: {e}"))?;
    let mut encoder =
        gif::Encoder::new(&mut output, width, height, global_palette).map_err(|e| {
            format!("Unable to create GIF encoder: {e}")
        })?;
    encoder
        .set_repeat(decoder.repeat())
        .map_err(|e| format!("Unable to set GIF repeat: {e}"))?;

    while let Some(frame) = decoder
        .read_next_frame()
        .map_err(|e| format!("Unable to decode GIF frame: {e}"))?
    {
        let mut next = frame.clone();
        next.delay = next.delay.max(min_delay_cs);
        encoder
            .write_frame(&next)
            .map_err(|e| format!("Unable to write GIF frame: {e}"))?;
    }

    Ok(())
}

pub fn import_background_media(
    app: &AppHandle,
    source_path: String,
    kind: String,
    gif_max_fps: Option<u16>,
) -> Result<String, String> {
    let config = kind_config(kind.as_str())
        .ok_or_else(|| format!("Unsupported background media kind: {}", kind))?;

    let source = PathBuf::from(source_path);
    let metadata = std::fs::metadata(&source)
        .map_err(|e| format!("Unable to access source {}: {}", config.label, e))?;
    if !metadata.is_file() {
        return Err(format!("Selected path is not a file ({})", config.label));
    }

    if metadata.len() > config.max_bytes {
        return Err(format!(
            "File too large ({}): {} > {}",
            config.label,
            format_bytes_as_mb(metadata.len()),
            format_bytes_as_mb(config.max_bytes)
        ));
    }

    let ext = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| config.default_ext.to_string());

    if !config.allowed_exts.iter().any(|allowed| allowed.eq_ignore_ascii_case(ext.as_str())) {
        return Err(format!(
            "Unsupported {} extension: .{}",
            config.label, ext
        ));
    }

    let app_data_dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Unable to resolve app data directory".to_string())?;
    let dest_dir = app_data_dir.join("background-media");
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create background-media directory: {}", e))?;

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let seq = IMPORT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let file_name = format!("background-{}-{}.{}", ts, seq, ext);
    let dest_path = dest_dir.join(file_name);

    if config.label == "image" && ext == "gif" {
        if let Some(max_fps) = gif_max_fps {
            if max_fps > 0 {
                let min_delay_cs = min_gif_delay_cs_for_max_fps(max_fps)?;
                rewrite_gif_with_min_delay(&source, &dest_path, min_delay_cs)?;
                return Ok(dest_path.to_string_lossy().to_string());
            }
        }
    }

    std::fs::copy(&source, &dest_path)
        .map_err(|e| format!("Failed to copy {} into AppData: {}", config.label, e))?;

    Ok(dest_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::{min_gif_delay_cs_for_max_fps, rewrite_gif_with_min_delay};

    use std::borrow::Cow;
    use std::path::PathBuf;

    fn write_test_gif(path: &PathBuf, delays: &[u16]) -> Result<(), String> {
        let color_map = &[0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF];
        let (width, height) = (2u16, 2u16);
        let mut file = std::fs::File::create(path).map_err(|e| format!("create test gif: {e}"))?;
        let mut encoder = gif::Encoder::new(&mut file, width, height, color_map)
            .map_err(|e| format!("create encoder: {e}"))?;
        encoder
            .set_repeat(gif::Repeat::Infinite)
            .map_err(|e| format!("set repeat: {e}"))?;

        for (idx, delay) in delays.iter().enumerate() {
            let mut frame = gif::Frame::default();
            frame.width = width;
            frame.height = height;
            frame.delay = *delay;
            frame.buffer = Cow::Owned(vec![(idx % 2) as u8; (width as usize) * (height as usize)]);
            encoder
                .write_frame(&frame)
                .map_err(|e| format!("write frame: {e}"))?;
        }

        Ok(())
    }

    #[test]
    fn rewrite_gif_clamps_delays() {
        let temp_dir = std::env::temp_dir();
        let unique = format!(
            "pmpm-gif-opt-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let source = temp_dir.join(format!("{unique}-in.gif"));
        let dest = temp_dir.join(format!("{unique}-out.gif"));

        write_test_gif(&source, &[1, 10]).expect("write test gif");
        let min_delay = min_gif_delay_cs_for_max_fps(30).expect("min delay");
        rewrite_gif_with_min_delay(&source, &dest, min_delay).expect("rewrite gif");

        let mut decoder_opts = gif::DecodeOptions::new();
        decoder_opts.set_color_output(gif::ColorOutput::Indexed);
        let input = std::fs::File::open(&dest).expect("open output gif");
        let mut decoder = decoder_opts.read_info(input).expect("decode output gif");
        let mut delays = Vec::new();
        while let Some(frame) = decoder.read_next_frame().expect("read frame") {
            delays.push(frame.delay);
        }

        assert_eq!(delays, vec![4, 10]);

        let _ = std::fs::remove_file(source);
        let _ = std::fs::remove_file(dest);
    }
}
