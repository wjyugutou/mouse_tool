//! 迈从 A5 V3 Ultra+（MCHOSE A5 V3 Ultra+）电量插件。
//!
//! **opt-in Feature 报告**（alexfrih/mchose-linux PROTOCOL.md / HaloBattery `providers/mchose.py`）
//! 与 M7 Ultra · A7 V2 Ultra 同族：VID `0x3837` + 集合 `0xFF01`；本插件打开接收器 PID `0x1018`。
//!
//! PROTOCOL：`0x11`（20B payload）/ `0x12`（64B）均为 Feature；payload 整段 `^0xFF`；
//! 命令 `0x03`（bond/connect）、`0x06`（电量）；**每次 GET 前重发 SET**；
//! **禁止** `get_input_report`。不要抄雷柏 VT9。
//!
//! 本机实探（2026-10-18，Windows，接收器插在 MagDock 上：`3837:1018` + MagDock `1012`）：
//! - MagDock `1012` 仅 `FF00:0001`：Feature 全失败（0x01）；interrupt write 回全 0；**无电量通道**
//! - `1018` FF01：Feature SET(`0x11`/21B) 成功；GET 恒 Win32 `0x1F`；`0x12`/65B SET 拒 `0x57`
//! - Realtek nudge `0x11 0xF9` + 等 `0x13/0x1d`：3–5s 内无推送
//! - 中断 Out/In：可通，`4D (0x80|rid) 00 01` + 同族取反帧；实读逻辑 vid=0
//!   （与 BatteryMonitor「receiver reports no connected mouse」一致）
//! - 因此：电量仍只走 `1018` FF01；MagDock 在场时只用于改写失败提示，不当传输通道

use crate::plugin_sdk::{parse_manifest, BatteryInfo, DevicePlugin};
use hidapi::{HidApi, HidDevice};
use std::thread;
use std::time::{Duration, Instant};

const MCHOSE_VID: u16 = 0x3837;
const A5_V3_ULTRA_PLUS_PID: u16 = 0x1018;
const MAGDOCK_PID: u16 = 0x1012;
const MCHOSE_LEGACY_VID: u16 = 0x5253;

const CONFIG_PAGE: u16 = 0xFF01;
const CONFIG_PAGE_ALT: u16 = 0xFF0B;
const MAGDOCK_PAGE: u16 = 0xFF00;
const SHORT_REPORT: u8 = 0x11;
const LONG_REPORT: u8 = 0x12;
const SHORT_PAYLOAD: usize = 20;
const LONG_PAYLOAD: usize = 64;
const INTERRUPT_OUT_LEN: usize = 64;
const INTERRUPT_WRAP: u8 = 0x4D;

const CMD_BOND: u8 = 0x03;
const CMD_STATUS: u8 = 0x06;

const ATTEMPTS: u8 = 4;
const ATTEMPT_GAP: Duration = Duration::from_millis(120);
const NUDGE_WAIT: Duration = Duration::from_secs(3);

const MANIFEST_JSON: &str =
    include_str!("../../../src/plugins/mchose-a5-v3-ultra-plus/manifest.json");

pub static PLUGIN: DevicePlugin = DevicePlugin {
    manifest_json: MANIFEST_JSON,
    read_battery: read_mchose_a5_v3_ultra_battery,
};

