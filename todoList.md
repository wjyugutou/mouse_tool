# NSH 版 vs Tauri 版功能对比

对照代码：Tauri 版 `src/` + `src-tauri/`（**已从本分支删除**，可从提交 `aa6f6d5` 找回）；NSH 版在仓库根目录（原 `nsh-app/`，已移到根目录；分支 feature/refactor-NSH，2026-11-24 核对）。

**内存（托盘待机约 30 秒，进程树私有工作集 PrivWS 合计）：NSH 版 18.1 MB（1 个进程）vs Tauri 版 192.8 MB（7 个进程，含 msedgewebview2）。**
测量：均为 release 构建；NSH 版为 `nsh package --target windows` 产物，Tauri 版为已安装的 `D:\YugutouTool`（PID 19412，只读测量）；PowerShell `Win32_Process` 按 ParentProcessId 递归取进程树，PrivWS 取自 `Win32_PerfFormattedData_PerfProc_Process.WorkingSetPrivate`。开窗时 NSH 18.2 MB，Tauri 179.2 MB（同时刻读数，Tauri 窗口状态未确认）。

状态：✅ 已实现　⚠️ 部分或未验证　❌ 未实现

## 电量 / 设备插件

| 功能                                                          | Tauri 版                       | NSH 版                      | 状态  | 备注                |
| ----------------------------------------------------------- | ----------------------------- | -------------------------- | --- | ----------------- |
| 5 款设备插件（VT9 AIR、Viper Ultimate、A5 V3 Ultra+、S9 Pro、VGN S99） | `src-tauri/src/devices/`      | `native/src/devices/` 原样迁移 | ✅   | 去掉 Specta 属性，逻辑不变 |
| 只用 HID 中断读（不用 GetInputReport）                               | ✅                             | ✅                          | ✅   |                   |
| 单采样线程、并发读合并、设备世代、休眠保留上次电量                                   | `battery.rs` BatteryHub       | `hub.rs`                   | ✅   | 单测随迁              |
| 自动刷新间隔 / 暂停                                                 | ✅                             | ✅                          | ✅   |                   |
| 前端插件注册（manifest + registry）                                 | `src/plugins/`、`src/devices/` | 直接用 `Mouse.devices()`      | ✅   | TS 插件层不再需要        |
| 实机读出电量百分比                                                   | 正常                            | ✅                          | ✅   |                   |

## 首页 UI

| 功能 | Tauri 版 | NSH 版 | 状态 | 备注 |
|---|---|---|---|---|
| 设备侧栏分类 Tabs（鼠标 / 键盘 / 耳机，带图标），只列该类设备，「设备 N」计数 | ✅ | `src/Sidebar.tsx` | ✅ | 换设备时 Tab 跟着切；空分类显示「暂无耳机」 |
| 设备项样式：圆角图标块、选中蓝框 + 左侧蓝条 + 蓝勾、描述小字、悬停背景 | ✅ | ✅ | ✅ | 不再在设备项右侧显示电量（对齐老版） |
| 侧栏品牌区「外设电量」+ MorphBot | ✅ | 无 | ❌ | MorphBot 见下 |
| 侧栏底部「自动刷新 ● 300s」、「本地 HID 读取 · 不上传」 | ✅ | ✅ | ✅ | 暂停时显示「已暂停」 |
| 卡片水平垂直居中、最大宽度 860 | ✅ | `Scroll contentClass="grow items-center justify-center"` + `max-w-[860px]` | ✅ | |
| 「当前设备」小字、设备名、连接 / 充电 / 型号不确定徽标 | ✅ | ✅ | ✅ | |
| 右上「● 自动刷新 300s」徽标 | ✅ | ✅ | ✅ | 跟随间隔；暂停时「自动刷新已暂停」 |
| 电量圆环 BatteryGauge（底轨完整一圈、按百分比填充、中间百分比 + 档位文案、充电闪电） | SVG | `src/BatteryGauge.tsx`，NSH `Canvas` 画弧 | ✅ | 等待数据为虚线环；光晕用径向渐变代替 blur；无填充过渡动画 |
| 状态 / 提示文案、电量档位 | `BatteryCard.tsx` | `src/status.ts` 同规则 | ✅ | |
| 立即刷新（实心蓝）/ 暂停·开始自动刷新（描边），带图标 | ✅ | ✅ | ✅ | 刷新图标无旋转动画 |
| 读取失败红色错误条 | ✅ | ✅ | ✅ | |
| 统计三格：连接 / 充电 / 最后刷新 | ✅ | ✅ | ✅ | |
| 可折叠「诊断详情」（设备描述、协议信息） | ✅ | ✅ | ✅ | |
| 可点元素悬停指针与悬停背景 | ✅ | `cursor-pointer` + `hover:` | ✅ | 已实测指针变手形 |
| 进页面拉一次快照（有缓存不读 HID） | ✅ | ✅ | ✅ | |
| 换设备不显示上一只的电量 | ✅ | 按 deviceId 取样本 | ✅ | |

