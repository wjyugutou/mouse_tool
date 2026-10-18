//! 被动 HID 探听器 —— 只听不说，绝不主动发报文。
//!
//! 用法：
//!   hid-probe list                 枚举本机所有 HID 设备
//!   hid-probe desc 0x320F          读报告描述符，拿到各接口真实的输入包长
//!   hid-probe watch 0x320F 25      被动监听某 VID 的接口 25 秒
//!   hid-probe battery 0x320F 0x04  主动 Feature 探测（仅协议已确认的设备）
//!
//! 安全红线：`list` / `desc` / `watch` 都不调用 get_feature_report、
//! send_feature_report、get_input_report；项目里有鼠标被这类调用卡死的前车之鉴，
//! 对未知设备尤其危险。只有 `battery` 子命令会主动发 Feature 报告，
//! 且必须是在协议来源可查、官方驱动本身就这么做时才用（当前只验证过 VGN S99）。

use hidapi::{DeviceInfo, HidApi};
use std::io::Write;
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

/// 主动电量探测 —— 只对协议已确认的设备使用。
///
/// 与 `watch` 的「只听不说」不同，这个子命令会真的往设备写一次 Feature 报告，
/// 因此只允许在协议来源可查、且官方驱动本身就这么做时使用。
///
/// 依据：VGN 官方驱动 VGN VHUB 4.0.6 渲染层明文 JS（`WsServe.getBattery`），
/// 命令载荷 `[0x87, 0x00, 0x00, 0x01, 0x00, 0x02, 0x00]`，Feature 报告，Report ID 0x04。
///
/// 官方代码 `new Uint8Array(len + 1); cmd.set(content, 0)` 多出的那一字节在**尾部**，
/// 所以 hidapi 这边（buf[0] 放 Report ID）载荷是 8 字节：7 字节命令 + 1 个 0。
fn battery(api: &HidApi, vid: u16, report_id: u8, usage_page: u16) -> Result<(), String> {
    println!("=== 主动电量探测 VID_{vid:04X} report=0x{report_id:02X} upage=0x{usage_page:04X} ===");

    let info = api
        .device_list()
        .find(|d| d.vendor_id() == vid && d.usage_page() == usage_page)
        .ok_or_else(|| format!("找不到 VID_{vid:04X} 且 upage=0x{usage_page:04X} 的接口"))?;

    println!(
        "  选中接口: iface={} usage=0x{:04X} 产品={}",
        info.interface_number(),
        info.usage(),
        info.product_string().unwrap_or("-")
    );
    println!("  path={}", info.path().to_string_lossy());

    let dev = api
        .open_path(info.path())
        .map_err(|err| format!("接口打不开（官方驱动可能正占用）: {err}"))?;

    // 7 字节命令 + 官方代码尾部多出的那个 0
    let payload: [u8; 8] = [0x87, 0x00, 0x00, 0x01, 0x00, 0x02, 0x00, 0x00];

    // 描述符声明 63 字节 payload（含 Report ID 共 64），官方代码却补零到 520。
    // 两个都试，看哪个真能通。
    for &total in &[64usize, 520usize] {
        println!("\n--- 尝试发送长度 {total} 字节 ---");

        let mut cmd = vec![0u8; total];
        cmd[0] = report_id;
        let n = payload.len().min(total - 1);
        cmd[1..=n].copy_from_slice(&payload[..n]);
        println!("  发送前 16B: {}", hex(&cmd[..16.min(total)]));

        if let Err(err) = dev.send_feature_report(&cmd) {
            println!("  send_feature_report 失败: {err}");
            continue;
        }
        println!("  send_feature_report: OK");

        std::thread::sleep(Duration::from_millis(50));

        // 缓冲区给足 1024，看设备到底回多少字节。
        // hidapi 2.6 的 get_feature_report 只收 buffer，Report ID 放在 buf[0]。
        let mut buf = vec![0u8; 1024];
        buf[0] = report_id;
        match dev.get_feature_report(&mut buf) {
            Ok(len) => {
                println!("  get_feature_report: 返回 {len} 字节");
                if len == 0 {
                    println!("  （空响应）");
                    continue;
                }
                let resp = &buf[..len];
                // 完整原始转储，不截断
                println!("  完整回包: {}", hex(resp));

                // 前 32 字节带下标，方便定位
                println!("  带下标前 {} 字节:", len.min(32));
                for chunk in resp[..len.min(32)].chunks(16) {
                    let row = chunk
                        .iter()
                        .map(|b| format!("{b:02X}"))
                        .collect::<Vec<_>>()
                        .join(" ");
                    println!("    {row}");
                }

                if len > 9 {
                    let level = resp[8];
                    let state = resp[9];
                    let charging = ((state >> 4) & 0x0F) == 1;
                    println!(
                        "  → 按官方口径解析: byte[8]=0x{level:02X} = {level} ({}%)，\
                         byte[9]=0x{state:02X} 高4位={} → charging={}",
                        level,
                        state >> 4 & 0x0F,
                        charging
                    );
                    if level > 100 {
                        println!("  !! byte[8] > 100，不像百分比，别直接当电量用");
                    }
                } else {
                    println!("  !! 响应不足 10 字节，无法按官方口径解析");
                }
            }
            Err(err) => println!("  get_feature_report 失败: {err}"),
        }
    }

    Ok(())
}

