---
name: develop
description: >-
  Use when changing mouse_tool code, adding a mouse/device, touching battery/tray/HID,
  or extending the device list. Enforces build-time device plugin conventions.
---

# 开发 mouse_tool

应用在 `nsh-app/`（Native Shell mixed 模式：Rust 原生模块 + TSX 界面）。改功能或加设备前先按下面的规则做。插件是**构建期的一只设备**（鼠标、键盘或耳机），不是运行时插件市场。给人看的步骤在 `docs/plugin-development.md`。

## 硬规则

1. **禁止运行时插件。** 不要 DLL 热加载，不要扫描用户目录发现插件。TSX 能调的接口只有 `nsh-app/native/src/lib.rs` 里 `#[native_module("yugutou/native")]` 的 `Mouse`。
2. **壳层不要插件化。** 窗口、设置、托盘、日志、开机自启留在壳层。只有「一只设备」才是设备插件。
3. **元数据只写一处。** `id` / `name` / `description` / `category` 只放在 `nsh-app/native/manifests/<id>.json`，Rust 用 `include_str!` 读。`category` 只能是 `mouse`、`keyboard`、`headset`（界面：鼠标 / 键盘 / 耳机），对应 Rust `DeviceCategory`。禁止第二份设备表：TSX 用 `Mouse.devices()`，不要在 TSX 或设置默认值里写死 id（默认设备取 `PLUGINS` 第一项）。
4. **注册只有一个列表。** `nsh-app/native/src/devices/mod.rs` 的 `PLUGINS`，外加该目录下的模块。托盘图标、悬停提示和首页都走 `PLUGINS`，不要另列设备。
5. **电量入口。** 读取只走 `hub`（`Mouse.read(deviceId, fresh)`），结果写进 hub 的快照并递增 `Mouse.version()`。TSX 不另开轮询、不缓存第二份真值。
6. **HID 按设备区分，不要一刀切。** 先看报告描述符，再选通道。
   - 默认，以及雷柏 VT9 AIR：只允许中断 `read_timeout`。禁止 `GetInputReport`、Feature report、控制传输（会卡死雷柏鼠标）。
   - 雷蛇，或模块顶部写明 opt-in Feature 的插件：可以用 hidapi 的 `send_feature_report` / `get_feature_report`。不要把这条放开到 VT9，也不要改用 `GetInputReport`。
   - 描述符没有 Feature（`B1`）项、官方驱动用 `sendReport` 的设备：模块顶部写明 opt-in 厂商报文，用 Output `write` 加中断 `read_timeout`。迈从 A5 与 VGN S99 是这种。没有 `B1` 却发 Feature，Windows 会返回 `0x1`。不要用 `get_input_report`。

## 加一只设备

1. 在 `nsh-app/native/manifests/` 加 `<id>.json`（`category` 填 `mouse` / `keyboard` / `headset`）。
2. 在 `nsh-app/native/src/devices/` 加模块，文件名用下划线（例如 `vgn_s99.rs`），`include_str!("../../manifests/<id>.json")`。被动中断读参考 `vt9_air.rs`；Feature 参考 `razer_viper_ultimate.rs`；Output 报文加 Input 读回参考 `mchose_a5_v3_ultra.rs` 或 `vgn_s99.rs`。Feature 与 Output 报文都要在模块顶部写明 opt-in。
3. 在 `devices/mod.rs` 声明 `mod` 并在 `PLUGINS` 加一行。注册表测试写死了顺序和分类，新增后要同步改。
4. 不要为了注册设备去改 TSX 页面。

## 做完再停

在 `nsh-app/` 下：

- 必跑：`nsh check`、`nsh test`
- 改了 Rust 再跑：`cargo test --manifest-path native/Cargo.toml`
