//! 迈从 A5 V3 Ultra+（MCHOSE A5 V3 Ultra+）电量插件。
//!
//! **opt-in 厂商报文**：本模块用迈从接收器的 `0x4D` 输出/输入报文邮箱，
//! 不用 `get_input_report`，也不把 Feature 读取当成主通道。
//!
//! 这台 A5 V3 Ultra+(3955) 的接收器（`3837:1018`）有两套接口：
//! - `0xFF01`：真正的命令集合。描述符里是 Feature `0x11`/`0x13`/`0x4D`，
//!   Output `0x4D`/`0x13`，Input `0x11`/`0x13`/`0x4D`。
//! - `0xFF0B`：固件升级集合（`0x2A`/`0x2B`/`0x2D`），不回答电量。
//!
//! 旧文档（alexfrih/mchose-linux、HaloBattery）里的 `0x11` Feature `0x06`
//! 只适用于 M7/A7 V2 等旧固件。本机实测：
//! - `send_feature_report(0x11)` 成功，但 `get_feature_report(0x11)` 恒
//!   Win32 `0x1F`（即使鼠标醒着）；`0x12` 在本接收器上根本不存在。
//! - 写 Output `0x11` / 走中断回退都会 `0x1`，因为 `0x11` 没有 OUT 端点。
//! - M HUB（`mchose.com.cn` 的 WebHID 驱动）对 3955 平台改用 Output/Input
//!   `0x4D` 的 64 字节邮箱：`[0x4D, 0x01, flags, len, cmd_lo, cmd_hi,
//!   biz, seq, data..., checksum]`，`checksum` 为 `2..=7+len` 的异或。
//! - `0x0900` 返回设备信息：vid、pid、connectStatus[10]、chargeStatus[11]、
//!   batteryLevel[12]、gameMode[13]；首包可能是 `FF` 占位，需要重发。
//!
//! 因此：先走 `0x4D/0x0900`，失败再退回旧 `0x11/0x06` Feature；
//! `0x1012` MagDock 只有充电/灯光，不提供电量，不打开它。

use crate::plugin_sdk::{parse_manifest, BatteryInfo, DevicePlugin};
use hidapi::{HidApi, HidDevice};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

const MCHOSE_VID: u16 = 0x3837;
const RECEIVER_PID: u16 = 0x1018;
const MAGDOCK_PID: u16 = 0x1012;
const WIRED_PID: u16 = 0x4026;
const WIRED_3955_PID: u16 = 0x4034;

const CONFIG_PAGE: u16 = 0xFF01;

const MAILBOX_REPORT: u8 = 0x4D;
const MAILBOX_FRAME_LEN: usize = 64;
const MAILBOX_PAYLOAD_LEN: usize = 63;
const CMD_DEVICE_INFO: u16 = 0x0900;

const LEGACY_REPORT: u8 = 0x11;
const LEGACY_PAYLOAD: usize = 20;
const CMD_LEGACY_STATUS: u8 = 0x06;

const ATTEMPTS: u8 = 5;
const REPLY_TIMEOUT: Duration = Duration::from_millis(700);
const RETRY_GAP: Duration = Duration::from_millis(80);

/// 串行化 HID 访问：托盘和首页可能同时触发 `get_battery`。
static READ_LOCK: Mutex<()> = Mutex::new(());

const MANIFEST_JSON: &str =
    include_str!("../../../src/plugins/mchose-a5-v3-ultra-plus/manifest.json");

pub static PLUGIN: DevicePlugin = DevicePlugin {
    manifest_json: MANIFEST_JSON,
    read_battery: read_mchose_a5_v3_ultra_battery,
};

