//! 鼠标工具 · 后端（Tauri）
//!
//! - 设备电量由构建期插件提供（`devices::PLUGINS`），命令是 `get_battery(device_id)`
//! - 只允许 HID 中断读；勿用 GetInputReport，会卡死鼠标
//! - 托盘显示电量：单击选鼠标，双击打开主窗口；关窗可隐藏到托盘
//! - 设置、更新、日志留在壳层，不做成插件

mod app_log;
mod devices;
mod plugin_sdk;
mod tray;

use devices::{get_battery, list_devices};
use tauri::Manager;
use tray::{close_behavior, set_tray_device, setup_tray};

/// 返回日志文件绝对路径，供设置页展示 / 打开目录。
#[tauri::command]
fn get_log_path() -> String {
    app_log::log_file_path().to_string_lossy().into_owned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    app_log::init();
    app_log::info("run() enter");
    // 插件、托盘、关窗拦截、命令注册
    // 主窗口默认 invisible；普通启动再 show，开机自启（--autostart）保持托盘后台
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_zustand::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            app_log::info("setup callback begin");
            if let Err(e) = setup_tray(app) {
                app_log::error(&format!("setup_tray failed: {e}"));
                return Err(e.into());
            }
            let from_autostart = std::env::args().any(|a| a == "--autostart");
            app_log::info(&format!("from_autostart={from_autostart}"));
            if !from_autostart {
                if let Some(win) = app.get_webview_window("main") {
                    match win.show() {
                        Ok(()) => app_log::info("main window shown"),
                        Err(e) => app_log::error(&format!("main window show failed: {e}")),
                    }
                    let _ = win.set_focus();
                } else {
                    app_log::warn("main webview window missing");
                }
            } else {
                app_log::info("autostart: keep window hidden, tray only");
            }
            app_log::info("setup callback ok");
            Ok(())
        })
        .on_window_event(|window, event| {
            // 设置为「隐藏到托盘」时：关窗只隐藏，进程继续跑
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if close_behavior(window.app_handle()) == "tray" {
                    app_log::info("close requested -> hide to tray");
                    let _ = window.hide();
                    api.prevent_close();
                } else {
                    app_log::info("close requested -> quit");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_battery,
            list_devices,
            get_log_path,
            set_tray_device
        ])
        .run(tauri::generate_context!());

    if let Err(e) = result {
        app_log::error(&format!("tauri run failed: {e}"));
        panic!("error while running tauri application: {e}");
    }
    app_log::info("run() exited normally");
}
