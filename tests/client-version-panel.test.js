/**
 * dsh-memory-evolve — 「版本」页三形态静态契约测试。
 *
 * 这个文件守的是「别再退回旧行为」：v0.3.0 之前整页只服务 git clone 用户，
 * 包安装（市场 / `dsh plugin add`）的用户打开就是一句「不支持自动检测（需要
 * git clone 安装）」——issue 里被当成 bug 报过。v0.4.0 改成按安装形态分流，
 * 这里用源码 + 产物双侧扫描锁住：
 *   1. 前端有 `installKind` 分支与「由插件市场管理」文案；
 *   2. 包安装给出可复制的升级命令（命令字符串与 README 一致）；
 *   3. 服务端 DTO 带 installKind / pluginVersion / release 三个字段；
 *   4. index.js 真的装配了 releaseOps（否则 DTO 永远是 null）；
 *   5. 30s 轮询的红点只读缓存，不触发网络（cached() 而不是 status()）。
 *
 * 全部是静态断言（读文件、正则），不依赖 DOM —— 与 client-*.test.js 的既有
 * 做法一致；真正的交互由人工在设置页验证。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

test('VersionTabView：按 installKind 分三种呈现，包安装不再显示「不支持」', () => {
  const src = read('src/client/VersionTabView.tsx')
  assert.match(src, /installKind/, '必须有 installKind 判定')
  // 文案键按形态拼出来（模板串）：source / package 两条分支都要在。
  assert.match(src, /version\.installKind\.\$\{installKind\}/)
  assert.match(src, /const installKind: 'source' \| 'package'/)
  assert.match(src, /version\.status\.package/)
  // 旧文案只能作为历史键存在，不能成为包安装用户看到的主提示。
  assert.match(src, /installKind === 'package'[\s\S]{0,400}version\.package\.hint/)
  // 包安装时不显示「检测失败」（那只是没有 .git，不是故障）。
  assert.match(src, /installKind === 'source' && state\?\.lastError/)
})

test('VersionTabView：包安装给出可复制的升级命令', () => {
  const src = read('src/client/VersionTabView.tsx')
  const m = src.match(/export const UPGRADE_COMMAND = '([^']+)'/)
  assert.ok(m, '必须导出 UPGRADE_COMMAND')
  assert.equal(m[1], 'dsh plugin --profile <profile> add github:EscapeKarma/dsh-memory-evolve')
  // 有复制能力，且复制失败不会抛到界面上。
  assert.match(src, /navigator\?\.clipboard\?\.writeText/)
  assert.match(src, /execCommand\('copy'\)/)
})

test('VersionTabView：源码安装仍保留一键更新（开发者路径）', () => {
  const src = read('src/client/VersionTabView.tsx')
  assert.match(src, /installKind === 'source' && state\?\.status === 'outdated'/)
  assert.match(src, /version\.source\.hint/)
  assert.match(src, /POST 到|\/memory-evolve\/api\/update/)
})

test('bundle：lib/client.js 已重建，含新文案与升级命令', () => {
  const built = read('lib/client.js')
  assert.match(built, /dsh plugin --profile <profile> add github:EscapeKarma\/dsh-memory-evolve/)
  assert.match(built, /version\.installKind\.package/)
  assert.match(built, /version\.status\.package/)
  assert.match(built, /version\.package\.hint/)
  // 英文文案是 ASCII，直接能在产物里找到（中文被 esbuild 转成 \u 转义，
  // 断言中文会误红；中文侧由源码字典那条用例守）。
  assert.match(built, /Managed by the marketplace/)
  assert.match(built, /Copy upgrade command/)
})

test('api DTO：status 接口外发 installKind / pluginVersion / release', () => {
  const api = read('lib/api.js')
  assert.match(api, /installKind: state\.installKind === 'source' \? 'source' : 'package'/)
  assert.match(api, /pluginVersion: state\.pluginVersion \?\? null/)
  assert.match(api, /release: release\s*\n?\s*\? \{/)
  // 只读字段白名单：不能把 remoteUrl / repoPath 这类本地路径抖出去。
  assert.doesNotMatch(api, /remoteUrl: state\.remoteUrl/)
})

test('index.js：装配 releaseOps 并在启动时后台跑一次', () => {
  const index = read('lib/index.js')
  assert.match(index, /import \{ getReleaseChecker \} from '\.\/release-check\.js'/)
  assert.match(index, /const releaseOps = getReleaseChecker\(/)
  assert.match(index, /void releaseOps\.status\(\)\.catch/)
  assert.match(index, /\breleaseOps,/, '必须作为依赖传给 web api')
})

test('红点：30s 轮询只读发布检查缓存，不发网络请求', () => {
  const api = read('lib/api.js')
  const suggestionsBlock = api.slice(api.indexOf('const update = deps.updateOps'), api.indexOf("if (req.method === 'GET' && path === '/memory-evolve/api/update/status')"))
  assert.match(suggestionsBlock, /deps\.releaseOps\.cached\(\)/, '轮询必须用 cached()')
  assert.doesNotMatch(suggestionsBlock, /releaseOps\.status\(/, '轮询不得调用 status() 触发网络')

  const release = read('lib/release-check.js')
  assert.match(release, /cached: \(\) => shape\(loadCache\(\)\)/)
})
