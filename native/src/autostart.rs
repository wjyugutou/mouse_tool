//! 开机自启：HKCU `Run` 下名为 `yugutou_tool` 的值，内容 `"<exe>" --autostart`。
//!
//! 与 Tauri 版 tauri-plugin-autostart 写的是同一个值，老用户升级后自启继续有效；
//! `--autostart` 让开机启动时只进托盘、不弹窗。NSH 自带的 login item 以 app id 命名且不带参数，
//! 分不出是不是开机启动，所以这里自己管。

pub(crate) const RUN_VALUE_NAME: &str = "yugutou_tool";
pub(crate) const AUTOSTART_ARG: &str = "--autostart";

/// 这次进程是不是开机自启拉起来的。
pub(crate) fn launched_at_login() -> bool {
    std::env::args().any(|arg| arg == AUTOSTART_ARG)
}

#[cfg(windows)]
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

/// 注册表里的 Run 值（没有就是 `None`）。
#[cfg(windows)]
pub(crate) fn run_value() -> Option<String> {
    windows_registry::CURRENT_USER
        .open(RUN_KEY)
        .and_then(|key| key.get_string(RUN_VALUE_NAME))
        .ok()
}

#[cfg(not(windows))]
pub(crate) fn run_value() -> Option<String> {
    None
}

/// 是否已开启开机自启。
pub(crate) fn enabled() -> bool {
    run_value().is_some()
}

/// 当前 exe 的 Run 命令。
#[cfg(windows)]
fn command() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe failed: {e}"))?;
    Ok(format!("\"{}\" {AUTOSTART_ARG}", exe.display()))
}

/// 开 / 关开机自启；返回之后的状态。
#[cfg(windows)]
pub(crate) fn set(on: bool) -> Result<bool, String> {
    let key = windows_registry::CURRENT_USER
        .create(RUN_KEY)
        .map_err(|e| format!("open Run key failed: {e}"))?;
    if on {
        key.set_string(RUN_VALUE_NAME, command()?)
            .map_err(|e| format!("write Run value failed: {e}"))?;
    } else if run_value().is_some() {
        key.remove_value(RUN_VALUE_NAME)
            .map_err(|e| format!("remove Run value failed: {e}"))?;
    }
    Ok(enabled())
}

#[cfg(not(windows))]
pub(crate) fn set(_on: bool) -> Result<bool, String> {
    Err("开机自启目前只支持 Windows".into())
}
