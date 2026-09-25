use once_cell::sync::Lazy;
use std::sync::Mutex;

#[derive(Clone, Copy)]
pub enum OverlayKind {
    Editor,
    RenderAbove,
    RenderBehind,
}

impl OverlayKind {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "editor" => Ok(Self::Editor),
            "above" => Ok(Self::RenderAbove),
            "behind" => Ok(Self::RenderBehind),
            _ => Err(format!("Unknown ornaments overlay kind: {value}")),
        }
    }

    fn index(self) -> usize {
        match self {
            Self::Editor => 0,
            Self::RenderAbove => 1,
            Self::RenderBehind => 2,
        }
    }
}

#[derive(Clone, Copy, Default)]
struct OverlayState {
    generation: u64,
    ready: bool,
    presented: bool,
}

static OVERLAY_STATES: Lazy<Mutex<[OverlayState; 3]>> =
    Lazy::new(|| Mutex::new([OverlayState::default(); 3]));

pub fn begin(kind: OverlayKind) -> Result<u64, String> {
    let mut states = OVERLAY_STATES
        .lock()
        .map_err(|_| "Ornaments overlay lifecycle lock poisoned".to_string())?;
    let state = &mut states[kind.index()];
    state.generation = state.generation.wrapping_add(1);
    state.ready = false;
    state.presented = false;
    Ok(state.generation)
}

pub fn invalidate(kind: OverlayKind) -> Result<(), String> {
    begin(kind).map(|_| ())
}

pub fn generation(kind: OverlayKind) -> Result<u64, String> {
    OVERLAY_STATES
        .lock()
        .map(|states| states[kind.index()].generation)
        .map_err(|_| "Ornaments overlay lifecycle lock poisoned".to_string())
}

pub fn mark_ready(kind: OverlayKind, generation: u64) -> Result<bool, String> {
    let mut states = OVERLAY_STATES
        .lock()
        .map_err(|_| "Ornaments overlay lifecycle lock poisoned".to_string())?;
    let state = &mut states[kind.index()];
    if state.generation != generation {
        return Ok(false);
    }
    if state.ready {
        return Ok(false);
    }
    state.ready = true;
    Ok(true)
}

pub fn is_ready(kind: OverlayKind) -> Result<bool, String> {
    OVERLAY_STATES
        .lock()
        .map(|states| states[kind.index()].ready)
        .map_err(|_| "Ornaments overlay lifecycle lock poisoned".to_string())
}

pub fn is_presented(kind: OverlayKind) -> Result<bool, String> {
    OVERLAY_STATES
        .lock()
        .map(|states| states[kind.index()].presented)
        .map_err(|_| "Ornaments overlay lifecycle lock poisoned".to_string())
}

pub fn set_presented(kind: OverlayKind, presented: bool) -> Result<(), String> {
    let mut states = OVERLAY_STATES
        .lock()
        .map_err(|_| "Ornaments overlay lifecycle lock poisoned".to_string())?;
    states[kind.index()].presented = presented;
    Ok(())
}
