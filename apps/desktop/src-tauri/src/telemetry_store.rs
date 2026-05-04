use crate::telemetry_contract::{TelemetryLevel, TelemetryRecord, TelemetryRetentionPolicy};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

const CURRENT_SESSION_FILE_NAME: &str = "current-session.jsonl";
const ARCHIVE_FILE_PREFIX: &str = "session-archive-";
const JSONL_EXTENSION: &str = "jsonl";

#[derive(Debug, Clone)]
pub struct TelemetryStore {
    root_dir: PathBuf,
    current_file_path: PathBuf,
}

impl TelemetryStore {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let app_data_dir = app
            .path_resolver()
            .app_data_dir()
            .ok_or_else(|| "Unable to resolve app data directory".to_string())?;
        Self::new_for_root_dir(app_data_dir.join("debug").join("telemetry"))
    }

    pub fn new_for_root_dir(root_dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&root_dir)
            .map_err(|error| format!("Failed to create telemetry directory: {error}"))?;

        let current_file_path = root_dir.join(CURRENT_SESSION_FILE_NAME);
        Ok(Self {
            root_dir,
            current_file_path,
        })
    }

    pub fn prepare_active_session(
        &self,
        retention: &TelemetryRetentionPolicy,
    ) -> Result<(), String> {
        self.archive_existing_current_session(retention.debug_current_session_only)?;
        self.enforce_retention(retention)
    }

    pub fn append_records(&self, records: &[TelemetryRecord]) -> Result<u64, String> {
        if records.is_empty() {
            return Ok(0);
        }

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.current_file_path)
            .map_err(|error| format!("Failed to open telemetry file: {error}"))?;

        let mut bytes_written = 0u64;
        for record in records {
            let line = serde_json::to_vec(record)
                .map_err(|error| format!("Failed to encode telemetry record: {error}"))?;
            file.write_all(&line)
                .and_then(|_| file.write_all(b"\n"))
                .map_err(|error| format!("Failed to append telemetry record: {error}"))?;
            bytes_written = bytes_written.saturating_add(line.len() as u64 + 1);
        }

        file.flush()
            .map_err(|error| format!("Failed to flush telemetry file: {error}"))?;
        Ok(bytes_written)
    }

    pub fn enforce_retention(&self, retention: &TelemetryRetentionPolicy) -> Result<(), String> {
        let now_ms = now_ms();
        let mut archives = self.list_archive_files()?;

        for archive in &archives {
            let max_age_days = if archive.has_error_or_fatal {
                retention.error_days
            } else {
                retention.info_days
            };
            if archive.modified_ms.saturating_add(days_to_ms(max_age_days)) < now_ms {
                remove_file_if_exists(&archive.path)?;
            }
        }

        archives = self.list_archive_files()?;
        let mut total_bytes = self.current_file_len().saturating_add(
            archives
                .iter()
                .map(|archive| archive.len)
                .fold(0u64, |total, len| total.saturating_add(len)),
        );

        if total_bytes <= retention.max_total_bytes {
            return Ok(());
        }

        archives.sort_by(|left, right| {
            left.modified_ms
                .cmp(&right.modified_ms)
                .then_with(|| left.path.cmp(&right.path))
        });

        for archive in archives {
            if total_bytes <= retention.max_total_bytes {
                break;
            }
            remove_file_if_exists(&archive.path)?;
            total_bytes = total_bytes.saturating_sub(archive.len);
        }

        Ok(())
    }

    pub fn clear_current_session(&self) -> Result<(), String> {
        match fs::remove_file(&self.current_file_path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("Failed to clear telemetry session file: {error}")),
        }
    }

    pub fn read_current_session_records(&self) -> Result<Vec<TelemetryRecord>, String> {
        let file = match OpenOptions::new().read(true).open(&self.current_file_path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(format!(
                    "Failed to open telemetry file for reading: {error}"
                ))
            }
        };

        let reader = BufReader::new(file);
        let mut records = Vec::new();

        for line in reader.lines() {
            let line =
                line.map_err(|error| format!("Failed to read telemetry record line: {error}"))?;
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let record = serde_json::from_str::<TelemetryRecord>(trimmed)
                .map_err(|error| format!("Failed to decode telemetry record line: {error}"))?;
            records.push(record);
        }

        Ok(records)
    }

    pub fn current_file_len(&self) -> u64 {
        fs::metadata(&self.current_file_path)
            .map(|metadata| metadata.len())
            .unwrap_or(0)
    }

    pub fn current_file_path(&self) -> &Path {
        &self.current_file_path
    }

    #[allow(dead_code)]
    pub fn root_dir(&self) -> &Path {
        &self.root_dir
    }

    fn archive_existing_current_session(
        &self,
        debug_current_session_only: bool,
    ) -> Result<Option<PathBuf>, String> {
        let current_len = self.current_file_len();
        if current_len == 0 {
            return Ok(None);
        }

        let archive_path = self.next_archive_path();
        if debug_current_session_only {
            match read_and_filter_records(&self.current_file_path, |record| {
                record.level >= TelemetryLevel::Info
            }) {
                Ok(records) => {
                    if records.is_empty() {
                        remove_file_if_exists(&self.current_file_path)?;
                        return Ok(None);
                    }
                    write_records_to_file(&archive_path, &records)?;
                    remove_file_if_exists(&self.current_file_path)?;
                    return Ok(Some(archive_path));
                }
                Err(_) => {
                    // Preserve a malformed or partially-written session rather than deleting it.
                }
            }
        }

        fs::rename(&self.current_file_path, &archive_path)
            .map_err(|error| format!("Failed to archive telemetry session: {error}"))?;
        Ok(Some(archive_path))
    }

    fn next_archive_path(&self) -> PathBuf {
        let timestamp_ms = now_ms();
        for attempt in 0..1000u32 {
            let file_name =
                format!("{ARCHIVE_FILE_PREFIX}{timestamp_ms}-{attempt}.{JSONL_EXTENSION}");
            let candidate = self.root_dir.join(file_name);
            if !candidate.exists() {
                return candidate;
            }
        }

        self.root_dir.join(format!(
            "{ARCHIVE_FILE_PREFIX}{timestamp_ms}-fallback-{}.{JSONL_EXTENSION}",
            std::process::id()
        ))
    }

    fn list_archive_files(&self) -> Result<Vec<TelemetryArchiveFile>, String> {
        let entries = fs::read_dir(&self.root_dir)
            .map_err(|error| format!("Failed to read telemetry directory: {error}"))?;
        let mut archives = Vec::new();

        for entry in entries {
            let entry = entry
                .map_err(|error| format!("Failed to read telemetry directory entry: {error}"))?;
            let path = entry.path();
            if !is_archive_file(&path) {
                continue;
            }
            let metadata = entry
                .metadata()
                .map_err(|error| format!("Failed to read telemetry archive metadata: {error}"))?;
            if !metadata.is_file() {
                continue;
            }
            let modified_ms = metadata
                .modified()
                .ok()
                .and_then(system_time_to_ms)
                .unwrap_or(0);
            archives.push(TelemetryArchiveFile {
                path: path.clone(),
                len: metadata.len(),
                modified_ms,
                has_error_or_fatal: archive_has_error_or_fatal(&path).unwrap_or(false),
            });
        }

        Ok(archives)
    }
}

