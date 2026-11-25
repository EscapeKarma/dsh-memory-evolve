/**
 * P3 C 组（前端稳定性）的静态契约测试。
 *
 * 这一组修的是「浏览器侧才会炸 / 才会丢」的四类问题，本地 Node 跑不到真实 DOM，
 * 所以用「源码 + 产物」两侧的静态断言锁定行为：
 *
 * - C1 写操作防重：COI「重试」在请求返回前不允许再点。
 * - C2 锚点选择器转义：书签跳转不能把宿主给的锚点原文拼进 CSS 选择器。
 * - C3 切会话竞态：COI 的任务列表 / 详情用递增令牌丢弃过期响应。
 * - C4 保存失败提示：功能开关落盘失败时必须告诉用户「只本次会话生效」。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const coi = read('src/client/CoIView.tsx')
const bookmarks = read('src/client/BookmarksView.tsx')
const features = read('src/client/ui-settings-features.ts')
const uiSettings = read('src/client/UiSettingsView.tsx')
const i18n = read('src/client/index.ts')
const bundle = read('lib/client.js')

describe('C1 写操作防重', () => {
  test('COI 重试在请求进行中直接返回，按钮同时禁用', () => {
    assert.match(coi, /const retry = async \(\): Promise<void> => \{\n\s+if \(detail === null \|\| retrying\) return/)
    assert.match(coi, /setRetrying\(true\)/)
    assert.match(coi, /finally \{\n\s+setRetrying\(false\)/)
    assert.match(coi, /disabled=\{retrying\}/)
  })
})

describe('C2 锚点选择器转义', () => {
  test('不再把锚点原文插值进属性选择器', () => {
    assert.ok(
      !bookmarks.includes('`[data-chat-anchor-key="${key}"]`'),
      '锚点 key 含引号 / 方括号时选择器会抛 SyntaxError',
    )
  })

  test('改为遍历候选节点比较 dataset', () => {
    assert.match(bookmarks, /function findAnchorNode\(key: string\): HTMLElement \| null \{/)
    assert.match(bookmarks, /node\.dataset\.chatAnchorKey === key/)
    assert.match(bookmarks, /const existing = findAnchorNode\(key\)/)
    assert.match(bookmarks, /const el = findAnchorNode\(key\)/)
  })
})

describe('C3 切会话竞态', () => {
  test('两个加载函数都用递增令牌丢弃过期响应', () => {
    assert.match(coi, /const tasksSeq = useRef\(0\)/)
    assert.match(coi, /const detailSeq = useRef\(0\)/)
    assert.match(coi, /const token = \+\+tasksSeq\.current/)
    assert.match(coi, /const token = \+\+detailSeq\.current/)
    assert.match(coi, /if \(token !== tasksSeq\.current\) return/)
    assert.match(coi, /if \(token !== detailSeq\.current\) return/)
  })
})

describe('C4 保存失败提示', () => {
  test('writeFeatures 返回是否真的落盘', () => {
    assert.match(features, /export function writeFeatures\(features: UiSettingsFeatures\): boolean \{/)
    assert.match(features, /let persisted = true/)
    assert.match(features, /persisted = false/)
    assert.match(features, /return persisted/)
  })

  test('面板读取返回值并渲染提示', () => {
    assert.match(uiSettings, /setSaveFailed\(!writeFeatures\(next\)\)/)
    assert.match(uiSettings, /\{saveFailed && \(/)
    assert.match(uiSettings, /t\('uiSettingsTab\.saveFailed'\)/)
  })

  test('中英文案都在，且产物里带得上', () => {
    assert.ok(i18n.includes("'uiSettingsTab.saveFailed': '这次改动只在本次会话内生效"))
    assert.ok(i18n.includes("'uiSettingsTab.saveFailed': 'This change only lasts for this session"))
    assert.ok(bundle.includes('uiSettingsTab.saveFailed'), 'lib/client.js 需要重新构建')
    assert.ok(bundle.includes('me-notice-warn'))
  })
})
