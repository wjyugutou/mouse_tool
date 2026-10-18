//! 前行者 S9 Pro 无线鼠标电量插件。
//!
//! **opt-in 厂商报文**：本模块使用 `0xFF00` 厂商接口的 **Feature 报告**
//! （`GET_FEATURE` / `SET_FEATURE`），Report ID `0x03`，payload 63 字节。
//! 不使用 `get_input_report`。
//!
//! ## 协议来源（2026-10-19 实机验证通过）
//!
//! VID `0x372E` 是 IPI（PIAO）的厂商号，前行者 S9 Pro 用的是同一套 OEM 固件，
//! 协议名 `ms_pix_v1`。协议来自官方 WebHID 配置器 `https://shan.ipigame.cn/`
//! 的 JS 包，并已由开源项目 `wkchew03/Mouse-Battery-Tracker`
//! （`mbt/drivers/ipi.py` + `docs/protocols.md`）在实机上验证。
//!
//! 本机实测（接收器 `372E:103D`，`iface=2`，`upage=0xFF00`）：
//!
//! ```text
//! 发送 03 22 50 00 02 4F 81 00 ...        （64 字节，buf[0] 是 Report ID）
//! 回包 03 50 00 0B 02 01 36 21 04 01 90 65 04 A5 5A 00
//!                 ^^ buf[6] = 0x36 = 54% 电量
//! ```
//!
//! ## 帧格式
//!
//! ```text
//! payload = [crc, 0x50, 0x00, 0x02, 0x4F, 0x81, 0, 0, ...]  补零到 63 字节
//! crc     = sum(payload[1..]) % 256，放在 payload[0]
//! ```
//!
//! 电量不是独立命令，而是 `get_basic_info` 回包的**第 5 个字段**（`buf[6]`）。
//!
//! ## 两个必须处理的坑
//!
//! 1. **首次读回可能是 5 字节状态桩** `03 50 02 00 02`，真正的 16 字节回包要再读几次。
//!    读一次就放弃，看起来和「设备不应答」一模一样。实测本机接收器首读即回真包，
//!    但错误命令码时确实只回状态桩，所以重读逻辑不能省。
//! 2. **充电时电量字段是哨兵值 `0xE4`(228)**，不是百分比。官方配置器此时也显示 228，
//!    谁都拿不到真实电量。此时上报「充电中 + 电量未知」，绝不能编一个数。
//!
//! ## 安全约束
//!
//! - 只发 `0x4F/0x81` 这一条**只读查询**命令，绝不发任何 `SET_*` 写配置命令
//! - 最多重试有限次，不循环轰炸
//! - `get_input_report` 对任何设备都不许用（项目硬规则）

use crate::plugin_sdk::{parse_manifest, BatteryInfo, DevicePlugin};
use hidapi::{HidApi, HidDevice};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

/// IPI / PIAO 厂商号。
const VENDOR_ID: u16 = 0x372E;

/// 已确认走同一套 `ms_pix_v1` 协议的 PID（IPI 系，含本机接收器实测的 `0x103D`）。
///
/// 注意：**VID+PID 认不出是 Pro 还是 Ultra/Max**。官方驱动
/// `D:\EWEADN S9\config.xml` 里三个型号共用同一批 2.4G 接收器 PID：
///
/// | 型号 | 有线 PID | 2.4G 接收器 PID |
/// | --- | --- | --- |
/// | S9 Pro | `0x1029` | `0x1026` / `0x1033` / `0x103D` / `0x1055` |
/// | S9 Ultra | `0x1027` | `0x1026` / `0x1033` / `0x103D` / `0x1055` |
/// | S9 Max | `0x105E` | `0x1026` / `0x103D` / `0x1055` |
///
/// 所以：有线 PID 能唯一认出型号，2.4G 接收器 PID 认不出。
/// 本版只保证 S9 Pro；遇到能确认是 Ultra/Max 的有线 PID 时，明确拒绝说成 Pro。
const PRODUCT_IDS: &[u16] = &[
    0x1014, // IPI Float 88 无线接收器
    0x1015, // IPI Float 88 有线
    0x1028, // 同族有线
    0x1056, // 同族有线
    0x1029, // S9 Pro 有线
    // S9 Ultra / Max 的有线 PID 也列进来，才能「认出来并明确拒绝」，
    // 而不是枚举阶段就漏掉、被当成设备没插。
    0x1027, // S9 Ultra 有线
    0x105E, // S9 Max 有线
    0x1026, // S9 系列 2.4G（Pro/Ultra/Max 共用）
    0x1033, // S9 系列 2.4G（Pro/Ultra/Max 共用）
    0x103D, // S9 系列 2.4G（Pro/Ultra/Max 共用），本机实测
    0x1055, // S9 系列 2.4G（Pro/Ultra/Max 共用）
];

