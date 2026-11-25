# NSH 版 vs Tauri 版功能对比

对照代码：Tauri 版 `src/` + `src-tauri/`（**已从本分支删除**，可从提交 `aa6f6d5` 找回）；NSH 版在仓库根目录（原 `nsh-app/`，已移到根目录）。2026-11-25 核对到 `dd10659`（master），最新 tag 是 `v4.3.0`（= `66b9551`）。

**内存（托盘待机约 30 秒，进程树私有工作集 PrivWS 合计）：NSH 版 18.1 MB（1 个进程）vs Tauri 版 192.8 MB（7 个进程，含 msedgewebview2）。**
测量：均为 release 构建；NSH 版为 `nsh package --target windows` 产物，Tauri 版为已安装的 `D:\YugutouTool`（PID 19412，只读测量）；PowerShell `Win32_Process` 按 ParentProcessId 递归取进程树，PrivWS 取自 `Win32_PerfFormattedData_PerfProc_Process.WorkingSetPrivate`。开窗时 NSH 18.2 MB，Tauri 179.2 MB（同时刻读数，Tauri 窗口状态未确认）。
⚠️ 这组数字是在 **MorphBot 合入之前**（`dd10659` 之前）测的。加入 MorphBot 后 bundle 从 55 KB 涨到 444 KB（其中几何数据 `original-data.ts` 占 256 KB），内存需要重测。

状态：✅ 已实现　⚠️ 部分或未验证　❌ 未实现

## 这次核对的增量（2026-11-25）

| 变更 | 代码 | 说明 |
| --- | --- | --- |
| 日志时间改本地时间 | `native/src/app_log.rs` | 写带数字偏移的本地时间（`2026-11-25 09:16:38.563+08:00`），不再标 `Z`；时区取 Windows `GetTimeZoneInformation`，日期纯 Rust 换算，4 条时区单测 + 1 条与系统时钟对照的测试 |
| 自启 Run 值自动修正 | `native/src/autostart.rs` | `refresh_if_target_missing`：登记的 exe 不在时改写成当前这份；指向的文件还在、或从 `target` / `.nsh` 启动时都不动用户的启动项 |
| 简体中文安装向导 | `scripts/installer-zh.mjs`、`scripts/inno/ChineseSimplified.isl`（`45c5d5f`） | 改引用仓库自带的 6.5+ 译文，不再依赖 `compiler:Languages\ChineseSimplified.isl`；`pnpm package` 自动串上，CI 加 `--require` |
| MorphBot 迁移完成并接回侧栏 | `dd10659`：`src/morph-bot/`（14 个文件）+ `Sidebar.tsx` / `Home.tsx` / `App.tsx` | 纯 TS 物理引擎 + `Canvas` 2D 渲染，替换原版 SVG/DOM 实现；侧栏品牌区恢复「外设电量」+ 52pt 机器人 |
| 版本 | `nsh.json` 4.3.0 / build 5 | v4.1.0、v4.2.0 Release 成功；v4.3.0 工作流失败，且修复提交在 tag 之后，没有重新发版 |

## 电量 / 设备插件

| 功能                                                          | Tauri 版                       | NSH 版                      | 状态  | 备注                |
| ----------------------------------------------------------- | ----------------------------- | -------------------------- | --- | ----------------- |
| 5 款设备插件（VT9 AIR、Viper Ultimate、A5 V3 Ultra+、S9 Pro、VGN S99） | `src-tauri/src/devices/`      | `native/src/devices/` 原样迁移 | ✅   | 去掉 Specta 属性，逻辑不变 |
| 只用 HID 中断读（不用 GetInputReport）                               | ✅                             | ✅                          | ✅   |                   |
| 单采样线程、并发读合并、设备世代、休眠保留上次电量                                   | `battery.rs` BatteryHub       | `hub.rs`                   | ✅   | 单测随迁              |
| 自动刷新间隔 / 暂停                                                 | ✅                             | ✅                          | ✅   |                   |
| 前端插件注册（manifest + registry）                                 | `src/plugins/`、`src/devices/` | 直接用 `Mouse.devices()`      | ✅   | TS 插件层不再需要        |
| 实机读出电量百分比                                                   | 正常                            | ✅                          | ✅   | 5 款已复验             |

## 首页 UI

