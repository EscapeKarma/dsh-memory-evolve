/**
 * tests/package-manifest.test.js — 发布包必须自带运行时要用的文件（issue #110）
 *
 * 缺陷：`package.json` 没有 `files` 白名单，npm 打的 tarball 里**没有 `scripts/`**，
 * 而 `lib/sync/index.js` 用 `join(..., 'scripts', 'sync-worker.mjs')` 启动同步
 * worker → 从 npm 安装的用户一旦开同步就只看到「worker 无输出」，没有任何线索。
 *
 * 本文件把"运行时到底需要哪些文件"变成可执行断言：
 *   1. 每个清单（`lib/`、`scripts/`、`skills/`、`vendor/`、`cordis.patch.yml` …）
 *      都真实存在，且被 `files` 覆盖；
 *   2. `files` 里的每条模式都能匹配到磁盘上的东西（防手滑写错、静默失效）；
 *   3. 代码里按相对路径读取的资源（worker 入口、mermaid 静态文件、bundle patch）
 *      都落在白名单内——这类"代码要、打包忘"的漏项正是本 issue 的成因。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const files = Array.isArray(manifest.files) ? manifest.files : []

/** 把 npm `files` 模式转成正则（只为本仓库用到的三种形态：目录/、*.md、字面路径）。 */
function toRegExp(pattern) {
  if (pattern.endsWith('/')) {
    const prefix = pattern.replace(/\/+$/, '')
    return new RegExp(`^${escapeRe(prefix)}/`)
  }
  if (pattern.includes('*')) {
    return new RegExp(`^${pattern.split('*').map(escapeRe).join('[^/]*')}$`)
  }
  return new RegExp(`^${escapeRe(pattern)}$`)
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 该相对路径是否被 `files` 白名单覆盖（npm 还会自动带上 package.json/README/LICENSE）。 */
function covered(relPath) {
  if (relPath === 'package.json' || relPath === 'LICENSE' || /^README(\.[^/]*)?$/.test(relPath)) return true
  return files.some((pattern) => toRegExp(pattern).test(relPath))
}

/** 递归列出目录下所有文件（相对仓库根，POSIX 分隔符）。 */
function walk(relDir) {
  const out = []
  const abs = join(ROOT, relDir)
  if (!existsSync(abs)) return out
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`
    if (entry.isDirectory()) out.push(...walk(rel))
    else out.push(rel)
  }
  return out
}

test('package.json：files 白名单存在且非空（issue #110）', () => {
  assert.ok(files.length > 0, 'package.json 必须有 files 白名单，否则 npm 会漏掉 scripts/ 等运行时目录')
  assert.ok(files.includes('scripts/'), 'scripts/ 必须进白名单：sync worker 入口在那里')
})

test('package.json：files 里每条模式都真的匹配到了文件（防写错/静默失效）', () => {
  for (const pattern of files) {
    const re = toRegExp(pattern)
    const hit = walkAll().some((rel) => re.test(rel))
    assert.equal(hit, true, `files 模式 "${pattern}" 没有匹配到任何文件`)
  }
})

/** 全仓库文件清单（跳过 node_modules/.git，测试自己的开销要可控）。 */
function walkAll() {
  const skip = new Set(['node_modules', '.git'])
  const out = []
  const rec = (relDir) => {
    const abs = relDir === '' ? ROOT : join(ROOT, relDir)
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (relDir === '' && skip.has(entry.name)) continue
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`
      if (entry.isDirectory()) rec(rel)
      else out.push(rel)
    }
  }
  rec('')
  return out
}

test('package.json：运行时目录一个都不能少（lib/scripts/skills/vendor）', () => {
  for (const dir of ['lib', 'scripts', 'skills', 'vendor']) {
    const entries = walk(dir)
    assert.ok(entries.length > 0, `${dir}/ 不应为空`)
    for (const rel of entries) assert.equal(covered(rel), true, `${rel} 未被 files 白名单覆盖`)
  }
})

test('代码按相对路径读的资源都在白名单内（issue #110 的直接回归）', () => {
  // 1) sync worker 入口：lib/sync/index.js 的 join(dirname, '..', '..', 'scripts', 'sync-worker.mjs')
  const worker = join(ROOT, 'scripts', 'sync-worker.mjs')
  assert.equal(existsSync(worker), true, 'scripts/sync-worker.mjs 必须存在')
  assert.equal(covered('scripts/sync-worker.mjs'), true, 'scripts/sync-worker.mjs 必须随包发布')

  // 2) mermaid 静态文件：lib/mermaid.js 的 new URL('../vendor/mermaid.min.js', import.meta.url)
  assert.equal(existsSync(join(ROOT, 'vendor', 'mermaid.min.js')), true, 'vendor/mermaid.min.js 必须存在')
  assert.equal(covered('vendor/mermaid.min.js'), true, 'vendor/mermaid.min.js 必须随包发布')

  // 3) bundle patch：package.json 的 dsh.bundle.patch
  const patch = String(manifest.dsh?.bundle?.patch ?? '').replace(/^\.\//, '')
  assert.ok(patch !== '', 'package.json 必须声明 dsh.bundle.patch')
  assert.equal(existsSync(join(ROOT, patch)), true, `${patch} 必须存在`)
  assert.equal(covered(patch), true, `${patch} 必须随包发布`)

  // 4) 客户端入口：package.json 的 exports["./client"]
  const client = String(manifest.exports?.['./client'] ?? '').replace(/^\.\//, '')
  assert.ok(client !== '', 'package.json 必须声明 exports["./client"]')
  assert.equal(existsSync(join(ROOT, client)), true, `${client} 必须存在（构建产物要提交）`)
  assert.equal(covered(client), true, `${client} 必须随包发布`)

  // 5) 主入口与内置技能
  assert.equal(existsSync(join(ROOT, 'lib', 'index.js')), true)
  const skillDirs = readdirSync(join(ROOT, 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory())
  assert.ok(skillDirs.length >= 5, '内置技能目录应有 5 个以上')
  for (const dir of skillDirs) assert.equal(covered(`skills/${dir.name}/SKILL.md`), true, `skills/${dir.name}/SKILL.md 必须随包发布`)
})

test('package.json：不该进发布包的东西没进（tests、node_modules、构建源不需要 — src/ 除外可留）', () => {
  const shipped = walkAll().filter((rel) => covered(rel))
  for (const rel of shipped) {
    assert.equal(rel.startsWith('tests/'), false, `${rel} 不该进发布包`)
    assert.equal(rel.startsWith('node_modules/'), false, `${rel} 不该进发布包`)
    assert.equal(rel.startsWith('.git/'), false, `${rel} 不该进发布包`)
  }
  // 发布包里必须包含已构建的客户端产物，否则界面加载不出来
  assert.equal(shipped.includes('lib/client.js'), true, 'lib/client.js 必须随包发布')
  assert.equal(statSync(join(ROOT, 'lib', 'client.js')).size > 1024, true, 'lib/client.js 不应为空壳')
})

test('package.json：清单标题/描述非空（市场列表直接展示它们）', () => {
  assert.equal(typeof manifest.name, 'string')
  assert.ok(manifest.name.length > 0)
  assert.ok(String(manifest.description ?? '').length > 20)
  assert.equal(manifest.private, undefined, 'private:true 会让发布工具拒绝打包，必须去掉')
})