/// 能**唯一确认**是其它型号的有线 PID。命中就不是 Pro，不能冒充。
///
/// `0x1027` = S9 Ultra 有线，`0x105E` = S9 Max 有线（见 `config.xml`）。
const OTHER_MODEL_WIRED_PIDS: &[u16] = &[0x1027, 0x105E];

/// 这三个 2.4G PID 是 Pro/Ultra/Max 共用的，命中时型号不可判定。
const SHARED_RECEIVER_PIDS: &[u16] = &[0x1026, 0x1033, 0x103D, 0x1055];

/// S9 Pro 的有线 PID，命中即可确认型号。
const S9_PRO_WIRED_PID: u16 = 0x1029;

/// 厂商自定义接口的 usage page。标准鼠标接口（0x0001）读不到，且会被 Windows 独占。
const VENDOR_USAGE_PAGE: u16 = 0xFF00;

/// Feature 报告 ID，描述符里 `85 03`。
const REPORT_ID: u8 = 0x03;
/// Feature payload 长度，描述符 `95 3F` = 63 字节。
const PAYLOAD_LEN: usize = 63;
/// 含 Report ID 的完整帧长。
const FRAME_LEN: usize = PAYLOAD_LEN + 1;

/// 帧标记，回包里 `buf[1]` 必须是它。
const FRAME_MARKER: u8 = 0x50;

/// `get_basic_info` 的命令码与参数（放在 payload[4]、payload[5]）。
const CMD_BASIC_INFO_OPCODE: u8 = 0x4F;
const CMD_BASIC_INFO_PARAM: u8 = 0x81;
/// 回包里 `buf[4]` 必须等于它。
const CMD_BASIC_INFO_ECHO: u8 = 0x02;

/// 首次读回的状态桩长度。≤ 这个长度的都是桩，不是真回包。
const STUB_LEN: usize = 5;
/// 充电时电量字段的哨兵值。
const CHARGING_SENTINEL: u8 = 0xE4;

/// 读回包最多尝试几次。
const READ_ATTEMPTS: usize = 8;
/// 每次读之间的间隔。设备要一点时间才把真回包准备好。
const READ_GAP: Duration = Duration::from_millis(50);
/// 整个设备的读取加锁，避免首页和托盘同时打开同一个 HID 句柄。
static READ_LOCK: Mutex<()> = Mutex::new(());

const MANIFEST_JSON: &str = include_str!("../../../src/plugins/qianxingzhe-s9-pro/manifest.json");

pub static PLUGIN: DevicePlugin = DevicePlugin {
    manifest_json: MANIFEST_JSON,
    read_battery: read_s9_pro_battery,
};

