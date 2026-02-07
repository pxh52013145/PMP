use std::collections::BTreeMap;
use std::sync::Arc;

use crate::{debug_config, modules, perf_monitor, windows};

#[tauri::command]
pub fn debug_get_config(app: tauri::AppHandle) -> Result<debug_config::DebugConfig, String> {
    debug_config::get_config(&app)
}

#[tauri::command]
pub fn debug_set_config(app: tauri::AppHandle, config: debug_config::DebugConfig) -> Result<(), String> {
    debug_config::set_config(&app, config)
}

#[tauri::command]
pub fn debug_get_env_snapshot() -> BTreeMap<String, Option<String>> {
    debug_config::env_snapshot()
}

#[tauri::command]
pub fn debug_get_editor_windows_state(app: tauri::AppHandle) -> windows::editor::EditorWindowsDebugState {
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
