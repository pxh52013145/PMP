use once_cell::sync::{Lazy, OnceCell};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::AppHandle;

const DB_VERSION: i32 = 4;

static DB_CONN: Lazy<Mutex<Option<Connection>>> = Lazy::new(|| Mutex::new(None));
static DB_PATH: OnceCell<PathBuf> = OnceCell::new();

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySourceUpsertInput {
    pub id: String,
    pub path: String,
    pub display_name: Option<String>,
    pub category: Option<String>,
    pub is_visible: Option<bool>,
    pub is_scanned: Option<bool>,
    pub added_at_ms: Option<i64>,
    pub last_scanned_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySourceRecord {
    pub id: String,
    pub path: String,
    pub display_name: Option<String>,
    pub category: String,
    pub track_count: u64,
    pub is_visible: bool,
    pub is_scanned: bool,
    pub added_at_ms: i64,
    pub last_scanned_at_ms: Option<i64>,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTrackUpsertInput {
    pub id: String,
    pub file_path: String,
    pub quick_fingerprint: Option<String>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub duration: Option<f64>,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u32>,
    pub file_size: Option<u64>,
    pub mtime_ms: Option<i64>,
    pub replay_gain_track_db: Option<f32>,
    pub replay_gain_album_db: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTrackSyncResult {
    pub upserted: usize,
    pub marked_missing: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTrackQueryInput {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub include_missing: Option<bool>,
    pub visible_only: Option<bool>,
    pub search_query: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track_id: Option<String>,
    pub source_id: Option<String>,
    pub quick_fingerprint: Option<String>,
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTrackRecord {
    pub id: String,
    pub source_id: String,
    pub file_path: String,
    pub quick_fingerprint: Option<String>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub duration_seconds: Option<f64>,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u32>,
    pub file_size: Option<u64>,
    pub mtime_ms: Option<i64>,
    pub replay_gain_track_db: Option<f32>,
    pub replay_gain_album_db: Option<f32>,
    pub play_count: u64,
    pub last_played_at_ms: Option<i64>,
    pub status: String,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFacetQueryInput {
    pub include_missing: Option<bool>,
    pub visible_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryAlbumRecord {
    pub album: String,
    pub artist: String,
    pub cover_track_id: String,
    pub cover_track_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStatsRecord {
    pub total_tracks: u64,
    pub total_artists: u64,
    pub total_albums: u64,
    pub total_size: u64,
    pub total_duration: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySourceHealthQueryInput {
    pub source_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySourceHealthRecord {
    pub source_id: String,
    pub source_path: String,
    pub source_display_name: Option<String>,
    pub total_tracks: u64,
    pub available_tracks: u64,
    pub missing_tracks: u64,
    pub total_artists: u64,
    pub total_albums: u64,
    pub total_size: u64,
    pub source_updated_at_ms: i64,
    pub last_track_updated_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryUserEntryUpsertInput {
    pub id: String,
    pub owner_uid: String,
    pub track_id: Option<String>,
    pub quick_fingerprint: Option<String>,
    pub cloud_content_id: Option<String>,
    pub display_title: Option<String>,
    pub display_artist: Option<String>,
    pub rating: Option<i64>,
    pub tags_json: Option<String>,
    pub in_cloud: Option<bool>,
    pub is_missing: Option<bool>,
    pub created_at_ms: Option<i64>,
    pub updated_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryUserEntryQueryInput {
    pub owner_uid: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub in_cloud_only: Option<bool>,
    pub include_missing: Option<bool>,
    pub search_query: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryUserEntryRecord {
    pub id: String,
    pub owner_uid: String,
    pub track_id: Option<String>,
    pub quick_fingerprint: Option<String>,
    pub cloud_content_id: Option<String>,
    pub display_title: Option<String>,
    pub display_artist: Option<String>,
    pub rating: Option<i64>,
    pub tags_json: Option<String>,
    pub in_cloud: bool,
    pub is_missing: bool,
    pub play_count: u64,
    pub last_played_at_ms: Option<i64>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFallbackTaskUpsertInput {
    pub id: Option<String>,
    pub owner_uid: String,
    pub entry_id: String,
    pub cloud_content_id: Option<String>,
    pub track_id: Option<String>,
    pub quick_fingerprint: Option<String>,
    pub reason: Option<String>,
    pub requested_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFallbackTaskQueryInput {
    pub owner_uid: Option<String>,
    pub status: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFallbackTaskRecord {
    pub id: String,
    pub owner_uid: String,
    pub entry_id: String,
    pub cloud_content_id: Option<String>,
    pub track_id: Option<String>,
    pub quick_fingerprint: Option<String>,
    pub reason: String,
    pub status: String,
    pub enqueue_count: u64,
    pub requested_at_ms: i64,
    pub last_requested_at_ms: i64,
    pub updated_at_ms: i64,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCloudHashJobUpsertInput {
    pub id: Option<String>,
    pub owner_uid: String,
    pub entry_id: String,
    pub track_id: Option<String>,
    pub quick_fingerprint: Option<String>,
    pub status: Option<String>,
    pub cloud_full_hash: Option<String>,
    pub last_error: Option<String>,
    pub requested_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCloudHashJobQueryInput {
    pub owner_uid: Option<String>,
    pub status: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCloudHashJobRecord {
    pub id: String,
    pub owner_uid: String,
    pub entry_id: String,
    pub track_id: Option<String>,
    pub quick_fingerprint: Option<String>,
    pub status: String,
    pub cloud_full_hash: Option<String>,
    pub last_error: Option<String>,
    pub attempt_count: u64,
    pub requested_at_ms: i64,
    pub updated_at_ms: i64,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

fn db_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Unable to resolve app data directory".to_string())?;
    let dir = app_data_dir.join("music-library");
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Failed to create music-library directory: {error}"))?;
    Ok(dir.join("music-library-v1.sqlite3"))
}

fn conn() -> Result<std::sync::MutexGuard<'static, Option<Connection>>, String> {
    DB_CONN
        .lock()
        .map_err(|_| "Music library DB state is locked".to_string())
}

fn with_conn<T>(op: impl FnOnce(&mut Connection) -> Result<T, String>) -> Result<T, String> {
    let mut guard = conn()?;
    let Some(conn) = guard.as_mut() else {
        return Err("Music library DB is not initialized".to_string());
    };
    op(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|error| format!("Failed to enable foreign keys: {error}"))?;
    conn.execute_batch("PRAGMA journal_mode = WAL;")
        .map_err(|error| format!("Failed to set journal mode: {error}"))?;
    conn.execute_batch("PRAGMA synchronous = NORMAL;")
        .map_err(|error| format!("Failed to set synchronous pragma: {error}"))?;

    let mut version: i32 = conn
        .query_row("PRAGMA user_version;", [], |row| row.get(0))
        .map_err(|error| format!("Failed to read schema version: {error}"))?;

    if version == 0 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS sources (
              id TEXT PRIMARY KEY NOT NULL,
              path TEXT NOT NULL UNIQUE,
              display_name TEXT,
              category TEXT NOT NULL DEFAULT 'music',
              is_visible INTEGER NOT NULL DEFAULT 1,
              is_scanned INTEGER NOT NULL DEFAULT 1,
              added_at_ms INTEGER NOT NULL,
              last_scanned_at_ms INTEGER,
              updated_at_ms INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS sources_is_visible_idx ON sources(is_visible);
            CREATE INDEX IF NOT EXISTS sources_is_scanned_idx ON sources(is_scanned);

            CREATE TABLE IF NOT EXISTS local_tracks (
              id TEXT PRIMARY KEY NOT NULL,
              source_id TEXT NOT NULL,
              file_path TEXT NOT NULL,
              quick_fingerprint TEXT,
              title TEXT,
              artist TEXT,
              album TEXT,
              genre TEXT,
              duration_seconds REAL,
              sample_rate INTEGER,
              bit_depth INTEGER,
              file_size INTEGER,
              mtime_ms INTEGER,
              replay_gain_track_db REAL,
              replay_gain_album_db REAL,
              play_count INTEGER NOT NULL DEFAULT 0,
              last_played_at_ms INTEGER,
              status TEXT NOT NULL DEFAULT 'available',
              created_at_ms INTEGER NOT NULL,
              updated_at_ms INTEGER NOT NULL,
              last_seen_at_ms INTEGER NOT NULL,
              FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE,
              UNIQUE(source_id, file_path)
            );

            CREATE INDEX IF NOT EXISTS local_tracks_source_id_idx ON local_tracks(source_id);
            CREATE INDEX IF NOT EXISTS local_tracks_quick_fingerprint_idx ON local_tracks(quick_fingerprint);
            CREATE INDEX IF NOT EXISTS local_tracks_status_idx ON local_tracks(status);

            CREATE TABLE IF NOT EXISTS user_entries (
              id TEXT PRIMARY KEY NOT NULL,
              owner_uid TEXT NOT NULL,
              track_id TEXT,
              quick_fingerprint TEXT,
              cloud_content_id TEXT,
              display_title TEXT,
              display_artist TEXT,
              rating INTEGER,
              tags_json TEXT,
              in_cloud INTEGER NOT NULL DEFAULT 0,
              is_missing INTEGER NOT NULL DEFAULT 0,
              play_count INTEGER NOT NULL DEFAULT 0,
              last_played_at_ms INTEGER,
              created_at_ms INTEGER NOT NULL,
              updated_at_ms INTEGER NOT NULL,
              FOREIGN KEY(track_id) REFERENCES local_tracks(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS user_entries_owner_uid_idx ON user_entries(owner_uid);
            CREATE INDEX IF NOT EXISTS user_entries_track_id_idx ON user_entries(track_id);
            CREATE INDEX IF NOT EXISTS user_entries_quick_fingerprint_idx ON user_entries(quick_fingerprint);
            CREATE INDEX IF NOT EXISTS user_entries_cloud_content_id_idx ON user_entries(cloud_content_id);
            CREATE INDEX IF NOT EXISTS user_entries_last_played_at_ms_idx ON user_entries(last_played_at_ms);

            CREATE TABLE IF NOT EXISTS fallback_tasks (
              id TEXT PRIMARY KEY NOT NULL,
              owner_uid TEXT NOT NULL,
              entry_id TEXT NOT NULL,
              cloud_content_id TEXT,
              track_id TEXT,
              quick_fingerprint TEXT,
              reason TEXT NOT NULL DEFAULT 'local-miss',
              status TEXT NOT NULL DEFAULT 'queued',
              enqueue_count INTEGER NOT NULL DEFAULT 1,
              requested_at_ms INTEGER NOT NULL,
              last_requested_at_ms INTEGER NOT NULL,
              updated_at_ms INTEGER NOT NULL,
              last_error TEXT
            );

            CREATE INDEX IF NOT EXISTS fallback_tasks_owner_uid_idx ON fallback_tasks(owner_uid);
            CREATE INDEX IF NOT EXISTS fallback_tasks_status_idx ON fallback_tasks(status);
            CREATE INDEX IF NOT EXISTS fallback_tasks_last_requested_at_ms_idx ON fallback_tasks(last_requested_at_ms);
            CREATE INDEX IF NOT EXISTS fallback_tasks_entry_id_idx ON fallback_tasks(entry_id);

            CREATE TABLE IF NOT EXISTS cloud_hash_jobs (
              id TEXT PRIMARY KEY NOT NULL,
              owner_uid TEXT NOT NULL,
              entry_id TEXT NOT NULL,
              track_id TEXT,
              quick_fingerprint TEXT,
              status TEXT NOT NULL DEFAULT 'pending',
              cloud_full_hash TEXT,
              last_error TEXT,
              attempt_count INTEGER NOT NULL DEFAULT 1,
              requested_at_ms INTEGER NOT NULL,
              updated_at_ms INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS cloud_hash_jobs_owner_uid_idx ON cloud_hash_jobs(owner_uid);
            CREATE INDEX IF NOT EXISTS cloud_hash_jobs_status_idx ON cloud_hash_jobs(status);
            CREATE INDEX IF NOT EXISTS cloud_hash_jobs_requested_at_ms_idx ON cloud_hash_jobs(requested_at_ms);
            CREATE INDEX IF NOT EXISTS cloud_hash_jobs_entry_id_idx ON cloud_hash_jobs(entry_id);

            PRAGMA user_version = 4;
            "#,
        )
        .map_err(|error| format!("Failed to initialize music library schema: {error}"))?;
        version = 4;
    }

    if version == 1 {
        conn.execute_batch(
            r#"
            ALTER TABLE local_tracks ADD COLUMN genre TEXT;
            PRAGMA user_version = 2;
            "#,
        )
        .map_err(|error| format!("Failed to migrate music library schema to v2: {error}"))?;
        version = 2;
    }

    if version == 2 {
        conn.execute_batch(
            r#"
            ALTER TABLE local_tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE local_tracks ADD COLUMN last_played_at_ms INTEGER;
            PRAGMA user_version = 3;
            "#,
        )
        .map_err(|error| format!("Failed to migrate music library schema to v3: {error}"))?;
        version = 3;
    }

    if version == 3 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS user_entries (
              id TEXT PRIMARY KEY NOT NULL,
              owner_uid TEXT NOT NULL,
              track_id TEXT,
              quick_fingerprint TEXT,
              cloud_content_id TEXT,
              display_title TEXT,
              display_artist TEXT,
              rating INTEGER,
              tags_json TEXT,
              in_cloud INTEGER NOT NULL DEFAULT 0,
              is_missing INTEGER NOT NULL DEFAULT 0,
              play_count INTEGER NOT NULL DEFAULT 0,
              last_played_at_ms INTEGER,
              created_at_ms INTEGER NOT NULL,
              updated_at_ms INTEGER NOT NULL,
              FOREIGN KEY(track_id) REFERENCES local_tracks(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS user_entries_owner_uid_idx ON user_entries(owner_uid);
            CREATE INDEX IF NOT EXISTS user_entries_track_id_idx ON user_entries(track_id);
            CREATE INDEX IF NOT EXISTS user_entries_quick_fingerprint_idx ON user_entries(quick_fingerprint);
            CREATE INDEX IF NOT EXISTS user_entries_cloud_content_id_idx ON user_entries(cloud_content_id);
            CREATE INDEX IF NOT EXISTS user_entries_last_played_at_ms_idx ON user_entries(last_played_at_ms);

            CREATE TABLE IF NOT EXISTS fallback_tasks (
              id TEXT PRIMARY KEY NOT NULL,
              owner_uid TEXT NOT NULL,
              entry_id TEXT NOT NULL,
              cloud_content_id TEXT,
              track_id TEXT,
              quick_fingerprint TEXT,
              reason TEXT NOT NULL DEFAULT 'local-miss',
              status TEXT NOT NULL DEFAULT 'queued',
              enqueue_count INTEGER NOT NULL DEFAULT 1,
              requested_at_ms INTEGER NOT NULL,
              last_requested_at_ms INTEGER NOT NULL,
              updated_at_ms INTEGER NOT NULL,
              last_error TEXT
            );

            CREATE INDEX IF NOT EXISTS fallback_tasks_owner_uid_idx ON fallback_tasks(owner_uid);
            CREATE INDEX IF NOT EXISTS fallback_tasks_status_idx ON fallback_tasks(status);
            CREATE INDEX IF NOT EXISTS fallback_tasks_last_requested_at_ms_idx ON fallback_tasks(last_requested_at_ms);
            CREATE INDEX IF NOT EXISTS fallback_tasks_entry_id_idx ON fallback_tasks(entry_id);

            CREATE TABLE IF NOT EXISTS cloud_hash_jobs (
              id TEXT PRIMARY KEY NOT NULL,
              owner_uid TEXT NOT NULL,
              entry_id TEXT NOT NULL,
              track_id TEXT,
              quick_fingerprint TEXT,
              status TEXT NOT NULL DEFAULT 'pending',
              cloud_full_hash TEXT,
              last_error TEXT,
              attempt_count INTEGER NOT NULL DEFAULT 1,
              requested_at_ms INTEGER NOT NULL,
              updated_at_ms INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS cloud_hash_jobs_owner_uid_idx ON cloud_hash_jobs(owner_uid);
            CREATE INDEX IF NOT EXISTS cloud_hash_jobs_status_idx ON cloud_hash_jobs(status);
            CREATE INDEX IF NOT EXISTS cloud_hash_jobs_requested_at_ms_idx ON cloud_hash_jobs(requested_at_ms);
            CREATE INDEX IF NOT EXISTS cloud_hash_jobs_entry_id_idx ON cloud_hash_jobs(entry_id);

            PRAGMA user_version = 4;
            "#,
        )
        .map_err(|error| format!("Failed to migrate music library schema to v4: {error}"))?;
        version = 4;
    }

    if version != DB_VERSION {
        return Err(format!(
            "Unsupported music library DB schema version: {version} (expected {DB_VERSION})"
        ));
    }

    conn.execute_batch(
        r#"
        CREATE INDEX IF NOT EXISTS local_tracks_artist_idx ON local_tracks(artist);
        CREATE INDEX IF NOT EXISTS local_tracks_album_idx ON local_tracks(album);
        CREATE INDEX IF NOT EXISTS local_tracks_last_played_at_ms_idx ON local_tracks(last_played_at_ms);
        "#,
    )
    .map_err(|error| format!("Failed to ensure music library query indexes: {error}"))?;

    Ok(())
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    {
        let guard = conn()?;
        if guard.is_some() {
            return Ok(());
        }
    }

    let path = db_file_path(app)?;
    let _ = DB_PATH.set(path.clone());
    let connection = Connection::open(&path)
        .map_err(|error| format!("Failed to open music library DB: {error}"))?;
    migrate(&connection)?;

    let mut guard = conn()?;
    *guard = Some(connection);
    Ok(())
}

fn ensure_initialized(app: &AppHandle) -> Result<(), String> {
    let ready = {
        let guard = conn()?;
        guard.is_some()
    };
    if ready {
        Ok(())
    } else {
        init(app)
    }
}

fn normalize_bool_flag(value: Option<bool>, fallback: bool) -> i64 {
    if value.unwrap_or(fallback) {
        1
    } else {
        0
    }
}

fn normalize_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn normalize_quick_fingerprint(value: Option<&str>) -> Option<String> {
    let raw = value?.trim().to_lowercase();
    if raw.is_empty() {
        return None;
    }

    let normalized = raw.strip_prefix("qf2:").unwrap_or(raw.as_str());
    if normalized.len() < 16 || normalized.len() > 128 {
        return None;
    }
    if !normalized.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return None;
    }

    Some(format!("qf2:{normalized}"))
}

fn normalize_owner_uid(value: Option<&str>) -> Option<String> {
    normalize_text(value)
}

fn normalize_rating(value: Option<i64>) -> Option<i64> {
    value.map(|score| score.clamp(0, 100))
}

fn normalize_fallback_reason(value: Option<&str>) -> String {
    match value
        .map(|item| item.trim().to_ascii_lowercase())
        .filter(|item| !item.is_empty())
        .as_deref()
    {
        Some("manual-retry") => "manual-retry".to_string(),
        Some("sync-restore") => "sync-restore".to_string(),
        Some("local-miss") => "local-miss".to_string(),
        _ => "local-miss".to_string(),
    }
}

fn normalize_fallback_status(value: Option<&str>) -> String {
    match value
        .map(|item| item.trim().to_ascii_lowercase())
        .filter(|item| !item.is_empty())
        .as_deref()
    {
        Some("queued") => "queued".to_string(),
        Some("dispatching") => "dispatching".to_string(),
        Some("resolved") => "resolved".to_string(),
        Some("failed") => "failed".to_string(),
        Some("cancelled") => "cancelled".to_string(),
        _ => "queued".to_string(),
    }
}

fn normalize_cloud_hash_job_status(value: Option<&str>) -> String {
    match value
        .map(|item| item.trim().to_ascii_lowercase())
        .filter(|item| !item.is_empty())
        .as_deref()
    {
        Some("pending") => "pending".to_string(),
        Some("running") => "running".to_string(),
        Some("completed") => "completed".to_string(),
        Some("failed") => "failed".to_string(),
        _ => "pending".to_string(),
    }
}

fn normalize_limit(value: Option<u32>) -> i64 {
    value
        .map(|item| item.clamp(1, 2000) as i64)
        .unwrap_or(i64::MAX)
}

fn normalize_offset(value: Option<u32>) -> i64 {
    value.map(|item| item as i64).unwrap_or(0)
}

fn build_fallback_task_id(
    owner_uid: &str,
    entry_id: &str,
    track_id: Option<&str>,
    quick_fingerprint: Option<&str>,
    cloud_content_id: Option<&str>,
) -> String {
    format!(
        "{}::{}::{}::{}::{}",
        owner_uid,
        entry_id,
        track_id.unwrap_or_default(),
        quick_fingerprint.unwrap_or_default(),
        cloud_content_id.unwrap_or_default()
    )
}

fn build_cloud_hash_job_id(owner_uid: &str, entry_id: &str, track_id: Option<&str>) -> String {
    format!(
        "{}::{}::{}",
        owner_uid,
        entry_id,
        track_id.unwrap_or_default()
    )
}

fn user_entry_record_by_id(
    conn: &Connection,
    entry_id: &str,
) -> Result<LibraryUserEntryRecord, String> {
    conn.query_row(
        r#"
        SELECT
          id,
          owner_uid,
          track_id,
          quick_fingerprint,
          cloud_content_id,
          display_title,
          display_artist,
          rating,
          tags_json,
          in_cloud,
          is_missing,
          play_count,
          last_played_at_ms,
          created_at_ms,
          updated_at_ms
        FROM user_entries
        WHERE id = ?1
        "#,
        params![entry_id],
        |row| {
            Ok(LibraryUserEntryRecord {
                id: row.get(0)?,
                owner_uid: row.get(1)?,
                track_id: row.get(2)?,
                quick_fingerprint: row.get(3)?,
                cloud_content_id: row.get(4)?,
                display_title: row.get(5)?,
                display_artist: row.get(6)?,
                rating: row.get(7)?,
                tags_json: row.get(8)?,
                in_cloud: row.get::<_, i64>(9)? != 0,
                is_missing: row.get::<_, i64>(10)? != 0,
                play_count: row.get::<_, i64>(11)?.max(0) as u64,
                last_played_at_ms: row.get(12)?,
                created_at_ms: row.get(13)?,
                updated_at_ms: row.get(14)?,
            })
        },
    )
    .map_err(|error| format!("Failed to load user entry record: {error}"))
}

fn fallback_task_record_by_id(
    conn: &Connection,
    task_id: &str,
) -> Result<LibraryFallbackTaskRecord, String> {
    conn.query_row(
        r#"
        SELECT
          id,
          owner_uid,
          entry_id,
          cloud_content_id,
          track_id,
          quick_fingerprint,
          reason,
          status,
          enqueue_count,
          requested_at_ms,
          last_requested_at_ms,
          updated_at_ms,
          last_error
        FROM fallback_tasks
        WHERE id = ?1
        "#,
        params![task_id],
        |row| {
            Ok(LibraryFallbackTaskRecord {
                id: row.get(0)?,
                owner_uid: row.get(1)?,
                entry_id: row.get(2)?,
                cloud_content_id: row.get(3)?,
                track_id: row.get(4)?,
                quick_fingerprint: row.get(5)?,
                reason: row.get(6)?,
                status: row.get(7)?,
                enqueue_count: row.get::<_, i64>(8)?.max(0) as u64,
                requested_at_ms: row.get(9)?,
                last_requested_at_ms: row.get(10)?,
                updated_at_ms: row.get(11)?,
                last_error: row.get(12)?,
            })
        },
    )
    .map_err(|error| format!("Failed to load fallback task record: {error}"))
}

fn cloud_hash_job_record_by_id(
    conn: &Connection,
    job_id: &str,
) -> Result<LibraryCloudHashJobRecord, String> {
    conn.query_row(
        r#"
        SELECT
          id,
          owner_uid,
          entry_id,
          track_id,
          quick_fingerprint,
          status,
          cloud_full_hash,
          last_error,
          attempt_count,
          requested_at_ms,
          updated_at_ms
        FROM cloud_hash_jobs
        WHERE id = ?1
        "#,
        params![job_id],
        |row| {
            Ok(LibraryCloudHashJobRecord {
                id: row.get(0)?,
                owner_uid: row.get(1)?,
                entry_id: row.get(2)?,
                track_id: row.get(3)?,
                quick_fingerprint: row.get(4)?,
                status: row.get(5)?,
                cloud_full_hash: row.get(6)?,
                last_error: row.get(7)?,
                attempt_count: row.get::<_, i64>(8)?.max(0) as u64,
                requested_at_ms: row.get(9)?,
                updated_at_ms: row.get(10)?,
            })
        },
    )
    .map_err(|error| format!("Failed to load cloud hash job record: {error}"))
}

fn source_record_by_id(conn: &Connection, source_id: &str) -> Result<LibrarySourceRecord, String> {
    conn.query_row(
        r#"
        SELECT
          id,
          path,
          display_name,
          category,
          (
            SELECT COUNT(*)
            FROM local_tracks t
            WHERE t.source_id = sources.id
              AND t.status = 'available'
          ) AS track_count,
          is_visible,
          is_scanned,
          added_at_ms,
          last_scanned_at_ms,
          updated_at_ms
        FROM sources
        WHERE id = ?1
        "#,
        params![source_id],
        |row| {
            Ok(LibrarySourceRecord {
                id: row.get(0)?,
                path: row.get(1)?,
                display_name: row.get(2)?,
                category: row.get(3)?,
                track_count: row.get::<_, i64>(4)?.max(0) as u64,
                is_visible: row.get::<_, i64>(5)? != 0,
                is_scanned: row.get::<_, i64>(6)? != 0,
                added_at_ms: row.get(7)?,
                last_scanned_at_ms: row.get(8)?,
                updated_at_ms: row.get(9)?,
            })
        },
    )
    .map_err(|error| format!("Failed to load source record: {error}"))
}

pub fn upsert_source(
    app: &AppHandle,
    input: LibrarySourceUpsertInput,
) -> Result<LibrarySourceRecord, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let source_id = input.id.trim();
        if source_id.is_empty() {
            return Err("Source id is required".to_string());
        }

        let source_path = input.path.trim();
        if source_path.is_empty() {
            return Err("Source path is required".to_string());
        }

        let now = now_ms();
        let category =
            normalize_text(input.category.as_deref()).unwrap_or_else(|| "music".to_string());
        let display_name = normalize_text(input.display_name.as_deref());

        conn.execute(
            r#"
            INSERT INTO sources(
              id,
              path,
              display_name,
              category,
              is_visible,
              is_scanned,
              added_at_ms,
              last_scanned_at_ms,
              updated_at_ms
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(id) DO UPDATE SET
              path = excluded.path,
              display_name = excluded.display_name,
              category = excluded.category,
              is_visible = excluded.is_visible,
              is_scanned = excluded.is_scanned,
              last_scanned_at_ms = COALESCE(excluded.last_scanned_at_ms, sources.last_scanned_at_ms),
              updated_at_ms = excluded.updated_at_ms
            "#,
            params![
                source_id,
                source_path,
                display_name,
                category,
                normalize_bool_flag(input.is_visible, true),
                normalize_bool_flag(input.is_scanned, true),
                input.added_at_ms.unwrap_or(now),
                input.last_scanned_at_ms,
                now,
            ],
        )
        .map_err(|error| format!("Failed to upsert source: {error}"))?;

        source_record_by_id(conn, source_id)
    })
}

pub fn list_sources(app: &AppHandle) -> Result<Vec<LibrarySourceRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                  id,
                  path,
                  display_name,
                  category,
                  (
                    SELECT COUNT(*)
                    FROM local_tracks t
                    WHERE t.source_id = sources.id
                      AND t.status = 'available'
                  ) AS track_count,
                  is_visible,
                  is_scanned,
                  added_at_ms,
                  last_scanned_at_ms,
                  updated_at_ms
                FROM sources
                ORDER BY added_at_ms ASC
                "#,
            )
            .map_err(|error| format!("Failed to prepare list sources query: {error}"))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(LibrarySourceRecord {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    display_name: row.get(2)?,
                    category: row.get(3)?,
                    track_count: row.get::<_, i64>(4)?.max(0) as u64,
                    is_visible: row.get::<_, i64>(5)? != 0,
                    is_scanned: row.get::<_, i64>(6)? != 0,
                    added_at_ms: row.get(7)?,
                    last_scanned_at_ms: row.get(8)?,
                    updated_at_ms: row.get(9)?,
                })
            })
            .map_err(|error| format!("Failed to query source rows: {error}"))?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|error| format!("Failed to parse source row: {error}"))?);
        }
        Ok(items)
    })
}

pub fn remove_source(app: &AppHandle, source_id: &str) -> Result<(), String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        conn.execute("DELETE FROM sources WHERE id = ?1", params![source_id])
            .map_err(|error| format!("Failed to remove source: {error}"))?;
        Ok(())
    })
}

pub fn sync_source_tracks(
    app: &AppHandle,
    source_id: &str,
    upserts: Vec<LibraryTrackUpsertInput>,
    missing_track_ids: Vec<String>,
) -> Result<LibraryTrackSyncResult, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let now = now_ms();
        let tx = conn
            .transaction()
            .map_err(|error| format!("Failed to start source track sync transaction: {error}"))?;

        let mut upserted = 0usize;
        for item in upserts {
            let track_id = item.id.trim();
            let file_path = item.file_path.trim();
            if track_id.is_empty() || file_path.is_empty() {
                continue;
            }

            tx.execute(
                r#"
                INSERT INTO local_tracks(
                  id,
                  source_id,
                  file_path,
                  quick_fingerprint,
                  title,
                  artist,
                  album,
                  genre,
                  duration_seconds,
                  sample_rate,
                  bit_depth,
                  file_size,
                  mtime_ms,
                  replay_gain_track_db,
                  replay_gain_album_db,
                  status,
                  created_at_ms,
                  updated_at_ms,
                  last_seen_at_ms
                )
                VALUES (
                  ?1,
                  ?2,
                  ?3,
                  ?4,
                  ?5,
                  ?6,
                  ?7,
                  ?8,
                  ?9,
                  ?10,
                  ?11,
                  ?12,
                  ?13,
                  ?14,
                  ?15,
                  'available',
                  ?16,
                  ?17,
                  ?18
                )
                ON CONFLICT(id) DO UPDATE SET
                  source_id = excluded.source_id,
                  file_path = excluded.file_path,
                  quick_fingerprint = excluded.quick_fingerprint,
                  title = excluded.title,
                  artist = excluded.artist,
                  album = excluded.album,
                  genre = excluded.genre,
                  duration_seconds = excluded.duration_seconds,
                  sample_rate = excluded.sample_rate,
                  bit_depth = excluded.bit_depth,
                  file_size = excluded.file_size,
                  mtime_ms = excluded.mtime_ms,
                  replay_gain_track_db = excluded.replay_gain_track_db,
                  replay_gain_album_db = excluded.replay_gain_album_db,
                  status = 'available',
                  updated_at_ms = excluded.updated_at_ms,
                  last_seen_at_ms = excluded.last_seen_at_ms
                "#,
                params![
                    track_id,
                    source_id,
                    file_path,
                    normalize_quick_fingerprint(item.quick_fingerprint.as_deref()),
                    normalize_text(item.title.as_deref()),
                    normalize_text(item.artist.as_deref()),
                    normalize_text(item.album.as_deref()),
                    normalize_text(item.genre.as_deref()),
                    item.duration,
                    item.sample_rate.map(|value| value as i64),
                    item.bit_depth.map(|value| value as i64),
                    item.file_size.map(|value| value as i64),
                    item.mtime_ms,
                    item.replay_gain_track_db,
                    item.replay_gain_album_db,
                    now,
                    now,
                    now,
                ],
            )
            .map_err(|error| format!("Failed to upsert source track: {error}"))?;
            upserted += 1;
        }

        let mut marked_missing = 0usize;
        for track_id in missing_track_ids {
            let normalized = track_id.trim();
            if normalized.is_empty() {
                continue;
            }

            let affected = tx
                .execute(
                    r#"
                    UPDATE local_tracks
                    SET status = 'missing', updated_at_ms = ?3
                    WHERE source_id = ?1 AND id = ?2
                    "#,
                    params![source_id, normalized, now],
                )
                .map_err(|error| format!("Failed to mark track as missing: {error}"))?;
            marked_missing += affected as usize;
        }

        tx.execute(
            "UPDATE sources SET last_scanned_at_ms = ?2, updated_at_ms = ?2 WHERE id = ?1",
            params![source_id, now],
        )
        .map_err(|error| format!("Failed to update source scan metadata: {error}"))?;

        tx.commit()
            .map_err(|error| format!("Failed to commit source track sync transaction: {error}"))?;

        Ok(LibraryTrackSyncResult {
            upserted,
            marked_missing,
        })
    })
}

pub fn clear_tracks(app: &AppHandle) -> Result<u64, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let affected = conn
            .execute("DELETE FROM local_tracks", [])
            .map_err(|error| format!("Failed to clear tracks: {error}"))?;
        Ok(affected as u64)
    })
}