/// 组一帧 `get_basic_info` 查询。`buf[0]` 是 Report ID，`buf[1..]` 是 63 字节 payload。
fn basic_info_request() -> [u8; FRAME_LEN] {
    let mut frame = [0u8; FRAME_LEN];
    frame[0] = REPORT_ID;
    // payload 从 frame[1] 开始，payload[0] 是 crc，先留 0
    frame[2] = FRAME_MARKER;
    frame[3] = 0x00;
    frame[4] = 0x02;
    frame[5] = CMD_BASIC_INFO_OPCODE;
    frame[6] = CMD_BASIC_INFO_PARAM;

    // crc = sum(payload[1..]) % 256，写回 payload[0] 即 frame[1]
    let sum = frame[2..].iter().fold(0u8, |acc, b| acc.wrapping_add(*b));
    frame[1] = sum;
    frame
}

/// 解析一次读回。
///
/// 返回 `Ok(None)` 表示「这是状态桩，不是真回包，继续读」。
/// 返回 `Ok(Some(parse))` 表示拿到了 `basic_info` 回包。
fn parse_reply(resp: &[u8]) -> Result<Option<Reading>, String> {
    // 桩：3 或 5 字节，只有 0x50 标记但没有完整 payload
    if resp.len() <= STUB_LEN {
        return Ok(None);
    }
    if resp[1] != FRAME_MARKER {
        return Err(format!(
            "帧标记不是 0x50（实际 0x{:02X}）",
            resp.get(1).copied().unwrap_or(0)
        ));
    }
    if resp.len() <= 6 {
        return Err(format!("回包过短: {} 字节，取不到电量字段", resp.len()));
    }
    if resp[4] != CMD_BASIC_INFO_ECHO {
        return Err(format!(
            "命令码不符: 回包 buf[4]=0x{:02X}，期望 0x{CMD_BASIC_INFO_ECHO:02X}",
            resp[4]
        ));
    }

    let raw = resp[6];
    if raw == CHARGING_SENTINEL {
        // 充电中，厂商自己也没有百分比。上报「充电中 + 未知电量」。
        return Ok(Some(Reading {
            percent: None,
            charging: Some(true),
        }));
    }
    if raw <= 100 {
        return Ok(Some(Reading {
            percent: Some(raw),
            charging: None,
        }));
    }

    // 帧校验通过了，说明设备确实在应答，只是这个值不是电量。
    // 报「已连接但电量未知」，不能报成断连。
    Err(format!("电量字段 {raw} 既不在 0–100 也不是充电哨兵值，无法判定"))
}

/// 解析结果。
#[derive(Debug, PartialEq, Eq)]
struct Reading {
    percent: Option<u8>,
    charging: Option<bool>,
}

/// 型号判定结果。VID+PID 认不出 2.4G 接收器背后是哪一只。
#[derive(Debug, PartialEq, Eq)]
enum ModelGuess {
    /// 有线 PID 唯一命中 S9 Pro。
    Confirmed,
    /// 2.4G 接收器 PID 是 Pro/Ultra/Max 共用，只能确认是 S9 系列。
    SharedReceiver,
    /// 有线 PID 明确是 Ultra / Max，不是 Pro。
    OtherModel(u16),
}

/// 按 PID 判型号。判定依据见 [`PRODUCT_IDS`] 的注释表格。
fn guess_model(pid: u16) -> ModelGuess {
    if pid == S9_PRO_WIRED_PID {
        ModelGuess::Confirmed
    }
    else if OTHER_MODEL_WIRED_PIDS.contains(&pid) {
        ModelGuess::OtherModel(pid)
    }
    else if SHARED_RECEIVER_PIDS.contains(&pid) {
        ModelGuess::SharedReceiver
    }
    else {
        // 同族的 IPI PID（0x1014/0x1015/0x1028/0x1056）严格说也不等于 Pro，
        // 但它们不是 S9 系列的已知型号，按共用处理最保守。
        ModelGuess::SharedReceiver
    }
}