fn read_mchose_a5_v3_ultra_battery() -> Result<BatteryInfo, String> {
    let api = HidApi::new().map_err(|e| format!("hidapi 初始化失败: {e}"))?;
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

        if pid == MAGDOCK_PID {
            if magdock_note.is_empty() {
                magdock_note = format!(
                    "MagDock(1012) page={page:04X} usage={usage:04X} iface={iface}"
                );
            } else {
                magdock_note.push_str(&format!(
                    "; page={page:04X} usage={usage:04X} iface={iface}"
                ));
            }
            // MagDock 本机仅 FF00，Feature/中断均无电量；若将来出现 FF01 再尝试。
            if page == CONFIG_PAGE || page == CONFIG_PAGE_ALT {
                candidates.push((
                    pid,
                    page,
                    usage,
                    iface,
                    device.path().to_owned(),
                    device.product_string().unwrap_or_default(),
                ));
            }
            continue;
        }

        if pid != A5_V3_ULTRA_PLUS_PID {
            continue;
        }
        enum_notes.push(format!("iface={iface} page={page:04X} usage={usage:04X}"));
        if page != CONFIG_PAGE && page != CONFIG_PAGE_ALT {
            continue;
        }
        // FF0B 本机 Feature/write 均 Incorrect function；仍列入候选以便报错明细。
        candidates.push((
            pid,
            page,
            usage,
            iface,
            device.path().to_owned(),
            device.product_string().unwrap_or_default(),
        ));
    }

    if !magdock_note.is_empty() {
        // 主动确认 MagDock FF00 仍无通道，写入提示用证据。
        magdock_note = format!(
            "{magdock_note}（本机探测：仅 {MAGDOCK_PAGE:04X}、Feature/电量通道不可用；电量仍走接收器 {A5_V3_ULTRA_PLUS_PID:04X}）"
        );
    }

    if candidates.is_empty() {
        let hint = if enum_notes.is_empty() {
            "未枚举到该 VID/PID。".to_string()
        } else {
            format!("已看到设备但无 FF01/FF0B：{}。", enum_notes.join(", "))
        };
        let dock = if magdock_note.is_empty() {
            String::new()
        } else {
            format!(" {magdock_note}")
        };
        return Ok(BatteryInfo {
            percent: None,
            charging: None,
            connected: false,
            device: device_label,
            detail: format!(
                "未找到迈从 A5 V3 Ultra+ 的 Feature 集合 0xFF01（VID {MCHOSE_VID:04X} PID {A5_V3_ULTRA_PLUS_PID:04X}）。{hint}{dock}"
            ),
        });
    }

    // 优先 1018+FF01+usage1，其次同 PID 其它集合；MagDock 控制集合（若有）垫后。
    candidates.sort_by_key(|(pid, page, usage, iface, _, _)| {
        let pid_pri = if *pid == A5_V3_ULTRA_PLUS_PID { 0u8 } else { 1 };
        let page_pri = if *page == CONFIG_PAGE {
            0u8
        } else if *page == CONFIG_PAGE_ALT {
            1
        } else {
            2
        };
        let usage_pri = if *usage == 1 { 0u8 } else { 1 };
        (pid_pri, page_pri, usage_pri, *iface)
    });

    let mut errors = Vec::new();
    let mut saw_empty = false;
    for (pid, page, usage, iface, path, product) in &candidates {
        let device = match api.open_path(path) {
            Ok(device) => device,
            Err(err) => {
                errors.push(format!(
                    "pid={pid:04X} page={page:04X} usage={usage:04X} iface={iface} 打开失败: {err}（若开着 MCHOSE HUB / M HUB，请先关掉）"
                ));
                continue;
            }
        };
        match read_open_device(&device) {
            Ok(ReadOutcome::Fresh(info)) => {
                let product_label = if product.is_empty() {
                    format!("MCHOSE {MCHOSE_VID:04X}:{pid:04X}")
                } else {
                    product.to_string()
                };
                return Ok(BatteryInfo {
                    device: format!("{product_label} page={page:04X} iface={iface}"),
                    ..info
                });
            }
            Ok(ReadOutcome::AsleepOrEmpty(detail)) => {
                saw_empty = true;
                errors.push(format!(
                    "pid={pid:04X} page={page:04X} usage={usage:04X} iface={iface}: {detail}"
                ));
            }
            Err(err) => errors.push(format!(
                "pid={pid:04X} page={page:04X} usage={usage:04X} iface={iface}: {err}"
            )),
        }
    }

    let enum_summary = enum_notes.join(", ");
    let dock_note = if magdock_note.is_empty() {
        String::new()
    } else {
        // MagDock 可能仍插着但接收器已直插；只陈述探测事实，不假定拓扑。
        format!(
            " 另检测到 {magdock_note}。电量只走接收器 1018 FF01，与 MagDock 是否在场无关。"
        )
    };
    let empty_hint = if saw_empty {
        " 当前回包逻辑 VID=0（接收器认为无链路）：请确认鼠标已开、2.4G 已配对并动一下唤醒；对照 M HUB 是否能显示电量（测时请关掉 M HUB）。".to_string()
    } else {
        String::new()
    };
    let detail = if saw_empty {
        format!(
            "已看到设备（{enum_summary}），但电量无效（接收器无链路或鼠标休眠）。{dock_note}{empty_hint} {}",
            errors.join(" · ")
        )
    } else {
        format!(
            "已看到设备（{enum_summary}），但读电量失败。若开着官方 M HUB 请先关掉。{dock_note} {}",
            errors.join(" · ")
        )
    };

    Ok(BatteryInfo {
        percent: None,
        charging: None,
        connected: true,
        device: device_label,
        detail,
    })
}

