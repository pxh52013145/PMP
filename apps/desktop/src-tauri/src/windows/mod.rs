pub mod editor;

#[cfg(target_os = "windows")]
pub mod taskbar_thumbbar;

pub const MAIN_WINDOW_LABEL: &str = "main";

pub const EVENT_MAIN_WINDOW_SHOWN: &str = "main-window-shown";
pub const EVENT_MAIN_WINDOW_HIDDEN: &str = "main-window-hidden";

pub const EVENT_EDITOR_WINDOW_SHOWN: &str = "editor-window-shown";
pub const EVENT_EDITOR_WINDOW_HIDDEN: &str = "editor-window-hidden";
pub const EVENT_EDITOR_EXIT: &str = "editor-exit";

pub const EVENT_TASKBAR_MEDIA_CONTROL: &str = "taskbar-media-control";