fn read_s9_pro_battery() -> Result<BatteryInfo, String> {
    let _guard = READ_LOCK.lock().unwrap_or_else(|err| err.into_inner());
    let api = HidApi::new().map_err(|err| format!("hidapi 初始化失败: {err}"))?;
    let device_label = parse_manifest(MANIFEST_JSON).name;

    let mut enum_notes = Vec::new();
    let mut candidate = None;

    for device in api.device_list() {
        if device.vendor_id() != VENDOR_ID || !PRODUCT_IDS.contains(&device.product_id()) {
            continue;
        }
        let page = device.usage_page();
        let usage = device.usage();
        let iface = device.interface_number();
        let pid = device.product_id();
        let product = device.product_string().unwrap_or_default().to_string();

        enum_notes.push(format!(
            "iface={iface} page={page:04X} usage={usage:04X} pid={pid:04X} {product}"
        ));

        // 只开厂商自定义接口（0xFF00）。标准鼠标接口被 Windows 独占，打开就「拒绝访问」。
        if page == VENDOR_USAGE_PAGE {
            candidate = Some((pid, page, iface, device.path().to_owned(), product));
        }
    }

    let Some((pid, page, iface, path, product)) = candidate else {
        if enum_notes.is_empty() {
            return Ok(BatteryInfo::disconnected(
                device_label,
                "未找到前行者 S9 Pro 接收器。请插好 2.4G 接收器。".to_string(),
            ));
        }
        return Ok(BatteryInfo {
            percent: None,
            charging: None,
            connected: true,
            device: device_label,
            detail: format!(
                "已看到 {VENDOR_ID:04X} 设备，但没有 0xFF00 厂商接口。接口: {}",
                enum_notes.join("; ")
            ),
        });
    };

    let device = match api.open_path(&path) {
        Ok(device) => device,
        Err(err) => {
            return Ok(BatteryInfo::disconnected(
                device_label,
                format!("接收器打不开: {err}。请关闭鼠标官方驱动后重试（它会独占 HID 接口）。"),
            ));
        }
    };

    let model = guess_model(pid);

    // 有线 PID 明确是 Ultra/Max：不能把别人的鼠标标成 S9 Pro。
    if let ModelGuess::OtherModel(other_pid) = model {
        let name = match other_pid {
            0x1027 => "S9 Ultra",
            0x105E => "S9 Max",
            _ => "同系列其它型号",
        };
        return Ok(BatteryInfo {
            percent: None,
            charging: None,
            connected: true,
            // 如实报设备名，不冒充 Pro 的电量口径
            device: format!("前行者 {name}（未支持）"),
            detail: format!(
                "检测到 {name}（有线 PID 0x{other_pid:04X}），本版只适配 S9 Pro，暂不读取电量。"
            ),
        });
    }

    let device_name = if product.is_empty() {
        format!("前行者 S9 Pro {VENDOR_ID:04X}:{pid:04X} page={page:04X} iface={iface}")
    } else {
        format!("{product} page={page:04X} iface={iface}")
    };

    // 共用接收器 PID 时，协议能读，但「是不是 Pro」无法从 HID 确认。
    let model_note = match model {
        ModelGuess::SharedReceiver => {
            format!("（2.4G PID 0x{pid:04X} 由 Pro/Ultra/Max 共用，型号按 S9 系列处理）")
        }
        _ => String::new(),
    };

    match read_once(&device) {
        Ok(reading) => {
            let detail = match (reading.percent, reading.charging) {
                (Some(level), _) => {
                    format!(
                        "Feature 0x{REPORT_ID:02X}/0x{CMD_BASIC_INFO_OPCODE:02X} · {level}%{model_note}"
                    )
                }
                (None, Some(true)) => {
                    format!("正在充电，此状态拿不到百分比（厂商配置器同样只显示 228）{model_note}")
                }
                _ => format!("已连接接收器，但电量未知（{iface} 接口无有效回包）{model_note}"),
            };
            Ok(BatteryInfo {
                percent: reading.percent,
                charging: reading.charging,
                connected: true,
                device: device_name,
                detail,
            })
        }
        // 打不开 / 写不进去 = 此刻拿不到设备
        Err(ReadError::Write(err)) => Ok(BatteryInfo::disconnected(
            device_name,
            format!("写 Feature 报文失败: {err}。请拔插接收器，或关闭鼠标官方驱动后重试。"),
        )),
        // 写进去了但没读到真回包：设备在，只是电量未知，不能报 0%
        Err(ReadError::NoReply(err)) => Ok(BatteryInfo {
            percent: None,
            charging: None,
            connected: true,
            device: device_name,
            detail: format!(
                "已连接接收器，但没读到电量: {err}。请确认鼠标已开机并与接收器配对。"
            ),
        }),
    }
}

