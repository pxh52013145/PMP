use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

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

pub fn import_background_media(
    app: &AppHandle,
    source_path: String,
    kind: String,
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

    std::fs::copy(&source, &dest_path)
        .map_err(|e| format!("Failed to copy {} into AppData: {}", config.label, e))?;

    Ok(dest_path.to_string_lossy().to_string())
}

