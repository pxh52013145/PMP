use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarMediaControlPayload {
    pub action: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MouseSideButtonPayload {
    pub button: &'static str,
}

#[cfg(not(target_os = "windows"))]
pub fn init_main_window(_app: &AppHandle) {}

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::MouseSideButtonPayload;
    use super::TaskbarMediaControlPayload;
    use crate::backend_telemetry::{self, BackendTelemetryOptions};
    use crate::windows::EVENT_MOUSE_SIDE_BUTTON;
    use crate::windows::EVENT_TASKBAR_MEDIA_CONTROL;
    use once_cell::sync::{Lazy, OnceCell};
    use std::sync::atomic::{AtomicBool, Ordering};
    use tauri::{AppHandle, Manager};
    use windows::{
        core::w,
        Win32::{
            Foundation::{HWND, LPARAM, LRESULT, WPARAM},
            System::Com::{
                CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
            },
            UI::{
                Shell::{
                    DefSubclassProc, ITaskbarList3, RemoveWindowSubclass, SetWindowSubclass,
                    TaskbarList, THBF_ENABLED, THB_FLAGS, THB_ICON, THB_TOOLTIP, THUMBBUTTON,
                },
                WindowsAndMessaging::{
                    ChangeWindowMessageFilterEx, CreateIcon, RegisterWindowMessageW, HICON,
                    MSGFLT_ALLOW, WM_APPCOMMAND, WM_COMMAND, WM_NCDESTROY, WM_XBUTTONDOWN,
                    WM_XBUTTONUP,
                },
            },
        },
    };

    const TASKBAR_ICON_SIZE: usize = 16;
    const ICON_SUPERSAMPLE: usize = 4;

    const THBN_CLICKED: u32 = 0x1800;

    const BUTTON_ID_PREV: u32 = 0x9001;
    const BUTTON_ID_PLAY_PAUSE: u32 = 0x9002;
    const BUTTON_ID_NEXT: u32 = 0x9003;

    const APPCOMMAND_BROWSER_BACKWARD: u32 = 1;
    const APPCOMMAND_BROWSER_FORWARD: u32 = 2;
    const APPCOMMAND_MEDIA_NEXTTRACK: u32 = 11;
    const APPCOMMAND_MEDIA_PREVIOUSTRACK: u32 = 12;
    const APPCOMMAND_MEDIA_STOP: u32 = 13;
    const APPCOMMAND_MEDIA_PLAY_PAUSE: u32 = 14;

    static APP_HANDLE: OnceCell<AppHandle> = OnceCell::new();
    static TASKBAR_ICONS: OnceCell<TaskbarIcons> = OnceCell::new();
    static TASKBAR_BUTTON_CREATED_MSG: Lazy<u32> =
        Lazy::new(|| unsafe { RegisterWindowMessageW(w!("TaskbarButtonCreated")) });
    static PLAY_PAUSE_SHOWS_PAUSE: AtomicBool = AtomicBool::new(false);

    struct TaskbarIcons {
        previous: isize,
        play: isize,
        pause: isize,
        next: isize,
    }

    impl TaskbarIcons {
        fn previous(&self) -> HICON {
            HICON(self.previous)
        }

        fn play(&self) -> HICON {
            HICON(self.play)
        }

        fn pause(&self) -> HICON {
            HICON(self.pause)
        }

        fn next(&self) -> HICON {
            HICON(self.next)
        }
    }

    const TASKBAR_SUBCLASS_ID: usize = 0x504D_5054;

    fn utf16_tip(text: &str) -> [u16; 260] {
        let mut tip = [0u16; 260];
        let mut it = text.encode_utf16();
        for i in 0..(tip.len().saturating_sub(1)) {
            if let Some(v) = it.next() {
                tip[i] = v;
            } else {
                break;
            }
        }
        tip
    }

    unsafe fn ensure_com_initialized() {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }

    unsafe fn create_taskbar_list3() -> Result<ITaskbarList3, String> {
        ensure_com_initialized();
        let taskbar: ITaskbarList3 = CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER)
            .map_err(|e| format!("CoCreateInstance(TaskbarList) failed: {e:?}"))?;
        taskbar
            .HrInit()
            .map_err(|e| format!("ITaskbarList3::HrInit failed: {e:?}"))?;
        Ok(taskbar)
    }

    #[derive(Clone, Copy)]
    enum TaskbarIconKind {
        Previous,
        Play,
        Pause,
        Next,
    }

    fn point_in_rect(x: f32, y: f32, left: f32, top: f32, right: f32, bottom: f32) -> bool {
        x >= left && x <= right && y >= top && y <= bottom
    }

    fn point_in_triangle(x: f32, y: f32, a: (f32, f32), b: (f32, f32), c: (f32, f32)) -> bool {
        fn sign(p1: (f32, f32), p2: (f32, f32), p3: (f32, f32)) -> f32 {
            (p1.0 - p3.0) * (p2.1 - p3.1) - (p2.0 - p3.0) * (p1.1 - p3.1)
        }

        let point = (x, y);
        let d1 = sign(point, a, b);
        let d2 = sign(point, b, c);
        let d3 = sign(point, c, a);
        let has_negative = d1 < 0.0 || d2 < 0.0 || d3 < 0.0;
        let has_positive = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;

        !(has_negative && has_positive)
    }

    fn taskbar_icon_shape_contains(kind: TaskbarIconKind, x: f32, y: f32) -> bool {
        match kind {
            TaskbarIconKind::Previous => {
                point_in_rect(x, y, 3.0, 3.25, 4.75, 12.75)
                    || point_in_triangle(x, y, (13.0, 3.25), (13.0, 12.75), (5.0, 8.0))
            }
            TaskbarIconKind::Play => {
                point_in_triangle(x, y, (5.0, 3.25), (5.0, 12.75), (12.0, 8.0))
            }
            TaskbarIconKind::Pause => {
                point_in_rect(x, y, 4.5, 3.25, 6.75, 12.75)
                    || point_in_rect(x, y, 9.25, 3.25, 11.5, 12.75)
            }
            TaskbarIconKind::Next => {
                point_in_rect(x, y, 11.25, 3.25, 13.0, 12.75)
                    || point_in_triangle(x, y, (3.0, 3.25), (3.0, 12.75), (11.0, 8.0))
            }
        }
    }

    fn taskbar_icon_alpha(kind: TaskbarIconKind, x: usize, y: usize) -> u8 {
        let mut hits = 0usize;
        let samples = ICON_SUPERSAMPLE * ICON_SUPERSAMPLE;

        for sy in 0..ICON_SUPERSAMPLE {
            for sx in 0..ICON_SUPERSAMPLE {
                let fx = x as f32 + (sx as f32 + 0.5) / ICON_SUPERSAMPLE as f32;
                let fy = y as f32 + (sy as f32 + 0.5) / ICON_SUPERSAMPLE as f32;
                if taskbar_icon_shape_contains(kind, fx, fy) {
                    hits += 1;
                }
            }
        }

        ((hits * 255) / samples) as u8
    }

    unsafe fn create_taskbar_icon(kind: TaskbarIconKind) -> Result<HICON, String> {
        let and_stride = ((TASKBAR_ICON_SIZE + 31) / 32) * 4;
        let mut and_bits = vec![0u8; and_stride * TASKBAR_ICON_SIZE];
        let mut xor_bits = vec![0u8; TASKBAR_ICON_SIZE * TASKBAR_ICON_SIZE * 4];

        for y in 0..TASKBAR_ICON_SIZE {
            for x in 0..TASKBAR_ICON_SIZE {
                let alpha = taskbar_icon_alpha(kind, x, y);
                let bitmap_y = TASKBAR_ICON_SIZE - 1 - y;
                let xor_offset = (bitmap_y * TASKBAR_ICON_SIZE + x) * 4;

                xor_bits[xor_offset] = 255;
                xor_bits[xor_offset + 1] = 255;
                xor_bits[xor_offset + 2] = 255;
                xor_bits[xor_offset + 3] = alpha;

                if alpha == 0 {
                    let and_offset = bitmap_y * and_stride + x / 8;
                    and_bits[and_offset] |= 0x80 >> (x % 8);
                }
            }
        }

        CreateIcon(
            None,
            TASKBAR_ICON_SIZE as i32,
            TASKBAR_ICON_SIZE as i32,
            1,
            32,
            and_bits.as_ptr(),
            xor_bits.as_ptr(),
        )
        .map_err(|e| format!("CreateIcon(taskbar media control) failed: {e:?}"))
    }

    unsafe fn taskbar_icons() -> Result<&'static TaskbarIcons, String> {
        TASKBAR_ICONS.get_or_try_init(|| {
            Ok(TaskbarIcons {
                previous: create_taskbar_icon(TaskbarIconKind::Previous)?.0,
                play: create_taskbar_icon(TaskbarIconKind::Play)?.0,
                pause: create_taskbar_icon(TaskbarIconKind::Pause)?.0,
                next: create_taskbar_icon(TaskbarIconKind::Next)?.0,
            })
        })
    }

    fn is_pause_action(playback_state: &str) -> bool {
        matches!(playback_state.trim(), "playing" | "buffering" | "loading")
    }

    fn play_pause_button(icons: &TaskbarIcons, show_pause: bool) -> THUMBBUTTON {
        THUMBBUTTON {
            dwMask: THB_FLAGS | THB_ICON | THB_TOOLTIP,
            iId: BUTTON_ID_PLAY_PAUSE,
            iBitmap: 0,
            hIcon: if show_pause {
                icons.pause()
            } else {
                icons.play()
            },
            szTip: utf16_tip(if show_pause { "Pause" } else { "Play" }),
            dwFlags: THBF_ENABLED,
        }
    }

    unsafe fn add_buttons(hwnd: HWND) -> Result<(), String> {
        let taskbar = create_taskbar_list3()?;
        let icons = taskbar_icons()?;
        let show_pause = PLAY_PAUSE_SHOWS_PAUSE.load(Ordering::Acquire);

        let buttons = [
            THUMBBUTTON {
                dwMask: THB_FLAGS | THB_ICON | THB_TOOLTIP,
                iId: BUTTON_ID_PREV,
                iBitmap: 0,
                hIcon: icons.previous(),
                szTip: utf16_tip("Previous"),
                dwFlags: THBF_ENABLED,
            },
            play_pause_button(icons, show_pause),
            THUMBBUTTON {
                dwMask: THB_FLAGS | THB_ICON | THB_TOOLTIP,
                iId: BUTTON_ID_NEXT,
                iBitmap: 0,
                hIcon: icons.next(),
                szTip: utf16_tip("Next"),
                dwFlags: THBF_ENABLED,
            },
        ];

        taskbar
            .ThumbBarAddButtons(hwnd, &buttons)
            .map_err(|e| format!("ITaskbarList3::ThumbBarAddButtons failed: {e:?}"))
    }

    unsafe fn update_play_pause_button(hwnd: HWND, show_pause: bool) -> Result<(), String> {
        let taskbar = create_taskbar_list3()?;
        let icons = taskbar_icons()?;
        let buttons = [play_pause_button(icons, show_pause)];

        taskbar
            .ThumbBarUpdateButtons(hwnd, &buttons)
            .map_err(|e| format!("ITaskbarList3::ThumbBarUpdateButtons failed: {e:?}"))
    }

    fn emit_action(action: &'static str) {
        let Some(app) = APP_HANDLE.get() else {
            return;
        };
        backend_telemetry::debug(
            app,
            "windowing",
            "window.taskbar.media-control.received",
            BackendTelemetryOptions::new()
                .component("taskbar_thumbbar")
                .field("action", serde_json::json!(action)),
        );
        if let Err(error) = app.emit_all(
            EVENT_TASKBAR_MEDIA_CONTROL,
            TaskbarMediaControlPayload { action },
        ) {
            report_failure(
                "window.taskbar.media-control.emit.failed",
                error.to_string(),
            );
        }
    }

    fn report_failure(event: &str, error: String) {
        if let Some(app) = APP_HANDLE.get() {
            backend_telemetry::warn(
                app,
                "windowing",
                event,
                BackendTelemetryOptions::new()
                    .component("taskbar_thumbbar")
                    .message(error),
            );
        }
    }

    fn thumbbar_action(wparam: WPARAM) -> Option<&'static str> {
        let raw = wparam.0 as u32;
        if (raw >> 16) & 0xFFFF != THBN_CLICKED {
            return None;
        }
        match raw & 0xFFFF {
            BUTTON_ID_PREV => Some("previous"),
            BUTTON_ID_PLAY_PAUSE => Some("playPause"),
            BUTTON_ID_NEXT => Some("next"),
            _ => None,
        }
    }

    // Must run on the thread that owns hwnd (SetWindowSubclass is not cross-thread).
    unsafe fn install_message_handler(hwnd: HWND) -> Result<(), String> {
        let created_message = *TASKBAR_BUTTON_CREATED_MSG;
        if created_message == 0 {
            return Err("RegisterWindowMessageW(TaskbarButtonCreated) failed".into());
        }

        // Explorer normally runs at medium integrity. When the player is elevated,
        // UIPI otherwise blocks THBN_CLICKED before our subclass can see WM_COMMAND.
        // Scope the exceptions to this window and the two taskbar message types.
        for message in [WM_COMMAND, created_message] {
            ChangeWindowMessageFilterEx(hwnd, message, MSGFLT_ALLOW, None)
                .map_err(|error| format!("Allow taskbar message {message:#x} failed: {error}"))?;
        }
        if !SetWindowSubclass(hwnd, Some(taskbar_subclass_proc), TASKBAR_SUBCLASS_ID, 0).as_bool() {
            return Err("SetWindowSubclass(taskbar) failed".into());
        }
        Ok(())
    }

    fn emit_mouse_side_button(button: &'static str) {
        let Some(app) = APP_HANDLE.get() else {
            return;
        };
        let _ = app.emit_all(EVENT_MOUSE_SIDE_BUTTON, MouseSideButtonPayload { button });
    }

    unsafe extern "system" fn taskbar_subclass_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _subclass_id: usize,
        _ref_data: usize,
    ) -> LRESULT {
        if msg == *TASKBAR_BUTTON_CREATED_MSG {
            if let Err(error) = add_buttons(hwnd) {
                report_failure("window.taskbar.buttons.add.failed", error);
            }
        } else if msg == WM_COMMAND {
            if let Some(action) = thumbbar_action(wparam) {
                emit_action(action);
                return LRESULT(0);
            }
        } else if msg == WM_NCDESTROY {
            let _ = RemoveWindowSubclass(hwnd, Some(taskbar_subclass_proc), TASKBAR_SUBCLASS_ID);
        } else if msg == WM_XBUTTONDOWN {
            // HIWORD(wparam) == XBUTTON1(1) / XBUTTON2(2)
            let raw = wparam.0 as u32;
            let xbutton = (raw >> 16) & 0xFFFF;
            match xbutton {
                1 => {
                    emit_mouse_side_button("back");
                    return LRESULT(0);
                }
                2 => {
                    emit_mouse_side_button("forward");
                    return LRESULT(0);
                }
                _ => {}
            }
        } else if msg == WM_XBUTTONUP {
            // Some mouse drivers only emit XBUTTONUP; handle it the same way.
            let raw = wparam.0 as u32;
            let xbutton = (raw >> 16) & 0xFFFF;
            match xbutton {
                1 => {
                    emit_mouse_side_button("back");
                    return LRESULT(0);
                }
                2 => {
                    emit_mouse_side_button("forward");
                    return LRESULT(0);
                }
                _ => {}
            }
        } else if msg == WM_APPCOMMAND {
            // Some mice map side buttons to "browser back/forward" app commands.
            // Media keys can also arrive here when the window is focused.
            // docs: GET_APPCOMMAND_LPARAM(lparam) = HIWORD(lparam) & 0xFFF
            let raw = lparam.0 as u32;
            let command = (raw >> 16) & 0x0FFF;
            match command {
                APPCOMMAND_BROWSER_BACKWARD => {
                    emit_mouse_side_button("back");
                    return LRESULT(1);
                }
                APPCOMMAND_BROWSER_FORWARD => {
                    emit_mouse_side_button("forward");
                    return LRESULT(1);
                }
                APPCOMMAND_MEDIA_PREVIOUSTRACK => {
                    emit_action("previous");
                    return LRESULT(1);
                }
                APPCOMMAND_MEDIA_NEXTTRACK => {
                    emit_action("next");
                    return LRESULT(1);
                }
                APPCOMMAND_MEDIA_PLAY_PAUSE => {
                    emit_action("playPause");
                    return LRESULT(1);
                }
                APPCOMMAND_MEDIA_STOP => {
                    emit_action("stop");
                    return LRESULT(1);
                }
                _ => {}
            }
        }

        DefSubclassProc(hwnd, msg, wparam, lparam)
    }

    pub fn init_main_window(app: &AppHandle) {
        let _ = APP_HANDLE.set(app.clone());

        let Some(window) = app.get_window(crate::windows::MAIN_WINDOW_LABEL) else {
            return;
        };
        let Ok(hwnd) = window.hwnd() else {
            return;
        };

        let hwnd_raw = hwnd.0 as isize;
        if let Err(error) = window.run_on_main_thread(move || unsafe {
            let hwnd = HWND(hwnd_raw);
            if let Err(error) = install_message_handler(hwnd) {
                report_failure("window.taskbar.message-handler.install.failed", error);
                return;
            }
            // The shell may not be ready yet; TaskbarButtonCreated retries registration.
            let _ = add_buttons(hwnd);
        }) {
            report_failure(
                "window.taskbar.message-handler.schedule.failed",
                error.to_string(),
            );
        }
    }

    pub fn sync_from_native_audio_state(playback_state: &str) {
        let show_pause = is_pause_action(playback_state);
        let previous = PLAY_PAUSE_SHOWS_PAUSE.swap(show_pause, Ordering::AcqRel);
        if previous == show_pause {
            return;
        }

        let Some(app) = APP_HANDLE.get() else {
            return;
        };
        let Some(window) = app.get_window(crate::windows::MAIN_WINDOW_LABEL) else {
            return;
        };
        let Ok(hwnd) = window.hwnd() else {
            return;
        };

        unsafe {
            let _ = update_play_pause_button(HWND(hwnd.0 as isize), show_pause);
        }
    }

    #[cfg(test)]
    mod tests {
        use super::{taskbar_icon_shape_contains, TaskbarIconKind};

        #[test]
        fn only_known_thumbnail_clicks_are_consumed() {
            use super::*;
            for (id, action) in [
                (BUTTON_ID_PREV, "previous"),
                (BUTTON_ID_PLAY_PAUSE, "playPause"),
                (BUTTON_ID_NEXT, "next"),
            ] {
                assert_eq!(
                    thumbbar_action(WPARAM(((THBN_CLICKED << 16) | id) as usize)),
                    Some(action)
                );
                // Menus (0) and accelerators (1) can reuse the low-word ID.
                assert_eq!(thumbbar_action(WPARAM(id as usize)), None);
                assert_eq!(thumbbar_action(WPARAM(((1 << 16) | id) as usize)), None);
            }
            assert_eq!(thumbbar_action(WPARAM((THBN_CLICKED << 16) as usize)), None);
        }

        #[test]
        fn installs_handler_on_a_real_window_and_rejects_invalid_handles() {
            use super::*;
            use windows::Win32::UI::{
                Shell::GetWindowSubclass,
                WindowsAndMessaging::{CreateWindowExW, DestroyWindow},
            };

            unsafe {
                let hwnd = CreateWindowExW(
                    Default::default(),
                    w!("STATIC"),
                    w!("Taskbar handler test"),
                    Default::default(),
                    0,
                    0,
                    1,
                    1,
                    None,
                    None,
                    None,
                    None,
                );
                assert_ne!(hwnd.0, 0);
                struct TestWindow(HWND);
                impl Drop for TestWindow {
                    fn drop(&mut self) {
                        unsafe {
                            let _ = DestroyWindow(self.0);
                        }
                    }
                }
                let _window = TestWindow(hwnd);
                install_message_handler(hwnd).unwrap();
                install_message_handler(hwnd).unwrap();
                assert!(GetWindowSubclass(
                    hwnd,
                    Some(taskbar_subclass_proc),
                    TASKBAR_SUBCLASS_ID,
                    None,
                )
                .as_bool());
                assert!(install_message_handler(HWND(0)).is_err());
            }
        }

        #[test]
        fn play_and_pause_icons_are_distinct() {
            assert!(taskbar_icon_shape_contains(
                TaskbarIconKind::Play,
                10.0,
                8.0
            ));
            assert!(!taskbar_icon_shape_contains(
                TaskbarIconKind::Play,
                4.0,
                8.0
            ));

            assert!(taskbar_icon_shape_contains(
                TaskbarIconKind::Pause,
                5.5,
                8.0
            ));
            assert!(taskbar_icon_shape_contains(
                TaskbarIconKind::Pause,
                10.0,
                8.0
            ));
            assert!(!taskbar_icon_shape_contains(
                TaskbarIconKind::Pause,
                8.0,
                8.0
            ));
        }

        #[test]
        fn loading_state_shows_pause_action() {
            assert!(super::is_pause_action("playing"));
            assert!(super::is_pause_action("buffering"));
            assert!(super::is_pause_action("loading"));
            assert!(!super::is_pause_action("paused"));
            assert!(!super::is_pause_action("stopped"));
        }
    }
}

#[cfg(target_os = "windows")]
pub fn init_main_window(app: &AppHandle) {
    windows_impl::init_main_window(app);
}

#[cfg(target_os = "windows")]
pub fn sync_from_native_audio_state(playback_state: &str) {
    windows_impl::sync_from_native_audio_state(playback_state);
}