## 设置页

| 功能 | Tauri 版 | NSH 版 | 状态 | 备注 |
|---|---|---|---|---|
| 分区（外观 / 关于）+ 搜索设置 | ✅ | 单页平铺，无搜索 | ❌ | |
| 主题：浅色 / 深色 / 跟随系统 | ✅ | ✅ | ⚠️ | NSH 未实测切换 |
| 自动刷新间隔 | 数字输入 3–6000 秒 | 固定档 3/5/10/30/60/120/300 秒 | ⚠️ | 无自定义值 |
| 自动刷新开关 | 仅首页 | 首页 + 设置页 | ✅ | |
| 托盘显示分类多选（至少一项） | ✅ | ✅ | ✅ | |
| 关闭窗口时：进托盘 / 退出 | 复选框 | 两个选项 | ✅ | |
| 开机自启开关 | ✅（开发版隐藏） | ✅ | ⚠️ | NSH 未实测写注册表 |
| 开机自启路径诊断面板 | ✅ | Rust 有 `autostartCommand`，UI 未接 | ❌ | |
| 恢复默认（含关闭自启、重置托盘设备） | ✅ | 无 | ❌ | |
| 关闭设置回首页 | 底部「关闭」按钮 | 标题栏「首页」 | ✅ | |
| 版本号、GitHub 链接 | ✅ | 版本在设置页，GitHub 在标题栏 | ✅ | |
| 日志路径、打开日志目录 | ✅ | ✅ | ✅ | |
| 设置文件路径 | 无 | ✅ | ✅ | NSH 新增 |
| 检查更新 | ✅ | 设置页「应用更新」：检查、下载并安装、进度与说明 | ⚠️ | 未实测（需先发一版带 latest.json 的 Release） |

## 托盘

| 功能                      | Tauri 版                  | NSH 版                                     | 状态  | 备注                            |
| ----------------------- | ------------------------ | ----------------------------------------- | --- | ----------------------------- |
| 动态电池图标 32×32，按分类 1–3 格  | `tray.rs`                | `tray_icon.rs`，PNG data URI 交给 `Tray.set` | ⚠️  | 单测通过，未目视确认 单电池显示通过, 2/3 电池未确认 |
| 颜色阈值、充电 / 不支持 / 读取失败区分  | ✅                        | ✅                                         | ✅   | 单测                            |
| tooltip：每个勾选分类一行，标出图标设备 | ✅                        | ✅                                         | ✅   | 单测                            |
| 菜单：打开主界面 / 退出           | ✅                        | ✅，多「设置」                                   | ✅   |                               |
| 鼠标交互                    | 左键单击弹菜单，左键双击开窗           | 左键单击开窗，右键菜单                               | ✅   |                               |
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
| `--autostart` 启动只进托盘 | ✅ | ✅ | ⚠️ | NSH 未实测 |

## 开机自启