| 功能                                                 | Tauri 版           | NSH 版                                                                      | 状态  | 备注                              |
| -------------------------------------------------- | ----------------- | -------------------------------------------------------------------------- | --- | ------------------------------- |
| 设备侧栏分类 Tabs（鼠标 / 键盘 / 耳机，带图标），只列该类设备，「设备 N」计数      | ✅                 | `src/Sidebar.tsx`                                                          | ✅   | 换设备时 Tab 跟着切；空分类显示「暂无耳机」        |
| 设备项样式：圆角图标块、选中蓝框 + 左侧蓝条 + 蓝勾、描述小字、悬停背景             | ✅                 | ✅                                                                          | ✅   | 不再在设备项右侧显示电量（对齐老版）              |
| 侧栏品牌区「外设电量」+ MorphBot                              | ✅                 | ✅ `Sidebar.tsx` 品牌区 + `src/morph-bot/MorphBot.tsx`                        | ⚠️  | 结构一致；副标题沿用老版的 `yugutou_tool` 还是现在的 `YugutouTool` 待定；未实机目视 |
| 侧栏底部「自动刷新 ● 300s」、「本地 HID 读取 · 不上传」                | ✅                 | ✅                                                                          | ✅   | 暂停时显示「已暂停」                      |
| 卡片水平垂直居中、最大宽度 860                                  | ✅                 | `Scroll contentClass="grow items-center justify-center"` + `max-w-[860px]` | ✅   |                                 |
| 「当前设备」小字、设备名、连接 / 充电 / 型号不确定徽标                     | ✅                 | ✅                                                                          | ✅   |                                 |
| 右上「● 自动刷新 300s」徽标                                  | ✅                 | ✅                                                                          | ✅   | 跟随间隔；暂停时「自动刷新已暂停」               |
| 电量圆环 BatteryGauge（底轨完整一圈、按百分比填充、中间百分比 + 档位文案、充电闪电） | SVG               | `src/BatteryGauge.tsx`，NSH `Canvas` 画弧                                     | ✅   | 等待数据为虚线环；光晕用径向渐变代替 blur；填充无过渡动画 |
| 状态 / 提示文案、电量档位                                     | `BatteryCard.tsx` | `src/status.ts` 同规则                                                        | ✅   |                                 |
| 立即刷新（实心蓝）/ 暂停·开始自动刷新（描边），带图标                       | ✅                 | ✅                                                                          | ✅   | 刷新图标无旋转动画                       |
| 读取失败红色错误条                                          | ✅                 | ✅                                                                          | ✅   |                                 |
| 统计三格：连接 / 充电 / 最后刷新                                | ✅                 | ✅                                                                          | ✅   |                                 |
| 可折叠「诊断详情」（设备描述、协议信息）                               | ✅                 | ✅                                                                          | ✅   | 箭头旋转是瞬时切换，无过渡                   |
| 可点元素悬停指针与悬停背景                                      | ✅                 | `cursor-pointer` + `hover:`                                                | ✅   | 已实测指针变手形                        |
| 进页面拉一次快照（有缓存不读 HID）                                | ✅                 | ✅                                                                          | ✅   |                                 |
| 换设备不显示上一只的电量                                       | ✅                 | 按 deviceId 取样本                                                             | ✅   |                                 |

## 设置页

| 功能 | Tauri 版 | NSH 版 | 状态 | 备注 |
|---|---|---|---|---|
| 分区（外观 / 关于）+ 搜索设置 | ✅ | 单页平铺，无搜索 | ❌ | |
| 主题：浅色 / 深色 / 跟随系统 | ✅ | ✅ `themeMode` + `setColorScheme` | ✅ | 已实测 |
| 自动刷新间隔 | 数字输入 3–6000 秒 | 固定档 3/5/10/30/60/120/300 秒 | ⚠️ | 无自定义值；Rust 侧归一 clamp 3–300，上限比老版低 |
| 自动刷新开关 | 仅首页 | 首页 + 设置页 | ✅ | |
| 托盘显示分类多选（至少一项） | ✅ | ✅ | ✅ | TSX 与 Rust 两侧都保证至少一项 |
| 关闭窗口时：进托盘 / 退出 | 复选框 | 两个选项 | ✅ | |
| 开机自启开关 | ✅（开发版隐藏） | ✅ | ✅ | 已实测写注册表 |
| 开机自启路径诊断面板 | ✅ | Rust 有 `Mouse.autostartCommand()`，UI 未接 | ❌ | |
| 恢复默认（含关闭自启、重置托盘设备） | ✅ | 无 | ❌ | |
| 关闭设置回首页 | 底部「关闭」按钮 | 标题栏「首页」 | ✅ | |
| 版本号、GitHub 链接 | ✅ | 版本在设置页，GitHub 在标题栏 | ✅ | |
| 日志路径、打开日志目录 | ✅ | ✅ | ✅ | |
| 设置文件路径 | 无 | ✅ | ✅ | NSH 新增 |
| 检查更新 | ✅ | 设置页「应用更新」：检查、下载并安装、进度与说明 | ⚠️ | 代码与 UI 齐；线上 `latest.json` 仍是 4.2.0，应用内更新未端到端实测 |

