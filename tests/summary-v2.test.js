/**
 * 渐进式披露 v2（issue #66 的 A 块）：摘要扩三轨 + 120 上限 + 按条目长度折叠 + retag。
 *
 * 我们的取舍（与上游原提交的差异，写在测试里钉住）：
 *  1. `summaryMinChars` 默认 **0 = 关闭**（上游默认 400）——默认配置下渲染结果
 *     与升级前逐字节一致，不会悄悄改变任何人的注入内容；
 *  2. 不做 salience / 命中统计 / 衰减（那是 #66 的 B 块，另一个产品语义）；
 *  3. 日志轨（project / daily）不写摘要——每条本身就是一句进展，摘要没有意义。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore, normalizeSummaryText, parseEntrySummary, SUMMARY_MAX_CHARS } from '../lib/store.js'
import { DEFAULTS, renderSnapshot, validateRuntimePatch } from '../lib/index.js'

const dirs = []
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-summary-v2-'))
  dirs.push(dir)
  return dir
}
process.on('exit', () => {
  for (const dir of dirs) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清理失败不影响结论 */ }
  }
})

const agent = (cwd) => ({ session: { id: 'sess-1', header: { cwd } } })

test('normalizeSummaryText：去换行/方括号、折叠空白、截到 120 字', () => {
  assert.equal(normalizeSummaryText('a\nb\tc'), 'a b c')
  // ']' 是标签终止符（会让 [summary:…] 解析提前截断），'[' 无此问题：只清 ']'
  assert.equal(normalizeSummaryText('[x] 摘要'), '[x 摘要')
  assert.equal(normalizeSummaryText('a]b'), 'a b')
  assert.equal(normalizeSummaryText('   spaced   out  '), 'spaced out')
  const long = 'x'.repeat(300)
  assert.equal(normalizeSummaryText(long).length, SUMMARY_MAX_CHARS)
  assert.equal(SUMMARY_MAX_CHARS, 120)
  assert.equal(normalizeSummaryText(null), '')
})

test('memory / user 轨的 add 支持 summary，日志轨忽略它', () => {
  const dir = tempDir()
  const store = new MemoryStore(dir, { entryIdMode: 'off' })
  // 走 store 层写入（工具层 addOne 的 summary 会拼成同样的头部标签）
  store.add('memory', '[summary:全局事实摘要]\n正文第一行', agent(dir))
  store.add('user', '[summary:用户偏好摘要]\n正文', agent(dir))
  store.add('project', '[summary:不该出现]\n日志行', agent(dir))

  const mem = store.entriesOf('memory')[0]
  assert.equal(parseEntrySummary(mem), '全局事实摘要')
  const user = store.entriesOf('user')[0]
  assert.equal(parseEntrySummary(user), '用户偏好摘要')
  const project = store.entriesOf('project', agent(dir))[0]
  // store.add 不做清洗（工具层负责），这里只验证日志轨的正文不会被摘要吃掉
  assert.match(project, /日志行/)
})

test('summaryMinChars = 0（默认）：摘要模式下所有条目都折成摘要行', () => {
  const dir = tempDir()
  const store = new MemoryStore(dir, { entryIdMode: 'off' })
  store.add('memory', '[summary:短摘要]\n很短的一条', agent(dir))
  store.add('memory', '[summary:长摘要]\n' + 'y'.repeat(600), agent(dir))
  const config = { memoryDir: dir, memoryProgressiveDisclosure: 'on', summaryMinChars: 0 }
  const out = renderSnapshot(config, store, agent(dir))
  assert.match(out, /短摘要/)
  assert.match(out, /长摘要/)
  // 正文被折叠：两条长正文都不该出现在摘要模式输出里
  assert.ok(!out.includes('y'.repeat(600)))
})

test('summaryMinChars = 400：短条目保持全文，长条目折成摘要', () => {
  const dir = tempDir()
  const store = new MemoryStore(dir, { entryIdMode: 'off' })
  store.add('memory', '[summary:短摘要]\n很短的一条', agent(dir))
  store.add('memory', '[summary:长摘要]\n' + 'y'.repeat(600), agent(dir))
  const config = { memoryDir: dir, memoryProgressiveDisclosure: 'on', summaryMinChars: 400 }
  const out = renderSnapshot(config, store, agent(dir))
  // 短条目：全文注入（且不再显示 [summary:…] 标签）
  assert.match(out, /很短的一条/)
  assert.ok(!out.includes('[summary:短摘要]'))
  // 长条目：只有摘要行
  assert.match(out, /长摘要/)
  assert.ok(!out.includes('y'.repeat(600)))
})

