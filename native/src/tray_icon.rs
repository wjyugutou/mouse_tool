//! 托盘图标与悬停提示：从 Tauri 版 `src-tauri/src/tray.rs` 迁来的纯绘制部分。
//! 图标画成 32×32 RGBA，再编码成 PNG data URI 交给 NSH 的 `Tray.set`（PNG 不当模板着色，颜色保留）。

use crate::devices;
use crate::plugin_sdk::{BatteryInfo, DeviceCategory, DeviceMeta};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 托盘图标边长（像素）。
pub(crate) const ICON_SIZE: u32 = 32;

/// RGBA → `data:image/png;base64,…`。
pub(crate) fn png_data_uri(rgba: &[u8]) -> String {
    use base64::Engine as _;
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, ICON_SIZE, ICON_SIZE);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().expect("png header");
        writer.write_image_data(rgba).expect("png data");
    }
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(out)
    )
}

/// 每个分类至多一只。与前端 `SelectedByCategory` 同一份字段。
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SelectedByCategory {
    #[serde(default)]
    pub(crate) mouse: Option<String>,
    #[serde(default)]
    pub(crate) keyboard: Option<String>,
    #[serde(default)]
    pub(crate) headset: Option<String>,
}

impl SelectedByCategory {
    pub(crate) fn get(&self, category: DeviceCategory) -> Option<&str> {
        match category {
            DeviceCategory::Mouse => self.mouse.as_deref(),
            DeviceCategory::Keyboard => self.keyboard.as_deref(),
            DeviceCategory::Headset => self.headset.as_deref(),
        }
    }