pub fn delete_tracks(app: &AppHandle, track_ids: Vec<String>) -> Result<u64, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_ids: Vec<String> = track_ids
            .into_iter()
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty())
            .collect();

        if normalized_ids.is_empty() {
            return Ok(0);
        }

        let tx = conn
            .transaction()
            .map_err(|error| format!("Failed to start delete tracks transaction: {error}"))?;

        let mut deleted = 0_u64;
        for track_id in normalized_ids {
            let affected = tx
                .execute("DELETE FROM local_tracks WHERE id = ?1", params![track_id])
                .map_err(|error| format!("Failed to delete track: {error}"))?;
            deleted += affected as u64;
        }

        tx.commit()
            .map_err(|error| format!("Failed to commit delete tracks transaction: {error}"))?;

        Ok(deleted)
    })
}

pub fn mark_track_played(
    app: &AppHandle,
    track_id: &str,
    played_at_ms: Option<i64>,
) -> Result<bool, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_track_id = track_id.trim();
        if normalized_track_id.is_empty() {
            return Ok(false);
        }

        let now = played_at_ms.unwrap_or_else(now_ms).max(0);
        let affected = conn
            .execute(
                r#"
                UPDATE local_tracks
                SET
                  play_count = COALESCE(play_count, 0) + 1,
                  last_played_at_ms = ?2,
                  updated_at_ms = CASE
                    WHEN updated_at_ms > ?2 THEN updated_at_ms
                    ELSE ?2
                  END
                WHERE id = ?1
                "#,
                params![normalized_track_id, now],
            )
            .map_err(|error| format!("Failed to mark track played: {error}"))?;
        Ok(affected > 0)
    })
}

