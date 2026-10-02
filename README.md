# 鼠标工具（mouse_tool）

用 Tauri + React 做的 Windows 桌面小工具：显示雷柏 **VT9 AIR** 电量，不依赖雷柏 GameDev 常驻运行。

仓库：https://github.com/wjyugutou/mouse_tool

## 功能

- 被动读取 HID 电量（Report `0xBB`，勿用 GetInputReport，会卡鼠标）
- 托盘图标显示电量；左键选设备，双击打开主窗口
- 设置：主题、刷新间隔、关窗隐藏到托盘 / 退出、开机自启
- 应用内检查更新（GitHub Releases + `latest.json`）
- 运行日志：优先写在安装目录 `logs/mouse_tool.log`（无写权限则回退 AppData）

## 开发

需要：Windows、Node（建议 LTS）、pnpm、Rust。

```powershell
pnpm install
pnpm dev:app
```

前端单独调试：`pnpm dev`（默认 http://localhost:1420）。

## 版本号

改 `package.json` 的 `version` 后执行：

```powershell
pnpm version:sync
```

会自动同步到 `src-tauri/tauri.conf.json` 与 `src-tauri/Cargo.toml`。`pnpm build` / `pnpm build:app` 也会先跑同步。

发版时也可直接：`pnpm release:tag 1.0.2`（改版本 → 同步 → 提交说明见脚本输出 → 打 tag）。

## 本地打包

签名私钥放在项目目录（已 gitignore，勿提交）：

`mouse_tool_updater_keys/mouse_tool.key`

密码默认：`mousetool`

```powershell
pnpm build:app
```

产物在 `src-tauri/target/release/bundle/msi/`（当前只打 MSI）。

## 发版（自动更新）

1. `pnpm version:sync` 前先改好 `package.json` 版本并提交，或用 release 脚本
2. 推送同名 tag，例如 `v1.0.2`
3. GitHub Actions `Release` 构建并上传 MSI、`latest.json`、`.sig`
4. Secrets：`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

更新清单：

`https://github.com/wjyugutou/mouse_tool/releases/latest/download/latest.json`

**Latest Release 必须带 `latest.json`**；空的 Latest 或长期 Draft 会导致应用内检查失败。

## 后端结构

- `src-tauri/src/battery.rs` — HID 读电量
- `src-tauri/src/tray.rs` — 托盘
- `src-tauri/src/app_log.rs` — 文件日志
- `src-tauri/src/lib.rs` — 启动与插件注册

前端设备扩展：`src/devices/`。
