use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    http::{
        Request as HttpRequest, Response as HttpResponse, ResponseBuilder as HttpResponseBuilder,
    },
    AppHandle, Manager, Runtime,
};

use dsf::DsfFile;
use once_cell::sync::Lazy;
use sha2::{Digest, Sha256};
use symphonia::core::{
    formats::{FormatOptions, FormatReader, Track},
    io::{MediaSourceStream, MediaSourceStreamOptions},
    meta::{Limit, MetadataOptions, StandardVisualKey},
    probe::Hint,
};
use url::Url;

pub const EVENT_MUSIC_LIBRARY_SCAN_PROGRESS: &str = "music-library-scan-progress";

static MUSIC_LIBRARY_CANCEL_REQUESTED: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(false));
static COVER_ASSET_SCOPE_READY: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(false));

pub fn request_cancel_scan() {
    MUSIC_LIBRARY_CANCEL_REQUESTED.store(true, Ordering::SeqCst);
}

pub fn open_in_file_manager(path: &str) -> Result<(), String> {
    let normalized = path.trim();
    if normalized.is_empty() {
        return Err("Path is empty".to_string());
    }

    let mut target = if normalized.to_ascii_lowercase().starts_with("file://") {
        let parsed =
            Url::parse(normalized).map_err(|error| format!("Invalid file URL: {error}"))?;
        parsed
            .to_file_path()
            .map_err(|_| format!("Invalid file URL path: {normalized}"))?
    } else {
        PathBuf::from(normalized)
    };

    #[cfg(target_os = "windows")]
    {
        // Explorer 对正斜杠兼容较差，统一转回 Windows 风格。
        let normalized_windows = target.to_string_lossy().replace('/', "\\");
        target = PathBuf::from(normalized_windows);
    }

    if !target.exists() {
        if let Some(parent) = target.parent() {
            if parent.exists() {
                target = parent.to_path_buf();
            } else {
                return Err(format!("Path does not exist: {normalized}"));
            }
        } else {
            return Err(format!("Path does not exist: {normalized}"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        if target.is_file() {
            let canonical = target.canonicalize().unwrap_or_else(|_| target.clone());
            let mut select_target = canonical.to_string_lossy().replace('/', "\\");
            if let Some(stripped) = select_target.strip_prefix("\\\\?\\") {
                select_target = stripped.to_string();
            }

            std::process::Command::new("explorer")
                .arg("/select,")
                .arg(select_target)
                .spawn()
                .map_err(|error| format!("Failed to open file manager: {error}"))?;
        } else {
            let mut folder_target = target.to_string_lossy().replace('/', "\\");
            if let Some(stripped) = folder_target.strip_prefix("\\\\?\\") {
                folder_target = stripped.to_string();
            }
            std::process::Command::new("explorer")
                .arg(folder_target)
                .spawn()
                .map_err(|error| format!("Failed to open file manager: {error}"))?;
        }
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        if target.is_file() {
            std::process::Command::new("open")
                .arg("-R")
                .arg(&target)
                .spawn()
                .map_err(|error| format!("Failed to open file manager: {error}"))?;
        } else {
            std::process::Command::new("open")
                .arg(&target)
                .spawn()
                .map_err(|error| format!("Failed to open file manager: {error}"))?;
        }
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let open_target = if target.is_file() {
            target
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| target.clone())
        } else {
            target.clone()
        };

        std::process::Command::new("xdg-open")
            .arg(open_target)
            .spawn()
            .map_err(|error| format!("Failed to open file manager: {error}"))?;

        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform".to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgressPayload {
    pub total: u64,
    pub current: u64,
    pub current_file: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedTrack {
    pub path: String,
    pub file_name: String,
    pub size: u64,
    pub mtime_ms: i64,
    pub quick_fingerprint: Option<String>,
    pub duration: Option<f64>,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u32>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub replay_gain_track_db: Option<f32>,
    pub replay_gain_album_db: Option<f32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOptions {
    pub include_metadata: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedCover {
    pub key: String,
    pub path: String,
    pub size: u64,
    pub media_type: Option<String>,
}

fn is_supported_audio(path: &Path, exts: &HashSet<&'static str>) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| exts.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn collect_audio_files(root: &Path, exts: &HashSet<&'static str>) -> Result<Vec<PathBuf>, String> {
    let mut result: Vec<PathBuf> = Vec::new();
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to read dir {dir:?}: {e}"))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read dir entry: {e}"))?;
            let path = entry.path();
            let meta = entry
                .metadata()
                .map_err(|e| format!("Failed to stat {path:?}: {e}"))?;
            if meta.is_dir() {
                stack.push(path);
                continue;
            }
            if meta.is_file() && is_supported_audio(&path, exts) {
                result.push(path);
            }
        }
    }

    Ok(result)
}

fn system_time_to_millis(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn parse_synchsafe_u32(bytes: &[u8]) -> Option<u32> {
    if bytes.len() < 4 {
        return None;
    }
    if bytes.iter().any(|value| value & 0x80 != 0) {
        return None;
    }

    Some(
        ((bytes[0] as u32) << 21)
            | ((bytes[1] as u32) << 14)
            | ((bytes[2] as u32) << 7)
            | (bytes[3] as u32),
    )
}

fn detect_audio_start_offset(file: &mut fs::File, total_len: u64) -> u64 {
    if total_len < 16 {
        return 0;
    }

    let mut header = [0u8; 12];
    if file.seek(SeekFrom::Start(0)).is_err() {
        return 0;
    }
    if file.read_exact(&mut header).is_err() {
        return 0;
    }

    if &header[0..3] == b"ID3" {
        let flags = header[5];
        if let Some(size) = parse_synchsafe_u32(&header[6..10]) {
            let footer_len = if (flags & 0x10) != 0 { 10_u64 } else { 0_u64 };
            let offset = 10_u64
                .saturating_add(size as u64)
                .saturating_add(footer_len);
            if offset > 0 && offset < total_len {
                return offset;
            }
        }
    }

    if &header[0..4] == b"fLaC" {
        if file.seek(SeekFrom::Start(4)).is_ok() {
            let mut block_header = [0u8; 4];
            for _ in 0..64 {
                if file.read_exact(&mut block_header).is_err() {
                    break;
                }

                let is_last = (block_header[0] & 0x80) != 0;
                let length = ((block_header[1] as u32) << 16)
                    | ((block_header[2] as u32) << 8)
                    | block_header[3] as u32;

                if file.seek(SeekFrom::Current(length as i64)).is_err() {
                    break;
                }

                if is_last {
                    if let Ok(position) = file.stream_position() {
                        if position < total_len {
                            return position;
                        }
                    }
                    break;
                }
            }
        }
    }

    if &header[0..4] == b"RIFF" && &header[8..12] == b"WAVE" {
        if file.seek(SeekFrom::Start(12)).is_ok() {
            let mut chunk_header = [0u8; 8];
            for _ in 0..4096 {
                if file.read_exact(&mut chunk_header).is_err() {
                    break;
                }

                let chunk_id = &chunk_header[0..4];
                let chunk_size = u32::from_le_bytes([
                    chunk_header[4],
                    chunk_header[5],
                    chunk_header[6],
                    chunk_header[7],
                ]) as u64;

                if chunk_id == b"data" {
                    if let Ok(position) = file.stream_position() {
                        if position < total_len {
                            return position;
                        }
                    }
                    break;
                }

                let padding = chunk_size % 2;
                if file
                    .seek(SeekFrom::Current(
                        (chunk_size.saturating_add(padding)) as i64,
                    ))
                    .is_err()
                {
                    break;
                }
            }
        }
    }

    0
}

fn detect_audio_end_offset(file: &mut fs::File, total_len: u64) -> u64 {
    let mut end = total_len;

    if total_len >= 128 {
        let mut tail = [0u8; 3];
        if file.seek(SeekFrom::Start(total_len - 128)).is_ok() && file.read_exact(&mut tail).is_ok()
        {
            if &tail == b"TAG" {
                end = end.saturating_sub(128);
            }
        }
    }

    if end >= 32 {
        let mut footer = [0u8; 32];
        if file.seek(SeekFrom::Start(end - 32)).is_ok() && file.read_exact(&mut footer).is_ok() {
            if &footer[0..8] == b"APETAGEX" {
                let tag_size =
                    u32::from_le_bytes([footer[12], footer[13], footer[14], footer[15]]) as u64;
                if tag_size >= 32 && tag_size < end {
                    end = end.saturating_sub(tag_size);
                }
            }
        }
    }

    end
}

fn compute_quick_fingerprint(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let total_len = file.metadata().ok()?.len();
    if total_len < 16 * 1024 {
        return None;
    }

    let start = detect_audio_start_offset(&mut file, total_len);
    let mut end = detect_audio_end_offset(&mut file, total_len);

    if end <= start.saturating_add(8 * 1024) {
        end = total_len;
    }

    if end <= start.saturating_add(8 * 1024) {
        return None;
    }

    let audio_len = end.saturating_sub(start);
    if audio_len < 8 * 1024 {
        return None;
    }

    let sample_window = 12 * 1024_u64;
    let sample_positions = [
        0_u64,
        audio_len / 8,
        audio_len / 4,
        audio_len / 2,
        (audio_len * 3) / 4,
        (audio_len * 7) / 8,
    ];

    let mut hasher = Sha256::new();
    hasher.update(b"pmp-quickfp-v2");

    if let Some(ext) = path.extension().and_then(|value| value.to_str()) {
        hasher.update(ext.to_ascii_lowercase().as_bytes());
    }

    let mut sampled_total = 0usize;
    let mut previous_abs_pos: Option<u64> = None;
    let mut buffer = vec![0u8; sample_window as usize];

    for relative in sample_positions {
        let half = sample_window / 2;
        let mut abs_pos = start.saturating_add(relative.saturating_sub(half));
        let max_pos = end.saturating_sub(1);
        if abs_pos > max_pos {
            abs_pos = max_pos;
        }

        if previous_abs_pos == Some(abs_pos) {
            continue;
        }
        previous_abs_pos = Some(abs_pos);

        if file.seek(SeekFrom::Start(abs_pos)).is_err() {
            continue;
        }

        let max_read = std::cmp::min(sample_window, end.saturating_sub(abs_pos)) as usize;
        if max_read == 0 {
            continue;
        }

        if file.read_exact(&mut buffer[..max_read]).is_err() {
            continue;
        }

        hasher.update(&buffer[..max_read]);
        sampled_total += max_read;
    }

    if sampled_total < 8 * 1024 {
        return None;
    }

    let digest = hasher.finalize();
    let hex = digest
        .iter()
        .take(20)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Some(format!("qf2:{hex}"))
}

#[derive(Debug, Clone)]
struct FlacQuickMetadata {
    duration: Option<f64>,
    sample_rate: Option<u32>,
    bit_depth: Option<u32>,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    replay_gain_track_db: Option<f32>,
    replay_gain_album_db: Option<f32>,
}

#[derive(Debug, Clone)]
struct FlacPicture {
    data: Vec<u8>,
    media_type: String,
}

fn read_exact_or_err<R: Read>(reader: &mut R, buf: &mut [u8], context: &str) -> Result<(), String> {
    reader
        .read_exact(buf)
        .map_err(|e| format!("{context}: {e}"))
}

fn read_u32_be<R: Read>(reader: &mut R, context: &str) -> Result<u32, String> {
    let mut buf = [0u8; 4];
    read_exact_or_err(reader, &mut buf, context)?;
    Ok(u32::from_be_bytes(buf))
}

fn read_u32_le<R: Read>(reader: &mut R, context: &str) -> Result<u32, String> {
    let mut buf = [0u8; 4];
    read_exact_or_err(reader, &mut buf, context)?;
    Ok(u32::from_le_bytes(buf))
}

fn normalize_vorbis_key(key: &str) -> String {
    key.trim().to_ascii_lowercase()
}

fn parse_replaygain_db(raw: &str) -> Option<f32> {
    let text = raw.trim();
    if text.is_empty() {
        return None;
    }

    let mut out = String::new();
    let mut started = false;
    for ch in text.chars() {
        if ch.is_ascii_digit() || ch == '.' || ch == '-' || ch == '+' {
            out.push(ch);
            started = true;
            continue;
        }
        if started {
            break;
        }
    }

    if out.is_empty() {
        return None;
    }

    out.parse::<f32>().ok()
}

fn parse_flac_quick_metadata_from_reader<R: Read + Seek>(
    reader: &mut R,
) -> Result<FlacQuickMetadata, String> {
    let mut magic = [0u8; 4];
    read_exact_or_err(reader, &mut magic, "Failed to read FLAC magic")?;
    if &magic != b"fLaC" {
        return Err("Not a FLAC file".into());
    }

    let mut duration: Option<f64> = None;
    let mut sample_rate: Option<u32> = None;
    let mut bit_depth: Option<u32> = None;
    let mut title: Option<String> = None;
    let mut artist: Option<String> = None;
    let mut album: Option<String> = None;
    let mut replay_gain_track_db: Option<f32> = None;
    let mut replay_gain_album_db: Option<f32> = None;

    let mut is_last = false;
    while !is_last {
        let mut header = [0u8; 4];
        read_exact_or_err(reader, &mut header, "Failed to read FLAC metadata header")?;
        is_last = (header[0] & 0x80) != 0;
        let block_type = header[0] & 0x7F;
        let length: u32 =
            ((header[1] as u32) << 16) | ((header[2] as u32) << 8) | (header[3] as u32);

        // STREAMINFO
        if block_type == 0 {
            if length < 34 {
                reader
                    .seek(SeekFrom::Current(length as i64))
                    .map_err(|e| format!("Failed to skip invalid STREAMINFO: {e}"))?;
                continue;
            }

            let mut buf = vec![0u8; length as usize];
            read_exact_or_err(reader, &mut buf, "Failed to read STREAMINFO")?;

            // Parse the 8-byte field starting at byte 10 (after min/max block + min/max frame sizes).
            if buf.len() >= 18 {
                let bits = u64::from_be_bytes([
                    buf[10], buf[11], buf[12], buf[13], buf[14], buf[15], buf[16], buf[17],
                ]);
                let sr = ((bits >> 44) & 0xFFFFF) as u32;
                let bps = ((bits >> 36) & 0x1F) as u32 + 1;
                let total_samples = bits & 0xFFFFFFFFF; // 36 bits
                if sr > 0 {
                    sample_rate = Some(sr);
                    bit_depth = Some(bps);
                    if total_samples > 0 {
                        duration = Some(total_samples as f64 / sr as f64);
                    }
                }
            }
            continue;
        }

        // VORBIS_COMMENT
        if block_type == 4 {
            let start_pos = reader
                .stream_position()
                .map_err(|e| format!("Failed to get FLAC stream pos: {e}"))?;

            let vendor_len = read_u32_le(reader, "Failed to read vendor length")? as u64;
            if vendor_len > length as u64 {
                // Corrupt block, skip it.
                reader
                    .seek(SeekFrom::Start(start_pos + length as u64))
                    .map_err(|e| format!("Failed to skip corrupt VORBIS_COMMENT: {e}"))?;
                continue;
            }
            reader
                .seek(SeekFrom::Current(vendor_len as i64))
                .map_err(|e| format!("Failed to skip vendor: {e}"))?;

            let count = read_u32_le(reader, "Failed to read vorbis comment count")?;
            for _ in 0..count {
                let len = read_u32_le(reader, "Failed to read comment length")? as usize;
                // Guard against pathological tags.
                if len > 256 * 1024 {
                    reader
                        .seek(SeekFrom::Current(len as i64))
                        .map_err(|e| format!("Failed to skip oversized vorbis comment: {e}"))?;
                    continue;
                }

                let mut buf = vec![0u8; len];
                read_exact_or_err(reader, &mut buf, "Failed to read vorbis comment")?;
                if let Ok(text) = String::from_utf8(buf) {
                    let mut parts = text.splitn(2, '=');
                    let Some(key) = parts.next() else { continue };
                    let Some(value) = parts.next() else { continue };
                    let key = normalize_vorbis_key(key);
                    let value = value.trim().to_string();
                    match key.as_str() {
                        "title" if title.is_none() => title = Some(value),
                        "artist" if artist.is_none() => artist = Some(value),
                        "album" if album.is_none() => album = Some(value),
                        "replaygain_track_gain" if replay_gain_track_db.is_none() => {
                            replay_gain_track_db = parse_replaygain_db(&value)
                        }
                        "replaygain_album_gain" if replay_gain_album_db.is_none() => {
                            replay_gain_album_db = parse_replaygain_db(&value)
                        }
                        _ => {}
                    }
                }
            }

            // Ensure we end exactly at the end of the block.
            let end_pos = start_pos + length as u64;
            let current = reader
                .stream_position()
                .map_err(|e| format!("Failed to get FLAC stream pos: {e}"))?;
            if current < end_pos {
                reader
                    .seek(SeekFrom::Start(end_pos))
                    .map_err(|e| format!("Failed to align to VORBIS_COMMENT end: {e}"))?;
            }

            continue;
        }

        // Skip other blocks.
        reader
            .seek(SeekFrom::Current(length as i64))
            .map_err(|e| format!("Failed to skip FLAC block type {block_type}: {e}"))?;

        if duration.is_some()
            && sample_rate.is_some()
            && bit_depth.is_some()
            && title.is_some()
            && artist.is_some()
            && album.is_some()
        {
            // We have everything we want.
            break;
        }
    }

    Ok(FlacQuickMetadata {
        duration,
        sample_rate,
        bit_depth,
        title,
        artist,
        album,
        replay_gain_track_db,
        replay_gain_album_db,
    })
}

fn parse_flac_picture_from_reader<R: Read + Seek>(
    reader: &mut R,
    max_bytes: u64,
) -> Result<Option<FlacPicture>, String> {
    let mut magic = [0u8; 4];
    read_exact_or_err(reader, &mut magic, "Failed to read FLAC magic")?;
    if &magic != b"fLaC" {
        return Ok(None);
    }

    let mut best: Option<(u32, FlacPicture)> = None;
    let mut is_last = false;
    while !is_last {
        let mut header = [0u8; 4];
        read_exact_or_err(reader, &mut header, "Failed to read FLAC metadata header")?;
        is_last = (header[0] & 0x80) != 0;
        let block_type = header[0] & 0x7F;
        let length: u32 =
            ((header[1] as u32) << 16) | ((header[2] as u32) << 8) | (header[3] as u32);

        if block_type != 6 {
            reader
                .seek(SeekFrom::Current(length as i64))
                .map_err(|e| format!("Failed to skip FLAC block type {block_type}: {e}"))?;
            continue;
        }

        let start_pos = reader
            .stream_position()
            .map_err(|e| format!("Failed to get FLAC stream pos: {e}"))?;

        // PICTURE block: https://xiph.org/flac/format.html#metadata_block_picture
        let picture_type = read_u32_be(reader, "Failed to read picture type")?;
        let mime_len = read_u32_be(reader, "Failed to read mime length")? as usize;
        if mime_len > 4096 {
            let end_pos = start_pos + length as u64;
            reader
                .seek(SeekFrom::Start(end_pos))
                .map_err(|e| format!("Failed to skip oversized mime: {e}"))?;
            continue;
        }
        let mut mime_buf = vec![0u8; mime_len];
        read_exact_or_err(reader, &mut mime_buf, "Failed to read mime")?;
        let mime = String::from_utf8(mime_buf).unwrap_or_else(|_| "image/jpeg".to_string());

        let desc_len = read_u32_be(reader, "Failed to read description length")? as usize;
        if desc_len > 1024 * 1024 {
            let end_pos = start_pos + length as u64;
            reader
                .seek(SeekFrom::Start(end_pos))
                .map_err(|e| format!("Failed to skip oversized description: {e}"))?;
            continue;
        }
        reader
            .seek(SeekFrom::Current(desc_len as i64))
            .map_err(|e| format!("Failed to skip description: {e}"))?;

        // Skip width/height/depth/colors.
        reader
            .seek(SeekFrom::Current(16))
            .map_err(|e| format!("Failed to skip picture dims: {e}"))?;

        let data_len = read_u32_be(reader, "Failed to read picture data length")? as u64;
        if data_len == 0 || data_len > max_bytes {
            // Skip remaining bytes in the block.
            let end_pos = start_pos + length as u64;
            reader
                .seek(SeekFrom::Start(end_pos))
                .map_err(|e| format!("Failed to skip oversized picture: {e}"))?;
            continue;
        }

        let mut data = vec![0u8; data_len as usize];
        read_exact_or_err(reader, &mut data, "Failed to read picture data")?;

        // Prefer Front Cover (type 3).
        let priority = if picture_type == 3 { 0 } else { 1 };
        let candidate = FlacPicture {
            data,
            media_type: mime,
        };
        match &best {
            None => best = Some((priority, candidate)),
            Some((best_priority, _)) if priority < *best_priority => {
                best = Some((priority, candidate))
            }
            _ => {}
        }

        // Align to end of block if we didn't consume it all.
        let end_pos = start_pos + length as u64;
        let current = reader
            .stream_position()
            .map_err(|e| format!("Failed to get FLAC stream pos: {e}"))?;
        if current < end_pos {
            reader
                .seek(SeekFrom::Start(end_pos))
                .map_err(|e| format!("Failed to align to PICTURE end: {e}"))?;
        }
    }

    Ok(best.map(|(_, pic)| pic))
}

fn extract_quick_metadata(
    path: &Path,
) -> Result<
    (
        Option<f64>,
        Option<u32>,
        Option<u32>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<f32>,
        Option<f32>,
    ),
    String,
> {
    if path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("dsf"))
    {
        let file = DsfFile::open(path).map_err(|e| format!("Failed to open DSF: {e:?}"))?;
        let fmt = file.fmt_chunk();
        let dsd_rate = fmt.sampling_frequency();
        let sample_count = fmt.sample_count();
        let duration = if dsd_rate > 0 {
            Some(sample_count as f64 / dsd_rate as f64)
        } else {
            None
        };

        let max_pcm_sample_rate: u32 = 384_000;
        let mut pcm_sample_rate: Option<u32> = None;
        for factor in [32u32, 64, 128, 256] {
            if dsd_rate == 0 || dsd_rate % factor != 0 {
                continue;
            }
            let candidate = dsd_rate / factor;
            if candidate > 0 && candidate <= max_pcm_sample_rate {
                pcm_sample_rate = Some(candidate);
                break;
            }
        }

        return Ok((
            duration,
            pcm_sample_rate,
            Some(1),
            None,
            None,
            None,
            None,
            None,
        ));
    }

    fn track_is_audio_like(track: &Track) -> bool {
        track.codec_params.sample_rate.is_some()
            || track.codec_params.channels.is_some()
            || track.codec_params.bits_per_sample.is_some()
            || track.codec_params.bits_per_coded_sample.is_some()
    }

    fn pick_audio_track<'a>(format: &'a dyn FormatReader) -> Option<&'a Track> {
        let tracks = format.tracks();
        let default = format.default_track();
        if let Some(track) = default {
            if track_is_audio_like(track) {
                return Some(track);
            }
        }
        tracks
            .iter()
            .find(|t| track_is_audio_like(t))
            .or(default)
            .or_else(|| tracks.first())
    }

    let file = fs::File::open(path).map_err(|e| format!("Failed to open file: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let format_options = FormatOptions {
        prebuild_seek_index: false,
        seek_index_fill_rate: 5,
        enable_gapless: false,
    };

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &format_options, &MetadataOptions::default())
        .map_err(|e| format!("Failed to probe format: {e}"))?;

    let symphonia::core::probe::ProbeResult {
        mut format,
        metadata: mut probed_metadata,
        ..
    } = probed;
    let track =
        pick_audio_track(format.as_ref()).ok_or_else(|| "No audio track found".to_string())?;

    let sample_rate = track.codec_params.sample_rate;
    let bit_depth = track
        .codec_params
        .bits_per_sample
        .or(track.codec_params.bits_per_coded_sample);

    let duration = track
        .codec_params
        .n_frames
        .and_then(|frames| sample_rate.map(|sr| frames as f64 / sr as f64));

    let mut title: Option<String> = None;
    let mut artist: Option<String> = None;
    let mut album: Option<String> = None;
    let mut replay_gain_track_db: Option<f32> = None;
    let mut replay_gain_album_db: Option<f32> = None;

    let mut apply_tags = |rev: &symphonia::core::meta::MetadataRevision| {
        for tag in rev.tags() {
            let key = tag.key.to_string().to_ascii_lowercase();
            let value = tag.value.to_string();
            match key.as_str() {
                "title" if title.is_none() => title = Some(value),
                "artist" if artist.is_none() => artist = Some(value),
                "album" if album.is_none() => album = Some(value),
                "replaygain_track_gain" if replay_gain_track_db.is_none() => {
                    replay_gain_track_db = parse_replaygain_db(&value)
                }
                "replaygain_album_gain" if replay_gain_album_db.is_none() => {
                    replay_gain_album_db = parse_replaygain_db(&value)
                }
                _ => {}
            }
        }
    };

    // Many formats expose tags via the probe metadata rather than format.metadata().
    if let Some(mut metadata) = probed_metadata.get() {
        for_each_metadata_revision(&mut metadata, |rev| apply_tags(rev));
    }

    let mut format_metadata = format.metadata();
    for_each_metadata_revision(&mut format_metadata, |rev| apply_tags(rev));

    Ok((
        duration,
        sample_rate,
        bit_depth,
        title,
        artist,
        album,
        replay_gain_track_db,
        replay_gain_album_db,
    ))
}

