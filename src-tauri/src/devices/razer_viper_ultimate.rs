//! 雷蛇毒蝰终极版（Razer Viper Ultimate）电量插件。
//!
//! 只枚举 HID，不打开设备。OpenRazer 读电量要先发 Feature `SET_REPORT`，
//! 再发 `GET_REPORT`（都是控制传输）。本项目禁止这类传输，所以这里不读电量。

use crate::plugin_sdk::{parse_manifest, BatteryInfo, DevicePlugin};
use hidapi::HidApi;

const RAZER_VID: u16 = 0x1532;
/// 有线直连。
const WIRED_PID: u16 = 0x007A;
/// 无线接收器。
const DONGLE_PID: u16 = 0x007B;

const MANIFEST_JSON: &str = include_str!("../../../src/plugins/razer-viper-ultimate/manifest.json");

pub static PLUGIN: DevicePlugin = DevicePlugin {
    manifest_json: MANIFEST_JSON,
    read_battery: read_viper_ultimate_battery,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Presence {
    wired: bool,
    dongle: bool,
}

fn read_viper_ultimate_battery() -> Result<BatteryInfo, String> {
    let api = HidApi::new().map_err(|e| format!("hidapi 初始化失败: {e}"))?;
    let mut presence = Presence {
        wired: false,
        dongle: false,
    };
    for device in api.device_list() {
        if device.vendor_id() != RAZER_VID {
            continue;
        }
        match device.product_id() {
            WIRED_PID => presence.wired = true,
            DONGLE_PID => presence.dongle = true,
            _ => {}
        }
    }
    Ok(battery_status(
        &parse_manifest(MANIFEST_JSON).name,
        presence,
    ))
}

/// 在线与否都不会返回电量。已知但被禁用的报告见模块注释与 `blocked_protocol`。
fn battery_status(device_label: &str, presence: Presence) -> BatteryInfo {
    let blocked = blocked_protocol();
    if !presence.wired && !presence.dongle {
        return BatteryInfo {
            percent: None,
            charging: None,
            connected: false,
            device: device_label.to_string(),
            detail: format!(
                "未找到 Viper Ultimate（VID {RAZER_VID:04X}，有线 PID {WIRED_PID:04X} / 接收器 PID {DONGLE_PID:04X}）。{blocked}"
            ),
        };
    }

    let link = match (presence.wired, presence.dongle) {
        (true, true) => format!("有线 {WIRED_PID:04X} 与接收器 {DONGLE_PID:04X}"),
        (true, false) => format!("有线 {WIRED_PID:04X}"),
        (false, true) => format!("接收器 {DONGLE_PID:04X}"),
        (false, false) => unreachable!("上面已处理两路都不在线"),
    };
    BatteryInfo {
        percent: None,
        charging: None,
        connected: true,
        device: format!("Razer {RAZER_VID:04X} {link}"),
        detail: format!("已识别 {link}。{blocked}"),
    }
}

fn blocked_protocol() -> &'static str {
    "未读电量：OpenRazer 的路径是 Feature SET_REPORT 再 GET_REPORT（控制传输，report id 0x00，class 0x07 cmd 0x80，transaction 0xFF，电量在 arguments[1]，0–255 需换算成百分比）。充电状态是 class 0x07 cmd 0x84。这类传输已禁用。"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_is_the_plugin_identity() {
        let meta = PLUGIN.meta();
        assert_eq!(meta.id, "razer-viper-ultimate");
        assert_eq!(meta.name, "毒蝰终极版 Viper Ultimate");
    }

    #[test]
    fn absent_device_is_explicitly_unsupported() {
        let info = battery_status(
            "毒蝰终极版 Viper Ultimate",
            Presence {
                wired: false,
                dongle: false,
            },
        );
        assert!(!info.connected);
        assert!(info.percent.is_none());
        assert!(info.charging.is_none());
        assert!(info.detail.contains("007A"));
        assert!(info.detail.contains("007B"));
        assert!(info.detail.contains("SET_REPORT"));
        assert!(info.detail.contains("0x80"));
    }

    #[test]
    fn present_device_stays_without_a_battery_percent() {
        let dongle = battery_status(
            "毒蝰终极版 Viper Ultimate",
            Presence {
                wired: false,
                dongle: true,
            },
        );
        assert!(dongle.connected);
        assert!(dongle.percent.is_none());
        assert!(dongle.detail.contains("007B"));
        assert!(dongle.detail.contains("GET_REPORT"));

        let both = battery_status(
            "毒蝰终极版 Viper Ultimate",
            Presence {
                wired: true,
                dongle: true,
            },
        );
        assert!(both.connected);
        assert!(both.percent.is_none());
        assert!(both.detail.contains("007A"));
        assert!(both.detail.contains("007B"));
    }
}