pub fn upsert_user_entry(
    app: &AppHandle,
    input: LibraryUserEntryUpsertInput,
) -> Result<LibraryUserEntryRecord, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let entry_id = input.id.trim();
        if entry_id.is_empty() {
            return Err("User entry id is required".to_string());
        }

        let owner_uid = normalize_owner_uid(Some(input.owner_uid.as_str()))
            .ok_or_else(|| "User entry ownerUid is required".to_string())?;

        let now = now_ms();
        let created_at_ms = input.created_at_ms.unwrap_or(now).max(0);
        let updated_at_ms = input.updated_at_ms.unwrap_or(now).max(created_at_ms);

        conn.execute(
            r#"
            INSERT INTO user_entries(
              id,
              owner_uid,
              track_id,
              quick_fingerprint,
              cloud_content_id,
              display_title,
              display_artist,
              rating,
              tags_json,
              in_cloud,
              is_missing,
              created_at_ms,
              updated_at_ms
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            ON CONFLICT(id) DO UPDATE SET
              owner_uid = excluded.owner_uid,
              track_id = excluded.track_id,
              quick_fingerprint = excluded.quick_fingerprint,
              cloud_content_id = excluded.cloud_content_id,
              display_title = excluded.display_title,
              display_artist = excluded.display_artist,
              rating = excluded.rating,
              tags_json = excluded.tags_json,
              in_cloud = excluded.in_cloud,
              is_missing = excluded.is_missing,
              updated_at_ms = excluded.updated_at_ms
            "#,
            params![
                entry_id,
                owner_uid,
                normalize_text(input.track_id.as_deref()),
                normalize_quick_fingerprint(input.quick_fingerprint.as_deref()),
                normalize_text(input.cloud_content_id.as_deref()),
                normalize_text(input.display_title.as_deref()),
                normalize_text(input.display_artist.as_deref()),
                normalize_rating(input.rating),
                normalize_text(input.tags_json.as_deref()),
                normalize_bool_flag(input.in_cloud, false),
                normalize_bool_flag(input.is_missing, false),
                created_at_ms,
                updated_at_ms,
            ],
        )
        .map_err(|error| format!("Failed to upsert user entry: {error}"))?;

        user_entry_record_by_id(conn, entry_id)
    })
}

