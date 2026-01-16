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

const DEFAULT_ACTIVE_MAGNET_IDS_SPACE1: [&str; 20] = [
    "drag-handle",
    "btn-minimize",
    "btn-maximize",
    "btn-close",
    "btn-window-pin",
    "btn-matrix-change",
    "btn-editor",
    "dsp-vst",
    "navigation-page",
    "btn-back",
    "btn-play-pause",
    "btn-previous",
    "btn-next",
    "btn-mode",
    "btn-volume",
    "progress-bar",
    "track-info",
    "btn-play-queue",
    "btn-playlists",
    "btn-music-library",
];

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
        "btn-matrix-change" => Some(vec![build_anchor("anchor", 0.0, 18.0, "anchor")]),
        "btn-editor" => Some(vec![build_anchor("anchor", 19.0, 18.0, "anchor")]),
        _ => None,
    }
}

fn system_space1_additional_anchors(magnet_id: &str) -> Option<Vec<PixelAnchor>> {
    match magnet_id {
        "btn-back" => Some(vec![build_anchor("anchor", 6.0, 0.0, "anchor")]),
        "navigation-page" => Some(vec![
            build_anchor("top-left", 6.0, 1.0, "anchor"),
            build_anchor("top-right", 26.0, 1.0, "boundary"),
            build_anchor("bottom-left", 6.0, 17.0, "boundary"),
            build_anchor("bottom-right", 26.0, 17.0, "boundary"),
        ]),
        "track-info" => Some(vec![
            build_anchor("top-left", 0.0, 14.0, "anchor"),
            build_anchor("top-right", 5.0, 14.0, "boundary"),
            build_anchor("bottom-left", 0.0, 17.0, "boundary"),
            build_anchor("bottom-right", 5.0, 17.0, "boundary"),
        ]),
        "progress-bar" => Some(vec![
            build_anchor("left", 0.0, 19.0, "anchor"),
            build_anchor("right", 26.0, 19.0, "boundary"),
        ]),
        "btn-previous" => Some(vec![build_anchor("anchor", 9.0, 18.0, "anchor")]),
        "btn-play-pause" => Some(vec![build_anchor("anchor", 11.0, 18.0, "anchor")]),
        "btn-next" => Some(vec![build_anchor("anchor", 13.0, 18.0, "anchor")]),
        "btn-mode" => Some(vec![build_anchor("anchor", 15.0, 18.0, "anchor")]),
        "btn-volume" => Some(vec![build_anchor("anchor", 17.0, 18.0, "anchor")]),
        "dsp-vst" => Some(vec![build_anchor("anchor", 6.0, 18.0, "anchor")]),
        "btn-play-queue" => Some(vec![build_anchor("anchor", 21.0, 18.0, "anchor")]),
        "btn-playlists" => Some(vec![build_anchor("anchor", 23.0, 18.0, "anchor")]),
        "btn-music-library" => Some(vec![build_anchor("anchor", 25.0, 18.0, "anchor")]),
        _ => None,
    }
}

fn system_anchors_for_space(space_id: &str, magnet_id: &str) -> Option<Vec<PixelAnchor>> {
    let normalized_space_id = space_id.trim();
    if normalized_space_id == "space1" {
        return system_space1_additional_anchors(magnet_id).or_else(|| system_required_anchors(magnet_id));
    }

    system_required_anchors(magnet_id)
}

