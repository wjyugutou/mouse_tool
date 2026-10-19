//! HID 探针。`list` / `desc` / `watch` 只听不说。
//!
//! 用法：
//!   hid-probe list                 枚举本机所有 HID 设备
//!   hid-probe desc 0x320F          读报告描述符，拿到各接口真实的输入包长
//!   hid-probe watch 0x320F 25      被动监听某 VID 的接口 25 秒
//!   hid-probe vgn                  按已验证的 VGN S99 协议读一次电量
//!
//! `list` / `desc` / `watch` 不调用 write、send_feature_report、
//! get_feature_report、get_input_report。Feature 报告会卡死雷柏一类设备，
//! 而且 VGN S99 的 0xFF1C 接口没有 Feature 项，旧的 0x87 Feature 命令已证伪。
//! 唯一会写报文的子命令是 `vgn`：只发只读查询 0x1A。

use hidapi::{DeviceInfo, HidApi};
use std::io::Write;
use std::thread;
use std::time::{Duration, Instant};

/// 关心的两只设备。
const TARGETS: &[(&str, &str, u16)] = &[
    ("VGN S99 2.4G Dongle", "VGN S99 键盘接收器", 0x320F),
    ("Gaming 2.4G", "前行者 S9 Pro 鼠标接收器", 0x372E),
];

fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn label_of(info: &DeviceInfo) -> Option<&'static str> {
    TARGETS
        .iter()
        .find(|(_, _, vid)| *vid == info.vendor_id())
        .map(|(_, label, _)| *label)
}

fn list(api: &HidApi) {
    println!("=== 本机 HID 设备 ===");
    let mut rows: Vec<String> = Vec::new();
    for info in api.device_list() {
        let tag = match label_of(info) {
            Some(label) => format!("  <<< {label}"),
            None => String::new(),
        };
        rows.push(format!(
            "VID_{:04X}&PID_{:04X} | {} | {} | iface={} upage=0x{:04X} usage=0x{:04X}{tag}",
            info.vendor_id(),
            info.product_id(),
            info.product_string().unwrap_or("-"),
            info.manufacturer_string().unwrap_or("-"),
            info.interface_number(),
            info.usage_page(),
            info.usage()
        ));
    }
    rows.sort();
    for row in rows {
        println!("{row}");
    }
}

/// 把描述符里的小端数据项拼成数值。
fn item_val(data: &[u8]) -> usize {
    data.iter()
        .rev()
        .enumerate()
        .fold(0usize, |acc, (pos, b)| acc | ((*b as usize) << (8 * pos)))
}

/// 读报告描述符，算出每个 Input 项声明的字节数 = ReportSize × ReportCount / 8。
/// 这样才知道该用多大的缓冲区去读，不会再撞「缓冲区无效」。
fn describe(api: &HidApi, vid: u16) {
    println!("=== 报告描述符 VID_{vid:04X} ===");
    for info in api.device_list() {
        if info.vendor_id() != vid {
            continue;
        }
        let Ok(dev) = api.open_path(info.path()) else {
            println!("  iface={} 打不开", info.interface_number());
            continue;
        };
        let mut buf = [0u8; 4096];
        let Ok(len) = dev.get_report_descriptor(&mut buf) else {
            println!("  iface={} 读不到描述符", info.interface_number());
            continue;
        };
        let raw = &buf[..len];
        println!(
            "\n--- iface={} upage=0x{:04X} usage=0x{:04X} 描述符 {len} 字节 ---",
            info.interface_number(),
            info.usage_page(),
            info.usage()
        );
        println!("     原始: {}", hex(&raw[..len.min(48)]));

        let mut report_size = 0usize;
        let mut report_count = 0usize;
        let mut i = 0usize;
        while i < len {
            let item = raw[i];
            if item == 0xFE {
                break;
            }
            let data_len = match item & 0x03 {
                0 => 0,
                1 => 1,
                2 => 2,
                _ => 4,
            };
            if i + 1 + data_len > len {
                break;
            }
            let data = &raw[i + 1..i + 1 + data_len];
            let val = item_val(data);
            match item & 0xFC {
                0x74 => report_size = val,
                0x94 => report_count = val,
                0x80 => {
                    let bytes = (report_size * report_count + 7) / 8;
                    if bytes > 0 {
                        println!(
                            "     → Input 包长 {bytes} 字节 (size={report_size} count={report_count})"
                        );
                    }
                }
                _ => {}
            }
            i += 1 + data_len;
        }
    }
}