pub fn list_user_entries(
    app: &AppHandle,
    query: Option<LibraryUserEntryQueryInput>,
) -> Result<Vec<LibraryUserEntryRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_limit = normalize_limit(query.as_ref().and_then(|item| item.limit));
        let normalized_offset = normalize_offset(query.as_ref().and_then(|item| item.offset));
        let normalized_owner_uid = query
            .as_ref()
            .and_then(|item| item.owner_uid.as_ref())
            .and_then(|value| normalize_owner_uid(Some(value.as_str())));
        let owner_uid_enabled_flag = if normalized_owner_uid.is_some() {
            1_i64
        } else {
            0_i64
        };
        let owner_uid_exact_value = normalized_owner_uid.unwrap_or_default();
        let in_cloud_only_flag = if query
            .as_ref()
            .and_then(|item| item.in_cloud_only)
            .unwrap_or(false)
        {
            1_i64
        } else {
            0_i64
        };
        let include_missing_flag = if query
            .as_ref()
            .and_then(|item| item.include_missing)
            .unwrap_or(true)
        {
            1_i64
        } else {
            0_i64
        };
        let normalized_search_query = query
            .as_ref()
            .and_then(|item| item.search_query.as_ref())
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| !value.is_empty());
        let search_enabled_flag = if normalized_search_query.is_some() {
            1_i64
        } else {
            0_i64
        };
        let search_like_pattern = normalized_search_query
            .map(|value| format!("%{value}%"))
            .unwrap_or_else(|| "%".to_string());

        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                  id,
                  owner_uid,
                  track_id,
                  quick_fingerprint,
                  cloud_content_id,
                  display_title,
                  display_artist,
                  rating,
                  tags_json,
                  in_cloud,
                  is_missing,
                  play_count,
                  last_played_at_ms,
                  created_at_ms,
                  updated_at_ms
                FROM user_entries
                WHERE (?1 = 0 OR owner_uid = ?2)
                  AND (?3 = 0 OR in_cloud = 1)
                  AND (?4 = 1 OR is_missing = 0)
                  AND (
                    ?5 = 0
                    OR LOWER(COALESCE(display_title, '')) LIKE ?6
                    OR LOWER(COALESCE(display_artist, '')) LIKE ?6
                    OR LOWER(COALESCE(cloud_content_id, '')) LIKE ?6
                    OR LOWER(COALESCE(quick_fingerprint, '')) LIKE ?6
                    OR LOWER(id) LIKE ?6
                  )
                ORDER BY
                  COALESCE(last_played_at_ms, updated_at_ms) DESC,
                  updated_at_ms DESC,
                  id ASC
                LIMIT ?7
                OFFSET ?8
                "#,
            )
            .map_err(|error| format!("Failed to prepare list user entries statement: {error}"))?;

        let rows = stmt
            .query_map(
                params![
                    owner_uid_enabled_flag,
                    owner_uid_exact_value,
                    in_cloud_only_flag,
                    include_missing_flag,
                    search_enabled_flag,
                    search_like_pattern,
                    normalized_limit,
                    normalized_offset,
                ],
                |row| {
                    Ok(LibraryUserEntryRecord {
                        id: row.get(0)?,
                        owner_uid: row.get(1)?,
                        track_id: row.get(2)?,
                        quick_fingerprint: row.get(3)?,
                        cloud_content_id: row.get(4)?,
                        display_title: row.get(5)?,
                        display_artist: row.get(6)?,
                        rating: row.get(7)?,
                        tags_json: row.get(8)?,
                        in_cloud: row.get::<_, i64>(9)? != 0,
                        is_missing: row.get::<_, i64>(10)? != 0,
                        play_count: row.get::<_, i64>(11)?.max(0) as u64,
                        last_played_at_ms: row.get(12)?,
                        created_at_ms: row.get(13)?,
                        updated_at_ms: row.get(14)?,
                    })
                },
            )
            .map_err(|error| format!("Failed to query user entries: {error}"))?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|error| format!("Failed to parse user entry row: {error}"))?);
        }
        Ok(items)
    })
}

