//! 鼠标工具 · 后端（Tauri）
//!
//! - 通过 HID 被动读取雷柏 VT9 AIR 电量（勿用 GetInputReport，会卡死鼠标）
//! - 系统托盘 + 关闭窗口行为（退出 / 隐藏到托盘）由前端 zustand 设置驱动

use tauri::Manager;
use hidapi::HidApi;
use serde::Serialize;
use std::collections::HashSet;
use std::time::{Duration, Instant};

const RAPOO_VID: u16 = 0x24ae;
const CANDIDATE_PIDS: &[u16] = &[0x1200, 0x4400];
const REPORT_BB: u8 = 0xBB;
const REPORT_BC: u8 = 0xBC;
/// 官方软件挂起中断读时，设备约每 3 秒推一次 BB；我们最多等这么久。
const LISTEN_FOR: Duration = Duration::from_millis(4500);

/// 电量读取结果，经 `get_battery` 命令返回前端。
#[derive(Serialize, Clone)]
struct BatteryInfo {
    percent: Option<u8>,
    charging: Option<bool>,
    connected: bool,
    device: String,
    detail: String,
}

/// 前端调用的电量命令；HID 同步 IO 放到阻塞线程，避免卡住 UI。
#[tauri::command]
async fn get_battery() -> BatteryInfo {
    match tauri::async_runtime::spawn_blocking(read_vt9_battery).await {
        Ok(Ok(info)) => info,
        Ok(Err(err)) => BatteryInfo {
            percent: None,
            charging: None,
            connected: false,
            device: "VT9 AIR".into(),
            detail: err,
        },
        Err(e) => BatteryInfo {
            percent: None,
            charging: None,
            connected: false,
            device: "VT9 AIR".into(),
            detail: format!("读取任务失败: {e}"),
        },
    }
}

