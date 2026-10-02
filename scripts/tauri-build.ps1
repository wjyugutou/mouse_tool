# 本地打包：自动加载 updater 签名私钥（勿把 .key 提交进仓库）
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$keyCandidates = @(
  $env:TAURI_SIGNING_PRIVATE_KEY_PATH,
  (Join-Path $Root "mouse_tool_updater_keys\mouse_tool.key"),
  (Join-Path $Root "mouse_tool.key")
) | Where-Object { $_ }

$keyPath = $keyCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $keyPath) {
  Write-Error @"
找不到签名私钥。请任选其一：
1) 把 mouse_tool.key 放到项目目录 mouse_tool_updater_keys\
2) 设置环境变量 TAURI_SIGNING_PRIVATE_KEY_PATH=私钥完整路径
3) 直接设置 TAURI_SIGNING_PRIVATE_KEY=私钥内容
"@
}

if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
  $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -Raw $keyPath).Trim()
}
if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "mousetool"
}

Write-Host "Using signing key: $keyPath"
$tauriJs = Join-Path $Root "node_modules\@tauri-apps\cli\tauri.js"
if (-not (Test-Path $tauriJs)) {
  Write-Error "缺少 @tauri-apps/cli，先运行 pnpm install"
}
node $tauriJs build @args