pub fn delete_user_entry(app: &AppHandle, entry_id: &str) -> Result<bool, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_entry_id = entry_id.trim();
        if normalized_entry_id.is_empty() {
            return Ok(false);
        }
        let affected = conn
            .execute(
                "DELETE FROM user_entries WHERE id = ?1",
                params![normalized_entry_id],
            )
            .map_err(|error| format!("Failed to delete user entry: {error}"))?;
        Ok(affected > 0)
    })
}

pub fn mark_user_entry_played(
    app: &AppHandle,
    entry_id: &str,
    played_at_ms: Option<i64>,
) -> Result<bool, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_entry_id = entry_id.trim();
        if normalized_entry_id.is_empty() {
            return Ok(false);
        }

        let now = played_at_ms.unwrap_or_else(now_ms).max(0);
        let affected = conn
            .execute(
                r#"
                UPDATE user_entries
                SET
                  play_count = COALESCE(play_count, 0) + 1,
                  last_played_at_ms = ?2,
                  updated_at_ms = CASE
                    WHEN updated_at_ms > ?2 THEN updated_at_ms
                    ELSE ?2
                  END
                WHERE id = ?1
                "#,
                params![normalized_entry_id, now],
            )
            .map_err(|error| format!("Failed to mark user entry played: {error}"))?;

        Ok(affected > 0)
    })
}

pub fn upsert_fallback_task(
    app: &AppHandle,
    input: LibraryFallbackTaskUpsertInput,
) -> Result<LibraryFallbackTaskRecord, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let owner_uid = normalize_owner_uid(Some(input.owner_uid.as_str()))
            .ok_or_else(|| "Fallback task ownerUid is required".to_string())?;
        let entry_id = normalize_text(Some(input.entry_id.as_str()))
            .ok_or_else(|| "Fallback task entryId is required".to_string())?;
        let track_id = normalize_text(input.track_id.as_deref());
        let quick_fingerprint = normalize_quick_fingerprint(input.quick_fingerprint.as_deref());
        let cloud_content_id = normalize_text(input.cloud_content_id.as_deref());
        let reason = normalize_fallback_reason(input.reason.as_deref());

        let task_id = normalize_text(input.id.as_deref()).unwrap_or_else(|| {
            build_fallback_task_id(
                owner_uid.as_str(),
                entry_id.as_str(),
                track_id.as_deref(),
                quick_fingerprint.as_deref(),
                cloud_content_id.as_deref(),
            )
        });

        if task_id.is_empty() {
            return Err("Fallback task id is required".to_string());
        }

        let now = now_ms();
        let requested_at_ms = input.requested_at_ms.unwrap_or(now).max(0);

        conn.execute(
            r#"
            INSERT INTO fallback_tasks(
              id,
              owner_uid,
              entry_id,
              cloud_content_id,
              track_id,
              quick_fingerprint,
              reason,
              status,
              enqueue_count,
              requested_at_ms,
              last_requested_at_ms,
              updated_at_ms,
              last_error
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'queued', 1, ?8, ?8, ?9, NULL)
            ON CONFLICT(id) DO UPDATE SET
              owner_uid = excluded.owner_uid,
              entry_id = excluded.entry_id,
              cloud_content_id = COALESCE(excluded.cloud_content_id, fallback_tasks.cloud_content_id),
              track_id = COALESCE(excluded.track_id, fallback_tasks.track_id),
              quick_fingerprint = COALESCE(excluded.quick_fingerprint, fallback_tasks.quick_fingerprint),
              reason = excluded.reason,
              status = 'queued',
              enqueue_count = COALESCE(fallback_tasks.enqueue_count, 0) + 1,
              last_requested_at_ms = excluded.last_requested_at_ms,
              updated_at_ms = excluded.updated_at_ms,
              last_error = NULL
            "#,
            params![
                task_id,
                owner_uid,
                entry_id,
                cloud_content_id,
                track_id,
                quick_fingerprint,
                reason,
                requested_at_ms,
                now,
            ],
        )
        .map_err(|error| format!("Failed to upsert fallback task: {error}"))?;

        fallback_task_record_by_id(conn, task_id.as_str())
    })
}

