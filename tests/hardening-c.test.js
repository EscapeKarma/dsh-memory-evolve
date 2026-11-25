/**
 * tests/hardening-c.test.js — 0.6.1 硬化批次（巡检 A1–A7 + B1③ + B2 + B3）。
 *
 * 这一批的共同点：都是「边界没校验」的清单一角，单条看都不大，但每一条都能
 * 被一次真实的误操作或一次提示注入触发。测试按「行为」而不是「实现」写——
 * 断言的是"这条路径必须被拒/必须跟着有效目录走"，不是"某行代码存在"。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ArchiveStore, MemoryStore, SuggestionQueue } from '../lib/store.js'
import { installApi } from '../lib/api.js'
import { TodoStore } from '../lib/todo.js'
import { AliasStore } from '../lib/aliases.js'
import { checkAttachmentPaths } from '../lib/notify.js'
import { workerEnv } from '../lib/sync/env.js'
import { setLocale } from '../lib/i18n.js'

setLocale('zh')

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const cleanups = []
function tempDir(prefix = 'dsh-hardening-c-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
test.after(() => { for (const fn of cleanups) fn() })

// ───────────────────────── B1③：附件路径拒绝表 + 白名单根 ─────────────────────────
test('B1③：敏感路径的文件不能被发出去（串匹配层）', () => {
  for (const denied of ['/home/u/.ssh/id_rsa', '/home/u/.aws/credentials', '/home/u/proj/.env']) {
    const result = checkAttachmentPaths([{ kind: 'file', path: denied }])
    assert.equal(result.ok, false, `${denied} 应被拒绝`)
    assert.match(result.error, /拒绝发送/)
  }
})

test('B1③：普通文件与图片可以发（默认不限制目录）', () => {
  const gone = join(tempDir(), 'report.txt')
  assert.equal(checkAttachmentPaths([{ kind: 'file', path: gone }]).ok, true)
  // 本会话图片引用（sessionImage/attachmentId）没有 path，不参与判定
  assert.equal(checkAttachmentPaths([{ kind: 'image', sessionImage: true }]).ok, true)
})

test('B1③：配置了 channelSendRoots 后，只允许该目录下的文件', () => {
  const root = tempDir('dsh-hardening-roots-')
  const inside = join(root, 'report.md')
  writeFileSync(inside, 'x')
  const outside = join(tempDir(), 'other.md')
  writeFileSync(outside, 'x')
  assert.equal(checkAttachmentPaths([{ kind: 'file', path: inside }], [root]).ok, true)
  const blocked = checkAttachmentPaths([{ kind: 'file', path: outside }], [root])
  assert.equal(blocked.ok, false)
  assert.match(blocked.error, /不在允许发送的目录内/)
})

test('B1③：符号链接指向敏感目录时按真实路径拒绝', (t) => {
  const dir = tempDir('dsh-hardening-link-')
  const secretDir = join(dir, '.ssh')
  mkdirSync(secretDir, { recursive: true })
  writeFileSync(join(secretDir, 'id_rsa'), 'PRIVATE')
  const link = join(dir, 'innocent.txt')
  try {
    // Windows 上建符号链接需要开发者模式/管理员权限：建不出来就跳过
    // （真实用户环境同理，这种链接通常由恶意程序创建，不属于常规路径）。
    symlinkSync(join(secretDir, 'id_rsa'), link, 'file')
  } catch {
    t.skip('当前环境不允许创建符号链接')
    return
  }
  const result = checkAttachmentPaths([{ kind: 'file', path: link }])
  assert.equal(result.ok, false)
  assert.match(result.error, /真实路径含敏感目录片段/)
})

// ───────────────────────── B2：git 子进程环境白名单 ─────────────────────────
test('B2：git 子进程拿不到模型与 CI 凭据，但拿得到 git 需要的键', () => {
  const env = workerEnv({
    PATH: '/usr/bin',
    HOME: '/home/u',
    GIT_SSH_COMMAND: 'ssh -i key',
    LC_ALL: 'C',
    HTTPS_PROXY: 'http://proxy:8080',
    OPENAI_API_KEY: 'sk-secret',
    ANTHROPIC_API_KEY: 'sk-ant',
    GH_TOKEN: 'ghp_secret',
    GITHUB_TOKEN: 'ghp_secret',
    DSH_TOKEN: 'dsh-secret',
    MY_COMPANY_SECRET: 'nope',
  })
  assert.equal(env.OPENAI_API_KEY, undefined)
  assert.equal(env.ANTHROPIC_API_KEY, undefined)
  assert.equal(env.GH_TOKEN, undefined)
  assert.equal(env.GITHUB_TOKEN, undefined)
  assert.equal(env.DSH_TOKEN, undefined)
  assert.equal(env.MY_COMPANY_SECRET, undefined)
  assert.equal(env.PATH, '/usr/bin')
  assert.equal(env.HOME, '/home/u')
  assert.equal(env.GIT_SSH_COMMAND, 'ssh -i key')
  assert.equal(env.LC_ALL, 'C')
  assert.equal(env.HTTPS_PROXY, 'http://proxy:8080')
})

test('B2：worker 与 runGit 都走白名单（源码契约）', () => {
  assert.match(read('lib/sync/index.js'), /workerEnv\(process\.env\)/)
  assert.match(read('lib/sync/repo.js'), /workerEnv\(process\.env\)/)
  // 不允许回退到「全量继承」的写法
  assert.doesNotMatch(read('lib/sync/repo.js'), /\{ \.\.\.process\.env,/u)
})

// ───────────────────────── A5：别名折叠空白 ─────────────────────────
test('A5：别名里的换行被折叠（否则能伪造快照新段）', () => {
  const dir = tempDir('dsh-hardening-alias-')
  const store = new AliasStore(dir)
  const result = store.set('session-1', 'a\n## b')
  assert.equal(result.ok, true)
  const alias = store.get('session-1')
  assert.doesNotMatch(alias, /\n/)
  assert.equal(alias, 'a ## b')
})

// ───────────────────────── A3：待办 date 参数校验 ─────────────────────────
async function bootApi() {
  const dir = tempDir('dsh-hardening-api-')
  const store = new MemoryStore(dir)
  const archive = new ArchiveStore(dir)
  const queue = new SuggestionQueue(join(dir, 'SUGGESTIONS.jsonl'))
  const todoStore = new TodoStore(dir)
  const state = { todoEnabled: true, reviewEnabled: false }
  const getRuntime = () => ({ ...state })
  const updateRuntime = (patch) => { Object.assign(state, patch); return { ...state } }
  const ctx = {
    webServer: {
      register: ({ handler }) => { ctx.handler = handler; return () => {} },
    },
  }
  installApi(ctx, {
    store, archive, queue, todoStore, getRuntime, updateRuntime,
    config: { memoryDir: dir },
    resolveCwd: () => undefined,
  })
  const server = createServer((req, res) => ctx.handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    get: (path) => fetch(base + path),
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

test('A3：date 只接受 YYYY-MM-DD，路径穿越被挡下', async () => {
  const api = await bootApi()
  try {
    const ok = await api.get('/memory-evolve/api/todo?date=2026-11-26&all=1')
    assert.equal(ok.status, 200)
    for (const bad of ['../../etc/passwd', '2026-11-26/../x', 'today', '20261126']) {
      const res = await api.get(`/memory-evolve/api/todo?date=${encodeURIComponent(bad)}`)
      assert.equal(res.status, 400, `date=${bad} 应被拒`)
    }
  } finally {
    await api.close()
  }
})

// ───────────────────────── A7 / A6 / A1 / A2：源码契约 ─────────────────────────
test('A7：写操作有防重、列表有令牌（前端源码 + 产物）', () => {
  const prompt = read('src/client/PromptView.tsx')
  assert.match(prompt, /if \(busy\) return/)
  assert.match(prompt, /finally \{\n\s+setBusy\(false\)/)
  const broadcast = read('src/client/BroadcastView.tsx')
  assert.match(broadcast, /if \(busy\) return/)
  for (const file of ['src/client/MemoryTabView.tsx', 'src/client/TodoView.tsx']) {
    const code = read(file)
    assert.match(code, /const loadSeq = useRef\(0\)/, `${file} 需要过期响应令牌`)
    assert.match(code, /token !== loadSeq\.current/)
  }
  const bundle = read('lib/client.js')
  assert.match(bundle, /loadSeq|__loadSeq/) // 构建产物必须同步（防忘重建）
})

test('A6：模型表格保存失败会显示提示（而不是静默）', () => {
  assert.match(read('src/client/ModelsTabView.tsx'), /modelsTab\.saveFailed/)
  assert.match(read('src/client/index.ts'), /'modelsTab\.saveFailed'/)
})

test('A1：分支名里的 ] 换行会被拒绝（否则条目被拆坏）', () => {
  const code = read('lib/index.js')
  assert.match(code, /msg\.branchInvalid/)
  assert.match(read('lib/i18n.js'), /'msg\.branchInvalid'/)
})

test('A2：rg 列表模式用 -- 终结选项解析', () => {
  assert.match(read('lib/search-docs.js'), /args\.push\('--', \.\.\.existingRoots\)/)
})
