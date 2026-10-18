//! VGN S99 机械键盘电量插件。
//!
//! **opt-in 厂商报文**：本模块用 `0xFF1C` 厂商接口的 **Output 报文 + Input 中断读回**，
//! 参照 `mchose_a5_v3_ultra.rs` 的邮箱模式。不用 `get_input_report`，也不用 Feature 报告。
//!
//! ## 协议来源（2026-10-19 实机验证通过）
//!
//! VGN 官方驱动 VGN VHUB 4.0.6 是 Electron 应用，渲染层 JS 明文可读。
//! 电量逻辑在 `dist/renderer/assets/home-BW6QrJDS.js` 的 `class WsServe`：
//!
//! - 命令：`getElectricQuantity()` → `Uint8Array([0, 0, WsCmd.GetBatterLevel, 6, 0, 0, 0])`
//! - `WsCmd.GetBatterLevel = 26 = 0x1A`（枚举定义在 `v98ProV4.keyboard.assets-*.js`）
//! - 发送：`sendBuffer()` 用 `device.sendReport(reportId, data)` → **Output 报告**
//! - 回包：`readBuffer()` 里 `monitorData[2] == 26` 时
//!   `battery.level = remainingHex[0]`（`remainingHex = monitorData.slice(7)`）
//!   `battery.charging = remainingHex[1]`
//!
//! ## 为什么不用 Feature 报告
//!
//! `0xFF1C`（即 `MI_01&Col04`）的报告描述符实测只有：
//! `81 00`（Input 63B）与 `91 00`（Output 63B），**没有任何 `B1` Feature 项**。
//! Windows `HidD_SetFeature` 对该接口固定返回 `0x1`，故 Feature 通道不可用。
//!
//! ## hidapi 下标偏移（关键坑）
//!
//! 官方是 node-hid 的 `oninputreport`，其 `event.data` **不含** Report ID；
//! hidapi 的 `read_timeout` 回包 **含** Report ID 在 `buf[0]`。
//! 因此本模块收到回包后整体偏移 +1：
//!
//! | 含义 | 官方 JS 下标 | hidapi 下标 |
//! | --- | --- | --- |
//! | 命令码 | `[2]` | `[3]` |
//! | 电量 | `[7]` | `[8]` |
//! | 充电 | `[8]` | `[9]` |
//!
//! ## 实测回包样例
//!
//! 发 `04 00 00 1A 06 00 00 00 ...`（64 字节，buf[0] 是 Report ID 0x04），收到：
//!
//! ```text
//! 04 00 00 1A 06 00 00 00 32 00 00 00 ...
//!                            ↑  ↑
//!                        电量 50  未充电
//! ```
//!
//! ## 安全约束
//!
//! - 只发 `0x1A` 这一条**只读查询**命令，绝不发任何 `SET_*` 写配置命令
//! - 最多重试有限次，不循环轰炸
//! - `get_input_report` 对任何设备都不许用（项目硬规则）
//! - SM99 这只设备「不主动推送」，只能主机问一次、设备答一次

use crate::plugin_sdk::{parse_manifest, BatteryInfo, DevicePlugin};
use hidapi::{HidApi, HidDevice};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

const VGN_VID: u16 = 0x320F;
/// 2.4G 接收器 PID（有线版是 0x5055，本版只做接收器）。
const RECEIVER_PID: u16 = 0x5088;
/// 厂商自定义接口（`MI_01&Col04`）。注意不是 Col01（那是标准键盘）。
const VENDOR_USAGE_PAGE: u16 = 0xFF1C;

/// 厂商接口的 Report ID，描述符里 `85 04`。
const REPORT_ID: u8 = 0x04;
/// Output / Input 报告 payload 长度，描述符 `95 3F` = 63 字节。
const REPORT_PAYLOAD_LEN: usize = 63;
/// 含 Report ID 的完整帧长。
const FRAME_LEN: usize = REPORT_PAYLOAD_LEN + 1;

/// `WsCmd.GetBatterLevel` = 26 = 0x1A。
const CMD_GET_BATTERY: u8 = 0x1A;
/// 命令第 4 字节固定 6，来自官方 `[0, 0, WsCmd.GetBatterLevel, 6, 0, 0, 0]`。
const CMD_PAYLOAD_TAIL: u8 = 0x06;

const ATTEMPTS: u8 = 3;
const REPLY_TIMEOUT: Duration = Duration::from_millis(500);
const RETRY_GAP: Duration = Duration::from_millis(120);

