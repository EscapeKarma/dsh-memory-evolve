/**
 * issue #86 回归：轮尾星标在 DSH 0.2.x 的新 DOM 里必须仍然注入。
 *
 * 现象：升级 DSH 之后，助手每轮回复下面再也没有星标（书签注入器「消失」）。
 * 根因：0.2.x 把消息操作区（含 Branch 按钮）从 `assistant-step` 消息节点内部
 * 搬到了**独立的 `[data-turn-tail="<turn>"]` 节点**（TurnTailNodeView 渲染
 * `data-turn-tail` + `conversation.chat.assistant-actions` 槽）。注入器原来
 * 只在 assistant-step 节点内找 Branch 按钮 → 恒为 null → 永不注入。
 *
 * 这个文件用「源码 + 构建产物」双侧静态断言把修法钉住（与 client-*.test.js
 * 的既有做法一致，不引 DOM 依赖）：
 *   1. 扫描时先遍历 `[data-turn-tail]`，并按其轮次号找到该轮最后一条
 *      assistant-step 作为锚点（按钮与锚点分头取）；
 *   2. 星标宿主仍挂在 Branch 按钮之后，且幂等（同一 anchorKey 只注入一次）；
 *   3. 宿主被 React 重渲染摘掉后要能重注入（mounted 表按 isConnected 清理）；
 *   4. 旧结构（Branch 仍在消息节点内）继续兼容；
 *   5. 构建产物 lib/client.js 与源码同步（仓库提交产物，漂移即失效）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const SOURCE = 'src/client/bookmark-injector.tsx'
const BUNDLE = 'lib/client.js'

test('issue #86：注入器按 [data-turn-tail] 扫描，并用轮次号反查 assistant-step 锚点', () => {
  const src = read(SOURCE)
  assert.match(src, /querySelectorAll<HTMLElement>\('\[data-turn-tail\]'\)/, '必须扫描独立的轮尾节点')
  assert.match(src, /function turnOfTail\(/, '必须从 data-turn-tail 属性取轮次号')
  assert.match(src, /function lastAssistantAnchor\(/, '必须能按轮次找到该轮最后一条 assistant-step')
  assert.match(src, /enableFork\(branch, anchor\)/, '接管按钮时要传入锚点节点（按钮与锚点已分离）')
  // 星标只能打在「未禁用」的 Branch 按钮上（中间轮不该有星标）。
  assert.match(src, /aria-disabled'\) === 'true'\) continue/, '中间轮必须跳过')
})

test('issue #86：星标宿主仍紧跟 Branch 按钮，且按 anchorKey 幂等、可重注入', () => {
  const src = read(SOURCE)
  assert.match(src, /branch\.insertAdjacentElement\('afterend', host\)/, '星标紧跟 Branch 按钮')
  assert.match(src, /const existing = mounted\.get\(parsed\.rawKey\)/, '同一 anchorKey 只注入一次')
  assert.match(src, /existing\.host\.isConnected/, '宿主还在页面上就跳过（幂等）')
  assert.match(src, /entry\.host\.isConnected[\s\S]{0,200}mounted\.delete\(key\)/, '宿主被摘掉时要清理并允许重注入')
  // 旧结构兼容路径保留：findTailBranch 仍在用。
  assert.match(src, /findTailBranch\(node\)/, '旧结构（Branch 在消息节点内）必须继续支持')
})

test('issue #86：构建产物与源码一致（产物里有轮尾选择器与宿主标记）', () => {
  const bundle = read(BUNDLE)
  assert.ok(bundle.includes('data-turn-tail'), '产物必须包含 data-turn-tail 扫描')
  assert.ok(bundle.includes('data-bm-star-host'), '产物必须包含星标宿主标记')
  assert.ok(bundle.includes('lastAssistantAnchor'), '产物必须包含按轮次找锚点的逻辑')
  // 反向守卫：不能只剩「在消息节点里找 Branch」的老逻辑。
  assert.ok(
    bundle.includes('data-turn-tail') && bundle.includes('dataset.bmAnchor'),
    '产物里既要扫轮尾节点，也要写 anchorKey',
  )
})

test('issue #86：文档记录了操作区搬家的原因（避免下次又被误删）', () => {
  const src = read(SOURCE)
  assert.match(src, /data-turn-tail/, '源码注释里要写明新结构，否则下次仍会按旧 DOM 写')
  assert.match(src, /issue #86/, '注释要指向 issue，便于追溯')
})