enum ReadOutcome {
    Fresh(BatteryInfo),
    AsleepOrEmpty(String),
}

fn read_open_device(device: &HidDevice) -> Result<ReadOutcome, String> {
    let bond_note = match feature_exchange(device, SHORT_REPORT, SHORT_PAYLOAD, CMD_BOND) {
        Ok(payload) => match parse_bond(&payload) {
            Ok(bond) => format!(
                "bond/Feature connect={} vid={:#06X} pid={:#06X}",
                bond.connect, bond.vid, bond.pid
            ),
            Err(err) => format!("bond/Feature 解析: {err}"),
        },
        Err(err) => format!("bond/Feature: {err}"),
    };

    match read_status_feature(device) {
        Ok(outcome) => return Ok(annotate(outcome, &bond_note)),
        Err(feat_err) => {
            // Windows：GET 常 0x1F，改用中断运输同一取反帧。
            match read_status_interrupt(device) {
                Ok(outcome) => {
                    return Ok(annotate(
                        outcome,
                        &format!("{bond_note} · 经中断 0x4D 回退（Feature GET 失败: {feat_err})"),
                    ));
                }
                Err(int_err) => {
                    // 最后再试 Realtek 推送 nudge（L7 MagDock 同族；A5 本机未出 0x13）。
                    match read_status_nudge_push(device) {
                        Ok(outcome) => {
                            return Ok(annotate(
                                outcome,
                                &format!(
                                    "{bond_note} · Feature/中断均失败后经 nudge 0x13（feat={feat_err}; int={int_err})"
                                ),
                            ));
                        }
                        Err(nudge_err) => {
                            return Err(format!(
                                "Feature 失败: {feat_err}；中断回退失败: {int_err}；nudge 失败: {nudge_err} · {bond_note}"
                            ));
                        }
                    }
                }
            }
        }
    }
}

fn annotate(outcome: ReadOutcome, note: &str) -> ReadOutcome {
    match outcome {
        ReadOutcome::Fresh(mut info) => {
            if !note.is_empty() {
                info.detail = format!("{} · {note}", info.detail);
            }
            ReadOutcome::Fresh(info)
        }
        ReadOutcome::AsleepOrEmpty(detail) => {
            ReadOutcome::AsleepOrEmpty(format!("{detail} · {note}"))
        }
    }
}

fn read_status_feature(device: &HidDevice) -> Result<ReadOutcome, String> {
    let channels = [
        (SHORT_REPORT, SHORT_PAYLOAD),
        (LONG_REPORT, LONG_PAYLOAD),
    ];
    let mut last_err = String::from("没有得到有效 Feature 响应");
    let mut saw_empty = false;
    let mut saw_set_ok = false;

    for (report, payload_len) in channels {
        for attempt in 1..=ATTEMPTS {
            match feature_exchange(device, report, payload_len, CMD_STATUS) {
                Ok(payload) => {
                    saw_set_ok = true;
                    match parse_status_payload(&payload) {
                        Ok(parsed) => {
                            return Ok(ReadOutcome::Fresh(status_info(
                                parsed,
                                format!(
                                    "Feature {report:#04X}/{} · attempt {attempt}",
                                    payload_len + 1
                                ),
                            )));
                        }
                        Err(err) => {
                            if is_empty_link_err(&err) {
                                saw_empty = true;
                            }
                            last_err = format!("report {report:#04X} attempt {attempt}: {err}");
                        }
                    }
                }
                Err(err) => {
                    if err.contains("get_feature_report") {
                        saw_set_ok = true;
                    }
                    last_err = format!("report {report:#04X} attempt {attempt}: {err}");
                    if err.contains("send_feature_report") && !err.contains("get_feature_report")
                    {
                        break;
                    }
                }
            }
        }
    }

    if saw_empty {
        Ok(ReadOutcome::AsleepOrEmpty(last_err))
    } else if saw_set_ok {
        Err(last_err)
    } else {
        Err(last_err)
    }
}

