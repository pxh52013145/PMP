use std::fs::File;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::AppHandle;

static IMPORT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

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

fn rewrite_gif_with_min_delay(
    source: &PathBuf,
    dest: &PathBuf,
    min_delay_cs: u16,
) -> Result<(), String> {
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
    let mut encoder = gif::Encoder::new(&mut output, width, height, global_palette)
        .map_err(|e| format!("Unable to create GIF encoder: {e}"))?;
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

pub fn import_ornament_media(
    app: &AppHandle,
    source_path: String,
    gif_max_fps: Option<u16>,
) -> Result<String, String> {
    const MAX_BYTES: u64 = 5 * 1024 * 1024;
    const ALLOWED_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];
    const DEFAULT_EXT: &str = "png";

    let source = PathBuf::from(source_path);
    let metadata =
        std::fs::metadata(&source).map_err(|e| format!("Unable to access image: {e}"))?;
    if !metadata.is_file() {
        return Err("Selected path is not a file (image)".to_string());
    }

    if metadata.len() > MAX_BYTES {
        return Err(format!(
            "File too large (image): {} > {}",
            format_bytes_as_mb(metadata.len()),
            format_bytes_as_mb(MAX_BYTES)
        ));
    }

    let ext = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_EXT.to_string());

    if !ALLOWED_EXTS
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(ext.as_str()))
    {
        return Err(format!("Unsupported image extension: .{ext}"));
    }

    let app_data_dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Unable to resolve app data directory".to_string())?;
    let dest_dir = app_data_dir.join("background-media").join("ornaments");
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create ornaments directory: {e}"))?;

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let seq = IMPORT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let file_name = format!("ornament-{ts}-{seq}.{ext}");
    let dest_path = dest_dir.join(file_name);

    if ext == "gif" {
        if let Some(max_fps) = gif_max_fps {
            if max_fps > 0 {
                let min_delay_cs = min_gif_delay_cs_for_max_fps(max_fps)?;
                rewrite_gif_with_min_delay(&source, &dest_path, min_delay_cs)?;
                return Ok(dest_path.to_string_lossy().to_string());
            }
        }
    }

    std::fs::copy(&source, &dest_path)
        .map_err(|e| format!("Failed to copy image into AppData: {e}"))?;

    Ok(dest_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::min_gif_delay_cs_for_max_fps;

    #[test]
    fn gif_delay_validation() {
        assert!(min_gif_delay_cs_for_max_fps(0).is_err());
        assert!(min_gif_delay_cs_for_max_fps(61).is_err());
        assert_eq!(min_gif_delay_cs_for_max_fps(30).unwrap(), 4);
    }
}
