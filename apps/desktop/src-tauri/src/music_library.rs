use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

use dsf::DsfFile;
use once_cell::sync::Lazy;
use symphonia::core::{
    formats::{FormatOptions, FormatReader, Track},
    io::{MediaSourceStream, MediaSourceStreamOptions},
    meta::{Limit, MetadataOptions, StandardVisualKey},
    probe::Hint,
};

use base64::{engine::general_purpose, Engine as _};

pub const EVENT_MUSIC_LIBRARY_SCAN_PROGRESS: &str = "music-library-scan-progress";

static MUSIC_LIBRARY_CANCEL_REQUESTED: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(false));

pub fn request_cancel_scan() {
    MUSIC_LIBRARY_CANCEL_REQUESTED.store(true, Ordering::SeqCst);
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
    pub bytes_base64: Option<String>,
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

        return Ok((duration, pcm_sample_rate, Some(1), None, None, None, None, None));
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
    if let Some(metadata) = probed_metadata.get() {
        if let Some(rev) = metadata.current() {
            apply_tags(rev);
        }
    }
    if let Some(rev) = format.metadata().current() {
        apply_tags(rev);
    }

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

fn stable_hash_for_path(path: &str) -> u32 {
    let normalized = path.replace('\\', "/").to_ascii_lowercase();
    let mut hash: u32 = 2166136261;
    for b in normalized.as_bytes() {
        hash ^= *b as u32;
        hash = hash.wrapping_mul(16777619);
    }
    hash
}

fn cover_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let resolver = app.path_resolver();
    let base = resolver
        .app_cache_dir()
        .or_else(|| resolver.app_data_dir())
        .ok_or_else(|| "Failed to resolve app cache dir".to_string())?;

    let dir = base.join("music-covers");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create cover cache dir: {e}"))?;
    Ok(dir)
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
) -> Result<Option<CachedCover>, String> {
    let meta = fs::metadata(&audio_path).map_err(|e| format!("Failed to stat audio file: {e}"))?;
    if !meta.is_file() {
        return Ok(None);
    }
    let size = meta.len();
    let mtime_ms = meta.modified().map(system_time_to_millis).unwrap_or(0);

    let key = format!(
        "cover-{:08x}-{}-{}",
        stable_hash_for_path(&audio_path),
        mtime_ms,
        size
    );
    let dir = cover_cache_dir(app)?;

    let max_bytes = max_bytes.unwrap_or(256 * 1024);

    if let Some(existing) = find_cached_cover_file(&dir, &key) {
        let existing_meta =
            fs::metadata(&existing).map_err(|e| format!("Failed to stat cached cover: {e}"))?;
        if existing_meta.len() > max_bytes {
            return Ok(None);
        }

        let bytes = fs::read(&existing).map_err(|e| format!("Failed to read cached cover: {e}"))?;
        let bytes_base64 = general_purpose::STANDARD.encode(&bytes);

        return Ok(Some(CachedCover {
            key,
            path: existing.to_string_lossy().to_string(),
            size: existing_meta.len(),
            media_type: media_type_from_cover_path(&existing),
            bytes_base64: Some(bytes_base64),
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
            let ext = cover_extension_from_media_type(&pic.media_type);
            let out_path = dir.join(format!("{key}.{ext}"));
            fs::write(&out_path, &pic.data).map_err(|e| format!("Failed to write cover: {e}"))?;
            let bytes_base64 = general_purpose::STANDARD.encode(&pic.data);
            return Ok(Some(CachedCover {
                key,
                path: out_path.to_string_lossy().to_string(),
                size: pic.data.len() as u64,
                media_type: Some(pic.media_type),
                bytes_base64: Some(bytes_base64),
            }));
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
                let ext = cover_extension_from_media_type(&media_type);
                let out_path = dir.join(format!("{key}.{ext}"));
                fs::write(&out_path, &bytes).map_err(|e| format!("Failed to write cover: {e}"))?;
                let bytes_base64 = general_purpose::STANDARD.encode(&bytes);

                return Ok(Some(CachedCover {
                    key,
                    path: out_path.to_string_lossy().to_string(),
                    size: bytes.len() as u64,
                    media_type: Some(media_type),
                    bytes_base64: Some(bytes_base64),
                }));
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
                            let bytes_base64 = general_purpose::STANDARD.encode(&bytes);
                            let mtime_ms = meta.modified().map(system_time_to_millis).unwrap_or(0);
                            let sidecar_key = format!(
                                "cover-sidecar-{:08x}-{}-{}",
                                stable_hash_for_path(&sidecar.to_string_lossy()),
                                mtime_ms,
                                meta.len()
                            );
                            let ext = cover_extension_from_media_type(&media_type);
                            let out_path = dir.join(format!("{sidecar_key}.{ext}"));
                            let _ = fs::write(&out_path, &bytes);
                            return Ok(Some(CachedCover {
                                key: sidecar_key,
                                path: out_path.to_string_lossy().to_string(),
                                size: bytes.len() as u64,
                                media_type: Some(media_type),
                                bytes_base64: Some(bytes_base64),
                            }));
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

    fn choose_from_revision<'a>(
        rev: &'a symphonia::core::meta::MetadataRevision,
    ) -> Option<&'a symphonia::core::meta::Visual> {
        if rev.visuals().is_empty() {
            return None;
        }
        for visual in rev.visuals() {
            if visual.usage == Some(StandardVisualKey::FrontCover) {
                return Some(visual);
            }
        }
        Some(&rev.visuals()[0])
    }

    let mut chosen: Option<(Vec<u8>, String)> = None;

    // Prefer probe metadata; some formats provide embedded visuals there (e.g. ID3).
    if let Some(metadata) = probed_metadata.get() {
        if let Some(rev) = metadata.current() {
            if let Some(visual) = choose_from_revision(rev) {
                chosen = Some((visual.data.as_ref().to_vec(), visual.media_type.clone()));
            }
        }
    }
    if chosen.is_none() {
        let format_metadata = format.metadata();
        if let Some(rev) = format_metadata.current() {
            if let Some(visual) = choose_from_revision(rev) {
                chosen = Some((visual.data.as_ref().to_vec(), visual.media_type.clone()));
            }
        }
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
            let bytes_base64 = general_purpose::STANDARD.encode(&bytes);

            let ext = cover_extension_from_media_type(&media_type);
            let out_path = dir.join(format!("{sidecar_key}.{ext}"));
            let _ = fs::write(&out_path, &bytes);

            return Ok(Some(CachedCover {
                key: sidecar_key,
                path: out_path.to_string_lossy().to_string(),
                size: bytes.len() as u64,
                media_type: Some(media_type),
                bytes_base64: Some(bytes_base64),
            }));
        }
    };

    if chosen_data.len() > max_bytes as usize {
        return Ok(None);
    }

    let bytes_base64 = general_purpose::STANDARD.encode(&chosen_data);

    let ext = cover_extension_from_media_type(&chosen_media_type);
    let out_path = dir.join(format!("{key}.{ext}"));
    fs::write(&out_path, &chosen_data).map_err(|e| format!("Failed to write cover: {e}"))?;

    Ok(Some(CachedCover {
        key,
        path: out_path.to_string_lossy().to_string(),
        size: chosen_data.len() as u64,
        media_type: Some(chosen_media_type),
        bytes_base64: Some(bytes_base64),
    }))
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

    let supported_exts: HashSet<&'static str> =
        ["mp3", "flac", "wav", "dsf", "m4a", "mp4", "ogg", "weba", "aac"]
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
    use super::{extract_quick_metadata, parse_replaygain_db};
    use std::fs::File;
    use std::io::Write;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

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
}