| 功能 | Tauri 版 | NSH 版 | 状态 | 备注 |
|---|---|---|---|---|
| HKCU Run `yugutou_tool` = `"<exe>" --autostart` | tauri-plugin-autostart | `autostart.rs` 直接写注册表 | ✅ | 同一个值，老用户升级后不失效 |
| 启动时修正 Run 里的 exe 路径 | `refresh_autostart_exe_path` | 无 | ❌ | 安装路径变化后自启会失效 |
| 启动诊断日志（`autostart_diag::log_startup`） | ✅ | 无 | ❌ | |

## 设置持久化

| 功能 | Tauri 版 | NSH 版 | 状态 | 备注 |
|---|---|---|---|---|
| 设置落盘 | tauri-plugin-zustand `settings.json` | `%APPDATA%\com.wwwj.mousetool\nsh\settings.json`，Rust 唯一所有者 | ✅ | 字段同名 |
| 首次启动导入 Tauri 版设置 | — | 只读导入 | ✅ | 已实测 |
| 非法值归一（间隔、分类、设备 id） | ✅ | ✅ | ✅ | 单测 |

## 日志

| 功能 | Tauri 版 | NSH 版 | 状态 | 备注 |
|---|---|---|---|---|
| 启动期文件日志、panic 记录 | `mouse_tool.log` | `mouse_tool_nsh.log` | ✅ | |
| 位置：exe 目录 `logs`，无权限回退 `%LOCALAPPDATA%` | ✅ | ✅ | ✅ | 已实测 |

## 自动更新

| 功能 | Tauri 版 | NSH 版 | 状态 | 备注 |
|---|---|---|---|---|
| 检查、下载、安装、重启 | tauri-plugin-updater + GitHub latest.json（minisign） | `nsh/updater`（`src/updater.ts`）：启动 15 秒后 + 每 6 小时自动检查，设置页手动检查，托盘「安装更新」；`nsh.json` `updater.github` + `publicKey`（Ed25519） | ⚠️ | 代码与测试已过，端到端未实测 |
| 老 Tauri 用户升级到 NSH 版 | — | 不支持 | ❌ | 两边都读 `releases/latest/download/latest.json`，但格式和签名（minisign vs Ed25519）都不同：老版检查会报错，不能应用内升级，只能手动装 NSH 安装包；老 MSI 装在别的目录，需手动卸载 |

## 打包发版

| 功能 | Tauri 版 | NSH 版 | 状态 | 备注 |
|---|---|---|---|---|
| 安装包 | MSI（WiX zh-CN，passive） | `nsh package` 出目录 + zip + `.iss`，CI 里 Inno Setup 编出 `yugutou_tool-<版本>-setup.exe`（按用户安装，可被更新覆盖） | ⚠️ | 本机未装 Inno Setup，安装包只在 CI 出；不出 MSI |
| release.yml：tag → 构建 → Release → latest.json | tauri-action | `.github/workflows/release.yml`：装 nsh → check/test/build → package → Inno Setup → `nsh update-manifest` 签名 → `gh release create` | ⚠️ | actionlint 通过，未在 GitHub 上跑过；需 secret `NSH_UPDATE_KEY` |
| 版本号随 tag 同步 | package.json / tauri.conf（`scripts/sync-version.mjs`、`bump-version.mjs`） | `pnpm release:bump <版本>`：`scripts/bump-version.mjs` + `sync-version.mjs` 改 nsh.json（build + 1）/ Cargo.toml / Cargo.lock，提交、打 tag、推送；CI 校验版本与 tag 一致 | ✅ | `--dry-run` 已验证 |
| 应用图标 | ✅ | `--icon assets/icon.png`（从 `src-tauri/icons/icon.png` 搬到 `assets/`） | ✅ | |

## MorphBot

| 功能 | Tauri 版 | NSH 版 | 状态 | 备注 |
|---|---|---|---|---|
| 侧栏动画角色（SVG + 音频） | `src/vendor/morph-bot`（已删，可从 `aa6f6d5` 找回） | 无 | ❌ | 依赖 DOM，需用 Canvas / Motion 重写或移除 |

## 主题