fn read_status_interrupt(device: &HidDevice) -> Result<ReadOutcome, String> {
    let _ = device.set_blocking_mode(false);
    let mut last_err = String::from("中断通道无有效电量");
    let mut saw_empty = false;

    for attempt in 1..=ATTEMPTS {
        let request = make_interrupt_request(CMD_STATUS, SHORT_REPORT);
        if let Err(err) = device.write(&request) {
            last_err = format!("write 失败: {err}");
            continue;
        }
        thread::sleep(Duration::from_millis(40));
        for _ in 0..10 {
            let mut buf = [0u8; 65];
            match device.read_timeout(&mut buf, 80) {
                Ok(0) | Err(_) => continue,
                Ok(n) => match parse_interrupt_buffer(&buf[..n]) {
                    Ok(parsed) => {
                        return Ok(ReadOutcome::Fresh(status_info(
                            parsed,
                            format!("中断 0x4D 包装 · attempt {attempt}"),
                        )));
                    }
                    Err(err) => {
                        if is_empty_link_err(&err) {
                            saw_empty = true;
                        }
                        last_err = err;
                    }
                },
            }
        }
        thread::sleep(ATTEMPT_GAP);
    }

    if saw_empty {
        Ok(ReadOutcome::AsleepOrEmpty(last_err))
    } else {
        Err(last_err)
    }
}

fn read_status_nudge_push(device: &HidDevice) -> Result<ReadOutcome, String> {
    let _ = device.set_blocking_mode(false);
    let mut nudge = vec![SHORT_REPORT, 0xF9];
    nudge.extend(std::iter::repeat(0xFF).take(SHORT_PAYLOAD - 1));
    device
        .send_feature_report(&nudge)
        .map_err(|err| format!("nudge send_feature_report 失败: {err}"))?;

    let deadline = Instant::now() + NUDGE_WAIT;
    while Instant::now() < deadline {
        let mut buf = [0u8; 64];
        match device.read_timeout(&mut buf, 50) {
            Ok(n) if n >= 6 && buf[0] == 0x13 && buf[1] == 0x1d => {
                let percent = buf[5] ^ 0xFF;
                let wired = (buf[4] ^ 0xFF) != 0;
                if percent > 100 {
                    return Err(format!("nudge 推送电量越界: {percent}"));
                }
                return Ok(ReadOutcome::Fresh(BatteryInfo {
                    percent: Some(percent),
                    charging: Some(wired && percent < 100),
                    connected: true,
                    device: String::new(),
                    detail: format!(
                        "Realtek 推送 0x13/0x1d · wired={} · {}%",
                        u8::from(wired),
                        percent
                    ),
                }));
            }
            Ok(n) if n >= 8 && buf[0] == INTERRUPT_WRAP => {
                if let Ok(parsed) = parse_interrupt_buffer(&buf[..n]) {
                    return Ok(ReadOutcome::Fresh(status_info(
                        parsed,
                        "nudge 等待期间收到中断 0x4D".into(),
                    )));
                }
            }
            _ => thread::sleep(Duration::from_millis(10)),
        }
    }
    Err(format!("nudge 后 {NUDGE_WAIT:?} 内无 0x13/0x1d 推送"))
}

fn feature_exchange(
    device: &HidDevice,
    report: u8,
    payload_len: usize,
    cmd: u8,
) -> Result<Vec<u8>, String> {
    let request = make_request(cmd, report, payload_len);
    device
        .send_feature_report(&request)
        .map_err(|err| format!("send_feature_report {report:#04X} 失败: {err}"))?;
    thread::sleep(ATTEMPT_GAP);
    let mut buf = vec![0u8; payload_len + 1];
    buf[0] = report;
    let n = device
        .get_feature_report(&mut buf)
        .map_err(|err| format!("get_feature_report {report:#04X} 失败: {err}"))?;
    decode_feature_response(&buf[..n.max(1).min(buf.len())], report, cmd)
}

