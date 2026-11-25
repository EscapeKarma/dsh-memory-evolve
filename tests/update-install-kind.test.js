/**
 * dsh-memory-evolve — 安装形态检测与状态出口测试（lib/update.js）。
 *
 * 背景：插件有两种安装方式，升级方式完全不同——
 *   - `git clone` 安装：目录里有 .git，插件自带的一键更新可用；
 *   - `dsh plugin add github:…` / 市场安装：profile 里是 tarball 副本，
 *     **没有 .git**，只能靠市场或 `dsh plugin add` 重装升级。
 *
 * 旧版本对这两种安装一视同仁地跑 git 检测，包安装的用户打开「版本」页
 * 只会看到「插件目录不是 git 仓库或 git 不可用（请用 git clone 安装）」，
 * 既像报错又给了做不到的建议。本文件锁住修复后的契约：
 *   1. `detectInstallKind()` 能区分两种形态，且只跑本地 git、绝不联网；
 *   2. 包安装时 `status()` 仍返回 `status:'unsupported'`（检测确实不支持），
 *      但额外带 `installKind:'package'`，前端据此换文案；
 *   3. 两种形态都能拿到 `pluginVersion`（供「当前版本」显示）；
 *   4. 检测结果在进程内缓存，不会每次轮询都 spawn git。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createUpdateChecker, detectInstallKind } from '../lib/update.js'

const realRun = promisify(execFile)

/** 最小 package.json（含 version，供 pluginVersion 断言）。 */
function writePackage(dir, version = '9.9.9') {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-memory-evolve', version }), 'utf8')
}

/** 记录每次调用的假 run：把 git 命令映射成固定结果。 */
function fakeRun(table) {
  const calls = []
  const run = async (file, args) => {
    const key = `${file} ${args.join(' ')}`
    calls.push(key)
    for (const [needle, result] of table) {
      if (key.includes(needle)) {
        if (result instanceof Error) throw result
        return result
      }
    }
    const err = new Error(`unexpected command: ${key}`)
    throw err
  }
  return { run, calls }
}

test('detectInstallKind：有 .git 判为 source 并带出远端地址', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-install-kind-'))
  try {
    const { run, calls } = fakeRun([
      ['rev-parse --absolute-git-dir', { stdout: '/repo/.git\n', stderr: '' }],
      ['config --get remote.origin.url', { stdout: 'https://github.com/EscapeKarma/dsh-memory-evolve.git\n', stderr: '' }],
    ])
    const meta = await detectInstallKind(dir, run)
    assert.equal(meta.installKind, 'source')
    assert.equal(meta.remoteUrl, 'https://github.com/EscapeKarma/dsh-memory-evolve.git')
    // 只跑两条本地命令：形态检测绝不联网（ls-remote 之类不得出现）。
    assert.deepEqual(calls, [
      'git rev-parse --absolute-git-dir',
      'git config --get remote.origin.url',
    ])
    assert.ok(!calls.some((c) => /ls-remote|fetch|remote/.test(c) && !c.includes('remote.origin.url')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('detectInstallKind：没有 .git 判为 package（且不再问远端地址）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-install-kind-'))
  try {
    const { run, calls } = fakeRun([
      ['rev-parse --absolute-git-dir', new Error('fatal: not a git repository')],
    ])
    const meta = await detectInstallKind(dir, run)
    assert.equal(meta.installKind, 'package')
    assert.equal(meta.remoteUrl, '')
    assert.deepEqual(calls, ['git rev-parse --absolute-git-dir'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('status：包安装（无 .git）带出 installKind=package 与 pluginVersion', async () => {
  // 真实目录、不带 .git：模拟 profile 里 tarball 副本的现场。
  const dir = mkdtempSync(join(tmpdir(), 'dsh-install-kind-'))
  try {
    writePackage(dir, '0.4.0')
    const checker = createUpdateChecker({ repoDir: dir, fallbackDir: join(dir, '.state') })
    const state = await checker.status(true)
    assert.equal(state.installKind, 'package')
    assert.equal(state.pluginVersion, '0.4.0')
    // 检测本身仍是不支持（没有 git 就没法比对 tag），这是事实不是 bug。
    assert.equal(state.status, 'unsupported')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('status：source 安装同样带出 pluginVersion，且能读到远端', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-install-kind-'))
  try {
    writePackage(dir, '0.4.0')
    // 造一个最小 git 仓库（只需 rev-parse 成功 + 有 origin）。
    await realRun('git', ['init', '-q'], { cwd: dir })
    await realRun('git', ['remote', 'add', 'origin', 'https://github.com/EscapeKarma/dsh-memory-evolve.git'], { cwd: dir })
    const meta = await detectInstallKind(dir)
    assert.equal(meta.installKind, 'source')
    assert.equal(meta.remoteUrl, 'https://github.com/EscapeKarma/dsh-memory-evolve.git')

    // status 的 installKind 走同一条检测；git 命令会失败（空仓库无 tag），
    // 但形态与版本仍必须正确。
    const checker = createUpdateChecker({ repoDir: dir, fallbackDir: join(dir, '.state') })
    const state = await checker.status(true)
    assert.equal(state.installKind, 'source')
    assert.equal(state.pluginVersion, '0.4.0')
    assert.ok(typeof state.status === 'string' && state.status.length > 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('installKind 在进程内只探测一次（轮询不打 git）', async () => {
  const base = mkdtempSync(join(tmpdir(), 'dsh-install-kind-'))
  try {
    writePackage(base, '0.4.0')
    // 行为式断言：第一次 status 时 git 一切正常（判 source），之后把假 run
    // 切成「全部失败」。形态结果若被缓存，第二次 status 仍是 source；若每次
    // 重探，就会翻成 package。
    let gitBroken = false
    const run = async (file, args) => {
      const key = `${file} ${args.join(' ')}`
      if (gitBroken) throw new Error('git is broken now')
      if (key.includes('rev-parse --absolute-git-dir')) return { stdout: '/repo/.git\n', stderr: '' }
      if (key.includes('config --get remote.origin.url')) {
        return { stdout: 'git@github.com:EscapeKarma/dsh-memory-evolve.git\n', stderr: '' }
      }
      throw new Error(`unexpected: ${key}`)
    }
    const checker = createUpdateChecker({ repoDir: base, fallbackDir: join(base, '.state'), run })
    const first = await checker.status(true)
    assert.equal(first.installKind, 'source')
    gitBroken = true
    const second = await checker.status(true)
    assert.equal(second.installKind, 'source', '第二次 status 应复用缓存，不得重新探测安装形态')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('package.json 缺失或损坏时 pluginVersion 为 null（不让状态接口崩）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-install-kind-'))
  try {
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'package.json'), '{ not json', 'utf8')
    const checker = createUpdateChecker({ repoDir: dir, fallbackDir: join(dir, '.state') })
    const state = await checker.status(true)
    assert.equal(state.pluginVersion, null)
    assert.equal(state.installKind, 'package')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
