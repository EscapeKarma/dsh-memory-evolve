/**
 * tests/sync-git-locale.test.js — git 子进程必须固定英文 locale（issue #75）
 *
 * 缺陷：`lib/sync/worker.js` 靠 git 的英文 stderr 判别失败类型，最典型的是
 * `/couldn't find remote ref/` →「远端还没有这个分支（真·首次推送）」。git 的
 * 错误文本跟随用户 locale 翻译，中文 Windows（`LANG`/`LC_ALL` 为 zh_CN）下这句
 * 变成「致命错误：找不到远程引用」，正则不命中 → 首次推送被当成拉取失败而中止，
 * 同步永远起不来（用户看到的就是"一直同步失败"）。
 *
 * 修法：`runGit()` 在**所有**调用上注入 `LC_ALL=C` + `LANG=C`。本文件直接检查
 * 传给子进程的 env（注入假 spawn，不真的跑 git），覆盖三种组合：
 *   - 本地命令：必须带 locale；
 *   - 网络命令：必须带 locale **且**保留 GIT_TERMINAL_PROMPT=0；
 *   - 调用方显式传 env：合并而非替换，locale 不丢。
 * 另有一条守门用例：worker 的 remoteMissing 正则必须认得中文文案（双保险）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { GIT_LOCALE_ENV, runGit } from '../lib/sync/repo.js'

/**
 * 假子进程：stdout/stderr 立即结束，随后 emit `close(0)`。
 * `pid` 保持 undefined → 清理路径走 `child.kill()`，不会误杀真实进程组。
 */
class QuietChild extends EventEmitter {
  constructor({ stderr = '', code = 0 } = {}) {
    super()
    this.pid = undefined
    this.stdout = Readable.from([])
    this.stderr = Readable.from(stderr === '' ? [] : [stderr])
    this.killed = 0
    setImmediate(() => this.emit('close', code))
  }

  kill() {
    this.killed += 1
    return true
  }
}

/** 注入假 spawn，返回 { env, args } 记录（env 是传给子进程的完整环境）。 */
async function captureEnv(args, opts = {}) {
  const seen = {}
  const spawnFn = (cmd, argv, options) => {
    seen.cmd = cmd
    seen.args = argv
    seen.env = options.env
    return new QuietChild()
  }
  const r = await runGit('.', args, { ...opts, spawnFn })
  assert.equal(r.ok, true)
  return seen
}

test('git 子进程 locale：本地命令固定 LC_ALL=C / LANG=C（issue #75）', async () => {
  const seen = await captureEnv(['status', '--short'])
  assert.equal(seen.cmd, 'git')
  assert.equal(seen.env.LC_ALL, 'C')
  assert.equal(seen.env.LANG, 'C')
  // 本地命令不需要 GIT_TERMINAL_PROMPT（它自带会污染普通仓库行为）
  assert.notEqual(seen.env.GIT_TERMINAL_PROMPT, '0')
})

test('git 子进程 locale：网络命令同时带 LC_ALL=C 与 GIT_TERMINAL_PROMPT=0', async () => {
  const seen = await captureEnv(['fetch', 'origin', 'main'], { network: true })
  assert.equal(seen.env.LC_ALL, 'C')
  assert.equal(seen.env.LANG, 'C')
  assert.equal(seen.env.GIT_TERMINAL_PROMPT, '0')
})

test('git 子进程 locale：调用方 env 是合并语义，不丢 locale 也不丢调用方变量', async () => {
  const seen = await captureEnv(['add', '--', 'MEMORY.md'], { env: { GIT_INDEX_FILE: '/tmp/x.idx' } })
  assert.equal(seen.env.LC_ALL, 'C')
  assert.equal(seen.env.LANG, 'C')
  assert.equal(seen.env.GIT_INDEX_FILE, '/tmp/x.idx')
})

test('git 子进程 locale：GIT_LOCALE_ENV 常量本身不可被就地改写', () => {
  assert.deepEqual({ ...GIT_LOCALE_ENV }, { LC_ALL: 'C', LANG: 'C' })
  assert.equal(Object.isFrozen(GIT_LOCALE_ENV), true)
})

test('worker 的 remoteMissing 判别认得本地化文案（issue #75 双保险）', () => {
  // 与 lib/sync/worker.js 判定行保持一致：中英文都要命中
  const re = /couldn't find remote ref|not our ref|no such ref|找不到远程引用|不是我们的引用/i
  const samples = [
    "fatal: couldn't find remote ref refs/heads/dsh-shared/main",
    'fatal: not our ref 0123456789abcdef',
    'fatal: 找不到远程引用 refs/heads/dsh-shared/main',
    '致命错误：不是我们的引用 0123456789abcdef',
  ]
  for (const s of samples) assert.equal(re.test(s), true, s)
  // 反面样本：真实的网络错误不能被误判成"分支不存在"
  for (const s of ['fatal: unable to access: Could not resolve host: github.com', 'fatal: Authentication failed']) {
    assert.equal(re.test(s), false, s)
  }
})