/// 串行化 HID 访问：托盘和首页可能同时触发 `get_battery`。
static READ_LOCK: Mutex<()> = Mutex::new(());

const MANIFEST_JSON: &str = include_str!("../../../src/plugins/vgn-s99/manifest.json");

pub static PLUGIN: DevicePlugin = DevicePlugin {
    manifest_json: MANIFEST_JSON,
    read_battery: read_vgn_s99_battery,
};

/// 拼一条电量查询命令（含 Report ID）。
///
/// 官方命令是 7 字节 `[0x00, 0x00, 0x1A, 0x06, 0x00, 0x00, 0x00]`，
/// 放进 64 字节帧：`buf[0]` 是 Report ID，其余补零。
fn battery_request() -> [u8; FRAME_LEN] {
    let mut frame = [0u8; FRAME_LEN];
    frame[0] = REPORT_ID;
    // 官方命令从 payload 第 0 字节开始，所以落到 frame[1..]。
    // 命令码 0x1A 在 frame[1 + 2] = frame[3]。
    frame[3] = CMD_GET_BATTERY;
    frame[4] = CMD_PAYLOAD_TAIL;
    frame
}

/// 从回包里取电量。返回 `Ok((percent, charging))`。
///
/// 兼容两种回包形态：
/// - 带 Report ID（hidapi 默认）：`buf[3] == 0x1A`，电量 `buf[8]`，充电 `buf[9]`
/// - 不带 Report ID：`buf[2] == 0x1A`，电量 `buf[7]`，充电 `buf[8]`
fn parse_battery_reply(resp: &[u8]) -> Result<(u8, bool), String> {
    let has_report_id = resp.first() == Some(&REPORT_ID);
    let base = usize::from(has_report_id);
    let cmd_at = base + 2;
    let level_at = base + 7;
    let charging_at = base + 8;

    if resp.len() <= cmd_at {
        return Err(format!(
            "响应包过短: {} 字节，取不到命令码（需要 > {cmd_at}）",
            resp.len()
        ));
    }
    if resp[cmd_at] != CMD_GET_BATTERY {
        return Err(format!(
            "不是电量回包: 命令码 0x{:02X}，期望 0x{CMD_GET_BATTERY:02X}",
            resp[cmd_at]
        ));
    }
    if resp.len() <= charging_at {
        return Err(format!(
            "响应包过短: {} 字节，取不到充电状态（需要 > {charging_at}）",
            resp.len()
        ));
    }

    let level = resp[level_at];
    if level > 100 {
        return Err(format!("电量值 {level} 超出 0–100，疑似解析位置不对"));
    }

    let charging = resp[charging_at] != 0;
    Ok((level, charging))
}

