/**
 * 同源校验（2026-11-25 巡检 P0-1）：所有 HTTP 端点都必须拒绝跨站与
 * 非本机访问。
 *
 * 背景：插件用 `kind: 'prefix'` 注册路由，宿主 0.2.2-rc.5 之前没有给插件路由
 * 加认证，于是任何网页都能用 `<form>` 或 `fetch` 直接读写记忆。这一层是插件
 * 自己的防线；测试分两半——纯函数的四层判定、以及真实 HTTP 服务器上的端到端
 * 行为（确保 handler 真的接了 guard，而不是只加了个没人调用的模块）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArchiveStore, MemoryStore, SuggestionQueue } from '../lib/store.js'
import { TodoStore } from '../lib/todo.js'
import { installApi } from '../lib/api.js'
import { guardRequest, hasConnection, hostName, isTrustedHost, setConnection, setTrustedHosts } from '../lib/http-guard.js'
import { validateRuntimePatch } from '../lib/index.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'dsh-memory-csrf-test-'))
}

/** 造一个最小的请求桩（只填 guard 会读的字段）。 */
function req(overrides = {}) {
  return {
    method: 'GET',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
    headers: { host: '127.0.0.1:7777', ...(overrides.headers ?? {}) },
  }
}

test('同源校验：带 Origin 的跨站请求一律拒绝', () => {
  const failure = guardRequest(req({
    method: 'POST',
    headers: {
      host: '127.0.0.1:7777',
      origin: 'http://evil.example',
      'content-type': 'application/json',
      'content-length': '2',
    },
  }))
  assert.equal(failure.code, 'GUARD_CROSS_SITE')
  assert.equal(failure.status, 403)
})

test('同源校验：Origin: null（sandbox iframe / file://）拒绝', () => {
  const failure = guardRequest(req({ headers: { host: '127.0.0.1:7777', origin: 'null' } }))
  assert.equal(failure.code, 'GUARD_ORIGIN_NULL')
})

test('同源校验：浏览器标注 Sec-Fetch-Site: cross-site 直接拒绝', () => {
  const failure = guardRequest(req({ headers: { host: '127.0.0.1:7777', 'sec-fetch-site': 'cross-site' } }))
  assert.equal(failure.code, 'GUARD_CROSS_SITE')
})

test('同源校验：DNS rebinding（Origin 与 Host 都是 evil.com）必须拒绝', () => {
  // 关键用例：只比较 originHost === host 的实现会在这里放行。
  const failure = guardRequest(req({
    method: 'POST',
    headers: {
      host: 'evil.example',
      origin: 'http://evil.example',
      'content-type': 'application/json',
      'content-length': '2',
    },
  }))
  assert.equal(failure.code, 'GUARD_UNTRUSTED_HOST')
})

test('同源校验：trustedHosts 命中时放行（用户显式允许的内网域名）', () => {
  const failure = guardRequest(req({
    method: 'POST',
    headers: {
      host: 'dsh.example.com',
      origin: 'http://dsh.example.com',
      'content-type': 'application/json',
      'content-length': '2',
    },
  }), { trustedHosts: ['dsh.example.com'] })
  assert.equal(failure, null)
})

test('同源校验：写操作带非 JSON 请求体返回 415（拦住跨站表单）', () => {
  const failure = guardRequest(req({
    method: 'POST',
    headers: {
      host: '127.0.0.1:7777',
      origin: 'http://127.0.0.1:7777',
      'content-type': 'text/plain',
      'content-length': '5',
    },
  }))
  assert.equal(failure.code, 'GUARD_CONTENT_TYPE')
  assert.equal(failure.status, 415)
})

test('同源校验：无请求体的 POST（按钮类操作）不需要 content-type', () => {
  const failure = guardRequest(req({
    method: 'POST',
    headers: { host: '127.0.0.1:7777', origin: 'http://127.0.0.1:7777' },
  }))
  assert.equal(failure, null)
})

test('同源校验：本机脚本（无 Origin、回环对端、JSON 体）放行', () => {
  const failure = guardRequest(req({
    method: 'POST',
    headers: { host: '127.0.0.1:7777', 'content-type': 'application/json', 'content-length': '2' },
  }))
  assert.equal(failure, null)
})

test('同源校验：无 Origin 且对端非回环（局域网/内网穿透）拒绝', () => {
  const failure = guardRequest(req({
    method: 'GET',
    headers: { host: '192.168.1.20:7777' },
    socket: { remoteAddress: '192.168.1.50' },
  }))
  assert.equal(failure.code, 'GUARD_REMOTE_PEER')
})

test('同源校验：读端点也要挡（否则跨站可读走全部记忆）', () => {
  const failure = guardRequest(req({
    method: 'GET',
    headers: { host: '127.0.0.1:7777', origin: 'http://evil.example' },
  }))
  assert.equal(failure.code, 'GUARD_CROSS_SITE')
})

test('同源校验：hostName / isTrustedHost 归一（端口、IPv6 方括号、大小写）', () => {
  assert.equal(hostName('LocalHost:58565'), 'localhost')
  assert.equal(hostName('[::1]:58565'), '::1')
  assert.equal(isTrustedHost('127.0.0.1:1'), true)
  assert.equal(isTrustedHost('::1'), true)
  assert.equal(isTrustedHost('evil.example'), false)
  assert.equal(isTrustedHost('dsh.example.com', ['DSH.example.com']), true)
})