fn read_mchose_a5_v3_ultra_battery() -> Result<BatteryInfo, String> {
    let _guard = READ_LOCK.lock().unwrap_or_else(|err| err.into_inner());
    let api = HidApi::new().map_err(|err| format!("hidapi 初始化失败: {err}"))?;
    let device_label = parse_manifest(MANIFEST_JSON).name;

    let mut candidates = Vec::new();
    let mut enum_notes = Vec::new();
    let mut magdock_note = String::new();
    for device in api.device_list() {
        if device.vendor_id() != MCHOSE_VID {
            continue;
        }
        let pid = device.product_id();
        let page = device.usage_page();
        let usage = device.usage();
        let iface = device.interface_number();
        let product = device.product_string().unwrap_or_default().to_string();

        if pid == MAGDOCK_PID {
            if magdock_note.is_empty() {
                magdock_note =
                    format!("MagDock(1012) page={page:04X} usage={usage:04X} iface={iface}");
            }
            // MagDock 只有 FF00 的 64 字节 IN/OUT，用于充电/灯光，无电量通道。
            continue;
        }

        if pid != RECEIVER_PID && pid != WIRED_PID && pid != WIRED_3955_PID {
            continue;
        }
        enum_notes.push(format!(
            "pid={pid:04X} iface={iface} page={page:04X} usage={usage:04X}"
        ));
        if page != CONFIG_PAGE {
            continue;
        }
        candidates.push((pid, page, usage, iface, device.path().to_owned(), product));
    }

    // 接收器优先；有线鼠标（如果同时插着）垫后。
    candidates.sort_by_key(|(pid, _, usage, iface, _, _)| {
        let pid_pri = if *pid == RECEIVER_PID {
            0u8
        } else if *pid == WIRED_3955_PID {
            1
        } else {
            2
        };
        let usage_pri = if *usage == 1 { 0u8 } else { 1 };
        (pid_pri, usage_pri, *iface)
    });

    if candidates.is_empty() {
        let hint = if enum_notes.is_empty() {
            "未枚举到 3837:1018 接收器（或 0x4026/0x4034 有线鼠标）。".to_string()
        } else {
            format!(
                "已看到设备，但没有 FF01 命令集合：{}。",
                enum_notes.join(", ")
            )
        };
        let dock = if magdock_note.is_empty() {
            String::new()
        } else {
            format!(" {magdock_note} 仅用于充电/灯光，不提供电量。")
        };
        return Ok(BatteryInfo {
            percent: None,
            charging: None,
            connected: false,
            device: device_label,
            detail: format!(
                "未找到迈从电量命令集合（VID {MCHOSE_VID:04X} PID {RECEIVER_PID:04X}）。{hint}{dock}"
            ),
        });
    }

    let mut errors = Vec::new();
    for (pid, page, usage, iface, path, product) in &candidates {
        let device = match api.open_path(path) {
            Ok(device) => device,
            Err(err) => {
                errors.push(format!(
                    "pid={pid:04X} page={page:04X} usage={usage:04X} iface={iface} 打开失败: {err}（若开着 M HUB，请先关掉）"
                ));
                continue;
            }
        };

        let label = if product.is_empty() {
            format!("MCHOSE {MCHOSE_VID:04X}:{pid:04X}")
        } else {
            product.clone()
        };
        let device_name = format!("{label} page={page:04X} iface={iface}");

        let mailbox_err = match read_via_mailbox(&device) {
            Ok(info) => {
                return Ok(BatteryInfo {
                    device: device_name,
                    ..info
                });
            }
            Err(err) => err,
        };

        match read_via_legacy_feature(&device) {
            Ok(info) => {
                return Ok(BatteryInfo {
                    device: format!("{device_name} · Feature 0x11"),
                    ..info
                });
            }
            Err(legacy_err) => errors.push(format!(
                "pid={pid:04X} page={page:04X} usage={usage:04X} iface={iface}: 0x4D/0x0900: {mailbox_err}；0x11/0x06: {legacy_err}"
            )),
        }
    }

    let dock_note = if magdock_note.is_empty() {
        String::new()
    } else {
        format!(" {magdock_note} 仅充电/灯光，电量仍取接收器 1018。")
    };

    Ok(BatteryInfo {
        percent: None,
        charging: None,
        connected: true,
        device: device_label,
        detail: format!(
            "已看到迈从接收器，但没读到电量。请确认鼠标已开机并与接收器 2.4G 配对，然后动一下唤醒；若开着官方 M HUB 请先关掉（HID 会被占用）。{dock_note} 明细：{}",
            errors.join(" · ")
        ),
    })
}

