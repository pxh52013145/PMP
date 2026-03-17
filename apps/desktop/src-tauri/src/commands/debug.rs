use std::collections::BTreeMap;
use std::process::Command;
use std::sync::Arc;

use crate::{debug_config, modules, perf_monitor, windows};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentGitCommit {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub committed_at_iso: String,
}

fn parse_recent_git_commits_output(stdout: &str) -> Vec<RecentGitCommit> {
    stdout
        .split('\u{001e}')
        .filter_map(|record| {
            let trimmed = record.trim();
            if trimmed.is_empty() {
                return None;
            }
            let mut parts = trimmed.split('\u{001f}');
            let hash = parts.next()?.trim().to_string();
            let short_hash = parts.next()?.trim().to_string();
            let subject = parts.next()?.trim().to_string();
            let committed_at_iso = parts.next()?.trim().to_string();
            if hash.is_empty()
                || short_hash.is_empty()
                || subject.is_empty()
                || committed_at_iso.is_empty()
            {
                return None;
            }
            Some(RecentGitCommit {
                hash,
                short_hash,
                subject,
                committed_at_iso,
            })
        })
        .collect()
}

fn collect_recent_git_commits(limit: usize) -> Vec<RecentGitCommit> {
    if limit == 0 {
        return Vec::new();
    }

    let output = Command::new("git")
        .args([
            "log",
            "--max-count",
            &limit.to_string(),
            "--pretty=format:%H%x1f%h%x1f%s%x1f%cI%x1e",
        ])
        .output();

    let output = match output {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    if !output.status.success() {
        return Vec::new();
    }

    match String::from_utf8(output.stdout) {
        Ok(stdout) => parse_recent_git_commits_output(&stdout),
        Err(_) => Vec::new(),
    }
}

#[tauri::command]
pub fn debug_get_config(app: tauri::AppHandle) -> Result<debug_config::DebugConfig, String> {
    debug_config::get_config(&app)
}

#[tauri::command]
pub fn debug_set_config(
    app: tauri::AppHandle,
    config: debug_config::DebugConfig,
) -> Result<(), String> {
    debug_config::set_config(&app, config)
}

#[tauri::command]
pub fn debug_get_env_snapshot() -> BTreeMap<String, Option<String>> {
    debug_config::env_snapshot()
}

#[tauri::command]
pub fn debug_get_editor_windows_state(
    app: tauri::AppHandle,
) -> windows::editor::EditorWindowsDebugState {
    windows::editor::debug_get_editor_windows_state(&app)
}

#[tauri::command]
pub fn governance_destroy_hidden_editor_windows(app: tauri::AppHandle) -> usize {
    windows::editor::governance_destroy_hidden_editor_windows(&app)
}

#[tauri::command]
pub fn governance_destroy_hidden_plugin_windows(app: tauri::AppHandle) -> usize {
    windows::plugin::governance_destroy_hidden_plugin_windows(&app)
}

#[tauri::command]
pub fn governance_destroy_hidden_vst_manager_windows(app: tauri::AppHandle) -> usize {
    windows::vst_manager::governance_destroy_hidden_vst_manager_windows(&app)
}

#[tauri::command]
pub async fn debug_get_process_perf_snapshot(
    perf_monitor: tauri::State<'_, Arc<perf_monitor::PerfMonitor>>,
) -> Result<perf_monitor::ProcessPerfSnapshot, String> {
    let monitor = perf_monitor.inner().clone();
    tauri::async_runtime::spawn_blocking(move || monitor.snapshot())
        .await
        .map_err(|e| format!("Process perf snapshot task failed: {e}"))?
}

#[tauri::command]
pub async fn debug_get_process_perf_totals(
    perf_monitor: tauri::State<'_, Arc<perf_monitor::PerfMonitor>>,
) -> Result<perf_monitor::ProcessPerfTotalsSnapshot, String> {
    let monitor = perf_monitor.inner().clone();
    tauri::async_runtime::spawn_blocking(move || monitor.snapshot_totals())
        .await
        .map_err(|e| format!("Process perf totals task failed: {e}"))?
}

#[tauri::command]
pub async fn debug_trim_process_working_set(
    perf_monitor: tauri::State<'_, Arc<perf_monitor::PerfMonitor>>,
    target: Option<perf_monitor::ProcessWorkingSetTrimTarget>,
) -> Result<perf_monitor::ProcessWorkingSetTrimResult, String> {
    let monitor = perf_monitor.inner().clone();
    let target = target.unwrap_or(perf_monitor::ProcessWorkingSetTrimTarget::Tree);
    tauri::async_runtime::spawn_blocking(move || monitor.trim_working_set(target))
        .await
        .map_err(|e| format!("Process working set trim task failed: {e}"))?
}

#[tauri::command]
pub fn debug_get_backend_modules() -> Vec<modules::descriptor::BackendModuleDescriptor> {
    modules::catalog::list_backend_modules()
}

#[tauri::command]
pub fn debug_get_registered_commands() -> Vec<String> {
    crate::commands::registry::list_registered_command_names()
        .into_iter()
        .map(str::to_string)
        .collect()
}

#[tauri::command]
pub async fn debug_get_recent_git_commits(limit: Option<u32>) -> Vec<RecentGitCommit> {
    let requested = limit.unwrap_or(3).clamp(1, 20) as usize;
    tauri::async_runtime::spawn_blocking(move || collect_recent_git_commits(requested))
        .await
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::parse_recent_git_commits_output;

    #[test]
    fn parse_recent_git_commits_output_extracts_records() {
        let input =
            "a1b2\u{001f}a1b2\u{001f}feat: hello\u{001f}2026-02-17T10:00:00+00:00\u{001e}\n\
                     c3d4\u{001f}c3d4\u{001f}fix: world\u{001f}2026-02-17T11:00:00+00:00\u{001e}";
        let commits = parse_recent_git_commits_output(input);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].hash, "a1b2");
        assert_eq!(commits[0].subject, "feat: hello");
        assert_eq!(commits[1].short_hash, "c3d4");
    }

    #[test]
    fn parse_recent_git_commits_output_ignores_incomplete_records() {
        let input = "a1b2\u{001f}a1b2\u{001f}\u{001f}2026-02-17T10:00:00+00:00\u{001e}";
        let commits = parse_recent_git_commits_output(input);
        assert!(commits.is_empty());
    }
}
