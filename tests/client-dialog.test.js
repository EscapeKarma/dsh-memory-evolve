/**
 * issue #88 回归：不能再用原生 window.confirm / window.alert。
 *
 * 现象：在 DSH 桌面版（Electron + Windows TaskDialog）里确认框关掉之后，
 * 主窗口**拿不回键盘焦点**——`document.hasFocus()` 一直是 false，输入框
 * 要再点一下窗口才能打字，切到别的窗口再切回来才恢复。原生对话框是同步
 * 阻塞的，等待期间后台轮询/SSE 也全停。
 *
 * 修法：全部换成页面内 React 对话框（src/client/dialog.tsx）。这个文件用
 * 静态断言守住三件事，防止有人图省事又写回原生调用：
 *   1. src/client 下（除 dialog.tsx 自己的注释）不允许出现 window.confirm /
 *      window.alert；
 *   2. confirm 的返回值必须被 await（否则 `if (!promise)` 恒为 false，等于
 *      跳过确认直接执行删除——比不弹框更危险）；
 *   3. 对话框实现要有关闭后还焦点、Esc 取消、Enter 确认、串行排队，
 *      构建产物 lib/client.js 里也要有对应代码。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const CLIENT = join(ROOT, 'src', 'client')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

function walk(dir, prefix = '')
{
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel))
    else if (/.(ts|tsx)$/.test(entry.name) && rel !== 'dialog.tsx') out.push(rel)
  }
  return out
}
const sources = walk(CLIENT)

test('issue #88：src/client 下不再调用原生 confirm / alert', () => {
  const offenders = []
  for (const file of sources) {
    const src = read(`src/client/${file}`)
    const m = src.match(/window\.(confirm|alert)\(/)
    if (m !== null) offenders.push(`${file}: ${m[0]}`)
  }
  assert.deepEqual(offenders, [], '原生对话框会丢键盘焦点，必须用 ./dialog.tsx')
})

test('issue #88：每处 confirmDialog 都被 await（漏 await 等于不确认就执行）', () => {
  let total = 0
  for (const file of sources) {
    const src = read(`src/client/${file}`)
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      if (!line.includes('confirmDialog(')) return
      // 定义/导入行不算调用点。
      if (line.includes('from \'./dialog')) return
      if (line.trim().startsWith('*')) return
      total += 1
      assert.match(
        line,
        /await confirmDialog\(/,
        `${file}:${i + 1} 的 confirmDialog 必须 await：${line.trim()}`,
      )
    })
  }
  assert.ok(total >= 15, `确认框调用点数量异常（${total} 处），别名改动可能漏改`)
})

test('issue #88：对话框实现具备还焦点 / Esc / Enter / 串行排队', () => {
  const src = read('src/client/dialog.tsx')
  assert.match(src, /export function confirmDialog\(/, '必须导出 confirmDialog')
  assert.match(src, /export async function alertDialog\(/, '必须导出 alertDialog')
  // 关闭后把焦点还给打开前的元素（原生对话框的毛病就是这个）。
  assert.match(src, /document\.activeElement/, '必须记录打开前的焦点元素')
  assert.match(src, /previous\.focus\(\{ preventScroll: true \}\)/, '关闭后必须把焦点还回去')
  // 键盘：Esc 取消、Enter 确认（焦点在取消按钮上时回车应取消）。
  assert.match(src, /event\.key === 'Escape'/, 'Esc 必须能取消')
  assert.match(src, /event\.key === 'Enter'/, 'Enter 必须能确认')
  assert.match(src, /onCancel/, '回车时要判断焦点是否在取消按钮上')
  // 串行化：同时只开一个，避免遮罩互相盖住。
  assert.match(src, /let queue: Promise<unknown>/, '多个对话框必须排队')
  // 没有 DOM 的环境（单测/SSR）要安全返回，不能抛。
  assert.match(src, /typeof document === 'undefined'/, '无 DOM 环境必须安全返回')
})

test('issue #88：按钮文案跟随语言，产物里不再有原生对话框', () => {
  const idx = read('src/client/index.ts')
  assert.match(idx, /setDialogLabels\(\{ ok: t\('dialog\.ok'\), cancel: t\('dialog\.cancel'\) \}\)/)
  assert.match(idx, /'dialog\.ok': '确定'/)
  assert.match(idx, /'dialog\.ok': 'OK'/)
  const bundle = read('lib/client.js')
  assert.ok(bundle.includes('me-dialog'), '产物必须包含页面内对话框')
  assert.ok(bundle.includes('me-dialog-backdrop'), '产物必须包含遮罩样式类')
  assert.ok(!/window\.confirm\(/.test(bundle), '产物里不能残留原生 confirm')
  assert.ok(!/window\.alert\(/.test(bundle), '产物里不能残留原生 alert')
})