/// 迈从 3955 平台的 0x4D 邮箱：读 `0x0900` 设备信息。
fn read_via_mailbox(device: &HidDevice) -> Result<BatteryInfo, String> {
    let _ = device.set_blocking_mode(false);
    let mut last_err = String::from("没有得到 0x0900 回包");

    for attempt in 1..=ATTEMPTS {
        drain_input(device);
        let frame = mailbox_frame(CMD_DEVICE_INFO, &[]);
        device
            .write(&frame)
            .map_err(|err| format!("写 0x4D 报文失败: {err}"))?;

        match read_mailbox_reply(device, CMD_DEVICE_INFO, REPLY_TIMEOUT) {
            Ok(data) => match parse_mailbox_info(&data) {
                Ok(info) => {
                    return Ok(BatteryInfo {
                        detail: format!("接收器邮箱 0x4D/0x0900 · {}", info.detail),
                        ..info
                    });
                }
                Err(err) => {
                    last_err = format!("attempt {attempt}: {err}");
                }
            },
            Err(err) => {
                last_err = format!("attempt {attempt}: {err}");
            }
        }
        thread::sleep(RETRY_GAP);
    }

    Err(last_err)
}

fn mailbox_frame(cmd: u16, data: &[u8]) -> Vec<u8> {
    let data = &data[..data.len().min(MAILBOX_PAYLOAD_LEN - 8)];
    let mut frame = vec![0u8; MAILBOX_FRAME_LEN];
    frame[0] = MAILBOX_REPORT;
    frame[1] = 0x01;
    frame[2] = 0x01; // flags: 带校验
    frame[3] = data.len() as u8;
    frame[4] = (cmd & 0xFF) as u8;
    frame[5] = (cmd >> 8) as u8;
    frame[6] = 0x00; // bizCode
    frame[7] = 0x00; // sequence
    frame[8..8 + data.len()].copy_from_slice(data);
    let mut checksum = 0u8;
    for byte in &frame[2..=7 + data.len()] {
        checksum ^= *byte;
    }
    frame[8 + data.len()] = checksum;
    frame
}

fn read_mailbox_reply(
    device: &HidDevice,
    expect_cmd: u16,
    timeout: Duration,
) -> Result<Vec<u8>, String> {
    let deadline = Instant::now() + timeout;
    let mut last_cmd = None;
    while Instant::now() < deadline {
        let mut buf = [0u8; 128];
        match device.read_timeout(&mut buf, 100) {
            Ok(0) => continue,
            Ok(n) => {
                if let Some((cmd, data)) = parse_mailbox_frame(&buf[..n]) {
                    if cmd == expect_cmd {
                        return Ok(data);
                    }
                    last_cmd = Some(cmd);
                }
            }
            Err(err) => return Err(format!("读 0x4D 报文失败: {err}")),
        }
    }
    match last_cmd {
        Some(cmd) => Err(format!(
            "等待 0x{expect_cmd:04X} 回包超时（期间收到 0x{cmd:04X}）"
        )),
        None => Err(format!("等待 0x{expect_cmd:04X} 回包超时")),
    }
}

fn parse_mailbox_frame(buf: &[u8]) -> Option<(u16, Vec<u8>)> {
    if buf.len() < 8 || buf[0] != MAILBOX_REPORT {
        return None;
    }
    let payload = &buf[1..];
    let data_len = payload[2] as usize;
    let cmd = u16::from(payload[3]) | (u16::from(payload[4]) << 8);
    let available = payload.len().saturating_sub(7);
    let data_len = data_len.min(available);
    Some((cmd, payload[7..7 + data_len].to_vec()))
}

fn parse_mailbox_info(data: &[u8]) -> Result<BatteryInfo, String> {
    // 首包有时是 FF 占位，等设备准备好后重发即可。
    if data.first() == Some(&0xFF) {
        return Err("0x0900 返回 FF 占位（接收器尚未准备好）".to_string());
    }
    if data.len() < 14 {
        return Err(format!(
            "0x0900 回包过短: {} 字节（首字节 {:#04X}）",
            data.len(),
            data.first().copied().unwrap_or(0)
        ));
    }

    let vid = u16::from_le_bytes([data[0], data[1]]);
    let model = u16::from_le_bytes([data[2], data[3]]);
    let connect = data[10];
    let charge = data[11];
    let level = data[12];
    let _game = data[13];

    if vid != MCHOSE_VID {
        return Err(format!("vid {vid:#06X} 不是迈从（期望 {MCHOSE_VID:#06X}）"));
    }
    if level > 100 {
        return Err(format!("电量 {level} 超出 0–100"));
    }
    if level == 0 && connect == 0 {
        return Err(format!(
            "接收器未收到鼠标链路（connect=0，model {model:#06X}）"
        ));
    }

    let charging = charge != 0;
    Ok(BatteryInfo {
        percent: Some(level),
        charging: Some(charging),
        connected: true,
        device: String::new(),
        detail: format!(
            "model {model:#06X} · connect={connect} · {} · {level}%",
            if charging { "充电中" } else { "未充电" }
        ),
    })
}

