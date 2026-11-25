/**
 * 刀2（数据一致性）回归用例：条目分隔符校验、replace 保留程序标记、
 * 项目分桶归一化与旧桶兼容、待确认队列的精确判重。
 *
 * 每一条都对应巡检报告 `docs/巡检报告-2026-11-25.md` 里的一条 P1/P2：
 *   1. add / replace 不校验 § → 一条记忆静默拆两条（P1-3）
 *   2. replace 整条替换会丢掉 [branch:] / [dsh-only] / [summary:]（P2）
 *   3. projectHash 用原始 cwd 哈希 → 同一项目两个桶（P1-5）
 *   4. 待确认队列「互相包含」判重 → 新事实被吞（P1-4）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MemoryStore, SuggestionQueue,
  ensureHeadTags, headTagsOf, normalizeProjectCwd, projectDirFor, projectHash,
} from '../lib/store.js'
import { enqueueSuggestion } from '../lib/review.js'

const tempDir = () => mkdtempSync(join(tmpdir(), 'dsh-memory-integrity-'))
const clean = (dir) => rmSync(dir, { recursive: true, force: true })

test('data-integrity: add 拒绝含 § 的内容，文件不会被拆成两条', () => {
  const dir = tempDir()
  try {
    const store = new MemoryStore(dir)
    const result = store.add('memory', '第一条\n§\n第二条')
    assert.equal(result.ok, false)
    assert.match(result.message, /分隔符/)
    assert.equal(store.entriesOf('memory').length, 0)
  } finally {
    clean(dir)
  }
})

test('data-integrity: replace 拒绝含 § 的新内容，旧条目原样保留', () => {
  const dir = tempDir()
  try {
    const store = new MemoryStore(dir)
    store.add('memory', '原始事实')
    const result = store.replace('memory', '原始事实', '新事实\n§\n夹带的一条')
    assert.equal(result.ok, false)
    assert.match(result.message, /分隔符/)
    assert.equal(store.entriesOf('memory').length, 1)
    assert.match(store.entriesOf('memory')[0], /原始事实/)
  } finally {
    clean(dir)
  }
})

test('data-integrity: replace 保留调用方没重写的 [branch:] / [dsh-only] / [summary:] 标记', () => {
  const dir = tempDir()
  try {
    const store = new MemoryStore(dir)
    store.add('memory', '旧的内容')
    // 手工给条目补上程序标记（模拟 GUI 编辑 / 摘要 / 分支归属写下的标记）。
    const file = store.pathOf('memory')
    const text = readFileSync(file, 'utf8')
    writeFileSync(file, text.replace('[', '[branch:main] [dsh-only] [summary:一句话摘要] ['))
    const result = store.replace('memory', '旧的内容', '新的内容')
    assert.equal(result.ok, true)
    const entry = store.entriesOf('memory')[0]
    assert.match(entry, /新的内容/)
    assert.match(entry, /\[branch:main\]/)
    assert.match(entry, /\[dsh-only\]/)
    assert.match(entry, /\[summary:一句话摘要\]/)
  } finally {
    clean(dir)
  }
})

test('data-integrity: headTagsOf / ensureHeadTags 去重且不改已存在的标记', () => {
  assert.deepEqual(headTagsOf('[2026-11-25] [branch:dev] [dsh-only] 正文 [summary:x]'), ['[branch:dev]', '[dsh-only]', '[summary:x]'])
  assert.deepEqual(headTagsOf('没有标记的正文'), [])
  const entry = '[2026-11-25] [branch:main] 正文'
  assert.equal(ensureHeadTags(entry, ['[branch:main]']), entry)
  assert.equal(ensureHeadTags(entry, ['[dsh-only]']), '[2026-11-25] [branch:main] [dsh-only] 正文')
})

test('data-integrity: projectHash 对同一目录的不同写法给同一个桶', () => {
  const variants = ['D:\\repo', 'D:/repo', 'D:/repo/', ' d:/repo ']
  const hashes = new Set(variants.map((cwd) => projectHash(cwd)))
  // 非 Windows 上大小写敏感，' d:/repo ' 归一后仍是 d:/repo（与 D:/repo 不同）。
  const expected = process.platform === 'win32' ? 1 : 2
  assert.equal(hashes.size, expected)
  assert.equal(normalizeProjectCwd('D:\\repo\\'), process.platform === 'win32' ? 'd:/repo' : 'D:/repo')
})

test('data-integrity: 升级前的旧桶（原始 cwd 哈希）仍然被沿用，不产生双桶', () => {
  const dir = tempDir()
  try {
    const cwd = process.platform === 'win32' ? 'D:\\legacy\\proj' : '/legacy/proj'
    const legacyHash = createHash('sha1').update(cwd).digest('hex').slice(0, 12)
    const legacyDir = join(dir, 'projects', legacyHash)
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'MEMORY.md'), '# 项目记忆\n\n[2026-11-25] 旧版本写下的项目事实\n')
    assert.equal(projectDirFor(dir, cwd), legacyDir)
  } finally {
    clean(dir)
  }
})

test('data-integrity: 新项目按归一化哈希建桶（旧桶不存在时不回退）', () => {
  const dir = tempDir()
  try {
    const cwd = '/brand/new/proj'
    const resolved = projectDirFor(dir, cwd)
    assert.equal(resolved, join(dir, 'projects', projectHash(cwd)))
    assert.equal(existsSync(resolved), false)
  } finally {
    clean(dir)
  }
})

test('data-integrity: 待确认队列只对完全相同的内容去重，包含关系不算重复', () => {
  const dir = tempDir()
  try {
    const queue = new SuggestionQueue(join(dir, 'queue.jsonl'))
    const first = enqueueSuggestion(queue, 'memory', '项目用 pnpm', '理由')
    assert.equal(first.ok, true)
    const better = enqueueSuggestion(queue, 'memory', '项目用 pnpm，但必须在 WSL 里跑', '理由')
    assert.equal(better.ok, true, '更完整的新事实不能被短的旧条目吞掉')
    const same = enqueueSuggestion(queue, 'memory', '项目用 pnpm', '理由')
    assert.equal(same.ok, true)
    assert.equal(queue.read().length, 2, '完全相同的内容仍然只留一条')
  } finally {
    clean(dir)
  }
})
