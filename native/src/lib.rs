//! yugutou_tool 的 Rust 核心（NSH mixed 模式）。
//!
//! - 设备插件（`devices`）、电量采样（`hub`）、设置（`settings`）、托盘图标（`tray_icon`）、
//!   开机自启（`autostart`）都在这里；TSX 屏幕只持有视图，经 `Mouse` 模块读快照、发请求。
//! - 只允许 HID 中断读；勿用 GetInputReport，会卡死鼠标。
//! - 采样在后台线程里跑，结果写进 `hub::board` 并把 `hub::version` 加一；
//!   TSX 轮询版本号，变了才取快照、重设托盘。

mod app_log;
mod autostart;
mod devices;
mod hub;
mod plugin_sdk;
mod settings;
mod tray_icon;

use nsh_core::prelude::*;
use plugin_sdk::{BatteryInfo, DeviceCategory};
use std::time::{SystemTime, UNIX_EPOCH};

/// 本 crate 导出给 TSX 的内容：`import { Mouse } from "yugutou/native"`。
#[native_module("yugutou/native")]
fn native(registry: &mut Registry) {
    registry.module::<Mouse>();
}

/// 一只已注册的设备（来自插件 manifest）。
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
pub struct Device {
    /// 稳定 id，与 manifest 的 `id` 相同。
    pub id: String,
    /// 界面显示名称。
    pub name: String,
    /// 列表里的短说明。
    pub description: String,
    /// 一级分类：`mouse` / `keyboard` / `headset`。
    pub category: String,
}

/// 一次电量采样。
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
pub struct Battery {
    /// 这次采样属于哪只设备。
    pub device_id: String,
    /// 电量百分比；读不到时为空。
    pub percent: Option<u32>,
    /// 是否在充电；设备不报时为空。
    pub charging: Option<bool>,
    /// 接收器 / 设备是否连着。
    pub connected: bool,
    /// 插件报告的设备名。
    pub device: String,
    /// 诊断详情。
    pub detail: String,
    /// 已连接，但这只设备的型号本版不支持。
    pub unsupported: bool,
    /// 电量读到了，但具体型号认不出来。
    pub model_uncertain: bool,
    /// 采样时间（Unix 毫秒）。
    pub at_ms: f64,
}

/// 设置快照。改设置请调用 `Mouse.updateSettings` / `Mouse.selectDevice`。
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
pub struct AppSettings {
    /// 自动刷新间隔（3～300 秒）。
    pub auto_interval_sec: u32,
    /// `light` / `dark` / `system`。
    pub theme_mode: String,
    /// 关窗行为：`tray`（隐藏到托盘）或 `quit`。
    pub close_behavior: String,
    /// 托盘图标和首页当前跟着的设备。
    pub tray_device_id: String,
    /// 鼠标分类选中的设备。
    pub selected_mouse: Option<String>,
    /// 键盘分类选中的设备。
    pub selected_keyboard: Option<String>,
    /// 耳机分类选中的设备。
    pub selected_headset: Option<String>,
    /// 托盘图标与悬停提示要展示的分类。
    pub tray_categories: Vec<String>,
    /// 是否自动刷新。
    pub auto_refresh: bool,
}

/// 设置的部分更新；没给的字段不变。
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
pub struct SettingsPatch {
    /// 自动刷新间隔（秒）。
    pub auto_interval_sec: Option<u32>,
    /// `light` / `dark` / `system`。
    pub theme_mode: Option<String>,
    /// `tray` / `quit`。
    pub close_behavior: Option<String>,
    /// 托盘要展示的分类。
    pub tray_categories: Option<Vec<String>>,
    /// 是否自动刷新。
    pub auto_refresh: Option<bool>,
}

fn category_name(category: DeviceCategory) -> String {
    tray_icon::category_key(category).to_string()
}