fn for_each_metadata_revision<F>(
    metadata: &mut symphonia::core::meta::Metadata<'_>,
    mut callback: F,
) where
    F: FnMut(&symphonia::core::meta::MetadataRevision),
{
    loop {
        let Some(rev) = metadata.current() else {
            break;
        };

        callback(rev);

        if metadata.pop().is_none() {
            break;
        }
    }
}

fn select_cover_from_metadata(
    metadata: &mut symphonia::core::meta::Metadata<'_>,
) -> Option<(Vec<u8>, String)> {
    let mut fallback: Option<(Vec<u8>, String)> = None;

    loop {
        let Some(rev) = metadata.current() else {
            break;
        };

        if let Some(front_cover) = rev
            .visuals()
            .iter()
            .find(|visual| visual.usage == Some(StandardVisualKey::FrontCover))
        {
            return Some((
                front_cover.data.as_ref().to_vec(),
                front_cover.media_type.clone(),
            ));
        }

        if let Some(first_visual) = rev.visuals().first() {
            fallback = Some((
                first_visual.data.as_ref().to_vec(),
                first_visual.media_type.clone(),
            ));
        }

        if metadata.pop().is_none() {
            break;
        }
    }

    fallback
}

fn stable_hash_for_path(path: &str) -> u32 {
    let normalized = path.replace('\\', "/").to_ascii_lowercase();
    let mut hash: u32 = 2166136261;
    for b in normalized.as_bytes() {
        hash ^= *b as u32;
        hash = hash.wrapping_mul(16777619);
    }
    hash
}

