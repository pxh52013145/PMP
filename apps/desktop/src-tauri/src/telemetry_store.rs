use crate::telemetry_contract::TelemetryRecord;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

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

        let current_file_path = root_dir.join("current-session.jsonl");
        Ok(Self {
            root_dir,
            current_file_path,
        })
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
            Err(error) => return Err(format!("Failed to open telemetry file for reading: {error}")),
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
}
