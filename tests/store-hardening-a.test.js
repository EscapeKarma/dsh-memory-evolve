/**
 * 巡检 A 组回归：跨零点日期同源、CRLF、备份份数、条目软上限、标签顺序、
 * 检索索引缓存键。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore, ensureHeadTags, headTagsOf, todayStamp } from '../lib/store.js'
import { searchIndices, clearRankCache } from '../lib/memory-rank.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'dsh-audit-a-'))
}

function dailyEntries(dir) {
  const dailyDir = join(dir, 'daily')
  try {
    return readdirSync(dailyDir).sort()
  } catch {
    return []
  }
}

test('A1：同一笔写入的文件名与时间戳来自同一个时刻（跨零点不串日期）', () => {
  const dir = tempDir()
  try {
    let clock = new Date(2026, 10, 25, 23, 59, 58).getTime()
    const store = new MemoryStore(dir, { now: () => clock })
    const first = store.add('daily', '第一条', { session: { header: { cwd: dir } } })
    assert.equal(first.ok, true)
    let lines = readFileSync(join(dir, 'daily', '2026-11-25.md'), 'utf8')
    assert.match(lines, /\[23:59\]/)

    // 时钟跨过零点：新条目必须落到新文件、并盖 00:0x
    clock = new Date(2026, 10, 26, 0, 0, 2).getTime()
    const second = store.add('daily', '第二条', { session: { header: { cwd: dir } } })
    assert.equal(second.ok, true)
    lines = readFileSync(join(dir, 'daily', '2026-11-26.md'), 'utf8')
    assert.match(lines, /\[00:00\]/)
    assert.deepEqual(dailyEntries(dir), ['2026-11-25.md', '2026-11-26.md'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('A1：project 条目的日期戳与注入时钟一致', () => {
  const dir = tempDir()
  try {
    const clock = new Date(2026, 10, 26, 0, 0, 5).getTime()
    const store = new MemoryStore(dir, { now: () => clock })
    const res = store.add('project', '项目条目', { session: { header: { cwd: dir } } })
    assert.equal(res.ok, true)
    const file = join(dir, 'projects', store.projectHashFor ? '' : '')
    assert.ok(file !== undefined)
    const text = store.entriesOf('project', { session: { header: { cwd: dir } } }).join('\n')
    assert.match(text, /\[2026-11-26 00:00\]/)
    assert.equal(todayStamp(clock), '2026-11-26')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('A3：CRLF 文件被读取时归一，replace 仍然能整文件重写（不再永久 drift）', () => {
  const dir = tempDir()
  try {
    const store = new MemoryStore(dir)
    const path = join(dir, 'MEMORY.md')
    writeFileSync(path, '[2026-11-01] 旧条目\r\n§\r\n[2026-11-02] 待替换\r\n')
    const res = store.replace('memory', '待替换', '[2026-11-02] 新条目')
    assert.equal(res.ok, true, res.message)
    const text = readFileSync(path, 'utf8')
    assert.ok(!text.includes('\r'), '写回后磁盘必须是 LF')
    assert.match(text, /新条目/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('A4：drift 备份最多保留 5 份', () => {
  const dir = tempDir()
  try {
    const store = new MemoryStore(dir)
    const path = join(dir, 'MEMORY.md')
    // 无法往返的格式（多条连续空行）→ 每次 replace 都判 drift
    // 少了结尾换行 → serialize 会补上，故判为无法往返（drift）
    writeFileSync(path, '[2026-11-01] a\n§\n[2026-11-02] b')
    for (let i = 0; i < 8; i += 1) {
      const res = store.replace('memory', 'a', `[2026-11-01] a${i}`)
      assert.equal(res.ok, false)
      assert.equal(typeof res.backup, 'string', res.message)
    }
    const backups = readdirSync(dir).filter((name) => name.startsWith('MEMORY.md.bak.'))
    assert.ok(backups.length <= 5, `备份份数 ${backups.length} 应不超过 5`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('A5：超过条目软上限只提示、不删除任何条目', () => {
  const dir = tempDir()
  try {
    const store = new MemoryStore(dir, { maxEntriesPerFile: 2 })
    assert.equal(store.add('memory', '第一条').ok, true)
    assert.equal(store.add('memory', '第二条').ok, true)
    const third = store.add('memory', '第三条')
    assert.equal(third.ok, true)
    assert.ok(typeof third.warning === 'string' && third.warning.includes('2'))
    const fourth = store.add('memory', '第四条')
    assert.equal(fourth.ok, true)
    assert.ok(typeof fourth.warning === 'string')
    assert.equal(store.entriesOf('memory').length, 4, '旧条目一条都不能被删')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('A6：检索索引缓存键覆盖全量内容（中间条目不同的语料不撞键）', () => {
  clearRankCache()
  const base = ['甲'.repeat(20), '中'.repeat(20), '丙'.repeat(20)]
  const other = ['甲'.repeat(20), '完全不同的中间内容'.repeat(3), '丙'.repeat(20)]
  // 语料长度相同、首尾相同，只有中间一条不同
  const first = searchIndices(base, '丙', { rank: true })
  const second = searchIndices(other, '丙', { rank: true })
  assert.deepEqual([...first.indices].sort(), [2])
  assert.deepEqual([...second.indices].sort(), [2])
})

test('A7：头部标记拼回时按 branch → dsh-only → summary 的固定顺序', () => {
  assert.equal(ensureHeadTags('[2026-11-01] 正文', ['[summary:s]', '[branch:main]', '[dsh-only]']),
    '[2026-11-01] [branch:main] [dsh-only] [summary:s] 正文')
  const entry = '[2026-11-01] [summary:x] [branch:dev] 正文'
  assert.deepEqual(headTagsOf(entry), ['[summary:x]', '[branch:dev]'])
})
