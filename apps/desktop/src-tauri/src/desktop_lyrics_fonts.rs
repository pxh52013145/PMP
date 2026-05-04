use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;

const ALLOWED_FONT_EXTENSIONS: &[&str] = &["ttf", "otf", "woff", "woff2", "ttc"];
const DESKTOP_LYRICS_FONT_DIR_NAME: &str = "desktop-lyrics-fonts";
const DESKTOP_LYRICS_FONT_FILE_NAME: &str = "desktop-lyrics-font-current";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLyricsFontImportResult {
    pub dest_path: String,
    pub source_bytes: u64,
    pub display_name: String,
}

fn normalized_extension(path: &PathBuf) -> Option<String> {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
}

fn derive_font_display_name(source: &Path) -> Option<String> {
    let bytes = std::fs::read(source).ok()?;
    let face = ttf_parser::Face::parse(&bytes, 0).ok()?;

    let preferred_name_ids = [
        ttf_parser::name_id::FULL_NAME,
        ttf_parser::name_id::FAMILY,
        ttf_parser::name_id::POST_SCRIPT_NAME,
    ];

    for preferred_name_id in preferred_name_ids {
        if let Some(name) = face
            .names()
            .into_iter()
            .find(|name| name.name_id == preferred_name_id && name.is_unicode())
        {
            if let Some(display_name) = name.to_string() {
                let trimmed = display_name.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }

    None
}

pub fn import_desktop_lyrics_font(
    app: &AppHandle,
    source_path: String,
) -> Result<DesktopLyricsFontImportResult, String> {
    let source = PathBuf::from(source_path);
    let metadata = std::fs::metadata(&source)
        .map_err(|error| format!("Unable to access source font: {error}"))?;
    if !metadata.is_file() {
        return Err("Selected path is not a file".to_string());
    }
    if metadata.len() == 0 {
        return Err("Selected font file is empty".to_string());
    }

    let ext = normalized_extension(&source)
        .ok_or_else(|| "Selected font file must have an extension".to_string())?;
    if !ALLOWED_FONT_EXTENSIONS
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(ext.as_str()))
    {
        return Err(format!("Unsupported font extension: .{ext}"));
    }

    let app_data_dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Unable to resolve app data directory".to_string())?;
    let dest_dir = app_data_dir.join(DESKTOP_LYRICS_FONT_DIR_NAME);
    std::fs::create_dir_all(&dest_dir)
        .map_err(|error| format!("Failed to create desktop lyrics font directory: {error}"))?;

    let dest_path = dest_dir.join(DESKTOP_LYRICS_FONT_FILE_NAME);
    let display_name = derive_font_display_name(&source)
        .or_else(|| {
            source
                .file_stem()
                .and_then(|value| value.to_str())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_else(|| "Desktop lyrics font".to_string());

    std::fs::copy(&source, &dest_path)
        .map_err(|error| format!("Failed to copy font into AppData: {error}"))?;

    Ok(DesktopLyricsFontImportResult {
        dest_path: dest_path.to_string_lossy().to_string(),
        source_bytes: metadata.len(),
        display_name,
    })
}