fn read_vgn_s99_battery() -> Result<BatteryInfo, String> {
    let _guard = READ_LOCK.lock().unwrap_or_else(|err| err.into_inner());
    let api = HidApi::new().map_err(|err| format!("hidapi 初始化失败: {err}"))?;
    let device_label = parse_manifest(MANIFEST_JSON).name;

    let mut enum_notes = Vec::new();
    let mut candidate = None;

    for device in api.device_list() {
        if device.vendor_id() != VGN_VID {
            continue;
        }
        let pid = device.product_id();
        let page = device.usage_page();
        let usage = device.usage();
        let iface = device.interface_number();
        let product = device.product_string().unwrap_or_default().to_string();

        if pid != RECEIVER_PID {
            continue;
        }
        enum_notes.push(format!(
            "iface={iface} page={page:04X} usage={usage:04X} {product}"
        ));
        // 必须开厂商自定义接口；开标准键盘接口（page 0x0001）一定读不到，
        // 而且那个接口被 Windows 独占，打开就会「拒绝访问」。
        if page == VENDOR_USAGE_PAGE {
            candidate = Some((pid, page, usage, iface, device.path().to_owned(), product));
        }
    }

    let Some((pid, page, _usage, iface, path, product)) = candidate else {
        if enum_notes.is_empty() {
            return Ok(BatteryInfo {
                percent: None,
                charging: None,
                connected: false,
                device: device_label,
                detail: format!(
                    "未找到 VGN S99 接收器（VID {VGN_VID:04X} PID {RECEIVER_PID:04X}）。请插好 2.4G 接收器。"
                ),
            });
        }
        return Ok(BatteryInfo {
            percent: None,
            charging: None,
            connected: true,
            device: device_label,
            detail: format!(
                "已看到 VGN 接收器，但没有 0xFF1C 厂商接口。接口: {}",
                enum_notes.join("; ")
            ),
        });
    };

    let device = match api.open_path(&path) {
        Ok(device) => device,
        Err(err) => {
            // 打不开就是拿不到设备，按 disconnected 报（常见原因是 VGN VHUB 独占 HID）。
            return Ok(BatteryInfo::disconnected(
                device_label,
                format!(
                    "VGN S99 接收器打不开: {err}。请关闭 VGN VHUB 后重试（它会独占 HID 接口）。"
                ),
            ));
        }
    };

    let device_name = if product.is_empty() {
        format!("VGN {VGN_VID:04X}:{pid:04X} page={page:04X} iface={iface}")
    } else {
        format!("{product} page={page:04X} iface={iface}")
    };

    match read_battery_once(&device) {
        Ok((level, charging)) => Ok(BatteryInfo {
            percent: Some(level),
            charging: Some(charging),
            connected: true,
            device: device_name,
            detail: format!(
                "厂商邮箱 Output 0x{REPORT_ID:02X}/0x{CMD_GET_BATTERY:02X} · {level}% · {}",
                if charging { "充电中" } else { "未充电" }
            ),
        }),
        // 写不进去 = 此刻拿不到设备，按未连接报，不让界面显示半截状态。
        Err(ReadError::Write(err)) => Ok(BatteryInfo::disconnected(
            device_name,
            format!("写 Output 报文失败: {err}。请关闭 VGN VHUB 后重试，或拔插接收器。"),
        )),
        // 写进去了但设备没回答：设备还在，只是电量未知。
        // percent 留空，界面显示「电量未知」而不是假的 0%。
        Err(ReadError::NoReply(err)) => Ok(BatteryInfo {
            percent: None,
            charging: None,
            connected: true,
            device: device_name,
            detail: format!(
                "已连接接收器，但没读到电量: {err}。请确认键盘已开机并与接收器配对；若开着 VGN VHUB 请先退出（HID 会被独占）。"
            ),
        }),
    }
}

/// 读电量的失败方式。壳层要区分「拿不到设备」和「设备没回答」。
enum ReadError {
    /// 写 Output 报文失败，等同于拿不到设备。
    Write(String),
    /// 命令已发出，但没收到有效电量回包。
    NoReply(String),
}

/// 发一次查询，等回包。失败重试有限次。
fn read_battery_once(device: &HidDevice) -> Result<(u8, bool), ReadError> {
    // 非阻塞模式配合自己控制的超时循环，避免一直卡在 read 上。
    let _ = device.set_blocking_mode(false);
    let mut last_err = String::from("没有得到电量回包");

    for attempt in 1..=ATTEMPTS {
        // 丢掉上一次残留的输入，避免读到旧包。
        drain_input(device);

        let frame = battery_request();
        if let Err(err) = device.write(&frame) {
            return Err(ReadError::Write(format!("{err}")));
        }

        match wait_for_battery_reply(device, REPLY_TIMEOUT) {
            Ok(result) => return Ok(result),
            Err(err) => last_err = format!("第 {attempt} 次: {err}"),
        }
        thread::sleep(RETRY_GAP);
    }

    Err(ReadError::NoReply(last_err))
}

/// 在超时内等一条电量回包。期间收到的其它报文（如命令回显）跳过。
fn wait_for_battery_reply(
    device: &HidDevice,
    timeout: Duration,
) -> Result<(u8, bool), String> {
    let deadline = Instant::now() + timeout;
    let mut saw_other = None;

    while Instant::now() < deadline {
        let mut buf = [0u8; 256];
        match device.read_timeout(&mut buf, 100) {
            Ok(0) => continue,
            Ok(n) => {
                let resp = &buf[..n];
                match parse_battery_reply(resp) {
                    Ok(result) => return Ok(result),
                    Err(err) => saw_other = Some(err),
                }
            }
            Err(err) => return Err(format!("读回包失败: {err}")),
        }
    }

    match saw_other {
        Some(err) => Err(format!("超时，期间收到的都不是电量包（{err}）")),
        None => Err("超时，没有收到任何回包".to_string()),
    }
}

