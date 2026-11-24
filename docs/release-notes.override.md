> **本版主题**：整个应用从 Tauri 重写为 Native Shell（NSH）+ Rust，托盘常驻内存从约 190 MB 降到约 18 MB。
>
> **Theme**: rewritten from Tauri to Native Shell (NSH) + Rust; resident memory drops from ~190 MB to ~18 MB.

### ✨ 新功能 · Features

- **NSH 重写**：Rust 原生模块（`native/`）+ TSX 界面（NSH mixed 模式），去掉 Tauri 与 WebView 层。托盘常驻内存约 18 MB，旧版约 190 MB。
- **设备插件架构**：构建期注册，每只设备一个 Rust 模块 + manifest（`native/manifests/<id>.json`），托盘、首页、设置共用同一份设备表。新增设备不再改动窗口与托盘代码。
- **新增设备支持**：雷柏 VT9 AIR、雷蛇毒蝰终极版（Viper Ultimate）、迈从 A5 V3 Ultra+、前行者 S9 Pro，以及首只键盘 VGN S99。
- **应用内更新**：启动 15 秒后与每 6 小时自动检查；设置页可手动检查、下载并安装，托盘菜单在有新版本时多一项「安装更新」。清单验签（Ed25519）+ 下载校验 SHA-256。
- **按分类的托盘图标**：按勾选的分类画 1–3 格电池图标，悬停提示每个分类一行并标出主图标设备。
- **开机自启与运行日志**：注册表 Run 值控制开机自启；日志优先写安装目录 `logs/`，无写权限时回退 AppData。
- **`scripts/nsh.mjs` 管理 nsh CLI**：按 `package.json` 的 `nshVersion` 自动装到仓库内 `.tools/nsh`，版本不符自动重装，不改用户 PATH。安装脚本直接取 GitHub Release，并限时 60 秒（超时直接失败而非无限等待，可用 `NSH_INSTALL_TIMEOUT_MS` 放宽）。

### 🐛 修复 · Fixed

- **侧栏分类 Tab 被自动刷新顶回**：每秒的设置快照刷新会把用户刚点的分类 Tab 换回当前设备所属分类，导致「键盘 / 耳机」页一闪就回鼠标列表。现在只在当前设备的分类真的改变时才跟随切换。
- **文档**：修正产物 zip 的命名说明（`yugutou-tool-<版本>-windows-x86_64.zip`），补充 `pnpm build` 与 `pnpm package` 的产物差异，补充代理与安装超时说明。

## ⚠️ 从旧版升级 · Upgrading

旧版 Tauri（MSI）**不能**应用内升级到本版：两边的更新清单格式与签名算法都不同。请下载下方 `yugutou_tool-<版本>-setup.exe` 手动安装一次，旧 MSI 需要手动卸载。

The old Tauri (MSI) build **cannot** update itself to this version. Install `yugutou_tool-<version>-setup.exe` from **Assets** once, and uninstall the old MSI by hand.

## 📦 安装 / Install

安装包在下方 **Assets**；应用内更新使用 `latest.json`。

Installers are in **Assets** below. In-app updater uses `latest.json`.