/// 被动读。开设备后只等它自己送报告上来，最多等 `secs` 秒。
fn watch(api: &HidApi, vid: u16, secs: u64) -> Result<(), String> {
    let mut opened = 0usize;
    for info in api.device_list() {
        if info.vendor_id() != vid {
            continue;
        }
        let dev = match api.open_path(info.path()) {
            Ok(dev) => dev,
            Err(err) => {
                println!(
                    "  [打不开] iface={} upage=0x{:04X} err={err}",
                    info.interface_number(),
                    info.usage_page()
                );
                continue;
            }
        };
        opened += 1;
        println!(
            "\n--- 监听中 iface={} upage=0x{:04X} usage=0x{:04X}（只听 {secs}s，不发任何报文）---",
            info.interface_number(),
            info.usage_page(),
            info.usage()
        );

        let deadline = Instant::now() + Duration::from_secs(secs);
        // 描述符说多少就用多少，另留余量；读不满就按 64 兜底
        let mut buf = vec![0u8; 256];
        let mut seen = std::collections::BTreeMap::<Vec<u8>, usize>::new();
        let mut total = 0usize;

        while Instant::now() < deadline {
            match dev.read_timeout(&mut buf, 500) {
                Ok(0) => continue,
                Ok(len) => {
                    let packet = buf[..len].to_vec();
                    total += 1;
                    let counter = seen.entry(packet.clone()).or_insert(0);
                    *counter += 1;
                    if *counter <= 3 {
                        println!("  [{}B x{}] {}", len, counter, hex(&packet));
                    }
                }
                Err(err) => {
                    println!("  [读失败] {err}");
                    break;
                }
            }
        }

        println!("  → 共 {total} 包，{} 种不同内容", seen.len());
        let mut ranked: Vec<_> = seen.into_iter().collect();
        ranked.sort_by(|a, b| b.1.cmp(&a.1));
        for (packet, count) in ranked.into_iter().take(5) {
            println!("     常见包 x{count}: {}", hex(&packet));
        }
    }

    if opened == 0 {
        return Err(format!("VID_{vid:04X} 没有任何接口能打开"));
    }
    Ok(())
}

