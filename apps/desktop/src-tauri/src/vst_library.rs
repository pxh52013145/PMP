use once_cell::sync::{Lazy, OnceCell};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::vst_bridge::{BridgeParamDescriptor, BridgePluginDescriptor};

const DB_VERSION: i32 = 3;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VstLibraryPlugin {
    pub id: String,
    pub name: String,
    pub vendor: Option<String>,
    pub version: Option<String>,
    pub path: Option<String>,
    pub status: String,
    pub last_seen_at_ms: u64,
    pub params_scanned_at_ms: Option<u64>,
    pub input_channels: Option<u32>,
    pub output_channels: Option<u32>,
    pub params_count: Option<u32>,
    pub params_attempted_at_ms: Option<u64>,
    pub params_failure_count: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VstLibraryParamDescriptor {
    pub key: String,
    pub title: String,
    pub min: f32,
    pub max: f32,
    pub default: f32,
    pub step: f32,
    pub unit: Option<String>,
    pub scanned_at_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VstScanRun {
    pub run_id: String,
    pub started_at_ms: u64,
    pub finished_at_ms: Option<u64>,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VstScanEvent {
    pub at_ms: u64,
    pub kind: String,
    pub plugin_id: Option<String>,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VstScanRunSummary {
    pub run_id: String,
    pub mode: Option<String>,
    pub started_at_ms: u64,
    pub finished_at_ms: Option<u64>,
    pub duration_ms: u64,
    pub status: String,
    pub error: Option<String>,
    pub events_total: u32,
    pub plugins_seen: u32,
    pub params_scanned: u32,
    pub event_counts: HashMap<String, u32>,
    pub last_deadman_hint: Option<String>,
}

static DB_PATH: OnceCell<PathBuf> = OnceCell::new();
static DB_CONN: Lazy<Mutex<Option<Connection>>> = Lazy::new(|| Mutex::new(None));

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn extract_deadman_hint(message: &str) -> Option<String> {
    let idx = message.find("deadman=")?;
    let rest = &message[idx + "deadman=".len()..];
    let end = rest.find(')').unwrap_or(rest.len());
    let hint = rest[..end].trim();
    if hint.is_empty() {
        None
    } else {
        Some(hint.to_string())
    }
}

fn system_time_to_ms(value: SystemTime) -> Option<i64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
}

fn resolve_vst3_binary_path(bundle_path: &Path) -> Option<PathBuf> {
    if bundle_path.is_file() {
        return Some(bundle_path.to_path_buf());
    }
    if !bundle_path.is_dir() {
        return None;
    }

    let candidates = [
        bundle_path.join("Contents").join("x86_64-win"),
        bundle_path.join("Contents").join("x86-win"),
        bundle_path.join("Contents").join("Win64"),
        bundle_path.join("Contents").join("Win32"),
    ];

    for dir in candidates {
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("vst3"))
                .unwrap_or(false)
            {
                return Some(path);
            }
        }
    }

    None
}

fn paths_equal(a: &str, b: &str) -> bool {
    let a = a.trim();
    let b = b.trim();
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b)
    } else {
        a == b
    }
}

fn sha256_prefix_hex(path: &Path, max_bytes: u64) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut remaining = max_bytes;
    let mut buf = [0u8; 16 * 1024];

    while remaining > 0 {
        let to_read = std::cmp::min(buf.len() as u64, remaining) as usize;
        let read = file.read(&mut buf[..to_read]).ok()?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
        remaining = remaining.saturating_sub(read as u64);
    }

    let digest = hasher.finalize();
    let mut out = String::with_capacity(12);
    for b in digest.iter().take(6) {
        out.push_str(&format!("{:02x}", b));
    }
    Some(out)
}

fn db_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Unable to resolve app data directory".to_string())?;
    let dir = app_data_dir.join("audio");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create audio directory: {e}"))?;
    Ok(dir.join("vst-library-v1.sqlite3"))
}

fn conn() -> Result<std::sync::MutexGuard<'static, Option<Connection>>, String> {
    DB_CONN
        .lock()
        .map_err(|_| "VST library state is locked".to_string())
}

