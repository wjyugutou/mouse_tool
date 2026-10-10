//! 系统托盘：电量图标、设备菜单、后台刷新

use crate::app_log;
use crate::devices;
use crate::plugin_sdk::BatteryInfo;
use std::sync::Mutex;
use std::time::Duration;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

/// 托盘后台刷新间隔（含一次 HID 监听，不宜过短）。
const TRAY_REFRESH: Duration = Duration::from_secs(300);

struct TrayUiState {
    /// 当前托盘展示哪只鼠标的电量
    selected_id: Mutex<String>,
}

/// 托盘菜单与电量都走设备插件表，不在这里维护第二份 id / 名称。
fn device_name(id: &str) -> String {
    devices::device_name(id)
}

fn resolve_stored_device_id(stored: String) -> String {
    if devices::find(&stored).is_some() {
        stored
    } else {
        devices::default_device_id()
    }
}

fn read_stored_tray_device_id(app: &AppHandle) -> String {
    use tauri_plugin_zustand::ManagerExt;
    let stored =
        app.zustand()
            .get_or::<String>("settings", "trayDeviceId", devices::default_device_id());
    resolve_stored_device_id(stored)
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
pub fn close_behavior(app: &AppHandle) -> String {
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
    read_stored_tray_device_id(app)
}

fn set_selected_tray_device(app: &AppHandle, id: &str) {
    if let Some(state) = app.try_state::<TrayUiState>() {
        if let Ok(mut guard) = state.selected_id.lock() {
            *guard = id.to_string();
        }
    }
    // 与前端 settings.trayDeviceId 同源，主窗口选设备 / 托盘菜单都能持久化
    use tauri_plugin_zustand::ManagerExt;
    let _ = app.zustand().patch(
        "settings",
        [("trayDeviceId", id.to_string())],
    );
}

/// 主窗口选中设备时调用：更新托盘目标并立刻刷新图标 / 提示。
#[tauri::command]
pub fn set_tray_device(app: AppHandle, device_id: String) {
    let id = resolve_stored_device_id(device_id);
    set_selected_tray_device(&app, &id);
    refresh_tray_battery(&app);
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
    for plugin in devices::plugins() {
        let meta = plugin.meta();
        let checked = meta.id == selected_id;
        let label = if checked {
            format!("✓ {}", meta.name)
        } else {
            meta.name
        };
        // 用普通 MenuItem + 勾选前缀，避免 CheckMenuItem 生命周期麻烦
        let item = MenuItem::with_id(
            app,
            format!("device:{}", meta.id),
            label,
            true,
            None::<&str>,
        )?;
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
    let info = devices::read_battery(&id);
    if !info.connected {
        app_log::warn(&format!(
            "tray battery device={id} disconnected detail={}",
            info.detail
        ));
    }
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
pub fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    app_log::info("setup_tray begin");
    let selected = read_stored_tray_device_id(app.handle());
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
    app_log::info("setup_tray ok");
    Ok(())
}