/// VGN S99 电量探测 —— 按官方驱动 `WsServe` 类的真实协议（2026-10-19 逐行核对源码）。
///
/// 来源：VGN VHUB 4.0.6 渲染层 `home-BW6QrJDS.js` 的 `class WsServe`，以及
/// `v98ProV4.keyboard.assets-CCNTf5Nj.js` 里的 `WsCmd` 枚举。
///
/// - 命令：`getElectricQuantity()` → `Uint8Array([0, 0, WsCmd.GetBatterLevel, 6, 0, 0, 0])`
///   其中 `WsCmd.GetBatterLevel = 26 = 0x1A`
/// - 发送：`sendBuffer()` 用 `device.sendReport(reportId, data)` → **Output 报告**，非 Feature
/// - 回包：`readBuffer()` 的 `oninputreport`，`monitorData[2] == 26` 时取
///   `battery.level = remainingHex[0]`（`remainingHex = monitorData.slice(7)`）
///   → **电量 = 回包 byte[7]，充电 = 回包 byte[8]**
///
/// 旧文档记的 `[0x87,0,0,1,0,2,0]` 与 byte[8]/byte[9] 口径**是错的**。
fn vgn_s99(api: &HidApi) -> Result<(), String> {
    const VID: u16 = 0x320F;
    const PID: u16 = 0x5088;
    const USAGE_PAGE: u16 = 0xFF1C;
    const USAGE: u16 = 0x0092;
    const REPORT_ID: u8 = 0x04;

    println!("=== VGN S99 电量探测（官方 WsServe 协议）===");

    let candidates: Vec<_> = api
        .device_list()
        .filter(|d| d.vendor_id() == VID && d.product_id() == PID && d.usage_page() == USAGE_PAGE)
        .map(|d| {
            (
                d.usage(),
                d.interface_number(),
                d.path().to_owned(),
                d.product_string().unwrap_or("-").to_string(),
            )
        })
        .collect();
    let info = candidates
        .iter()
        .find(|candidate| candidate.0 == USAGE)
        .or_else(|| candidates.first())
        .ok_or_else(|| {
            format!("找不到 VID_{VID:04X}/PID_{PID:04X} 且 upage=0x{USAGE_PAGE:04X} 的接口")
        })?;

    println!(
        "  接口: iface={} upage=0x{USAGE_PAGE:04X} usage=0x{:04X} 产品={}",
        info.1, info.0, info.3
    );

    let dev = api
        .open_path(&info.2)
        .map_err(|err| format!("接口打不开（VGN VHUB 可能正占用）: {err}"))?;

    // 官方命令内容
    let payload: [u8; 7] = [0x00, 0x00, 0x1A, 0x06, 0x00, 0x00, 0x00];

    for attempt in 1..=3 {
        println!("\n--- 第 {attempt}/3 次 ---");

        // hidapi write：buf[0] = Report ID，其余是 payload（Output 声明 63 字节）
        let mut cmd = vec![0u8; 64];
        cmd[0] = REPORT_ID;
        cmd[1..=payload.len()].copy_from_slice(&payload);
        println!("  写入 64B: {}", hex(&cmd[..16]));

        if let Err(err) = dev.write(&cmd) {
            println!("  write 失败: {err}");
            std::thread::sleep(Duration::from_millis(200));
            continue;
        }
        println!("  write: OK");

        // 官方 sendBuffer 是轮询等回包（约 200ms 上限），这里放宽容错
        for _round in 1..=5 {
            let mut buf = vec![0u8; 256];
            match dev.read_timeout(&mut buf, 400) {
                Ok(0) => continue,
                Ok(len) => {
                    let resp = &buf[..len];
                    println!("  ★ 收到 {len} 字节:");
                    println!("     {}", hex(resp));

                    // hidapi 的回包里 buf[0] 是 Report ID（官方 node-hid 的 event.data 不含它），
                    // 所以官方下标整体 +1：命令码在 buf[3]，电量在 buf[8]，充电在 buf[9]。
                    // 同时保留「不带 ReportID」的下标判断，兼容两种实现。
                    let has_report_id = len > 0 && resp[0] == REPORT_ID;
                    let base = if has_report_id { 1 } else { 0 };
                    let cmd_at = base + 2;
                    let is_battery = len > cmd_at && resp[cmd_at] == 0x1A;
                    println!(
                        "  buf[{cmd_at}]=0x{:02X}（{}）→ {}",
                        if len > cmd_at { resp[cmd_at] } else { 0 },
                        if has_report_id {
                            "带 ReportID，已偏移+1"
                        } else {
                            "无 ReportID"
                        },
                        if is_battery {
                            "✅ 是电量包 (0x1A)"
                        } else {
                            "不是电量包，继续等"
                        }
                    );

                    let level_at = base + 7;
                    let charging_at = base + 8;
                    if is_battery && len > charging_at {
                        let level = resp[level_at];
                        let charging = resp[charging_at];
                        println!("  → 电量 byte[{level_at}] = {level}%");
                        println!(
                            "  → 充电 byte[{charging_at}] = {charging}（{}）",
                            if charging != 0 {
                                "充电中"
                            } else {
                                "未充电"
                            }
                        );
                        if level > 100 {
                            println!("  !! 电量 > 100，异常");
                        } else {
                            println!("\n  ✓ 读取成功");
                            return Ok(());
                        }
                    } else if is_battery {
                        println!("  !! 电量包但长度不足（实际 {len}，需要 > {charging_at}）");
                    }
                }
                Err(err) => {
                    println!("  读失败: {err}");
                    break;
                }
            }
        }
    }

    Err("3 次都没拿到电量包".into())
}

