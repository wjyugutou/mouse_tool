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

console.log(`synced version ${version} → tauri.conf.json, Cargo.toml`)
