use once_cell::sync::{Lazy, OnceCell};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::vst_bridge::{BridgeParamDescriptor, BridgePluginDescriptor};

const DB_VERSION: i32 = 2;

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

static DB_PATH: OnceCell<PathBuf> = OnceCell::new();
static DB_CONN: Lazy<Mutex<Option<Connection>>> = Lazy::new(|| Mutex::new(None));

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
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

    let version: i32 = conn
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

            CREATE INDEX IF NOT EXISTS vst_scan_events_run_id_idx ON vst_scan_events(run_id);
            CREATE INDEX IF NOT EXISTS vst_params_plugin_id_idx ON vst_params(plugin_id);

            PRAGMA user_version = 2;
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
        return Ok(());
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

pub fn upsert_plugin_snapshot(run_id: &str, plugin: &BridgePluginDescriptor) -> Result<(), String> {
    with_conn(|conn| {
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start VST library transaction: {e}"))?;

        let now = now_ms() as i64;
        tx.execute(
            r#"
            INSERT INTO vst_plugins(plugin_id, name, vendor, version, format, status, last_seen_at_ms, params_scanned_at_ms)
            VALUES (?1, ?2, ?3, ?4, 'vst3', 'ok', ?5, NULL)
            ON CONFLICT(plugin_id) DO UPDATE SET
              name = excluded.name,
              vendor = excluded.vendor,
              version = excluded.version,
              last_seen_at_ms = excluded.last_seen_at_ms
            "#,
            params![
                plugin.id,
                plugin.name,
                plugin.vendor,
                plugin.version,
                now
            ],
        )
        .map_err(|e| format!("Failed to upsert plugin row: {e}"))?;

        if let Some(path) = plugin
            .path
            .as_ref()
            .map(|p| p.trim())
            .filter(|p| !p.is_empty())
        {
            tx.execute(
                r#"
                INSERT INTO vst_files(plugin_id, path, mtime_ms, size, sha256_prefix)
                VALUES (?1, ?2, NULL, NULL, NULL)
                ON CONFLICT(plugin_id) DO UPDATE SET
                  path = excluded.path
                "#,
                params![plugin.id, path],
            )
            .map_err(|e| format!("Failed to upsert file row: {e}"))?;
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

        tx.execute(
            "UPDATE vst_plugins SET params_scanned_at_ms = ?2 WHERE plugin_id = ?1",
            params![plugin_id, scanned_at_ms],
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
                       p.params_scanned_at_ms
                FROM vst_plugins p
                LEFT JOIN vst_files f ON f.plugin_id = p.plugin_id
                ORDER BY p.name ASC
                "#,
            )
            .map_err(|e| format!("Failed to prepare plugin list query: {e}"))?;

        let mut out = Vec::new();
        let rows = stmt
            .query_map([], |row| {
                Ok(VstLibraryPlugin {
                    id: row.get::<_, String>(0)?,
                    name: row.get::<_, String>(1)?,
                    vendor: row.get::<_, Option<String>>(2)?,
                    version: row.get::<_, Option<String>>(3)?,
                    path: row.get::<_, Option<String>>(4)?,
                    status: row.get::<_, String>(5)?,
                    last_seen_at_ms: row.get::<_, i64>(6)? as u64,
                    params_scanned_at_ms: row.get::<_, Option<i64>>(7)?.map(|v| v as u64),
                })
            })
            .map_err(|e| format!("Failed to query plugin list: {e}"))?;

        for row in rows {
            out.push(row.map_err(|e| format!("Failed to read plugin row: {e}"))?);
        }
        Ok(out)
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