/// 前行者 S9 Pro 电量探测 —— 按 `ms_pix_v1` 协议（IPI / PIAO 系）。
///
/// ## 协议来源
///
/// VID `0x372E` 是 IPI（PIAO）的厂商号，协议名 `ms_pix_v1`。
/// 官方配置器是 WebHID 应用 `https://shan.ipigame.cn/`，协议从它的 JS 包里提取；
/// 另有开源项目在**实机**上验证过同一套协议（含 2.4G 接收器）：
/// `wkchew03/Mouse-Battery-Tracker` 的 `mbt/drivers/ipi.py` 与 `docs/protocols.md`。
///
/// ## 帧格式（63 字节 Feature 报告，Report ID 0x03）
///
/// ```text
/// payload = [crc, 0x50, 0x00, 0x02, 0x4F, 0x81, 0, 0, ...]  补零到 63 字节
/// crc     = sum(payload[1:]) % 256，放在 payload[0]
/// ```
///
/// 电量不是独立命令，而是 `get_basic_info` 回包的**第 5 个字段**。
///
/// ## 两个必须注意的坑
///
/// 1. **首次读回是 5 字节状态桩**（`03 50 02 00 02`），真正的 16 字节回包要再读几次才出现。
///    读一次就放弃，看起来和「设备不应答」完全一样 —— 这正是别人踩过的坑。
/// 2. **充电时电量字段是哨兵值 `0xE4`(228)**，不是百分比，也拿不到真实电量
///    （官方配置器此时也显示 228）。所以 0..=100 才是百分比。
///
/// ## 回包样例（实机，80% 电量）
///
/// ```text
/// 03 50 00 0b 02 01 50 21 07 01 90 65 ...
///                ^^ 电量 = 0x50 = 80
/// ```
///
/// ## 安全
///
/// 只发 `0x4F/0x81` 这一条**只读查询**，绝不发任何 `SET_*` 写配置命令；
/// 不调 `get_input_report`（项目硬规则）；读取最多 8 次就停，不循环轰炸。
fn s9_pro(api: &HidApi) -> Result<(), String> {
    const VID: u16 = 0x372E;
    // 与插件 `qianxingzhe_s9_pro.rs` 的 `PRODUCT_IDS` 对齐：只收前行者 S9 系列。
    // `0x1029` 是 Pro 有线；`0x1027`/`0x105E` 是 Ultra/Max 有线（探针读出后同样
    // 会提示型号边界）；`0x1026/0x1033/0x103D/0x1055` 是三型号共用的 2.4G 接收器。
    // **不要**把 IPI 自家机型（`0x1014/0x1015/0x1028/0x1056`）加进来：协议虽同，
    // 但不是本设备，插件侧有回归测试 `does_not_claim_other_ipi_models` 守着。
    const PIDS: &[u16] = &[0x1029, 0x1027, 0x105E, 0x1026, 0x1033, 0x103D, 0x1055];
    const USAGE_PAGE: u16 = 0xFF00;
    const REPORT_ID: u8 = 0x03;
    const PAYLOAD_LEN: usize = 63;
    const FRAME_MARKER: u8 = 0x50;
    /// 首次读回的 5 字节状态桩长度。
    const STUB_LEN: usize = 5;
    /// 充电哨兵值。
    const CHARGING_SENTINEL: u8 = 0xE4;

    println!("=== 前行者 S9 Pro 电量探测（ms_pix_v1 / IPI 协议）===");

    let Some(info) = api
        .device_list()
        .find(|d| d.vendor_id() == VID && PIDS.contains(&d.product_id()) && d.usage_page() == USAGE_PAGE)
    else {
        return Err(format!(
            "找不到 VID_{VID:04X} 且 upage=0x{USAGE_PAGE:04X} 的厂商接口（接收器没插？）"
        ));
    };

    println!(
        "  接口: iface={} upage=0x{:04X} usage=0x{:04X} PID=0x{:04X} 产品={}",
        info.interface_number(),
        info.usage_page(),
        info.usage(),
        info.product_id(),
        info.product_string().unwrap_or("-")
    );

    let dev = api
        .open_path(info.path())
        .map_err(|err| format!("接口打不开（官方驱动可能正占用）: {err}"))?;

    // get_basic_info 命令：crc 先留 0，后面由 set_crc 填
    let mut payload = vec![0u8; PAYLOAD_LEN];
    payload[1] = FRAME_MARKER;
    payload[2] = 0x00;
    payload[3] = 0x02;
    payload[4] = 0x4F;
    payload[5] = 0x81;
    payload[0] = payload[1..].iter().fold(0u8, |acc, b| acc.wrapping_add(*b));

    // hidapi 的 send_feature_report 要求 buf[0] 是 Report ID
    let mut frame = Vec::with_capacity(PAYLOAD_LEN + 1);
    frame.push(REPORT_ID);
    frame.extend_from_slice(&payload);

    println!("  发送 {} 字节: {}", frame.len(), hex(&frame[..16]));

    dev.send_feature_report(&frame)
        .map_err(|err| format!("send_feature_report 失败: {err}"))?;
    println!("  send_feature_report: OK");

    // 首次读回是状态桩，必须继续读。最多 8 次，每次间隔 50ms。
    for attempt in 1..=8 {
        thread::sleep(Duration::from_millis(50));

        // 关键坑：缓冲区不足 64 字节时设备直接报 read error，必须给满
        let mut buf = vec![0u8; PAYLOAD_LEN + 1];
        buf[0] = REPORT_ID;

        match dev.get_feature_report(&mut buf) {
            Ok(len) => {
                println!("\n  第 {attempt}/8 次读回：{len} 字节");
                println!("    {}", hex(&buf[..len]));

                if len <= STUB_LEN {
                    // 3 字节或 5 字节的都是状态桩
                    println!("    → 这是状态桩（≤{STUB_LEN} 字节），继续读");
                    continue;
                }

                if buf[1] != FRAME_MARKER {
                    println!(
                        "    → 帧标记不是 0x50（实际 0x{:02X}），不是 basic_info 回包，继续读",
                        buf[1]
                    );
                    continue;
                }

                if buf[4] != 0x02 {
                    println!(
                        "    → 命令码不符（buf[4]=0x{:02X}，期望 0x02），继续读",
                        buf[4]
                    );
                    continue;
                }

                let level = buf[6];
                println!("\n  ✓ 收到 basic_info 回包");
                println!("    buf[1]=0x50 帧标记 ✓  buf[4]=0x02 命令码 ✓");
                if level == CHARGING_SENTINEL {
                    println!("    → 电量字段 = 0xE4(228) = 充电哨兵值");
                    println!("    → 正在充电，此状态拿不到百分比（官方配置器同样只显示 228）");
                } else if level <= 100 {
                    println!("    → 电量 = buf[6] = {level}%");
                } else {
                    println!("    → 电量字段 = {level}，不在 0..=100 也不是哨兵值，无法判定");
                }
                return Ok(());
            }
            Err(err) => {
                println!("  第 {attempt}/8 次读失败: {err}");
            }
        }
    }

    Err("8 次都没读到 basic_info 回包（只读到状态桩）".into())
}

