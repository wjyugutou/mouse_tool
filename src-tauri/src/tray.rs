//! 系统托盘：电量图标、设备菜单。电量采样在 `battery`，这里只负责画出来。

use crate::app_log;
use crate::battery;
use crate::devices;
use crate::plugin_sdk::{BatteryInfo, DeviceCategory, DeviceMeta};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

/// Same source as frontend settings.autoIntervalSec (DEFAULT = 300).
const DEFAULT_AUTO_INTERVAL_SEC: u64 = 300;

/// Read auto refresh interval (seconds) from zustand settings store.
pub(crate) fn auto_interval_sec(app: &AppHandle) -> u64 {
    use tauri_plugin_zustand::ManagerExt;
    let raw = app
        .zustand()
        .get_or::<u64>("settings", "autoIntervalSec", DEFAULT_AUTO_INTERVAL_SEC);
    raw.clamp(3, 300)
}

/// 首页「暂停自动刷新」写在同一份 settings store 里。缺省开启。
pub(crate) fn auto_refresh_enabled(app: &AppHandle) -> bool {
    use tauri_plugin_zustand::ManagerExt;
    app.zustand()
        .get_or::<bool>("settings", "autoRefresh", true)
}

/// 托盘菜单与电量都走设备插件表，不在这里维护第二份 id / 名称。
fn resolve_stored_device_id(stored: String) -> String {
    if devices::find(&stored).is_some() {
        stored
    } else {
        devices::default_device_id()
    }
}

pub(crate) fn read_stored_tray_device_id(app: &AppHandle) -> String {
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

/// 一次写入托盘设备和分类选中项，避免两次 patch 触发两次电量读取。
fn commit_tray_device(app: &AppHandle, device_id: String, selected: SelectedByCategory) {
    use tauri_plugin_zustand::ManagerExt;
    let id = resolve_stored_device_id(device_id);
    let mut selected = sanitize_selection(&selected);
    if let Some(plugin) = devices::find(&id) {
        selected.set(plugin.meta().category, id.clone());
    }
    let selection = serde_json::to_value(&selected).unwrap_or(Value::Null);
    let _ = app.zustand().patch(
        "settings",
        [
            ("trayDeviceId", Value::String(id)),
            ("selectedByCategory", selection),
        ],
    );
}

/// 每个分类至多一只。与前端 `SelectedByCategory` 同一份字段。
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SelectedByCategory {
    #[serde(default)]
    mouse: Option<String>,
    #[serde(default)]
    keyboard: Option<String>,
    #[serde(default)]
    headset: Option<String>,
}

impl SelectedByCategory {
    fn get(&self, category: DeviceCategory) -> Option<&str> {
        match category {
            DeviceCategory::Mouse => self.mouse.as_deref(),
            DeviceCategory::Keyboard => self.keyboard.as_deref(),
            DeviceCategory::Headset => self.headset.as_deref(),
        }
    }

    fn set(&mut self, category: DeviceCategory, id: String) {
        let slot = match category {
            DeviceCategory::Mouse => &mut self.mouse,
            DeviceCategory::Keyboard => &mut self.keyboard,
            DeviceCategory::Headset => &mut self.headset,
        };
        *slot = Some(id);
    }
}

fn read_selected_by_category(app: &AppHandle) -> SelectedByCategory {
    use tauri_plugin_zustand::ManagerExt;
    app.zustand().get_or(
        "settings",
        "selectedByCategory",
        SelectedByCategory::default(),
    )
}

/// 主窗口选中设备时调用：记下该分类的选中项，并让托盘图标跟着这只。
/// 电量由 settings 监听触发的同一次采样更新，这里不再单独读 HID。
#[tauri::command]
pub fn set_tray_device(
    app: AppHandle,
    device_id: String,
    selected_by_category: SelectedByCategory,
) {
    commit_tray_device(&app, device_id, selected_by_category);
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

fn category_label(category: DeviceCategory) -> &'static str {
    match category {
        DeviceCategory::Mouse => "鼠标",
        DeviceCategory::Keyboard => "键盘",
        DeviceCategory::Headset => "耳机",
    }
}

fn matching_meta(id: &str, category: DeviceCategory) -> Option<DeviceMeta> {
    let meta = devices::find(id)?.meta();
    (meta.category == category).then_some(meta)
}

/// 丢掉对不上的 id。当前电量设备所在分类还空着时，用它补上。
/// 和前端 `resolveSelectedByCategory` 同一条规则。
fn resolve_selection(active_id: &str, selected: &SelectedByCategory) -> SelectedByCategory {
    let mut clean = sanitize_selection(selected);
    if let Some(plugin) = devices::find(active_id) {
        let meta = plugin.meta();
        if clean.get(meta.category).is_none() {
            clean.set(meta.category, meta.id);
        }
    }
    clean
}

fn sanitize_selection(selected: &SelectedByCategory) -> SelectedByCategory {
    const ORDER: [DeviceCategory; 3] = [
        DeviceCategory::Mouse,
        DeviceCategory::Keyboard,
        DeviceCategory::Headset,
    ];
    let mut clean = SelectedByCategory::default();
    for category in ORDER {
        if let Some(id) = selected.get(category) {
            if let Some(meta) = matching_meta(id, category) {
                clean.set(category, meta.id);
            }
        }
    }
    clean
}

fn category_key(category: DeviceCategory) -> &'static str {
    match category {
        DeviceCategory::Mouse => "mouse",
        DeviceCategory::Keyboard => "keyboard",
        DeviceCategory::Headset => "headset",
    }
}