fn cover_cache_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let resolver = app.path_resolver();
    let base = resolver
        // Use AppData as the stable location for cached covers so the `asset://` protocol scope
        // can be configured once across platforms. (Some platforms map `app_cache_dir` into
        // per-user local locations that are harder to glob reliably.)
        .app_data_dir()
        .or_else(|| resolver.app_cache_dir())
        .ok_or_else(|| "Failed to resolve app data dir".to_string())?;

    let dir = base.join("music-covers");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create cover cache dir: {e}"))?;

    // `convertFileSrc()` uses the asset protocol which enforces a strict filesystem scope.
    // Ensure this session allows the cover cache directory even if the static glob patterns
    // in `tauri.conf.json` don't match the platform-specific resolved path.
    if !COVER_ASSET_SCOPE_READY.load(Ordering::Acquire) {
        if app
            .asset_protocol_scope()
            .allow_directory(&dir, true)
            .is_ok()
        {
            COVER_ASSET_SCOPE_READY.store(true, Ordering::Release);
        }
    }
    Ok(dir)
}

fn paths_equivalent(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }

    match (a.canonicalize(), b.canonicalize()) {
        (Ok(canonical_a), Ok(canonical_b)) => canonical_a == canonical_b,
        _ => false,
    }
}

fn merge_legacy_cover_cache_dir(source_dir: &Path, active_dir: &Path) -> Result<usize, String> {
    if !source_dir.exists() {
        return Ok(0);
    }
    if !source_dir.is_dir() {
        return Ok(0);
    }

    fs::create_dir_all(active_dir)
        .map_err(|error| format!("Failed to create active cover cache directory: {error}"))?;

    let mut migrated_files = 0usize;
    let entries = fs::read_dir(source_dir)
        .map_err(|error| format!("Failed to read legacy cover cache directory: {error}"))?;
    for entry in entries {
        let entry = match entry {
            Ok(value) => value,
            Err(error) => {
                eprintln!(
                    "[MusicLibrary] Failed to read legacy cover cache entry '{}': {error}",
                    source_dir.to_string_lossy()
                );
                continue;
            }
        };

        let source_path = entry.path();
        if !source_path.is_file() {
            continue;
        }

        let target_path = active_dir.join(entry.file_name());
        if target_path.exists() {
            let _ = fs::remove_file(&source_path);
            continue;
        }

        if fs::rename(&source_path, &target_path).is_ok() {
            migrated_files = migrated_files.saturating_add(1);
            continue;
        }

        match fs::copy(&source_path, &target_path) {
            Ok(_) => {
                migrated_files = migrated_files.saturating_add(1);
                let _ = fs::remove_file(&source_path);
            }
            Err(error) => {
                eprintln!(
                    "[MusicLibrary] Failed to migrate legacy cover '{}' -> '{}': {error}",
                    source_path.to_string_lossy(),
                    target_path.to_string_lossy()
                );
            }
        }
    }

    if let Err(error) = fs::remove_dir_all(source_dir) {
        if error.kind() != std::io::ErrorKind::NotFound {
            eprintln!(
                "[MusicLibrary] Failed to remove legacy cover cache directory '{}': {error}",
                source_dir.to_string_lossy()
            );
        }
    }

    Ok(migrated_files)
}

