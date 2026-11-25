/**
 * issue #103 回归：project / daily 轨的**可选**注入。
 *
 * 这两条轨道的内容每次写入都会变，注入进快照就会让宿主每次追加一条
 * runtime-context 尾消息，废掉 prefix cache——所以默认必须 off，且 off 时
 * 渲染结果与改动前逐字节一致（与 tests/snapshot-stability.test.js 同源判据）。
 *
 * 打开后按 `tail:N`（只注入最近 N 条）或 `always`（全量）注入；开关写错时
 * 一律按 off 处理（宁可不注入，也不能让快照渲染崩掉）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseInjectMode, renderSnapshot, resolveConfig, validateRuntimePatch } from '../lib/index.js'
import { setLocale } from '../lib/i18n.js'

setLocale('zh')

const counter = { turnsOf: () => 0 }

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'dsh-snapshot-inject-'))
}

/** 假 store：按轨道返回预置条目。 */
function storeOf({ project = [], daily = [] } = {}) {
  return {
    entriesOf(target) {
      if (target === 'project') return project
      if (target === 'daily') return daily
      return []
    },
  }
}

const PROJECT = [
  '[id:a1b2c3d4] [2026-11-24 10:00] 第一天：搭好仓库',
  '[id:b2c3d4e5] [2026-11-25 09:00] 第二天：修 A 类 bug',
  '[id:c3d4e5f6] [2026-11-25 18:00] 第三天：合入社区 PR',
]
const DAILY = [
  '[09:00] [DSH2] 读代码',
  '[18:00] [DSH2] 写测试',
]

function agentWith(cwd) {
  return { id: 'a1', session: { id: 'session-inject', header: { cwd } } }
}

test('issue #103：默认 off——project / daily 有条目也不进快照，输出与不带条目的旧形态一致', () => {
  const dir = tempDir()
  try {
    const config = resolveConfig({ memoryDir: dir, reviewEnabled: false })
    const agent = agentWith(dir)
    const withEntries = renderSnapshot(config, storeOf({ project: PROJECT, daily: DAILY }), agent, counter)
    const withoutEntries = renderSnapshot(config, storeOf(), agent, counter)
    assert.equal(config.projectInjectMode, 'off')
    assert.equal(config.dailyInjectMode, 'off')
    assert.equal(withEntries, withoutEntries, 'off 时必须逐字节一致（否则 prefix cache 白费）')
    assert.ok(!withEntries.includes('搭好仓库'), '默认不得注入项目日志正文')
    assert.ok(!withEntries.includes('写测试'), '默认不得注入当日日志正文')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('issue #103：tail:2 只注入最近两条，且保持旧 → 新顺序、剥掉身份证', () => {
  const dir = tempDir()
  try {
    const config = resolveConfig({ memoryDir: dir, reviewEnabled: false, projectInjectMode: 'tail:2' })
    const snap = renderSnapshot(config, storeOf({ project: PROJECT, daily: DAILY }), agentWith(dir), counter)
    assert.ok(snap.includes('修 A 类 bug'), '倒数第二条必须在')
    assert.ok(snap.includes('合入社区 PR'), '最后一条必须在')
    assert.ok(!snap.includes('搭好仓库'), '超出 tail:N 的旧条目不得注入')
    assert.ok(snap.indexOf('修 A 类 bug') < snap.indexOf('合入社区 PR'), '顺序必须是旧 → 新')
    assert.ok(!snap.includes('[id:b2c3d4e5]'), '注入行要剥掉身份证（程序元数据不进上下文）')
    assert.ok(!snap.includes('写测试'), 'daily 未打开时不得注入 daily 正文')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('issue #103：always 注入全部条目；daily 与 project 各自独立开关', () => {
  const dir = tempDir()
  try {
    const projectOnly = resolveConfig({ memoryDir: dir, reviewEnabled: false, projectInjectMode: 'always' })
    const snapA = renderSnapshot(projectOnly, storeOf({ project: PROJECT, daily: DAILY }), agentWith(dir), counter)
    for (const text of ['搭好仓库', '修 A 类 bug', '合入社区 PR']) assert.ok(snapA.includes(text), `${text} 必须注入`)
    assert.ok(!snapA.includes('读代码'), 'daily 仍应是 off')

    const dailyOnly = resolveConfig({ memoryDir: dir, reviewEnabled: false, dailyInjectMode: 'always' })
    const snapB = renderSnapshot(dailyOnly, storeOf({ project: PROJECT, daily: DAILY }), agentWith(dir), counter)
    assert.ok(snapB.includes('读代码') && snapB.includes('写测试'), 'daily 全量注入')
    assert.ok(!snapB.includes('搭好仓库'), 'project 仍应是 off')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('issue #103：开关值写错时按 off 处理；没有会话 cwd 时不注入 project', () => {
  const dir = tempDir()
  try {
    for (const bad of ['tail:0', 'junk', '', 'tail:', 'tail:-2', null]) {
      assert.equal(parseInjectMode(bad).kind, 'off', `${String(bad)} 必须回落 off`)
    }
    const config = resolveConfig({ memoryDir: dir, reviewEnabled: false, projectInjectMode: 'tail:0', dailyInjectMode: 'junk' })
    const agent = agentWith(dir)
    assert.equal(
      renderSnapshot(config, storeOf({ project: PROJECT, daily: DAILY }), agent, counter),
      renderSnapshot(config, storeOf(), agent, counter),
      '非法开关不得改变渲染结果',
    )

    const projectOn = resolveConfig({ memoryDir: dir, reviewEnabled: false, projectInjectMode: 'always' })
    const headless = { id: 'a2', session: { id: 'session-sub', header: {} } }
    const snap = renderSnapshot(projectOn, storeOf({ project: PROJECT }), headless, counter)
    assert.ok(!snap.includes('搭好仓库'), '无 cwd（如部分子代理）时 project 轨无桶可读，不注入')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('issue #103：运行时改这两个键要通过校验，非法值必须被拒', () => {
  for (const key of ['projectInjectMode', 'dailyInjectMode']) {
    for (const ok of ['off', 'tail:1', 'tail:20', 'always', 'OFF', ' Always ']) {
      assert.doesNotThrow(() => validateRuntimePatch(key, ok), `${key}=${ok} 应通过`)
    }
    for (const bad of ['tail:0', 'tail:-1', 'always!', '', 3, null, undefined]) {
      assert.throws(() => validateRuntimePatch(key, bad), /tail:N/, `${key}=${String(bad)} 应被拒`)
    }
  }
})
