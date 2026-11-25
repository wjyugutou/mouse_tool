//! 启动期文件日志：优先写到「可执行文件同目录/logs/mouse_tool.log」
//! （安装包即安装目录下的 logs）。若无写权限（例如装在 Program Files）则回退到
//! %LOCALAPPDATA%\com.wwwj.mousetool\logs。不依赖 Tauri 插件，进程最早阶段就能落盘；panic 也会记一行。

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

static LOG_FILE: Mutex<Option<PathBuf>> = Mutex::new(None);

/// 初始化日志路径、安装 panic hook，并写入启动头。
pub fn init() {
    let path = log_file_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut guard) = LOG_FILE.lock() {
        *guard = Some(path.clone());
    }

    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let loc = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown".into());
        let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "non-string panic payload".into()
        };
        write_line("PANIC", &format!("{payload} @ {loc}"));
        prev(info);
    }));

    let args: Vec<String> = std::env::args().collect();
    write_line(
        "INFO",
        &format!(
            "==== start pid={} cwd={:?} args={:?} ====",
            std::process::id(),
            std::env::current_dir().ok(),
            args
        ),
    );
    write_line("INFO", &format!("log_file={}", path.display()));
}

/// 可执行文件所在目录下的 logs（安装目录）。
fn install_logs_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?.join("logs");
    if std::fs::create_dir_all(&dir).is_err() {
        return None;
    }
    // 探测是否可写（Program Files 等常失败）
    let probe = dir.join(".write_probe");
    match OpenOptions::new().create(true).write(true).open(&probe) {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            Some(dir)
        }
        Err(_) => None,
    }
}

fn fallback_log_dir() -> PathBuf {
    #[cfg(windows)]
    {
        if let Ok(base) = std::env::var("LOCALAPPDATA") {
            return PathBuf::from(base)
                .join("com.wwwj.mousetool")
                .join("logs");
        }
    }
    #[cfg(not(windows))]
    {
        if let Ok(base) = std::env::var("HOME") {
            return PathBuf::from(base)
                .join(".local")
                .join("share")
                .join("com.wwwj.mousetool")
                .join("logs");
        }
    }
    PathBuf::from("logs")
}

pub fn log_dir() -> PathBuf {
    install_logs_dir().unwrap_or_else(fallback_log_dir)
}

pub fn log_file_path() -> PathBuf {
    log_dir().join("mouse_tool_nsh.log")
}

pub fn info(msg: &str) {
    write_line("INFO", msg);
}

pub fn warn(msg: &str) {
    write_line("WARN", msg);
}

pub fn error(msg: &str) {
    write_line("ERROR", msg);
}

fn write_line(level: &str, msg: &str) {
    let ts = now_stamp();
    let line = format!("[{ts}] [{level}] {msg}\n");
    let path = LOG_FILE
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .unwrap_or_else(log_file_path);
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = f.write_all(line.as_bytes());
        let _ = f.flush();
    }
}

fn now_stamp() -> String {
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    stamp_from_unix(dur.as_secs(), dur.subsec_millis(), local_offset_secs())
}

/// Unix 时刻按 `offset_secs`（本地减 UTC）写成带数字偏移的本地时间。
fn stamp_from_unix(secs: u64, millis: u32, offset_secs: i32) -> String {
    let local = secs as i64 + i64::from(offset_secs);
    let days = local.div_euclid(86_400);
    let rem = local.rem_euclid(86_400) as u64;
    let hour = rem / 3600;
    let min = (rem % 3600) / 60;
    let sec = rem % 60;
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02} {hour:02}:{min:02}:{sec:02}.{millis:03}{}",
        format_offset(offset_secs)
    )
}

fn format_offset(offset_secs: i32) -> String {
    let sign = if offset_secs >= 0 { '+' } else { '-' };
    let abs = offset_secs.unsigned_abs();
    let hours = abs / 3600;
    let mins = (abs % 3600) / 60;
    format!("{sign}{hours:02}:{mins:02}")
}