/// 旧 MCHOSE 固件（M7 / A7 V2 等）：`0x11` Feature `0x06`。
///
/// 只发 Feature SET + GET；不做 Output `0x11`、不走 0x12、不碰 FF0B。
fn read_via_legacy_feature(device: &HidDevice) -> Result<BatteryInfo, String> {
    let mut last_err = String::from("没有得到 0x11/0x06 回包");

    for attempt in 1..=ATTEMPTS {
        let request = legacy_request(CMD_LEGACY_STATUS);
        device
            .send_feature_report(&request)
            .map_err(|err| format!("send_feature_report 0x11 失败: {err}"))?;
        thread::sleep(RETRY_GAP);

        let mut buf = vec![0u8; LEGACY_PAYLOAD + 1];
        buf[0] = LEGACY_REPORT;
        match device.get_feature_report(&mut buf) {
            Ok(n) => {
                let resp = &buf[..n.max(1).min(buf.len())];
                match parse_legacy_status(resp) {
                    Ok(info) => {
                        return Ok(BatteryInfo {
                            detail: format!("Feature 0x11/0x06 · {}", info.detail),
                            ..info
                        });
                    }
                    Err(err) => last_err = format!("attempt {attempt}: {err}"),
                }
            }
            Err(err) => {
                last_err = format!("attempt {attempt}: get_feature_report 0x11 失败: {err}");
            }
        }
        thread::sleep(RETRY_GAP);
    }

    Err(last_err)
}

fn legacy_request(cmd: u8) -> Vec<u8> {
    let mut body = vec![0u8; LEGACY_PAYLOAD];
    body[0] = cmd;
    let mut frame = Vec::with_capacity(LEGACY_PAYLOAD + 1);
    frame.push(LEGACY_REPORT);
    frame.extend(body.iter().map(|byte| byte ^ 0xFF));
    frame
}

fn parse_legacy_status(resp: &[u8]) -> Result<BatteryInfo, String> {
    if resp.len() < 13 {
        return Err(format!("响应过短: {} 字节", resp.len()));
    }
    if resp[0] != LEGACY_REPORT {
        return Err(format!("report 不匹配: {:#04X}", resp[0]));
    }
    if resp[1] != (CMD_LEGACY_STATUS ^ 0xFF) {
        return Err(format!(
            "cmd echo {:#04X}，期望 {:#04X}",
            resp[1],
            CMD_LEGACY_STATUS ^ 0xFF
        ));
    }

    let payload: Vec<u8> = resp[2..].iter().map(|byte| byte ^ 0xFF).collect();
    if payload.len() < 11 {
        return Err(format!("payload 过短: {} 字节", payload.len()));
    }

    let vid = u16::from_le_bytes([payload[0], payload[1]]);
    let model = u16::from_le_bytes([payload[2], payload[3]]);
    let flags = payload[8];
    let level = payload[9];
    let charge = payload[10];

    if vid == 0 || model == 0 {
        return Err(format!(
            "空 payload / 无链路（vid={vid:#06X} model={model:#06X}）"
        ));
    }
    if vid != MCHOSE_VID && vid != 0x5253 {
        return Err(format!(
            "vid {vid:#06X} 不是迈从（期望 {MCHOSE_VID:#06X}/0x5253）"
        ));
    }
    if level > 100 {
        return Err(format!("电量 {level} 超出 0–100"));
    }

    let charging = charge == 1;
    Ok(BatteryInfo {
        percent: Some(level),
        charging: Some(charging),
        connected: true,
        device: String::new(),
        detail: format!(
            "model {model:#06X} · flags {flags:#04X} · {} · {level}%",
            if charging { "充电中" } else { "未充电" }
        ),
    })
}

