//! 雷蛇毒蝰终极版（Razer Viper Ultimate）电量插件。
//!
//! **opt-in Feature 报告**（OpenRazer 文档的 SET_REPORT / GET_REPORT）。
//! 只对 VID `0x1532`、有线 PID `0x007A`、接收器 PID `0x007B` 调用
//! hidapi `send_feature_report` / `get_feature_report`。
//!
//! 不要把这条路径复制到雷柏 VT9 AIR。VT9 只能中断 `read_timeout`，
//! Feature / `GetInputReport` 会卡死那只鼠标。本文件也不调用 `get_input_report`。

use crate::plugin_sdk::{parse_manifest, BatteryInfo, DevicePlugin};
use hidapi::{HidApi, HidDevice};
use std::thread;
use std::time::Duration;

const RAZER_VID: u16 = 0x1532;
/// 有线直连。
const WIRED_PID: u16 = 0x007A;
/// 无线接收器。
const DONGLE_PID: u16 = 0x007B;

/// hidapi 要求 Feature 缓冲的首字节是 Report ID。雷蛇这份 90 字节报告的 ID 是 0。
const REPORT_ID: u8 = 0x00;
const REPORT_LEN: usize = 90;
const FEATURE_LEN: usize = REPORT_LEN + 1;

const CMD_CLASS: u8 = 0x07;
const CMD_BATTERY: u8 = 0x80;
const CMD_CHARGING: u8 = 0x84;
const TRANSACTION_ID: u8 = 0xFF;
const DATA_SIZE: u8 = 0x02;

const STATUS_BUSY: u8 = 0x01;
const STATUS_SUCCESS: u8 = 0x02;

const OFF_STATUS: usize = 0;
const OFF_TRANSACTION: usize = 1;
const OFF_REMAINING: usize = 2;
const OFF_PROTOCOL: usize = 4;
const OFF_DATA_SIZE: usize = 5;
const OFF_CLASS: usize = 6;
const OFF_COMMAND: usize = 7;
const OFF_ARG1: usize = 9;
const OFF_CRC: usize = 88;

/// OpenRazer `RAZER_VIPER_MOUSE_RECEIVER_WAIT_US`：SET 之后再 GET。
const FEATURE_WAIT: Duration = Duration::from_micros(59_900);
const RETRY_PAUSE: Duration = Duration::from_millis(10);
const ATTEMPTS: u8 = 5;

const MANIFEST_JSON: &str = include_str!("../../../src/plugins/razer-viper-ultimate/manifest.json");

pub static PLUGIN: DevicePlugin = DevicePlugin {
    manifest_json: MANIFEST_JSON,
    read_battery: read_viper_ultimate_battery,
};

fn read_viper_ultimate_battery() -> Result<BatteryInfo, String> {
    let api = HidApi::new().map_err(|e| format!("hidapi 初始化失败: {e}"))?;
    let device_label = parse_manifest(MANIFEST_JSON).name;
    let mut candidates = Vec::new();
    for device in api.device_list() {
        if device.vendor_id() != RAZER_VID {
            continue;
        }
        let pid = device.product_id();
        if pid != WIRED_PID && pid != DONGLE_PID {
            continue;
        }
        candidates.push((pid, device.interface_number(), device.path().to_owned()));
    }
    if candidates.is_empty() {
        return Ok(BatteryInfo {
            percent: None,
            charging: None,
            connected: false,
            device: device_label,
            detail: format!(
                "未找到 Viper Ultimate（VID {RAZER_VID:04X}，有线 PID {WIRED_PID:04X} / 接收器 PID {DONGLE_PID:04X}）。"
            ),
            unsupported: false,
            model_uncertain: false,
        });
    }
    candidates.sort_by_key(|(pid, iface, _)| candidate_rank(*pid, *iface));

    let mut errors = Vec::new();
    for (pid, iface, path) in candidates {
        let device = match api.open_path(&path) {
            Ok(device) => device,
            Err(err) => {
                errors.push(format!(
                    "PID {pid:04X} iface={iface} 打开失败: {err}。若 Synapse 占着设备，先关掉再试。"
                ));
                continue;
            }
        };
        match read_open_device(&device) {
            Ok(info) => {
                return Ok(BatteryInfo {
                    device: format!("Razer {RAZER_VID:04X}:{pid:04X} iface={iface}"),
                    ..info
                });
            }
            Err(err) => errors.push(format!("PID {pid:04X} iface={iface}: {err}")),
        }
    }

    Ok(BatteryInfo {
        percent: None,
        charging: None,
        connected: true,
        device: device_label,
        detail: format!("已看到设备，但 Feature 读电量失败。{}", errors.join(" | ")),
        unsupported: false,
        model_uncertain: false,
    })
}

