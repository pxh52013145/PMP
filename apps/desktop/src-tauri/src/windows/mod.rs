pub mod editor;
pub mod ornaments_overlay;
pub mod plugin;
pub mod vst_manager;

#[cfg(target_os = "windows")]
pub mod taskbar_thumbbar;

#[cfg(target_os = "windows")]
pub mod smtc;

pub const MAIN_WINDOW_LABEL: &str = "main";

pub const EVENT_MAIN_WINDOW_SHOWN: &str = "main-window-shown";
pub const EVENT_MAIN_WINDOW_HIDDEN: &str = "main-window-hidden";
pub const EVENT_MAIN_WINDOW_CLOSE_REQUESTED: &str = "main-window-close-requested";

pub const EVENT_EDITOR_WINDOW_SHOWN: &str = "editor-window-shown";
pub const EVENT_EDITOR_WINDOW_HIDDEN: &str = "editor-window-hidden";
pub const EVENT_EDITOR_EXIT: &str = "editor-exit";

pub const EVENT_PLUGIN_WINDOW_SHOWN: &str = "plugin-window-shown";
pub const EVENT_PLUGIN_WINDOW_HIDDEN: &str = "plugin-window-hidden";

pub const EVENT_VST_MANAGER_WINDOW_SHOWN: &str = "vst-manager-window-shown";
pub const EVENT_VST_MANAGER_WINDOW_HIDDEN: &str = "vst-manager-window-hidden";

pub const EVENT_TASKBAR_MEDIA_CONTROL: &str = "taskbar-media-control";

// Best-effort: mouse side buttons (XButton1/XButton2) captured on Windows.
pub const EVENT_MOUSE_SIDE_BUTTON: &str = "mouse-side-button";
