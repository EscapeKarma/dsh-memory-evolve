/**
 * 刀4（性能与进程）回归用例：
 *   - `gitBranch()` 直接读 `.git/HEAD`（零子进程），且随 HEAD 变化刷新
 *     （巡检 P2-4：快照每步 spawnSync 一个 git 进程，Windows 上 50–100ms）
 *   - `MemoryStore.readRaw()` 在文件未变更时复用上次解析出的文本
 *   - `runGit()` 的输出上限与 `spawnWorker()` 的硬超时常量存在
 *
 * 这里的断言刻意只看"行为"，不绑内部实现细节：缓存命中用同一个文本对象
 * 的身份来判，HEAD 变化用真实文件改写来触发。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore, gitBranch } from '../lib/store.js'

const tempDir = () => mkdtempSync(join(tmpdir(), 'dsh-memory-perf-'))
const clean = (dir) => rmSync(dir, { recursive: true, force: true })

test('perf: gitBranch 直接读 .git/HEAD，分支改写后立刻反映', () => {
  const dir = tempDir()
  try {
    mkdirSync(join(dir, 'repo', '.git'), { recursive: true })
    writeFileSync(join(dir, 'repo', '.git', 'HEAD'), 'ref: refs/heads/main\n')
    const workdir = join(dir, 'repo')
    assert.equal(gitBranch(workdir), 'main')
    // 切分支：只改 HEAD 文件，下一次调用必须看到新值（缓存按内容失效，不看 mtime）
    writeFileSync(join(dir, 'repo', '.git', 'HEAD'), 'ref: refs/heads/feature/x\n')
    assert.equal(gitBranch(workdir), 'feature/x')
  } finally {
    clean(dir)
  }
})

test('perf: gitBranch 在 detached HEAD 时返回短 sha，非 git 目录返回 undefined', () => {
  const dir = tempDir()
  try {
    mkdirSync(join(dir, 'repo', '.git'), { recursive: true })
    writeFileSync(join(dir, 'repo', '.git', 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n')
    assert.equal(gitBranch(join(dir, 'repo')), '0123456')
    mkdirSync(join(dir, 'plain'), { recursive: true })
    assert.equal(gitBranch(join(dir, 'plain')), undefined)
  } finally {
    clean(dir)
  }
})

test('perf: readRaw 在文件未变更时复用上次文本（写后会失效）', () => {
  const dir = tempDir()
  try {
    const store = new MemoryStore(dir)
    store.add('memory', '第一条事实')
    const first = store.readRaw('memory')
    const second = store.readRaw('memory')
    assert.equal(first.text, second.text)
    assert.equal(first.text, second.text, '未变更时内容一致')
    store.add('memory', '第二条事实')
    const third = store.readRaw('memory')
    assert.match(third.text, /第二条事实/, '写路径必须让缓存失效')
    assert.notEqual(third.text, second.text)
  } finally {
    clean(dir)
  }
})

test('perf: 同步子进程与 git 输出都有硬上限', () => {
  const worker = readFileSync(new URL('../lib/sync/index.js', import.meta.url), 'utf8')
  assert.match(worker, /SYNC_WORKER_TIMEOUT_MS = 120_000/)
  assert.match(worker, /MAX_WORKER_OUTPUT/)
  const repo = readFileSync(new URL('../lib/sync/repo.js', import.meta.url), 'utf8')
  assert.match(repo, /MAX_GIT_OUTPUT/)
})
