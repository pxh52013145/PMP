use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const STORE_VERSION: u32 = 1;
const STORE_DIR: &str = "pmp-store";
const STORE_FILE_NAME: &str = "magnet-layout-store-v1.json";
const MAX_HISTORY_PER_SPACE: usize = 20;

const EVENT_LAYOUT_STORE_UPDATED: &str = "magnet-layout-store-updated";
const EVENT_MAGNET_LIBRARY_UPDATED: &str = "magnet-library-updated";
const EVENT_MAGNET_SPACES_UPDATED: &str = "magnet-spaces-updated";

const REQUIRED_MAGNET_IDS: [&str; 7] = [
    "drag-handle",
    "btn-minimize",
    "btn-maximize",
    "btn-close",
    "btn-window-pin",
    "btn-matrix-change",
    "btn-editor",
];

const DEFAULT_ACTIVE_MAGNET_IDS_SPACE1: [&str; 22] = [
    "drag-handle",
    "btn-minimize",
    "btn-maximize",
    "btn-close",
    "btn-window-pin",
    "btn-previous",
    "btn-play-pause",
    "btn-next",
    "btn-mode",
    "btn-volume",
    "progress-bar",
    "track-info",
    "audio-visualizer",
    "btn-editor",
    "btn-debug",
    "btn-matrix-change",
    "dsp-vst",
    "btn-play-queue",
    "btn-playlists",
    "btn-music-library",
    "navigation-page",
    "btn-back",
];

const SEED_TEMPLATE_MAIN: &str = "main";
const SEED_TEMPLATE_MUSIC_TAG_WORKBENCH: &str = "music-tag-workbench";
const SEED_TEMPLATE_PLUGIN_DEVELOPMENT_WORKSPACE: &str = "plugin-development-workspace";

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn trim_or_empty(value: &str) -> String {
    value.trim().to_string()
}

fn build_anchor(id: &str, grid_x: f64, grid_y: f64, role: &str) -> PixelAnchor {
    PixelAnchor {
        id: id.to_string(),
        grid_x,
        grid_y,
        role: role.to_string(),
    }
}

fn system_required_anchors(magnet_id: &str) -> Option<Vec<PixelAnchor>> {
    match magnet_id {
        "drag-handle" => Some(vec![
            build_anchor("left", 8.0, 0.0, "anchor"),
            build_anchor("right", 16.0, 0.0, "boundary"),
        ]),
        "btn-window-pin" => Some(vec![build_anchor("anchor", 20.0, 0.0, "anchor")]),
        "btn-minimize" => Some(vec![build_anchor("anchor", 22.0, 0.0, "anchor")]),
        "btn-maximize" => Some(vec![build_anchor("anchor", 24.0, 0.0, "anchor")]),
        "btn-close" => Some(vec![build_anchor("anchor", 26.0, 0.0, "anchor")]),
        "btn-matrix-change" => Some(vec![
            build_anchor("left", 0.0, 18.0, "anchor"),
            build_anchor("right", 2.0, 18.0, "boundary"),
        ]),
        "btn-editor" => Some(vec![build_anchor("anchor", 19.0, 18.0, "anchor")]),
        _ => None,
    }
}

fn system_space1_additional_anchors(magnet_id: &str) -> Option<Vec<PixelAnchor>> {
    match magnet_id {
        "btn-debug" => Some(vec![build_anchor("anchor", 18.0, 0.0, "anchor")]),
        "btn-back" => Some(vec![build_anchor("anchor", 6.0, 0.0, "anchor")]),
        "navigation-page" => Some(vec![
            build_anchor("top-left", 6.0, 1.0, "anchor"),
            build_anchor("top-right", 26.0, 1.0, "boundary"),
            build_anchor("bottom-left", 6.0, 17.0, "boundary"),
            build_anchor("bottom-right", 26.0, 17.0, "boundary"),
        ]),
        "audio-visualizer" => Some(vec![
            build_anchor("top-left", 0.0, 9.0, "anchor"),
            build_anchor("top-right", 5.0, 9.0, "boundary"),
            build_anchor("bottom-left", 0.0, 14.0, "boundary"),
            build_anchor("bottom-right", 5.0, 14.0, "boundary"),
        ]),
        "track-info" => Some(vec![
            build_anchor("top-left", 0.0, 15.0, "anchor"),
            build_anchor("top-right", 5.0, 15.0, "boundary"),
            build_anchor("bottom-left", 0.0, 18.0, "boundary"),
            build_anchor("bottom-right", 5.0, 18.0, "boundary"),
        ]),
        "progress-bar" => Some(vec![
            build_anchor("left", 6.0, 18.0, "anchor"),
            build_anchor("right", 26.0, 18.0, "boundary"),
        ]),
        "btn-matrix-change" => Some(vec![
            build_anchor("left", 2.0, 19.0, "anchor"),
            build_anchor("right", 4.0, 19.0, "boundary"),
        ]),
        "dsp-vst" => Some(vec![
            build_anchor("left", 6.0, 19.0, "anchor"),
            build_anchor("right", 8.0, 19.0, "boundary"),
        ]),
        "btn-previous" => Some(vec![build_anchor("anchor", 10.0, 19.0, "anchor")]),
        "btn-play-pause" => Some(vec![build_anchor("anchor", 12.0, 19.0, "anchor")]),
        "btn-next" => Some(vec![build_anchor("anchor", 14.0, 19.0, "anchor")]),
        "btn-mode" => Some(vec![build_anchor("anchor", 16.0, 19.0, "anchor")]),
        "btn-volume" => Some(vec![build_anchor("anchor", 18.0, 19.0, "anchor")]),
        "btn-editor" => Some(vec![build_anchor("anchor", 20.0, 19.0, "anchor")]),
        "btn-play-queue" => Some(vec![build_anchor("anchor", 22.0, 19.0, "anchor")]),
        "btn-playlists" => Some(vec![build_anchor("anchor", 24.0, 19.0, "anchor")]),
        "btn-music-library" => Some(vec![build_anchor("anchor", 26.0, 19.0, "anchor")]),
        _ => None,
    }
}

fn music_tag_workbench_default_anchors() -> Vec<PixelAnchor> {
    vec![
        build_anchor("top-left", 0.0, 1.0, "anchor"),
        build_anchor("top-right", 26.0, 1.0, "boundary"),
        build_anchor("bottom-left", 0.0, 17.0, "boundary"),
        build_anchor("bottom-right", 26.0, 17.0, "boundary"),
    ]
}

fn plugin_development_workspace_default_anchors() -> Vec<PixelAnchor> {
    vec![
        build_anchor("top-left", 0.0, 1.0, "anchor"),
        build_anchor("top-right", 26.0, 1.0, "boundary"),
        build_anchor("bottom-left", 0.0, 17.0, "boundary"),
        build_anchor("bottom-right", 26.0, 17.0, "boundary"),
    ]
}

fn system_anchors_for_space(space_id: &str, magnet_id: &str) -> Option<Vec<PixelAnchor>> {
    let normalized_space_id = space_id.trim();
    if normalized_space_id == "space1" {
        return system_space1_additional_anchors(magnet_id)
            .or_else(|| system_required_anchors(magnet_id));
    }

    system_required_anchors(magnet_id)
}