test('key 轨同样按长度折叠（全量/摘要判定不变）', () => {
  const dir = tempDir()
  const store = new MemoryStore(dir, { entryIdMode: 'off' })
  store.add('key', '[summary:K 摘要]\n短的一条', agent(dir))
  store.add('key', '[summary:长 K 摘要]\n' + 'z'.repeat(600), agent(dir))
  const config = { memoryDir: dir, keyProgressiveDisclosure: 'on', summaryMinChars: 400 }
  const out = renderSnapshot(config, store, agent(dir))
  assert.match(out, /短的一条/)
  assert.match(out, /长 K 摘要/)
  assert.ok(!out.includes('z'.repeat(600)))
})

test('retag：只改头部摘要，正文与身份证逐字节保留；空串删除摘要', () => {
  const dir = tempDir()
  const store = new MemoryStore(dir, { entryIdMode: 'off' })
  store.add('memory', '这是一条需要后续补摘要的正文', agent(dir))
  const before = store.entriesOf('memory')[0]
  assert.equal(parseEntrySummary(before), null)

  const res = store.retag('memory', '需要后续补摘要', '新写的摘要', agent(dir))
  assert.equal(res.ok, true)
  const after = store.entriesOf('memory')[0]
  assert.equal(parseEntrySummary(after), '新写的摘要')
  assert.match(after, /这是一条需要后续补摘要的正文/)

  // 再 tag 一次：替换而不是叠加（同一条目不得出现两个 [summary:…]）
  store.retag('memory', '需要后续补摘要', '改过的摘要', agent(dir))
  const twice = store.entriesOf('memory')[0]
  assert.equal(twice.match(/\[summary:/g).length, 1)
  assert.equal(parseEntrySummary(twice), '改过的摘要')

  // 空串删除
  const cleared = store.retag('memory', '需要后续补摘要', '', agent(dir))
  assert.equal(cleared.ok, true)
  assert.equal(parseEntrySummary(store.entriesOf('memory')[0]), null)
})

test('retag：日志轨拒绝、匹配不唯一拒绝、未命中拒绝', () => {
  const dir = tempDir()
  const store = new MemoryStore(dir, { entryIdMode: 'off' })
  store.add('daily', '日志一', agent(dir))
  const logTrack = store.retag('daily', '日志一', '摘要', agent(dir))
  assert.equal(logTrack.ok, false)

  store.add('memory', '重复片段 A', agent(dir))
  store.add('memory', '重复片段 B', agent(dir))
  const multi = store.retag('memory', '重复片段', '摘要', agent(dir))
  assert.equal(multi.ok, false)

  const missing = store.retag('memory', '不存在的内容', '摘要', agent(dir))
  assert.equal(missing.ok, false)
})

test('配置：summaryMinChars 默认 0，验证器只接受 0–10000 的整数', () => {
  assert.equal(DEFAULTS.summaryMinChars, 0)
  assert.doesNotThrow(() => validateRuntimePatch('summaryMinChars', 0))
  assert.doesNotThrow(() => validateRuntimePatch('summaryMinChars', 400))
  assert.doesNotThrow(() => validateRuntimePatch('summaryMinChars', 10000))
  assert.throws(() => validateRuntimePatch('summaryMinChars', -1), /summaryMinChars/)
  assert.throws(() => validateRuntimePatch('summaryMinChars', 10001), /summaryMinChars/)
  assert.throws(() => validateRuntimePatch('summaryMinChars', 1.5), /summaryMinChars/)
  assert.throws(() => validateRuntimePatch('summaryMinChars', '400'), /summaryMinChars/)
})

test('默认配置渲染结果不含摘要标签（off 模式与旧版一致）', () => {
  const dir = tempDir()
  const store = new MemoryStore(dir, { entryIdMode: 'off' })
  store.add('memory', '[summary:不该显示]\n正文', agent(dir))
  const config = { memoryDir: dir }
  const out = renderSnapshot(config, store, agent(dir))
  assert.ok(!out.includes('[summary:不该显示]'))
  assert.match(out, /正文/)
})
