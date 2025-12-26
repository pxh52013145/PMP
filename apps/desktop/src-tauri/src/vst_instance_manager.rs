use once_cell::sync::Lazy;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use crate::dsp_graph::{DspGraphConfig, DspGraphNode, VstParamValue};

#[derive(Clone, Debug)]
struct DesiredNodeState {
    plugin_id: String,
    generation: u64,
    params: Vec<(String, f32)>,
}

static DESIRED: Lazy<Mutex<HashMap<String, DesiredNodeState>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn normalize_params(params: Vec<VstParamValue>) -> Vec<(String, f32)> {
    params
        .into_iter()
        .filter_map(|p| {
            let key = p.key.trim().to_string();
            if key.is_empty() || !p.value.is_finite() {
                return None;
            }
            Some((key, p.value))
        })
        .collect()
}

pub fn sync_from_graph(graph: &DspGraphConfig) {
    let mut desired_by_node_id = HashMap::<String, (String, Vec<(String, f32)>)>::new();
    let mut alive = HashSet::<String>::new();

    for node in &graph.nodes {
        let DspGraphNode::Vst {
            id,
            enabled: _,
            plugin_id,
            params,
        } = node
        else {
            continue;
        };

        let node_id = id.trim();
        let plugin_id = plugin_id.trim();
        if node_id.is_empty() || plugin_id.is_empty() {
            continue;
        }

        alive.insert(node_id.to_string());
        desired_by_node_id.insert(
            node_id.to_string(),
            (
                plugin_id.to_string(),
                normalize_params(params.clone().unwrap_or_default()),
            ),
        );
    }

    let mut guard = match DESIRED.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    guard.retain(|node_id, _| alive.contains(node_id));

    for (node_id, (plugin_id, params)) in desired_by_node_id {
        match guard.get_mut(&node_id) {
            Some(existing) => {
                if existing.plugin_id != plugin_id {
                    existing.plugin_id = plugin_id;
                    existing.generation = existing.generation.saturating_add(1).max(1);
                    existing.params = params;
                    continue;
                }
                if existing.params != params {
                    existing.params = params;
                    existing.generation = existing.generation.saturating_add(1).max(1);
                }
            }
            None => {
                guard.insert(
                    node_id,
                    DesiredNodeState {
                        plugin_id,
                        generation: 1,
                        params,
                    },
                );
            }
        }
    }
}

pub fn set_node_params(node_id: &str, plugin_id: &str, params: Vec<VstParamValue>) {
    let node_id = node_id.trim();
    let plugin_id = plugin_id.trim();
    if node_id.is_empty() || plugin_id.is_empty() {
        return;
    }

    let params = normalize_params(params);

    let mut guard = match DESIRED.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    match guard.get_mut(node_id) {
        Some(existing) => {
            if existing.plugin_id != plugin_id {
                existing.plugin_id = plugin_id.to_string();
                existing.generation = existing.generation.saturating_add(1).max(1);
                existing.params = params;
                return;
            }
            if existing.params != params {
                existing.params = params;
                existing.generation = existing.generation.saturating_add(1).max(1);
            }
        }
        None => {
            guard.insert(
                node_id.to_string(),
                DesiredNodeState {
                    plugin_id: plugin_id.to_string(),
                    generation: 1,
                    params,
                },
            );
        }
    }
}

pub fn desired_params(node_id: &str, plugin_id: &str) -> Vec<(String, f32)> {
    let node_id = node_id.trim();
    let plugin_id = plugin_id.trim();
    if node_id.is_empty() || plugin_id.is_empty() {
        return Vec::new();
    }

    let guard = match DESIRED.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    match guard.get(node_id) {
        Some(existing) if existing.plugin_id == plugin_id => existing.params.clone(),
        _ => Vec::new(),
    }
}

pub fn desired_generation(node_id: &str, plugin_id: &str) -> Option<u64> {
    let node_id = node_id.trim();
    let plugin_id = plugin_id.trim();
    if node_id.is_empty() || plugin_id.is_empty() {
        return None;
    }

    let guard = match DESIRED.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    match guard.get(node_id) {
        Some(existing) if existing.plugin_id == plugin_id => Some(existing.generation),
        _ => None,
    }
}