pub fn cleanup_legacy_cover_cache_dirs(app: &AppHandle) -> Result<(), String> {
    let active_dir = cover_cache_dir(app)?;
    let resolver = app.path_resolver();

    let mut migrated_total = 0usize;
    if let Some(cache_root) = resolver.app_cache_dir() {
        let candidate = cache_root.join("music-covers");
        if !paths_equivalent(&candidate, &active_dir) {
            migrated_total = migrated_total
                .saturating_add(merge_legacy_cover_cache_dir(&candidate, &active_dir)?);
        }
    }

    if migrated_total > 0 {
        eprintln!(
            "[MusicLibrary] Migrated {migrated_total} cover file(s) from legacy cache path(s)"
        );
    }

    Ok(())
}

fn cover_extension_from_media_type(media_type: &str) -> &'static str {
    let lower = media_type.to_ascii_lowercase();
    if lower.contains("png") {
        "png"
    } else if lower.contains("webp") {
        "webp"
    } else if lower.contains("bmp") {
        "bmp"
    } else if lower.contains("gif") {
        "gif"
    } else {
        "jpg"
    }
}

fn media_type_from_cover_path(path: &Path) -> Option<String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png".to_string()),
        "webp" => Some("image/webp".to_string()),
        "bmp" => Some("image/bmp".to_string()),
        "gif" => Some("image/gif".to_string()),
        "jpg" | "jpeg" => Some("image/jpeg".to_string()),
        _ => None,
    }
}