fn fill_system_anchors_for_active(space_id: &str, layout: &mut MagnetSpaceLayout) {
    for magnet_id in &layout.active_magnet_ids {
        if layout.anchors_by_magnet_id.contains_key(magnet_id) {
            continue;
        }
        if let Some(anchors) = system_anchors_for_space(space_id, magnet_id) {
            layout.anchors_by_magnet_id.insert(magnet_id.clone(), anchors);
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
    pub spaces: MagnetSpacesState,
    pub layouts_by_space_id: HashMap<String, MagnetSpaceLayout>,
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
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MagnetLayoutStorePatch {
    SetActiveSpaceId { space_id: String },
    SetSpacesState { spaces: MagnetSpacesState },
    SetSpaceLayout { space_id: String, layout: MagnetSpaceLayout },
    SetActiveMagnetIds { space_id: String, active_magnet_ids: Vec<String> },
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
            },
            MagnetSpace {
                id: "space2".to_string(),
                name: "空间2".to_string(),
                order: 2,
                created_at: now,
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

fn default_store_state() -> MagnetLayoutStoreState {
    let spaces = default_spaces_state();
    let mut layouts_by_space_id = HashMap::new();
    for space in &spaces.spaces {
        layouts_by_space_id.insert(space.id.clone(), default_layout_for_space(&space.id));
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

fn sanitize_history_item(space_id: &str, item: &MagnetSpaceHistoryItem) -> Option<MagnetSpaceHistoryItem> {
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
        let created_at = if entry.created_at > 0 { entry.created_at } else { now };

        spaces.push(MagnetSpace {
            id: id.to_string(),
            name,
            order,
            created_at,
        });
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
        });
    };
    ensure_default("space1", "空间1", 1);
    ensure_default("space2", "空间2", 2);

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

    let mut layout = MagnetSpaceLayout {
        version: 1,
        active_magnet_ids: active,
        anchors_by_magnet_id,
    };
    fill_system_anchors_for_active(space_id, &mut layout);
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
    let spaces_clean = sanitize_spaces_state(spaces);
    let valid_space_ids: HashSet<String> = spaces_clean.spaces.iter().map(|s| s.id.clone()).collect();

    let mut layouts_clean: HashMap<String, MagnetSpaceLayout> = HashMap::new();
    for space in &spaces_clean.spaces {
        let space_id = space.id.trim();
        if space_id.is_empty() {
            continue;
        }
        let layout = layouts_by_space_id
            .get(space_id)
            .map(|value| sanitize_layout_for_space(space_id, value))
            .unwrap_or_else(|| default_layout_for_space(space_id));
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

    fs::write(&tmp_path, contents).map_err(|error| format!("Failed to write temp store file: {error}"))?;
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
                eprintln!("[magnet_layout_store] {error}");
                default_store_state()
            }
        };

        let (spaces, layouts_by_space_id, presets_by_space_id, history_by_space_id) = sanitize_store_state(
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

        let (spaces, layouts_by_space_id, presets_by_space_id, history_by_space_id) = sanitize_store_state(
            &request.spaces,
            &request.layouts_by_space_id,
            &HashMap::new(),
            &HashMap::new(),
        );

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

        for patch in request.patches {
            match patch {
                MagnetLayoutStorePatch::SetActiveSpaceId { space_id } => {
                    let trimmed = trim_or_empty(&space_id);
                    if trimmed.is_empty() {
                        continue;
                    }
                    if next_spaces.active_space_id != trimmed {
                        next_spaces.active_space_id = trimmed;
                        spaces_changed = true;
                    }
                }
                MagnetLayoutStorePatch::SetSpacesState { spaces } => {
                    next_spaces = spaces;
                    spaces_changed = true;
                }
                MagnetLayoutStorePatch::SetSpaceLayout { space_id, layout } => {
                    let trimmed = trim_or_empty(&space_id);
                    if trimmed.is_empty() {
                        continue;
                    }
                    next_layouts.insert(trimmed, layout);
                    layout_changed = true;
                }
                MagnetLayoutStorePatch::SetActiveMagnetIds {
                    space_id,
                    active_magnet_ids,
                } => {
                    let trimmed_space_id = trim_or_empty(&space_id);
                    if trimmed_space_id.is_empty() {
                        continue;
                    }
                    let existing = next_layouts
                        .get(&trimmed_space_id)
                        .cloned()
                        .unwrap_or_else(|| default_layout_for_space(&trimmed_space_id));
                    let next = MagnetSpaceLayout {
                        version: 1,
                        active_magnet_ids,
                        anchors_by_magnet_id: existing.anchors_by_magnet_id,
                    };
                    next_layouts.insert(trimmed_space_id, next);
                    layout_changed = true;
                }
                MagnetLayoutStorePatch::SetMagnetActive {
                    space_id,
                    magnet_id,
                    active,
                } => {
                    let trimmed_space_id = trim_or_empty(&space_id);
                    let trimmed_magnet_id = trim_or_empty(&magnet_id);
                    if trimmed_space_id.is_empty() || trimmed_magnet_id.is_empty() {
                        continue;
                    }
                    let mut existing = next_layouts
                        .get(&trimmed_space_id)
                        .cloned()
                        .unwrap_or_else(|| default_layout_for_space(&trimmed_space_id));

                    if active {
                        if !existing.active_magnet_ids.iter().any(|id| id == &trimmed_magnet_id) {
                            existing.active_magnet_ids.push(trimmed_magnet_id);
                        }
                    } else {
                        existing
                            .active_magnet_ids
                            .retain(|id| id != &trimmed_magnet_id);
                    }

                    next_layouts.insert(trimmed_space_id, existing);
                    layout_changed = true;
                }
                MagnetLayoutStorePatch::UpdateMagnetAnchors {
                    space_id,
                    magnet_id,
                    anchors,
                } => {
                    let trimmed_space_id = trim_or_empty(&space_id);
                    let trimmed_magnet_id = trim_or_empty(&magnet_id);
                    if trimmed_space_id.is_empty() || trimmed_magnet_id.is_empty() {
                        continue;
                    }

                    let mut existing = next_layouts
                        .get(&trimmed_space_id)
                        .cloned()
                        .unwrap_or_else(|| default_layout_for_space(&trimmed_space_id));

                    let mut clean_anchors: Vec<PixelAnchor> = Vec::new();
                    for anchor in anchors {
                        if let Some(clean) = sanitize_anchor(&anchor) {
                            clean_anchors.push(clean);
                        }
                    }

                    if clean_anchors.is_empty() {
                        existing.anchors_by_magnet_id.remove(&trimmed_magnet_id);
                    } else {
                        existing
                            .anchors_by_magnet_id
                            .insert(trimmed_magnet_id, clean_anchors);
                    }

                    next_layouts.insert(trimmed_space_id, existing);
                    layout_changed = true;
                }
                MagnetLayoutStorePatch::UpsertSpacePreset { space_id, preset } => {
                    let trimmed_space_id = trim_or_empty(&space_id);
                    if trimmed_space_id.is_empty() {
                        continue;
                    }
                    let clean = match sanitize_preset(&trimmed_space_id, &preset) {
                        Some(value) => value,
                        None => continue,
                    };
                    let list = next_presets.entry(trimmed_space_id).or_insert_with(Vec::new);
                    if let Some(existing) = list.iter_mut().find(|p| p.id == clean.id) {
                        *existing = clean;
                    } else {
                        list.push(clean);
                    }
                    presets_changed = true;
                }
                MagnetLayoutStorePatch::DeleteSpacePreset { space_id, preset_id } => {
                    let trimmed_space_id = trim_or_empty(&space_id);
                    let trimmed_preset_id = trim_or_empty(&preset_id);
                    if trimmed_space_id.is_empty() || trimmed_preset_id.is_empty() {
                        continue;
                    }
                    let mut should_remove_space = false;
                    if let Some(list) = next_presets.get_mut(&trimmed_space_id) {
                        let before = list.len();
                        list.retain(|p| p.id != trimmed_preset_id);
                        if before != list.len() {
                            presets_changed = true;
                        }
                        if list.is_empty() {
                            should_remove_space = true;
                        }
                    }
                    if should_remove_space {
                        next_presets.remove(&trimmed_space_id);
                    }
                }
                MagnetLayoutStorePatch::PushSpaceHistory { space_id, item } => {
                    let trimmed_space_id = trim_or_empty(&space_id);
                    if trimmed_space_id.is_empty() {
                        continue;
                    }
                    let clean = match sanitize_history_item(&trimmed_space_id, &item) {
                        Some(value) => value,
                        None => continue,
                    };
                    let list = next_history
                        .entry(trimmed_space_id)
                        .or_insert_with(Vec::new);
                    list.push(clean);
                    if list.len() > MAX_HISTORY_PER_SPACE {
                        let overflow = list.len() - MAX_HISTORY_PER_SPACE;
                        list.drain(0..overflow);
                    }
                    history_changed = true;
                }
                MagnetLayoutStorePatch::DeleteSpaceHistoryItem { space_id, history_id } => {
                    let trimmed_space_id = trim_or_empty(&space_id);
                    let trimmed_history_id = trim_or_empty(&history_id);
                    if trimmed_space_id.is_empty() || trimmed_history_id.is_empty() {
                        continue;
                    }
                    let mut should_remove_space = false;
                    if let Some(list) = next_history.get_mut(&trimmed_space_id) {
                        let before = list.len();
                        list.retain(|p| p.id != trimmed_history_id);
                        if before != list.len() {
                            history_changed = true;
                        }
                        if list.is_empty() {
                            should_remove_space = true;
                        }
                    }
                    if should_remove_space {
                        next_history.remove(&trimmed_space_id);
                    }
                }
                MagnetLayoutStorePatch::ClearSpaceHistory { space_id } => {
                    let trimmed_space_id = trim_or_empty(&space_id);
                    if trimmed_space_id.is_empty() {
                        continue;
                    }
                    if next_history.remove(&trimmed_space_id).is_some() {
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
pub fn magnet_layout_store_get_state(store: tauri::State<'_, MagnetLayoutStore>) -> MagnetLayoutStoreState {
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
            layout.active_magnet_ids.iter().any(|id| id == "navigation-page"),
            "space1 should include default navigation-page"
        );
        assert!(
            layout.anchors_by_magnet_id.get("navigation-page").is_some(),
            "space1 should include system anchors for navigation-page"
        );
        assert!(
            layout.anchors_by_magnet_id.get("progress-bar").is_some(),
            "space1 should include system anchors for progress-bar"
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
}
