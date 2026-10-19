//! 雷柏 VT9 AIR 电量插件。
//!
//! 只被动 `read_timeout` 等 0xBB。勿用 GetInputReport / Feature，会卡死鼠标。

use crate::plugin_sdk::{parse_manifest, BatteryInfo, DevicePlugin};
use hidapi::HidApi;
use std::collections::HashSet;
use std::time::{Duration, Instant};

const RAPOO_VID: u16 = 0x24ae;
const CANDIDATE_PIDS: &[u16] = &[0x1200, 0x4400];
const REPORT_BB: u8 = 0xBB;
const REPORT_BC: u8 = 0xBC;
/// 官方软件挂起中断读时，设备约每 3 秒推一次 BB；我们最多等这么久。
const LISTEN_FOR: Duration = Duration::from_millis(4500);

const MANIFEST_JSON: &str = include_str!("../../../src/plugins/vt9-air/manifest.json");

pub static PLUGIN: DevicePlugin = DevicePlugin {
    manifest_json: MANIFEST_JSON,
    read_battery: read_vt9_battery,
};

/// 打开厂商 HID 集合，仅被动 `read_timeout` 等 0xBB 报告。
fn read_vt9_battery() -> Result<BatteryInfo, String> {
    let api = HidApi::new().map_err(|e| format!("hidapi 初始化失败: {e}"))?;
    let device_label = parse_manifest(MANIFEST_JSON).name;

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
            device: device_label,
            detail: "未找到 Rapoo 接收器。若刚卡死过，请拔插接收器。".into(),
            unsupported: false,
            model_uncertain: false,
        });
    }
    if vendor_paths.is_empty() {
        return Ok(BatteryInfo {
            percent: None,
            charging: None,
            connected: true,
            device: format!("Rapoo {RAPOO_VID:04X}:1200"),
            detail: format!("没有 FF00/0002 集合。接口: {summary}"),
            unsupported: false,
            model_uncertain: false,
        });
    }

    let mut open_errors = Vec::new();
    for (pid, iface, path) in vendor_paths {
        let c_path = match std::ffi::CString::new(path) {
            Ok(p) => p,
            Err(_) => continue,
        };
        let device = match api.open_path(c_path.as_c_str()) {
            Ok(d) => d,
            // 这一条打不开就试下一条。前一条被占用时直接返回，后面可用的接口也读不到。
            Err(e) => {
                open_errors.push(format!("pid={pid:04X} iface={iface} 打开失败: {e}"));
                continue;
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
                            unsupported: false,
                            model_uncertain: false,
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
            unsupported: false,
            model_uncertain: false,
        });
    }

    let open_note = if open_errors.is_empty() {
        String::new()
    } else {
        format!(" {}。", open_errors.join(" | "))
    };
    Ok(BatteryInfo {
        percent: None,
        charging: None,
        connected: true,
        device: device_label,
        detail: format!("未找到含 Report 0xBB 的集合。{open_note}接口: {summary}"),
        unsupported: false,
        model_uncertain: false,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_captured_bb_report() {
        // 抓包样例：第 7 字节 0x38 = 56%
        assert_eq!(
            parse_bb(&[0xbb, 0xb0, 0x51, 0xc4, 0x09, 0x01, 0x38]),
            Some(56)
        );
    }

    #[test]
    fn rejects_incomplete_or_out_of_range_reports() {
        assert_eq!(parse_bb(&[]), None);
        assert_eq!(parse_bb(&[0xbc, 0, 0, 0, 0, 0, 10]), None);
        assert_eq!(parse_bb(&[0xbb, 0, 0, 0, 0, 0]), None);
        assert_eq!(parse_bb(&[0xbb, 0, 0, 0, 0, 0, 101]), None);
        assert_eq!(parse_bb(&[0xbb, 0, 0, 0, 0, 0, 0]), Some(0));
        assert_eq!(parse_bb(&[0xbb, 0, 0, 0, 0, 0, 100]), Some(100));
    }

    #[test]
    fn manifest_is_the_plugin_identity() {
        let meta = PLUGIN.meta();
        assert_eq!(meta.id, "vt9-air");
        assert_eq!(meta.name, "VT9 AIR");
        assert_eq!(meta.category, crate::plugin_sdk::DeviceCategory::Mouse);
    }
}