## 托盘

| 功能                      | Tauri 版                  | NSH 版                                     | 状态  | 备注                            |
| ----------------------- | ------------------------ | ----------------------------------------- | --- | ----------------------------- |
| 动态电池图标 32×32，按分类 1–3 格  | `tray.rs`                | `tray_icon.rs`，PNG data URI 交给 `Tray.set` | ⚠️  | 单测通过；单电池已目视确认，2/3 格未确认 |
| 颜色阈值、充电 / 不支持 / 读取失败区分  | ✅                        | ✅                                         | ✅   | 单测                            |
| tooltip：每个勾选分类一行，标出图标设备 | ✅                        | ✅                                         | ✅   | 单测                            |
| 菜单：打开主界面 / 设置 / 退出（有新版本时多「安装更新」） | ✅                        | ✅                                         | ✅   |                               |
| 鼠标交互                    | 左键单击弹菜单，左键双击开窗           | 左键单击开窗，右键菜单                               | ✅   | 已定：保留 NSH 现状                   |
| 电量 / 设置变化后重绘            | settings watch + publish | TSX 每秒比对 Rust 版本号                         | ✅   |                               |

## 窗口与标题栏

| 功能 | Tauri 版 | NSH 版 | 状态 | 备注 |
|---|---|---|---|---|
| 无边框标题栏，可拖拽 | `decorations: false` + TitleBar | `titleBar.style: hidden` + `windowDrag` | ✅ | |
| 最小化 / 最大化 / 关闭按钮 | 自绘 | NSH 原生绘制 | ✅ | |
| 标题栏 GitHub、设置入口（图标按钮，当前页高亮，悬停背景） | ✅ | ✅，多「首页」 | ✅ | 去掉了 yugutou_tool 标题 |
| 图标（Iconify mdi） | @iconify/react | supernsh-icons：CLI 从 @iconify/json 生成 `src/icons.ts`，运行时摘录在 `src/vendor/supernsh-icons/`，以 NSH `Image` + SVG data URI 着色绘制 | ✅ | 第三方社区库，未发布到 npm；加图标需在 Node 24 下跑它的 CLI |
| 关窗进托盘 / 直接退出 | CloseRequested | `closePress` → hide / quit | ✅ | 已实测进托盘 |
| 单实例 | 未启用 | `singleInstance`，二次启动唤起原窗口 | ✅ | 已实测 |
| 默认 1200×850 | ✅ | ✅，最小 760×560 | ✅ | |
| `--autostart` 启动只进托盘 | ✅ | ✅ | ✅ | 已实测 |

## 开机自启

| 功能 | Tauri 版 | NSH 版 | 状态 | 备注 |
|---|---|---|---|---|
| HKCU Run `yugutou_tool` = `"<exe>" --autostart` | tauri-plugin-autostart | `autostart.rs` 直接写注册表 | ✅ | 同一个值，老用户升级后不失效 |
| 启动时修正 Run 里的 exe 路径 | `refresh_autostart_exe_path` | `refresh_if_target_missing`：登记的 exe 不在时改写成当前这份；从 `target` / `.nsh` 启动不改 | ✅ | 已实测，5 条单测。构建目录里的进程不改用户的启动项 |
| 启动诊断日志（`autostart_diag::log_startup`） | ✅ | 启动行写 `autostart=`，路径被改写时另写一条 | ⚠️ | 没有设置页诊断面板 |

## 设置持久化

