use once_cell::sync::{Lazy, OnceCell};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::AppHandle;

const DB_VERSION: i32 = 1;

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
    pub duration_seconds: Option<f64>,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u32>,
    pub file_size: Option<u64>,
    pub mtime_ms: Option<i64>,
    pub replay_gain_track_db: Option<f32>,
    pub replay_gain_album_db: Option<f32>,
    pub status: String,
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
              duration_seconds REAL,
              sample_rate INTEGER,
              bit_depth INTEGER,
              file_size INTEGER,
              mtime_ms INTEGER,
              replay_gain_track_db REAL,
              replay_gain_album_db REAL,
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

            PRAGMA user_version = 1;
            "#,
        )
        .map_err(|error| format!("Failed to initialize music library schema: {error}"))?;
        version = 1;
    }

    if version != DB_VERSION {
        return Err(format!(
            "Unsupported music library DB schema version: {version} (expected {DB_VERSION})"
        ));
    }

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

fn source_record_by_id(conn: &Connection, source_id: &str) -> Result<LibrarySourceRecord, String> {
    conn.query_row(
        r#"
        SELECT
          id,
          path,
          display_name,
          category,
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
                is_visible: row.get::<_, i64>(4)? != 0,
                is_scanned: row.get::<_, i64>(5)? != 0,
                added_at_ms: row.get(6)?,
                last_scanned_at_ms: row.get(7)?,
                updated_at_ms: row.get(8)?,
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
                    is_visible: row.get::<_, i64>(4)? != 0,
                    is_scanned: row.get::<_, i64>(5)? != 0,
                    added_at_ms: row.get(6)?,
                    last_scanned_at_ms: row.get(7)?,
                    updated_at_ms: row.get(8)?,
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
                  'available',
                  ?15,
                  ?16,
                  ?17
                )
                ON CONFLICT(id) DO UPDATE SET
                  source_id = excluded.source_id,
                  file_path = excluded.file_path,
                  quick_fingerprint = excluded.quick_fingerprint,
                  title = excluded.title,
                  artist = excluded.artist,
                  album = excluded.album,
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
                    normalize_text(item.quick_fingerprint.as_deref()),
                    normalize_text(item.title.as_deref()),
                    normalize_text(item.artist.as_deref()),
                    normalize_text(item.album.as_deref()),
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
                  t.duration_seconds,
                  t.sample_rate,
                  t.bit_depth,
                  t.file_size,
                  t.mtime_ms,
                  t.replay_gain_track_db,
                  t.replay_gain_album_db,
                  t.status,
                  t.updated_at_ms
                FROM local_tracks t
                JOIN sources s ON s.id = t.source_id
                WHERE (?1 = 0 OR s.is_visible = 1)
                  AND (?2 = 1 OR t.status = 'available')
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
                        duration_seconds: row.get(7)?,
                        sample_rate: row.get::<_, Option<i64>>(8)?.map(|value| value as u32),
                        bit_depth: row.get::<_, Option<i64>>(9)?.map(|value| value as u32),
                        file_size: row.get::<_, Option<i64>>(10)?.map(|value| value as u64),
                        mtime_ms: row.get(11)?,
                        replay_gain_track_db: row.get(12)?,
                        replay_gain_album_db: row.get(13)?,
                        status: row.get(14)?,
                        updated_at_ms: row.get(15)?,
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
