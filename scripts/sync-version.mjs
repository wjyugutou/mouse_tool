import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

const tauriPath = join(root, 'src-tauri', 'tauri.conf.json')
const tauri = JSON.parse(readFileSync(tauriPath, 'utf8'))
tauri.version = version
writeFileSync(tauriPath, `${JSON.stringify(tauri, null, 2)}\n`)

const cargoPath = join(root, 'src-tauri', 'Cargo.toml')
const cargo = readFileSync(cargoPath, 'utf8').replace(
  /^version\s*=\s*"[^"]+"/m,
  `version = "${version}"`,
)
writeFileSync(cargoPath, cargo)

const lockPath = join(root, 'src-tauri', 'Cargo.lock')
const lock = readFileSync(lockPath, 'utf8')
let foundLockVersion = false
const nextLock = lock.replace(
  /(name = "tauri-app"\r?\nversion = ")[^"]+"/,
  (_, prefix) => {
    foundLockVersion = true
    return `${prefix}${version}"`
  },
)
if (!foundLockVersion) {
  console.error('Cargo.lock 里没有找到 tauri-app 的 version')
  process.exit(1)
}
writeFileSync(lockPath, nextLock)

console.log(`synced version ${version} → tauri.conf.json, Cargo.toml, Cargo.lock`)