struct TrayMenuEntry {
    /// 这一行对应的设备。该分类没有插件时为空行。
    id: Option<String>,
    name: Option<String>,
    category: DeviceCategory,
}

/// 每个分类列出插件表里的每一只。该分类一台都没有时留一行「未选择」。
fn tray_menu_entries() -> Vec<TrayMenuEntry> {
    const ORDER: [DeviceCategory; 3] = [
        DeviceCategory::Mouse,
        DeviceCategory::Keyboard,
        DeviceCategory::Headset,
    ];
    let metas = devices::list_meta();
    let mut entries = Vec::new();
    for category in ORDER {
        let mut found = false;
        for meta in metas.iter().filter(|meta| meta.category == category) {
            found = true;
            entries.push(TrayMenuEntry {
                id: Some(meta.id.clone()),
                name: Some(meta.name.clone()),
                category,
            });
        }
        if !found {
            entries.push(TrayMenuEntry {
                id: None,
                name: None,
                category,
            });
        }
    }
    entries
}

fn battery_status(info: Option<&BatteryInfo>) -> String {
    match info {
        Some(info) => match info.percent {
            Some(percent) => format!("{percent}%"),
            None if info.connected => "电量未知".into(),
            None => "未连接".into(),
        },
        None => "读取中…".into(),
    }
}

/// 悬停提示列出每一只。打勾的是图标数字跟着的那一只。
pub(crate) fn tooltip_text(active_id: &str, samples: &HashMap<String, BatteryInfo>) -> String {
    let lines: Vec<String> = devices::list_meta()
        .into_iter()
        .map(|meta| {
            let status = battery_status(samples.get(&meta.id));
            if meta.id == active_id {
                format!("✓ {} · {status}", meta.name)
            } else {
                format!("{} · {status}", meta.name)
            }
        })
        .collect();
    if lines.is_empty() {
        "yugutou_tool".into()
    } else {
        lines.join("\n")
    }
}

