/**
 * 皮肤兼容表面（skin-safe surfaces）。
 *
 * 背景：用户装「皮肤」后主题背景变半透明，插件面板文字直接压在插画上而看不清
 * （issue：记忆 Tab 的 Tab 行 / 警告条 / 文件卡片）。方案 C：
 *   1. 运行期探测主题底色透明度（src/client/surface.ts）；
 *   2. 只有「确实透明」时给 <html> 打 data-me-surface="opaque"，CSS 才切到
 *      内置不透明表面；不透明主题下一像素都不变；
 *   3. 配置项 skinSafeSurfaces（auto/on/off）可覆盖探测结果。
 *
 * 这份测试分两层：纯函数单测（alpha/luminance/决策/写属性）+ 源码与产物契约
 * （CSS 变量重映射、入口调用点、配置项与下拉都在）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  OPAQUE_ALPHA_THRESHOLD,
  applySurfaceMode,
  detectSurface,
  parseAlpha,
  parseLuminance,
  resetSurfaceCache,
  resolveSurfaceMode,
  syncSurface,
} from '../src/client/surface.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/** 最小 DOM 桩：够 detectSurface 用。 */
function fakeDoc({ background = 'rgba(0, 0, 0, 0)', color = 'rgb(230, 230, 230)' } = {}) {
  const attributes = new Map()
  const probe = {
    style: { cssText: '' },
    setAttribute() {},
    remove() {},
  }
  return {
    attributes,
    body: { appendChild() {} },
    defaultView: {
      getComputedStyle() {
        return { backgroundColor: background, color }
      },
    },
    createElement() {
      return probe
    },
    documentElement: {
      setAttribute(name, value) {
        attributes.set(name, value)
      },
      getAttribute(name) {
        return attributes.get(name) ?? null
      },
    },
  }
}

test('surface：parseAlpha 认得 rgb/rgba/斜杠语法/百分比/transparent', () => {
  assert.equal(parseAlpha('rgb(12, 34, 56)'), 1)
  assert.equal(parseAlpha('rgba(12, 34, 56, 0.4)'), 0.4)
  assert.equal(parseAlpha('rgb(12 34 56 / 25%)'), 0.25)
  assert.equal(parseAlpha('rgb(12 34 56 / 0.7)'), 0.7)
  assert.equal(parseAlpha('transparent'), 0)
  assert.equal(parseAlpha(''), null)
  assert.equal(parseAlpha(null), null)
})

test('surface：parseLuminance 按相对亮度区分深浅', () => {
  assert.ok(parseLuminance('rgb(255, 255, 255)') > 0.9)
  assert.ok(parseLuminance('rgb(0, 0, 0)') < 0.1)
  assert.equal(parseLuminance('nonsense'), null)
})

test('surface：主题透明时判定 opaque，不透明时保持 theme', () => {
  const translucent = detectSurface(fakeDoc({ background: 'rgba(20, 22, 26, 0.35)' }))
  assert.equal(translucent.mode, 'opaque')
  assert.ok(translucent.alpha < OPAQUE_ALPHA_THRESHOLD)

  const solid = detectSurface(fakeDoc({ background: 'rgb(20, 22, 26)' }))
  assert.equal(solid.mode, 'theme')
  assert.equal(solid.alpha, 1)

  const missing = detectSurface(fakeDoc({ background: 'transparent' }))
  assert.equal(missing.mode, 'opaque')
})

test('surface：浅色主题判成 light tone，深色主题判成 dark', () => {
  const light = detectSurface(fakeDoc({ background: 'rgba(255,255,255,0.2)', color: 'rgb(17, 24, 39)' }))
  assert.equal(light.tone, 'light')
  const dark = detectSurface(fakeDoc({ background: 'rgba(0,0,0,0.2)', color: 'rgb(230, 230, 230)' }))
  assert.equal(dark.tone, 'dark')
})

test('surface：配置覆盖优先于探测结果，auto 用探测值', () => {
  const detected = { mode: 'opaque', tone: 'dark', alpha: 0.2 }
  assert.equal(resolveSurfaceMode('off', detected).mode, 'theme')
  assert.equal(resolveSurfaceMode('on', detected).mode, 'opaque')
  assert.equal(resolveSurfaceMode('auto', detected).mode, 'opaque')
  assert.equal(resolveSurfaceMode(undefined, detected).mode, 'opaque')
  const solid = { mode: 'theme', tone: 'light', alpha: 1 }
  assert.equal(resolveSurfaceMode('on', solid).mode, 'opaque')
  assert.equal(resolveSurfaceMode('auto', solid).mode, 'theme')
})