fn parse_cover_key_from_protocol_uri(uri: &str) -> Option<String> {
    let uri_without_fragment = uri.split('#').next().unwrap_or(uri);
    let uri_without_query = uri_without_fragment
        .split('?')
        .next()
        .unwrap_or(uri_without_fragment);

    let candidate = if let Some(rest) = uri_without_query.strip_prefix("pmp://cover/") {
        rest
    } else if let Some(rest) = uri_without_query.strip_prefix("pmp://localhost/cover/") {
        rest
    } else {
        return None;
    };

    let key = candidate.trim_matches('/');
    if key.is_empty() || key.len() > 192 {
        return None;
    }
    if key.contains('/') || key.contains('\\') {
        return None;
    }
    if !key
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.')
    {
        return None;
    }

    Some(key.to_string())
}

fn parse_cover_size_edge_from_protocol_uri(uri: &str) -> Option<u32> {
    let query = uri.split('?').nth(1)?.split('#').next().unwrap_or("");
    if query.is_empty() {
        return None;
    }

    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let mut parts = pair.splitn(2, '=');
        let key = parts.next().unwrap_or("").trim().to_ascii_lowercase();
        if key != "size" {
            continue;
        }

        let value = parts.next().unwrap_or("").trim().to_ascii_lowercase();
        return match value.as_str() {
            "small" => Some(160),
            "medium" => Some(256),
            "large" => Some(384),
            _ => None,
        };
    }

    None
}

fn strip_cover_thumb_suffix(key: &str) -> &str {
    let Some(prefix_end) = key.rfind("-thumb-") else {
        return key;
    };

    let suffix = &key[(prefix_end + "-thumb-".len())..];
    let Some(px_digits) = suffix.strip_suffix("px") else {
        return key;
    };
    if px_digits.is_empty() || !px_digits.chars().all(|ch| ch.is_ascii_digit()) {
        return key;
    }

    &key[..prefix_end]
}

fn candidate_cover_keys_for_protocol_request(
    request_key: &str,
    preferred_edge_px: Option<u32>,
) -> Vec<String> {
    if let Some(edge_px) = preferred_edge_px {
        let base_key = strip_cover_thumb_suffix(request_key);
        let preferred_variant = cover_variant_key(base_key, edge_px);
        if preferred_variant == request_key {
            return vec![preferred_variant];
        }
        return vec![preferred_variant, request_key.to_string()];
    }

    vec![request_key.to_string()]
}

fn build_protocol_response(
    status: u16,
    content_type: Option<&str>,
    body: Vec<u8>,
) -> Result<HttpResponse, Box<dyn std::error::Error>> {
    let mut response = HttpResponseBuilder::new().status(status);
    if let Some(content_type) = content_type {
        response = response.header("Content-Type", content_type);
    }
    response = response.header("Access-Control-Allow-Origin", "*");
    response = response.header("Cache-Control", "public, max-age=604800, immutable");
    response
        .header("Content-Length", body.len().to_string())
        .body(body)
}

pub fn handle_pmp_protocol_request<R: Runtime>(
    app: &AppHandle<R>,
    request: &HttpRequest,
) -> Result<HttpResponse, Box<dyn std::error::Error>> {
    let Some(cover_key) = parse_cover_key_from_protocol_uri(request.uri()) else {
        return build_protocol_response(404, Some("text/plain; charset=utf-8"), Vec::new());
    };
    let preferred_edge_px = parse_cover_size_edge_from_protocol_uri(request.uri());

    let dir = match cover_cache_dir(app) {
        Ok(dir) => dir,
        Err(_) => {
            return build_protocol_response(500, Some("text/plain; charset=utf-8"), Vec::new());
        }
    };

    let cover_path = candidate_cover_keys_for_protocol_request(&cover_key, preferred_edge_px)
        .into_iter()
        .find_map(|candidate_key| find_cached_cover_file(&dir, &candidate_key));

    let Some(cover_path) = cover_path else {
        return build_protocol_response(404, Some("text/plain; charset=utf-8"), Vec::new());
    };

    let metadata = match fs::metadata(&cover_path) {
        Ok(meta) if meta.is_file() => meta,
        _ => {
            return build_protocol_response(404, Some("text/plain; charset=utf-8"), Vec::new());
        }
    };

    if metadata.len() > 12 * 1024 * 1024 {
        return build_protocol_response(413, Some("text/plain; charset=utf-8"), Vec::new());
    }

    let bytes = match fs::read(&cover_path) {
        Ok(bytes) => bytes,
        Err(_) => {
            return build_protocol_response(500, Some("text/plain; charset=utf-8"), Vec::new());
        }
    };

    let mime = media_type_from_cover_path(&cover_path)
        .unwrap_or_else(|| "application/octet-stream".to_string());
    build_protocol_response(200, Some(mime.as_str()), bytes)
}

fn cover_variant_key(base_key: &str, max_edge_px: u32) -> String {
    if max_edge_px > 0 {
        format!("{base_key}-thumb-{max_edge_px}px")
    } else {
        base_key.to_string()
    }
}

fn create_cover_thumbnail_jpeg(source_bytes: &[u8], max_edge_px: u32) -> Result<Vec<u8>, String> {
    if max_edge_px == 0 {
        return Err("max_edge_px must be > 0".to_string());
    }

    let decoded = image::load_from_memory(source_bytes)
        .map_err(|e| format!("Failed to decode cover: {e}"))?;

    let resized = decoded.resize(
        max_edge_px,
        max_edge_px,
        image::imageops::FilterType::Triangle,
    );

    let mut out: Vec<u8> = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 85);
    encoder
        .encode_image(&resized)
        .map_err(|e| format!("Failed to encode cover thumbnail: {e}"))?;

    Ok(out)
}

