# 设备插件开发

给要加一只鼠标的人看。代理用的短清单在 `.cursor/skills/develop/SKILL.md`，规则以那边和本文一致为准。

## 插件是什么

这里的插件是**构建期的一只鼠标**，不是可以下载安装的插件市场。

一只鼠标 = 一份前端适配器 + 一份 Rust HID 读取。两者在编译时写进程序。没有 DLL 热加载，也不扫描用户目录。

窗口、设置、托盘壳、日志、更新留在壳层，不要做成插件。托盘只负责图标和菜单，设备名单从插件表来。菜单按鼠标、键盘、耳机分组，列出该分类里的每一只；该分类没有设备时显示「未选择」。悬停提示同样列出每一只。图标数字仍跟着当前选中的那一只。

## 目录

| 作用 | 路径 |
| --- | --- |
| 元数据（唯一来源） | `src/plugins/<id>/manifest.json` |
| 前端适配器 | `src/plugins/<id>/index.ts` |
| 前端注册表 | `src/plugins/index.ts` 的 `deviceRegistry` |
| 前端类型与 `createDeviceAdapter` | `src/plugin-sdk/` |
| 页面用的再导出 | `src/devices/`（首页继续从这里取列表） |
| Rust HID 实现 | `src-tauri/src/devices/<name>.rs`（文件名用下划线） |
| Rust 契约 | `src-tauri/src/plugin_sdk.rs` |
| Rust 注册表 | `src-tauri/src/devices/mod.rs` 的 `PLUGINS` |

`manifest.json` 有四个字段：`id`、`name`、`description`、`category`。`category` 取 `mouse`、`keyboard`、`headset`，对应首页一级分类「鼠标 / 键盘 / 耳机」。前端 `import` 这个文件，Rust 用 `include_str!` 读同一个文件。不要在托盘、设置默认值或别的表里再写一份 id / 名称。不要恢复 `TRAY_DEVICES`，也不要在设置里写死 `vt9-air`。默认托盘设备是两张注册表的第一项，所以两张表的顺序要一致。

电量只有一条壳层命令：`get_battery(device_id)`。前端是 `invoke('get_battery', { deviceId })`，`createDeviceAdapter` 已经这么调。不要再加无参、隐含只支持 VT9 的 `get_battery`。`list_devices` 返回 Rust 侧已注册的设备，用来对照 id。

现有三只：

- `vt9-air`：中断读，模板是 `src/plugins/vt9-air/` 与 `src-tauri/src/devices/vt9_air.rs`
- `razer-viper-ultimate`：Feature 报告，模板是 `src/plugins/razer-viper-ultimate/` 与 `src-tauri/src/devices/razer_viper_ultimate.rs`
- `mchose-a5-v3-ultra-plus`：迈从接收器 `3837:1018` 的 `0x4D` 输出/输入报文邮箱，模板是 `src/plugins/mchose-a5-v3-ultra-plus/` 与 `src-tauri/src/devices/mchose_a5_v3_ultra.rs`

## 加一只鼠标

1. 复制一份前端目录。普通鼠标复制 `src/plugins/vt9-air/`。已经确认必须用 Feature 报告、并且会在 Rust 文件顶部写明 opt-in 的，复制 `src/plugins/razer-viper-ultimate/`。
2. 只改新目录里的 `manifest.json`（`id` 用稳定的短横线，例如 `razer-viper-ultimate`）。`index.ts` 保持 `createDeviceAdapter(manifest)`，把注释里的 Rust 路径改成新文件。
3. 在 `src/plugins/index.ts` 的 `deviceRegistry` 加一行 import。不要为了注册去改 `HomePage`。
4. 在 `src-tauri/src/devices/` 加模块，文件名用下划线。`manifest_json` 用 `include_str!` 指向第 2 步那个 `manifest.json`。
5. 在 `src-tauri/src/devices/mod.rs` 声明 `mod`，并在 `PLUGINS` 加一行。顺序与 `deviceRegistry` 相同。
6. 命令不用新注册。`get_battery` 已经在 `generate_handler!` 里，按 `device_id` 分发。

## HID 怎么读

默认只做中断 `read_timeout`，设备自己推报告时再解析。雷柏 VT9 AIR 必须停在这一档：官方软件挂起中断读后，设备大约每 3 秒推一次 Report `0xBB`，电量在第 7 字节。对它使用 `GetInputReport`、Feature report 或控制传输会把鼠标卡死。VT9 的实现里不要出现 `send_feature_report`、`get_feature_report` 或 `get_input_report`。

雷蛇毒蝰终极版没有这种被动推送。OpenRazer 的电量查询是 Feature `SET_REPORT` 再 `GET_REPORT`：90 字节报告，Report ID `0x00`，transaction `0xFF`，class `0x07`，电量命令 `0x80`，原始值在 `arguments[1]`（0–255，再换成百分比）。充电状态是同族命令 `0x84`。本仓库用 hidapi 的 `send_feature_report` / `get_feature_report` 做这件事，对应有线 `1532:007A` 和接收器 `1532:007B`。这只允许写在模块顶部已经声明 opt-in Feature 的插件里。`GetInputReport`（`get_input_report`）对谁都不许用，包括雷蛇。

新鼠标如果文档只有 Feature / 控制传输，而你还不能证明它对这只设备安全，就不要照搬雷蛇的发送代码。先把设备和「为什么不能读」写清楚，确认协议后再 opt-in。

迈从 A5 V3 Ultra+(3955) 是第三种情况：它的 `0xFF01` 集合上 `get_feature_report(0x11)` 在 Windows 恒失败（`0x1F`），但 `0x4D` 的 64 字节输出报文有回包。M HUB 对 3955 平台用的是 `[0x4D, 0x01, flags, len, cmd_lo, cmd_hi, biz, seq, data..., checksum]` 邮箱，`0x0900` 返回设备信息，电量在 data[12]、充电在 data[11]。首包可能是 `FF` 占位，要重发。模块顶部已写明这是 opt-in 的厂商报文；旧固件的 `0x11/0x06` Feature 只作为回退，不要把它当成 3955 的主通道，也不要用 `get_input_report`。

## 怎么验证

改完先在仓库根目录跑：

```powershell
pnpm exec tsc --noEmit
pnpm exec eslint src
```

动了 Rust 再跑：

```powershell
cargo test --lib
```

在 `src-tauri` 目录执行。解析器要有单元测试，不要只靠插上鼠标才知道包格式对不对。

实机在 Windows 上确认：

- VT9 AIR：插上雷柏接收器，选中后应出现百分比。读的过程里不要改用 Feature。
- 毒蝰终极版：先关掉 Razer Synapse（它可能独占 HID），插上接收器或用线连接，选「毒蝰终极版 Viper Ultimate」。应出现百分比；说明里会有 `raw n/255`。拔掉后再刷新，应提示未找到设备。
- 迈从 A5 V3 Ultra+：接收器 `3837:1018` 插在 MagDock 上也可以；选中后应出现百分比，说明里会写 `接收器邮箱 0x4D/0x0900`。M HUB 开着时如果读不到，先关掉再试。
- 两只都接上时，来回切换，确认 VT9 仍是中断读、毒蝰仍是 Feature 读。