fn with_conn<T>(op: impl FnOnce(&mut Connection) -> Result<T, String>) -> Result<T, String> {
    let mut guard = conn()?;
    let Some(conn) = guard.as_mut() else {
        return Err("VST library is not initialized".to_string());
    };
    op(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("Failed to enable foreign keys: {e}"))?;
    conn.execute_batch("PRAGMA journal_mode = WAL;")
        .map_err(|e| format!("Failed to set journal mode: {e}"))?;
    conn.execute_batch("PRAGMA synchronous = NORMAL;")
        .map_err(|e| format!("Failed to set synchronous pragma: {e}"))?;

    let mut version: i32 = conn
        .query_row("PRAGMA user_version;", [], |row| row.get(0))
        .map_err(|e| format!("Failed to read schema version: {e}"))?;

    if version == 0 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS vst_plugins (
              plugin_id TEXT PRIMARY KEY NOT NULL,
              name TEXT NOT NULL,
              vendor TEXT,
              version TEXT,
              format TEXT NOT NULL,
              status TEXT NOT NULL,
              last_seen_at_ms INTEGER NOT NULL,
              params_scanned_at_ms INTEGER,
              input_channels INTEGER,
              output_channels INTEGER,
              params_count INTEGER,
              params_attempted_at_ms INTEGER,
              params_failure_count INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS vst_files (
              plugin_id TEXT PRIMARY KEY NOT NULL,
              path TEXT NOT NULL,
              mtime_ms INTEGER,
              size INTEGER,
              sha256_prefix TEXT
            );

            CREATE TABLE IF NOT EXISTS vst_params (
              plugin_id TEXT NOT NULL,
              key TEXT NOT NULL,
              title TEXT NOT NULL,
              min REAL NOT NULL,
              max REAL NOT NULL,
              default_value REAL NOT NULL,
              step REAL NOT NULL,
              unit TEXT,
              scanned_at_ms INTEGER NOT NULL,
              PRIMARY KEY (plugin_id, key)
            );

            CREATE TABLE IF NOT EXISTS vst_scan_runs (
              run_id TEXT PRIMARY KEY NOT NULL,
              started_at_ms INTEGER NOT NULL,
              finished_at_ms INTEGER,
              status TEXT NOT NULL,
              error TEXT
            );

            CREATE TABLE IF NOT EXISTS vst_scan_events (
              run_id TEXT NOT NULL,
              at_ms INTEGER NOT NULL,
              kind TEXT NOT NULL,
              plugin_id TEXT,
              message TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS vst_scan_events_run_id_idx ON vst_scan_events(run_id);
            CREATE INDEX IF NOT EXISTS vst_params_plugin_id_idx ON vst_params(plugin_id);

            PRAGMA user_version = 3;
            "#,
        )
        .map_err(|e| format!("Failed to create VST library schema: {e}"))?;
        return Ok(());
    }

    if version == 1 {
        let mut stmt = conn
            .prepare("PRAGMA table_info(vst_params);")
            .map_err(|e| format!("Failed to inspect vst_params schema: {e}"))?;

        let cols = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| format!("Failed to read vst_params schema: {e}"))?
            .filter_map(Result::ok)
            .collect::<Vec<_>>();

        let has_default_value = cols.iter().any(|c| c == "default_value");
        if has_default_value {
            conn.execute_batch("PRAGMA user_version = 2;")
                .map_err(|e| format!("Failed to bump VST library schema version: {e}"))?;
            return Ok(());
        }

        let has_default = cols.iter().any(|c| c == "default");
        if !has_default {
            return Err("Unsupported vst_params schema in VST library v1".to_string());
        }

        conn.execute_batch(
            r#"
            ALTER TABLE vst_params RENAME TO vst_params_old;

            CREATE TABLE vst_params (
              plugin_id TEXT NOT NULL,
              key TEXT NOT NULL,
              title TEXT NOT NULL,
              min REAL NOT NULL,
              max REAL NOT NULL,
              default_value REAL NOT NULL,
              step REAL NOT NULL,
              unit TEXT,
              scanned_at_ms INTEGER NOT NULL,
              PRIMARY KEY (plugin_id, key)
            );

            INSERT INTO vst_params(plugin_id, key, title, min, max, default_value, step, unit, scanned_at_ms)
            SELECT plugin_id, key, title, min, max, default, step, unit, scanned_at_ms FROM vst_params_old;

            DROP TABLE vst_params_old;

            PRAGMA user_version = 2;
            "#,
        )
        .map_err(|e| format!("Failed to migrate VST library schema to v2: {e}"))?;
        version = 2;
    }

    if version == 2 {
        conn.execute_batch(
            r#"
            ALTER TABLE vst_plugins ADD COLUMN input_channels INTEGER;
            ALTER TABLE vst_plugins ADD COLUMN output_channels INTEGER;
            ALTER TABLE vst_plugins ADD COLUMN params_count INTEGER;
            ALTER TABLE vst_plugins ADD COLUMN params_attempted_at_ms INTEGER;
            ALTER TABLE vst_plugins ADD COLUMN params_failure_count INTEGER NOT NULL DEFAULT 0;

            PRAGMA user_version = 3;
            "#,
        )
        .map_err(|e| format!("Failed to migrate VST library schema to v3: {e}"))?;
        version = 3;
    }

    if version != DB_VERSION {
        return Err(format!(
            "Unsupported VST library schema version: {version} (expected {DB_VERSION})"
        ));
    }

    Ok(())
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    let path = db_file_path(app)?;
    let _ = DB_PATH.set(path.clone());

    let connection =
        Connection::open(&path).map_err(|e| format!("Failed to open VST library DB: {e}"))?;
    migrate(&connection)?;

    let mut guard = conn()?;
    *guard = Some(connection);
    Ok(())
}

