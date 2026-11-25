/**
 * issue #109 回归：`memory:snapshot` 段必须对「会话标题何时落盘」不敏感。
 *
 * DSH 的会话标题是异步提交的（首条用户消息后 1–5ms 才落 `session/title`），
 * 必然晚于第一个 preStep 的快照组装。而宿主的 runtime-context 只在「段数组不等」
 * 时整包重发（complete snapshot），所以把标题放进快照段 = 每个会话固定多一次
 * 6–8KB 的 runtime-context 注入（LLM 标题再替换 fallback 时两次）。
 *
 * 判据钉死为：同一会话、其余状态不变，只有标题变化时 renderSnapshot 输出必须相等。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderSnapshot, resolveConfig } from '../lib/index.js'
import { setLocale } from '../lib/i18n.js'

setLocale('zh')

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-snapshot-stability-'))
  return dir
}

const counter = { turnsOf: () => 0 }

/** 标题服务桩：`null` = 标题还没落盘（首个 preStep），字符串 = 已落盘。 */
function titleService(title) {
  return { get: () => (title === null ? undefined : { title }) }
}

test('issue #109：只有会话标题从无到有，快照输出必须逐字节相等（默认不注入标题）', () => {
  const dir = tempDir()
  try {
    const config = resolveConfig({ memoryDir: dir, reviewEnabled: false })
    const agent = { id: 'a1', session: { id: 'session-1', header: { cwd: dir } } }
    const before = renderSnapshot(config, { entriesOf: () => [] }, agent, counter, titleService(null))
    const after = renderSnapshot(config, { entriesOf: () => [] }, agent, counter, titleService('排查快照抖动'))
    assert.equal(
      after,
      before,
      '标题晚到不得改变快照（否则每个会话都会多一次整包 runtime-context 注入）',
    )
    assert.ok(!after.includes('排查快照抖动'), '默认形态下标题不得出现在快照里')
    assert.ok(after.includes('session-1'), '会话 ID 仍要注入（模型用它定位自己）')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('issue #109：别名来自 aliases.json，手动设置、稳定，默认仍然注入', async () => {
  const dir = tempDir()
  try {
    const config = resolveConfig({ memoryDir: dir, reviewEnabled: false })
    const { AliasStore } = await import('../lib/aliases.js')
    new AliasStore(dir).set('session-2', '小张')
    const agent = { id: 'a2', session: { id: 'session-2', header: { cwd: dir } } }
    const snap = renderSnapshot(config, { entriesOf: () => [] }, agent, counter, titleService('任何标题'))
    assert.ok(snap.includes('小张'), '别名必须注入')
    assert.ok(!snap.includes('任何标题'), '标题仍然不注入')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('issue #109：显式打开 snapshotSessionName 才注入标题（接受每个会话的一次成本）', () => {
  const dir = tempDir()
  try {
    const config = resolveConfig({ memoryDir: dir, reviewEnabled: false, snapshotSessionName: true })
    const agent = { id: 'a3', session: { id: 'session-3', header: { cwd: dir } } }
    const before = renderSnapshot(config, { entriesOf: () => [] }, agent, counter, titleService(null))
    const after = renderSnapshot(config, { entriesOf: () => [] }, agent, counter, titleService('显式开启'))
    assert.ok(after.includes('显式开启'), '开关打开后标题要出现')
    assert.notEqual(after, before, '这一形态会抖一次：这是文档化的取舍，不是回归')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('issue #109：标题服务抛错不影响快照（默认路径根本不读它）', () => {
  const dir = tempDir()
  try {
    const config = resolveConfig({ memoryDir: dir, reviewEnabled: false })
    const agent = { id: 'a4', session: { id: 'session-4', header: { cwd: dir } } }
    const boom = { get: () => { throw new Error('sessionTitle 服务挂了') } }
    const snap = renderSnapshot(config, { entriesOf: () => [] }, agent, counter, boom)
    assert.ok(snap.includes('session-4'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
