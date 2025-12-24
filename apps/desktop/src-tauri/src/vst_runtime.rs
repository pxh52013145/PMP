use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::AppHandle;

use crate::vst_bridge::{BridgeClient, BridgePluginDescriptor};

struct VstNodeSession {
    plugin_id: String,
    client: BridgeClient,
}

static SESSIONS: Lazy<Mutex<HashMap<String, VstNodeSession>>> = Lazy::new(|| Mutex::new(HashMap::new()));

pub fn list_plugins() -> Result<Vec<BridgePluginDescriptor>, String> {
    crate::vst_bridge::list_plugins()
}

pub fn describe_plugin(plugin_id: &str) -> Result<BridgePluginDescriptor, String> {
    crate::vst_bridge::describe_plugin(plugin_id)
}

fn ensure_session(app: &AppHandle, node_id: &str, plugin_id: &str) -> Result<(), String> {
    let mut map = match SESSIONS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let needs_spawn = match map.get(node_id) {
        Some(existing) => existing.plugin_id != plugin_id,
        None => true,
    };

    if !needs_spawn {
        return Ok(());
    }

    map.remove(node_id);

    let sample_rate = 48_000u32;
    let channels = 2usize;

    let client = BridgeClient::spawn(plugin_id, sample_rate, channels)?;
    map.insert(
        node_id.to_string(),
        VstNodeSession {
            plugin_id: plugin_id.to_string(),
            client,
        },
    );

    // best-effort: close any stale editor window label.
    let _ = app;
    Ok(())
}

pub fn open_native_editor(app: &AppHandle, node_id: String, title: Option<String>) -> Result<(), String> {
    let plugin_id = crate::dsp_graph::resolve_vst_plugin_id(app, node_id.as_str())?;

    ensure_session(app, node_id.as_str(), plugin_id.as_str())?;

    let mut map = match SESSIONS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let session = map
        .get_mut(node_id.as_str())
        .ok_or_else(|| "VST session missing".to_string())?;
    session
        .client
        .open_editor_window(title.as_deref())
        .map_err(|e| format!("Bridge open editor failed: {e}"))?;
    Ok(())
}

pub fn close_native_editor(node_id: String) -> Result<(), String> {
    let mut map = match SESSIONS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    if let Some(mut session) = map.remove(node_id.as_str()) {
        let _ = session.client.close_editor_window();
    }

    Ok(())
}

pub fn close_all() {
    let mut map = match SESSIONS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    map.clear();
}

