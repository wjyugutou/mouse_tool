//! 鼠标工具 · 后端（Tauri）
//!
//! - 通过 HID 被动读取雷柏 VT9 AIR 电量（勿用 GetInputReport，会卡死鼠标）
//! - 托盘显示电量：单击选鼠标，双击打开主窗口；关窗可隐藏到托盘

use hidapi::HidApi;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

const RAPOO_VID: u16 = 0x24ae;
const CANDIDATE_PIDS: &[u16] = &[0x1200, 0x4400];
const REPORT_BB: u8 = 0xBB;
const REPORT_BC: u8 = 0xBC;
/// 官方软件挂起中断读时，设备约每 3 秒推一次 BB；我们最多等这么久。
const LISTEN_FOR: Duration = Duration::from_millis(4500);
/// 托盘后台刷新间隔（含一次 HID 监听，不宜过短）。
const TRAY_REFRESH: Duration = Duration::from_secs(20);

/// 托盘可选设备（与前端 deviceRegistry 对齐，后续在此扩展）。
const TRAY_DEVICES: &[(&str, &str)] = &[("vt9-air", "VT9 AIR")];
const DEFAULT_TRAY_DEVICE: &str = "vt9-air";

struct TrayUiState {
    /// 当前托盘展示哪只鼠标的电量
    selected_id: Mutex<String>,
}

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
            device: format!("Rapoo {RAPOO_VID:04X}:1200"),
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
        let n = device
            .get_report_descriptor(&mut desc)
            .unwrap_or(0)
            .min(desc.len());
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

fn read_battery_for_device(device_id: &str) -> BatteryInfo {
    match device_id {
        "vt9-air" => read_vt9_battery().unwrap_or_else(|e| BatteryInfo {
            percent: None,
            charging: None,
            connected: false,
            device: "VT9 AIR".into(),
            detail: e,
        }),
        _ => BatteryInfo {
            percent: None,
            charging: None,
            connected: false,
            device: device_id.into(),
            detail: format!("未知设备: {device_id}"),
        },
    }
}

fn device_name(id: &str) -> &str {
    TRAY_DEVICES
        .iter()
        .find(|(did, _)| *did == id)
        .map(|(_, name)| *name)
        .unwrap_or(id)
}

/// 从托盘恢复并聚焦主窗口。
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 读取前端持久化的关闭行为：`quit` | `tray`（默认托盘）。
fn close_behavior(app: &AppHandle) -> String {
    use tauri_plugin_zustand::ManagerExt;
    app.zustand()
        .get_or::<String>("settings", "closeBehavior", "tray".into())
}

fn selected_tray_device(app: &AppHandle) -> String {
    if let Some(state) = app.try_state::<TrayUiState>() {
        if let Ok(id) = state.selected_id.lock() {
            return id.clone();
        }
    }
    use tauri_plugin_zustand::ManagerExt;
    app.zustand()
        .get_or::<String>("settings", "trayDeviceId", DEFAULT_TRAY_DEVICE.into())
}

fn set_selected_tray_device(app: &AppHandle, id: &str) {
    if let Some(state) = app.try_state::<TrayUiState>() {
        if let Ok(mut guard) = state.selected_id.lock() {
            *guard = id.to_string();
        }
    }
}