pub fn record_scan_run_started(run_id: &str, started_at_ms: u64, mode: &str) -> Result<(), String> {
    with_conn(|conn| {
        conn.execute(
            "INSERT OR REPLACE INTO vst_scan_runs(run_id, started_at_ms, status, error) VALUES (?1, ?2, 'running', NULL)",
            params![run_id, started_at_ms as i64],
        )
        .map_err(|e| format!("Failed to insert scan run: {e}"))?;
        conn.execute(
            "INSERT INTO vst_scan_events(run_id, at_ms, kind, plugin_id, message) VALUES (?1, ?2, 'mode', NULL, ?3)",
            params![run_id, started_at_ms as i64, format!("Scan mode: {mode}")],
        )
        .map_err(|e| format!("Failed to insert scan mode event: {e}"))?;
        Ok(())
    })
}

pub fn record_scan_run_finished(
    run_id: &str,
    finished_at_ms: u64,
    status: &str,
    error: Option<&str>,
) -> Result<(), String> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE vst_scan_runs SET finished_at_ms = ?2, status = ?3, error = ?4 WHERE run_id = ?1",
            params![run_id, finished_at_ms as i64, status, error],
        )
        .map_err(|e| format!("Failed to update scan run: {e}"))?;
        Ok(())
    })
}

pub fn record_scan_event(run_id: &str, kind: &str, plugin_id: Option<&str>, message: &str) {
    let _ = with_conn(|conn| {
        conn.execute(
            "INSERT INTO vst_scan_events(run_id, at_ms, kind, plugin_id, message) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![run_id, now_ms() as i64, kind, plugin_id, message],
        )
        .map_err(|e| format!("Failed to insert scan event: {e}"))?;
        Ok(())
    });
}

pub fn list_scan_runs(limit: u32) -> Result<Vec<VstScanRun>, String> {
    let limit = limit.clamp(1, 200) as i64;
    with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT run_id, started_at_ms, finished_at_ms, status, error
                FROM vst_scan_runs
                ORDER BY started_at_ms DESC
                LIMIT ?1
                "#,
            )
            .map_err(|e| format!("Failed to prepare scan runs query: {e}"))?;

        let mut out = Vec::new();
        let rows = stmt
            .query_map(params![limit], |row| {
                Ok(VstScanRun {
                    run_id: row.get::<_, String>(0)?,
                    started_at_ms: row.get::<_, i64>(1)? as u64,
                    finished_at_ms: row.get::<_, Option<i64>>(2)?.map(|v| v as u64),
                    status: row.get::<_, String>(3)?,
                    error: row.get::<_, Option<String>>(4)?,
                })
            })
            .map_err(|e| format!("Failed to query scan runs: {e}"))?;

        for row in rows {
            out.push(row.map_err(|e| format!("Failed to read scan run row: {e}"))?);
        }
        Ok(out)
    })
}

pub fn list_scan_events(run_id: &str, limit: u32) -> Result<Vec<VstScanEvent>, String> {
    let run_id = run_id.trim();
    if run_id.is_empty() {
        return Err("Missing runId".to_string());
    }
    let limit = limit.clamp(1, 500) as i64;
    with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT at_ms, kind, plugin_id, message
                FROM vst_scan_events
                WHERE run_id = ?1
                ORDER BY at_ms DESC
                LIMIT ?2
                "#,
            )
            .map_err(|e| format!("Failed to prepare scan events query: {e}"))?;

        let mut out = Vec::new();
        let rows = stmt
            .query_map(params![run_id, limit], |row| {
                Ok(VstScanEvent {
                    at_ms: row.get::<_, i64>(0)? as u64,
                    kind: row.get::<_, String>(1)?,
                    plugin_id: row.get::<_, Option<String>>(2)?,
                    message: row.get::<_, String>(3)?,
                })
            })
            .map_err(|e| format!("Failed to query scan events: {e}"))?;

        for row in rows {
            out.push(row.map_err(|e| format!("Failed to read scan event row: {e}"))?);
        }
        Ok(out)
    })
}