| 功能 | Tauri 版 | NSH 版 | 状态 | 备注 |
|---|---|---|---|---|
| 设置落盘 | tauri-plugin-zustand `settings.json` | `%APPDATA%\com.wwwj.mousetool\nsh\settings.json`，Rust 唯一所有者 | ✅ | 字段同名；先写 `.tmp` 再改名 |
| 首次启动导入 Tauri 版设置 | — | 只读导入 | ✅ | 已实测 |
| 非法值归一（间隔、分类、设备 id） | ✅ | ✅ | ✅ | 单测 |

## 日志

| 功能 | Tauri 版 | NSH 版 | 状态 | 备注 |
|---|---|---|---|---|
| 启动期文件日志、panic 记录 | `mouse_tool.log` | `mouse_tool_nsh.log` | ✅ | |
| 位置：exe 目录 `logs`，无权限回退 `%LOCALAPPDATA%` | ✅ | ✅ | ✅ | 已实测 |
| 时间戳 | 本地时间 | 本地时间 + 数字偏移（`+08:00`） | ✅ | 原先写 UTC 却按本地时间读，v4.3.0 修好；时区换算有单测 |

## 自动更新

| 功能 | Tauri 版 | NSH 版 | 状态 | 备注 |
|---|---|---|---|---|
| 检查、下载、安装、重启 | tauri-plugin-updater + GitHub latest.json（minisign） | `nsh/updater`（`src/updater.ts`）：启动 15 秒后 + 每 6 小时自动检查，设置页手动检查，托盘「安装更新」；`nsh.json` `updater.github` + `publicKey`（Ed25519） | ⚠️ | 代码与测试已过，端到端未实测 |
| 老 Tauri 用户升级到 NSH 版 | — | 不支持应用内升级 | ✅ | 两边都读 `releases/latest/download/latest.json`，但格式和签名（minisign vs Ed25519）不同：老版检查会报错，只能手动装 NSH 安装包并卸载旧 MSI。README 与 v4.1.0 发版说明已写明 |

## 打包发版

| 功能 | Tauri 版 | NSH 版 | 状态 | 备注 |
|---|---|---|---|---|
| 安装包 | MSI（WiX zh-CN，passive） | `nsh package` 出目录 + zip + `.iss`；`scripts/installer-zh.mjs` 插 `[Languages]` 并引用 `scripts/inno/ChineseSimplified.isl`，有 ISCC 时覆盖重编 | ⚠️ | 本机没装 Inno Setup，本地只出 `.iss`；v4.1 / v4.2 出包时还没有这一步，安装向导是英文 |
| release.yml：tag → 构建 → Release → latest.json | tauri-action | `.github/workflows/release.yml`：装 nsh → check/test/build → package → 简体中文安装包 → `nsh update-manifest` 签名 → `gh release create` | ⚠️ | v4.1.0、v4.2.0 跑通，四个资产齐全；**v4.3.0 失败在「Build installer (Inno Setup, 简体中文)」**，线上 `latest.json` 仍指 4.2.0 |
| 版本号随 tag 同步 | package.json / tauri.conf（`scripts/sync-version.mjs`、`bump-version.mjs`） | `pnpm release:bump <版本>`：`bump-version.mjs` + `sync-version.mjs` 改 nsh.json（build + 1）/ Cargo.toml / Cargo.lock，生成 `docs/releases/v<版本>.md`，提交、打 tag、推送；CI 校验版本与 tag 一致 | ✅ | `--dry-run` 已验证 |
| 发版说明内容 | 手写 | `docs/release-notes.override.md` 优先于自动生成 | ❌ | override 还是 v4.1.0 的稿子，v4.1 / v4.2 / v4.3 三份说明除末尾换行外完全相同，都没写自启修正、日志时间、简体中文安装包、MorphBot |
| 应用图标 | ✅ | `--icon assets/icon.png`（从 `src-tauri/icons/icon.png` 搬到 `assets/`） | ✅ | |

## MorphBot