fn menu_label(
    active: bool,
    category: DeviceCategory,
    name: Option<&str>,
    status: Option<&str>,
) -> String {
    match name {
        Some(name) if active => format!(
            "✓ {} · {name} · {}",
            category_label(category),
            status.unwrap_or("读取中…")
        ),
        Some(name) => format!(
            "{} · {name} · {}",
            category_label(category),
            status.unwrap_or("读取中…")
        ),
        None => format!("{} · 未选择", category_label(category)),
    }
}

fn build_tray_menu(
    app: &AppHandle,
    active_id: &str,
    samples: &HashMap<String, BatteryInfo>,
) -> tauri::Result<Menu<tauri::Wry>> {
    let entries = tray_menu_entries();
    let mut items: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = Vec::new();
    // MenuItem 需要活过 build，放到 owned 列表
    let mut checks = Vec::new();
    for entry in &entries {
        let item_id = match &entry.id {
            Some(id) => format!("device:{id}"),
            None => format!("empty:{}", category_key(entry.category)),
        };
        let status = entry
            .id
            .as_deref()
            .map(|id| battery_status(samples.get(id)));
        let item = MenuItem::with_id(
            app,
            item_id,
            menu_label(
                entry.id.as_deref() == Some(active_id),
                entry.category,
                entry.name.as_deref(),
                status.as_deref(),
            ),
            entry.id.is_some(),
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
    if !checks.is_empty() {
        items.push(&sep);
    }
    items.push(&show);
    items.push(&quit);
    Menu::with_items(app, &items)
}

/// 每只设备最近一次电量。图标只画当前选中的那一只，提示和菜单用全部。
struct TrayBoard {
    samples: Mutex<HashMap<String, BatteryInfo>>,
}

fn sample_snapshot(app: &AppHandle) -> HashMap<String, BatteryInfo> {
    app.try_state::<TrayBoard>()
        .map(|board| {
            board
                .samples
                .lock()
                .unwrap_or_else(|err| err.into_inner())
                .clone()
        })
        .unwrap_or_default()
}

fn redraw_tray(app: &AppHandle) {
    let samples = sample_snapshot(app);
    let active = read_stored_tray_device_id(app);
    let tip = tooltip_text(&active, &samples);
    let Some(tray) = app.tray_by_id("main") else {
        return;
    };
    let _ = tray.set_tooltip(Some(&tip));
    let percent = samples.get(&active).and_then(|info| info.percent);
    let _ = tray.set_icon(Some(make_battery_icon(percent)));
    if let Ok(menu) = build_tray_menu(app, &active, &samples) {
        let _ = tray.set_menu(Some(menu));
    }
}

pub(crate) fn publish_battery(app: &AppHandle, device_id: &str, info: &BatteryInfo) {
    if !info.connected {
        app_log::warn(&format!(
            "tray battery device={device_id} disconnected detail={}",
            info.detail
        ));
    }
    if let Some(board) = app.try_state::<TrayBoard>() {
        board
            .samples
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .insert(device_id.to_string(), info.clone());
    }
    redraw_tray(app);
}

pub(crate) fn refresh_tray_menu(app: &AppHandle) {
    redraw_tray(app);
}

#[derive(Clone)]
struct SettingsSnap {
    tray_id: String,
    auto: bool,
    interval: u64,
    selected: SelectedByCategory,
}

impl Default for SettingsSnap {
    fn default() -> Self {
        Self {
            tray_id: String::new(),
            auto: true,
            interval: DEFAULT_AUTO_INTERVAL_SEC,
            selected: SelectedByCategory::default(),
        }
    }
}

struct SettingsWatch {
    snap: Mutex<SettingsSnap>,
}

fn read_settings_snap(app: &AppHandle) -> SettingsSnap {
    SettingsSnap {
        tray_id: read_stored_tray_device_id(app),
        auto: auto_refresh_enabled(app),
        interval: auto_interval_sec(app),
        selected: read_selected_by_category(app),
    }
}

/// 对照上一份快照决定要不要读电量。
/// 换设备才作废进行中的读取并立刻再采一次。只改分类选中项时重画菜单。
/// 改间隔或暂停只打断睡眠；从暂停恢复才立刻读。
fn on_settings_changed(app: &AppHandle) {
    let Some(state) = app.try_state::<SettingsWatch>() else {
        return;
    };
    // 在同一把锁里读 store 再换快照。两个回调不会拿着同一份旧值，各触发一次采样。
    let (prev, next) = {
        let mut snap = state.snap.lock().unwrap_or_else(|err| err.into_inner());
        let prev = snap.clone();
        let next = read_settings_snap(app);
        *snap = next.clone();
        (prev, next)
    };
    if next.tray_id != prev.tray_id {
        battery::invalidate_device(app);
        battery::request_refresh(app);
        refresh_tray_menu(app);
    } else if next.selected != prev.selected {
        refresh_tray_menu(app);
    }
    if next.interval != prev.interval {
        battery::poke(app);
    }
    if next.auto != prev.auto {
        if next.auto {
            battery::request_refresh(app);
        } else {
            battery::poke(app);
        }
    }
}

/// 等前端把 settings store 拉起来，再开始监听。这样启动采样用的是磁盘上的设备。
pub(crate) fn install_settings_watch(app: &AppHandle) {
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while std::time::Instant::now() < deadline {
        use tauri_plugin_zustand::ManagerExt;
        if app
            .zustand()
            .get::<String>("settings", "trayDeviceId")
            .is_ok()
        {
            break;
        }
        thread::sleep(Duration::from_millis(50));
    }
    if let Some(state) = app.try_state::<SettingsWatch>() {
        let mut snap = state.snap.lock().unwrap_or_else(|err| err.into_inner());
        *snap = read_settings_snap(app);
    }
    for _ in 0..10 {
        use tauri_plugin_zustand::ManagerExt;
        match app.zustand().watch("settings", |app| {
            on_settings_changed(&app);
            Ok(())
        }) {
            Ok(_) => {
                app_log::info("settings watch installed");
                return;
            }
            Err(err) => {
                app_log::warn(&format!("settings watch failed: {err}"));
                thread::sleep(Duration::from_millis(200));
            }
        }
    }
}

/// 创建托盘：图标显示当前设备电量，提示和菜单列出每一只；双击打开窗口。
pub fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    app_log::info("setup_tray begin");
    let selected = read_stored_tray_device_id(app.handle());
    app.manage(battery::BatteryHub::new());
    app.manage(TrayBoard {
        samples: Mutex::new(HashMap::new()),
    });
    app.manage(SettingsWatch {
        snap: Mutex::new(SettingsSnap::default()),
    });

    let samples = HashMap::new();
    let menu = build_tray_menu(app.handle(), &selected, &samples)?;
    let icon = make_battery_icon(None);
    let tip = tooltip_text(&selected, &samples);

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .menu(&menu)
        // 左键单击弹出全部设备；双击另开窗口
        .show_menu_on_left_click(true)
        .tooltip(tip)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if let Some(device_id) = id.strip_prefix("device:") {
                let selected = read_selected_by_category(app);
                commit_tray_device(app, device_id.to_string(), selected);
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

    battery::spawn(app.handle().clone());
    app_log::info("setup_tray ok");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_lists_every_device_and_keeps_empty_categories() {
        let entries = tray_menu_entries();
        let registered = devices::list_meta();
        // 菜单按分类列出 PLUGINS 里的每一只；空分类只留一行。
        // 不假设「永远多一个耳机空行」，也不假设注册顺序等于菜单顺序。
        const ORDER: [DeviceCategory; 3] = [
            DeviceCategory::Mouse,
            DeviceCategory::Keyboard,
            DeviceCategory::Headset,
        ];
        let mut cursor = 0;
        for category in ORDER {
            let expected: Vec<_> = registered
                .iter()
                .filter(|meta| meta.category == category)
                .collect();
            if expected.is_empty() {
                let entry = &entries[cursor];
                assert_eq!(entry.id, None, "{category:?} 应是空行");
                assert_eq!(entry.category, category);
                cursor += 1;
            } else {
                for meta in expected {
                    let entry = &entries[cursor];
                    assert_eq!(entry.id.as_deref(), Some(meta.id.as_str()));
                    assert_eq!(entry.name.as_deref(), Some(meta.name.as_str()));
                    assert_eq!(entry.category, category);
                    cursor += 1;
                }
            }
        }
        assert_eq!(cursor, entries.len());

        assert_eq!(entries[0].category, DeviceCategory::Mouse);
        assert_eq!(
            menu_label(
                true,
                entries[0].category,
                entries[0].name.as_deref(),
                Some("88%")
            ),
            "✓ 鼠标 · VT9 AIR · 88%"
        );

        // 键盘那一行现在有 VGN S99，不再是「未选择」。
        let keyboard_entry = entries
            .iter()
            .find(|entry| entry.category == DeviceCategory::Keyboard)
            .expect("应有键盘分类");
        assert_eq!(keyboard_entry.id.as_deref(), Some("vgn-s99"));
        // 还没有电量样本时，菜单标签末尾是「读取中…」而不是「未选择」。
        assert_eq!(
            menu_label(
                false,
                DeviceCategory::Keyboard,
                keyboard_entry.name.as_deref(),
                None
            ),
            "键盘 · VGN S99 · 读取中…"
        );

        assert_eq!(
            menu_label(false, DeviceCategory::Headset, None, None),
            "耳机 · 未选择"
        );
    }

    #[test]
    fn tooltip_lists_every_device_and_marks_the_icon_device() {
        let mut samples = HashMap::new();
        samples.insert(
            "mchose-a5-v3-ultra-plus".into(),
            BatteryInfo {
                percent: Some(88),
                charging: None,
                connected: true,
                device: "迈从 A5 V3 Ultra+".into(),
                detail: String::new(),
            },
        );
        samples.insert(
            "razer-viper-ultimate".into(),
            BatteryInfo::disconnected("毒蝰终极版 Viper Ultimate", "未连接"),
        );
        let tooltip = tooltip_text("mchose-a5-v3-ultra-plus", &samples);
        // 断言关键片段而不是整串，新增设备时不必改这条测试。
        assert!(tooltip.contains("VT9 AIR · 读取中…"), "实际: {tooltip}");
        assert!(
            tooltip.contains("毒蝰终极版 Viper Ultimate · 未连接"),
            "实际: {tooltip}"
        );
        assert!(
            tooltip.contains("✓ 迈从 A5 V3 Ultra+ · 88%"),
            "实际: {tooltip}"
        );
        assert!(tooltip.contains("VGN S99 · 读取中…"), "实际: {tooltip}");
        // 每只已注册设备都应在提示里出现一次。
        assert_eq!(
            tooltip.lines().count(),
            devices::list_meta().len(),
            "提示行数应等于已注册设备数，实际: {tooltip}"
        );
    }

    #[test]
    fn unknown_or_wrong_category_ids_are_dropped() {
        let selected = SelectedByCategory {
            mouse: Some("missing-mouse".into()),
            keyboard: Some("vt9-air".into()),
            headset: None,
        };
        let clean = sanitize_selection(&selected);
        assert_eq!(clean.mouse, None);
        assert_eq!(clean.keyboard, None);
        assert_eq!(clean.headset, None);
    }

    #[test]
    fn explicit_mouse_selection_is_not_replaced_by_the_active_device() {
        let selected = SelectedByCategory {
            mouse: Some("razer-viper-ultimate".into()),
            keyboard: None,
            headset: None,
        };
        let resolved = resolve_selection("vt9-air", &selected);
        assert_eq!(resolved.mouse.as_deref(), Some("razer-viper-ultimate"));
    }
}
