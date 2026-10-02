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
    log_dir().join("mouse_tool.log")
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
    let secs = dur.as_secs();
    let millis = dur.subsec_millis();
    let days = secs / 86400;
    let rem = secs % 86400;
    let hour = rem / 3600;
    let min = (rem % 3600) / 60;
    let sec = rem % 60;
    let (y, m, d) = civil_from_days(days as i64);
    format!("{y:04}-{m:02}-{d:02} {hour:02}:{min:02}:{sec:02}.{millis:03}Z")
}

/// Howard Hinnant days→公历（UTC）
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