fn parse_vid(raw: Option<&String>) -> u16 {
    raw.and_then(|raw| u16::from_str_radix(raw.trim_start_matches("0x"), 16).ok())
        .unwrap_or(0x320F)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();

    let api = match HidApi::new() {
        Ok(api) => api,
        Err(err) => {
            eprintln!("HID 初始化失败: {err}");
            std::process::exit(1);
        }
    };

    match args.first().map(String::as_str) {
        Some("list") => list(&api),
        Some("desc") => describe(&api, parse_vid(args.get(1))),
        Some("vgn") => {
            if let Err(err) = vgn_s99(&api) {
                eprintln!("{err}");
                std::process::exit(1);
            }
        }
        Some("s9pro") => {
            if let Err(err) = s9_pro(&api) {
                eprintln!("{err}");
                std::process::exit(1);
            }
        }
        Some("watch") => {
            let vid = parse_vid(args.get(1));
            let secs = args.get(2).and_then(|raw| raw.parse().ok()).unwrap_or(20);
            if let Err(err) = watch(&api, vid, secs) {
                eprintln!("{err}");
                std::process::exit(1);
            }
        }
        _ => {
            println!("用法：");
            println!("  hid-probe list                 枚举所有 HID 设备");
            println!("  hid-probe desc 0x320F          读报告描述符，看真实包长");
            println!("  hid-probe watch 0x320F 25      被动监听 VGN S99 接收器 25 秒");
            println!("  hid-probe watch 0x372E 25      被动监听 前行者 接收器 25 秒");
            println!(
                "  hid-probe vgn                  按 WsServe 协议读 VGN S99 电量（只发 0x1A）"
            );
            println!(
                "  hid-probe s9pro                读前行者 S9 Pro 电量（ms_pix_v1，Feature 0x03，只发只读查询 0x4F/0x81）"
            );
        }
    }

    let _ = std::io::stdout().flush();
}