pub fn list_fallback_tasks(
    app: &AppHandle,
    query: Option<LibraryFallbackTaskQueryInput>,
) -> Result<Vec<LibraryFallbackTaskRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_limit = normalize_limit(query.as_ref().and_then(|item| item.limit));
        let normalized_offset = normalize_offset(query.as_ref().and_then(|item| item.offset));
        let normalized_owner_uid = query
            .as_ref()
            .and_then(|item| item.owner_uid.as_ref())
            .and_then(|value| normalize_owner_uid(Some(value.as_str())));
        let owner_uid_enabled_flag = if normalized_owner_uid.is_some() {
            1_i64
        } else {
            0_i64
        };
        let owner_uid_exact_value = normalized_owner_uid.unwrap_or_default();
        let normalized_status = query
            .as_ref()
            .and_then(|item| item.status.as_ref())
            .map(|value| normalize_fallback_status(Some(value.as_str())));
        let status_enabled_flag = if normalized_status.is_some() {
            1_i64
        } else {
            0_i64
        };
        let status_exact_value = normalized_status.unwrap_or_default();

        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                  id,
                  owner_uid,
                  entry_id,
                  cloud_content_id,
                  track_id,
                  quick_fingerprint,
                  reason,
                  status,
                  enqueue_count,
                  requested_at_ms,
                  last_requested_at_ms,
                  updated_at_ms,
                  last_error
                FROM fallback_tasks
                WHERE (?1 = 0 OR owner_uid = ?2)
                  AND (?3 = 0 OR status = ?4)
                ORDER BY last_requested_at_ms DESC, updated_at_ms DESC, id ASC
                LIMIT ?5
                OFFSET ?6
                "#,
            )
            .map_err(|error| format!("Failed to prepare fallback task query statement: {error}"))?;

        let rows = stmt
            .query_map(
                params![
                    owner_uid_enabled_flag,
                    owner_uid_exact_value,
                    status_enabled_flag,
                    status_exact_value,
                    normalized_limit,
                    normalized_offset,
                ],
                |row| {
                    Ok(LibraryFallbackTaskRecord {
                        id: row.get(0)?,
                        owner_uid: row.get(1)?,
                        entry_id: row.get(2)?,
                        cloud_content_id: row.get(3)?,
                        track_id: row.get(4)?,
                        quick_fingerprint: row.get(5)?,
                        reason: row.get(6)?,
                        status: row.get(7)?,
                        enqueue_count: row.get::<_, i64>(8)?.max(0) as u64,
                        requested_at_ms: row.get(9)?,
                        last_requested_at_ms: row.get(10)?,
                        updated_at_ms: row.get(11)?,
                        last_error: row.get(12)?,
                    })
                },
            )
            .map_err(|error| format!("Failed to query fallback task rows: {error}"))?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|error| format!("Failed to parse fallback task row: {error}"))?);
        }
        Ok(items)
    })
}

pub fn update_fallback_task_status(
    app: &AppHandle,
    task_id: &str,
    status: &str,
    last_error: Option<String>,
) -> Result<bool, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_task_id = task_id.trim();
        if normalized_task_id.is_empty() {
            return Ok(false);
        }
        let normalized_status = normalize_fallback_status(Some(status));
        let now = now_ms();

        let affected = conn
            .execute(
                r#"
                UPDATE fallback_tasks
                SET
                  status = ?2,
                  last_error = ?3,
                  updated_at_ms = ?4
                WHERE id = ?1
                "#,
                params![
                    normalized_task_id,
                    normalized_status,
                    normalize_text(last_error.as_deref()),
                    now
                ],
            )
            .map_err(|error| format!("Failed to update fallback task status: {error}"))?;
        Ok(affected > 0)
    })
}

pub fn upsert_cloud_hash_job(
    app: &AppHandle,
    input: LibraryCloudHashJobUpsertInput,
) -> Result<LibraryCloudHashJobRecord, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let owner_uid = normalize_owner_uid(Some(input.owner_uid.as_str()))
            .ok_or_else(|| "Cloud hash job ownerUid is required".to_string())?;
        let entry_id = normalize_text(Some(input.entry_id.as_str()))
            .ok_or_else(|| "Cloud hash job entryId is required".to_string())?;
        let track_id = normalize_text(input.track_id.as_deref());
        let quick_fingerprint = normalize_quick_fingerprint(input.quick_fingerprint.as_deref());
        let status = normalize_cloud_hash_job_status(input.status.as_deref());
        let cloud_full_hash = normalize_text(input.cloud_full_hash.as_deref());
        let last_error = normalize_text(input.last_error.as_deref());

        let job_id = normalize_text(input.id.as_deref()).unwrap_or_else(|| {
            build_cloud_hash_job_id(owner_uid.as_str(), entry_id.as_str(), track_id.as_deref())
        });
        if job_id.is_empty() {
            return Err("Cloud hash job id is required".to_string());
        }

        let now = now_ms();
        let requested_at_ms = input.requested_at_ms.unwrap_or(now).max(0);

        conn.execute(
            r#"
            INSERT INTO cloud_hash_jobs(
              id,
              owner_uid,
              entry_id,
              track_id,
              quick_fingerprint,
              status,
              cloud_full_hash,
              last_error,
              attempt_count,
              requested_at_ms,
              updated_at_ms
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?10)
            ON CONFLICT(id) DO UPDATE SET
              owner_uid = excluded.owner_uid,
              entry_id = excluded.entry_id,
              track_id = COALESCE(excluded.track_id, cloud_hash_jobs.track_id),
              quick_fingerprint = COALESCE(excluded.quick_fingerprint, cloud_hash_jobs.quick_fingerprint),
              status = excluded.status,
              cloud_full_hash = COALESCE(excluded.cloud_full_hash, cloud_hash_jobs.cloud_full_hash),
              last_error = excluded.last_error,
              attempt_count = CASE
                WHEN excluded.status = 'pending' OR excluded.status = 'running'
                  THEN COALESCE(cloud_hash_jobs.attempt_count, 0) + 1
                ELSE COALESCE(cloud_hash_jobs.attempt_count, 0)
              END,
              requested_at_ms = CASE
                WHEN cloud_hash_jobs.requested_at_ms <= excluded.requested_at_ms
                  THEN cloud_hash_jobs.requested_at_ms
                ELSE excluded.requested_at_ms
              END,
              updated_at_ms = excluded.updated_at_ms
            "#,
            params![
                job_id,
                owner_uid,
                entry_id,
                track_id,
                quick_fingerprint,
                status,
                cloud_full_hash,
                last_error,
                requested_at_ms,
                now,
            ],
        )
        .map_err(|error| format!("Failed to upsert cloud hash job: {error}"))?;

        cloud_hash_job_record_by_id(conn, job_id.as_str())
    })
}

pub fn list_cloud_hash_jobs(
    app: &AppHandle,
    query: Option<LibraryCloudHashJobQueryInput>,
) -> Result<Vec<LibraryCloudHashJobRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_limit = normalize_limit(query.as_ref().and_then(|item| item.limit));
        let normalized_offset = normalize_offset(query.as_ref().and_then(|item| item.offset));
        let normalized_owner_uid = query
            .as_ref()
            .and_then(|item| item.owner_uid.as_ref())
            .and_then(|value| normalize_owner_uid(Some(value.as_str())));
        let owner_uid_enabled_flag = if normalized_owner_uid.is_some() {
            1_i64
        } else {
            0_i64
        };
        let owner_uid_exact_value = normalized_owner_uid.unwrap_or_default();
        let normalized_status = query
            .as_ref()
            .and_then(|item| item.status.as_ref())
            .map(|value| normalize_cloud_hash_job_status(Some(value.as_str())));
        let status_enabled_flag = if normalized_status.is_some() {
            1_i64
        } else {
            0_i64
        };
        let status_exact_value = normalized_status.unwrap_or_default();

        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                  id,
                  owner_uid,
                  entry_id,
                  track_id,
                  quick_fingerprint,
                  status,
                  cloud_full_hash,
                  last_error,
                  attempt_count,
                  requested_at_ms,
                  updated_at_ms
                FROM cloud_hash_jobs
                WHERE (?1 = 0 OR owner_uid = ?2)
                  AND (?3 = 0 OR status = ?4)
                ORDER BY updated_at_ms DESC, requested_at_ms DESC, id ASC
                LIMIT ?5
                OFFSET ?6
                "#,
            )
            .map_err(|error| {
                format!("Failed to prepare cloud hash job query statement: {error}")
            })?;

        let rows = stmt
            .query_map(
                params![
                    owner_uid_enabled_flag,
                    owner_uid_exact_value,
                    status_enabled_flag,
                    status_exact_value,
                    normalized_limit,
                    normalized_offset,
                ],
                |row| {
                    Ok(LibraryCloudHashJobRecord {
                        id: row.get(0)?,
                        owner_uid: row.get(1)?,
                        entry_id: row.get(2)?,
                        track_id: row.get(3)?,
                        quick_fingerprint: row.get(4)?,
                        status: row.get(5)?,
                        cloud_full_hash: row.get(6)?,
                        last_error: row.get(7)?,
                        attempt_count: row.get::<_, i64>(8)?.max(0) as u64,
                        requested_at_ms: row.get(9)?,
                        updated_at_ms: row.get(10)?,
                    })
                },
            )
            .map_err(|error| format!("Failed to query cloud hash job rows: {error}"))?;

        let mut items = Vec::new();
        for row in rows {
            items
                .push(row.map_err(|error| format!("Failed to parse cloud hash job row: {error}"))?);
        }
        Ok(items)
    })
}

