#!/usr/bin/env node
/**
 * 用法: node scripts/bump-version.mjs 1.0.2
 * 改 package.json version，并同步 tauri.conf.json / Cargo.toml
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ver = process.argv[2]
if (!ver || !/^\d+\.\d+\.\d+/.test(ver)) {
  console.error('用法: node scripts/bump-version.mjs <semver>  例如 1.0.2')
  process.exit(1)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.version = ver
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

const r = spawnSync(process.execPath, [join(root, 'scripts/sync-version.mjs')], {
  stdio: 'inherit',
  cwd: root,
})
process.exit(r.status ?? 1)