| 功能 | Tauri 版 | NSH 版 | 状态 | 备注 |
|---|---|---|---|---|
| 浅 / 深 / 跟随系统 | CSS `dark` class + matchMedia | `setColorScheme` | ⚠️ | 未实测 |
| 配色：老版 shadcn 变量（深蓝黑底 oklch(0.145 0.015 255) 等）、右上蓝色光晕、卡片阴影 | ✅ | `theme.json` 原样搬老版 CSS 变量；光晕用 `backgroundImage` 径向渐变 | ✅ | 无 blur 模糊，观感接近 |

## 其它

| 功能 | Tauri 版 | NSH 版 | 状态 | 备注 |
|---|---|---|---|---|
| 测试 | cargo test | cargo test（62 通过）+ `nsh test` 2 个 UI 测试 | ✅ | |
| 进程结构 | 主进程 + 6 个 WebView2 子进程 | 单进程，Win32 + Direct2D | ✅ | |

## 待办

- [ ] P0 退出 Tauri 版后复验实机电量读取（Viper 等 5 款）
- [ ] P0 目视确认托盘图标（颜色、1–3 格）和 tooltip
- [ ] P0 定托盘鼠标交互（沿用「单击菜单、双击开窗」或保留 NSH 现状）
- [ ] P0 实测开机自启开关、`--autostart` 只进托盘、主题切换
- [x] P1 接入 `nsh/updater`（2026-11-24）：公钥写进 `nsh.json`，私钥在仓库外；设置页「应用更新」+ 自动检查
- [x] P1 新建 `.github/workflows/release.yml`（2026-11-24）：nsh package + Inno Setup + 签名 latest.json + GitHub Release
- [ ] P1 老 Tauri 用户没法应用内升级到 NSH 版（清单格式与签名不兼容，老版检查更新会报错）：发版说明 / README 写明手动下载安装包并卸载旧 MSI；可选再发最后一版 Tauri，检查更新时引导到下载页
- [ ] P0 首次真实发版走通：在 GitHub 添加 secret `NSH_UPDATE_KEY`，`pnpm release:bump` 一版，确认 Release 资产（setup.exe、更新 zip、latest.json、latest.json.sig），再用上一版实测应用内更新
- [ ] P1 签名私钥备份：`D:\DEV\wwwwj\_nsh_probe\keys\yugutou-update.secret` 丢了就再也发不了已装用户能验签的更新
- [ ] P1 启动时修正 Run 路径 + 自启诊断面板
- [ ] P1 设置页「恢复默认」
- [ ] P2 自动刷新间隔支持自定义数值
- [ ] P2 设置页分区与搜索
- [ ] P2 侧栏品牌区 + MorphBot：重写或正式移除
- [ ] P3 圆环填充 / 刷新图标的过渡动画（NSH `Animated` / Motion）
- [x] 已删除 Tauri 旧代码（2026-11-24）：`src-tauri/`、`src/`（含 `vendor/morph-bot`、`bindings.ts`）、`index.html`、`vite.config.ts`、`tsconfig*.json`、`eslint.config.mjs`、`components.json`、`package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml`、`node_modules/`、`dist/`、`.tanstack/`、`scripts/{sync-version,bump-version}.mjs`、`scripts/tauri-build.ps1`、`.github/workflows/release.yml`、`.cursor/rules/react-compiler.mdc`。设备 manifest 搬到 `native/manifests/`，应用图标搬到 `assets/icon.png`。全部可从提交 `aa6f6d5` 找回
- [x] `nsh-app/` 的内容移到仓库根目录（2026-11-24）：`App.tsx`、`app.test.tsx`、`nsh.json`、`theme.json`、`tsconfig.json`、`native/`、`src/`、`assets/`；`nsh-app/.gitignore` 并进根 `.gitignore`
- [x] P2 NSH 版的版本 bump 脚本（2026-11-24）：`pnpm release:bump <版本> [--dry-run]`
- [ ] P3 清理临时目录 `D:\DEV\wwwwj\_nsh_probe`（先把 `keys/` 里的更新签名私钥挪到安全位置）