fn fill_system_anchors_for_active(space_id: &str, layout: &mut MagnetSpaceLayout) {
    for magnet_id in &layout.active_magnet_ids {
        if layout.anchors_by_magnet_id.contains_key(magnet_id) {
            continue;
        }
        if let Some(anchors) = system_anchors_for_space(space_id, magnet_id) {
            layout
                .anchors_by_magnet_id
                .insert(magnet_id.clone(), anchors);
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PixelAnchor {
    pub id: String,
    pub grid_x: f64,
    pub grid_y: f64,
    pub role: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetSpaceLayoutV1 {
    pub version: u32,
    pub active_magnet_ids: Vec<String>,
    pub anchors_by_magnet_id: HashMap<String, Vec<PixelAnchor>>,
}

pub type MagnetSpaceLayout = MagnetSpaceLayoutV1;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetSpacePresetV1 {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub layout: MagnetSpaceLayout,
}

pub type MagnetSpacePreset = MagnetSpacePresetV1;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetSpaceHistoryItemV1 {
    pub id: String,
    pub reason: String,
    pub created_at: i64,
    pub layout: MagnetSpaceLayout,
}

pub type MagnetSpaceHistoryItem = MagnetSpaceHistoryItemV1;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetSpace {
    pub id: String,
    pub name: String,
    pub order: i32,
    pub created_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed_template_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetSpacesStateV1 {
    pub version: u32,
    pub active_space_id: String,
    pub spaces: Vec<MagnetSpace>,
}

pub type MagnetSpacesState = MagnetSpacesStateV1;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetLayoutStoreStateV1 {
    pub version: u32,
    pub revision: u64,
    pub spaces: MagnetSpacesState,
    pub layouts_by_space_id: HashMap<String, MagnetSpaceLayout>,
    #[serde(default)]
    pub presets_by_space_id: HashMap<String, Vec<MagnetSpacePreset>>,
    #[serde(default)]
    pub history_by_space_id: HashMap<String, Vec<MagnetSpaceHistoryItem>>,
}

pub type MagnetLayoutStoreState = MagnetLayoutStoreStateV1;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetLayoutStoreBootstrapRequest {
    #[serde(default = "default_bootstrap_mode")]
    pub mode: String,
    #[serde(default)]
    pub active_space_id: String,
    pub spaces: MagnetSpacesState,
    pub layouts_by_space_id: HashMap<String, MagnetSpaceLayout>,
}

fn default_bootstrap_mode() -> String {
    "all-known-spaces".to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetLayoutStoreBootstrapResponse {
    pub did_bootstrap: bool,
    pub state: MagnetLayoutStoreState,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetLayoutStoreApplyPatchRequest {
    pub expected_revision: u64,
    pub patches: Vec<MagnetLayoutStorePatch>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetLayoutStoreApplyPatchResponse {
    pub ok: bool,
    pub state: MagnetLayoutStoreState,
    pub error: Option<MagnetLayoutStoreApplyPatchError>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetLayoutStoreApplyPatchError {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum MagnetLayoutStorePatch {
    SetActiveSpaceId {
        space_id: String,
    },
    SetSpacesState {
        spaces: MagnetSpacesState,
    },
    SetSpaceLayout {
        space_id: String,
        layout: MagnetSpaceLayout,
    },
    SetActiveMagnetIds {
        space_id: String,
        active_magnet_ids: Vec<String>,
    },
    SetMagnetActive {
        space_id: String,
        magnet_id: String,
        active: bool,
    },
    UpdateMagnetAnchors {
        space_id: String,
        magnet_id: String,
        anchors: Vec<PixelAnchor>,
    },
    UpsertSpacePreset {
        space_id: String,
        preset: MagnetSpacePreset,
    },
    DeleteSpacePreset {
        space_id: String,
        preset_id: String,
    },
    PushSpaceHistory {
        space_id: String,
        item: MagnetSpaceHistoryItem,
    },
    DeleteSpaceHistoryItem {
        space_id: String,
        history_id: String,
    },
    ClearSpaceHistory {
        space_id: String,
    },
}

fn sanitize_magnet_id_list(raw_ids: Vec<String>) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for raw_id in raw_ids {
        let id = trim_or_empty(&raw_id);
        if id.is_empty() {
            continue;
        }
        if !seen.insert(id.clone()) {
            continue;
        }
        ids.push(id);
    }

    ids
}

fn sanitize_patch_anchors(raw_anchors: Vec<PixelAnchor>) -> Vec<PixelAnchor> {
    raw_anchors
        .into_iter()
        .filter_map(|anchor| sanitize_anchor(&anchor))
        .collect()
}

fn normalize_magnet_layout_patch(patch: MagnetLayoutStorePatch) -> Option<MagnetLayoutStorePatch> {
    match patch {
        MagnetLayoutStorePatch::SetActiveSpaceId { space_id } => {
            let space_id = trim_or_empty(&space_id);
            if space_id.is_empty() {
                return None;
            }
            Some(MagnetLayoutStorePatch::SetActiveSpaceId { space_id })
        }
        MagnetLayoutStorePatch::SetSpacesState { spaces } => {
            Some(MagnetLayoutStorePatch::SetSpacesState {
                spaces: sanitize_spaces_state(&spaces),
            })
        }
        MagnetLayoutStorePatch::SetSpaceLayout { space_id, layout } => {
            let space_id = trim_or_empty(&space_id);
            if space_id.is_empty() {
                return None;
            }
            let layout = sanitize_layout_for_space(&space_id, &layout);
            Some(MagnetLayoutStorePatch::SetSpaceLayout { space_id, layout })
        }
        MagnetLayoutStorePatch::SetActiveMagnetIds {
            space_id,
            active_magnet_ids,
        } => {
            let space_id = trim_or_empty(&space_id);
            if space_id.is_empty() {
                return None;
            }
            Some(MagnetLayoutStorePatch::SetActiveMagnetIds {
                space_id,
                active_magnet_ids: sanitize_magnet_id_list(active_magnet_ids),
            })
        }
        MagnetLayoutStorePatch::SetMagnetActive {
            space_id,
            magnet_id,
            active,
        } => {
            let space_id = trim_or_empty(&space_id);
            let magnet_id = trim_or_empty(&magnet_id);
            if space_id.is_empty() || magnet_id.is_empty() {
                return None;
            }
            Some(MagnetLayoutStorePatch::SetMagnetActive {
                space_id,
                magnet_id,
                active,
            })
        }
        MagnetLayoutStorePatch::UpdateMagnetAnchors {
            space_id,
            magnet_id,
            anchors,
        } => {
            let space_id = trim_or_empty(&space_id);
            let magnet_id = trim_or_empty(&magnet_id);
            if space_id.is_empty() || magnet_id.is_empty() {
                return None;
            }
            Some(MagnetLayoutStorePatch::UpdateMagnetAnchors {
                space_id,
                magnet_id,
                anchors: sanitize_patch_anchors(anchors),
            })
        }
        MagnetLayoutStorePatch::UpsertSpacePreset { space_id, preset } => {
            let space_id = trim_or_empty(&space_id);
            if space_id.is_empty() {
                return None;
            }
            let preset = sanitize_preset(&space_id, &preset)?;
            Some(MagnetLayoutStorePatch::UpsertSpacePreset { space_id, preset })
        }
        MagnetLayoutStorePatch::DeleteSpacePreset {
            space_id,
            preset_id,
        } => {
            let space_id = trim_or_empty(&space_id);
            let preset_id = trim_or_empty(&preset_id);
            if space_id.is_empty() || preset_id.is_empty() {
                return None;
            }
            Some(MagnetLayoutStorePatch::DeleteSpacePreset {
                space_id,
                preset_id,
            })
        }
        MagnetLayoutStorePatch::PushSpaceHistory { space_id, item } => {
            let space_id = trim_or_empty(&space_id);
            if space_id.is_empty() {
                return None;
            }
            let item = sanitize_history_item(&space_id, &item)?;
            Some(MagnetLayoutStorePatch::PushSpaceHistory { space_id, item })
        }
        MagnetLayoutStorePatch::DeleteSpaceHistoryItem {
            space_id,
            history_id,
        } => {
            let space_id = trim_or_empty(&space_id);
            let history_id = trim_or_empty(&history_id);
            if space_id.is_empty() || history_id.is_empty() {
                return None;
            }
            Some(MagnetLayoutStorePatch::DeleteSpaceHistoryItem {
                space_id,
                history_id,
            })
        }
        MagnetLayoutStorePatch::ClearSpaceHistory { space_id } => {
            let space_id = trim_or_empty(&space_id);
            if space_id.is_empty() {
                return None;
            }
            Some(MagnetLayoutStorePatch::ClearSpaceHistory { space_id })
        }
    }
}

#[derive(Debug)]
pub struct MagnetLayoutStore {
    file_path: PathBuf,
    state: RwLock<MagnetLayoutStoreState>,
}

fn default_spaces_state() -> MagnetSpacesState {
    let now = now_ms();
    MagnetSpacesState {
        version: 1,
        active_space_id: "space1".to_string(),
        spaces: vec![
            MagnetSpace {
                id: "space1".to_string(),
                name: "空间1".to_string(),
                order: 1,
                created_at: now,
                seed_template_id: Some(SEED_TEMPLATE_MAIN.to_string()),
            },
            MagnetSpace {
                id: "space2".to_string(),
                name: "空间2".to_string(),
                order: 2,
                created_at: now,
                seed_template_id: Some(SEED_TEMPLATE_MUSIC_TAG_WORKBENCH.to_string()),
            },
            MagnetSpace {
                id: "space3".to_string(),
                name: "空间3".to_string(),
                order: 3,
                created_at: now,
                seed_template_id: Some(SEED_TEMPLATE_PLUGIN_DEVELOPMENT_WORKSPACE.to_string()),
            },
        ],
    }
}

fn default_layout_for_space(space_id: &str) -> MagnetSpaceLayout {
    let normalized_space_id = space_id.trim();
    let seed = if normalized_space_id == "space1" {
        DEFAULT_ACTIVE_MAGNET_IDS_SPACE1.as_slice()
    } else {
        REQUIRED_MAGNET_IDS.as_slice()
    };

    let mut active: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for raw in seed {
        let id = raw.trim();
        if id.is_empty() {
            continue;
        }
        if !seen.insert(id.to_string()) {
            continue;
        }
        active.push(id.to_string());
    }
    for required in REQUIRED_MAGNET_IDS {
        if seen.insert(required.to_string()) {
            active.push(required.to_string());
        }
    }

    let mut layout = MagnetSpaceLayout {
        version: 1,
        active_magnet_ids: active,
        anchors_by_magnet_id: HashMap::new(),
    };
    fill_system_anchors_for_active(space_id, &mut layout);
    layout
}

fn default_layout_for_seed_template(
    space_id: &str,
    seed_template_id: Option<&str>,
) -> MagnetSpaceLayout {
    let normalized_seed = seed_template_id.map(str::trim).unwrap_or("");
    match normalized_seed {
        SEED_TEMPLATE_MAIN => default_layout_for_space("space1"),
        SEED_TEMPLATE_MUSIC_TAG_WORKBENCH => {
            let mut layout = default_layout_for_space(space_id);
            let mut seen: HashSet<String> = layout.active_magnet_ids.iter().cloned().collect();
            if seen.insert("music-tag-workbench".to_string()) {
                layout
                    .active_magnet_ids
                    .push("music-tag-workbench".to_string());
            }
            layout.anchors_by_magnet_id.insert(
                "music-tag-workbench".to_string(),
                music_tag_workbench_default_anchors(),
            );
            layout
        }
        SEED_TEMPLATE_PLUGIN_DEVELOPMENT_WORKSPACE => {
            let mut layout = default_layout_for_space(space_id);
            let mut seen: HashSet<String> = layout.active_magnet_ids.iter().cloned().collect();
            if seen.insert("plugin-development-workspace".to_string()) {
                layout
                    .active_magnet_ids
                    .push("plugin-development-workspace".to_string());
            }
            layout.anchors_by_magnet_id.insert(
                "plugin-development-workspace".to_string(),
                plugin_development_workspace_default_anchors(),
            );
            layout
        }
        _ => default_layout_for_space(space_id),
    }
}

fn default_store_state() -> MagnetLayoutStoreState {
    let spaces = default_spaces_state();
    let mut layouts_by_space_id = HashMap::new();
    for space in &spaces.spaces {
        layouts_by_space_id.insert(
            space.id.clone(),
            default_layout_for_seed_template(&space.id, space.seed_template_id.as_deref()),
        );
    }
    MagnetLayoutStoreState {
        version: STORE_VERSION,
        revision: 0,
        spaces,
        layouts_by_space_id,
        presets_by_space_id: HashMap::new(),
        history_by_space_id: HashMap::new(),
    }
}

fn sanitize_preset(space_id: &str, preset: &MagnetSpacePreset) -> Option<MagnetSpacePreset> {
    let id = preset.id.trim();
    if id.is_empty() {
        return None;
    }
    let name = preset.name.trim();
    if name.is_empty() {
        return None;
    }
    let created_at = if preset.created_at > 0 {
        preset.created_at
    } else {
        now_ms()
    };
    Some(MagnetSpacePreset {
        id: id.to_string(),
        name: name.to_string(),
        created_at,
        layout: sanitize_layout_for_space(space_id, &preset.layout),
    })
}

fn sanitize_history_item(
    space_id: &str,
    item: &MagnetSpaceHistoryItem,
) -> Option<MagnetSpaceHistoryItem> {
    let id = item.id.trim();
    if id.is_empty() {
        return None;
    }
    let reason = item.reason.trim();
    if reason.is_empty() {
        return None;
    }
    let created_at = if item.created_at > 0 {
        item.created_at
    } else {
        now_ms()
    };
    Some(MagnetSpaceHistoryItem {
        id: id.to_string(),
        reason: reason.to_string(),
        created_at,
        layout: sanitize_layout_for_space(space_id, &item.layout),
    })
}

fn sanitize_spaces_state(value: &MagnetSpacesState) -> MagnetSpacesState {
    if value.version != 1 {
        return default_spaces_state();
    }

    let now = now_ms();
    let mut seen: HashSet<String> = HashSet::new();
    let mut spaces: Vec<MagnetSpace> = Vec::new();

    for entry in &value.spaces {
        let id = entry.id.trim();
        if id.is_empty() {
            continue;
        }
        if seen.contains(id) {
            continue;
        }
        seen.insert(id.to_string());

        let name_raw = entry.name.trim();
        let name = if name_raw.is_empty() {
            id.to_string()
        } else {
            name_raw.to_string()
        };

        let order = if entry.order > 0 { entry.order } else { 0 };
        let created_at = if entry.created_at > 0 {
            entry.created_at
        } else {
            now
        };
        let seed_template_id = entry.seed_template_id.as_deref().and_then(|raw| {
            let trimmed = raw.trim();
            match trimmed {
                SEED_TEMPLATE_MAIN
                | SEED_TEMPLATE_MUSIC_TAG_WORKBENCH
                | SEED_TEMPLATE_PLUGIN_DEVELOPMENT_WORKSPACE => Some(trimmed.to_string()),
                _ => None,
            }
        });

        spaces.push(MagnetSpace {
            id: id.to_string(),
            name,
            order,
            created_at,
            seed_template_id,
        });
    }

    if spaces.is_empty() {
        return default_spaces_state();
    }

    let mut ensure_default = |id: &str, name: &str, order: i32| {
        if seen.contains(id) {
            return;
        }
        seen.insert(id.to_string());
        spaces.push(MagnetSpace {
            id: id.to_string(),
            name: name.to_string(),
            order,
            created_at: now,
            seed_template_id: Some(SEED_TEMPLATE_MAIN.to_string()),
        });
    };
    ensure_default("space1", "空间1", 1);

    for (idx, space) in spaces.iter_mut().enumerate() {
        if space.order <= 0 {
            space.order = (idx as i32) + 1;
        }
        if space.created_at <= 0 {
            space.created_at = now;
        }
    }

    spaces.sort_by(|a, b| {
        a.order
            .cmp(&b.order)
            .then(a.created_at.cmp(&b.created_at))
            .then(a.id.cmp(&b.id))
    });

    let active_raw = value.active_space_id.trim();
    let active_space_id = if !active_raw.is_empty() && seen.contains(active_raw) {
        active_raw.to_string()
    } else {
        spaces
            .first()
            .map(|s| s.id.clone())
            .unwrap_or_else(|| "space1".to_string())
    };

    MagnetSpacesState {
        version: 1,
        active_space_id,
        spaces,
    }
}

fn sanitize_anchor(anchor: &PixelAnchor) -> Option<PixelAnchor> {
    let id = anchor.id.trim();
    if id.is_empty() {
        return None;
    }
    if !anchor.grid_x.is_finite() || !anchor.grid_y.is_finite() {
        return None;
    }
    let role = anchor.role.trim();
    if role != "anchor" && role != "boundary" {
        return None;
    }
    Some(PixelAnchor {
        id: id.to_string(),
        grid_x: anchor.grid_x,
        grid_y: anchor.grid_y,
        role: role.to_string(),
    })
}

fn sanitize_layout_for_space(space_id: &str, value: &MagnetSpaceLayout) -> MagnetSpaceLayout {
    if value.version != 1 {
        return default_layout_for_space(space_id);
    }

    let mut active: Vec<String> = Vec::new();
    let mut active_seen: HashSet<String> = HashSet::new();
    for raw in &value.active_magnet_ids {
        let id = raw.trim();
        if id.is_empty() {
            continue;
        }
        if active_seen.contains(id) {
            continue;
        }
        active_seen.insert(id.to_string());
        active.push(id.to_string());
    }
    for required in REQUIRED_MAGNET_IDS {
        if !active_seen.contains(required) {
            active.push(required.to_string());
        }
    }

    let mut anchors_by_magnet_id: HashMap<String, Vec<PixelAnchor>> = HashMap::new();
    for (magnet_id_raw, anchors_raw) in &value.anchors_by_magnet_id {
        let magnet_id = magnet_id_raw.trim();
        if magnet_id.is_empty() {
            continue;
        }
        let mut anchors: Vec<PixelAnchor> = Vec::new();
        for anchor in anchors_raw {
            if let Some(clean) = sanitize_anchor(anchor) {
                anchors.push(clean);
            }
        }
        if anchors.is_empty() {
            continue;
        }
        anchors_by_magnet_id.insert(magnet_id.to_string(), anchors);
    }

    // Back-compat: "SPACE" and "VST" used to be stored as single-anchor magnets in the Rust store.
    // They are now 3-wide horizontal magnets, so ensure anchors are {left,right} when loading.
    for magnet_id in ["btn-matrix-change", "dsp-vst"] {
        let existing = match anchors_by_magnet_id.get(magnet_id) {
            Some(value) => value.clone(),
            None => continue,
        };
        if existing.len() != 1 {
            continue;
        }
        let anchor = &existing[0];
        let y = anchor.grid_y;
        let mut left_x = (anchor.grid_x.round() as i32) - 1;
        let mut right_x = left_x + 2;
        if left_x < 0 {
            right_x += -left_x;
            left_x = 0;
        }
        if right_x > 26 {
            let shift = right_x - 26;
            left_x -= shift;
            right_x = 26;
        }
        if left_x < 0 {
            left_x = 0;
        }
        if right_x < left_x {
            right_x = left_x;
        }
        anchors_by_magnet_id.insert(
            magnet_id.to_string(),
            vec![
                build_anchor("left", left_x as f64, y, "anchor"),
                build_anchor("right", right_x as f64, y, "boundary"),
            ],
        );
    }

    let mut layout = MagnetSpaceLayout {
        version: 1,
        active_magnet_ids: active,
        anchors_by_magnet_id,
    };
    fill_system_anchors_for_active(space_id, &mut layout);
    layout
}

fn anchors_equal(left: &[PixelAnchor], right: &[PixelAnchor]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter().zip(right.iter()).all(|(a, b)| {
        a.id == b.id && a.grid_x == b.grid_x && a.grid_y == b.grid_y && a.role == b.role
    })
}

fn legacy_music_tag_workbench_anchor_sets() -> Vec<Vec<PixelAnchor>> {
    vec![
        vec![
            build_anchor("top-left", 0.0, 1.0, "anchor"),
            build_anchor("top-right", 9.0, 1.0, "boundary"),
            build_anchor("bottom-left", 0.0, 7.0, "boundary"),
            build_anchor("bottom-right", 9.0, 7.0, "boundary"),
        ],
        vec![
            build_anchor("top-left", 0.0, 1.0, "anchor"),
            build_anchor("top-right", 5.0, 1.0, "boundary"),
            build_anchor("bottom-left", 0.0, 7.0, "boundary"),
            build_anchor("bottom-right", 5.0, 7.0, "boundary"),
        ],
    ]
}

fn legacy_music_tag_navigation_companion_anchors() -> Vec<PixelAnchor> {
    vec![
        build_anchor("top-left", 6.0, 1.0, "anchor"),
        build_anchor("top-right", 26.0, 1.0, "boundary"),
        build_anchor("bottom-left", 6.0, 17.0, "boundary"),
        build_anchor("bottom-right", 26.0, 17.0, "boundary"),
    ]
}

fn has_active_magnet(layout: &MagnetSpaceLayout, magnet_id: &str) -> bool {
    layout.active_magnet_ids.iter().any(|id| id == magnet_id)
}

fn is_required_only_layout(layout: &MagnetSpaceLayout) -> bool {
    let required: HashSet<String> = REQUIRED_MAGNET_IDS
        .iter()
        .map(|id| id.to_string())
        .collect();
    let active: HashSet<String> = layout.active_magnet_ids.iter().cloned().collect();
    if active != required {
        return false;
    }
    layout
        .anchors_by_magnet_id
        .keys()
        .all(|magnet_id| required.contains(magnet_id))
}

fn should_upgrade_legacy_music_tag_workbench_layout(layout: &MagnetSpaceLayout) -> bool {
    if !has_active_magnet(layout, "music-tag-workbench") {
        return false;
    }

    if let Some(existing) = layout.anchors_by_magnet_id.get("music-tag-workbench") {
        for candidate in legacy_music_tag_workbench_anchor_sets() {
            if anchors_equal(existing, &candidate) {
                return true;
            }
        }
    }

    layout
        .anchors_by_magnet_id
        .get("navigation-page")
        .map(|anchors| anchors_equal(anchors, &legacy_music_tag_navigation_companion_anchors()))
        .unwrap_or(false)
}

fn migrate_legacy_music_tag_workbench_layout(layout: &mut MagnetSpaceLayout) -> bool {
    if !should_upgrade_legacy_music_tag_workbench_layout(layout) {
        return false;
    }

    layout
        .active_magnet_ids
        .retain(|id| id != "btn-back" && id != "navigation-page");
    layout.anchors_by_magnet_id.remove("btn-back");
    layout.anchors_by_magnet_id.remove("navigation-page");
    layout.anchors_by_magnet_id.insert(
        "music-tag-workbench".to_string(),
        music_tag_workbench_default_anchors(),
    );
    true
}

fn is_default_named_space(space: &MagnetSpace, id: &str, name: &str, order: i32) -> bool {
    space.id == id && space.name == name && space.order == order
}

fn contains_default_named_space(spaces: &[MagnetSpace], id: &str, name: &str, order: i32) -> bool {
    spaces
        .iter()
        .any(|space| is_default_named_space(space, id, name, order))
}

fn migrate_legacy_initial_space_templates(
    spaces: &mut MagnetSpacesState,
    layouts_by_space_id: &HashMap<String, MagnetSpaceLayout>,
) -> HashSet<String> {
    let mut seed_layout_upgrades: HashSet<String> = HashSet::new();
    for space in &mut spaces.spaces {
        if is_default_named_space(space, "space1", "空间1", 1) && space.seed_template_id.is_none()
        {
            space.seed_template_id = Some(SEED_TEMPLATE_MAIN.to_string());
        } else if is_default_named_space(space, "space2", "空间2", 2)
            && space.seed_template_id.is_none()
        {
            let layout = layouts_by_space_id.get("space2");
            if layout
                .map(|value| {
                    is_required_only_layout(value)
                        || should_upgrade_legacy_music_tag_workbench_layout(value)
                })
                .unwrap_or(true)
            {
                space.seed_template_id = Some(SEED_TEMPLATE_MUSIC_TAG_WORKBENCH.to_string());
                seed_layout_upgrades.insert(space.id.clone());
            }
        }
    }

    if spaces.spaces.iter().any(|space| space.id == "space3") {
        return seed_layout_upgrades;
    }
    if spaces.spaces.len() != 2 {
        return seed_layout_upgrades;
    }
    if !contains_default_named_space(&spaces.spaces, "space1", "空间1", 1)
        || !contains_default_named_space(&spaces.spaces, "space2", "空间2", 2)
    {
        return seed_layout_upgrades;
    }
    if layouts_by_space_id
        .get("space2")
        .map(|layout| {
            is_required_only_layout(layout)
                || should_upgrade_legacy_music_tag_workbench_layout(layout)
        })
        .unwrap_or(true)
    {
        spaces.spaces.push(MagnetSpace {
            id: "space3".to_string(),
            name: "空间3".to_string(),
            order: 3,
            created_at: now_ms(),
            seed_template_id: Some(SEED_TEMPLATE_PLUGIN_DEVELOPMENT_WORKSPACE.to_string()),
        });
        seed_layout_upgrades.insert("space3".to_string());
    }

    seed_layout_upgrades
}

fn sanitize_layout_for_space_instance(
    space: &MagnetSpace,
    value: Option<&MagnetSpaceLayout>,
    force_seed_layout: bool,
) -> MagnetSpaceLayout {
    let mut layout = if force_seed_layout {
        default_layout_for_seed_template(&space.id, space.seed_template_id.as_deref())
    } else {
        value
            .map(|layout| sanitize_layout_for_space(&space.id, layout))
            .unwrap_or_else(|| {
                default_layout_for_seed_template(&space.id, space.seed_template_id.as_deref())
            })
    };

    if migrate_legacy_music_tag_workbench_layout(&mut layout) {
        return layout;
    }

    layout
}

fn sanitize_store_state(
    spaces: &MagnetSpacesState,
    layouts_by_space_id: &HashMap<String, MagnetSpaceLayout>,
    presets_by_space_id: &HashMap<String, Vec<MagnetSpacePreset>>,
    history_by_space_id: &HashMap<String, Vec<MagnetSpaceHistoryItem>>,
) -> (
    MagnetSpacesState,
    HashMap<String, MagnetSpaceLayout>,
    HashMap<String, Vec<MagnetSpacePreset>>,
    HashMap<String, Vec<MagnetSpaceHistoryItem>>,
) {
    let mut spaces_clean = sanitize_spaces_state(spaces);
    let seed_layout_upgrades =
        migrate_legacy_initial_space_templates(&mut spaces_clean, layouts_by_space_id);
    let valid_space_ids: HashSet<String> =
        spaces_clean.spaces.iter().map(|s| s.id.clone()).collect();

    let mut layouts_clean: HashMap<String, MagnetSpaceLayout> = HashMap::new();
    for space in &spaces_clean.spaces {
        let space_id = space.id.trim();
        if space_id.is_empty() {
            continue;
        }
        let layout = sanitize_layout_for_space_instance(
            space,
            layouts_by_space_id.get(space_id),
            seed_layout_upgrades.contains(space_id),
        );
        layouts_clean.insert(space_id.to_string(), layout);
    }

    let mut presets_clean: HashMap<String, Vec<MagnetSpacePreset>> = HashMap::new();
    for space_id in &valid_space_ids {
        let list = match presets_by_space_id.get(space_id) {
            Some(value) => value,
            None => continue,
        };
        let mut seen: HashSet<String> = HashSet::new();
        let mut cleaned: Vec<MagnetSpacePreset> = Vec::new();
        for preset in list {
            let clean = match sanitize_preset(space_id, preset) {
                Some(value) => value,
                None => continue,
            };
            if seen.contains(&clean.id) {
                continue;
            }
            seen.insert(clean.id.clone());
            cleaned.push(clean);
        }
        if !cleaned.is_empty() {
            presets_clean.insert(space_id.clone(), cleaned);
        }
    }

    let mut history_clean: HashMap<String, Vec<MagnetSpaceHistoryItem>> = HashMap::new();
    for space_id in &valid_space_ids {
        let list = match history_by_space_id.get(space_id) {
            Some(value) => value,
            None => continue,
        };
        let mut seen: HashSet<String> = HashSet::new();
        let mut cleaned: Vec<MagnetSpaceHistoryItem> = Vec::new();
        for item in list {
            let clean = match sanitize_history_item(space_id, item) {
                Some(value) => value,
                None => continue,
            };
            if seen.contains(&clean.id) {
                continue;
            }
            seen.insert(clean.id.clone());
            cleaned.push(clean);
        }
        if cleaned.len() > MAX_HISTORY_PER_SPACE {
            let keep = cleaned.split_off(cleaned.len() - MAX_HISTORY_PER_SPACE);
            cleaned = keep;
        }
        if !cleaned.is_empty() {
            history_clean.insert(space_id.clone(), cleaned);
        }
    }

    (spaces_clean, layouts_clean, presets_clean, history_clean)
}

fn sanitize_bootstrap_store_state(
    request: &MagnetLayoutStoreBootstrapRequest,
) -> (
    MagnetSpacesState,
    HashMap<String, MagnetSpaceLayout>,
    HashMap<String, Vec<MagnetSpacePreset>>,
    HashMap<String, Vec<MagnetSpaceHistoryItem>>,
) {
    if request.mode != "active-only" {
        return sanitize_store_state(
            &request.spaces,
            &request.layouts_by_space_id,
            &HashMap::new(),
            &HashMap::new(),
        );
    }

    let mut spaces_clean = sanitize_spaces_state(&request.spaces);
    let seed_layout_upgrades =
        migrate_legacy_initial_space_templates(&mut spaces_clean, &request.layouts_by_space_id);
    let active_space_id = if spaces_clean
        .spaces
        .iter()
        .any(|space| space.id == spaces_clean.active_space_id)
    {
        spaces_clean.active_space_id.clone()
    } else {
        request.active_space_id.trim().to_string()
    };

    let mut layouts_clean: HashMap<String, MagnetSpaceLayout> = HashMap::new();
    if !active_space_id.is_empty() {
        let space = spaces_clean
            .spaces
            .iter()
            .find(|space| space.id == active_space_id);
        let layout = space
            .map(|space| {
                sanitize_layout_for_space_instance(
                    space,
                    request.layouts_by_space_id.get(&active_space_id),
                    seed_layout_upgrades.contains(&active_space_id),
                )
            })
            .unwrap_or_else(|| default_layout_for_space(&active_space_id));
        layouts_clean.insert(active_space_id, layout);
    }

    (spaces_clean, layouts_clean, HashMap::new(), HashMap::new())
}

fn resolve_store_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Failed to resolve appDataDir".to_string())?;
    Ok(base.join(STORE_DIR).join(STORE_FILE_NAME))
}

fn read_store_file(path: &Path) -> Result<Option<MagnetLayoutStoreState>, String> {
    let raw = match fs::read_to_string(path) {
        Ok(value) => value,
        Err(error) => {
            if error.kind() == std::io::ErrorKind::NotFound {
                return Ok(None);
            }
            return Err(format!("Failed to read store file: {error}"));
        }
    };

    let parsed: MagnetLayoutStoreState = serde_json::from_str(&raw)
        .map_err(|error| format!("Failed to parse store file: {error}"))?;
    Ok(Some(parsed))
}

fn backup_corrupt_store_file(path: &Path) {
    let suffix = now_ms();
    let backup = path.with_extension(format!("corrupt.{suffix}.json"));
    let _ = fs::rename(path, backup);
}

fn write_store_file(path: &Path, state: &MagnetLayoutStoreState) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| "Invalid store file path".to_string())?;
    fs::create_dir_all(dir).map_err(|error| format!("Failed to create store dir: {error}"))?;

    let tmp_path = path.with_extension("json.tmp");
    let contents = serde_json::to_string_pretty(state)
        .map_err(|error| format!("Failed to serialize store state: {error}"))?;

    fs::write(&tmp_path, contents)
        .map_err(|error| format!("Failed to write temp store file: {error}"))?;
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    fs::rename(&tmp_path, path).map_err(|error| format!("Failed to commit store file: {error}"))?;
    Ok(())
}

impl MagnetLayoutStore {
    pub fn new(app: &tauri::AppHandle) -> Result<Self, String> {
        let file_path = resolve_store_file_path(app)?;
        let state = match read_store_file(&file_path) {
            Ok(Some(parsed)) => parsed,
            Ok(None) => default_store_state(),
            Err(error) => {
                if file_path.exists() {
                    backup_corrupt_store_file(&file_path);
                }
                crate::backend_telemetry::warn(
                    app,
                    "magnets",
                    "magnets.layout-store.read.failed",
                    crate::backend_telemetry::BackendTelemetryOptions::new()
                        .component("MagnetLayoutStore")
                        .message(error),
                );
                default_store_state()
            }
        };

        let (spaces, layouts_by_space_id, presets_by_space_id, history_by_space_id) =
            sanitize_store_state(
                &state.spaces,
                &state.layouts_by_space_id,
                &state.presets_by_space_id,
                &state.history_by_space_id,
            );
        let mut sanitized = state;
        sanitized.version = STORE_VERSION;
        sanitized.spaces = spaces;
        sanitized.layouts_by_space_id = layouts_by_space_id;
        sanitized.presets_by_space_id = presets_by_space_id;
        sanitized.history_by_space_id = history_by_space_id;

        Ok(Self {
            file_path,
            state: RwLock::new(sanitized),
        })
    }

    pub fn get_state(&self) -> MagnetLayoutStoreState {
        self.state
            .read()
            .map(|guard| guard.clone())
            .unwrap_or_else(|_| default_store_state())
    }

    pub fn bootstrap_if_needed(
        &self,
        app: &tauri::AppHandle,
        request: MagnetLayoutStoreBootstrapRequest,
    ) -> Result<MagnetLayoutStoreBootstrapResponse, String> {
        let mut guard = self
            .state
            .write()
            .map_err(|_| "Store lock poisoned".to_string())?;

        if guard.revision > 0 {
            return Ok(MagnetLayoutStoreBootstrapResponse {
                did_bootstrap: false,
                state: guard.clone(),
            });
        }

        let (spaces, layouts_by_space_id, presets_by_space_id, history_by_space_id) =
            sanitize_bootstrap_store_state(&request);

        let next_state = MagnetLayoutStoreState {
            version: STORE_VERSION,
            revision: 1,
            spaces,
            layouts_by_space_id,
            presets_by_space_id,
            history_by_space_id,
        };

        write_store_file(&self.file_path, &next_state)?;
        *guard = next_state.clone();

        // Bootstrap implies a full layout/spaces refresh.
        emit_store_events(app, &next_state, true, true, "bootstrap");

        Ok(MagnetLayoutStoreBootstrapResponse {
            did_bootstrap: true,
            state: next_state,
        })
    }

    pub fn apply_patch(
        &self,
        app: &tauri::AppHandle,
        request: MagnetLayoutStoreApplyPatchRequest,
    ) -> Result<MagnetLayoutStoreApplyPatchResponse, String> {
        let mut guard = self
            .state
            .write()
            .map_err(|_| "Store lock poisoned".to_string())?;

        if request.expected_revision != guard.revision {
            return Ok(MagnetLayoutStoreApplyPatchResponse {
                ok: false,
                state: guard.clone(),
                error: Some(MagnetLayoutStoreApplyPatchError {
                    code: "revisionConflict".to_string(),
                    message: format!(
                        "Revision conflict: expected {}, current {}",
                        request.expected_revision, guard.revision
                    ),
                }),
            });
        }

        let mut spaces_changed = false;
        let mut layout_changed = false;
        let mut presets_changed = false;
        let mut history_changed = false;

        let mut next_spaces = guard.spaces.clone();
        let mut next_layouts = guard.layouts_by_space_id.clone();
        let mut next_presets = guard.presets_by_space_id.clone();
        let mut next_history = guard.history_by_space_id.clone();

        for patch in request
            .patches
            .into_iter()
            .filter_map(normalize_magnet_layout_patch)
        {
            match patch {
                MagnetLayoutStorePatch::SetActiveSpaceId { space_id } => {
                    if next_spaces.active_space_id != space_id {
                        next_spaces.active_space_id = space_id;
                        spaces_changed = true;
                    }
                }
                MagnetLayoutStorePatch::SetSpacesState { spaces } => {
                    next_spaces = spaces;
                    spaces_changed = true;
                }
                MagnetLayoutStorePatch::SetSpaceLayout { space_id, layout } => {
                    next_layouts.insert(space_id, layout);
                    layout_changed = true;
                }
                MagnetLayoutStorePatch::SetActiveMagnetIds {
                    space_id,
                    active_magnet_ids,
                } => {
                    let existing = next_layouts
                        .get(&space_id)
                        .cloned()
                        .unwrap_or_else(|| default_layout_for_space(&space_id));
                    let next = MagnetSpaceLayout {
                        version: 1,
                        active_magnet_ids,
                        anchors_by_magnet_id: existing.anchors_by_magnet_id,
                    };
                    next_layouts.insert(space_id, next);
                    layout_changed = true;
                }
                MagnetLayoutStorePatch::SetMagnetActive {
                    space_id,
                    magnet_id,
                    active,
                } => {
                    let mut existing = next_layouts
                        .get(&space_id)
                        .cloned()
                        .unwrap_or_else(|| default_layout_for_space(&space_id));

                    if active {
                        if !existing.active_magnet_ids.iter().any(|id| id == &magnet_id) {
                            existing.active_magnet_ids.push(magnet_id);
                        }
                    } else {
                        existing.active_magnet_ids.retain(|id| id != &magnet_id);
                    }

                    next_layouts.insert(space_id, existing);
                    layout_changed = true;
                }
                MagnetLayoutStorePatch::UpdateMagnetAnchors {
                    space_id,
                    magnet_id,
                    anchors,
                } => {
                    let mut existing = next_layouts
                        .get(&space_id)
                        .cloned()
                        .unwrap_or_else(|| default_layout_for_space(&space_id));

                    if anchors.is_empty() {
                        existing.anchors_by_magnet_id.remove(&magnet_id);
                    } else {
                        existing.anchors_by_magnet_id.insert(magnet_id, anchors);
                    }

                    next_layouts.insert(space_id, existing);
                    layout_changed = true;
                }
                MagnetLayoutStorePatch::UpsertSpacePreset { space_id, preset } => {
                    let list = next_presets.entry(space_id).or_insert_with(Vec::new);
                    if let Some(existing) = list.iter_mut().find(|p| p.id == preset.id) {
                        *existing = preset;
                    } else {
                        list.push(preset);
                    }
                    presets_changed = true;
                }
                MagnetLayoutStorePatch::DeleteSpacePreset {
                    space_id,
                    preset_id,
                } => {
                    let mut should_remove_space = false;
                    if let Some(list) = next_presets.get_mut(&space_id) {
                        let before = list.len();
                        list.retain(|p| p.id != preset_id);
                        if before != list.len() {
                            presets_changed = true;
                        }
                        if list.is_empty() {
                            should_remove_space = true;
                        }
                    }
                    if should_remove_space {
                        next_presets.remove(&space_id);
                    }
                }
                MagnetLayoutStorePatch::PushSpaceHistory { space_id, item } => {
                    let list = next_history.entry(space_id).or_insert_with(Vec::new);
                    list.push(item);
                    if list.len() > MAX_HISTORY_PER_SPACE {
                        let overflow = list.len() - MAX_HISTORY_PER_SPACE;
                        list.drain(0..overflow);
                    }
                    history_changed = true;
                }
                MagnetLayoutStorePatch::DeleteSpaceHistoryItem {
                    space_id,
                    history_id,
                } => {
                    let mut should_remove_space = false;
                    if let Some(list) = next_history.get_mut(&space_id) {
                        let before = list.len();
                        list.retain(|p| p.id != history_id);
                        if before != list.len() {
                            history_changed = true;
                        }
                        if list.is_empty() {
                            should_remove_space = true;
                        }
                    }
                    if should_remove_space {
                        next_history.remove(&space_id);
                    }
                }
                MagnetLayoutStorePatch::ClearSpaceHistory { space_id } => {
                    if next_history.remove(&space_id).is_some() {
                        history_changed = true;
                    }
                }
            }
        }

        let (spaces, layouts_by_space_id, presets_by_space_id, history_by_space_id) =
            sanitize_store_state(&next_spaces, &next_layouts, &next_presets, &next_history);

        // Normalize activeSpaceId after sanitize (must exist).
        if spaces.active_space_id != guard.spaces.active_space_id {
            spaces_changed = true;
        }

        let next_revision = guard.revision.saturating_add(1).max(1);
        let next_state = MagnetLayoutStoreState {
            version: STORE_VERSION,
            revision: next_revision,
            spaces,
            layouts_by_space_id,
            presets_by_space_id,
            history_by_space_id,
        };

        write_store_file(&self.file_path, &next_state)?;
        *guard = next_state.clone();

        let reason = request.reason.unwrap_or_else(|| "patch".to_string());
        if presets_changed {
            // Preset updates are side effects and should not imply layout/spaces changes.
            // Consumers can refresh via the always-emitted layout store updated event.
        }
        if history_changed {
            // History updates are side effects and should not imply layout/spaces changes.
            // Consumers can refresh via the always-emitted layout store updated event.
        }
        emit_store_events(app, &next_state, spaces_changed, layout_changed, &reason);

        Ok(MagnetLayoutStoreApplyPatchResponse {
            ok: true,
            state: next_state,
            error: None,
        })
    }
}

fn emit_store_events(
    app: &tauri::AppHandle,
    state: &MagnetLayoutStoreState,
    spaces_changed: bool,
    layout_changed: bool,
    reason: &str,
) {
    let payload = serde_json::json!({
        "revision": state.revision,
        "reason": reason,
    });

    let _ = app.emit_all(EVENT_LAYOUT_STORE_UPDATED, payload.clone());

    if spaces_changed {
        let _ = app.emit_all(EVENT_MAGNET_SPACES_UPDATED, payload.clone());
    }
    if layout_changed {
        let _ = app.emit_all(EVENT_MAGNET_LIBRARY_UPDATED, payload);
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn magnet_layout_store_get_state(
    store: tauri::State<'_, MagnetLayoutStore>,
) -> MagnetLayoutStoreState {
    store.get_state()
}

#[tauri::command(rename_all = "camelCase")]
pub fn magnet_layout_store_bootstrap(
    app: tauri::AppHandle,
    store: tauri::State<'_, MagnetLayoutStore>,
    request: MagnetLayoutStoreBootstrapRequest,
) -> Result<MagnetLayoutStoreBootstrapResponse, String> {
    store.bootstrap_if_needed(&app, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn magnet_layout_store_apply_patch(
    app: tauri::AppHandle,
    store: tauri::State<'_, MagnetLayoutStore>,
    request: MagnetLayoutStoreApplyPatchRequest,
) -> Result<MagnetLayoutStoreApplyPatchResponse, String> {
    store.apply_patch(&app, request)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_space1_layout_includes_system_anchors() {
        let layout = default_layout_for_space("space1");
        assert!(
            layout
                .active_magnet_ids
                .iter()
                .any(|id| id == "audio-visualizer"),
            "space1 should include default audio-visualizer"
        );
        assert!(
            layout.active_magnet_ids.iter().any(|id| id == "btn-debug"),
            "space1 should include default btn-debug"
        );

        let progress = layout
            .anchors_by_magnet_id
            .get("progress-bar")
            .expect("space1 should include system anchors for progress-bar");
        assert_eq!(progress[0].grid_x, 6.0);
        assert_eq!(progress[0].grid_y, 18.0);

        let matrix_change = layout
            .anchors_by_magnet_id
            .get("btn-matrix-change")
            .expect("space1 should include system anchors for btn-matrix-change");
        assert_eq!(matrix_change[0].grid_x, 2.0);
        assert_eq!(matrix_change[0].grid_y, 19.0);
        assert_eq!(matrix_change[1].grid_x, 4.0);
        assert_eq!(matrix_change[1].grid_y, 19.0);

        let editor = layout
            .anchors_by_magnet_id
            .get("btn-editor")
            .expect("space1 should include system anchors for btn-editor");
        assert_eq!(editor[0].grid_x, 20.0);
        assert_eq!(editor[0].grid_y, 19.0);

        let visualizer = layout
            .anchors_by_magnet_id
            .get("audio-visualizer")
            .expect("space1 should include system anchors for audio-visualizer");
        assert_eq!(visualizer[0].grid_x, 0.0);
        assert_eq!(visualizer[0].grid_y, 9.0);
    }

    #[test]
    fn default_store_seeds_initial_space_templates_without_generic_space2_semantics() {
        let generic_space2 = default_layout_for_space("space2");
        assert!(
            !generic_space2
                .active_magnet_ids
                .iter()
                .any(|id| id == "music-tag-workbench"),
            "generic non-space1 layouts should remain required-only"
        );

        let store = default_store_state();
        assert!(
            store.spaces.spaces.iter().any(|space| {
                space.id == "space3"
                    && space.seed_template_id.as_deref()
                        == Some(SEED_TEMPLATE_PLUGIN_DEVELOPMENT_WORKSPACE)
            }),
            "initial store should seed the plugin workspace instance"
        );
        assert!(
            store.layouts_by_space_id["space2"]
                .active_magnet_ids
                .iter()
                .any(|id| id == "music-tag-workbench"),
            "space2 gets MusicTag only from its initial seed template"
        );
        assert!(
            store.layouts_by_space_id["space3"]
                .active_magnet_ids
                .iter()
                .any(|id| id == "plugin-development-workspace"),
            "space3 gets plugin workspace only from its initial seed template"
        );
    }

    #[test]
    fn sanitize_spaces_state_does_not_readd_removed_non_main_spaces() {
        let mut spaces = default_spaces_state();
        spaces.spaces.retain(|space| space.id != "space3");

        let clean = sanitize_spaces_state(&spaces);

        assert_eq!(clean.spaces.len(), 2);
        assert!(
            clean.spaces.iter().all(|space| space.id != "space3"),
            "space3 should be an initial instance, not a sanitizer-enforced singleton"
        );
    }

    #[test]
    fn sanitize_store_migrates_untouched_legacy_initial_templates() {
        let now = now_ms();
        let spaces = MagnetSpacesState {
            version: 1,
            active_space_id: "space1".to_string(),
            spaces: vec![
                MagnetSpace {
                    id: "space1".to_string(),
                    name: "空间1".to_string(),
                    order: 1,
                    created_at: now,
                    seed_template_id: None,
                },
                MagnetSpace {
                    id: "space2".to_string(),
                    name: "空间2".to_string(),
                    order: 2,
                    created_at: now,
                    seed_template_id: None,
                },
            ],
        };
        let mut layouts = HashMap::new();
        layouts.insert("space1".to_string(), default_layout_for_space("space1"));
        layouts.insert("space2".to_string(), default_layout_for_space("space2"));

        let (spaces_clean, layouts_clean, _, _) =
            sanitize_store_state(&spaces, &layouts, &HashMap::new(), &HashMap::new());

        assert!(
            spaces_clean.spaces.iter().any(|space| space.id == "space3"),
            "untouched two-space seed stores should receive the new third initial instance"
        );
        assert!(
            layouts_clean["space2"]
                .active_magnet_ids
                .iter()
                .any(|id| id == "music-tag-workbench"),
            "legacy required-only space2 seed should migrate to the MusicTag template"
        );
    }

    #[test]
    fn sanitize_layout_fills_required_system_anchors() {
        let layout = MagnetSpaceLayout {
            version: 1,
            active_magnet_ids: Vec::new(),
            anchors_by_magnet_id: HashMap::new(),
        };
        let clean = sanitize_layout_for_space("space2", &layout);
        assert!(
            clean.active_magnet_ids.iter().any(|id| id == "btn-close"),
            "required magnet ids should be enforced"
        );
        assert!(
            clean.anchors_by_magnet_id.get("btn-close").is_some(),
            "required magnets should have fallback system anchors"
        );
        assert!(
            clean.anchors_by_magnet_id.get("navigation-page").is_none(),
            "non-space1 should not auto-fill non-required system anchors"
        );
    }

    #[test]
    fn patch_deserializes_camel_case_fields() {
        let json = serde_json::json!({
            "kind": "setActiveSpaceId",
            "spaceId": "space2",
        });
        let patch: MagnetLayoutStorePatch =
            serde_json::from_value(json).expect("patch should deserialize");
        match patch {
            MagnetLayoutStorePatch::SetActiveSpaceId { space_id } => {
                assert_eq!(space_id, "space2");
            }
            _ => panic!("Expected SetActiveSpaceId patch"),
        }
    }

    #[test]
    fn normalize_patch_sanitizes_set_space_layout_like_ts_layout_sanitizer() {
        let mut anchors_by_magnet_id = HashMap::new();
        anchors_by_magnet_id.insert(
            " custom-panel ".to_string(),
            vec![
                PixelAnchor {
                    id: " top-left ".to_string(),
                    grid_x: 1.0,
                    grid_y: 2.0,
                    role: " anchor ".to_string(),
                },
                PixelAnchor {
                    id: "".to_string(),
                    grid_x: 1.0,
                    grid_y: 2.0,
                    role: "anchor".to_string(),
                },
                PixelAnchor {
                    id: "bad-role".to_string(),
                    grid_x: 1.0,
                    grid_y: 2.0,
                    role: "drag".to_string(),
                },
            ],
        );

        let patch = MagnetLayoutStorePatch::SetSpaceLayout {
            space_id: " space2 ".to_string(),
            layout: MagnetSpaceLayout {
                version: 1,
                active_magnet_ids: vec![
                    " custom-panel ".to_string(),
                    "".to_string(),
                    "custom-panel".to_string(),
                ],
                anchors_by_magnet_id,
            },
        };

        let normalized = normalize_magnet_layout_patch(patch).expect("patch should normalize");

        match normalized {
            MagnetLayoutStorePatch::SetSpaceLayout { space_id, layout } => {
                assert_eq!(space_id, "space2");
                assert_eq!(layout.active_magnet_ids[0], "custom-panel");
                assert_eq!(
                    layout
                        .active_magnet_ids
                        .iter()
                        .filter(|id| id.as_str() == "custom-panel")
                        .count(),
                    1
                );
                assert!(
                    layout.active_magnet_ids.iter().any(|id| id == "btn-close"),
                    "required magnet ids should be repaired during layout normalization"
                );

                let custom_anchors = layout
                    .anchors_by_magnet_id
                    .get("custom-panel")
                    .expect("custom-panel anchors should be kept under a trimmed id");
                assert_eq!(custom_anchors.len(), 1);
                assert_eq!(custom_anchors[0].id, "top-left");
                assert_eq!(custom_anchors[0].role, "anchor");
                assert!(
                    layout.anchors_by_magnet_id.get("btn-close").is_some(),
                    "required system anchors should be filled for active required magnets"
                );
            }
            _ => panic!("Expected SetSpaceLayout patch"),
        }
    }

    #[test]
    fn normalize_patch_sanitizes_anchor_updates_and_keeps_empty_removal() {
        let patch = MagnetLayoutStorePatch::UpdateMagnetAnchors {
            space_id: " space2 ".to_string(),
            magnet_id: " custom-panel ".to_string(),
            anchors: vec![
                PixelAnchor {
                    id: "anchor".to_string(),
                    grid_x: 3.0,
                    grid_y: 4.0,
                    role: "anchor".to_string(),
                },
                PixelAnchor {
                    id: "bad-role".to_string(),
                    grid_x: 3.0,
                    grid_y: 4.0,
                    role: "control".to_string(),
                },
            ],
        };

        let normalized = normalize_magnet_layout_patch(patch).expect("patch should normalize");

        match normalized {
            MagnetLayoutStorePatch::UpdateMagnetAnchors {
                space_id,
                magnet_id,
                anchors,
            } => {
                assert_eq!(space_id, "space2");
                assert_eq!(magnet_id, "custom-panel");
                assert_eq!(anchors.len(), 1);
                assert_eq!(anchors[0].id, "anchor");
            }
            _ => panic!("Expected UpdateMagnetAnchors patch"),
        }

        let remove_patch = MagnetLayoutStorePatch::UpdateMagnetAnchors {
            space_id: "space2".to_string(),
            magnet_id: "custom-panel".to_string(),
            anchors: vec![PixelAnchor {
                id: "bad-role".to_string(),
                grid_x: 3.0,
                grid_y: 4.0,
                role: "control".to_string(),
            }],
        };

        let normalized_remove =
            normalize_magnet_layout_patch(remove_patch).expect("removal patch should normalize");
        match normalized_remove {
            MagnetLayoutStorePatch::UpdateMagnetAnchors { anchors, .. } => {
                assert!(
                    anchors.is_empty(),
                    "an anchor update with no valid anchors remains a removal patch"
                );
            }
            _ => panic!("Expected UpdateMagnetAnchors patch"),
        }
    }

    #[test]
    fn normalize_patch_drops_empty_space_or_magnet_ids() {
        assert!(
            normalize_magnet_layout_patch(MagnetLayoutStorePatch::SetActiveSpaceId {
                space_id: "   ".to_string(),
            })
            .is_none()
        );
        assert!(
            normalize_magnet_layout_patch(MagnetLayoutStorePatch::SetMagnetActive {
                space_id: "space1".to_string(),
                magnet_id: " ".to_string(),
                active: true,
            })
            .is_none()
        );
        assert!(
            normalize_magnet_layout_patch(MagnetLayoutStorePatch::ClearSpaceHistory {
                space_id: "\t".to_string(),
            })
            .is_none()
        );
    }
}
