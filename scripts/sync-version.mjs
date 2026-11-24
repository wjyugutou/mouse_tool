#!/usr/bin/env node
/**
 * 把版本号写进所有版本文件：nsh.json（version，可选 build + 1）、native/Cargo.toml、native/Cargo.lock。
 * 用法:
 *   node scripts/sync-version.mjs <semver> [--bump-build] [--dry-run]
 *   node scripts/sync-version.mjs --check <semver>   # 只校验各处是否已是该版本（CI 用）
 * 版本号的唯一来源是 nsh.json；本脚本只负责把它同步到 Rust crate。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const SEMVER = /^\d+\.\d+\.\d+$/
export const VERSION_FILES = ['nsh.json', 'native/Cargo.toml', 'native/Cargo.lock']
const CRATE = 'yugutou-native'

function read(rel) {
  return readFileSync(join(root, rel), 'utf8')
}

export function currentVersion() {
  const nsh = JSON.parse(read('nsh.json'))
  return { version: nsh.version, build: nsh.build }
}

/** 按 semver 比大小：a > b 返回正数。 */
export function compareSemver(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}

/** 计算每个版本文件的新内容；不写盘。返回 [{ file, from, to, text, changed }]。 */
export function planVersion(version, { bumpBuild = false } = {}) {
  if (!SEMVER.test(version)) throw new Error(`不是 semver：${version}`)
  const plan = []

  // nsh.json：只替换 "version" / "build" 的值，保留原有格式与换行。
  const nshText = read('nsh.json')
  const nsh = JSON.parse(nshText)
  let nextNsh = nshText.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`)
  let build = nsh.build
  if (bumpBuild) {
    if (!/"build"\s*:\s*\d+/.test(nextNsh)) throw new Error('nsh.json 里没有 "build"')
    build = Number(nsh.build ?? 0) + 1
    nextNsh = nextNsh.replace(/("build"\s*:\s*)\d+/, `$1${build}`)
  }
  plan.push({
    file: 'nsh.json',
    from: `${nsh.version} (build ${nsh.build})`,
    to: `${version} (build ${build})`,
    text: nextNsh,
    changed: nextNsh !== nshText,
  })

  // native/Cargo.toml：[package] 段的第一行 version。
  const tomlText = read('native/Cargo.toml')
  const tomlFrom = tomlText.match(/^version\s*=\s*"([^"]+)"/m)?.[1]
  if (!tomlFrom) throw new Error('native/Cargo.toml 里没有 version')
  const nextToml = tomlText.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`)
  plan.push({ file: 'native/Cargo.toml', from: tomlFrom, to: version, text: nextToml, changed: nextToml !== tomlText })

  // native/Cargo.lock：本 crate 那一项。
  const lockText = read('native/Cargo.lock')
  const lockRe = new RegExp(`(name = "${CRATE}"\\r?\\nversion = ")([^"]+)"`)
  const lockFrom = lockText.match(lockRe)?.[2]
  if (!lockFrom) throw new Error(`native/Cargo.lock 里没有 ${CRATE} 的 version`)
  const nextLock = lockText.replace(lockRe, `$1${version}"`)
  plan.push({ file: 'native/Cargo.lock', from: lockFrom, to: version, text: nextLock, changed: nextLock !== lockText })

  return plan
}

export function applyPlan(plan) {
  for (const item of plan) if (item.changed) writeFileSync(join(root, item.file), item.text)
}

function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const bumpBuild = args.includes('--bump-build')
  const check = args.includes('--check')
  const version = args.find((a) => !a.startsWith('--'))
  if (!version || !SEMVER.test(version)) {
    console.error('用法: node scripts/sync-version.mjs <semver> [--bump-build] [--dry-run] | --check <semver>')
    process.exit(1)
  }
  const plan = planVersion(version, { bumpBuild })
  if (check) {
    const stale = plan.filter((p) => p.changed)
    if (stale.length) {
      for (const p of stale) console.error(`${p.file}: ${p.from}，应为 ${version}`)
      process.exit(1)
    }
    console.log(`版本文件都是 ${version}`)
    return
  }
  for (const p of plan) console.log(`${dryRun ? '[dry-run] ' : ''}${p.file}: ${p.from} → ${p.to}${p.changed ? '' : '（不变）'}`)
  if (!dryRun) applyPlan(plan)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
