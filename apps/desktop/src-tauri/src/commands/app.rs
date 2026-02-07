use crate::app_runtime;
use tauri::Manager;

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Pixel Matrix Player!", name)
}

#[tauri::command]
pub fn app_request_exit(app: tauri::AppHandle) {
    app_runtime::request_app_exit(&app);
}

#[tauri::command]
pub fn app_restart(app: tauri::AppHandle) {
    tauri::api::process::restart(&app.env());
}