| 功能 | Tauri 版 | NSH 版 | 状态 | 备注 |
|---|---|---|---|---|
| 侧栏动画角色 | `src/vendor/morph-bot`（56 个文件，SVG + open shadow DOM，`aa6f6d5`） | `src/morph-bot/`（14 个文件）：`original-data`（几何数据，从原版 `original-data.js` 生成）、`catalog`（39 状态 / 18 形态 / 14 变形特效）、`geometry`、`math`、`physics-system`、`morph-system`、`state-behavior-system`、`particle-system`、`canvas-renderer`、`engine`、`pointer`、`device-behavior`、`types`、`MorphBot.tsx` | ⚠️  | 全部改写成纯 TS + NSH `Canvas` 2D，无 DOM / shadow / SVG；未实机目视 |
| 形态 / 表情随机轮播 | `playSequence` + `pickOther` | `runSequenceLoop` + `pickStateForMood`，停顿 1.5–4 秒，一半概率同时换形态与配色 | ✅ | 与老版节奏一致（`HOLD_MIN_MS` / `HOLD_MAX_MS` 相同） |
| 跟手视线 | `follow-pointer` + 全局 `pointermove` | `App.tsx` 全局 `onMouseMove` → `pointer.ts` → 引擎按宿主包围盒算 `pointer.targetX/Y`，与老版同一路径 | ✅ | `gazeScale` 默认 2.25，与老版 `GAZE_SCALE` 相同 |
| 悬停暂停 | 全窗口 `pointermove` + 包围盒判定 | 同上（`syncHoverState` + `isInBounds`），另加宿主自身 `onMouseEnter/Leave` | ✅ | 老版踩过 WebView 里 host enter/leave 不可靠的坑，这里两条路都留了 |
| 进托盘 / 失焦时停帧 | 无（依赖 DOM 不可见） | `lifecycle()` / `window.state().visible` 判活，不可见时 `cancelAnimationFrame` | ✅ | 比老版省 CPU |
| 原版材质预设（solid / gradient / rainbow-glass） | 库里有，组件只用 `solid` | 只保留纯色 | ✅ | 与老版实际用法一致，未损失可见效果 |
| 对话 / 音频（animalese TTS、拼音、`performDialogue`） | 库里有，组件设了 `decorative` 不用 | 未迁 | ✅ | 老版也是装饰态，等于裁掉未使用能力 |
| 联动设备状态（读取中 / 充电 / 低电量 / 报错） | 无 | `device-behavior.ts`：11 种 mood 各配状态池，切换时给一次语义化反应（报错 alerting、开始充电 excited、低电量 notifying…），可点击触发切换 | ✅ | NSH 版新增，不是老版行为 |

## 主题

| 功能 | Tauri 版 | NSH 版 | 状态 | 备注 |
|---|---|---|---|---|
| 浅 / 深 / 跟随系统 | CSS `dark` class + matchMedia | `setColorScheme` | ✅ | 已实测 |
| 配色：老版 shadcn 变量（深蓝黑底 oklch(0.145 0.015 255) 等）、右上蓝色光晕、卡片阴影 | ✅ | `theme.json` 原样搬老版 CSS 变量；光晕用 `backgroundImage` 径向渐变 | ✅ | 无 blur 模糊，观感接近 |

## 其它

| 功能 | Tauri 版 | NSH 版 | 状态 | 备注 |
|---|---|---|---|---|
| 测试 | cargo test | `cargo test` 73 项（72 通过 + 1 条需实机的 `#[ignore]`）；`nsh test` 77 项：76 通过 / 1 跳过（4 个 UI 测试） | ✅ | MorphBot 无专门单测，靠 UI 测试与 `nsh check` 兜底 |
| 进程结构 | 主进程 + 6 个 WebView2 子进程 | 单进程，Win32 + Direct2D | ✅ | |
| 前端 bundle | 未记 | MorphBot 前 55 KB，加入后 444 KB（`original-data.ts` 占 256 KB） | ⚠️ | 需重测托盘待机内存是否仍 ~18 MB |

## 待办

