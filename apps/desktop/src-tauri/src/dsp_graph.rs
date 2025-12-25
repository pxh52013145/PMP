use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;

use crate::native_audio::{DspNodeConfig, EqBandConfig};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VstParamValue {
    pub key: String,
    pub value: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum DspGraphNode {
    Gain { id: String, enabled: bool, db: f32 },
    Eq { id: String, enabled: bool, bands: Vec<EqBandConfig> },
    Limiter {
        id: String,
        enabled: bool,
        #[serde(rename = "thresholdDb")]
        threshold_db: f32,
    },
    Vst {
        id: String,
        enabled: bool,
        #[serde(rename = "pluginId")]
        plugin_id: String,
        params: Option<Vec<VstParamValue>>,
    },
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct DspGraphConfig {
    pub nodes: Vec<DspGraphNode>,
}

static DSP_GRAPH: Lazy<Mutex<Option<DspGraphConfig>>> = Lazy::new(|| Mutex::new(None));

const DEMO_VST_PLUGIN_ID: &str = "demo.gain";

fn normalize_graph(graph: &mut DspGraphConfig) -> bool {
    let mut changed = false;
    for node in &mut graph.nodes {
        let DspGraphNode::Vst {
            enabled,
            plugin_id,
            params,
            ..
        } = node
        else {
            continue;
        };

        if plugin_id.trim() != DEMO_VST_PLUGIN_ID {
            continue;
        }

        *enabled = false;
        *plugin_id = String::new();
        *params = None;
        changed = true;
    }
    changed
}

fn graph_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Unable to resolve app data directory".to_string())?;
    let dir = app_data_dir.join("audio");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create audio directory: {e}"))?;
    Ok(dir.join("native-audio-dsp-graph.json"))
}

fn read_graph_from_disk(app: &AppHandle) -> Result<DspGraphConfig, String> {
    let path = graph_file_path(app)?;
    let data = match std::fs::read(&path) {
        Ok(data) => data,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(DspGraphConfig::default()),
        Err(err) => return Err(format!("Failed to read DSP graph: {err}")),
    };

    serde_json::from_slice::<DspGraphConfig>(&data)
        .map_err(|e| format!("Failed to parse DSP graph: {e}"))
}

fn write_graph_to_disk(app: &AppHandle, graph: &DspGraphConfig) -> Result<(), String> {
    let path = graph_file_path(app)?;
    let data = serde_json::to_vec_pretty(graph).map_err(|e| format!("Failed to encode DSP graph: {e}"))?;
    std::fs::write(&path, data).map_err(|e| format!("Failed to write DSP graph: {e}"))
}

fn to_native_dsp_chain(graph: &DspGraphConfig) -> Vec<DspNodeConfig> {
    let mut chain = Vec::new();
    for node in &graph.nodes {
        match node {
            DspGraphNode::Gain { enabled, db, .. } if *enabled => {
                chain.push(DspNodeConfig::Gain { db: *db });
            }
            DspGraphNode::Eq { enabled, bands, .. } if *enabled => {
                chain.push(DspNodeConfig::Eq { bands: bands.clone() });
            }
            DspGraphNode::Limiter {
                enabled,
                threshold_db,
                ..
            } if *enabled => {
                chain.push(DspNodeConfig::Limiter {
                    threshold_db: *threshold_db,
                });
            }
            DspGraphNode::Vst {
                enabled,
                id,
                plugin_id,
                ..
            } if *enabled && !plugin_id.trim().is_empty() && plugin_id.trim() != DEMO_VST_PLUGIN_ID => {
                chain.push(DspNodeConfig::Vst {
                    id: id.clone(),
                    plugin_id: plugin_id.clone(),
                });
            }
            _ => {}
        }
    }
    chain
}

pub fn get_dsp_graph(app: &AppHandle) -> Result<DspGraphConfig, String> {
    let mut guard = DSP_GRAPH
        .lock()
        .map_err(|_| "DSP graph state is locked".to_string())?;
    if let Some(graph) = guard.as_ref() {
        return Ok(graph.clone());
    }

    let mut graph = read_graph_from_disk(app).unwrap_or_default();
    if normalize_graph(&mut graph) {
        let _ = write_graph_to_disk(app, &graph);
    }
    *guard = Some(graph.clone());
    Ok(graph)
}

pub fn set_dsp_graph(app: &AppHandle, graph: DspGraphConfig) -> Result<(), String> {
    {
        let mut guard = DSP_GRAPH
            .lock()
            .map_err(|_| "DSP graph state is locked".to_string())?;
        *guard = Some(graph.clone());
    }

    let chain = to_native_dsp_chain(&graph);
    crate::native_audio::set_dsp_chain(app, chain)?;
    write_graph_to_disk(app, &graph)?;
    Ok(())
}

pub fn resolve_vst_plugin_id(app: &AppHandle, node_id: &str) -> Result<String, String> {
    let graph = get_dsp_graph(app)?;
    for node in graph.nodes {
        if let DspGraphNode::Vst { id, plugin_id, .. } = node {
            if id == node_id {
                if plugin_id.trim().is_empty() || plugin_id.trim() == DEMO_VST_PLUGIN_ID {
                    return Err(format!("VST node has no plugin selected: {node_id}"));
                }
                return Ok(plugin_id);
            }
        }
    }
    Err(format!("VST node not found: {node_id}"))
}

#[cfg(test)]
mod tests {
    use super::{to_native_dsp_chain, DspGraphConfig, DspGraphNode};
    use crate::native_audio::DspNodeConfig;

    #[test]
    fn graph_to_chain_filters_disabled_and_unknown_nodes() {
        let graph = DspGraphConfig {
            nodes: vec![
                DspGraphNode::Gain {
                    id: "gain1".into(),
                    enabled: true,
                    db: -6.0,
                },
                DspGraphNode::Gain {
                    id: "gain2".into(),
                    enabled: false,
                    db: 3.0,
                },
                DspGraphNode::Vst {
                    id: "vst1".into(),
                    enabled: true,
                    plugin_id: "VST3-TestPlugin-123".into(),
                    params: None,
                },
            ],
        };

        let chain = to_native_dsp_chain(&graph);
        assert_eq!(chain.len(), 2);
        match chain[0] {
            DspNodeConfig::Gain { db } => assert!((db + 6.0).abs() < 1e-6),
            _ => panic!("expected gain node"),
        }
        match &chain[1] {
            DspNodeConfig::Vst { id, plugin_id } => {
                assert_eq!(id, "vst1");
                assert_eq!(plugin_id, "VST3-TestPlugin-123");
            }
            _ => panic!("expected vst node"),
        }
    }
}
