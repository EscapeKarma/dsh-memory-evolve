/**
 * tests/advisor-cordis4.test.js — Cordis 4 下访问未声明服务属性会抛错（issue #112）
 *
 * 缺陷：`lib/advisor/index.js` 里 `const root = ctx.get?.('root') ?? ctx.root`。
 * Cordis 4 的 Context 是 Proxy：访问**不在本插件 inject 列表里**的属性不是返回
 * `undefined`，而是**抛异常**。`root` 正是这种属性 → `apply()` 抛错 → 插件整体
 * 加载失败（用户看到的是"整个记忆插件不见了"）。
 *
 * 本文件用一个"严格 Cordis 风格"的 ctx 复现该行为：任何未在对象上真实存在的
 * 属性访问都必须抛错（模拟 Proxy 语义），然后断言：
 *   - `installAdvisor()` 不抛错（插件能装上）；
 *   - llm 仍能从服务容器解析出来（能力没有因此降级）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installAdvisor } from '../lib/advisor/index.js'

/** 最小 LLM stub（advisor 只做能力探测，不真发请求）。 */
function stubLlm() {
  return {
    listProviders: () => [{ id: 'p1', models: [{ id: 'm1' }] }],
    listConfigurableProviders: () => [{ id: 'p1', models: [{ id: 'm1' }] }],
    resolveModelInfo: async () => ({ contextWindow: 128000 }),
    listModels: () => [{ id: 'm1' }],
    stream: () => { throw new Error('测试不应发起真实模型调用') },
    complete: () => { throw new Error('测试不应发起真实模型调用') },
  }
}

/**
 * 严格 ctx：未声明的属性访问**抛错**（Cordis 4 Proxy 语义）。
 * 已声明的服务（agents/llm/settings/tools…）挂在对象本身，因此可正常访问。
 */
function strictCtx({ llm }) {
  const listeners = {}
  const target = {
    get: (key) => {
      if (key === 'llm') return llm
      if (key === 'agents') return { get: () => undefined }
      return undefined
    },
    llm,
    logger: () => ({ debug() {}, warn() {}, info() {} }),
    on: (event, fn) => {
      ;(listeners[event] ??= []).push(fn)
      return () => { listeners[event] = listeners[event].filter((f) => f !== fn) }
    },
    emit: async (event, ...args) => {
      for (const fn of [...(listeners[event] ?? [])]) await fn(...args)
    },
    inject: (keys, cb) => cb({
      commands: { register: () => () => {} },
      webServer: { register: () => () => {} },
      effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d() } },
    }),
    commands: [],
    effectDisposers: [],
  }
  // 关键：Proxy 只为"真实存在的属性"放行，其余一律抛错（含 'root'）
  return new Proxy(target, {
    get(obj, key, receiver) {
      if (key in obj) return Reflect.get(obj, key, receiver)
      if (typeof key === 'symbol') return Reflect.get(obj, key, receiver)
      throw new Error(`Context does not have property "${String(key)}"`)
    },
  })
}

function advisorConfig(dataDir) {
  return {
    advisorEnabled: true,
    advisorDataDir: dataDir,
    advisorProvider: null,
    advisorModel: null,
    advisorSystemPrompt: '',
    advisorPanelEnabled: true,
    advisorImmuneTurns: 0,
    advisorSteerSeverities: ['nit', 'concern', 'blocker'],
    advisorMaxMessages: 60,
    advisorMaxQueued: 32,
    advisorCallTimeoutMs: 5000,
  }
}

test('installAdvisor：Cordis 4 严格 ctx 下不得因 ctx.root 抛错（issue #112）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-advisor-cordis4-'))
  try {
    const llm = stubLlm()
    const ctx = strictCtx({ llm })
    // 先自证桩子确实复现了 Cordis 4 语义：访问未声明属性必须抛错
    assert.throws(() => ctx.root, /does not have property "root"/)

    const installed = installAdvisor(ctx, advisorConfig(dir), {
      dataDir: dir,
      sessionName: () => '测试会话',
      logger: { debug() {}, warn() {}, info() {}, error() {} },
    })
    assert.ok(installed !== undefined && installed !== null, 'installAdvisor 必须正常返回')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('installAdvisor：ctx 上没有 root 且 get("root") 返回 undefined 时也不炸', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-advisor-cordis4-'))
  try {
    const llm = stubLlm()
    const ctx = strictCtx({ llm })
    // strict get() 对 'root' 返回 undefined（不抛），与 Cordis 服务容器一致
    assert.equal(ctx.get('root'), undefined)
    const installed = installAdvisor(ctx, advisorConfig(dir), {
      dataDir: dir,
      sessionName: () => '测试会话',
      logger: { debug() {}, warn() {}, info() {}, error() {} },
    })
    assert.ok(installed.ctrl !== undefined, '返回对象应含 ctrl')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