fn drain_input(device: &HidDevice) {
    for _ in 0..32 {
        let mut buf = [0u8; 128];
        match device.read_timeout(&mut buf, 0) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_is_the_plugin_identity() {
        let meta = PLUGIN.meta();
        assert_eq!(meta.id, "mchose-a5-v3-ultra-plus");
        assert_eq!(meta.name, "迈从 A5 V3 Ultra+");
        assert_eq!(meta.category, crate::plugin_sdk::DeviceCategory::Mouse);
    }

    #[test]
    fn mailbox_frame_matches_m_hub_0x0900() {
        let frame = mailbox_frame(CMD_DEVICE_INFO, &[]);
        assert_eq!(frame.len(), 64);
        assert_eq!(
            &frame[..9],
            &[0x4D, 0x01, 0x01, 0x00, 0x00, 0x09, 0x00, 0x00, 0x08]
        );
        assert!(frame[9..].iter().all(|byte| *byte == 0));
    }

    #[test]
    fn parses_measured_0x0900_reply() {
        // 本机实测：4D 01 01 10 00 09 00 00 | 37 38 26 40 04 00 00 00
        //           00 10 02 00 49 00 08 E4 C2
        let mut raw = vec![0x4D, 0x01, 0x01, 0x10, 0x00, 0x09, 0x00, 0x00];
        raw.extend([
            0x37, 0x38, 0x26, 0x40, 0x04, 0x00, 0x00, 0x00, 0x00, 0x10, 0x02, 0x00, 0x49, 0x00,
            0x08, 0xE4, 0xC2,
        ]);
        let (cmd, data) = parse_mailbox_frame(&raw).unwrap();
        assert_eq!(cmd, 0x0900);
        let info = parse_mailbox_info(&data).unwrap();
        assert_eq!(info.percent, Some(73));
        assert_eq!(info.charging, Some(false));
        assert!(info.connected);
    }

    #[test]
    fn rejects_ff_placeholder_and_empty_link() {
        let ff = vec![0xFF];
        assert!(parse_mailbox_info(&ff).is_err());

        let mut data = vec![0u8; 14];
        data[0] = 0x37;
        data[1] = 0x38;
        assert!(parse_mailbox_info(&data).is_err());
    }

    #[test]
    fn rejects_out_of_range_mailbox_level() {
        let mut data = vec![0u8; 14];
        data[0] = 0x37;
        data[1] = 0x38;
        data[2] = 0x26;
        data[3] = 0x40;
        data[10] = 2;
        data[12] = 101;
        assert!(parse_mailbox_info(&data).unwrap_err().contains("超出"));
    }

    #[test]
    fn parses_legacy_halobattery_sample() {
        let payload = [
            0x53u8, 0x52, 0x31, 0x00, 0x02, 0x05, 0x07, 0x00, 0x09, 0x64, 0x00, 0x64,
        ];
        let mut resp = vec![LEGACY_REPORT, CMD_LEGACY_STATUS ^ 0xFF];
        resp.extend(payload.iter().map(|byte| byte ^ 0xFF));
        let info = parse_legacy_status(&resp).unwrap();
        assert_eq!(info.percent, Some(100));
        assert_eq!(info.charging, Some(false));
    }

    #[test]
    fn rejects_legacy_empty_payload() {
        let mut resp = vec![LEGACY_REPORT, CMD_LEGACY_STATUS ^ 0xFF];
        resp.extend(std::iter::repeat(0xFF).take(LEGACY_PAYLOAD));
        let err = parse_legacy_status(&resp).unwrap_err();
        assert!(err.contains("空 payload") || err.contains("无链路"));
    }

    #[test]
    fn legacy_request_is_inverted_short_frame() {
        let request = legacy_request(CMD_LEGACY_STATUS);
        assert_eq!(request.len(), LEGACY_PAYLOAD + 1);
        assert_eq!(request[0], LEGACY_REPORT);
        assert_eq!(request[1], CMD_LEGACY_STATUS ^ 0xFF);
        assert!(request[2..].iter().all(|byte| *byte == 0xFF));
    }
}