/// 3×5 像素数字字模，用于托盘图标画电量。
fn digit_glyph(d: u8) -> &'static [(i32, i32)] {
    match d {
        0 => &[
            (0, 0),
            (1, 0),
            (2, 0),
            (0, 1),
            (2, 1),
            (0, 2),
            (2, 2),
            (0, 3),
            (2, 3),
            (0, 4),
            (1, 4),
            (2, 4),
        ],
        1 => &[(1, 0), (1, 1), (1, 2), (1, 3), (1, 4), (0, 1)],
        2 => &[
            (0, 0),
            (1, 0),
            (2, 0),
            (2, 1),
            (0, 2),
            (1, 2),
            (2, 2),
            (0, 3),
            (0, 4),
            (1, 4),
            (2, 4),
        ],
        3 => &[
            (0, 0),
            (1, 0),
            (2, 0),
            (2, 1),
            (0, 2),
            (1, 2),
            (2, 2),
            (2, 3),
            (0, 4),
            (1, 4),
            (2, 4),
        ],
        4 => &[
            (0, 0),
            (2, 0),
            (0, 1),
            (2, 1),
            (0, 2),
            (1, 2),
            (2, 2),
            (2, 3),
            (2, 4),
        ],
        5 => &[
            (0, 0),
            (1, 0),
            (2, 0),
            (0, 1),
            (0, 2),
            (1, 2),
            (2, 2),
            (2, 3),
            (0, 4),
            (1, 4),
            (2, 4),
        ],
        6 => &[
            (0, 0),
            (1, 0),
            (2, 0),
            (0, 1),
            (0, 2),
            (1, 2),
            (2, 2),
            (0, 3),
            (2, 3),
            (0, 4),
            (1, 4),
            (2, 4),
        ],
        7 => &[(0, 0), (1, 0), (2, 0), (2, 1), (2, 2), (1, 3), (1, 4)],
        8 => &[
            (0, 0),
            (1, 0),
            (2, 0),
            (0, 1),
            (2, 1),
            (0, 2),
            (1, 2),
            (2, 2),
            (0, 3),
            (2, 3),
            (0, 4),
            (1, 4),
            (2, 4),
        ],
        9 => &[
            (0, 0),
            (1, 0),
            (2, 0),
            (0, 1),
            (2, 1),
            (0, 2),
            (1, 2),
            (2, 2),
            (2, 3),
            (0, 4),
            (1, 4),
            (2, 4),
        ],
        _ => &[],
    }
}

fn put_px(buf: &mut [u8], size: u32, x: i32, y: i32, r: u8, g: u8, b: u8, a: u8) {
    if x < 0 || y < 0 || x >= size as i32 || y >= size as i32 {
        return;
    }
    let i = ((y as u32 * size + x as u32) * 4) as usize;
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = a;
}

fn draw_digit(buf: &mut [u8], size: u32, ox: i32, oy: i32, d: u8, r: u8, g: u8, b: u8) {
    for &(dx, dy) in digit_glyph(d) {
        // 放大到 2×2，托盘上更清晰
        for sx in 0..2 {
            for sy in 0..2 {
                put_px(buf, size, ox + dx * 2 + sx, oy + dy * 2 + sy, r, g, b, 255);
            }
        }
    }
}

/// 生成带电量数字的托盘图标。
fn make_battery_icon(percent: Option<u8>) -> Image<'static> {
    const S: u32 = 32;
    let mut buf = vec![0u8; (S * S * 4) as usize];
    // 深色底
    for i in 0..(S * S) as usize {
        buf[i * 4] = 28;
        buf[i * 4 + 1] = 28;
        buf[i * 4 + 2] = 34;
        buf[i * 4 + 3] = 255;
    }

    let (fr, fg, fb) = match percent {
        Some(p) if p <= 15 => (239u8, 68, 68),
        Some(p) if p <= 30 => (245, 158, 11),
        Some(_) => (52, 211, 153),
        None => (148, 163, 184),
    };

    // 电池外框
    for x in 4..26 {
        put_px(&mut buf, S, x, 8, 200, 200, 210, 255);
        put_px(&mut buf, S, x, 22, 200, 200, 210, 255);
    }
    for y in 8..23 {
        put_px(&mut buf, S, 4, y, 200, 200, 210, 255);
        put_px(&mut buf, S, 25, y, 200, 200, 210, 255);
    }
    for y in 12..19 {
        put_px(&mut buf, S, 26, y, 200, 200, 210, 255);
        put_px(&mut buf, S, 27, y, 200, 200, 210, 255);
    }

    // 电量填充
    let fill = percent.unwrap_or(0) as i32;
    let inner_w = 19;
    let filled = (inner_w * fill / 100).clamp(0, inner_w);
    for x in 0..filled {
        for y in 10..21 {
            put_px(&mut buf, S, 6 + x, y, fr, fg, fb, 255);
        }
    }

    // 顶部画百分比数字（两位；100 显示 99 避免挤爆）
    if let Some(p) = percent {
        let show = p.min(99);
        let tens = show / 10;
        let ones = show % 10;
        draw_digit(&mut buf, S, 7, 11, tens, 15, 15, 20);
        draw_digit(&mut buf, S, 15, 11, ones, 15, 15, 20);
    } else {
        // 未读到：中间一条灰杠
        for x in 10..22 {
            put_px(&mut buf, S, x, 15, 100, 100, 110, 255);
            put_px(&mut buf, S, x, 16, 100, 100, 110, 255);
        }
    }

    Image::new_owned(buf, S, S)
}

