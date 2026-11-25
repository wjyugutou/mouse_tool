//! 开机自启：HKCU `Run` 下名为 `yugutou_tool` 的值，内容 `"<exe>" --autostart`。
//!
//! 与 Tauri 版 tauri-plugin-autostart 写的是同一个值，老用户升级后自启继续有效；
//! `--autostart` 让开机启动时只进托盘、不弹窗。NSH 自带的 login item 以 app id 命名且不带参数，
//! 分不出是不是开机启动，所以这里自己管。
//!
//! 安装目录换过之后，Run 里会留下已经不存在的 exe（例如旧的 `src-tauri\target\release`）。
//! 值还在，任务管理器也显示已启用，但登录时 Windows 找不到文件就直接跳过。
//! 启动时若登记的 exe 不在了，就改写成当前这份。

use std::path::{Path, PathBuf};

use crate::app_log;

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

/// Run 值指向的 exe 已经不在磁盘上时，改写成当前这份。
/// 值不存在（用户关了自启）或指向的文件还在时不动。
/// 从 `target` / `.nsh` 这类构建产物里启动时也不改，避免测试把用户的启动项改掉。
pub(crate) fn refresh_if_target_missing() {
    let raw = run_value();
    let parsed = raw.as_deref().and_then(exe_from_command);
    let target_exists = parsed.as_ref().is_some_and(|path| path.is_file());
    let artifact = std::env::current_exe()
        .map(|path| is_build_artifact(&path))
        .unwrap_or(true);
    if !should_rewrite(raw.as_deref(), target_exists, artifact) {
        return;
    }
    let old = raw.unwrap_or_default();
    match set(true) {
        Ok(_) => app_log::info(&format!(
            "autostart: Run exe missing ({old}), rewrote to current exe"
        )),
        Err(err) => app_log::error(&format!("autostart: rewrite Run exe failed: {err}")),
    }
}

/// 从 Run 值取出 exe。带引号的按引号切；没有引号时去掉末尾的 `--autostart`（Tauri 版的写法）。
fn exe_from_command(raw: &str) -> Option<PathBuf> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if let Some(rest) = raw.strip_prefix('"') {
        let end = rest.find('"')?;
        let path = &rest[..end];
        return if path.is_empty() { None } else { Some(PathBuf::from(path)) };
    }
    let suffix = format!(" {AUTOSTART_ARG}");
    let path = raw.strip_suffix(&suffix).unwrap_or(raw).trim();
    if path.is_empty() { None } else { Some(PathBuf::from(path)) }
}

/// `target_exists` 是 Run 里那个 exe 现在还在不在。构建目录里的进程不改用户的启动项。
fn should_rewrite(raw: Option<&str>, target_exists: bool, current_is_artifact: bool) -> bool {
    if current_is_artifact || raw.and_then(exe_from_command).is_none() {
        return false;
    }
    !target_exists
}

fn is_build_artifact(exe: &Path) -> bool {
    exe.components().any(|component| {
        let Some(name) = component.as_os_str().to_str() else {
            return false;
        };
        matches!(
            name.to_ascii_lowercase().as_str(),
            "target" | ".nsh" | "cursor-sandbox-cache" | "src-tauri"
        )
    })
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

#[cfg(test)]
mod tests {
    use super::{exe_from_command, is_build_artifact, should_rewrite};
    use std::path::Path;

    const STALE: &str =
        r"D:\DEV\wwwwj\mouse_tool\src-tauri\target\release\yugutou_tool.exe --autostart";

    #[test]
    fn tauri_run_value_parses_without_quotes() {
        let path = exe_from_command(STALE).unwrap();
        assert_eq!(
            path,
            Path::new(r"D:\DEV\wwwwj\mouse_tool\src-tauri\target\release\yugutou_tool.exe")
        );
    }

    #[test]
    fn quoted_run_value_keeps_spaces() {
        let raw = r#""C:\Program Files\yugutou_tool\yugutou_tool.exe" --autostart"#;
        assert_eq!(
            exe_from_command(raw).unwrap(),
            Path::new(r"C:\Program Files\yugutou_tool\yugutou_tool.exe")
        );
    }

    #[test]
    fn missing_registered_exe_is_rewritten() {
        assert!(should_rewrite(Some(STALE), false, false));
    }

    #[test]
    fn existing_exe_and_disabled_autostart_stay_put() {
        assert!(!should_rewrite(Some(STALE), true, false));
        assert!(!should_rewrite(None, false, false));
    }

    #[test]
    fn build_artifact_does_not_rewrite_the_user_run_key() {
        assert!(!should_rewrite(Some(STALE), false, true));
        assert!(is_build_artifact(Path::new(
            r"D:\DEV\wwwwj\mouse_tool\src-tauri\target\release\yugutou_tool.exe"
        )));
        assert!(!is_build_artifact(Path::new(
            r"D:\yugutou_tool\yugutou_tool.exe"
        )));
    }
}