/// 打开厂商 HID 集合，仅被动 `read_timeout` 等 0xBB 报告。
fn read_vt9_battery() -> Result<BatteryInfo, String> {
    let api = HidApi::new().map_err(|e| format!("hidapi 初始化失败: {e}"))?;

    let mut seen = HashSet::new();
    let mut iface_summary = Vec::new();
    let mut vendor_paths = Vec::new();

    for device in api.device_list() {
        if device.vendor_id() != RAPOO_VID || !CANDIDATE_PIDS.contains(&device.product_id()) {
            continue;
        }
        let pid = device.product_id();
        let iface = device.interface_number();
        let usage_page = device.usage_page();
        let usage = device.usage();
        let path = device.path().to_string_lossy().into_owned();
        iface_summary.push(format!(
            "pid={pid:04X} if={iface} up=0x{usage_page:04X} u=0x{usage:04X}"
        ));
        // 厂商页 FF00 / usage 0002：电量所在集合
        if usage_page == 0xFF00 && usage == 0x0002 && seen.insert(path.clone()) {
            vendor_paths.push((pid, iface, path));
        }
    }

    let summary = iface_summary.join("; ");
    if iface_summary.is_empty() {
        return Ok(BatteryInfo {
            percent: None,
            charging: None,
            connected: false,
            device: "VT9 AIR".into(),
            detail: "未找到 Rapoo 接收器。若刚卡死过，请拔插接收器。".into(),
        });
    }
    if vendor_paths.is_empty() {
        return Ok(BatteryInfo {
            percent: None,
            charging: None,
            connected: true,
            device: format!("Rapoo {:04X}:1200", RAPOO_VID),
            detail: format!("没有 FF00/0002 集合。接口: {summary}"),
        });
    }

    for (pid, iface, path) in vendor_paths {
        let c_path = match std::ffi::CString::new(path) {
            Ok(p) => p,
            Err(_) => continue,
        };
        let device = match api.open_path(c_path.as_c_str()) {
            Ok(d) => d,
            Err(e) => {
                return Ok(BatteryInfo {
                    percent: None,
                    charging: None,
                    connected: true,
                    device: format!("Rapoo {RAPOO_VID:04X}:{pid:04X}"),
                    detail: format!("打开失败: {e} · 接口: {summary}"),
                });
            }
        };

        let mut desc = [0u8; 64];
        let n = device.get_report_descriptor(&mut desc).unwrap_or(0).min(desc.len());
        let desc = &desc[..n];
        let has_bb = desc.windows(2).any(|w| w == [0x85, REPORT_BB]);
        let has_bc = desc.windows(2).any(|w| w == [0x85, REPORT_BC]);
        if has_bc && !has_bb {
            drop(device);
            continue;
        }
        if !has_bb {
            drop(device);
            continue;
        }

        // 抓包结论：只挂中断读（EP 0x84），设备推 `bb … pct`。
        // 切勿 GetInputReport / Feature 刷控制传输，会导致鼠标卡死（0x1F）。
        let mut buf = [0u8; 64];
        let deadline = Instant::now() + LISTEN_FOR;
        while Instant::now() < deadline {
            let ms = deadline
                .saturating_duration_since(Instant::now())
                .as_millis()
                .min(200) as i32;
            if ms <= 0 {
                break;
            }
            match device.read_timeout(&mut buf, ms) {
                Ok(n) if n > 0 => {
                    if let Some(percent) = parse_bb(&buf[..n]) {
                        let hex = to_hex(&buf[..n.min(12)]);
                        drop(device);
                        return Ok(BatteryInfo {
                            percent: Some(percent),
                            charging: None,
                            connected: true,
                            device: format!("Rapoo {RAPOO_VID:04X}:{pid:04X} iface={iface}"),
                            detail: format!("中断 IN(抓包同款 EP0x84) · {hex}"),
                        });
                    }
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        drop(device);

        return Ok(BatteryInfo {
            percent: None,
            charging: None,
            connected: true,
            device: format!("Rapoo {RAPOO_VID:04X}:{pid:04X}"),
            detail: format!(
                "已挂起中断读 {LISTEN_MS}ms，未收到 0xBB。抓包里官方软件运行时约每 3 秒会推 bb…pct。可再点刷新等满约 4.5 秒。接口: {summary}",
                LISTEN_MS = LISTEN_FOR.as_millis()
            ),
        });
    }

    Ok(BatteryInfo {
        percent: None,
        charging: None,
        connected: true,
        device: "VT9 AIR".into(),
        detail: format!("未找到含 Report 0xBB 的集合。接口: {summary}"),
    })
}

fn to_hex(data: &[u8]) -> String {
    data.iter()
        .map(|b| format!("{b:02x}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_bb(data: &[u8]) -> Option<u8> {
    if data.is_empty() || data[0] != REPORT_BB {
        return None;
    }
    // 抓包样例：bb b0 51 c4 09 01 38 → 电量在第 7 字节（56%）
    if data.len() >= 7 {
        let percent = data[6];
        if percent <= 100 {
            return Some(percent);
        }
    }
    None
}


/// 从托盘恢复并聚焦主窗口。
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 读取前端持久化的关闭行为：`quit` | `tray`（默认托盘）。
fn close_behavior(app: &tauri::AppHandle) -> String {
    use tauri_plugin_zustand::ManagerExt;
    app.zustand()
        .get_or::<String>("settings", "closeBehavior", "tray".into())
}

/// 创建托盘：左键显示窗口；菜单可显示 / 退出。
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let Some(icon) = app.default_window_icon().cloned() else {
        eprintln!("no default window icon; skip tray");
        return Ok(());
    };

    TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("鼠标工具")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 插件、托盘、关窗拦截、命令注册
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_zustand::init())
        .setup(|app| {
            setup_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // 设置为「隐藏到托盘」时：关窗只隐藏，进程继续跑
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if close_behavior(window.app_handle()) == "tray" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![get_battery])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