fn build_tray_menu(app: &AppHandle, selected_id: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let mut items: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = Vec::new();
    // CheckMenuItem 需要活过 build，放到 owned 列表
    let mut checks = Vec::new();
    for (id, name) in TRAY_DEVICES {
        let checked = *id == selected_id;
        let label = if checked {
            format!("✓ {name}")
        } else {
            (*name).to_string()
        };
        // 用普通 MenuItem + 勾选前缀，避免 CheckMenuItem 生命周期麻烦
        let item = MenuItem::with_id(app, format!("device:{id}"), label, true, None::<&str>)?;
        checks.push(item);
    }
    for c in &checks {
        items.push(c);
    }
    let sep = PredefinedMenuItem::separator(app)?;
    let show = MenuItem::with_id(app, "show", "打开主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    items.push(&sep);
    items.push(&show);
    items.push(&quit);
    Menu::with_items(app, &items)
}

fn apply_tray_status(app: &AppHandle, info: &BatteryInfo, selected_id: &str) {
    let name = device_name(selected_id);
    let tip = match info.percent {
        Some(p) => format!("{name} · {p}%"),
        None if info.connected => format!("{name} · 电量未知"),
        None => format!("{name} · 未连接"),
    };
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(&tip));
        let _ = tray.set_icon(Some(make_battery_icon(info.percent)));
        if let Ok(menu) = build_tray_menu(app, selected_id) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

fn refresh_tray_battery(app: &AppHandle) {
    let id = selected_tray_device(app);
    let info = read_battery_for_device(&id);
    apply_tray_status(app, &info, &id);
}

fn spawn_tray_updater(app: AppHandle) {
    std::thread::spawn(move || {
        // 启动稍等，让窗口 / store 先起来
        std::thread::sleep(Duration::from_secs(2));
        loop {
            refresh_tray_battery(&app);
            std::thread::sleep(TRAY_REFRESH);
        }
    });
}

/// 创建托盘：图标/提示显示电量；单击弹出设备列表；双击打开窗口。
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let selected = {
        use tauri_plugin_zustand::ManagerExt;
        app.zustand()
            .get_or::<String>("settings", "trayDeviceId", DEFAULT_TRAY_DEVICE.into())
    };
    app.manage(TrayUiState {
        selected_id: Mutex::new(selected.clone()),
    });

    let menu = build_tray_menu(app.handle(), &selected)?;
    let icon = make_battery_icon(None);

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .menu(&menu)
        // 左键单击弹出菜单（设备列表）；双击另开窗口
        .show_menu_on_left_click(true)
        .tooltip("鼠标工具 · 读取电量中…")
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if let Some(device_id) = id.strip_prefix("device:") {
                set_selected_tray_device(app, device_id);
                refresh_tray_battery(app);
                return;
            }
            match id {
                "show" => show_main_window(app),
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            // Windows：双击打开主窗口
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    spawn_tray_updater(app.handle().clone());
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 插件、托盘、关窗拦截、命令注册
    // 主窗口默认 invisible；普通启动再 show，开机自启（--autostart）保持托盘后台
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_zustand::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .setup(|app| {
            setup_tray(app)?;
            let from_autostart = std::env::args().any(|a| a == "--autostart");
            if !from_autostart {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
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
