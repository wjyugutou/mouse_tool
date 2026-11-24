//! 设置：Rust 是唯一所有者，TSX 只读快照、通过函数改。
//!
//! 落盘为 `%APPDATA%\com.wwwj.mousetool\nsh\settings.json`，字段与 Tauri 版
//! tauri-plugin-zustand 的 `settings.json` 相同。自己的文件还不存在时，读一次 Tauri 版的文件
//! 作为初值（只读，不改它），这样升级后设置不丢。

use crate::app_log;
use crate::devices;
use crate::plugin_sdk::DeviceCategory;
use crate::tray_icon::{
    category_key, default_tray_category_keys, resolve_selection, sanitize_tray_categories,
    SelectedByCategory,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// 应用 id，与 Tauri 版、nsh.json 相同。数据目录按它命名。
pub(crate) const APP_ID: &str = "com.wwwj.mousetool";
/// 与旧前端 `DEFAULT_AUTO_INTERVAL_SEC` 相同。
pub(crate) const DEFAULT_AUTO_INTERVAL_SEC: u64 = 300;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct Settings {
    pub auto_interval_sec: u64,
    pub theme_mode: String,
    pub close_behavior: String,
    /// 托盘图标当前显示哪一只的电量。
    pub tray_device_id: String,
    pub selected_by_category: SelectedByCategory,
    /// 托盘图标与悬停提示要展示的分类。
    pub tray_categories: Vec<String>,
    /// 旧版设置页的镜像字段；真正的状态以注册表 Run 值为准（见 `autostart`）。
    pub launch_at_login: bool,
    /// 首页和托盘共用的自动采样开关。
    pub auto_refresh: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_interval_sec: DEFAULT_AUTO_INTERVAL_SEC,
            theme_mode: "dark".into(),
            close_behavior: "tray".into(),
            tray_device_id: devices::default_device_id(),
            selected_by_category: SelectedByCategory::default(),
            tray_categories: default_tray_category_keys(),
            launch_at_login: false,
            auto_refresh: true,
        }
    }
}

impl Settings {
    /// 与旧前端 store 同一套规则：间隔 3～300 秒，丢掉不认识的值和设备。
    pub(crate) fn normalized(mut self) -> Self {
        self.auto_interval_sec = self.auto_interval_sec.clamp(3, 300);
        if !matches!(self.theme_mode.as_str(), "light" | "dark" | "system") {
            self.theme_mode = "dark".into();
        }
        if !matches!(self.close_behavior.as_str(), "quit" | "tray") {
            self.close_behavior = "tray".into();
        }
        if devices::find(&self.tray_device_id).is_none() {
            self.tray_device_id = devices::default_device_id();
        }
        self.selected_by_category =
            resolve_selection(&self.tray_device_id, &self.selected_by_category);
        self.tray_categories = sanitize_tray_categories(&self.tray_categories)
            .into_iter()
            .map(|category| category_key(category).to_string())
            .collect();
        self
    }

    pub(crate) fn tray_categories(&self) -> Vec<DeviceCategory> {
        sanitize_tray_categories(&self.tray_categories)
    }

    pub(crate) fn interval(&self) -> Duration {
        Duration::from_secs(self.auto_interval_sec.clamp(3, 300))
    }
}

static STATE: OnceLock<Mutex<Settings>> = OnceLock::new();

fn state() -> &'static Mutex<Settings> {
    STATE.get_or_init(|| Mutex::new(load()))
}

/// 当前设置的一份拷贝。
pub(crate) fn current() -> Settings {
    state().lock().unwrap_or_else(|err| err.into_inner()).clone()
}

/// 在锁里改一次设置并落盘；返回 (改前, 改后)。没变就不写盘。
pub(crate) fn update(f: impl FnOnce(&mut Settings)) -> (Settings, Settings) {
    let mut guard = state().lock().unwrap_or_else(|err| err.into_inner());
    let prev = guard.clone();
    let mut next = prev.clone();
    f(&mut next);
    let next = next.normalized();
    if next != prev {
        *guard = next.clone();
        save(&next);
    }
    (prev, next)
}

/// 应用数据目录：`%APPDATA%\<id>`（与 Tauri 版、NSH 默认 dataDir 相同）。
pub(crate) fn data_dir() -> PathBuf {
    #[cfg(windows)]
    {
        if let Ok(base) = std::env::var("APPDATA") {
            return PathBuf::from(base).join(APP_ID);
        }
    }
    #[cfg(not(windows))]
    {
        if let Ok(base) = std::env::var("HOME") {
            return PathBuf::from(base).join(".local").join("share").join(APP_ID);
        }
    }
    PathBuf::from(".")
}

pub(crate) fn settings_path() -> PathBuf {
    data_dir().join("nsh").join("settings.json")
}

/// Tauri 版 tauri-plugin-zustand 存的设置，只读。
fn legacy_path() -> PathBuf {
    data_dir().join("tauri-plugin-zustand").join("settings.json")
}

fn read(path: &PathBuf) -> Option<Settings> {
    let text = std::fs::read_to_string(path).ok()?;
    match serde_json::from_str::<Settings>(&text) {
        Ok(settings) => Some(settings),
        Err(err) => {
            app_log::warn(&format!("settings {} unreadable: {err}", path.display()));
            None
        }
    }
}

fn load() -> Settings {
    let own = settings_path();
    if let Some(settings) = read(&own) {
        return settings.normalized();
    }
    let legacy = legacy_path();
    if let Some(settings) = read(&legacy) {
        app_log::info(&format!("settings: start from Tauri store {}", legacy.display()));
        return settings.normalized();
    }
    Settings::default().normalized()
}

fn save(settings: &Settings) {
    let path = settings_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let text = match serde_json::to_string_pretty(settings) {
        Ok(text) => text,
        Err(err) => {
            app_log::error(&format!("settings serialize failed: {err}"));
            return;
        }
    };
    // 先写临时文件再改名，进程中途被杀也不会留下半个 JSON。
    let tmp = path.with_extension("json.tmp");
    let result = std::fs::write(&tmp, text).and_then(|()| std::fs::rename(&tmp, &path));
    if let Err(err) = result {
        app_log::error(&format!("settings save {} failed: {err}", path.display()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_tauri_store_shape() {
        let text = r#"{"launchAtLogin":true,"themeMode":"dark","closeBehavior":"tray","selectedByCategory":{"headset":null,"keyboard":null,"mouse":"razer-viper-ultimate"},"autoRefresh":true,"trayDeviceId":"razer-viper-ultimate","autoIntervalSec":300,"trayCategories":["mouse"]}"#;
        let settings: Settings = serde_json::from_str(text).unwrap();
        let settings = settings.normalized();
        assert_eq!(settings.tray_device_id, "razer-viper-ultimate");
        assert_eq!(settings.selected_by_category.mouse.as_deref(), Some("razer-viper-ultimate"));
        assert_eq!(settings.tray_categories, vec!["mouse".to_string()]);
        assert_eq!(settings.auto_interval_sec, 300);
    }

    #[test]
    fn normalizes_bad_values() {
        let settings = Settings {
            auto_interval_sec: 1,
            theme_mode: "neon".into(),
            close_behavior: "explode".into(),
            tray_device_id: "missing".into(),
            tray_categories: vec![],
            ..Settings::default()
        }
        .normalized();
        assert_eq!(settings.auto_interval_sec, 3);
        assert_eq!(settings.theme_mode, "dark");
        assert_eq!(settings.close_behavior, "tray");
        assert_eq!(settings.tray_device_id, devices::default_device_id());
        assert_eq!(settings.tray_categories, vec!["mouse".to_string()]);
    }
}
