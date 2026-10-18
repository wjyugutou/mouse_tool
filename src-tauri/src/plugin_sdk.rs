//! 设备插件契约（构建期，不是动态库）。
//!
//! 每只设备提供一份与前端共用的 `manifest.json`，外加一个电量函数。
//! 壳层用 `get_battery(device_id)` 按 id 分发；设置、更新、日志不属于插件。

use serde::{Deserialize, Serialize};

/// 一级分类。与前端 `DeviceCategory` 同一套取值：`mouse` / `keyboard` / `headset`。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DeviceCategory {
    Mouse,
    Keyboard,
    Headset,
}

/// 前端 `DeviceMeta` 与 `manifest.json` 的同一份字段。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceMeta {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: DeviceCategory,
}

/// 电量结果。字段名与前端 `BatteryInfo` 一致。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BatteryInfo {
    pub percent: Option<u8>,
    pub charging: Option<bool>,
    pub connected: bool,
    pub device: String,
    pub detail: String,
}

impl BatteryInfo {
    pub fn disconnected(device: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            percent: None,
            charging: None,
            connected: false,
            device: device.into(),
            detail: detail.into(),
        }
    }
}

/// 编译期注册的一只鼠标。
pub struct DevicePlugin {
    /// `include_str!` 进来的 manifest，与前端插件目录是同一个文件。
    pub manifest_json: &'static str,
    /// 读取电量。默认只做中断读。
    /// Feature 报告只允许模块文档写明 opt-in 的插件使用（雷蛇）。
    /// 雷柏 VT9 禁止 Feature / `GetInputReport`。
    pub read_battery: fn() -> Result<BatteryInfo, String>,
}

impl DevicePlugin {
    pub fn meta(&self) -> DeviceMeta {
        parse_manifest(self.manifest_json)
    }
}

pub fn parse_manifest(manifest_json: &str) -> DeviceMeta {
    serde_json::from_str(manifest_json)
        .unwrap_or_else(|err| panic!("设备插件 manifest 无法解析: {err}\n{manifest_json}"))
}
