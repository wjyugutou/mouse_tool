#!/usr/bin/env node
/**
 * 仓库内的 nsh：`node scripts/nsh.mjs <args>`，等同于执行 `nsh <args>`。
 * nsh 版本只写在 package.json 的 `nshVersion`（CI 也走本脚本）。
 * `.tools/nsh/bin/nsh(.exe)` 不存在，或 `--version` 与 `nshVersion` 不符时，用官方安装脚本装到 `.tools/nsh`。
 * 官方脚本没有「不改用户 PATH」的选项：Windows 上装完会把用户 PATH 恢复成安装前的值。
 */
import { spawnSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const installDir = join(root, '.tools', 'nsh')
const exe = join(installDir, 'bin', isWin ? 'nsh.exe' : 'nsh')

const wanted = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).nshVersion
if (!/^v\d+\.\d+\.\d+$/.test(wanted ?? '')) {
  console.error(`package.json 的 nshVersion 应形如 v0.6.1，现在是 ${wanted}`)
  process.exit(1)
}

/** `nsh 0.6.1 (2f51d86)` → `v0.6.1`；没装或跑不起来返回 null。 */
function installedVersion() {
  if (!existsSync(exe)) return null
  const r = spawnSync(exe, ['--version'], { encoding: 'utf8' })
  const m = (r.stdout || '').match(/(\d+\.\d+\.\d+)/)
  return r.status === 0 && m ? `v${m[1]}` : null
}

function install() {
  console.error(`[nsh.mjs] 安装 nsh ${wanted} 到 ${installDir}`)
  const env = { ...process.env, NSH_VERSION: wanted, NSH_INSTALL_DIR: installDir }
  // 从 PowerShell 7 里调起时，继承的 PSModulePath 指向 pwsh 的模块，Windows PowerShell 5.1 会找不到 Get-FileHash 等命令。
  if (isWin) delete env.PSModulePath
  const r = isWin
    ? spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          // 官方脚本会把 bin 追加到用户 PATH；这里装完把用户 PATH 恢复原样，只用仓库内的路径。
          "$before = [Environment]::GetEnvironmentVariable('Path', 'User'); " +
            'try { irm https://nsh.dev/install.ps1 | iex } finally { ' +
            "if ([Environment]::GetEnvironmentVariable('Path', 'User') -ne $before) { " +
            "[Environment]::SetEnvironmentVariable('Path', $before, 'User') } }",
        ],
        { stdio: 'inherit', env },
      )
    : spawnSync('sh', ['-c', 'curl -fsSL https://nsh.dev/install.sh | sh'], { stdio: 'inherit', env })
  if ((r.status ?? 1) !== 0) {
    console.error('[nsh.mjs] 安装失败')
    process.exit(r.status ?? 1)
  }
  const now = installedVersion()
  if (now !== wanted) {
    console.error(`[nsh.mjs] 安装后版本是 ${now}，应为 ${wanted}`)
    process.exit(1)
  }
}

const have = installedVersion()
if (have !== wanted) {
  if (have) console.error(`[nsh.mjs] .tools/nsh 里是 ${have}，需要 ${wanted}`)
  install()
}

const child = spawn(exe, process.argv.slice(2), { stdio: 'inherit', cwd: process.cwd() })
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
child.on('error', (e) => {
  console.error(`[nsh.mjs] 无法启动 ${exe}: ${e.message}`)
  process.exit(1)
})
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