fn millis(at: SystemTime) -> f64 {
    at.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

fn battery_js(device_id: &str, info: &BatteryInfo, at: SystemTime) -> Battery {
    Battery {
        device_id: device_id.to_string(),
        percent: info.percent.map(u32::from),
        charging: info.charging,
        connected: info.connected,
        device: info.device.clone(),
        detail: info.detail.clone(),
        unsupported: info.unsupported,
        model_uncertain: info.model_uncertain,
        at_ms: millis(at),
    }
}

fn settings_js(s: &settings::Settings) -> AppSettings {
    AppSettings {
        auto_interval_sec: s.auto_interval_sec as u32,
        theme_mode: s.theme_mode.clone(),
        close_behavior: s.close_behavior.clone(),
        tray_device_id: s.tray_device_id.clone(),
        selected_mouse: s.selected_by_category.mouse.clone(),
        selected_keyboard: s.selected_by_category.keyboard.clone(),
        selected_headset: s.selected_by_category.headset.clone(),
        tray_categories: s.tray_categories.clone(),
        auto_refresh: s.auto_refresh,
    }
}

fn apply(f: impl FnOnce(&mut settings::Settings)) -> AppSettings {
    let (prev, next) = settings::update(f);
    hub::on_settings_changed(&prev, &next);
    settings_js(&next)
}

/// 电量、设备、设置、托盘与开机自启。状态都在 Rust 里，TSX 只拿快照。
#[module]
pub struct Mouse;

#[module]
impl Mouse {
    /// 启动后台电量采样（重复调用无副作用）。
    pub fn start() {
        app_log::init();
        app_log::info(&format!(
            "nsh app start, version {} autostart={}",
            env!("CARGO_PKG_VERSION"),
            autostart::launched_at_login()
        ));
        hub::start();
    }

    /// 已注册的设备，顺序即首页与托盘的顺序。
    pub fn devices() -> Vec<Device> {
        devices::list_meta()
            .into_iter()
            .map(|meta| Device {
                id: meta.id,
                name: meta.name,
                description: meta.description,
                category: category_name(meta.category),
            })
            .collect()
    }

    /// 当前设置。
    pub fn settings() -> AppSettings {
        settings_js(&settings::current())
    }

    /// 改设置并落盘；返回改后的设置。
    pub fn update_settings(patch: SettingsPatch) -> AppSettings {
        apply(move |s| {
            if let Some(sec) = patch.auto_interval_sec {
                s.auto_interval_sec = u64::from(sec);
            }
            if let Some(mode) = patch.theme_mode {
                s.theme_mode = mode;
            }
            if let Some(behavior) = patch.close_behavior {
                s.close_behavior = behavior;
            }
            if let Some(categories) = patch.tray_categories {
                s.tray_categories = categories;
            }
            if let Some(on) = patch.auto_refresh {
                s.auto_refresh = on;
            }
        })
    }

    /// 选中一只设备：托盘图标跟着它，并记为它所在分类的选中项；同时恢复自动刷新。
    pub fn select_device(device_id: String) -> AppSettings {
        apply(move |s| {
            if let Some(plugin) = devices::find(&device_id) {
                let meta = plugin.meta();
                s.selected_by_category.set(meta.category, meta.id.clone());
                s.tray_device_id = meta.id;
                s.auto_refresh = true;
            }
        })
    }

    /// 每只设备最近一次采样。
    pub fn samples() -> Vec<Battery> {
        let board = hub::board();
        devices::list_meta()
            .into_iter()
            .filter_map(|meta| {
                board
                    .get(&meta.id)
                    .map(|sample| battery_js(&meta.id, &sample.info, sample.at))
            })
            .collect()
    }

    /// 采样或设置每变一次就加一；TSX 据此决定要不要重取快照。
    pub fn version() -> f64 {
        hub::version() as f64
    }

    /// 读一只设备的电量。`fresh` 为真时绕过缓存再读一次 HID；否则有缓存就用缓存。
    pub async fn read(device_id: String, fresh: Option<bool>) -> Battery {
        let fresh = fresh.unwrap_or(false);
        let label = devices::device_name(&device_id);
        let id = device_id.clone();
        let info = match blocking(move || hub::read_shared(&id, fresh)).await {
            Ok(info) => info,
            Err(err) => BatteryInfo::disconnected(label, format!("读取任务失败: {err}")),
        };
        battery_js(&device_id, &info, SystemTime::now())
    }

    /// 托盘图标：按设置里勾选的分类画的电池，PNG data URI。
    pub fn tray_icon() -> String {
        let s = settings::current();
        let samples = hub::board()
            .into_iter()
            .map(|(id, sample)| (id, sample.info))
            .collect();
        let levels = tray_icon::tray_visible_levels(
            &s.tray_device_id,
            &s.selected_by_category,
            &s.tray_categories(),
            &samples,
        );
        tray_icon::png_data_uri(&tray_icon::make_tray_battery_icon(&levels))
    }

    /// 托盘悬停提示：每个勾选分类一行。
    pub fn tray_tooltip() -> String {
        let s = settings::current();
        let samples = hub::board()
            .into_iter()
            .map(|(id, sample)| (id, sample.info))
            .collect();
        tray_icon::tooltip_text(
            &s.tray_device_id,
            &s.selected_by_category,
            &s.tray_categories(),
            &samples,
        )
    }

    /// 这次是不是开机自启拉起来的（带 `--autostart`）：是就只进托盘、不弹窗。
    pub fn launched_at_login() -> bool {
        autostart::launched_at_login()
    }

    /// 开机自启是否已开启（读注册表 Run 值）。
    pub fn autostart_enabled() -> bool {
        autostart::enabled()
    }

    /// 开 / 关开机自启；返回之后的状态。
    pub fn set_autostart(enabled: bool) -> Result<bool, String> {
        let result = autostart::set(enabled)?;
        let _ = settings::update(|s| s.launch_at_login = result);
        Ok(result)
    }

    /// 注册表 Run 值的原文（诊断用）。
    pub fn autostart_command() -> Option<String> {
        autostart::run_value()
    }

    /// 日志文件路径。
    pub fn log_path() -> String {
        app_log::log_file_path().to_string_lossy().into_owned()
    }

    /// 设置文件路径。
    pub fn settings_path() -> String {
        settings::settings_path().to_string_lossy().into_owned()
    }

    /// 在资源管理器里打开日志目录。
    pub fn open_log_dir() -> Result<(), String> {
        let dir = app_log::log_dir();
        std::fs::create_dir_all(&dir).map_err(|e| format!("create log dir failed: {e}"))?;
        #[cfg(windows)]
        {
            std::process::Command::new("explorer")
                .arg(dir.as_os_str())
                .spawn()
                .map_err(|e| format!("open explorer failed: {e}"))?;
        }
        Ok(())
    }

    /// 应用版本。
    pub fn app_version() -> String {
        env!("CARGO_PKG_VERSION").to_string()
    }
}