fn candidate_rank(pid: u16, iface: i32) -> (u8, u8, i32) {
    let iface_group = if iface == 0 { 0 } else { 1 };
    let pid_rank = if pid == WIRED_PID { 0 } else { 1 };
    (iface_group, pid_rank, iface)
}

fn read_open_device(device: &HidDevice) -> Result<BatteryInfo, String> {
    let level = exchange(device, CMD_BATTERY)?;
    let percent = scale_level(level);
    let charging = match exchange(device, CMD_CHARGING) {
        Ok(flag) => Some(flag != 0),
        Err(_) => None,
    };
    let charge_text = match charging {
        Some(true) => "充电中",
        Some(false) => "未充电",
        None => "充电状态未知",
    };
    Ok(BatteryInfo {
        percent: Some(percent),
        charging,
        connected: true,
        device: String::new(),
        detail: format!(
            "Feature SET_REPORT/GET_REPORT class {CMD_CLASS:#04X} cmd {CMD_BATTERY:#04X} · raw {level}/255 · {charge_text}"
        ),
        unsupported: false,
        model_uncertain: false,
    })
}

fn exchange(device: &HidDevice, command: u8) -> Result<u8, String> {
    let request = build_feature_request(command);
    let mut last_err = String::from("没有得到有效响应");
    for attempt in 1..=ATTEMPTS {
        if let Err(err) = device.send_feature_report(&request) {
            last_err = format!("SET_REPORT 失败: {err}");
            thread::sleep(RETRY_PAUSE);
            continue;
        }
        thread::sleep(FEATURE_WAIT);
        let mut buf = [0u8; FEATURE_LEN];
        buf[0] = REPORT_ID;
        match device.get_feature_report(&mut buf) {
            Ok(n) => match parse_response(&buf[..n.max(1).min(buf.len())], command) {
                Ok(arg1) => return Ok(arg1),
                Err(err) => last_err = err,
            },
            Err(err) => last_err = format!("GET_REPORT 失败: {err}"),
        }
        if attempt < ATTEMPTS {
            thread::sleep(RETRY_PAUSE);
        }
    }
    Err(last_err)
}

/// 90 字节雷蛇报告前面加 Report ID `0x00`，给 `send_feature_report` 用。
fn build_feature_request(command: u8) -> [u8; FEATURE_LEN] {
    let mut buf = [0u8; FEATURE_LEN];
    buf[0] = REPORT_ID;
    let report = &mut buf[1..];
    report[OFF_STATUS] = 0x00;
    report[OFF_TRANSACTION] = TRANSACTION_ID;
    report[OFF_REMAINING] = 0x00;
    report[OFF_REMAINING + 1] = 0x00;
    report[OFF_PROTOCOL] = 0x00;
    report[OFF_DATA_SIZE] = DATA_SIZE;
    report[OFF_CLASS] = CMD_CLASS;
    report[OFF_COMMAND] = command;
    report[OFF_CRC] = report_crc(report);
    buf
}

/// OpenRazer `razer_calculate_crc`：从第 2 字节异或到第 87 字节（不含 CRC 本身）。
fn report_crc(report: &[u8]) -> u8 {
    report[2..OFF_CRC].iter().fold(0, |crc, byte| crc ^ byte)
}

fn parse_response(buf: &[u8], expect_command: u8) -> Result<u8, String> {
    let report = feature_payload(buf)?;
    parse_report(report, expect_command)
}

fn feature_payload(buf: &[u8]) -> Result<&[u8], String> {
    if buf.len() >= FEATURE_LEN && buf[0] == REPORT_ID {
        return Ok(&buf[1..FEATURE_LEN]);
    }
    if buf.len() >= REPORT_LEN {
        return Ok(&buf[..REPORT_LEN]);
    }
    Err(format!("Feature 响应过短: {} 字节", buf.len()))
}

fn parse_report(report: &[u8], expect_command: u8) -> Result<u8, String> {
    if report.len() < REPORT_LEN {
        return Err(format!("报告长度 {}，需要 {REPORT_LEN}", report.len()));
    }
    let status = report[OFF_STATUS];
    if status != STATUS_SUCCESS && status != STATUS_BUSY {
        return Err(format!(
            "状态 {status:#04X}，需要 {STATUS_SUCCESS:#04X} 或 {STATUS_BUSY:#04X}"
        ));
    }
    if report[OFF_REMAINING] != 0 || report[OFF_REMAINING + 1] != 0 {
        return Err("remaining_packets 不是 0".into());
    }
    if report[OFF_CLASS] != CMD_CLASS || report[OFF_COMMAND] != expect_command {
        return Err(format!(
            "命令不匹配: {:#04X}/{:#04X}，期望 {CMD_CLASS:#04X}/{expect_command:#04X}",
            report[OFF_CLASS], report[OFF_COMMAND]
        ));
    }
    if report[OFF_DATA_SIZE] < 2 {
        return Err(format!(
            "data_size {} 不够读取 arguments[1]",
            report[OFF_DATA_SIZE]
        ));
    }
    Ok(report[OFF_ARG1])
}