#[derive(Debug, Clone)]
struct TelemetryArchiveFile {
    path: PathBuf,
    len: u64,
    modified_ms: u64,
    has_error_or_fatal: bool,
}

fn is_archive_file(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    file_name.starts_with(ARCHIVE_FILE_PREFIX)
        && path.extension().and_then(|value| value.to_str()) == Some(JSONL_EXTENSION)
}

fn read_and_filter_records(
    path: &Path,
    mut should_keep: impl FnMut(&TelemetryRecord) -> bool,
) -> Result<Vec<TelemetryRecord>, String> {
    let file = OpenOptions::new()
        .read(true)
        .open(path)
        .map_err(|error| format!("Failed to open telemetry file for archiving: {error}"))?;
    let reader = BufReader::new(file);
    let mut records = Vec::new();

    for line in reader.lines() {
        let line =
            line.map_err(|error| format!("Failed to read telemetry archive line: {error}"))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let record = serde_json::from_str::<TelemetryRecord>(trimmed)
            .map_err(|error| format!("Failed to decode telemetry archive line: {error}"))?;
        if should_keep(&record) {
            records.push(record);
        }
    }

    Ok(records)
}

fn write_records_to_file(path: &Path, records: &[TelemetryRecord]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("Failed to create telemetry archive: {error}"))?;

    for record in records {
        let line = serde_json::to_vec(record)
            .map_err(|error| format!("Failed to encode telemetry archive record: {error}"))?;
        file.write_all(&line)
            .and_then(|_| file.write_all(b"\n"))
            .map_err(|error| format!("Failed to write telemetry archive record: {error}"))?;
    }

    file.flush()
        .map_err(|error| format!("Failed to flush telemetry archive: {error}"))
}

fn archive_has_error_or_fatal(path: &Path) -> Result<bool, String> {
    let records = read_and_filter_records(path, |_| true)?;
    Ok(records
        .iter()
        .any(|record| record.level >= TelemetryLevel::Error))
}

fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to remove telemetry file: {error}")),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn system_time_to_ms(value: SystemTime) -> Option<u64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

fn days_to_ms(days: u32) -> u64 {
    u64::from(days)
        .saturating_mul(24)
        .saturating_mul(60)
        .saturating_mul(60)
        .saturating_mul(1000)
}
