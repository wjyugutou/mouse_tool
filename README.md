# 鼠标工具（mouse_tool）

用 Tauri + React 做的 Windows 桌面小工具：读取雷柏 **VT9 AIR** 电量，不依赖雷柏 GameDev 常驻运行。设备列表里还有雷蛇 **毒蝰终极版（Viper Ultimate）**，但这只鼠标的已知电量协议要走 Feature 报告，当前不会读取。

仓库：https://github.com/wjyugutou/mouse_tool

## 功能

- 被动读取 VT9 AIR 的 HID 电量（Report `0xBB`，勿用 GetInputReport，会卡鼠标）
- 毒蝰终极版：只识别有线 `1532:007A` / 接收器 `1532:007B`，不读电量（见下方设备插件）
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

## 设备插件

一只鼠标是一个**构建期**设备包，不是运行时下载的插件：

- 前端 `DeviceAdapter`（`src/plugins/<id>/`）
- 对应的 Rust HID 读取（`src-tauri/src/devices/<id>.rs`）

窗口、设置、托盘壳、日志、更新留在壳层。命令在 `generate_handler!` 里静态注册，不加载 DLL。

电量只有一条壳层命令：`get_battery(device_id)`。`device_id` 与前端适配器的 `id` 来自同一份 `manifest.json`。托盘菜单也读 Rust 的 `PLUGINS`，不再单独维护设备表。

### 再加一只鼠标

1. 复制 `src/plugins/vt9-air/`，改 `manifest.json`（`id` / `name` / `description` 只写在这里）。
2. 在 `src/plugins/index.ts` 的 `deviceRegistry` 追加一行。首页不用改。
3. 在 `src-tauri/src/devices/` 增加模块（文件名用下划线，例如 `vt9_air.rs`）。只做中断 `read_timeout`，不要用 GetInputReport / Feature（会卡死鼠标）。`manifest_json` 用 `include_str!` 指向上面同一个 `manifest.json`。
4. 在 `src-tauri/src/devices/mod.rs` 的 `PLUGINS` 追加一行。

`list_devices` 返回这份 Rust 插件表，便于对照前端注册的 id。

已注册：`vt9-air`（会读电量）、`razer-viper-ultimate`（只识别设备）。毒蝰终极版的 OpenRazer 路径是 Feature `SET_REPORT` 再 `GET_REPORT`（class `0x07` / cmd `0x80`，transaction `0xFF`），本工具不发送这类传输。

## 后端结构

- `src-tauri/src/plugin_sdk.rs` — 插件契约（`DevicePlugin` / `BatteryInfo`）
- `src-tauri/src/devices/` — 插件注册表与各鼠标的 HID 实现
- `src-tauri/src/tray.rs` — 托盘壳（设备列表来自插件表）
- `src-tauri/src/app_log.rs` — 文件日志
- `src-tauri/src/lib.rs` — 启动与命令注册
- `src/plugin-sdk/` — 前端契约与 `createDeviceAdapter`
- `src/plugins/` — 已安装的设备插件
- `src/devices/` — 壳层重新导出，页面继续从这里取注册表