/// OpenRazer 把 0–255 换成百分比。249 → 98（四舍五入）。
fn scale_level(level: u8) -> u8 {
    u8::try_from((u16::from(level) * 100 + 127) / 255).unwrap_or(100)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response(command: u8, status: u8, arg1: u8) -> [u8; REPORT_LEN] {
        let mut report = [0u8; REPORT_LEN];
        report[OFF_STATUS] = status;
        report[OFF_TRANSACTION] = TRANSACTION_ID;
        report[OFF_DATA_SIZE] = DATA_SIZE;
        report[OFF_CLASS] = CMD_CLASS;
        report[OFF_COMMAND] = command;
        report[OFF_ARG1] = arg1;
        report[OFF_CRC] = report_crc(&report);
        report
    }

    #[test]
    fn manifest_is_the_plugin_identity() {
        let meta = PLUGIN.meta();
        assert_eq!(meta.id, "razer-viper-ultimate");
        assert_eq!(meta.name, "毒蝰终极版 Viper Ultimate");
        assert_eq!(meta.category, crate::plugin_sdk::DeviceCategory::Mouse);
    }

    #[test]
    fn battery_request_matches_openrazer_layout() {
        let request = build_feature_request(CMD_BATTERY);
        assert_eq!(request.len(), 91);
        assert_eq!(request[0], REPORT_ID);
        let report = &request[1..];
        assert_eq!(report[OFF_STATUS], 0x00);
        assert_eq!(report[OFF_TRANSACTION], 0xFF);
        assert_eq!(report[OFF_DATA_SIZE], 0x02);
        assert_eq!(report[OFF_CLASS], CMD_CLASS);
        assert_eq!(report[OFF_COMMAND], CMD_BATTERY);
        assert_eq!(report[OFF_CRC], 0x85);
        assert_eq!(report[OFF_CRC], report_crc(report));
        assert!(report[8..OFF_CRC].iter().all(|byte| *byte == 0));
    }

    #[test]
    fn scales_openrazer_sample_and_endpoints() {
        assert_eq!(scale_level(249), 98);
        assert_eq!(scale_level(0), 0);
        assert_eq!(scale_level(255), 100);
        assert_eq!(
            parse_report(&response(CMD_BATTERY, STATUS_SUCCESS, 249), CMD_BATTERY),
            Ok(249)
        );
        assert_eq!(
            parse_report(&response(CMD_BATTERY, STATUS_BUSY, 255), CMD_BATTERY),
            Ok(255)
        );
    }

    #[test]
    fn parses_charging_flag_from_same_command_family() {
        assert_eq!(
            parse_report(&response(CMD_CHARGING, STATUS_SUCCESS, 1), CMD_CHARGING),
            Ok(1)
        );
        assert_eq!(
            parse_report(&response(CMD_CHARGING, STATUS_SUCCESS, 0), CMD_CHARGING),
            Ok(0)
        );
    }

    #[test]
    fn rejects_bad_status_wrong_command_and_short_buffer() {
        let mut failed = response(CMD_BATTERY, 0x03, 10);
        assert!(parse_report(&failed, CMD_BATTERY).is_err());

        failed = response(CMD_CHARGING, STATUS_SUCCESS, 1);
        assert!(parse_report(&failed, CMD_BATTERY)
            .unwrap_err()
            .contains("命令不匹配"));

        let mut short = response(CMD_BATTERY, STATUS_SUCCESS, 10);
        short[OFF_DATA_SIZE] = 1;
        assert!(parse_report(&short, CMD_BATTERY)
            .unwrap_err()
            .contains("data_size"));

        assert!(parse_response(&[0x00, 0x02], CMD_BATTERY).is_err());
    }

    #[test]
    fn prefixed_feature_buffer_uses_bytes_after_report_id() {
        let mut buf = [0u8; FEATURE_LEN];
        buf[0] = REPORT_ID;
        buf[1..].copy_from_slice(&response(CMD_BATTERY, STATUS_SUCCESS, 128));
        assert_eq!(parse_response(&buf, CMD_BATTERY), Ok(128));
        assert_eq!(scale_level(128), 50);
    }
}