- [ ] P0 重新发一版把 v4.3.0 的失败绕过去：修复已提交（`45c5d5f`），但**重跑那次 run 没用**——`actions/checkout` 按 tag 取 `v4.3.0`（= `66b9551`），里面还是旧的 `installer-zh.mjs`。要么 `pnpm release:bump 4.3.1` 重发（顺带把 MorphBot 发出去），要么删 tag 重打
- [ ] P0 发版后实测应用内更新：用 v4.2.0 装一次，确认能检查到 4.3.x 并下载安装
- [ ] P0 实机目视 MorphBot：绘制效果、形态/配色轮播、全窗口跟手、悬停暂停、点一下的反应、设备状态联动（拔插接收器看 error / unknown / 充电）
- [ ] P0 目视确认托盘图标（颜色、1–3 格）和 tooltip
- [ ] P1 重测托盘待机内存并更新本文顶部与 README 的「约 18 MB」——那组数字早于 MorphBot
- [ ] P1 给 MorphBot 补几条不依赖屏幕的测试（`deriveDeviceMood`、`pickNextColor`、`reactionForMoodChange` 这类纯函数好测）
- [ ] P1 清掉或补写 `docs/release-notes.override.md`：现在它让 4.1 / 4.2 / 4.3 三份说明完全相同，也没提自启修正、日志时间、简体中文安装包、MorphBot
- [ ] P1 自启诊断面板（Rust 有 `autostartCommand()`，设置页未接）
- [ ] P1 设置页「恢复默认」
- [ ] P1 本机装 Inno Setup 以便本地出安装包：`scoop` main 里没有，只在 `nonportable` bucket 有 `innosetup-np`；要不要加这个 bucket 装，等你定
- [ ] P2 品牌副标题统一：侧栏现在是 `YugutouTool`，老版是 `yugutou_tool`
- [ ] P2 `docs/ui_home_final.png` 是 2026-10-19 的 Tauri 版截图，README 仍引用它，需要换成带 MorphBot 的 NSH 版截图
- [ ] P2 自动刷新间隔支持自定义数值（并把 300 秒上限放宽回老版的 6000）
- [ ] P2 设置页分区与搜索
- [ ] P3 圆环填充 / 刷新图标 / 诊断箭头的过渡动画：`src/` 内搜不到 `Animated` 或 transition，目前都是瞬间切换
- [x] P0 退出 Tauri 版后复验实机电量读取（Viper 等 5 款）
- [x] P0 定托盘鼠标交互：保留 NSH 现状（单击开窗、右键菜单）
- [x] P0 实测开机自启开关、`--autostart` 只进托盘（2026-11-25）
- [x] P0 实测主题切换
- [x] P1 接入 `nsh/updater`（2026-11-24）：公钥写进 `nsh.json`，私钥在仓库外；设置页「应用更新」+ 自动检查
- [x] P1 新建 `.github/workflows/release.yml`（2026-11-24）
- [x] P1 老 Tauri 用户没法应用内升级到 NSH 版：发版说明 / README 写明手动下载安装包并卸载旧 MSI
- [x] P1 首次真实发版（2026-11-25）：v4.1.0、v4.2.0 Release 四个资产齐全
- [x] P1 签名私钥离线备份：`D:\DEV\keys\yugutou\yugutou-update.secret`（仓库外）
- [x] P1 启动时修正 Run 路径（2026-11-25）：`refresh_if_target_missing`
- [x] P1 日志时间改本地时间（2026-11-25）：带 `+08:00` 这类数字偏移，时区换算有单测
- [x] P1 简体中文安装包（2026-11-25，`45c5d5f`）：译文入库，CI 不再依赖 Inno 自带语言文件
- [x] P2 MorphBot 迁移（2026-11-25，`dd10659`）：14 个文件，纯 TS + Canvas 2D，已接回侧栏品牌区
- [x] 已删除 Tauri 旧代码（2026-11-24）：`src-tauri/`、`src/`（含 `vendor/morph-bot`、`bindings.ts`）、`index.html`、`vite.config.ts`、`tsconfig*.json`、`eslint.config.mjs`、`components.json`、`package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml`、`node_modules/`、`dist/`、`.tanstack/`、`scripts/{sync-version,bump-version}.mjs`、`scripts/tauri-build.ps1`、`.github/workflows/release.yml`、`.cursor/rules/react-compiler.mdc`。设备 manifest 搬到 `native/manifests/`，应用图标搬到 `assets/icon.png`。全部可从提交 `aa6f6d5` 找回
- [x] `nsh-app/` 的内容移到仓库根目录（2026-11-24）
- [x] P2 NSH 版的版本 bump 脚本（2026-11-24）：`pnpm release:bump <版本> [--dry-run]`
- [x] 清理临时目录（2026-11-24）：nsh CLI 装到 `D:\DEV\tools\nsh`（v0.6.1），签名密钥搬到 `D:\DEV\keys\yugutou\`
- [x] 仓库内定位 nsh（2026-11-24）：`scripts/nsh.mjs` 按 `package.json` 的 `nshVersion` 装到 `.tools/nsh`，pnpm 脚本和 CI 都走它