/** 起一个真实服务器，把 installApi 的 handler 挂上去。 */
async function bootApi() {
  const dir = tempDir()
  const store = new MemoryStore(dir)
  const archive = new ArchiveStore(dir)
  const queue = new SuggestionQueue(join(dir, 'SUGGESTIONS.jsonl'))
  const todoStore = new TodoStore(dir)
  const state = { reviewEnabled: false, reviewInterval: 10, reviewMode: 'suggest', memoryTabEnabled: true }
  const ctx = {
    webServer: {
      register: ({ handler }) => {
        ctx.handler = handler
        return () => {}
      },
    },
  }
  installApi(ctx, {
    store,
    archive,
    queue,
    todoStore,
    getRuntime: () => ({ ...state }),
    updateRuntime: (patch) => {
      for (const [key, value] of Object.entries(patch)) validateRuntimePatch(key, value)
      Object.assign(state, patch)
      return { ...state }
    },
    resolveRevealTarget: () => undefined,
    revealPath: () => {},
    config: { memoryDir: dir, skillDir: join(dir, 'skills') },
    resolveCwd: () => undefined,
  })
  const server = createServer((request, response) => ctx.handler(request, response))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return { base, server, dir, state, close: () => new Promise((resolve) => server.close(resolve)) }
}

test('端到端：跨站 POST 改配置被拒，且配置未被改动', async () => {
  const app = await bootApi()
  try {
    const res = await fetch(`${app.base}/memory-evolve/api/config`, {
      method: 'POST',
      headers: { origin: 'http://evil.example', 'content-type': 'text/plain' },
      body: JSON.stringify({ reviewInterval: 99 }),
    })
    assert.equal(res.status, 403)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(app.state.reviewInterval, 10)
  } finally {
    await app.close()
    rmSync(app.dir, { recursive: true, force: true })
  }
})

test('端到端：跨站 GET 读别名被拒（读端点同样受保护）', async () => {
  const app = await bootApi()
  try {
    const res = await fetch(`${app.base}/memory-evolve/api/aliases`, {
      headers: { origin: 'http://evil.example' },
    })
    assert.equal(res.status, 403)
  } finally {
    await app.close()
    rmSync(app.dir, { recursive: true, force: true })
  }
})

test('端到端：同源 GET 正常返回，且响应带 JSON', async () => {
  const app = await bootApi()
  try {
    const res = await fetch(`${app.base}/memory-evolve/api/aliases`, {
      headers: { origin: app.base },
    })
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /application\/json/)
    const body = await res.json()
    assert.deepEqual(body.aliases, {})
  } finally {
    await app.close()
    rmSync(app.dir, { recursive: true, force: true })
  }
})

test('端到端：模块级 trustedHosts 生效（setTrustedHosts 后同域可通过）', async () => {
  setTrustedHosts(['lan.example.com'])
  try {
    const failure = guardRequest(req({
      method: 'GET',
      headers: { host: 'lan.example.com', origin: 'http://lan.example.com' },
      socket: {},
    }))
    assert.equal(failure, null)
  } finally {
    setTrustedHosts([])
  }
})

// ---------------------------------------------------------------------------
// 宿主准入层（2026-11-27）：维护者要求插件路由接入 DSH 的 connection 准入，
// 而不是只靠插件自己的同源校验。语义：403 硬拒绝、401（没有浏览器 cookie）
// 回落到本插件的回环校验，旧宿主没有该能力时整层跳过。
// ---------------------------------------------------------------------------

test('宿主准入：requestRejection 返回 403 时一律拒绝（即使是本机同源请求）', () => {
  setConnection({ requestRejection: () => 403 })
  try {
    const failure = guardRequest(req({ headers: { host: '127.0.0.1:7777', origin: 'http://127.0.0.1:7777' } }))
    assert.equal(failure.code, 'GUARD_DSH_ADMISSION')
    assert.equal(failure.status, 403)
  } finally {
    setConnection(null)
  }
})

test('宿主准入：返回 401（无浏览器 cookie）时回落到本机回环校验', () => {
  setConnection({ requestRejection: () => 401 })
  try {
    // 本机脚本（无 Origin、回环对端）继续可用
    assert.equal(guardRequest(req({ method: 'POST', headers: { host: '127.0.0.1:7777' } })), null)
    // 跨站请求仍然被插件自己的同源校验拦住
    const crossSite = guardRequest(req({
      method: 'POST',
      headers: { host: '127.0.0.1:7777', origin: 'http://evil.example', 'content-type': 'application/json', 'content-length': '2' },
    }))
    assert.equal(crossSite.code, 'GUARD_CROSS_SITE')
  } finally {
    setConnection(null)
  }
})

test('宿主准入：宿主不提供能力或调用抛错时整层跳过', () => {
  setConnection({})
  try {
    assert.equal(guardRequest(req({ headers: { host: '127.0.0.1:7777' } })), null)
  } finally {
    setConnection(null)
  }
  setConnection({ requestRejection: () => { throw new Error('boom') } })
  try {
    assert.equal(guardRequest(req({ headers: { host: '127.0.0.1:7777' } })), null)
    assert.equal(hasConnection(), true)
  } finally {
    setConnection(null)
  }
  assert.equal(hasConnection(), false)
})
