/**
 * dsh-memory-evolve — 发布版本只读检查测试（lib/release-check.js）。
 *
 * 这个模块存在的唯一理由：包安装（没有 .git）的用户也要知道「有没有新版」。
 * 因此测试重点不是解析细节，而是四条安全边界：
 *   1. 只读——除 GET 之外没有任何副作用（不下载、不写 node_modules）；
 *   2. 缓存——24h 内不重复请求，force 才重查；
 *   3. 失败可降级——断网/限流不能让「有新版本」的提示消失，更不能抛错；
 *   4. 版本比较可靠——`v0.10.0` 必须大于 `v0.9.0`（字符串序会判反）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReleaseChecker, fetchLatestRelease, RELEASE_TTL_MS } from '../lib/release-check.js'

/** 假 fetch：按 URL 片段给出预设响应，并记录请求。 */
function fakeFetch(routes) {
  const calls = []
  const impl = async (url) => {
    calls.push(String(url))
    for (const [needle, res] of routes) {
      if (String(url).includes(needle)) {
        if (res instanceof Error) throw res
        return { status: res.status ?? 200, json: async () => res.body }
      }
    }
    throw new Error(`unexpected url: ${url}`)
  }
  return { impl, calls }
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'dsh-release-check-'))
}

test('releases/latest 返回 200：解析 tag 并判断有新版', async () => {
  const dir = tempDir()
  try {
    const { impl } = fakeFetch([[
      '/releases/latest',
      { status: 200, body: { tag_name: 'v0.4.0', html_url: 'https://github.com/x/y/releases/tag/v0.4.0', published_at: '2026-12-01T00:00:00Z' } },
    ]])
    const checker = createReleaseChecker({ currentVersion: '0.3.0', stateDir: dir, fetchImpl: impl })
    const st = await checker.status()
    assert.equal(st.current, '0.3.0')
    assert.equal(st.latest, 'v0.4.0')
    assert.equal(st.hasUpdate, true)
    assert.equal(st.url, 'https://github.com/x/y/releases/tag/v0.4.0')
    assert.equal(st.error, null)
    assert.ok(typeof st.checkedAt === 'number')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('本机已是最新（或更新）时不提示', async () => {
  const dir = tempDir()
  try {
    const { impl } = fakeFetch([['/releases/latest', { status: 200, body: { tag_name: 'v0.3.0' } }]])
    const same = await createReleaseChecker({ currentVersion: '0.3.0', stateDir: dir, fetchImpl: impl }).status()
    assert.equal(same.hasUpdate, false)
    const behind = await createReleaseChecker({ currentVersion: '0.5.0', stateDir: join(dir, 'b'), fetchImpl: impl }).status()
    assert.equal(behind.hasUpdate, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('只有 tag 没有 Release（404）：退回 tags 并取版本最大者，不是名字最大者', async () => {
  const dir = tempDir()
  try {
    const { impl } = fakeFetch([
      ['/releases/latest', { status: 404, body: { message: 'Not Found' } }],
      ['/tags?per_page=100', { status: 200, body: [{ name: 'v0.9.0' }, { name: 'v0.10.0' }, { name: 'v26092801' }] }],
    ])
    const checker = createReleaseChecker({ currentVersion: '0.9.0', stateDir: dir, fetchImpl: impl })
    const st = await checker.status()
    assert.equal(st.latest, 'v0.10.0', 'v0.10.0 应大于 v0.9.0；日期制 tag v26092801 必须被过滤')
    assert.equal(st.hasUpdate, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('24h 缓存：第二次不请求网络，force 才重查', async () => {
  const dir = tempDir()
  try {
    const { impl, calls } = fakeFetch([['/releases/latest', { status: 200, body: { tag_name: 'v0.4.0' } }]])
    const checker = createReleaseChecker({ currentVersion: '0.3.0', stateDir: dir, fetchImpl: impl })
    await checker.status()
    await checker.status()
    assert.equal(calls.length, 1, 'TTL 内不应重复请求')
    await checker.status(true)
    assert.equal(calls.length, 2, 'force 必须绕过缓存')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('缓存过期后会重新请求（假时钟）', async () => {
  const dir = tempDir()
  try {
    const { impl, calls } = fakeFetch([['/releases/latest', { status: 200, body: { tag_name: 'v0.4.0' } }]])
    let clock = 1_000_000
    const checker = createReleaseChecker({ currentVersion: '0.3.0', stateDir: dir, fetchImpl: impl, now: () => clock })
    await checker.status()
    clock += RELEASE_TTL_MS - 1
    await checker.status()
    assert.equal(calls.length, 1)
    clock += 2
    await checker.status()
    assert.equal(calls.length, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('断网/超时：不抛错，且沿用上次已知的最新版本', async () => {
  const dir = tempDir()
  try {
    const ok = fakeFetch([['/releases/latest', { status: 200, body: { tag_name: 'v0.4.0' } }]])
    const first = await createReleaseChecker({ currentVersion: '0.3.0', stateDir: dir, fetchImpl: ok.impl }).status()
    assert.equal(first.hasUpdate, true)

    const boom = fakeFetch([['/releases/latest', Object.assign(new Error('getaddrinfo ENOTFOUND'), { name: 'TypeError' })]])
    const offline = await createReleaseChecker({ currentVersion: '0.3.0', stateDir: dir, fetchImpl: boom.impl }).status(true)
    assert.equal(offline.hasUpdate, true, '网络失败不能让「有新版本」消失')
    assert.equal(offline.latest, 'v0.4.0')
    assert.equal(offline.error?.kind, 'network')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('限流 403：给出 http 错误，但不写坏缓存', async () => {
  const dir = tempDir()
  try {
    const { impl } = fakeFetch([['/releases/latest', { status: 403, body: { message: 'rate limit' } }]])
    const checker = createReleaseChecker({ currentVersion: '0.3.0', stateDir: dir, fetchImpl: impl })
    const st = await checker.status()
    assert.equal(st.error?.kind, 'http')
    assert.equal(st.latest, null)
    assert.equal(st.hasUpdate, false)
    // 失败不该写缓存（更不该写「最新版本 = null」这种毒化结果）。
    let raw = null
    try { raw = JSON.parse(readFileSync(join(dir, 'release-state.json'), 'utf8').toString()) } catch { raw = null }
    assert.equal(raw === null || !Object.hasOwn(raw, 'latest'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('fetchLatestRelease：运行时没有 fetch 时安全返回', async () => {
  const res = await fetchLatestRelease({ fetchImpl: null })
  assert.equal(res.ok, false)
  assert.equal(res.error?.kind, 'no-fetch')
})

test('请求只发一次 GET，且带 User-Agent（GitHub 要求）', async () => {
  const dir = tempDir()
  try {
    const seen = []
    const impl = async (url, init) => {
      seen.push({ url: String(url), headers: init?.headers ?? {} })
      return { status: 200, json: async () => ({ tag_name: 'v0.4.0' }) }
    }
    const checker = createReleaseChecker({ currentVersion: '0.3.0', stateDir: dir, fetchImpl: impl })
    await checker.status()
    assert.equal(seen.length, 1)
    assert.ok(seen[0].url.startsWith('https://api.github.com/repos/EscapeKarma/dsh-memory-evolve/releases/latest'))
    assert.ok(String(seen[0].headers['user-agent'] ?? '').length > 0)
    // 不传 token：请求头里不应出现授权信息。
    assert.equal(Object.hasOwn(seen[0].headers, 'authorization'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
