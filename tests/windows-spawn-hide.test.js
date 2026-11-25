// 静态护栏：lib/ 里每个子进程调用都必须带 windowsHide。
//
// 背景：DSH 桌面版是无控制台的 GUI 进程。任何不带 windowsHide 的控制台程序
// 都会弹出黑色控制台窗口——用户看到的是「一闪而过的黑窗」，或（管道先被关闭时）
// 一个写着 `出现错误 2147942632 (0x800700e8)` 的空窗口，标题是 node.exe 路径。
// PR #95 修了 runGit / sync worker；COI 任务启动、适配器自检与测试里的孙进程
// 又漏了两轮。这个用例把整类问题钉住，避免逐点打补丁。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function listJs(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listJs(path))
    else if (entry.name.endsWith('.js') && entry.name !== 'client.js') out.push(path)
  }
  return out
}

// 取出「spawn(…, { … })」这一整段：从调用括号开始，配平括号后返回。
function callSites(source, name) {
  const sites = []
  const needle = new RegExp(`\\b${name}\\s*\\(`, 'g')
  let match
  while ((match = needle.exec(source)) !== null) {
    // 跳过「function spawn(」「async spawn(」这类定义，以及「orch.spawn(」
    // 「this.#spawn(」这类成员/方法调用——它们不是 child_process。
    const before = source.slice(Math.max(0, match.index - 12), match.index)
    if (/function\s+$/.test(before)) continue
    if (/(?:async\s+|\.|#)$/.test(before)) continue
    let depth = 0
    let index = match.index + name.length
    for (; index < source.length; index += 1) {
      const ch = source[index]
      if (ch === '(') depth += 1
      else if (ch === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    sites.push({
      index: match.index,
      line: source.slice(0, match.index).split('\n').length,
      text: source.slice(match.index, index + 1),
    })
  }
  return sites
}

test('lib 下所有 spawn / spawnSync 调用都带 windowsHide', () => {
  const offenders = []
  for (const file of listJs(join(ROOT, 'lib'))) {
    const source = readFileSync(file, 'utf8')
    for (const name of ['spawn', 'spawnSync']) {
      for (const site of callSites(source, name)) {
        if (!/windowsHide/.test(site.text)) {
          offenders.push(`${file.replace(`${ROOT}/`, '')}:${site.line}`)
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `缺少 windowsHide 的子进程调用：\n${offenders.join('\n')}`)
})

test('注入的样式必须归属到本插件（data-plugin），不被其他插件认领', () => {
  // 与 tests/style-ownership.test.js 互补：这里只确保 lib/client.js 产物里
  // 每个 createElement('style') 附近都有归属调用。
  const bundle = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  const creates = bundle.split('createElement("style")').length - 1
  const claims = bundle.split('claimStyleOwnership').length - 1
  assert.ok(creates > 0, '产物里应有样式注入点')
  assert.ok(claims >= creates, `样式注入点 ${creates} 个，归属调用只有 ${claims} 次`)
})
