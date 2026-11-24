#!/usr/bin/env node
/**
 * 用法: pnpm release:bump <semver> [--dry-run]
 * 工作区必须干净。改 nsh.json / native/Cargo.toml / native/Cargo.lock 的版本（nsh.json 的 build + 1），
 * 生成 docs/releases/v<semver>.md，提交 `chore: 版本 bump 至 <semver>`，打 annotated tag v<semver>，
 * 再推送当前分支和 tag。tag 推上去后 GitHub Actions `Release` 构建并发布。
 * --dry-run：只检查并打印会改的文件、发版说明和 tag，不写文件、不碰 git。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { SEMVER, VERSION_FILES, applyPlan, compareSemver, currentVersion, planVersion, root } from './sync-version.mjs'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const ver = args.find((a) => !a.startsWith('--'))
if (!ver || !SEMVER.test(ver)) {
  console.error('用法: pnpm release:bump <semver> [--dry-run]  例如 pnpm release:bump 3.6.0')
  process.exit(1)
}
const tag = `v${ver}`
const notesRel = `docs/releases/${tag}.md`
const problems = []

function git(gitArgs, { allowStatus = [] } = {}) {
  const result = spawnSync('git', gitArgs, { cwd: root, encoding: 'utf8' })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  const status = result.status ?? 1
  if (status !== 0 && !allowStatus.includes(status)) {
    console.error((result.stderr || result.stdout || '').trim() || `git ${gitArgs.join(' ')} 失败`)
    process.exit(status)
  }
  return { status, stdout: (result.stdout || '').trimEnd() }
}

function node(script, scriptArgs) {
  const r = spawnSync(process.execPath, [join(root, script), ...scriptArgs], { cwd: root, encoding: 'utf8' })
  if ((r.status ?? 1) !== 0) {
    console.error((r.stderr || r.stdout || '').trim())
    process.exit(r.status ?? 1)
  }
  return r.stdout || ''
}

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout
if (branch === 'HEAD') problems.push('当前是 detached HEAD，不能发版')

const dirty = git(['status', '--porcelain']).stdout
if (dirty) problems.push(`工作区有未提交的改动，先提交后再发版：\n${dirty}`)

const { version: cur } = currentVersion()
if (compareSemver(ver, cur) <= 0) problems.push(`新版本 ${ver} 必须大于 nsh.json 当前的 ${cur}（更新器只接受更高的 semver）`)

if (git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], { allowStatus: [1] }).status === 0) problems.push(`本地已有 tag ${tag}`)
if (git(['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`], { allowStatus: [2] }).status === 0) problems.push(`远端已有 tag ${tag}`)

const plan = planVersion(ver, { bumpBuild: true })

if (dryRun) {
  console.log(`[dry-run] 分支 ${branch}，当前版本 ${cur} → ${ver}`)
  console.log('[dry-run] 会改的文件：')
  for (const p of plan) console.log(`  ${p.file}: ${p.from} → ${p.to}${p.changed ? '' : '（不变）'}`)
  console.log(`  ${notesRel}（发版说明，scripts/gen-release-notes.mjs 生成）`)
  console.log(`[dry-run] 提交：chore: 版本 bump 至 ${ver}`)
  console.log(`[dry-run] tag：${tag}（annotated，内容为发版说明）`)
  console.log(`[dry-run] 推送：git push origin ${branch} && git push origin ${tag}`)
  console.log('[dry-run] 发版说明预览：')
  console.log(node('scripts/gen-release-notes.mjs', ['--tag', tag]).replace(/^/gm, '  | '))
  if (problems.length) {
    console.log('[dry-run] 真正执行前要先解决：')
    for (const p of problems) console.log(`  - ${p}`)
  }
  process.exit(0)
}

if (problems.length) {
  for (const p of problems) console.error(p)
  process.exit(1)
}

applyPlan(plan)
for (const p of plan) console.log(`${p.file}: ${p.from} → ${p.to}`)
node('scripts/gen-release-notes.mjs', ['--tag', tag, '--write', notesRel])
const notesBody = readFileSync(join(root, notesRel), 'utf8').trim()

git(['add', '--', ...VERSION_FILES, notesRel])
git(['commit', '-m', `chore: 版本 bump 至 ${ver}`])
git(['tag', '-a', tag, '-m', notesBody || tag])
git(['push', 'origin', branch])
git(['push', 'origin', tag])
console.log(`已推送 ${branch} 和 ${tag}；GitHub Actions Release 会构建并发布`)