pub fn get_scan_run_summary(run_id: &str) -> Result<VstScanRunSummary, String> {
    let run_id = run_id.trim();
    if run_id.is_empty() {
        return Err("Missing runId".to_string());
    }

    with_conn(|conn| {
        let run_row = conn
            .query_row(
                r#"
                SELECT started_at_ms, finished_at_ms, status, error
                FROM vst_scan_runs
                WHERE run_id = ?1
                "#,
                params![run_id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, Option<i64>>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| format!("Failed to query scan run summary: {e}"))?
            .ok_or_else(|| "Scan run not found".to_string())?;

        let started_at_ms = run_row.0.max(0) as u64;
        let finished_at_ms = run_row.1.map(|v| v.max(0) as u64);
        let status = run_row.2;
        let error = run_row.3;
        let duration_ms = finished_at_ms
            .unwrap_or_else(now_ms)
            .saturating_sub(started_at_ms);

        let mode_message: Option<String> = conn
            .query_row(
                r#"
                SELECT message
                FROM vst_scan_events
                WHERE run_id = ?1 AND kind = 'mode'
                ORDER BY at_ms ASC
                LIMIT 1
                "#,
                params![run_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| format!("Failed to query scan run mode: {e}"))?;
        let mode = mode_message
            .as_deref()
            .and_then(|msg| msg.strip_prefix("Scan mode: "))
            .map(|v| v.to_string());

        let mut event_counts = HashMap::<String, u32>::new();
        let mut stmt = conn
            .prepare(
                r#"
                SELECT kind, COUNT(*) AS count
                FROM vst_scan_events
                WHERE run_id = ?1
                GROUP BY kind
                "#,
            )
            .map_err(|e| format!("Failed to prepare scan event counts query: {e}"))?;

        let mut events_total = 0u32;
        let rows = stmt
            .query_map(params![run_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| format!("Failed to query scan event counts: {e}"))?;
        for row in rows {
            let (kind, count) = row.map_err(|e| format!("Failed to read scan event counts row: {e}"))?;
            let count_u32 = u32::try_from(count).unwrap_or(u32::MAX);
            events_total = events_total.saturating_add(count_u32);
            event_counts.insert(kind, count_u32);
        }

        let plugins_seen: u32 = conn
            .query_row(
                r#"
                SELECT COUNT(DISTINCT plugin_id)
                FROM vst_scan_events
                WHERE run_id = ?1 AND kind = 'seen' AND plugin_id IS NOT NULL
                "#,
                params![run_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| format!("Failed to query scan plugin count: {e}"))?
            .max(0)
            .try_into()
            .unwrap_or(u32::MAX);

        let params_scanned: u32 = conn
            .query_row(
                r#"
                SELECT COUNT(DISTINCT plugin_id)
                FROM vst_scan_events
                WHERE run_id = ?1 AND kind = 'params' AND plugin_id IS NOT NULL
                "#,
                params![run_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| format!("Failed to query scanned params count: {e}"))?
            .max(0)
            .try_into()
            .unwrap_or(u32::MAX);

        let deadman_message: Option<String> = conn
            .query_row(
                r#"
                SELECT message
                FROM vst_scan_events
                WHERE run_id = ?1 AND message LIKE '%deadman=%'
                ORDER BY at_ms DESC
                LIMIT 1
                "#,
                params![run_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| format!("Failed to query scan deadman hint: {e}"))?;
        let last_deadman_hint = deadman_message
            .as_deref()
            .and_then(extract_deadman_hint);

        Ok(VstScanRunSummary {
            run_id: run_id.to_string(),
            mode,
            started_at_ms,
            finished_at_ms,
            duration_ms,
            status,
            error,
            events_total,
            plugins_seen,
            params_scanned,
            event_counts,
            last_deadman_hint,
        })
    })
}

pub fn upsert_plugin_snapshot(run_id: &str, plugin: &BridgePluginDescriptor) -> Result<(), String> {
    with_conn(|conn| {
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start VST library transaction: {e}"))?;

        let now = now_ms() as i64;
        let existing_params_scanned_at_ms: Option<i64> = tx
            .query_row(
                "SELECT params_scanned_at_ms FROM vst_plugins WHERE plugin_id = ?1",
                params![plugin.id],
                |row| row.get::<_, Option<i64>>(0),
            )
            .optional()
            .map_err(|e| format!("Failed to query plugin params scan time: {e}"))?
            .flatten();
        let had_cached_params = existing_params_scanned_at_ms.is_some();

        let existing_file: Option<(String, Option<i64>, Option<i64>, Option<String>)> = tx
            .query_row(
                "SELECT path, mtime_ms, size, sha256_prefix FROM vst_files WHERE plugin_id = ?1",
                params![plugin.id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<i64>>(1)?,
                        row.get::<_, Option<i64>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| format!("Failed to query plugin fingerprint: {e}"))?;

        tx.execute(
            r#"
            INSERT INTO vst_plugins(
              plugin_id,
              name,
              vendor,
              version,
              format,
              status,
              last_seen_at_ms,
              params_scanned_at_ms,
              input_channels,
              output_channels
            )
            VALUES (?1, ?2, ?3, ?4, 'vst3', 'ok', ?5, NULL, ?6, ?7)
            ON CONFLICT(plugin_id) DO UPDATE SET
              name = excluded.name,
              vendor = excluded.vendor,
              version = excluded.version,
              status = CASE
                  WHEN status = 'missing' THEN 'ok'
                  ELSE status
              END,
              last_seen_at_ms = excluded.last_seen_at_ms,
              input_channels = excluded.input_channels,
              output_channels = excluded.output_channels
            "#,
            params![
                plugin.id,
                plugin.name,
                plugin.vendor,
                plugin.version,
                now,
                plugin.input_channels.map(|v| v as i64),
                plugin.output_channels.map(|v| v as i64)
            ],
        )
        .map_err(|e| format!("Failed to upsert plugin row: {e}"))?;

        if let Some(path) = plugin
            .path
            .as_ref()
            .map(|p| p.trim())
            .filter(|p| !p.is_empty())
        {
            let (prev_path, prev_mtime_ms, prev_size, prev_sha) = existing_file
                .as_ref()
                .map(|(path, mtime_ms, size, sha)| {
                    (
                        Some(path.as_str()),
                        *mtime_ms,
                        *size,
                        sha.as_deref().map(|v| v.to_string()),
                    )
                })
                .unwrap_or((None, None, None, None));

            let bundle_path = Path::new(path);
            let fingerprint_path =
                resolve_vst3_binary_path(bundle_path).unwrap_or_else(|| bundle_path.to_path_buf());

            let (mtime_ms, size) = match std::fs::metadata(&fingerprint_path) {
                Ok(meta) => (
                    meta.modified().ok().and_then(system_time_to_ms),
                    i64::try_from(meta.len()).ok(),
                ),
                Err(_) => (None, None),
            };

            let sha256_prefix =
                if prev_sha.is_none() || prev_mtime_ms != mtime_ms || prev_size != size {
                    sha256_prefix_hex(&fingerprint_path, 1024 * 1024)
                } else {
                    prev_sha.clone()
                };

            let fingerprint_known =
                prev_mtime_ms.is_some() || prev_size.is_some() || prev_sha.is_some();
            let path_changed = prev_path
                .map(|prev| !paths_equal(prev, path))
                .unwrap_or(true);
            let fingerprint_changed = fingerprint_known
                && (prev_mtime_ms != mtime_ms || prev_size != size || prev_sha != sha256_prefix);
            let file_changed = path_changed || fingerprint_changed;

            tx.execute(
                r#"
                INSERT INTO vst_files(plugin_id, path, mtime_ms, size, sha256_prefix)
                VALUES (?1, ?2, ?3, ?4, ?5)
                ON CONFLICT(plugin_id) DO UPDATE SET
                  path = excluded.path
                  , mtime_ms = excluded.mtime_ms
                  , size = excluded.size
                  , sha256_prefix = excluded.sha256_prefix
                "#,
                params![plugin.id, path, mtime_ms, size, sha256_prefix],
            )
            .map_err(|e| format!("Failed to upsert file row: {e}"))?;

            if file_changed && had_cached_params {
                tx.execute(
                    "UPDATE vst_plugins SET params_scanned_at_ms = NULL, params_count = NULL, params_attempted_at_ms = NULL, params_failure_count = 0 WHERE plugin_id = ?1",
                    params![plugin.id],
                )
                .map_err(|e| format!("Failed to invalidate params cache: {e}"))?;

                tx.execute(
                    "DELETE FROM vst_params WHERE plugin_id = ?1",
                    params![plugin.id],
                )
                .map_err(|e| format!("Failed to clear cached params: {e}"))?;

                tx.execute(
                    "INSERT INTO vst_scan_events(run_id, at_ms, kind, plugin_id, message) VALUES (?1, ?2, 'plugin-changed', ?3, ?4)",
                    params![
                        run_id,
                        now,
                        plugin.id,
                        format!(
                            "Invalidated cached params (path/mtime/size/sha changed): {}",
                            fingerprint_path.display()
                        )
                    ],
                )
                .map_err(|e| format!("Failed to insert plugin-changed event: {e}"))?;
            }
        }

        tx.execute(
            "INSERT INTO vst_scan_events(run_id, at_ms, kind, plugin_id, message) VALUES (?1, ?2, 'seen', ?3, ?4)",
            params![run_id, now, plugin.id, format!("Seen plugin: {}", plugin.name)],
        )
        .map_err(|e| format!("Failed to insert scan event: {e}"))?;

        tx.commit()
            .map_err(|e| format!("Failed to commit VST library transaction: {e}"))?;

        Ok(())
    })
}

pub fn upsert_plugin_params(
    run_id: &str,
    plugin_id: &str,
    params_list: &[BridgeParamDescriptor],
) -> Result<(), String> {
    with_conn(|conn| {
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start VST library transaction: {e}"))?;
        let scanned_at_ms = now_ms() as i64;
        let params_count = params_list.len().min(u32::MAX as usize) as i64;

        tx.execute(
            "UPDATE vst_plugins SET params_scanned_at_ms = ?2, params_count = ?3, params_attempted_at_ms = ?2, params_failure_count = 0, status = 'ok' WHERE plugin_id = ?1",
            params![plugin_id, scanned_at_ms, params_count],
        )
        .map_err(|e| format!("Failed to update plugin params scan time: {e}"))?;

        tx.execute(
            "DELETE FROM vst_params WHERE plugin_id = ?1",
            params![plugin_id],
        )
        .map_err(|e| format!("Failed to clear plugin params: {e}"))?;

        {
            let mut stmt = tx
                .prepare(
                    r#"
                    INSERT OR REPLACE INTO vst_params(
                      plugin_id, key, title, min, max, default_value, step, unit, scanned_at_ms
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                    "#,
                )
                .map_err(|e| format!("Failed to prepare params insert: {e}"))?;

            for param in params_list {
                stmt.execute(params![
                    plugin_id,
                    param.key,
                    param.title,
                    param.min,
                    param.max,
                    param.default,
                    param.step,
                    param.unit,
                    scanned_at_ms
                ])
                .map_err(|e| format!("Failed to insert param row: {e}"))?;
            }
        }

        tx.execute(
            "INSERT INTO vst_scan_events(run_id, at_ms, kind, plugin_id, message) VALUES (?1, ?2, 'params', ?3, ?4)",
            params![run_id, scanned_at_ms, plugin_id, format!("Scanned params ({})", params_list.len())],
        )
        .map_err(|e| format!("Failed to insert scan event: {e}"))?;

        tx.commit()
            .map_err(|e| format!("Failed to commit VST library transaction: {e}"))?;
        Ok(())
    })
}

pub fn mark_plugin_status(plugin_id: &str, status: &str) {
    let _ = with_conn(|conn| {
        conn.execute(
            "UPDATE vst_plugins SET status = ?2 WHERE plugin_id = ?1",
            params![plugin_id, status],
        )
        .map_err(|e| format!("Failed to update plugin status: {e}"))?;
        Ok(())
    });
}

pub fn reset_plugin_scan_status(plugin_id: &str) -> Result<(), String> {
    let plugin_id = plugin_id.trim();
    if plugin_id.is_empty() {
        return Err("Missing pluginId".to_string());
    }
    with_conn(|conn| {
        let changed = conn
            .execute(
                r#"
                UPDATE vst_plugins
                SET status = 'ok',
                    params_attempted_at_ms = NULL,
                    params_failure_count = 0
                WHERE plugin_id = ?1
                "#,
                params![plugin_id],
            )
            .map_err(|e| format!("Failed to reset plugin scan status: {e}"))?;
        if changed == 0 {
            return Err("Plugin not found".to_string());
        }
        Ok(())
    })
}

pub fn invalidate_plugin_params_cache(plugin_id: &str) -> Result<(), String> {
    let plugin_id = plugin_id.trim();
    if plugin_id.is_empty() {
        return Err("Missing pluginId".to_string());
    }
    with_conn(|conn| {
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start VST library transaction: {e}"))?;

        let changed = tx
            .execute(
                r#"
                UPDATE vst_plugins
                SET params_scanned_at_ms = NULL,
                    params_count = NULL,
                    params_attempted_at_ms = NULL,
                    params_failure_count = 0,
                    status = 'ok'
                WHERE plugin_id = ?1
                "#,
                params![plugin_id],
            )
            .map_err(|e| format!("Failed to invalidate plugin params cache: {e}"))?;
        if changed == 0 {
            return Err("Plugin not found".to_string());
        }

        tx.execute("DELETE FROM vst_params WHERE plugin_id = ?1", params![plugin_id])
            .map_err(|e| format!("Failed to delete cached plugin params: {e}"))?;

        tx.commit()
            .map_err(|e| format!("Failed to commit VST library transaction: {e}"))?;
        Ok(())
    })
}

pub fn record_params_scan_failure(plugin_id: &str, status: &str) -> Result<(), String> {
    let plugin_id = plugin_id.trim();
    if plugin_id.is_empty() {
        return Err("Missing pluginId".to_string());
    }
    let status = status.trim();
    if status.is_empty() {
        return Err("Missing status".to_string());
    }
    let attempted_at_ms = now_ms() as i64;
    with_conn(|conn| {
        conn.execute(
            r#"
            UPDATE vst_plugins
            SET params_attempted_at_ms = ?3,
                params_failure_count = params_failure_count + 1,
                status = CASE
                    WHEN params_scanned_at_ms IS NULL THEN ?2
                    ELSE status
                END
            WHERE plugin_id = ?1
            "#,
            params![plugin_id, status, attempted_at_ms],
        )
        .map_err(|e| format!("Failed to record params failure: {e}"))?;
        Ok(())
    })
}

pub fn list_plugins() -> Result<Vec<VstLibraryPlugin>, String> {
    with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT p.plugin_id,
                       p.name,
                       p.vendor,
                       p.version,
                       f.path,
                       p.status,
                       p.last_seen_at_ms,
                       p.params_scanned_at_ms,
                       p.input_channels,
                       p.output_channels,
                       p.params_count,
                       p.params_attempted_at_ms,
                       p.params_failure_count
                FROM vst_plugins p
                LEFT JOIN vst_files f ON f.plugin_id = p.plugin_id
                ORDER BY p.name ASC
                "#,
            )
            .map_err(|e| format!("Failed to prepare plugin list query: {e}"))?;

        let mut out = Vec::new();
        let rows = stmt
            .query_map([], |row| {
                let mut plugin = VstLibraryPlugin {
                    id: row.get::<_, String>(0)?,
                    name: row.get::<_, String>(1)?,
                    vendor: row.get::<_, Option<String>>(2)?,
                    version: row.get::<_, Option<String>>(3)?,
                    path: row.get::<_, Option<String>>(4)?,
                    status: row.get::<_, String>(5)?,
                    last_seen_at_ms: row.get::<_, i64>(6)? as u64,
                    params_scanned_at_ms: row.get::<_, Option<i64>>(7)?.map(|v| v as u64),
                    input_channels: row.get::<_, Option<i64>>(8)?.and_then(|v| u32::try_from(v).ok()),
                    output_channels: row.get::<_, Option<i64>>(9)?.and_then(|v| u32::try_from(v).ok()),
                    params_count: row.get::<_, Option<i64>>(10)?.and_then(|v| u32::try_from(v).ok()),
                    params_attempted_at_ms: row.get::<_, Option<i64>>(11)?.map(|v| v as u64),
                    params_failure_count: row.get::<_, i64>(12)? as u32,
                };
                if let Some(path) = plugin
                    .path
                    .as_deref()
                    .map(|path| path.trim())
                    .filter(|path| !path.is_empty())
                {
                    if !Path::new(path).exists() {
                        plugin.status = "missing".to_string();
                    }
                }
                Ok(plugin)
            })
            .map_err(|e| format!("Failed to query plugin list: {e}"))?;

        for row in rows {
            out.push(row.map_err(|e| format!("Failed to read plugin row: {e}"))?);
        }
        Ok(out)
    })
}

pub fn plugin_vendor(plugin_id: &str) -> Option<String> {
    let plugin_id = plugin_id.trim();
    if plugin_id.is_empty() {
        return None;
    }

    let vendor = with_conn(|conn| {
        conn.query_row(
            "SELECT vendor FROM vst_plugins WHERE plugin_id = ?1",
            params![plugin_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|e| format!("Failed to query plugin vendor: {e}"))
    })
    .ok()
    .flatten()
    .flatten();

    vendor.and_then(|raw| {
        let trimmed = raw.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

pub fn get_plugin_params(plugin_id: &str) -> Result<Vec<VstLibraryParamDescriptor>, String> {
    with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT key, title, min, max, default_value, step, unit, scanned_at_ms
                FROM vst_params
                WHERE plugin_id = ?1
                ORDER BY key ASC
                "#,
            )
            .map_err(|e| format!("Failed to prepare params query: {e}"))?;

        let mut out = Vec::new();
        let rows = stmt
            .query_map(params![plugin_id], |row| {
                Ok(VstLibraryParamDescriptor {
                    key: row.get::<_, String>(0)?,
                    title: row.get::<_, String>(1)?,
                    min: row.get::<_, f32>(2)?,
                    max: row.get::<_, f32>(3)?,
                    default: row.get::<_, f32>(4)?,
                    step: row.get::<_, f32>(5)?,
                    unit: row.get::<_, Option<String>>(6)?,
                    scanned_at_ms: row.get::<_, i64>(7)? as u64,
                })
            })
            .map_err(|e| format!("Failed to query params: {e}"))?;

        for row in rows {
            out.push(row.map_err(|e| format!("Failed to read param row: {e}"))?);
        }

        Ok(out)
    })
}

pub fn lookup_plugin_path(plugin_id: &str) -> Option<String> {
    with_conn(|conn| {
        let path: Option<String> = conn
            .query_row(
                "SELECT path FROM vst_files WHERE plugin_id = ?1",
                params![plugin_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to query plugin path: {e}"))?;
        Ok(path)
    })
    .ok()
    .and_then(|path| path)
    .map(|path| path.trim().to_string())
    .filter(|path| !path.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn column_names(conn: &Connection, table: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({table});"))
            .expect("prepare pragma");
        stmt.query_map([], |row| row.get::<_, String>(1))
            .expect("query pragma")
            .filter_map(Result::ok)
            .collect::<Vec<_>>()
    }

    #[test]
    fn migrate_creates_v3_schema_from_zero() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        migrate(&conn).expect("migrate");
        let version: i32 = conn
            .query_row("PRAGMA user_version;", [], |row| row.get(0))
            .expect("read version");
        assert_eq!(version, DB_VERSION);

        let cols = column_names(&conn, "vst_plugins");
        assert!(cols.contains(&"input_channels".to_string()));
        assert!(cols.contains(&"output_channels".to_string()));
        assert!(cols.contains(&"params_count".to_string()));
        assert!(cols.contains(&"params_attempted_at_ms".to_string()));
        assert!(cols.contains(&"params_failure_count".to_string()));
    }

    #[test]
    fn migrate_upgrades_v2_to_v3() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        // Simulate an older v2 schema.
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS vst_plugins (
              plugin_id TEXT PRIMARY KEY NOT NULL,
              name TEXT NOT NULL,
              vendor TEXT,
              version TEXT,
              format TEXT NOT NULL,
              status TEXT NOT NULL,
              last_seen_at_ms INTEGER NOT NULL,
              params_scanned_at_ms INTEGER
            );

            CREATE TABLE IF NOT EXISTS vst_files (
              plugin_id TEXT PRIMARY KEY NOT NULL,
              path TEXT NOT NULL,
              mtime_ms INTEGER,
              size INTEGER,
              sha256_prefix TEXT
            );

            CREATE TABLE IF NOT EXISTS vst_params (
              plugin_id TEXT NOT NULL,
              key TEXT NOT NULL,
              title TEXT NOT NULL,
              min REAL NOT NULL,
              max REAL NOT NULL,
              default_value REAL NOT NULL,
              step REAL NOT NULL,
              unit TEXT,
              scanned_at_ms INTEGER NOT NULL,
              PRIMARY KEY (plugin_id, key)
            );

            CREATE TABLE IF NOT EXISTS vst_scan_runs (
              run_id TEXT PRIMARY KEY NOT NULL,
              started_at_ms INTEGER NOT NULL,
              finished_at_ms INTEGER,
              status TEXT NOT NULL,
              error TEXT
            );

            CREATE TABLE IF NOT EXISTS vst_scan_events (
              run_id TEXT NOT NULL,
              at_ms INTEGER NOT NULL,
              kind TEXT NOT NULL,
              plugin_id TEXT,
              message TEXT NOT NULL
            );

            PRAGMA user_version = 2;
            "#,
        )
        .expect("create v2 schema");

        migrate(&conn).expect("migrate to v3");
        let version: i32 = conn
            .query_row("PRAGMA user_version;", [], |row| row.get(0))
            .expect("read version");
        assert_eq!(version, DB_VERSION);

        let cols = column_names(&conn, "vst_plugins");
        assert!(cols.contains(&"input_channels".to_string()));
        assert!(cols.contains(&"output_channels".to_string()));
        assert!(cols.contains(&"params_count".to_string()));
        assert!(cols.contains(&"params_attempted_at_ms".to_string()));
        assert!(cols.contains(&"params_failure_count".to_string()));
    }

    #[test]
    fn extract_deadman_hint_parses_path() {
        let message = "Bridge command timed out after 30000ms: --list-plugins (deadman=C:\\\\VST3\\\\Bad Plugin.vst3)";
        assert_eq!(
            extract_deadman_hint(message).as_deref(),
            Some("C:\\\\VST3\\\\Bad Plugin.vst3")
        );

        assert_eq!(extract_deadman_hint("no hint"), None);
    }
}
