use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarMediaControlPayload {
    pub action: &'static str,
}

#[cfg(not(target_os = "windows"))]
pub fn init_main_window(_app: &AppHandle) {}

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::TaskbarMediaControlPayload;
    use crate::windows::EVENT_TASKBAR_MEDIA_CONTROL;
    use once_cell::sync::{Lazy, OnceCell};
    use std::{
        collections::HashMap,
        mem,
        sync::Mutex,
    };
    use tauri::{AppHandle, Manager};
    use windows::{
        core::w,
        Win32::{
            Foundation::{HWND, LPARAM, LRESULT, WPARAM},
            System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED},
            UI::{
                Shell::{
                    ITaskbarList3, TaskbarList, THUMBBUTTON, THB_FLAGS, THB_ICON, THB_TOOLTIP,
                    THBF_ENABLED,
                },
                WindowsAndMessaging::{
                    CallWindowProcW, DefWindowProcW, GetWindowLongPtrW, LoadIconW,
                    RegisterWindowMessageW, SetWindowLongPtrW, GWLP_WNDPROC, IDI_APPLICATION,
                    WM_COMMAND, WNDPROC,
                },
            },
        },
    };

    const THBN_CLICKED: u32 = 0x1800;

    const BUTTON_ID_PREV: u32 = 0x9001;
    const BUTTON_ID_PLAY_PAUSE: u32 = 0x9002;
    const BUTTON_ID_NEXT: u32 = 0x9003;

    static APP_HANDLE: OnceCell<AppHandle> = OnceCell::new();
    static TASKBAR_BUTTON_CREATED_MSG: Lazy<u32> = Lazy::new(|| {
        unsafe { RegisterWindowMessageW(w!("TaskbarButtonCreated")) }
    });

    #[derive(Default)]
    struct WndProcRegistry {
        original: HashMap<isize, isize>,
    }

    static WNDPROCS: Lazy<Mutex<WndProcRegistry>> = Lazy::new(|| Mutex::new(WndProcRegistry::default()));

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
        let taskbar: ITaskbarList3 =
            CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER)
                .map_err(|e| format!("CoCreateInstance(TaskbarList) failed: {e:?}"))?;
        taskbar
            .HrInit()
            .map_err(|e| format!("ITaskbarList3::HrInit failed: {e:?}"))?;
        Ok(taskbar)
    }

    unsafe fn add_buttons(hwnd: HWND) -> Result<(), String> {
        let taskbar = create_taskbar_list3()?;

        let icon = LoadIconW(None, IDI_APPLICATION)
            .map_err(|e| format!("LoadIconW(IDI_APPLICATION) failed: {e:?}"))?;

        let buttons = [
            THUMBBUTTON {
                dwMask: THB_FLAGS | THB_ICON | THB_TOOLTIP,
                iId: BUTTON_ID_PREV,
                iBitmap: 0,
                hIcon: icon,
                szTip: utf16_tip("Previous"),
                dwFlags: THBF_ENABLED,
            },
            THUMBBUTTON {
                dwMask: THB_FLAGS | THB_ICON | THB_TOOLTIP,
                iId: BUTTON_ID_PLAY_PAUSE,
                iBitmap: 0,
                hIcon: icon,
                szTip: utf16_tip("Play/Pause"),
                dwFlags: THBF_ENABLED,
            },
            THUMBBUTTON {
                dwMask: THB_FLAGS | THB_ICON | THB_TOOLTIP,
                iId: BUTTON_ID_NEXT,
                iBitmap: 0,
                hIcon: icon,
                szTip: utf16_tip("Next"),
                dwFlags: THBF_ENABLED,
            },
        ];

        taskbar
            .ThumbBarAddButtons(hwnd, &buttons)
            .map_err(|e| format!("ITaskbarList3::ThumbBarAddButtons failed: {e:?}"))
    }

    fn emit_action(action: &'static str) {
        let Some(app) = APP_HANDLE.get() else {
            return;
        };
        let _ = app.emit_all(EVENT_TASKBAR_MEDIA_CONTROL, TaskbarMediaControlPayload { action });
    }

    unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if msg == *TASKBAR_BUTTON_CREATED_MSG {
            let _ = add_buttons(hwnd);
        } else if msg == WM_COMMAND {
            let raw = wparam.0 as u32;
            let id = raw & 0xFFFF;
            let code = (raw >> 16) & 0xFFFF;
            if code == THBN_CLICKED {
                match id {
                    BUTTON_ID_PREV => emit_action("previous"),
                    BUTTON_ID_PLAY_PAUSE => emit_action("playPause"),
                    BUTTON_ID_NEXT => emit_action("next"),
                    _ => {}
                }
            }
        }

        let original = {
            let registry = WNDPROCS.lock().ok();
            registry
                .and_then(|r| r.original.get(&(hwnd.0 as isize)).copied())
                .unwrap_or(0)
        };
        if original == 0 {
            return DefWindowProcW(hwnd, msg, wparam, lparam);
        }
        CallWindowProcW(mem::transmute::<isize, WNDPROC>(original), hwnd, msg, wparam, lparam)
    }

    pub fn init_main_window(app: &AppHandle) {
        let _ = APP_HANDLE.set(app.clone());

        let Some(window) = app.get_window(crate::windows::MAIN_WINDOW_LABEL) else {
            return;
        };
        let Ok(hwnd) = window.hwnd() else {
            return;
        };

        unsafe {
            let hwnd_raw = HWND(hwnd.0 as isize);
            let mut registry = match WNDPROCS.lock() {
                Ok(r) => r,
                Err(_) => return,
            };

            if registry.original.contains_key(&(hwnd_raw.0 as isize)) {
                let _ = add_buttons(hwnd_raw);
                return;
            }

            let original = GetWindowLongPtrW(hwnd_raw, GWLP_WNDPROC);
            registry.original.insert(hwnd_raw.0 as isize, original);
            drop(registry);

            let _ = SetWindowLongPtrW(hwnd_raw, GWLP_WNDPROC, wnd_proc as isize);

            let _ = add_buttons(hwnd_raw);
        }
    }
}

#[cfg(target_os = "windows")]
pub fn init_main_window(app: &AppHandle) {
    windows_impl::init_main_window(app);
}