    pub(crate) fn set(&mut self, category: DeviceCategory, id: String) {
        let slot = match category {
            DeviceCategory::Mouse => &mut self.mouse,
            DeviceCategory::Keyboard => &mut self.keyboard,
            DeviceCategory::Headset => &mut self.headset,
        };
        *slot = Some(id);
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

/// 托盘图标上一格电量：外层 `None` = 该分类未选设备；内层 `None` = 已选但尚无百分比。
pub(crate) type TraySlotLevel = Option<Option<u8>>;

/// 与旧单电池图标相同的档位色：≤15 红、≤30 橙、其余绿；未知灰。
fn battery_fill_rgb(percent: Option<u8>) -> (u8, u8, u8) {
    match percent {
        Some(p) if p <= 15 => (239, 68, 68),
        Some(p) if p <= 30 => (245, 158, 11),
        Some(_) => (52, 211, 153),
        None => (148, 163, 184),
    }
}

pub(crate) fn default_tray_category_keys() -> Vec<String> {
    vec![
        "mouse".into(),
        "keyboard".into(),
        "headset".into(),
    ]
}

pub(crate) fn sanitize_tray_categories(raw: &[String]) -> Vec<DeviceCategory> {
    const ORDER: [DeviceCategory; 3] = [
        DeviceCategory::Mouse,
        DeviceCategory::Keyboard,
        DeviceCategory::Headset,
    ];
    let mut out = Vec::new();
    for category in ORDER {
        let key = category_key(category);
        if raw.iter().any(|s| s == key) {
            out.push(category);
        }
    }
    if out.is_empty() {
        out.push(DeviceCategory::Mouse);
    }
    out
}

/// 按「托盘显示分类」过滤后的电量格（1～3）。未启用的分类不出现。
pub(crate) fn tray_visible_levels(
    active_id: &str,
    selected: &SelectedByCategory,
    categories: &[DeviceCategory],
    samples: &HashMap<String, BatteryInfo>,
) -> Vec<TraySlotLevel> {
    let resolved = resolve_selection(active_id, selected);
    let mut levels = Vec::new();
    for &category in categories {
        let level = match resolved
            .get(category)
            .and_then(|id| matching_meta(id, category))
        {
            Some(meta) => Some(samples.get(&meta.id).and_then(|info| info.percent)),
            None => None,
        };
        levels.push(level);
    }
    if levels.is_empty() {
        levels.push(None);
    }
    levels
}

/// 在 32×32 上画电池：只选 1 类 → 单颗横向大电池；≥2 类 → 并排竖向小电池。
pub(crate) fn make_tray_battery_icon(slots: &[TraySlotLevel]) -> Vec<u8> {
    const S: u32 = 32;
    // 未绘制像素保持 RGBA(0,0,0,0)，Windows 托盘才能透出任务栏，避免「大黑边」。
    let mut buf = vec![0u8; (S * S * 4) as usize];

    let n = slots.len().clamp(1, 3);
    if n == 1 {
        // 只选一类：单颗横向大电池（接近旧单电池样式）
        draw_horizontal_battery(&mut buf, S, 2, 8, 28, 16, slots[0]);
    } else {
        // ≥2：并排竖向小电池
        let origins = vertical_battery_origins(n);
        for (slot, &ox) in slots.iter().take(n).zip(origins.iter()) {
            draw_vertical_battery(&mut buf, S, ox, *slot);
        }
    }

    buf
}

/// 并排竖条的左缘 x：2 颗宽约 14；3 颗宽约 10。
fn vertical_battery_origins(n: usize) -> Vec<i32> {
    match n.clamp(2, 3) {
        2 => vec![2, 17],
        _ => vec![0, 11, 22],
    }
}

/// 竖向迷你电池：正极在上，双线描边，电量自底向上。
fn draw_vertical_battery(buf: &mut [u8], size: u32, ox: i32, slot: TraySlotLevel) {
    // 2 列时更宽（14），3 列时宽 10
    let w = if ox == 2 || ox == 17 { 13 } else { 10 };
    let selected = slot.is_some();
    let (frame_r, frame_g, frame_b) = if selected {
        (210u8, 210, 220)
    } else {
        (78, 78, 90)
    };

    // 正极帽
    let tip_x0 = ox + w / 4;
    let tip_x1 = ox + w - w / 4;
    for y in 1..4 {
        for x in tip_x0..tip_x1 {
            put_px(buf, size, x, y, frame_r, frame_g, frame_b, 255);
        }
    }
    // 外框双线顶/底
    for y in 4..6 {
        for x in ox..(ox + w) {
            put_px(buf, size, x, y, frame_r, frame_g, frame_b, 255);
        }
    }
    for y in 29..31 {
        for x in ox..(ox + w) {
            put_px(buf, size, x, y, frame_r, frame_g, frame_b, 255);
        }
    }
    // 外框双线左右
    for y in 4..31 {
        put_px(buf, size, ox, y, frame_r, frame_g, frame_b, 255);
        put_px(buf, size, ox + 1, y, frame_r, frame_g, frame_b, 255);
        put_px(buf, size, ox + w - 2, y, frame_r, frame_g, frame_b, 255);
        put_px(buf, size, ox + w - 1, y, frame_r, frame_g, frame_b, 255);
    }

    let inner_x0 = ox + 2;
    let inner_x1 = ox + w - 2;
    match slot {
        None => {}
        Some(None) => {
            for y in 14..18 {
                for x in inner_x0..inner_x1 {
                    put_px(buf, size, x, y, 110, 110, 120, 255);
                }
            }
        }
        Some(Some(p)) => {
            let (fr, fg, fb) = battery_fill_rgb(Some(p));
            let inner_h = 23;
            let filled = (inner_h * p as i32 / 100).clamp(0, inner_h);
            for dy in 0..filled {
                let y = 28 - dy;
                for x in inner_x0..inner_x1 {
                    put_px(buf, size, x, y, fr, fg, fb, 255);
                }
            }
        }
    }
}

/// 横向大电池：本体在左，正极帽在右；双线描边；电量自左向右（旧单电池风格）。
fn draw_horizontal_battery(
    buf: &mut [u8],
    size: u32,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    slot: TraySlotLevel,
) {
    let selected = slot.is_some();
    let (frame_r, frame_g, frame_b) = if selected {
        (210u8, 210, 220)
    } else {
        (78, 78, 90)
    };

    let tip_w = 3i32;
    let body_w = (w - tip_w).max(8);
    let thick = 2i32;

    // 正极帽（右侧）
    let tip_x0 = x + body_w;
    let tip_y0 = y + h / 4;
    let tip_y1 = y + h - h / 4;
    for py in tip_y0..tip_y1 {
        for px in tip_x0..(x + w) {
            put_px(buf, size, px, py, frame_r, frame_g, frame_b, 255);
        }
    }

    for t in 0..thick {
        for px in x..(x + body_w) {
            put_px(buf, size, px, y + t, frame_r, frame_g, frame_b, 255);
            put_px(buf, size, px, y + h - 1 - t, frame_r, frame_g, frame_b, 255);
        }
    }
    for t in 0..thick {
        for py in y..(y + h) {
            put_px(buf, size, x + t, py, frame_r, frame_g, frame_b, 255);
            put_px(buf, size, x + body_w - 1 - t, py, frame_r, frame_g, frame_b, 255);
        }
    }

    let inner_x0 = x + thick;
    let inner_x1 = x + body_w - thick;
    let inner_y0 = y + thick;
    let inner_y1 = y + h - thick;
    let inner_w = (inner_x1 - inner_x0).max(0);

    match slot {
        None => {}
        Some(None) => {
            let cx = inner_x0 + inner_w / 2;
            for py in inner_y0..inner_y1 {
                for px in (cx - 1)..(cx + 2) {
                    put_px(buf, size, px, py, 110, 110, 120, 255);
                }
            }
        }
        Some(Some(p)) => {
            let (fr, fg, fb) = battery_fill_rgb(Some(p));
            let filled = (inner_w * p as i32 / 100).clamp(0, inner_w);
            for dx in 0..filled {
                let px = inner_x0 + dx;
                for py in inner_y0..inner_y1 {
                    put_px(buf, size, px, py, fr, fg, fb, 255);
                }
            }
        }
    }
}

pub(crate) fn category_label(category: DeviceCategory) -> &'static str {
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
pub(crate) fn resolve_selection(active_id: &str, selected: &SelectedByCategory) -> SelectedByCategory {
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

pub(crate) fn category_key(category: DeviceCategory) -> &'static str {
    match category {
        DeviceCategory::Mouse => "mouse",
        DeviceCategory::Keyboard => "keyboard",
        DeviceCategory::Headset => "headset",
    }
}

fn battery_status(info: Option<&BatteryInfo>) -> String {
    match info {
        // 型号不受支持：直说，不能和「读不到电量」混在一起。
        Some(info) if info.unsupported => "型号不支持".into(),
        Some(info) => match info.percent {
            Some(percent) => format!("{percent}%"),
            // 充电但没有百分比（如 S9 Pro 的 0xE4 哨兵值）：说「充电中」，
            // 不能说「电量未知」——那不是读失败，是厂商此时不给百分比。
            None if info.charging == Some(true) => "充电中".into(),
            None if info.connected => "电量未知".into(),
            None => "未连接".into(),
        },
        None => "读取中…".into(),
    }
}

/// 托盘图标要画成哪种形态。
///
/// 「充电无百分比」和「型号不支持」都**不能画成 0% 电量**——前者是厂商不给数，
/// 后者是这只设备根本不归本插件管，画 0% 都会让用户以为没电了。
#[derive(Debug, PartialEq, Eq)]
#[allow(dead_code)]
enum IconMode {
    /// 有百分比（或完全没采样到）。
    Level(Option<u8>),
    /// 充电中但拿不到百分比：画闪电。
    Charging,
    /// 型号不受支持：画感叹号。
    Unsupported,
}

#[allow(dead_code)]
fn icon_mode(info: Option<&BatteryInfo>) -> IconMode {
    match info {
        Some(info) if info.unsupported => IconMode::Unsupported,
        Some(info) if info.percent.is_none() && info.charging == Some(true) => IconMode::Charging,
        Some(info) => IconMode::Level(info.percent),
        None => IconMode::Level(None),
    }
}

/// 悬停提示只列出「当前选择」的鼠标 / 键盘 / 耳机（最多三行）。
/// 未选的分类不出现；打勾的是托盘图标数字跟着的那一只。
/// 悬停提示只列出设置里勾选的分类（鼠标→键盘→耳机）；未勾选的不出现。
pub(crate) fn tooltip_text(
    active_id: &str,
    selected: &SelectedByCategory,
    categories: &[DeviceCategory],
    samples: &HashMap<String, BatteryInfo>,
) -> String {
    let resolved = resolve_selection(active_id, selected);
    let mut lines = Vec::new();
    for &category in categories {
        match resolved
            .get(category)
            .and_then(|id| matching_meta(id, category))
        {
            Some(meta) => {
                let status = battery_status(samples.get(&meta.id));
                if meta.id == active_id {
                    lines.push(format!("✓ {} · {status}", meta.name));
                } else {
                    lines.push(format!("{} · {status}", meta.name));
                }
            }
            None => {
                lines.push(format!("{} · 未选择", category_label(category)));
            }
        }
    }
    if lines.is_empty() {
        "yugutou_tool".into()
    } else {
        lines.join("
")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn category_label_covers_all_slots() {
        assert_eq!(category_label(DeviceCategory::Mouse), "鼠标");
        assert_eq!(category_label(DeviceCategory::Keyboard), "键盘");
        assert_eq!(category_label(DeviceCategory::Headset), "耳机");
    }

    #[test]
    fn tooltip_lists_only_selected_slots_and_marks_the_icon_device() {
        let mut samples = HashMap::new();
        samples.insert(
            "mchose-a5-v3-ultra-plus".into(),
            BatteryInfo {
                percent: Some(88),
                charging: None,
                connected: true,
                device: "迈从 A5 V3 Ultra+".into(),
                detail: String::new(),
                unsupported: false,
                model_uncertain: false,
            },
        );
        samples.insert(
            "razer-viper-ultimate".into(),
            BatteryInfo::disconnected("雷蛇毒蝰 Viper Ultimate", "未连接"),
        );
        // 只选了迈从鼠标 + VGN 键盘；未选的雷柏/雷蛇不应出现在 tip。
        let selected = SelectedByCategory {
            mouse: Some("mchose-a5-v3-ultra-plus".into()),
            keyboard: Some("vgn-s99".into()),
            headset: None,
        };
        let cats = sanitize_tray_categories(&["mouse".into(), "keyboard".into()]);
        let tooltip = tooltip_text("mchose-a5-v3-ultra-plus", &selected, &cats, &samples);
        assert!(
            tooltip.contains("✓ 迈从 A5 V3 Ultra+ · 88%"),
            "实际: {tooltip}"
        );
        assert!(tooltip.contains("VGN S99 · 读取中…"), "实际: {tooltip}");
        assert!(!tooltip.contains("VT9 AIR"), "实际: {tooltip}");
        assert!(!tooltip.contains("Viper Ultimate"), "实际: {tooltip}");
        assert_eq!(tooltip.lines().count(), 2, "实际: {tooltip}");
    }

    #[test]
    fn tooltip_fills_active_category_when_selection_empty() {
        let selected = SelectedByCategory::default();
        // 只勾选鼠标时，空 selection 仍会补上当前图标设备
        let cats = sanitize_tray_categories(&["mouse".into()]);
        let tooltip = tooltip_text("vt9-air", &selected, &cats, &HashMap::new());
        assert!(tooltip.contains("VT9 AIR"), "实际: {tooltip}");
        assert_eq!(tooltip.lines().count(), 1, "实际: {tooltip}");
        assert!(!tooltip.contains("VGN S99"), "实际: {tooltip}");
    }

    /// 托盘要把「充电无百分比」和「型号不支持」与「读失败」分开显示。
    ///
    /// review 意见 #2：这两种状态原先都落到「电量未知」，用户看不出区别；
    /// 图标还会按 0% 画，看起来像没电了。
    #[test]
    fn tray_distinguishes_charging_and_unsupported_from_read_failure() {
        // 充电哨兵：connected + charging + 无百分比
        let charging = BatteryInfo {
            percent: None,
            charging: Some(true),
            connected: true,
            device: "Gaming 2.4G".into(),
            detail: "正在充电".into(),
            unsupported: false,
            model_uncertain: true,
        };
        assert_eq!(battery_status(Some(&charging)), "充电中");
        // 充电时不画成 0%：图标走闪电形态
        assert_eq!(icon_mode(Some(&charging)), IconMode::Charging);

        // 型号不支持
        let unsupported = BatteryInfo::unsupported("前行者 S9 Ultra（未支持）", "本版只适配 S9 Pro");
        assert_eq!(battery_status(Some(&unsupported)), "型号不支持");
        assert_eq!(icon_mode(Some(&unsupported)), IconMode::Unsupported);

        // 真读失败（已连接、无电量、未充电）：仍是「电量未知」，不能和上面两种混
        let failed = BatteryInfo {
            percent: None,
            charging: None,
            connected: true,
            device: "Gaming 2.4G".into(),
            detail: "没读到回包".into(),
            unsupported: false,
            model_uncertain: false,
        };
        assert_eq!(battery_status(Some(&failed)), "电量未知");
        assert_eq!(icon_mode(Some(&failed)), IconMode::Level(None));

        // 有百分比的充电：继续显示百分比（作者明确要求）
        let charging_with_level = BatteryInfo {
            percent: Some(80),
            charging: Some(true),
            connected: true,
            device: "x".into(),
            detail: String::new(),
            unsupported: false,
            model_uncertain: false,
        };
        assert_eq!(battery_status(Some(&charging_with_level)), "80%");
        assert_eq!(
            icon_mode(Some(&charging_with_level)),
            IconMode::Level(Some(80))
        );

        // 未连接 / 无样本
        assert_eq!(
            battery_status(Some(&BatteryInfo::disconnected("x", "未连接"))),
            "未连接"
        );
        assert_eq!(battery_status(None), "读取中…");
    }

    #[test]
    fn battery_fill_rgb_matches_legacy_thresholds() {
        assert_eq!(battery_fill_rgb(Some(10)), (239, 68, 68));
        assert_eq!(battery_fill_rgb(Some(15)), (239, 68, 68));
        assert_eq!(battery_fill_rgb(Some(16)), (245, 158, 11));
        assert_eq!(battery_fill_rgb(Some(30)), (245, 158, 11));
        assert_eq!(battery_fill_rgb(Some(31)), (52, 211, 153));
        assert_eq!(battery_fill_rgb(None), (148, 163, 184));
    }

    #[test]
    fn tray_visible_levels_follow_category_filter() {
        let mut samples = HashMap::new();
        samples.insert(
            "mchose-a5-v3-ultra-plus".into(),
            BatteryInfo {
                percent: Some(12),
                charging: None,
                connected: true,
                device: "mchose".into(),
                detail: String::new(),
            
                unsupported: false,
                model_uncertain: false,
            },
        );
        samples.insert(
            "vgn-s99".into(),
            BatteryInfo {
                percent: Some(88),
                charging: None,
                connected: true,
                device: "vgn".into(),
                detail: String::new(),
            
                unsupported: false,
                model_uncertain: false,
            },
        );
        let selected = SelectedByCategory {
            mouse: Some("mchose-a5-v3-ultra-plus".into()),
            keyboard: Some("vgn-s99".into()),
            headset: None,
        };
        // 只勾选键盘 → 仅一格
        let cats = sanitize_tray_categories(&["keyboard".into()]);
        let levels = tray_visible_levels("mchose-a5-v3-ultra-plus", &selected, &cats, &samples);
        assert_eq!(levels, vec![Some(Some(88))]);

        // 勾选鼠+键 → 两格，跳过未启用耳机
        let cats = sanitize_tray_categories(&["mouse".into(), "keyboard".into()]);
        let levels = tray_visible_levels("mchose-a5-v3-ultra-plus", &selected, &cats, &samples);
        assert_eq!(levels, vec![Some(Some(12)), Some(Some(88))]);
    }

    #[test]
    fn sanitize_tray_categories_keeps_order_and_fallback() {
        let cats = sanitize_tray_categories(&["headset".into(), "mouse".into(), "nope".into()]);
        assert_eq!(
            cats,
            vec![DeviceCategory::Mouse, DeviceCategory::Headset]
        );
        assert_eq!(
            sanitize_tray_categories(&[]),
            vec![DeviceCategory::Mouse]
        );
    }

    #[test]
    fn make_tray_battery_icon_builds_32x32_rgba_for_1_2_3() {
        for n in 1..=3 {
            let slots: Vec<TraySlotLevel> = (0..n).map(|i| Some(Some((i * 30 + 10) as u8))).collect();
            let img = make_tray_battery_icon(&slots);
            assert_eq!(img.len(), 32 * 32 * 4, "n={n}");
        }
        assert_eq!(vertical_battery_origins(2).len(), 2);
        assert_eq!(vertical_battery_origins(3).len(), 3);
        assert!(png_data_uri(&make_tray_battery_icon(&[Some(Some(50))])).starts_with("data:image/png;base64,"));
    }

    #[test]
    fn tooltip_respects_tray_category_filter() {
        let selected = SelectedByCategory {
            mouse: Some("vt9-air".into()),
            keyboard: Some("vgn-s99".into()),
            headset: None,
        };
        let cats = sanitize_tray_categories(&["keyboard".into()]);
        let tip = tooltip_text("vt9-air", &selected, &cats, &HashMap::new());
        assert!(tip.contains("VGN S99"), "实际: {tip}");
        assert!(!tip.contains("VT9 AIR"), "实际: {tip}");
        assert_eq!(tip.lines().count(), 1);
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