/// Output 报告探测 —— 按「厂商邮箱」模式：主机写 Output，设备回 Input。
///
/// 依据：`0xFF1C` 接口描述符实测只有 `81 00`(Input 63B) + `91 00`(Output 63B)，
/// **没有 B1 Feature 项**，所以 Feature 通道必失败（2026-10-19 实机证伪）。
/// 但命令载荷 `[0x87,0,0,1,0,2,0]` 仍来自官方驱动 JS，继续沿用。
///
/// 参照 `src-tauri/src/devices/mchose_a5_v3_ultra.rs` 的厂商邮箱做法。
/// 安全：只发 0x87 这一条查询命令，绝不发任何写配置命令。
fn output_probe(
    api: &HidApi,
    vid: u16,
    report_id: u8,
    usage_page: u16,
    tries: usize,
) -> Result<(), String> {
    println!(
        "=== Output 通道探测 VID_{vid:04X} report=0x{report_id:02X} upage=0x{usage_page:04X} ==="
    );

    let info = api
        .device_list()
        .find(|d| d.vendor_id() == vid && d.usage_page() == usage_page)
        .ok_or_else(|| format!("找不到 VID_{vid:04X} 且 upage=0x{usage_page:04X} 的接口"))?;

    println!(
        "  选中接口: iface={} usage=0x{:04X} 产品={}",
        info.interface_number(),
        info.usage(),
        info.product_string().unwrap_or("-")
    );
    println!("  path={}", info.path().to_string_lossy());

    let dev = api
        .open_path(info.path())
        .map_err(|err| format!("接口打不开（官方驱动可能正占用）: {err}"))?;

    // 命令载荷，来自官方 JS：new Uint8Array([135,0,0,1,0,2,0])
    let payload: [u8; 7] = [0x87, 0x00, 0x00, 0x01, 0x00, 0x02, 0x00];

    for attempt in 1..=tries {
        println!("\n--- 第 {attempt}/{tries} 次 ---");

        // hidapi 的 write：buf[0] 必须是 Report ID。描述符声明 63 字节 payload → 共 64 字节。
        let mut cmd = vec![0u8; 64];
        cmd[0] = report_id;
        cmd[1..=payload.len()].copy_from_slice(&payload);
        println!("  写入 64B: {}", hex(&cmd[..16]));

        if let Err(err) = dev.write(&cmd) {
            println!("  write 失败: {err}");
            std::thread::sleep(Duration::from_millis(150));
            continue;
        }
        println!("  write: OK");

        // 写完后等设备回 Input 报告。多轮短等待，避免设备慢一点就被判死。
        let mut got = false;
        for round in 1..=5 {
            let mut buf = vec![0u8; 256];
            match dev.read_timeout(&mut buf, 400) {
                Ok(0) => {
                    println!("  第 {round} 轮：无数据（超时）");
                    continue;
                }
                Ok(len) => {
                    let resp = &buf[..len];
                    println!("  ★ 第 {round} 轮收到 {len} 字节");
                    // 完整 dump，不截断 —— 必须看清 byte[8]/byte[9] 到底在哪
                    println!("  完整回包: {}", hex(resp));

                    // FF 占位包（迈从 A5 先例）：不发真数据，继续重发
                    let is_placeholder = resp.iter().skip(1).all(|b| *b == 0x00)
                        || resp.get(7) == Some(&0xFF);
                    if is_placeholder {
                        println!("  → 疑似 FF/空占位包，本次不算数，继续重发");
                        got = false;
                        break;
                    }

                    // 两种解释都算一遍：回包带不带 Report ID 前缀未确认
                    if resp.len() > 9 {
                        // 假设 A：buf[0] 是 Report ID(0x04)，数据从 buf[1] 起，对应官方 JS 的 getUint8(8)
                        let a_level = resp[9];
                        let a_state = resp[10.min(resp.len() - 1)];
                        println!(
                            "  [解释A 带ReportID] byte[9]=0x{a_level:02X}={a_level}({}%) byte[10]=0x{a_state:02X} 高4位={} charging={}",
                            if resp.len() > 10 { "" } else { "?" },
                            if resp.len() > 10 { (a_state >> 4) & 0x0F } else { 0 },
                            if resp.len() > 10 { ((a_state >> 4) & 0x0F) == 1 } else { false }
                        );
                    }
                    if resp.len() > 8 {
                        // 假设 B：回包无 Report ID，直接对应官方 JS 的 byte[8]
                        let b_level = resp[8];
                        let b_state = if resp.len() > 9 { resp[9] } else { 0 };
                        println!(
                            "  [解释B 不带]     byte[8]=0x{b_level:02X}={b_level} byte[9]=0x{b_state:02X} 高4位={} charging={}",
                            (b_state >> 4) & 0x0F,
                            ((b_state >> 4) & 0x0F) == 1
                        );
                        if b_level <= 100 {
                            println!("  → 解释B 的 byte[8]={b_level} 落在 0-100，像电量");
                        } else {
                            println!("  → 解释B 的 byte[8]={b_level} > 100，不是电量");
                        }
                    } else {
                        println!("  !! 回包不足 9 字节，两种解释都做不了");
                    }
                    got = true;
                    break;
                }
                Err(err) => {
                    println!("  读失败: {err}");
                    break;
                }
            }
        }

        if got {
            println!("\n  收到回包，停止重发。");
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(150));
    }

    println!("\n  {tries} 次都没收到回包。");
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
    const REPORT_ID: u8 = 0x04;

    println!("=== VGN S99 电量探测（官方 WsServe 协议）===");

    let info = api
        .device_list()
        .find(|d| d.vendor_id() == VID && d.product_id() == PID && d.usage_page() == USAGE_PAGE)
        .ok_or_else(|| {
            format!("找不到 VID_{VID:04X}/PID_{PID:04X} 且 upage=0x{USAGE_PAGE:04X} 的接口")
        })?;

    println!(
        "  接口: iface={} upage=0x{:04X} usage=0x{:04X} 产品={}",
        info.interface_number(),
        info.usage_page(),
        info.usage(),
        info.product_string().unwrap_or("-")
    );

    let dev = api
        .open_path(info.path())
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
        Some("battery") => {
            let vid = parse_vid(args.get(1));
            let report_id = args
                .get(2)
                .and_then(|raw| u8::from_str_radix(raw.trim_start_matches("0x"), 16).ok())
                .unwrap_or(0x04);
            let usage_page = args
                .get(3)
                .and_then(|raw| u16::from_str_radix(raw.trim_start_matches("0x"), 16).ok())
                .unwrap_or(0xFF1C);
            if let Err(err) = battery(&api, vid, report_id, usage_page) {
                eprintln!("{err}");
                std::process::exit(1);
            }
        }
        Some("output") => {
            let vid = parse_vid(args.get(1));
            let report_id = args
                .get(2)
                .and_then(|raw| u8::from_str_radix(raw.trim_start_matches("0x"), 16).ok())
                .unwrap_or(0x04);
            let usage_page = args
                .get(3)
                .and_then(|raw| u16::from_str_radix(raw.trim_start_matches("0x"), 16).ok())
                .unwrap_or(0xFF1C);
            let tries = args.get(4).and_then(|raw| raw.parse().ok()).unwrap_or(3);
            if let Err(err) = output_probe(&api, vid, report_id, usage_page, tries) {
                eprintln!("{err}");
                std::process::exit(1);
            }
        }
        Some("vgn") => {
            if let Err(err) = vgn_s99(&api) {
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
            println!("  hid-probe battery 0x320F 0x04  主动 Feature 探测 VGN S99 电量");
            println!("      （第 3 参数 Report ID 默认 0x04，第 4 参数 usage page 默认 0xFF1C）");
            println!("      注意：这是主动发报文，只对协议已确认的设备用");
            println!("  hid-probe output 0x320F 0x04 0xFF1C 3");
            println!("      Output 报告 + Input 读回（Feature 通道已被实机证伪，用这个）");
        }
    }

    let _ = std::io::stdout().flush();
}