fn cache_cover_variant(
    dir: &Path,
    base_key: String,
    bytes: Vec<u8>,
    media_type: String,
    max_bytes: u64,
    max_edge_px: u32,
) -> Result<Option<CachedCover>, String> {
    let (key, out_bytes, out_media_type, ext) = if max_edge_px > 0 {
        let thumbnail = create_cover_thumbnail_jpeg(&bytes, max_edge_px)?;
        if thumbnail.len() > max_bytes as usize {
            return Ok(None);
        }
        (
            cover_variant_key(&base_key, max_edge_px),
            thumbnail,
            "image/jpeg".to_string(),
            "jpg".to_string(),
        )
    } else {
        if bytes.len() > max_bytes as usize {
            return Ok(None);
        }
        let ext = cover_extension_from_media_type(&media_type).to_string();
        (base_key, bytes, media_type, ext)
    };

    let out_path = dir.join(format!("{key}.{ext}"));
    fs::write(&out_path, &out_bytes).map_err(|e| format!("Failed to write cover: {e}"))?;

    Ok(Some(CachedCover {
        key,
        path: out_path.to_string_lossy().to_string(),
        size: out_bytes.len() as u64,
        media_type: Some(out_media_type),
    }))
}

fn find_sidecar_cover(audio_path: &Path) -> Option<PathBuf> {
    let dir = audio_path.parent()?;
    let candidates = [
        "cover.jpg",
        "cover.jpeg",
        "cover.png",
        "cover.webp",
        "folder.jpg",
        "folder.jpeg",
        "folder.png",
        "folder.webp",
        "front.jpg",
        "front.jpeg",
        "front.png",
        "front.webp",
        "album.jpg",
        "album.jpeg",
        "album.png",
        "album.webp",
        "albumart.jpg",
        "albumart.jpeg",
        "albumart.png",
        "albumart.webp",
    ];

    for name in candidates {
        let path = dir.join(name);
        if path.exists() {
            return Some(path);
        }
    }

    None
}

