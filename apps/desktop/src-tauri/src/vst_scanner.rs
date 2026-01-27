use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

use crate::vst_bridge::BridgePluginDescriptor;
use crate::{vst_bridge, vst_library};

const EVENT_VST_SCAN_PROGRESS: &str = "vst-scan-progress";

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VstScanMode {
    Fast,
    Full,
    Params,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VstScanRequest {
    pub mode: VstScanMode,
    #[serde(default)]
    pub plugin_ids: Vec<String>,
    #[serde(default)]
    pub scan_paths: Vec<String>,
    #[serde(default)]
    pub include_default_paths: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VstScanState {
    pub running: bool,
    pub run_id: Option<String>,
    pub mode: Option<VstScanMode>,
    pub stage: Option<String>,
    pub total: u32,
    pub current: u32,
    pub current_plugin_id: Option<String>,
    pub last_error: Option<String>,
}

impl Default for VstScanState {
    fn default() -> Self {
        Self {
            running: false,
            run_id: None,
            mode: None,
            stage: None,
            total: 0,
            current: 0,
            current_plugin_id: None,
            last_error: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VstScanProgressPayload {
    pub run_id: String,
    pub mode: VstScanMode,
    pub stage: String,
    pub total: u32,
    pub current: u32,
    pub current_plugin_id: Option<String>,
    pub message: Option<String>,
    pub status: String,
    pub error: Option<String>,
}

struct ScannerJob {
    cancel: Arc<AtomicBool>,
}

static SCAN_NONCE: AtomicU64 = AtomicU64::new(0);
static SCANNER_STATE: Lazy<Mutex<VstScanState>> = Lazy::new(|| Mutex::new(VstScanState::default()));
static SCANNER_JOB: Lazy<Mutex<Option<ScannerJob>>> = Lazy::new(|| Mutex::new(None));

fn emit_progress(app: &AppHandle, payload: VstScanProgressPayload) {
    let _ = app.emit_all(EVENT_VST_SCAN_PROGRESS, payload);
}

fn update_state(mutator: impl FnOnce(&mut VstScanState)) {
    let mut guard = match SCANNER_STATE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    mutator(&mut guard);
}

pub fn get_state() -> Result<VstScanState, String> {
    let guard = SCANNER_STATE
        .lock()
        .map_err(|_| "VST scan state is locked".to_string())?;
    Ok(guard.clone())
}

pub fn cancel_scan() -> Result<(), String> {
    let guard = match SCANNER_JOB.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let Some(job) = guard.as_ref() else {
        return Ok(());
    };
    job.cancel.store(true, Ordering::Release);
    Ok(())
}

pub fn start_scan(app: &AppHandle, request: VstScanRequest) -> Result<String, String> {
    {
        let mut guard = match SCANNER_JOB.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        if guard.is_some() {
            return Err("VST scan already running".to_string());
        }

        let nonce = SCAN_NONCE.fetch_add(1, Ordering::Relaxed);
        let run_id = format!("vst-scan-{}-{}", now_ms(), nonce);
        let cancel = Arc::new(AtomicBool::new(false));
        *guard = Some(ScannerJob { cancel: cancel.clone() });

        update_state(|state| {
            state.running = true;
            state.run_id = Some(run_id.clone());
            state.mode = Some(request.mode);
            state.stage = Some("starting".to_string());
            state.total = 0;
            state.current = 0;
            state.current_plugin_id = None;
            state.last_error = None;
        });

        let app = app.clone();
        let thread_run_id = run_id.clone();
        thread::spawn(move || run_scan_thread(app, request, thread_run_id, cancel));
        Ok(run_id)
    }
}

fn run_scan_thread(app: AppHandle, request: VstScanRequest, run_id: String, cancel: Arc<AtomicBool>) {
    let started_at = now_ms();
    let VstScanRequest {
        mode,
        plugin_ids,
        scan_paths,
        include_default_paths,
    } = request;

    let mode_str = match mode {
        VstScanMode::Fast => "fast",
        VstScanMode::Full => "full",
        VstScanMode::Params => "params",
    };

    let _ = vst_library::record_scan_run_started(&run_id, started_at, mode_str);

    let result = match mode {
        VstScanMode::Fast => scan_fast(&app, &run_id, &cancel, &scan_paths, include_default_paths),
        VstScanMode::Full => scan_full(&app, &run_id, &cancel, &scan_paths, include_default_paths),
        VstScanMode::Params => {
            scan_params(&app, &run_id, &cancel, plugin_ids, &scan_paths, include_default_paths)
        }
    };

    let finished_at = now_ms();
    let cancelled = cancel.load(Ordering::Acquire);
    let status = if cancelled {
        "cancelled"
    } else if result.is_ok() {
        "ok"
    } else {
        "error"
    };

    let _ = vst_library::record_scan_run_finished(
        &run_id,
        finished_at,
        status,
        result.as_ref().err().map(|e| e.as_str()),
    );

    update_state(|state| {
        state.running = false;
        state.stage = Some("finished".to_string());
        state.current_plugin_id = None;
        state.last_error = result.clone().err();
    });

    emit_progress(
        &app,
        VstScanProgressPayload {
            run_id: run_id.clone(),
            mode,
            stage: "done".to_string(),
            total: 0,
            current: 0,
            current_plugin_id: None,
            message: None,
            status: status.to_string(),
            error: result.err(),
        },
    );

    let mut guard = match SCANNER_JOB.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    *guard = None;
}

fn scan_fast(
    app: &AppHandle,
    run_id: &str,
    cancel: &AtomicBool,
    scan_paths: &[String],
    include_default_paths: bool,
) -> Result<(), String> {
    update_state(|state| state.stage = Some("list-plugins".to_string()));
    emit_progress(
        app,
        VstScanProgressPayload {
            run_id: run_id.to_string(),
            mode: VstScanMode::Fast,
            stage: "list-plugins".to_string(),
            total: 0,
            current: 0,
            current_plugin_id: None,
            message: Some("Listing plugins...".to_string()),
            status: "running".to_string(),
            error: None,
        },
    );

    // Listing can hang/crash on a problematic plugin. The sidecar uses JUCE's dead-man pedal file,
    // so retrying after a kill will automatically skip the last problematic plugin and continue.
    const MAX_LIST_ATTEMPTS: u32 = 12;
    let mut attempt = 0u32;
    let plugins: Vec<BridgePluginDescriptor> = loop {
        if cancel.load(Ordering::Acquire) {
            return Ok(());
        }
        attempt = attempt.saturating_add(1);
        match vst_bridge::list_plugins_with_scan_paths_with_cancel(
            scan_paths,
            include_default_paths,
            Some(cancel),
        ) {
            Ok(plugins) => break plugins,
            Err(err) => {
                if cancel.load(Ordering::Acquire) {
                    return Ok(());
                }
                if err.contains("cancelled") {
                    return Ok(());
                }

                let kind = if err.contains("timed out") || err.contains("stalled") {
                    "list-timeout"
                } else {
                    "list-failed"
                };
                vst_library::record_scan_event(run_id, kind, None, &err);

                emit_progress(
                    app,
                    VstScanProgressPayload {
                        run_id: run_id.to_string(),
                        mode: VstScanMode::Fast,
                        stage: "list-plugins".to_string(),
                        total: 0,
                        current: 0,
                        current_plugin_id: None,
                        message: Some(format!(
                            "List plugins failed (attempt {attempt}/{MAX_LIST_ATTEMPTS}), retrying..."
                        )),
                        status: "running".to_string(),
                        error: Some(err.clone()),
                    },
                );

                if attempt >= MAX_LIST_ATTEMPTS {
                    return Err(err);
                }

                thread::sleep(Duration::from_millis(250));
                continue;
            }
        }
    };
    let total = plugins.len().min(u32::MAX as usize) as u32;
    update_state(|state| {
        state.total = total;
        state.current = 0;
    });

    for (idx, plugin) in plugins.iter().enumerate() {
        if cancel.load(Ordering::Acquire) {
            return Ok(());
        }
        let current = (idx as u32).saturating_add(1);
        update_state(|state| {
            state.stage = Some("persist".to_string());
            state.total = total;
            state.current = current;
            state.current_plugin_id = Some(plugin.id.clone());
        });

        emit_progress(
            app,
            VstScanProgressPayload {
                run_id: run_id.to_string(),
                mode: VstScanMode::Fast,
                stage: "persist".to_string(),
                total,
                current,
                current_plugin_id: Some(plugin.id.clone()),
                message: Some(plugin.name.clone()),
                status: "running".to_string(),
                error: None,
            },
        );

        if let Err(err) = vst_library::upsert_plugin_snapshot(run_id, plugin) {
            vst_library::record_scan_event(run_id, "persist-failed", Some(plugin.id.as_str()), &err);
        }
    }

    Ok(())
}

fn scan_params(
    app: &AppHandle,
    run_id: &str,
    cancel: &AtomicBool,
    plugin_ids: Vec<String>,
    scan_paths: &[String],
    include_default_paths: bool,
) -> Result<(), String> {
    let plugin_ids = plugin_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    if plugin_ids.is_empty() {
        return Err("No pluginIds provided for params scan".to_string());
    }

    let total = plugin_ids.len().min(u32::MAX as usize) as u32;
    for (idx, plugin_id) in plugin_ids.iter().enumerate() {
        if cancel.load(Ordering::Acquire) {
            return Ok(());
        }
        let current = (idx as u32).saturating_add(1);
        update_state(|state| {
            state.stage = Some("describe".to_string());
            state.total = total;
            state.current = current;
            state.current_plugin_id = Some(plugin_id.clone());
        });

        emit_progress(
            app,
            VstScanProgressPayload {
                run_id: run_id.to_string(),
                mode: VstScanMode::Params,
                stage: "describe".to_string(),
                total,
                current,
                current_plugin_id: Some(plugin_id.clone()),
                message: Some("Describing plugin...".to_string()),
                status: "running".to_string(),
                error: None,
            },
        );

        let plugin_path = vst_library::lookup_plugin_path(plugin_id.as_str());
        let plugin_path = match plugin_path {
            Some(path) => {
                let normalized = path.trim().to_string();
                if normalized.is_empty() {
                    None
                } else if std::path::Path::new(&normalized).exists() {
                    Some(normalized)
                } else {
                    let message = format!("Missing plugin file: {normalized}");
                    let _ = vst_library::record_params_scan_failure(plugin_id.as_str(), "missing");
                    vst_library::record_scan_event(
                        run_id,
                        "describe-missing",
                        Some(plugin_id.as_str()),
                        &message,
                    );
                    continue;
                }
            }
            None => {
                let _ = vst_library::record_params_scan_failure(plugin_id.as_str(), "missing");
                vst_library::record_scan_event(
                    run_id,
                    "describe-missing",
                    Some(plugin_id.as_str()),
                    "Missing plugin path in library cache",
                );
                continue;
            }
        };
        let desc = match vst_bridge::describe_plugin_with_scan_paths_with_cancel(
            plugin_id.as_str(),
            plugin_path.as_deref(),
            scan_paths,
            include_default_paths,
            Some(cancel),
        ) {
            Ok(desc) => desc,
            Err(err) => {
                let kind = if err.contains("timed out") {
                    let _ = vst_library::record_params_scan_failure(plugin_id.as_str(), "timeout");
                    "describe-timeout"
                } else {
                    let _ = vst_library::record_params_scan_failure(plugin_id.as_str(), "bad");
                    "describe-failed"
                };
                vst_library::record_scan_event(run_id, kind, Some(plugin_id.as_str()), &err);
                continue;
            }
        };

        if let Err(err) = vst_library::upsert_plugin_params(run_id, plugin_id.as_str(), &desc.parameters) {
            vst_library::record_scan_event(run_id, "persist-params-failed", Some(plugin_id.as_str()), &err);
        }
    }

    Ok(())
}

fn scan_full(
    app: &AppHandle,
    run_id: &str,
    cancel: &AtomicBool,
    scan_paths: &[String],
    include_default_paths: bool,
) -> Result<(), String> {
    scan_fast(app, run_id, cancel, scan_paths, include_default_paths)?;
    if cancel.load(Ordering::Acquire) {
        return Ok(());
    }

    update_state(|state| state.stage = Some("list-from-library".to_string()));
    let plugins = vst_library::list_plugins()?;

    // Avoid repeatedly stalling full scans on known-bad/timeouting plugins. Users can still
    // explicitly retry a single plugin via mode=params.
    const TIMEOUT_COOLDOWN_MS: u64 = 12 * 60 * 60 * 1000;
    let now = now_ms();
    let mut plugin_ids = Vec::new();
    let mut missing_params = 0u32;
    let mut skipped_params = 0u32;
    for plugin in plugins {
        if plugin.params_scanned_at_ms.is_some() {
            continue;
        }
        missing_params = missing_params.saturating_add(1);

        if plugin.status == "bad" {
            skipped_params = skipped_params.saturating_add(1);
            vst_library::record_scan_event(
                run_id,
                "params-skip",
                Some(plugin.id.as_str()),
                "Skipped params scan (status=bad)",
            );
            continue;
        }

        if plugin.status == "missing" {
            skipped_params = skipped_params.saturating_add(1);
            vst_library::record_scan_event(
                run_id,
                "params-skip",
                Some(plugin.id.as_str()),
                "Skipped params scan (missing plugin file)",
            );
            continue;
        }

        if plugin.status == "timeout" {
            if let Some(attempted_at_ms) = plugin.params_attempted_at_ms {
                if now.saturating_sub(attempted_at_ms) < TIMEOUT_COOLDOWN_MS {
                    skipped_params = skipped_params.saturating_add(1);
                    vst_library::record_scan_event(
                        run_id,
                        "params-skip",
                        Some(plugin.id.as_str()),
                        &format!(
                            "Skipped params scan (recent timeout; failures={})",
                            plugin.params_failure_count
                        ),
                    );
                    continue;
                }
            }
        }

        plugin_ids.push(plugin.id);
    }
    if plugin_ids.is_empty() {
        let message = if missing_params == 0 {
            "All plugins have cached params."
        } else if skipped_params >= missing_params {
            "Params scan skipped for all pending plugins (timeout/bad)."
        } else {
            "No plugins pending params scan."
        };
        vst_library::record_scan_event(run_id, "params-skip", None, message);
        return Ok(());
    }
    scan_params(
        app,
        run_id,
        cancel,
        plugin_ids,
        scan_paths,
        include_default_paths,
    )?;
    Ok(())
}
