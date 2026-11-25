#!/usr/bin/env node
/**
 * 把 nsh 写出的 Inno Setup 脚本改成简体中文，并在有 ISCC.exe 时重新编译安装包。
 * nsh package 不写 [Languages]，安装向导默认英文。
 * GitHub Actions 预装的 Inno Setup 6 不带简体中文，所以引用仓库里的
 * `scripts/inno/ChineseSimplified.isl`（Inno Setup 6.5+ 译文，Zhenghan Yang）。
 * nsh 找到 ISCC 时会先编出英文安装包，所以本脚本在它之后跑，改脚本并覆盖编译。
 *
 * 用法:
 *   node scripts/installer-zh.mjs [输出目录] [--require]
 * 输出目录默认 .nsh/out。--require 在没有 ISCC 或编译失败时退出码非 0（CI 用）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const MESSAGES_LINE = /^Name:\s*"chinesesimplified";\s*MessagesFile:\s*".*"\s*$/m

function languageLine(messagesFile) {
  return `Name: "chinesesimplified"; MessagesFile: "${messagesFile.replaceAll('"', '""')}"`
}

/** 在 [Setup] 前插入简体中文，或把已有的 MessagesFile 改成 `messagesFile`。 */
export function patchIss(text, messagesFile) {
  const line = languageLine(messagesFile)
  if (MESSAGES_LINE.test(text)) return text.replace(MESSAGES_LINE, line)
  const at = text.indexOf('[Setup]')
  if (at < 0) throw new Error('iss 里没有 [Setup]')
  const gap = at > 0 && !text.slice(0, at).endsWith('\n') ? '\n' : ''
  return `${text.slice(0, at)}${gap}[Languages]\n${line}\n${text.slice(at)}`
}

function outputBase(text) {
  const match = text.match(/^OutputBaseFilename=(.+)$/m)
  return match ? match[1].trim() : null
}

function findIss(dir) {
  const files = readdirSync(dir).filter((name) => name.endsWith('.iss'))
  if (files.length === 1) return join(dir, files[0])
  const named = files.find((name) => name === 'yugutou_tool.iss')
  if (named) return join(dir, named)
  throw new Error(files.length === 0 ? `${dir} 里没有 .iss` : `${dir} 里有多个 .iss：${files.join(', ')}`)
}

/** 与 nsh 的查找顺序一致：PATH，然后 Program Files 和用户安装目录。 */
export function findIscc() {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const name of ['ISCC.exe', 'iscc.exe', 'iscc']) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  for (const key of ['ProgramFiles(x86)', 'ProgramFiles', 'LOCALAPPDATA']) {
    const base = process.env[key]
    if (!base) continue
    for (const candidate of [
      join(base, 'Inno Setup 6', 'ISCC.exe'),
      join(base, 'Programs', 'Inno Setup 6', 'ISCC.exe'),
    ]) {
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function compile(iscc, iss, outDir) {
  const result = spawnSync(iscc, ['/Q', `/O${outDir}`, iss], { encoding: 'utf8' })
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    throw new Error(detail || `ISCC 退出码 ${result.status}`)
  }
}

function main() {
  const args = process.argv.slice(2)
  const requireCompiler = args.includes('--require')
  const outArg = args.find((arg) => !arg.startsWith('--'))
  const outDir = outArg ? (isAbsolute(outArg) ? outArg : join(root, outArg)) : join(root, '.nsh', 'out')
  if (!existsSync(outDir)) throw new Error(`没有输出目录 ${outDir}，先跑 nsh package`)
  const messagesFile = join(root, 'scripts', 'inno', 'ChineseSimplified.isl')
  if (!existsSync(messagesFile)) throw new Error(`缺少简体中文语言文件 ${messagesFile}`)
  const iss = findIss(outDir)
  const original = readFileSync(iss, 'utf8')
  const patched = patchIss(original, messagesFile)
  if (patched !== original) writeFileSync(iss, patched)
  console.log(`${iss}: 简体中文`)

  const iscc = findIscc()
  if (!iscc) {
    const message = '没有 ISCC.exe，安装包未按简体中文重编。需要 Inno Setup 6.5 或更新。'
    if (requireCompiler) throw new Error(message)
    console.warn(message)
    return
  }

  const base = outputBase(patched)
  if (!base) throw new Error(`${iss} 里没有 OutputBaseFilename`)
  const setup = join(outDir, `${base}.exe`)
  if (existsSync(setup)) unlinkSync(setup)
  compile(iscc, iss, outDir)
  if (!existsSync(setup)) throw new Error(`编译后没有 ${setup}`)
  console.log(`已编译 ${setup}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