/// 读电量的失败方式。壳层要区分「拿不到设备」和「设备没回答」。
enum ReadError {
    /// 写 Feature 报文失败，等同于拿不到设备。
    Write(String),
    /// 命令已发出，但没读到有效回包。
    NoReply(String),
}

/// 发一次查询，反复读到真回包为止。
fn read_once(device: &HidDevice) -> Result<Reading, ReadError> {
    let request = basic_info_request();
    if let Err(err) = device.send_feature_report(&request) {
        return Err(ReadError::Write(format!("{err}")));
    }

    let mut last_err = String::from("没有读到回包");

    for _ in 0..READ_ATTEMPTS {
        thread::sleep(READ_GAP);

        // 关键：缓冲区必须给满 64 字节。短缓冲设备会直接报 read error。
        let mut buf = [0u8; FRAME_LEN];
        buf[0] = REPORT_ID;

        match device.get_feature_report(&mut buf) {
            Ok(len) => {
                let resp = &buf[..len];
                match parse_reply(resp) {
                    // 状态桩，继续读
                    Ok(None) => {}
                    Ok(Some(reading)) => return Ok(reading),
                    Err(err) => last_err = err,
                }
            }
            Err(err) => last_err = format!("读回包失败: {err}"),
        }
    }

    Err(ReadError::NoReply(last_err))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_is_the_plugin_identity() {
        let meta = PLUGIN.meta();
        assert_eq!(meta.id, "qianxingzhe-s9-pro");
        assert_eq!(meta.name, "前行者 S9 Pro");
        assert_eq!(meta.description, "2.4G 无线游戏鼠标");
    }

    /// 手算核对：crc = sum(payload[1..]) % 256。
    #[test]
    fn request_frame_has_valid_checksum() {
        let frame = basic_info_request();
        assert_eq!(frame[0], REPORT_ID);
        assert_eq!(frame[2], FRAME_MARKER);
        assert_eq!(frame[5], CMD_BASIC_INFO_OPCODE);
        assert_eq!(frame[6], CMD_BASIC_INFO_PARAM);

        let sum = frame[2..].iter().fold(0u8, |acc, b| acc.wrapping_add(*b));
        assert_eq!(frame[1], sum, "payload[0] 必须是 payload[1..] 的和取低 8 位");

        // 实机发出的前 8 字节是 `03 22 50 00 02 4F 81 00`，crc = 0x22
        assert_eq!(frame[1], 0x22, "实测 crc 是 0x22");
    }

    /// 实机抓到的真回包（54% 电量）。
    #[test]
    fn parses_real_capture() {
        let resp = [
            0x03, 0x50, 0x00, 0x0B, 0x02, 0x01, 0x36, 0x21, 0x04, 0x01, 0x90, 0x65, 0x04, 0xA5,
            0x5A, 0x00,
        ];
        let reading = parse_reply(&resp).unwrap().unwrap();
        assert_eq!(reading.percent, Some(0x36));
        assert_eq!(reading.percent, Some(54));
    }

    /// 5 字节状态桩必须被判成「继续读」，不能当成回包。
    #[test]
    fn stub_is_not_a_reading() {
        let stub = [0x03, 0x50, 0x02, 0x00, 0x02];
        assert_eq!(parse_reply(&stub).unwrap(), None);

        // 更短的也要是 None，不能 panic
        assert_eq!(parse_reply(&[0x03]).unwrap(), None);
        assert_eq!(parse_reply(&[]).unwrap(), None);
    }

    /// 充电时电量字段是 0xE4 哨兵值：报「充电中 + 未知电量」，不能编数字。
    #[test]
    fn charging_sentinel_yields_no_percent() {
        let resp = [
            0x03, 0x50, 0x00, 0x0B, 0x02, 0x01, 0xE4, 0x21, 0x04, 0x01, 0x90, 0x65, 0x04, 0xA5,
            0x5A, 0x00,
        ];
        let reading = parse_reply(&resp).unwrap().unwrap();
        assert_eq!(reading.percent, None);
        assert_eq!(reading.charging, Some(true));
    }

    /// 帧标记不对要报错，不能瞎解析。
    #[test]
    fn wrong_marker_is_rejected() {
        let resp = [0x03, 0x51, 0x00, 0x0B, 0x02, 0x01, 0x36];
        assert!(parse_reply(&resp).is_err());
    }

    /// 命令码不对要报错。实测错误命令码时设备只回状态桩。
    #[test]
    fn wrong_opcode_echo_is_rejected() {
        let resp = [0x03, 0x50, 0x00, 0x0B, 0x03, 0x01, 0x36];
        assert!(parse_reply(&resp).is_err());
    }

    /// 0–100 的边界值要正确解析。
    #[test]
    fn percent_boundaries() {
        for level in [0u8, 1, 50, 99, 100] {
            let mut resp = [0x00u8; 16];
            resp[0] = REPORT_ID;
            resp[1] = FRAME_MARKER;
            resp[4] = CMD_BASIC_INFO_ECHO;
            resp[6] = level;
            assert_eq!(parse_reply(&resp).unwrap().unwrap().percent, Some(level));
        }
    }

    /// 超出 0–100 又不是哨兵值：报错（上层转成「设备在但电量未知」）。
    #[test]
    fn out_of_range_value_is_an_error() {
        let mut resp = [0x00u8; 16];
        resp[0] = REPORT_ID;
        resp[1] = FRAME_MARKER;
        resp[4] = CMD_BASIC_INFO_ECHO;
        resp[6] = 200;
        assert!(parse_reply(&resp).is_err());
    }

    /// 有线 PID `0x1029` 唯一确认是 S9 Pro。
    #[test]
    fn wired_pro_pid_confirms_model() {
        assert_eq!(guess_model(0x1029), ModelGuess::Confirmed);
    }

    /// 2.4G 接收器 PID 由 Pro/Ultra/Max 共用，只能判成「共用」，不能当成 Pro 已确认。
    ///
    /// 依据：`D:\EWEADN S9\config.xml` 三个型号共用 1026/1033/103D/1055。
    #[test]
    fn shared_receiver_pids_are_not_confirmed() {
        for pid in [0x1026u16, 0x1033, 0x103D, 0x1055] {
            assert_eq!(
                guess_model(pid),
                ModelGuess::SharedReceiver,
                "0x{pid:04X} 是三个型号共用的接收器 PID，不能当作 Pro 已确认"
            );
        }
    }

    /// 有线 PID 明确是 Ultra / Max 时必须拒绝冒充 Pro。
    #[test]
    fn other_model_wired_pids_are_rejected() {
        assert_eq!(guess_model(0x1027), ModelGuess::OtherModel(0x1027)); // Ultra
        assert_eq!(guess_model(0x105E), ModelGuess::OtherModel(0x105E)); // Max
    }

    /// 所有可识别的 PID 都要在 PRODUCT_IDS 里，否则根本枚举不到。
    #[test]
    fn every_known_pid_is_enumerable() {
        for pid in [0x1029u16, 0x1027, 0x105E, 0x1026, 0x1033, 0x103D, 0x1055] {
            assert!(
                PRODUCT_IDS.contains(&pid),
                "PID 0x{pid:04X} 在 guess_model 里有含义，但不在 PRODUCT_IDS，枚举阶段就会被漏掉"
            );
        }
    }
}
