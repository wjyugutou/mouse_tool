use hidapi::{HidApi, HidDevice};
use serde::Serialize;
use std::time::Duration;

const RAPOO_VID: u16 = 0x24ae;
const CANDIDATE_PIDS: &[u16] = &[0x1200, 0x4400];
const REPORT_BB: u8 = 0xBB;
const REPORT_BA: u8 = 0xBA;

#[derive(Serialize)]
struct BatteryInfo {
    percent: Option<u8>,
    charging: Option<bool>,
    connected: bool,
    device: String,
    detail: String,
}

#[tauri::command]
fn get_battery() -> BatteryInfo {
    match read_vt9_battery() {
        Ok(info) => info,
        Err(err) => BatteryInfo {
            percent: None,
            charging: None,
            connected: false,
            device: "VT9 AIR".into(),
            detail: err,
        },
    }
}

fn read_vt9_battery() -> Result<BatteryInfo, String> {
    let api = HidApi::new().map_err(|e| format!("hidapi 初始化失败: {e}"))?;

    let mut candidates = Vec::new();
    for device in api.device_list() {
        if device.vendor_id() != RAPOO_VID {
            continue;
        }
        if !CANDIDATE_PIDS.contains(&device.product_id()) {
            continue;
        }
        candidates.push((
            device.product_id(),
            device.interface_number(),
            device.path().to_string_lossy().into_owned(),
            device.usage_page(),
            device.usage(),
        ));
    }

    if candidates.is_empty() {
        return Ok(BatteryInfo {
            percent: None,
            charging: None,
            connected: false,
            device: "VT9 AIR".into(),
            detail: "未找到 Rapoo 接收器（24AE:1200 / 24AE:4400）。WSL 看不到 Windows USB，请在 Windows 本机运行，或用 usbipd 挂载设备。".into(),
        });
    }

    let mut last_err = String::from("已找到设备，但未能读到电量报告。");
    for (pid, iface, path, usage_page, usage) in &candidates {
        match try_read_battery(&api, path, *pid, *iface, *usage_page, *usage) {
            Ok(info) => return Ok(info),
            Err(e) => last_err = e,
        }
    }

    Ok(BatteryInfo {
        percent: None,
        charging: None,
        connected: true,
        device: format!(
            "Rapoo {:04X}:{:04X}",
            RAPOO_VID,
            candidates[0].0
        ),
        detail: last_err,
    })
}

fn try_read_battery(
    api: &HidApi,
    path: &str,
    pid: u16,
    iface: i32,
    usage_page: u16,
    usage: u16,
) -> Result<BatteryInfo, String> {
    let device = api
        .open_path(std::ffi::CString::new(path).map_err(|e| e.to_string())?.as_c_str())
        .map_err(|e| format!("打开 HID 失败 interface={iface}: {e}"))?;

    // 触发官方驱动同款查询（Feature Report 0xBA）
    let _ = trigger_battery_query(&device);

    // 优先读中断报告 0xBB；末字节为电量百分比
    if let Some(percent) = read_bb_report(&device)? {
        return Ok(BatteryInfo {
            percent: Some(percent),
            charging: None,
            connected: true,
            device: format!("Rapoo {RAPOO_VID:04X}:{pid:04X} iface={iface}"),
            detail: format!(
                "Report 0xBB · usage_page=0x{usage_page:04X} usage=0x{usage:04X}"
            ),
        });
    }

    Err(format!(
        "interface={iface} 已打开，但超时未收到 0xBB 电量报告"
    ))
}

fn trigger_battery_query(device: &HidDevice) -> Result<(), String> {
    // SET_REPORT Feature 0xBA，对齐抓包中的初始化 / 查询序列
    let mut init = [0u8; 32];
    init[0] = REPORT_BA;
    init[1] = 0xb0;

    let mut query = [0u8; 32];
    query[0] = REPORT_BA;
    query[1] = 0xa5;
    query[2] = 0xa3;

    // Feature 失败时再尝试 Output Report
    if device.send_feature_report(&init).is_err() {
        let _ = device.write(&init);
    }
    std::thread::sleep(Duration::from_millis(30));
    if device.send_feature_report(&query).is_err() {
        let _ = device.write(&query);
    }
    std::thread::sleep(Duration::from_millis(30));
    Ok(())
}

fn read_bb_report(device: &HidDevice) -> Result<Option<u8>, String> {
    let mut buf = [0u8; 64];

    // 多读几次，过滤鼠标移动等其它报告
    for _ in 0..40 {
        match device.read_timeout(&mut buf, 100) {
            Ok(n) if n > 0 => {
                if let Some(p) = parse_bb(&buf[..n]) {
                    return Ok(Some(p));
                }
            }
            Ok(_) => {}
            Err(e) => return Err(format!("HID read 失败: {e}")),
        }
    }

    // 再尝试按 Input Report 主动取一次
    let mut feature = [0u8; 32];
    feature[0] = REPORT_BB;
    if device.get_feature_report(&mut feature).is_ok() {
        if let Some(p) = parse_bb(&feature) {
            return Ok(Some(p));
        }
    }

    Ok(None)
}

fn parse_bb(data: &[u8]) -> Option<u8> {
    // 抓包: bb b0 51 c4 09 01 38 ，末字节为电量
    if data.len() >= 7 && data[0] == REPORT_BB {
        let percent = data[6];
        if percent <= 100 {
            return Some(percent);
        }
    }
    // 有的栈会去掉 report id
    if data.len() >= 6 && data[0] == 0xb0 {
        let percent = data[5];
        if percent <= 100 {
            return Some(percent);
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_battery])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
