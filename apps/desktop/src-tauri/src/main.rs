// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu, WindowBuilder, WindowUrl,
};
mod native_audio;

// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Pixel Matrix Player!", name)
}

#[cfg(test)]
mod tests {
    use super::greet;

    #[test]
    fn greet_returns_expected_message() {
        let message = greet("Tester");
        assert_eq!(message, "Hello, Tester! Welcome to Pixel Matrix Player!");
    }
}

#[tauri::command]
async fn native_audio_load(app: tauri::AppHandle, path: Option<String>) -> Result<(), String> {
    native_audio::load(&app, path)
}

#[tauri::command]
async fn native_audio_play(app: tauri::AppHandle) -> Result<(), String> {
    native_audio::play(&app)
}

#[tauri::command]
async fn native_audio_pause(app: tauri::AppHandle) -> Result<(), String> {
    native_audio::pause(&app)
}

#[tauri::command]
async fn native_audio_stop(app: tauri::AppHandle) -> Result<(), String> {
    native_audio::stop(&app)
}

#[tauri::command]
async fn native_audio_seek(app: tauri::AppHandle, time: f64) -> Result<(), String> {
    native_audio::seek(&app, time)
}

#[tauri::command]
async fn native_audio_set_volume(app: tauri::AppHandle, volume: f32) -> Result<(), String> {
    native_audio::set_volume(&app, volume)
}

#[tauri::command]
async fn native_audio_set_mute(app: tauri::AppHandle, muted: bool) -> Result<(), String> {
    native_audio::set_mute(&app, muted)
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_set_gain(app: tauri::AppHandle, db: f32) -> Result<(), String> {
    native_audio::set_gain(&app, db)
}

#[tauri::command]
async fn native_audio_list_devices() -> Result<Vec<String>, String> {
    native_audio::list_output_devices()
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_select_device(
    app: tauri::AppHandle,
    device_name: Option<String>,
) -> Result<(), String> {
    native_audio::select_output_device(&app, device_name)
}

#[tauri::command(rename_all = "camelCase")]
async fn native_audio_sync_queue(
    app: tauri::AppHandle,
    queue: Vec<String>,
    current_index: i32,
) -> Result<(), String> {
    native_audio::sync_queue(&app, queue, current_index)
}

#[tauri::command]
async fn open_editor_window(
    app: tauri::AppHandle,
    window_type: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let label = format!("editor-{}", window_type);

    // 检查窗口是否已存在
    if let Some(existing_window) = app.get_window(&label) {
        // 优化：先尝试显示窗口，再设置焦点
        let _ = existing_window.show();
        existing_window.set_focus().map_err(|e| e.to_string())?;
        // 不再自动更新位置，保持用户移动后的窗口位置
        return Ok(());
    }

    // 创建新窗口
    let url = format!("/#/editor/{}", window_type);

    let window = WindowBuilder::new(&app, label.clone(), WindowUrl::App(url.into()))
        .title(match window_type.as_str() {
            "control" => "编辑器控制",
            "statistics" => "统计信息",
            "library" => "Magnet 库",
            "style" => "风格设置",
            "help" => "使用说明",
            "creator" => "创建/导入 Magnet",
            "background" => "背景管理",
            "custom-background" => "自定义背景",
            "debug" => "主题系统调试",
            _ => "编辑器窗口",
        })
        .inner_size(width, height)
        .position(x, y)
        .resizable(false) // 所有编辑器窗口不可调整大小，防止双击最大化
        .maximizable(false) // 禁用双击最大化
        .decorations(false) // 所有编辑器窗口无装饰
        .transparent(true) // 所有编辑器窗口透明
        .always_on_top(true)
        .build()
        .map_err(|e| e.to_string())?;

    // 如果是控制面板窗口，监听关闭事件以触发退出编辑模式
    if window_type == "control" {
        let app_handle = app.clone();
        window.on_window_event(move |event| {
             if let tauri::WindowEvent::CloseRequested { .. } = event {
                // 先关闭所有其他编辑器窗口（不包括debug，debug是独立的）
                let window_types = vec!["statistics", "library", "style", "help", "creator", "background", "custom-background"];
                for wtype in window_types {
                    let label = format!("editor-{}", wtype);
                    if let Some(w) = app_handle.get_window(&label) {
                        let _ = w.close();
                    }
                }

                // 通知主窗口退出编辑模式
                if let Some(main_window) = app_handle.get_window("main") {
                    let _ = main_window.eval("if(window.toggleEditModeFromClose){window.toggleEditModeFromClose()}");
                    let _ = main_window.eval("localStorage.setItem('pixel-matrix-exit-edit-mode', Date.now().toString())");
                }
            }
        });
    }

    Ok(())
}

#[tauri::command]
async fn close_editor_window(app: tauri::AppHandle, window_type: String) -> Result<(), String> {
    let label = format!("editor-{}", window_type);

    if let Some(window) = app.get_window(&label) {
        window.close().map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
async fn close_all_editor_windows(app: tauri::AppHandle) -> Result<(), String> {
    let window_types = vec![
        "control",
        "statistics",
        "library",
        "style",
        "help",
        "creator",
        "background",
        "custom-background",
        "debug",
    ];

    for window_type in window_types {
        let label = format!("editor-{}", window_type);
        if let Some(window) = app.get_window(&label) {
            let _ = window.close();
        }
    }

    Ok(())
}

fn main() {
    // 创建系统托盘菜单
    let show = CustomMenuItem::new("show".to_string(), "显示窗口");
    let hide = CustomMenuItem::new("hide".to_string(), "隐藏窗口");
    let quit = CustomMenuItem::new("quit".to_string(), "退出");
    let tray_menu = SystemTrayMenu::new()
        .add_item(show)
        .add_item(hide)
        .add_native_item(tauri::SystemTrayMenuItem::Separator)
        .add_item(quit);

    let system_tray = SystemTray::new().with_menu(tray_menu);

    tauri::Builder::default()
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick {
                position: _,
                size: _,
                ..
            } => {
                // 左键点击托盘图标，切换窗口显示/隐藏
                if let Some(window) = app.get_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                "show" => {
                    if let Some(window) = app.get_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "hide" => {
                    if let Some(window) = app.get_window("main") {
                        let _ = window.hide();
                    }
                }
                "quit" => {
                    std::process::exit(0);
                }
                _ => {}
            },
            _ => {}
        })
        .setup(|app| {
            let window = app.get_window("main").unwrap();

            // 开发者工具（如需要可取消注释）
            // #[cfg(debug_assertions)]
            // window.open_devtools();

            // 在 Windows 上启用透明效果
            #[cfg(target_os = "windows")]
            {
                use window_shadows::set_shadow;
                // 移除窗口阴影以获得更好的透明效果
                let _ = set_shadow(&window, false);
            }

            // 监听主窗口关闭事件，自动关闭所有编辑器子窗口
            let app_handle = app.handle();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    let window_types = vec![
                        "control",
                        "statistics",
                        "library",
                        "style",
                        "help",
                        "creator",
                        "background",
                        "custom-background",
                        "debug",
                    ];
                    for window_type in window_types {
                        let label = format!("editor-{}", window_type);
                        if let Some(window) = app_handle.get_window(&label) {
                            let _ = window.close();
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            open_editor_window,
            close_editor_window,
            close_all_editor_windows,
            native_audio_load,
            native_audio_play,
            native_audio_pause,
            native_audio_stop,
            native_audio_seek,
            native_audio_set_volume,
            native_audio_set_mute,
            native_audio_set_gain,
            native_audio_list_devices,
            native_audio_select_device,
            native_audio_sync_queue
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
