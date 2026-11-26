/**
 * 静态护栏（上游 issue #89）：
 *
 * DSH 客户端用 `<style>` 上的 `data-plugin` 维护样式归属账本 —— 物化插件时
 * 所有「没有 data-plugin」的标签都会被认领走，插件重载时再被删掉。因此本插件
 * 每处运行时 `<style>` 注入都必须：
 *
 * 1. 新标签立刻打归属（`claimStyleOwnership(tag)`）；
 * 2. 守卫分支命中已存在的标签时，把归属抢回来（修复历史误认领）。
 *
 * 这里不启动浏览器，只扫源码与构建产物，防止以后新增注入点又漏打。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const SOURCES = ['src/client/index.ts', 'src/client/canvas-grok/index.ts']

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1
}

test('样式归属：每处 createElement("style") 之后都紧跟 claimStyleOwnership(tag)', () => {
  for (const rel of SOURCES) {
    const src = read(rel)
    const created = count(src, "document.createElement('style')")
    const claimed = count(src, 'claimStyleOwnership(tag)')
    assert.ok(created > 0, `${rel} 应当至少注入一处样式`)
    assert.equal(claimed, created, `${rel}: ${created} 处注入只打了 ${claimed} 处归属`)
  }
})

test('样式归属：守卫分支命中已存在标签时抢回归属', () => {
  for (const rel of SOURCES) {
    const src = read(rel)
    const guards = count(src, "if (existing !== null)")
    const claims = count(src, 'claimStyleOwnership(existing)')
    assert.ok(guards > 0, `${rel} 应当有注入守卫`)
    assert.equal(claims, guards, `${rel}: ${guards} 处守卫只有 ${claims} 处抢回归属`)
  }
})

test('样式归属：归属键是包名（v0.7.0 起为 scoped 名），旧键在重新注入时迁回', () => {
  const src = read('src/client/style-tag.ts')
  const pkg = JSON.parse(read('package.json'))
  assert.ok(
    src.includes(`export const STYLE_OWNER = '${pkg.name}'`),
    `归属键必须等于包名（当前 ${pkg.name}）`,
  )
  assert.match(src, /LEGACY_OWNERS[^\n]*'dsh-memory-evolve'/, '旧键必须留在 LEGACY_OWNERS 里以便迁回')
  assert.match(src, /ownedByUs\(/, '归属判断必须走 ownedByUs（兼容旧键）')
})

test('样式归属：构建产物同样带归属（源码改了必须重建 bundle）', () => {
  const bundle = read('lib/client.js')
  assert.ok(bundle.includes('data-plugin'), '客户端产物里应出现 data-plugin 归属逻辑')
  const created = count(bundle, 'createElement("style")')
  assert.ok(created > 0, '产物里应能数到样式注入点')
  const owners = count(bundle, 'dsh-memory-evolve')
  assert.ok(owners >= created, `产物里注入点 ${created} 处，归属标记只出现 ${owners} 次（可能忘了 node scripts/build.mjs）`)
})