fn make_request(cmd: u8, report: u8, payload_len: usize) -> Vec<u8> {
    let mut body = vec![0u8; payload_len];
    if !body.is_empty() {
        body[0] = cmd;
    }
    let mut frame = Vec::with_capacity(payload_len + 1);
    frame.push(report);
    frame.extend(body.iter().map(|byte| byte ^ 0xFF));
    frame
}

fn make_interrupt_request(cmd: u8, report: u8) -> Vec<u8> {
    let mut req = make_request(cmd, report, SHORT_PAYLOAD);
    req.resize(INTERRUPT_OUT_LEN, 0xFF);
    req
}

fn decode_feature_response(resp: &[u8], expect_report: u8, expect_cmd: u8) -> Result<Vec<u8>, String> {
    if resp.len() < 2 {
        return Err(format!("响应过短: {} 字节", resp.len()));
    }
    let rest = if resp[0] == expect_report {
        &resp[1..]
    } else if resp[0] == (expect_cmd ^ 0xFF) {
        resp
    } else {
        return Err(format!("report/echo 不匹配: 首字节 {:#04X}", resp[0]));
    };
    if rest.is_empty() || rest[0] != (expect_cmd ^ 0xFF) {
        return Err(format!(
            "cmd echo {:#04X}，期望 {:#04X}",
            rest.first().copied().unwrap_or(0),
            expect_cmd ^ 0xFF
        ));
    }
    if rest.len() < 2 {
        return Err("缺少 payload".into());
    }
    Ok(rest[1..].iter().map(|byte| byte ^ 0xFF).collect())
}

fn parse_interrupt_buffer(buf: &[u8]) -> Result<StatusParsed, String> {
    let frame = extract_interrupt_frame(buf)?;
    let pay = decode_feature_response(frame, frame[0], CMD_STATUS)?;
    parse_status_payload(&pay)
}