fn find_cached_cover_file(dir: &Path, key: &str) -> Option<PathBuf> {
    let patterns = ["jpg", "jpeg", "png", "webp", "bmp", "gif"];
    for ext in patterns {
        let candidate = dir.join(format!("{key}.{ext}"));
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

pub fn get_or_create_cover(
    app: &AppHandle,
    audio_path: String,
    max_bytes: Option<u64>,
    max_edge_px: Option<u32>,
) -> Result<Option<CachedCover>, String> {
    let meta = fs::metadata(&audio_path).map_err(|e| format!("Failed to stat audio file: {e}"))?;
    if !meta.is_file() {
        return Ok(None);
    }
    let size = meta.len();
    let mtime_ms = meta.modified().map(system_time_to_millis).unwrap_or(0);

    let base_key = format!(
        "cover-{:08x}-{}-{}",
        stable_hash_for_path(&audio_path),
        mtime_ms,
        size
    );
    let dir = cover_cache_dir(app)?;

    let max_bytes = max_bytes.unwrap_or(256 * 1024);

    let max_edge_px = max_edge_px.unwrap_or(0);
    let key = cover_variant_key(&base_key, max_edge_px);

    if let Some(existing) = find_cached_cover_file(&dir, &key) {
        let existing_meta =
            fs::metadata(&existing).map_err(|e| format!("Failed to stat cached cover: {e}"))?;
        if existing_meta.len() > max_bytes {
            return Ok(None);
        }

        return Ok(Some(CachedCover {
            key,
            path: existing.to_string_lossy().to_string(),
            size: existing_meta.len(),
            media_type: media_type_from_cover_path(&existing),
        }));
    }

    // FLAC fast path: avoid symphonia probe for cover extraction (some FLACs fail probing on Windows).
    if Path::new(&audio_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("flac"))
        .unwrap_or(false)
    {
        let file = fs::File::open(&audio_path).map_err(|e| format!("Failed to open file: {e}"))?;
        let mut reader = std::io::BufReader::new(file);
        if let Ok(Some(pic)) = parse_flac_picture_from_reader(&mut reader, max_bytes) {
            return cache_cover_variant(
                &dir,
                base_key.clone(),
                pic.data,
                pic.media_type,
                max_bytes,
                max_edge_px,
            );
        }
    }

    // DSF fast path: symphonia cannot probe DSF for embedded visuals today.
    // Prefer sidecar covers (folder.jpg, cover.png, etc.) and avoid noisy probe errors.
    if Path::new(&audio_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("dsf"))
        .unwrap_or(false)
    {
        if let Some(sidecar) = find_sidecar_cover(Path::new(&audio_path)) {
            let meta =
                fs::metadata(&sidecar).map_err(|e| format!("Failed to stat sidecar cover: {e}"))?;
            if meta.is_file() && meta.len() <= max_bytes {
                let bytes =
                    fs::read(&sidecar).map_err(|e| format!("Failed to read sidecar cover: {e}"))?;
                let media_type = media_type_from_cover_path(&sidecar)
                    .unwrap_or_else(|| "image/jpeg".to_string());
                return cache_cover_variant(
                    &dir,
                    base_key.clone(),
                    bytes,
                    media_type,
                    max_bytes,
                    max_edge_px,
                );
            }
        }

        return Ok(None);
    }

    let file = fs::File::open(&audio_path).map_err(|e| format!("Failed to open file: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());

    let mut hint = Hint::new();
    if let Some(ext) = Path::new(&audio_path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let format_options = FormatOptions {
        prebuild_seek_index: false,
        seek_index_fill_rate: 5,
        enable_gapless: false,
    };

    let metadata_options = MetadataOptions {
        limit_visual_bytes: Limit::Maximum(max_bytes as usize),
        ..MetadataOptions::default()
    };

    let probed = match symphonia::default::get_probe().format(
        &hint,
        mss,
        &format_options,
        &metadata_options,
    ) {
        Ok(probed) => probed,
        Err(err) => {
            // If symphonia cannot probe the file, still try sidecar covers (folder.jpg, cover.png, etc.)
            // so the UI can show album art for playable-but-unusual files.
            if let Some(sidecar) = find_sidecar_cover(Path::new(&audio_path)) {
                if let Ok(meta) = fs::metadata(&sidecar) {
                    if meta.is_file() && meta.len() <= max_bytes {
                        if let Ok(bytes) = fs::read(&sidecar) {
                            let media_type = media_type_from_cover_path(&sidecar)
                                .unwrap_or_else(|| "image/jpeg".to_string());
                            let mtime_ms = meta.modified().map(system_time_to_millis).unwrap_or(0);
                            let sidecar_key = format!(
                                "cover-sidecar-{:08x}-{}-{}",
                                stable_hash_for_path(&sidecar.to_string_lossy()),
                                mtime_ms,
                                meta.len()
                            );

                            return cache_cover_variant(
                                &dir,
                                sidecar_key,
                                bytes,
                                media_type,
                                max_bytes,
                                max_edge_px,
                            );
                        }
                    }
                }
            }

            eprintln!("[MusicLibrary] Failed to probe format for cover (fallback to none): {err}");
            return Ok(None);
        }
    };

    let symphonia::core::probe::ProbeResult {
        mut format,
        metadata: mut probed_metadata,
        ..
    } = probed;

    let mut chosen: Option<(Vec<u8>, String)> = None;

    // Prefer probe metadata; some formats provide embedded visuals there (e.g. ID3).
    if let Some(mut metadata) = probed_metadata.get() {
        chosen = select_cover_from_metadata(&mut metadata);
    }

    if chosen.is_none() {
        let mut format_metadata = format.metadata();
        chosen = select_cover_from_metadata(&mut format_metadata);
    }

    let (chosen_data, chosen_media_type) = match chosen {
        Some(v) => v,
        None => {
            // Sidecar cover fallback (common in album folders).
            let sidecar = match find_sidecar_cover(Path::new(&audio_path)) {
                Some(p) => p,
                None => return Ok(None),
            };

            let meta =
                fs::metadata(&sidecar).map_err(|e| format!("Failed to stat cover image: {e}"))?;
            if !meta.is_file() {
                return Ok(None);
            }
            let sidecar_size = meta.len();
            if sidecar_size > max_bytes {
                return Ok(None);
            }

            let bytes =
                fs::read(&sidecar).map_err(|e| format!("Failed to read cover image: {e}"))?;
            if bytes.len() > max_bytes as usize {
                return Ok(None);
            }

            let mtime_ms = meta.modified().map(system_time_to_millis).unwrap_or(0);
            let sidecar_key = format!(
                "cover-sidecar-{:08x}-{}-{}",
                stable_hash_for_path(&sidecar.to_string_lossy()),
                mtime_ms,
                sidecar_size
            );

            let media_type =
                media_type_from_cover_path(&sidecar).unwrap_or_else(|| "image/jpeg".to_string());

            return cache_cover_variant(
                &dir,
                sidecar_key,
                bytes,
                media_type,
                max_bytes,
                max_edge_px,
            );
        }
    };

    cache_cover_variant(
        &dir,
        base_key,
        chosen_data,
        chosen_media_type,
        max_bytes,
        max_edge_px,
    )
}

pub fn remove_cached_cover(app: &AppHandle, key: String) -> Result<u64, String> {
    let dir = cover_cache_dir(app)?;

    let mut deleted: u64 = 0;
    let patterns = ["jpg", "jpeg", "png", "webp", "bmp", "gif"];
    for ext in patterns {
        let candidate = dir.join(format!("{key}.{ext}"));
        if candidate.exists() {
            if let Ok(meta) = fs::metadata(&candidate) {
                deleted = deleted.saturating_add(meta.len());
            }
            let _ = fs::remove_file(&candidate);
        }
    }

    Ok(deleted)
}

pub fn scan_library_paths(
    app: &AppHandle,
    paths: Vec<String>,
    options: Option<ScanOptions>,
) -> Result<Vec<ScannedTrack>, String> {
    MUSIC_LIBRARY_CANCEL_REQUESTED.store(false, Ordering::SeqCst);

    let include_metadata = options.and_then(|o| o.include_metadata).unwrap_or(true);

    let supported_exts: HashSet<&'static str> = [
        "mp3", "flac", "wav", "dsf", "m4a", "mp4", "ogg", "weba", "aac",
    ]
    .into_iter()
    .collect();

    let mut audio_files: Vec<PathBuf> = Vec::new();
    for root in paths {
        let root_path = PathBuf::from(root);
        if !root_path.exists() {
            continue;
        }
        if root_path.is_file() {
            if is_supported_audio(&root_path, &supported_exts) {
                audio_files.push(root_path);
            }
            continue;
        }
        if root_path.is_dir() {
            audio_files.extend(collect_audio_files(&root_path, &supported_exts)?);
        }
    }

    let total = audio_files.len() as u64;
    let _ = app.emit_all(
        EVENT_MUSIC_LIBRARY_SCAN_PROGRESS,
        ScanProgressPayload {
            total,
            current: 0,
            current_file: None,
        },
    );

    let mut results: Vec<ScannedTrack> = Vec::with_capacity(audio_files.len());
    for (idx, path) in audio_files.into_iter().enumerate() {
        if MUSIC_LIBRARY_CANCEL_REQUESTED.load(Ordering::SeqCst) {
            return Err("Scan cancelled".to_string());
        }

        let meta = fs::metadata(&path).map_err(|e| format!("Failed to stat {path:?}: {e}"))?;
        let size = meta.len();
        let mtime_ms = meta.modified().map(system_time_to_millis).unwrap_or(0);
        let quick_fingerprint = compute_quick_fingerprint(&path);
        let file_name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();

        let (
            duration,
            sample_rate,
            bit_depth,
            title,
            artist,
            album,
            replay_gain_track_db,
            replay_gain_album_db,
        ) = if include_metadata {
            match extract_quick_metadata(&path) {
                Ok(value) => value,
                Err(_) => {
                    // FLAC fallback: parse STREAMINFO/VORBIS_COMMENT directly without symphonia probing.
                    if path
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.eq_ignore_ascii_case("flac"))
                        .unwrap_or(false)
                    {
                        if let Ok(file) = fs::File::open(&path) {
                            let mut reader = std::io::BufReader::new(file);
                            if let Ok(meta) = parse_flac_quick_metadata_from_reader(&mut reader) {
                                (
                                    meta.duration,
                                    meta.sample_rate,
                                    meta.bit_depth,
                                    meta.title,
                                    meta.artist,
                                    meta.album,
                                    meta.replay_gain_track_db,
                                    meta.replay_gain_album_db,
                                )
                            } else {
                                (None, None, None, None, None, None, None, None)
                            }
                        } else {
                            (None, None, None, None, None, None, None, None)
                        }
                    } else {
                        (None, None, None, None, None, None, None, None)
                    }
                }
            }
        } else {
            (None, None, None, None, None, None, None, None)
        };

        let path_str = path.to_string_lossy().to_string();
        results.push(ScannedTrack {
            path: path_str.clone(),
            file_name: file_name.clone(),
            size,
            mtime_ms,
            quick_fingerprint,
            duration,
            sample_rate,
            bit_depth,
            title,
            artist,
            album,
            replay_gain_track_db,
            replay_gain_album_db,
        });

        let current = (idx + 1) as u64;
        if current % 20 == 0 || current == total {
            let _ = app.emit_all(
                EVENT_MUSIC_LIBRARY_SCAN_PROGRESS,
                ScanProgressPayload {
                    total,
                    current,
                    current_file: Some(file_name),
                },
            );
        }
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::{
        candidate_cover_keys_for_protocol_request, compute_quick_fingerprint,
        extract_quick_metadata, parse_cover_key_from_protocol_uri,
        parse_cover_size_edge_from_protocol_uri, parse_replaygain_db, select_cover_from_metadata,
        strip_cover_thumb_suffix,
    };
    use std::fs::File;
    use std::io::Write;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};
    use symphonia::core::meta::{MetadataBuilder, MetadataLog, StandardVisualKey, Visual};

    #[test]
    fn parse_replaygain_db_parses_db_suffix() {
        assert_eq!(parse_replaygain_db("+3.50 dB"), Some(3.5));
        assert_eq!(parse_replaygain_db("-7.23 dB"), Some(-7.23));
    }

    #[test]
    fn parse_replaygain_db_parses_plain_number() {
        assert_eq!(parse_replaygain_db("0"), Some(0.0));
        assert_eq!(parse_replaygain_db(" -12.0 "), Some(-12.0));
    }

    #[test]
    fn parse_replaygain_db_returns_none_on_garbage() {
        assert_eq!(parse_replaygain_db(""), None);
        assert_eq!(parse_replaygain_db("abc"), None);
    }

    fn write_minimal_dsf_stereo(path: &Path, dsd_rate: u32) {
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
        let block = vec![0xAA; block_size as usize];
        for _ in 0..channels {
            file.write_all(&block).unwrap();
        }
    }

    #[test]
    fn extract_quick_metadata_reads_dsf_headers() {
        let tmp_dir = std::env::temp_dir();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time ok")
            .as_nanos();
        let path = tmp_dir.join(format!("pmp_test_ml_{nonce}.dsf"));

        write_minimal_dsf_stereo(&path, 2_822_400);

        let (duration, sample_rate, bit_depth, ..) =
            extract_quick_metadata(&path).expect("extract dsf");
        assert!(duration.unwrap_or(0.0) > 0.0);
        assert_eq!(sample_rate, Some(88_200));
        assert_eq!(bit_depth, Some(1));

        let _ = std::fs::remove_file(&path);
    }

    fn write_fake_mp3_payload(path: &Path, payload: &[u8], id3_tag_len: usize) {
        let mut file = File::create(path).expect("create fake mp3");

        if id3_tag_len > 0 {
            let mut header = [0u8; 10];
            header[0..3].copy_from_slice(b"ID3");
            header[3] = 4;
            header[4] = 0;
            header[5] = 0;

            let size = id3_tag_len as u32;
            header[6] = ((size >> 21) & 0x7F) as u8;
            header[7] = ((size >> 14) & 0x7F) as u8;
            header[8] = ((size >> 7) & 0x7F) as u8;
            header[9] = (size & 0x7F) as u8;
            file.write_all(&header).expect("write id3 header");
            file.write_all(&vec![0xEE; id3_tag_len])
                .expect("write id3 payload");
        }

        file.write_all(payload).expect("write payload");
    }

    #[test]
    fn quick_fingerprint_ignores_id3v2_size_changes() {
        let tmp_dir = std::env::temp_dir();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time ok")
            .as_nanos();

        let base_path = tmp_dir.join(format!("pmp_qf_base_{nonce}.mp3"));
        let tagged_path = tmp_dir.join(format!("pmp_qf_tagged_{nonce}.mp3"));

        let payload = (0..(320 * 1024))
            .map(|idx| (idx % 251) as u8)
            .collect::<Vec<_>>();
        write_fake_mp3_payload(&base_path, &payload, 0);
        write_fake_mp3_payload(&tagged_path, &payload, 4096);

        let base_fp = compute_quick_fingerprint(&base_path).expect("base fingerprint");
        let tagged_fp = compute_quick_fingerprint(&tagged_path).expect("tagged fingerprint");
        assert_eq!(base_fp, tagged_fp);

        let _ = std::fs::remove_file(&base_path);
        let _ = std::fs::remove_file(&tagged_path);
    }

    #[test]
    fn quick_fingerprint_changes_when_audio_payload_changes() {
        let tmp_dir = std::env::temp_dir();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time ok")
            .as_nanos();

        let a_path = tmp_dir.join(format!("pmp_qf_a_{nonce}.mp3"));
        let b_path = tmp_dir.join(format!("pmp_qf_b_{nonce}.mp3"));

        let payload_a = (0..(320 * 1024))
            .map(|idx| (idx % 251) as u8)
            .collect::<Vec<_>>();
        let payload_b = (0..(320 * 1024))
            .map(|idx: usize| ((idx.wrapping_mul(3)) % 251) as u8)
            .collect::<Vec<_>>();

        write_fake_mp3_payload(&a_path, &payload_a, 2048);
        write_fake_mp3_payload(&b_path, &payload_b, 2048);

        let a_fp = compute_quick_fingerprint(&a_path).expect("fingerprint a");
        let b_fp = compute_quick_fingerprint(&b_path).expect("fingerprint b");
        assert_ne!(a_fp, b_fp);

        let _ = std::fs::remove_file(&a_path);
        let _ = std::fs::remove_file(&b_path);
    }

    #[test]
    fn parse_cover_key_from_protocol_uri_accepts_cover_key_path() {
        let key = parse_cover_key_from_protocol_uri("pmp://cover/cover-abc-thumb-256px")
            .expect("expected key");
        assert_eq!(key, "cover-abc-thumb-256px");
    }

    #[test]
    fn parse_cover_key_from_protocol_uri_rejects_path_traversal() {
        assert!(parse_cover_key_from_protocol_uri("pmp://cover/../../secret").is_none());
        assert!(parse_cover_key_from_protocol_uri("pmp://cover/cover%2fsecret").is_none());
    }

    #[test]
    fn parse_cover_size_edge_from_protocol_uri_reads_size_query() {
        assert_eq!(
            parse_cover_size_edge_from_protocol_uri("pmp://cover/cover-abc?size=small"),
            Some(160)
        );
        assert_eq!(
            parse_cover_size_edge_from_protocol_uri("pmp://cover/cover-abc?size=medium"),
            Some(256)
        );
        assert_eq!(
            parse_cover_size_edge_from_protocol_uri("pmp://cover/cover-abc?size=large"),
            Some(384)
        );
        assert_eq!(
            parse_cover_size_edge_from_protocol_uri("pmp://cover/cover-abc?size=unknown"),
            None
        );
    }

    #[test]
    fn strip_cover_thumb_suffix_extracts_base_key() {
        assert_eq!(
            strip_cover_thumb_suffix("cover-abc-thumb-256px"),
            "cover-abc"
        );
        assert_eq!(strip_cover_thumb_suffix("cover-abc"), "cover-abc");
    }

    #[test]
    fn candidate_cover_keys_for_protocol_request_prefers_sized_variant() {
        let candidates =
            candidate_cover_keys_for_protocol_request("cover-abc-thumb-256px", Some(160));
        assert_eq!(
            candidates,
            vec![
                "cover-abc-thumb-160px".to_string(),
                "cover-abc-thumb-256px".to_string()
            ]
        );
    }

    #[test]
    fn select_cover_from_metadata_scans_all_revisions_for_front_cover() {
        let mut log = MetadataLog::default();

        let mut first_builder = MetadataBuilder::new();
        first_builder.add_visual(Visual {
            media_type: "image/png".to_string(),
            dimensions: None,
            bits_per_pixel: None,
            color_mode: None,
            usage: Some(StandardVisualKey::Media),
            tags: Vec::new(),
            data: vec![1u8, 2u8, 3u8].into_boxed_slice(),
        });
        log.push(first_builder.metadata());

        let mut second_builder = MetadataBuilder::new();
        second_builder.add_visual(Visual {
            media_type: "image/jpeg".to_string(),
            dimensions: None,
            bits_per_pixel: None,
            color_mode: None,
            usage: Some(StandardVisualKey::FrontCover),
            tags: Vec::new(),
            data: vec![9u8, 8u8, 7u8].into_boxed_slice(),
        });
        log.push(second_builder.metadata());

        let mut metadata = log.metadata();
        let selected =
            select_cover_from_metadata(&mut metadata).expect("front cover from revisions");

        assert_eq!(selected.1, "image/jpeg");
        assert_eq!(selected.0, vec![9u8, 8u8, 7u8]);
    }

    #[test]
    fn select_cover_from_metadata_falls_back_to_latest_non_front_visual() {
        let mut log = MetadataLog::default();

        let mut first_builder = MetadataBuilder::new();
        first_builder.add_visual(Visual {
            media_type: "image/png".to_string(),
            dimensions: None,
            bits_per_pixel: None,
            color_mode: None,
            usage: Some(StandardVisualKey::Illustration),
            tags: Vec::new(),
            data: vec![10u8].into_boxed_slice(),
        });
        log.push(first_builder.metadata());

        let mut second_builder = MetadataBuilder::new();
        second_builder.add_visual(Visual {
            media_type: "image/webp".to_string(),
            dimensions: None,
            bits_per_pixel: None,
            color_mode: None,
            usage: Some(StandardVisualKey::BandArtistLogo),
            tags: Vec::new(),
            data: vec![20u8].into_boxed_slice(),
        });
        log.push(second_builder.metadata());

        let mut metadata = log.metadata();
        let selected =
            select_cover_from_metadata(&mut metadata).expect("fallback visual from revisions");

        assert_eq!(selected.1, "image/webp");
        assert_eq!(selected.0, vec![20u8]);
    }
}