pub fn update_cloud_hash_job_status(
    app: &AppHandle,
    job_id: &str,
    status: &str,
    cloud_full_hash: Option<String>,
    last_error: Option<String>,
) -> Result<bool, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_job_id = job_id.trim();
        if normalized_job_id.is_empty() {
            return Ok(false);
        }
        let normalized_status = normalize_cloud_hash_job_status(Some(status));
        let now = now_ms();

        let affected = conn
            .execute(
                r#"
                UPDATE cloud_hash_jobs
                SET
                  status = ?2,
                  cloud_full_hash = COALESCE(?3, cloud_full_hash),
                  last_error = ?4,
                  updated_at_ms = ?5
                WHERE id = ?1
                "#,
                params![
                    normalized_job_id,
                    normalized_status,
                    normalize_text(cloud_full_hash.as_deref()),
                    normalize_text(last_error.as_deref()),
                    now,
                ],
            )
            .map_err(|error| format!("Failed to update cloud hash job status: {error}"))?;
        Ok(affected > 0)
    })
}

pub fn list_source_health(
    app: &AppHandle,
    query: Option<LibrarySourceHealthQueryInput>,
) -> Result<Vec<LibrarySourceHealthRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_source_id = query
            .as_ref()
            .and_then(|item| item.source_id.as_ref())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_default();
        let source_filter_enabled = if normalized_source_id.is_empty() {
            0_i64
        } else {
            1_i64
        };

        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                  s.id AS source_id,
                  s.path AS source_path,
                  s.display_name AS source_display_name,
                  COUNT(t.id) AS total_tracks,
                  SUM(CASE WHEN t.status = 'available' THEN 1 ELSE 0 END) AS available_tracks,
                  SUM(CASE WHEN t.status = 'missing' THEN 1 ELSE 0 END) AS missing_tracks,
                  COUNT(DISTINCT CASE
                    WHEN TRIM(COALESCE(t.artist, '')) <> '' THEN LOWER(TRIM(t.artist))
                    ELSE NULL
                  END) AS total_artists,
                  COUNT(DISTINCT CASE
                    WHEN TRIM(COALESCE(t.album, '')) <> '' THEN LOWER(TRIM(t.album))
                    ELSE NULL
                  END) AS total_albums,
                  COALESCE(SUM(COALESCE(t.file_size, 0)), 0) AS total_size,
                  s.updated_at_ms AS source_updated_at_ms,
                  MAX(t.updated_at_ms) AS last_track_updated_at_ms
                FROM sources s
                LEFT JOIN local_tracks t ON t.source_id = s.id
                WHERE (?1 = 0 OR s.id = ?2)
                GROUP BY s.id
                ORDER BY s.updated_at_ms DESC, s.id ASC
                "#,
            )
            .map_err(|error| format!("Failed to prepare source health statement: {error}"))?;

        let rows = stmt
            .query_map(
                params![source_filter_enabled, normalized_source_id],
                |row| {
                    Ok(LibrarySourceHealthRecord {
                        source_id: row.get(0)?,
                        source_path: row.get(1)?,
                        source_display_name: row.get(2)?,
                        total_tracks: row.get::<_, i64>(3)?.max(0) as u64,
                        available_tracks: row.get::<_, i64>(4)?.max(0) as u64,
                        missing_tracks: row.get::<_, i64>(5)?.max(0) as u64,
                        total_artists: row.get::<_, i64>(6)?.max(0) as u64,
                        total_albums: row.get::<_, i64>(7)?.max(0) as u64,
                        total_size: row.get::<_, i64>(8)?.max(0) as u64,
                        source_updated_at_ms: row.get(9)?,
                        last_track_updated_at_ms: row.get(10)?,
                    })
                },
            )
            .map_err(|error| format!("Failed to query source health: {error}"))?;

        let mut result = Vec::new();
        for row in rows {
            result
                .push(row.map_err(|error| format!("Failed to parse source health row: {error}"))?);
        }

        Ok(result)
    })
}

pub fn cleanup_source_tracks(
    app: &AppHandle,
    source_id: &str,
    missing_only: bool,
) -> Result<u64, String> {
    ensure_initialized(app)?;
    let normalized_source_id = source_id.trim();
    if normalized_source_id.is_empty() {
        return Err("Source id is required".to_string());
    }

    with_conn(|conn| {
        let _ = source_record_by_id(conn, normalized_source_id)?;
        let now = now_ms();

        let tx = conn
            .transaction()
            .map_err(|error| format!("Failed to start source cleanup transaction: {error}"))?;

        let deleted = if missing_only {
            tx.execute(
                "DELETE FROM local_tracks WHERE source_id = ?1 AND status = 'missing'",
                params![normalized_source_id],
            )
            .map_err(|error| format!("Failed to cleanup missing source tracks: {error}"))?
        } else {
            tx.execute(
                "DELETE FROM local_tracks WHERE source_id = ?1",
                params![normalized_source_id],
            )
            .map_err(|error| format!("Failed to cleanup source tracks: {error}"))?
        };

        tx.execute(
            "UPDATE sources SET updated_at_ms = ?2 WHERE id = ?1",
            params![normalized_source_id, now],
        )
        .map_err(|error| format!("Failed to update source cleanup timestamp: {error}"))?;

        tx.commit()
            .map_err(|error| format!("Failed to commit source cleanup transaction: {error}"))?;

        Ok(deleted as u64)
    })
}

pub fn query_tracks(
    app: &AppHandle,
    query: Option<LibraryTrackQueryInput>,
) -> Result<Vec<LibraryTrackRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_limit = query
            .as_ref()
            .and_then(|item| item.limit)
            .map(|value| value.clamp(1, 2000) as i64)
            .unwrap_or(i64::MAX);
        let normalized_offset = query
            .as_ref()
            .and_then(|item| item.offset)
            .map(|value| value.max(0) as i64)
            .unwrap_or(0);
        let include_missing_flag = if query
            .as_ref()
            .and_then(|item| item.include_missing)
            .unwrap_or(false)
        {
            1_i64
        } else {
            0_i64
        };
        let visible_only_flag = if query
            .as_ref()
            .and_then(|item| item.visible_only)
            .unwrap_or(true)
        {
            1_i64
        } else {
            0_i64
        };
        let normalized_search_query = query
            .as_ref()
            .and_then(|item| item.search_query.as_ref())
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| !value.is_empty());
        let normalized_artist = query
            .as_ref()
            .and_then(|item| item.artist.as_ref())
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| !value.is_empty());
        let normalized_album = query
            .as_ref()
            .and_then(|item| item.album.as_ref())
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| !value.is_empty());
        let normalized_track_id = query
            .as_ref()
            .and_then(|item| item.track_id.as_ref())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let normalized_source_id = query
            .as_ref()
            .and_then(|item| item.source_id.as_ref())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let normalized_quick_fingerprint = query
            .as_ref()
            .and_then(|item| item.quick_fingerprint.as_ref())
            .and_then(|value| normalize_quick_fingerprint(Some(value.as_str())));
        let normalized_file_path = query
            .as_ref()
            .and_then(|item| item.file_path.as_ref())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let search_enabled_flag = if normalized_search_query.is_some() {
            1_i64
        } else {
            0_i64
        };
        let artist_enabled_flag = if normalized_artist.is_some() {
            1_i64
        } else {
            0_i64
        };
        let album_enabled_flag = if normalized_album.is_some() {
            1_i64
        } else {
            0_i64
        };
        let track_id_enabled_flag = if normalized_track_id.is_some() {
            1_i64
        } else {
            0_i64
        };
        let source_id_enabled_flag = if normalized_source_id.is_some() {
            1_i64
        } else {
            0_i64
        };
        let quick_fingerprint_enabled_flag = if normalized_quick_fingerprint.is_some() {
            1_i64
        } else {
            0_i64
        };
        let file_path_enabled_flag = if normalized_file_path.is_some() {
            1_i64
        } else {
            0_i64
        };
        let search_like_pattern = normalized_search_query
            .map(|value| format!("%{value}%"))
            .unwrap_or_else(|| "%".to_string());
        let artist_exact_value = normalized_artist.unwrap_or_default();
        let album_exact_value = normalized_album.unwrap_or_default();
        let track_id_exact_value = normalized_track_id.unwrap_or_default();
        let source_id_exact_value = normalized_source_id.unwrap_or_default();
        let quick_fingerprint_exact_value = normalized_quick_fingerprint.unwrap_or_default();
        let file_path_exact_value = normalized_file_path.unwrap_or_default();

        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                  t.id,
                  t.source_id,
                  t.file_path,
                  t.quick_fingerprint,
                  t.title,
                  t.artist,
                  t.album,
                  t.genre,
                  t.duration_seconds,
                  t.sample_rate,
                  t.bit_depth,
                  t.file_size,
                  t.mtime_ms,
                  t.replay_gain_track_db,
                  t.replay_gain_album_db,
                  t.play_count,
                  t.last_played_at_ms,
                  t.status,
                  t.updated_at_ms
                FROM local_tracks t
                JOIN sources s ON s.id = t.source_id
                WHERE (?1 = 0 OR s.is_visible = 1)
                  AND (?2 = 1 OR t.status = 'available')
                  AND (
                    ?5 = 0
                    OR LOWER(COALESCE(t.title, '')) LIKE ?6
                    OR LOWER(COALESCE(t.artist, '')) LIKE ?6
                    OR LOWER(COALESCE(t.album, '')) LIKE ?6
                    OR LOWER(t.file_path) LIKE ?6
                  )
                  AND (?7 = 0 OR LOWER(TRIM(COALESCE(t.artist, ''))) = ?8)
                  AND (?9 = 0 OR LOWER(TRIM(COALESCE(t.album, ''))) = ?10)
                  AND (?11 = 0 OR t.id = ?12)
                  AND (?13 = 0 OR t.source_id = ?14)
                  AND (?15 = 0 OR t.quick_fingerprint = ?16)
                  AND (?17 = 0 OR t.file_path = ?18)
                ORDER BY
                  LOWER(COALESCE(t.title, t.file_path)) ASC,
                  t.updated_at_ms DESC,
                  t.id ASC
                LIMIT ?3
                OFFSET ?4
                "#,
            )
            .map_err(|error| format!("Failed to prepare query tracks statement: {error}"))?;

        let rows = stmt
            .query_map(
                params![
                    visible_only_flag,
                    include_missing_flag,
                    normalized_limit,
                    normalized_offset,
                    search_enabled_flag,
                    search_like_pattern,
                    artist_enabled_flag,
                    artist_exact_value,
                    album_enabled_flag,
                    album_exact_value,
                    track_id_enabled_flag,
                    track_id_exact_value,
                    source_id_enabled_flag,
                    source_id_exact_value,
                    quick_fingerprint_enabled_flag,
                    quick_fingerprint_exact_value,
                    file_path_enabled_flag,
                    file_path_exact_value,
                ],
                |row| {
                    Ok(LibraryTrackRecord {
                        id: row.get(0)?,
                        source_id: row.get(1)?,
                        file_path: row.get(2)?,
                        quick_fingerprint: row.get(3)?,
                        title: row.get(4)?,
                        artist: row.get(5)?,
                        album: row.get(6)?,
                        genre: row.get(7)?,
                        duration_seconds: row.get(8)?,
                        sample_rate: row.get::<_, Option<i64>>(9)?.map(|value| value as u32),
                        bit_depth: row.get::<_, Option<i64>>(10)?.map(|value| value as u32),
                        file_size: row.get::<_, Option<i64>>(11)?.map(|value| value as u64),
                        mtime_ms: row.get(12)?,
                        replay_gain_track_db: row.get(13)?,
                        replay_gain_album_db: row.get(14)?,
                        play_count: row.get::<_, i64>(15)?.max(0) as u64,
                        last_played_at_ms: row.get(16)?,
                        status: row.get(17)?,
                        updated_at_ms: row.get(18)?,
                    })
                },
            )
            .map_err(|error| format!("Failed to query tracks: {error}"))?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|error| format!("Failed to parse queried track row: {error}"))?);
        }

        Ok(items)
    })
}