/// 把输入缓冲区里积压的旧报文读空。
fn drain_input(device: &HidDevice) {
    for _ in 0..32 {
        let mut buf = [0u8; 256];
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
        assert_eq!(meta.id, "vgn-s99");
        assert_eq!(meta.name, "VGN S99");
        assert_eq!(meta.category, crate::plugin_sdk::DeviceCategory::Keyboard);
    }

    #[test]
    fn request_matches_official_ws_serve_command() {
        // 官方：Uint8Array([0, 0, WsCmd.GetBatterLevel, 6, 0, 0, 0])，GetBatterLevel = 26
        let frame = battery_request();
        assert_eq!(frame.len(), 64);
        assert_eq!(frame[0], REPORT_ID);
        assert_eq!(frame[1], 0x00);
        assert_eq!(frame[2], 0x00);
        assert_eq!(frame[3], 0x1A);
        assert_eq!(frame[4], 0x06);
        assert_eq!(frame[5], 0x00);
        assert_eq!(frame[6], 0x00);
        assert_eq!(frame[7], 0x00);
        assert!(frame[8..].iter().all(|byte| *byte == 0));
    }

    #[test]
    fn parses_measured_reply_with_report_id() {
        // 本机 2026-10-19 实测回包：04 00 00 1A 06 00 00 00 32 00 ...
        let mut resp = vec![0x04u8, 0x00, 0x00, 0x1A, 0x06, 0x00, 0x00, 0x00, 0x32, 0x00];
        resp.resize(66, 0);
        let (level, charging) = parse_battery_reply(&resp).unwrap();
        assert_eq!(level, 50);
        assert!(!charging);
    }

    #[test]
    fn parses_measured_charging_reply() {
        // 2026-10-19 实测：插线充电时回包 `04 00 00 1A 06 00 00 00 44 01 ...`
        // buf[8] = 0x44 = 68%，buf[9] = 0x01 → 充电中。
        //
        // 这个 0x01 是判据分水岭，务必保留：
        // - 正确判法 `buf[9] != 0` → 充电中 ✅
        // - 早期文档写的 `(buf[9] >> 4) & 0xF == 1` → 0x01 >> 4 == 0 → 未充电 ❌
        // 若哪天这条挂了，说明充电判据被改回了位运算版本。
        let mut resp = vec![0x04u8, 0x00, 0x00, 0x1A, 0x06, 0x00, 0x00, 0x00, 0x44, 0x01];
        resp.resize(66, 0);
        let (level, charging) = parse_battery_reply(&resp).unwrap();
        assert_eq!(level, 68);
        assert!(charging, "0x01 必须判为充电中");
    }

    #[test]
    fn parses_reply_without_report_id() {
        // 官方 node-hid 形态：不含 Report ID，电量在 [7]、充电在 [8]
        let mut resp = vec![0x00u8, 0x00, 0x1A, 0x06, 0x00, 0x00, 0x00, 0x64, 0x01];
        resp.resize(65, 0);
        let (level, charging) = parse_battery_reply(&resp).unwrap();
        assert_eq!(level, 100);
        assert!(charging);
    }

    #[test]
    fn endpoint_values_are_accepted() {
        for (raw, expect) in [(0u8, 0u8), (100, 100)] {
            let mut resp = vec![0x04u8, 0x00, 0x00, 0x1A, 0x06, 0x00, 0x00, 0x00, raw, 0x00];
            resp.resize(66, 0);
            assert_eq!(parse_battery_reply(&resp).unwrap().0, expect);
        }
    }

    #[test]
    fn rejects_out_of_range_level() {
        let mut resp = vec![0x04u8, 0x00, 0x00, 0x1A, 0x06, 0x00, 0x00, 0x00, 101, 0x00];
        resp.resize(66, 0);
        let err = parse_battery_reply(&resp).unwrap_err();
        assert!(err.contains("超出"), "实际错误: {err}");
    }

    #[test]
    fn rejects_wrong_command_code() {
        // 回显包：命令码位置是 0x87（旧文档那个错误命令）而不是 0x1A
        let mut resp = vec![0x04u8, 0x87, 0x00, 0x00, 0x01, 0x00, 0x02, 0x00, 0x00, 0x00];
        resp.resize(66, 0);
        let err = parse_battery_reply(&resp).unwrap_err();
        assert!(err.contains("不是电量回包"), "实际错误: {err}");
    }

    #[test]
    fn rejects_short_reply() {
        // 连命令码都取不到
        let resp = [0x04u8, 0x00, 0x00];
        assert!(parse_battery_reply(&resp).is_err());

        // 有命令码但没有充电字节
        let resp = [0x04u8, 0x00, 0x00, 0x1A, 0x06, 0x00, 0x00, 0x00, 0x32];
        let err = parse_battery_reply(&resp).unwrap_err();
        assert!(err.contains("过短"), "实际错误: {err}");
    }

    #[test]
    fn rejects_empty_reply() {
        assert!(parse_battery_reply(&[]).is_err());
    }
}