test('surface：applySurfaceMode 把模式与色调写到 documentElement', () => {
  const doc = fakeDoc()
  applySurfaceMode(doc, { mode: 'opaque', tone: 'light', alpha: 0.3 })
  assert.equal(doc.documentElement.getAttribute('data-me-surface'), 'opaque')
  assert.equal(doc.documentElement.getAttribute('data-me-surface-tone'), 'light')
  applySurfaceMode(doc, { mode: 'theme', tone: 'dark', alpha: 1 })
  assert.equal(doc.documentElement.getAttribute('data-me-surface'), 'theme')
})

test('surface：syncSurface 端到端（透明主题 + 配置 off 回退成 theme）', () => {
  resetSurfaceCache()
  const doc = fakeDoc({ background: 'rgba(10, 12, 16, 0.25)' })
  const auto = syncSurface(doc, 'auto')
  assert.equal(auto.mode, 'opaque')
  assert.equal(doc.documentElement.getAttribute('data-me-surface'), 'opaque')

  const off = syncSurface(doc, 'off')
  assert.equal(off.mode, 'theme')
  assert.equal(doc.documentElement.getAttribute('data-me-surface'), 'theme')
  resetSurfaceCache()
})

test('surface：无 document 时不抛错（SSR/测试环境安全）', () => {
  assert.deepEqual(detectSurface(null), { mode: 'theme', tone: 'dark', alpha: null })
  assert.doesNotThrow(() => applySurfaceMode(undefined, { mode: 'opaque', tone: 'dark', alpha: 0 }))
})

test('surface 契约：样式表按 data-me-surface="opaque" 重映射主题令牌', () => {
  const css = read('src/client/styles.css')
  assert.match(css, /:root\[data-me-surface='opaque'\]\[data-me-surface-tone='dark'\]/)
  assert.match(css, /:root\[data-me-surface='opaque'\]\[data-me-surface-tone='light'\]/)
  assert.match(css, /--dsw-alias-bg-layer-1:\s*var\(--me-surface-raised\)/)
  assert.match(css, /--dsw-alias-bg-base:\s*var\(--me-surface\)/)
  assert.match(css, /--dsw-alias-interactive-bg-hover:\s*var\(--me-hover\)/)
  // 覆盖全部插件根容器，新增 Tab 必须同步加进来
  for (const root of ['.mt-panel', '.me-panel', '.coi-root', '.bb-pane', '.pm-root', '.sb-root', '.bm-panel', '.advisor-panel']) {
    assert.ok(css.includes(root), `根容器 ${root} 必须在覆盖清单里`)
  }
  // 警告条与提示条在皮肤下要有实底，不能只靠 color-mix 半透明
  assert.match(css, /\.me-notice-warn[\s\S]{0,200}--me-tint-warn/)
  assert.match(css, /\.mt-warning[\s\S]{0,200}--me-tint-warn/)
})

test('surface 契约：客户端入口在装配时探测、配置加载/变更时重新应用', () => {
  const entry = read('src/client/index.ts')
  assert.match(entry, /import \{ syncSurface \} from '\.\/surface\.ts'/)
  assert.match(entry, /syncSurface\(document, 'auto'\)/)
  assert.match(entry, /syncSurface\(document, data\.config\?\.skinSafeSurfaces\)/)
  assert.match(entry, /syncSurface\(document, detail\?\.skinSafeSurfaces\)/)
})

test('surface 契约：配置项 skinSafeSurfaces 在主机端有默认值、白名单与校验', () => {
  const host = read('lib/index.js')
  assert.match(host, /skinSafeSurfaces: 'auto'/)
  assert.match(host, /'projectInjectMode', 'dailyInjectMode', 'skinSafeSurfaces'/)
  assert.match(host, /case 'skinSafeSurfaces':/)
  assert.match(host, /value !== 'auto' && value !== 'on' && value !== 'off'/)
})

test('surface 契约：配置面板有下拉，中英文案齐全', () => {
  const view = read('src/client/MemoryQueueView.tsx')
  assert.match(view, /skinSafeSurfaces\?: 'auto' \| 'on' \| 'off'/)
  assert.match(view, /patchDraft\(\{ skinSafeSurfaces:/)
  assert.match(view, /panel\.config\.skinSafeSurfaces\.auto/)
  const dict = read('src/client/index.ts')
  for (const key of ['', '.hint', '.auto', '.on', '.off']) {
    assert.ok(dict.includes(`'panel.config.skinSafeSurfaces${key}'`), `缺少文案键 panel.config.skinSafeSurfaces${key}`)
  }
})

test('surface 契约：产物里带探测与属性切换（防止忘记重建 lib/client.js）', () => {
  const bundle = read('lib/client.js')
  assert.ok(bundle.includes('data-me-surface'), '产物必须含 data-me-surface')
  assert.ok(bundle.includes('data-me-surface-tone'), '产物必须含 data-me-surface-tone')
  assert.ok(bundle.includes('--me-surface-raised'), '产物必须含不透明表面变量')
  assert.ok(bundle.includes('skinSafeSurfaces'), '产物必须含配置键')
})