/// 当前时区相对 UTC 的秒数。Windows 用 `GetTimeZoneInformation` 的 Bias
/// （分钟，UTC = 本地 + Bias，夏令时再加 DaylightBias / StandardBias）。
fn local_offset_secs() -> i32 {
    #[cfg(windows)]
    {
        #[repr(C)]
        struct WinSystemTime {
            _year: u16,
            _month: u16,
            _day_of_week: u16,
            _day: u16,
            _hour: u16,
            _minute: u16,
            _second: u16,
            _milliseconds: u16,
        }
        #[repr(C)]
        struct TimeZoneInformation {
            bias: i32,
            _standard_name: [u16; 32],
            _standard_date: WinSystemTime,
            standard_bias: i32,
            _daylight_name: [u16; 32],
            _daylight_date: WinSystemTime,
            daylight_bias: i32,
        }
        #[link(name = "kernel32")]
        extern "system" {
            fn GetTimeZoneInformation(info: *mut TimeZoneInformation) -> u32;
        }
        const TIME_ZONE_ID_STANDARD: u32 = 1;
        const TIME_ZONE_ID_DAYLIGHT: u32 = 2;
        const TIME_ZONE_ID_INVALID: u32 = 0xFFFF_FFFF;
        const _: () = assert!(std::mem::size_of::<TimeZoneInformation>() == 172);
        let mut info = unsafe { std::mem::zeroed::<TimeZoneInformation>() };
        let kind = unsafe { GetTimeZoneInformation(&mut info) };
        if kind == TIME_ZONE_ID_INVALID {
            return 0;
        }
        let extra = match kind {
            TIME_ZONE_ID_DAYLIGHT => info.daylight_bias,
            TIME_ZONE_ID_STANDARD => info.standard_bias,
            _ => 0,
        };
        -(info.bias + extra) * 60
    }
    #[cfg(not(windows))]
    {
        0
    }
}

/// Howard Hinnant：日数（相对 1970-01-01）→ 公历
fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

#[cfg(test)]
mod tests {
    use super::{now_stamp, stamp_from_unix};

    /// 截图里的那一行：UTC 01:16:38 在东八区应是 09:16:38，不能再标 Z。
    #[test]
    fn china_offset_matches_wall_clock() {
        let secs = 1_795_569_398;
        assert_eq!(
            stamp_from_unix(secs, 563, 8 * 3600),
            "2026-11-25 09:16:38.563+08:00"
        );
    }

    #[test]
    fn positive_offset_crosses_midnight() {
        let secs = 1_795_636_800;
        assert_eq!(
            stamp_from_unix(secs, 0, 8 * 3600),
            "2026-11-26 04:00:00.000+08:00"
        );
    }

    #[test]
    fn negative_offset_crosses_to_previous_day() {
        let secs = 1_795_569_398;
        assert_eq!(
            stamp_from_unix(secs, 563, -8 * 3600),
            "2026-11-24 17:16:38.563-08:00"
        );
    }

    #[test]
    fn half_hour_offset() {
        let secs = 1_795_569_398;
        assert_eq!(
            stamp_from_unix(secs, 0, 5 * 3600 + 30 * 60),
            "2026-11-25 06:46:38.000+05:30"
        );
    }

    /// 本机墙钟，用作日志时间的对照。和 `now_stamp` 分开取，避免测的是同一个函数。
    #[cfg(windows)]
    fn local_wall() -> (u16, u16, u16, u16, u16, u16) {
        #[repr(C)]
        struct SystemTime {
            year: u16,
            month: u16,
            _day_of_week: u16,
            day: u16,
            hour: u16,
            minute: u16,
            second: u16,
            _milliseconds: u16,
        }
        #[link(name = "kernel32")]
        extern "system" {
            fn GetLocalTime(st: *mut SystemTime);
        }
        let mut st = unsafe { std::mem::zeroed() };
        unsafe { GetLocalTime(&mut st) };
        (st.year, st.month, st.day, st.hour, st.minute, st.second)
    }

    #[cfg(windows)]
    #[test]
    fn now_stamp_matches_local_clock() {
        let stamp = now_stamp();
        let (y, mo, d, h, mi, s) = local_wall();
        let date = format!("{y:04}-{mo:02}-{d:02}");
        assert!(
            stamp.starts_with(&date),
            "log {stamp} != local {date} {h:02}:{mi:02}:{s:02}"
        );
        let logged_h: i64 = stamp[11..13].parse().unwrap();
        let logged_mi: i64 = stamp[14..16].parse().unwrap();
        let logged_s: i64 = stamp[17..19].parse().unwrap();
        let logged = logged_h * 3600 + logged_mi * 60 + logged_s;
        let wall = i64::from(h) * 3600 + i64::from(mi) * 60 + i64::from(s);
        let delta = (logged - wall).abs();
        assert!(
            delta <= 2,
            "log {stamp} != local {y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}"
        );
        assert!(!stamp.ends_with('Z'), "log {stamp} is still labeled UTC");
    }
}