fn resolve_facet_flags(query: Option<&LibraryFacetQueryInput>) -> (i64, i64) {
    let include_missing_flag = if query.and_then(|item| item.include_missing).unwrap_or(false) {
        1_i64
    } else {
        0_i64
    };
    let visible_only_flag = if query.and_then(|item| item.visible_only).unwrap_or(true) {
        1_i64
    } else {
        0_i64
    };
    (include_missing_flag, visible_only_flag)
}

pub fn list_artists(
    app: &AppHandle,
    query: Option<LibraryFacetQueryInput>,
) -> Result<Vec<String>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let (include_missing_flag, visible_only_flag) = resolve_facet_flags(query.as_ref());
        let mut stmt = conn
            .prepare(
                r#"
                SELECT DISTINCT TRIM(t.artist) AS artist
                FROM local_tracks t
                JOIN sources s ON s.id = t.source_id
                WHERE (?1 = 0 OR s.is_visible = 1)
                  AND (?2 = 1 OR t.status = 'available')
                  AND TRIM(COALESCE(t.artist, '')) <> ''
                ORDER BY LOWER(TRIM(t.artist)) ASC
                "#,
            )
            .map_err(|error| format!("Failed to prepare list artists statement: {error}"))?;

        let rows = stmt
            .query_map(params![visible_only_flag, include_missing_flag], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| format!("Failed to query artists: {error}"))?;

        let mut items = Vec::new();
        for row in rows {
            let value = row.map_err(|error| format!("Failed to parse artist row: {error}"))?;
            let normalized = value.trim();
            if normalized.is_empty() {
                continue;
            }
            items.push(normalized.to_string());
        }
        Ok(items)
    })
}

pub fn list_genres(
    app: &AppHandle,
    query: Option<LibraryFacetQueryInput>,
) -> Result<Vec<String>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let (include_missing_flag, visible_only_flag) = resolve_facet_flags(query.as_ref());
        let mut stmt = conn
            .prepare(
                r#"
                SELECT DISTINCT TRIM(t.genre) AS genre
                FROM local_tracks t
                JOIN sources s ON s.id = t.source_id
                WHERE (?1 = 0 OR s.is_visible = 1)
                  AND (?2 = 1 OR t.status = 'available')
                  AND TRIM(COALESCE(t.genre, '')) <> ''
                ORDER BY LOWER(TRIM(t.genre)) ASC
                "#,
            )
            .map_err(|error| format!("Failed to prepare list genres statement: {error}"))?;

        let rows = stmt
            .query_map(params![visible_only_flag, include_missing_flag], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| format!("Failed to query genres: {error}"))?;

        let mut items = Vec::new();
        for row in rows {
            let value = row.map_err(|error| format!("Failed to parse genre row: {error}"))?;
            let normalized = value.trim();
            if normalized.is_empty() {
                continue;
            }
            items.push(normalized.to_string());
        }
        Ok(items)
    })
}

pub fn list_albums(
    app: &AppHandle,
    query: Option<LibraryFacetQueryInput>,
) -> Result<Vec<LibraryAlbumRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let (include_missing_flag, visible_only_flag) = resolve_facet_flags(query.as_ref());
        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                  TRIM(t.album) AS album,
                  COALESCE(NULLIF(TRIM(t.artist), ''), 'Unknown Artist') AS artist,
                  MIN(t.id) AS cover_track_id,
                  MIN(t.file_path) AS cover_track_path
                FROM local_tracks t
                JOIN sources s ON s.id = t.source_id
                WHERE (?1 = 0 OR s.is_visible = 1)
                  AND (?2 = 1 OR t.status = 'available')
                  AND TRIM(COALESCE(t.album, '')) <> ''
                GROUP BY
                  LOWER(TRIM(t.album)),
                  LOWER(COALESCE(NULLIF(TRIM(t.artist), ''), 'Unknown Artist'))
                ORDER BY
                  LOWER(TRIM(t.album)) ASC,
                  LOWER(COALESCE(NULLIF(TRIM(t.artist), ''), 'Unknown Artist')) ASC
                "#,
            )
            .map_err(|error| format!("Failed to prepare list albums statement: {error}"))?;

        let rows = stmt
            .query_map(params![visible_only_flag, include_missing_flag], |row| {
                Ok(LibraryAlbumRecord {
                    album: row.get(0)?,
                    artist: row.get(1)?,
                    cover_track_id: row.get(2)?,
                    cover_track_path: row.get(3)?,
                })
            })
            .map_err(|error| format!("Failed to query albums: {error}"))?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|error| format!("Failed to parse album row: {error}"))?);
        }
        Ok(items)
    })
}

pub fn get_stats(
    app: &AppHandle,
    query: Option<LibraryFacetQueryInput>,
) -> Result<LibraryStatsRecord, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let (include_missing_flag, visible_only_flag) = resolve_facet_flags(query.as_ref());

        conn.query_row(
            r#"
            SELECT
              COUNT(*) AS total_tracks,
              COUNT(DISTINCT CASE
                WHEN TRIM(COALESCE(t.artist, '')) <> '' THEN LOWER(TRIM(t.artist))
                ELSE NULL
              END) AS total_artists,
              COUNT(DISTINCT CASE
                WHEN TRIM(COALESCE(t.album, '')) <> '' THEN LOWER(TRIM(t.album))
                ELSE NULL
              END) AS total_albums,
              COALESCE(SUM(COALESCE(t.file_size, 0)), 0) AS total_size,
              COALESCE(SUM(COALESCE(t.duration_seconds, 0.0)), 0.0) AS total_duration
            FROM local_tracks t
            JOIN sources s ON s.id = t.source_id
            WHERE (?1 = 0 OR s.is_visible = 1)
              AND (?2 = 1 OR t.status = 'available')
            "#,
            params![visible_only_flag, include_missing_flag],
            |row| {
                Ok(LibraryStatsRecord {
                    total_tracks: row.get::<_, i64>(0)?.max(0) as u64,
                    total_artists: row.get::<_, i64>(1)?.max(0) as u64,
                    total_albums: row.get::<_, i64>(2)?.max(0) as u64,
                    total_size: row.get::<_, i64>(3)?.max(0) as u64,
                    total_duration: row.get::<_, f64>(4)?.max(0.0),
                })
            },
        )
        .map_err(|error| format!("Failed to query library stats: {error}"))
    })
}