fn extract_interrupt_frame(buf: &[u8]) -> Result<&[u8], String> {
    if buf.len() >= 8 && buf[0] == INTERRUPT_WRAP && buf[2] == 0x00 && buf[3] == 0x01 {
        return Ok(&buf[4..]);
    }
    if !buf.is_empty() && (buf[0] == SHORT_REPORT || buf[0] == LONG_REPORT) {
        return Ok(buf);
    }
    Err(format!("无法识别中断帧头（{} 字节）", buf.len()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct StatusParsed {
    level: u8,
    charging: bool,
    model: u16,
    flags: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct BondParsed {
    vid: u16,
    pid: u16,
    connect: u8,
}

fn is_empty_link_err(err: &str) -> bool {
    err.contains("空 payload")
        || err.contains("无链路")
        || err.contains("vid 0x0000")
        || err.contains("vid 0x0")
}

fn parse_status_payload(pay: &[u8]) -> Result<StatusParsed, String> {
    if pay.len() < 11 {
        return Err(format!("payload 过短: {} 字节", pay.len()));
    }
    // 全 0，或仅前 6 字节身份为 0（本机 MagDock 拓扑下常见：FF..FF 后夹杂 0D 垃圾）。
    let vid = u16::from_le_bytes([pay[0], pay[1]]);
    let model = u16::from_le_bytes([pay[2], pay[3]]);
    if pay.iter().take(11).all(|byte| *byte == 0) || vid == 0 || model == 0 {
        return Err(format!(
            "空 payload / 无链路（vid={vid:#06X} model={model:#06X}，接收器认为没有连上的鼠标）"
        ));
    }
    if vid != MCHOSE_VID && vid != MCHOSE_LEGACY_VID {
        return Err(format!(
            "vid {vid:#06X} 不是迈从（期望 {MCHOSE_VID:#06X}/{MCHOSE_LEGACY_VID:#06X}）"
        ));
    }
    let flags = pay[8];
    let level = pay[9];
    let charge = pay[10];
    if level > 100 {
        return Err(format!("level {level} 超出 0–100"));
    }
    Ok(StatusParsed {
        level,
        charging: charge == 1,
        model,
        flags,
    })
}

fn parse_bond(pay: &[u8]) -> Result<BondParsed, String> {
    if pay.len() < 6 {
        return Err(format!("bond payload 过短: {} 字节", pay.len()));
    }
    Ok(BondParsed {
        vid: u16::from_le_bytes([pay[1], pay[2]]),
        pid: u16::from_le_bytes([pay[3], pay[4]]),
        connect: pay[5],
    })
}

fn status_info(parsed: StatusParsed, via: String) -> BatteryInfo {
    let charge_text = if parsed.charging {
        "充电中"
    } else {
        "未充电"
    };
    BatteryInfo {
        percent: Some(parsed.level),
        charging: Some(parsed.charging),
        connected: true,
        device: String::new(),
        detail: format!(
            "{via} · model 0x{:04X} · flags 0x{:02X} · {charge_text}",
            parsed.model, parsed.flags
        ),
    }
}

fn parse_status(resp: &[u8]) -> Result<StatusParsed, String> {
    let pay = decode_feature_response(resp, resp[0], CMD_STATUS)?;
    parse_status_payload(&pay)
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
    fn feature_lengths_match_protocol() {
        let short = make_request(CMD_STATUS, SHORT_REPORT, SHORT_PAYLOAD);
        assert_eq!(short.len(), 21);
        assert_eq!(short[0], SHORT_REPORT);
        assert_eq!(short[1], CMD_STATUS ^ 0xFF);
        assert!(short[2..].iter().all(|b| *b == 0xFF));
        let long = make_request(CMD_STATUS, LONG_REPORT, LONG_PAYLOAD);
        assert_eq!(long.len(), 65);
        let interrupt = make_interrupt_request(CMD_STATUS, SHORT_REPORT);
        assert_eq!(interrupt.len(), 64);
    }

    #[test]
    fn parses_halobattery_m7_sample_reply() {
        let payload = [
            0x53u8, 0x52, 0x31, 0x00, 0x02, 0x05, 0x07, 0x00, 0x09, 0x64, 0x00, 0x64,
        ];
        let mut resp = vec![SHORT_REPORT, CMD_STATUS ^ 0xFF];
        resp.extend(payload.iter().map(|byte| byte ^ 0xFF));
        let parsed = parse_status(&resp).unwrap();
        assert_eq!(parsed.level, 100);
        assert!(!parsed.charging);
        assert_eq!(parsed.model, 0x0031);
    }

    #[test]
    fn parses_3837_and_wrapped_interrupt() {
        let mut pay = vec![0u8; 12];
        pay[0] = 0x37;
        pay[1] = 0x38;
        pay[2] = 0x18;
        pay[3] = 0x10;
        pay[8] = 0x09;
        pay[9] = 55;
        pay[10] = 1;
        let mut frame = vec![SHORT_REPORT, 0xF9];
        frame.extend(pay.iter().map(|b| b ^ 0xFF));
        assert_eq!(parse_status(&frame).unwrap().level, 55);

        let mut wrapped = vec![INTERRUPT_WRAP, 0x91, 0x00, 0x01];
        wrapped.extend(frame);
        let parsed = parse_interrupt_buffer(&wrapped).unwrap();
        assert_eq!(parsed.level, 55);
        assert!(parsed.charging);
    }

    #[test]
    fn parses_bond_and_rejects_empty() {
        let pay = [0x01u8, 0x37, 0x38, 0x18, 0x10, 0x01, 0x00];
        let bond = parse_bond(&pay).unwrap();
        assert_eq!(bond.connect, 1);
        assert_eq!(bond.vid, 0x3837);

        let mut empty = vec![SHORT_REPORT, 0xF9];
        empty.extend(std::iter::repeat(0xFF).take(20));
        let err = parse_status(&empty).unwrap_err();
        assert!(err.contains("空 payload") || err.contains("无链路"));
    }

    #[test]
    fn rejects_magdock_topology_garbage_interrupt() {
        // 本机实读：4D 91 00 01 11 F9 FF FF FF FF FF FF 0D 00...
        let mut wrapped = vec![0x4D, 0x91, 0x00, 0x01, 0x11, 0xF9];
        wrapped.extend(std::iter::repeat(0xFF).take(6));
        wrapped.push(0x0D);
        wrapped.extend(std::iter::repeat(0x00).take(20));
        let err = parse_interrupt_buffer(&wrapped).unwrap_err();
        assert!(
            err.contains("空 payload") || err.contains("无链路") || err.contains("vid"),
            "err={err}"
        );
    }


}
