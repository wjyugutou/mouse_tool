---
name: develop
description: >-
  Use when changing mouse_tool code, adding a mouse/device, touching battery/tray/HID,
  or extending the frontend device list. Enforces build-time device plugin conventions.
---

# 开发 mouse_tool

改功能或加设备前先按下面的规则做。插件是**构建期的一只鼠标**，不是运行时插件市场。

## 硬规则

1. **禁止运行时插件。** 不要 DLL 热加载，不要扫描用户目录发现插件。命令只在 Tauri `generate_handler!` 里静态注册。
2. **壳层不要插件化。** 窗口、设置、托盘壳、日志、更新留在 app shell。只有「一只鼠标」才是设备插件。
3. **元数据只写一处。** `id` / `name` / `description` 只放在 `src/plugins/<device>/manifest.json`。前端直接 import 该文件；Rust 用 `include_str!` 读同一文件。禁止第二份设备表：不要恢复 `TRAY_DEVICES`，不要在设置默认值里再写死 `vt9-air`（默认设备从 `deviceRegistry` / `PLUGINS` 取第一项）。
4. **注册只有这两个列表。**
   - 前端：`src/plugins/index.ts` 的 `deviceRegistry`，一只设备一行 import。
   - Rust：`src-tauri/src/devices/mod.rs` 的 `PLUGINS`，外加 `src-tauri/src/devices/` 下的模块。
   - 托盘菜单和电量都走 `PLUGINS`，不要在 `tray.rs` 再列设备。
5. **电量命令。** 只用 `get_battery(device_id)`。前端是 `invoke('get_battery', { deviceId })`。禁止再加无参、隐含只支持 VT9 的 `get_battery`。
6. **HID 安全。** 设备插件只暴露该设备所需的最小读取。只允许中断 `read_timeout`。禁止 `GetInputReport`、Feature report、控制传输（会卡死鼠标）。壳层 capability 留在壳层，不要为了设备去放宽权限。

## 加一只鼠标

1. 复制 `src/plugins/vt9-air/`，只改 `manifest.json`。
2. 在 `src/plugins/index.ts` 的 `deviceRegistry` 加一行。
3. 新增 Rust 模块，文件名用下划线（例如 `vt9_air.rs`），`manifest_json` 用 `include_str!` 指向上面的 `manifest.json`。只做中断 `read_timeout`。
4. 在 `PLUGINS` 加一行。顺序与 `deviceRegistry` 保持一致。
5. 不要为了注册设备去改 `HomePage`。页面继续用 `src/devices` 导出的 `deviceRegistry`。

## 做完再停

- 必跑：`pnpm exec tsc --noEmit`、`pnpm exec eslint src`
- 改了 Rust 再跑：`cargo test --lib`
