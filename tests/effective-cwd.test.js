/**
 * issue #106 回归：project / key 记忆的桶必须按**执行目录**判定。
 *
 * 官方语义：`session.header.cwd` 是会话归属的项目，不是当前执行目录——
 * 子代理、Team 成员、pinned workspace 都可以在别的目录里干活。上游 issue
 * 里 B 项目一条 project 记忆都没有，就是因为桶只认 header.cwd。
 *
 * 本文件锁定三件事：
 *   1. 解析优先级：显式覆盖 > 宿主 workingDirectory 服务 > header.cwd；
 *   2. 落桶与读取用同一个入口（写进 B 桶、从 B 桶读回、分支取 B 的分支）；
 *   3. 迁移安全：伪 agent（Web API / 复审 / 看板用的 `{ session: { header } }`）
 *      行为不变；影子 agent 不污染真实 header；目录比较在 Windows 上归一。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../lib/store.js'
import { EXPLICIT_CWD, createCwdResolver, sameCwd, withExplicitCwd } from '../lib/cwd.js'
import { renderSnapshot, resolveConfig } from '../lib/index.js'
import { setLocale } from '../lib/i18n.js'

setLocale('zh')

const counter = { turnsOf: () => 0 }

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'dsh-effective-cwd-'))
}

/** 假宿主：workingDirectory 服务按 session id → 目录表返回。 */
function fakeCtx(table) {
  return {
    get(name) {
      if (name !== 'workingDirectory') return undefined
      return {
        get(session) {
          const id = session?.id
          if (id === undefined || !(id in table)) throw new Error('session 未注册')
          return table[id]
        },
      }
    },
  }
}

/** 子代理：header 是父项目 A，执行目录是 B。 */
function subAgentProject() {
  return { id: 'sub', session: { id: 'session-sub', header: { cwd: 'A:/parent' } } }
}

test('issue #106：解析优先级——显式覆盖 > workingDirectory 服务 > header.cwd', () => {
  const ctx = fakeCtx({ 'session-sub': 'B:/child' })
  const resolveCwd = createCwdResolver(ctx)
  const agent = subAgentProject()
  assert.equal(resolveCwd(agent), 'B:/child', '服务优先于 header')
  const shadow = withExplicitCwd('C:/explicit', agent)
  assert.equal(resolveCwd(shadow), 'C:/explicit', '显式覆盖优先于服务')
  // 服务里没有该会话（伪 agent）→ 回退 header
  assert.equal(resolveCwd({ session: { id: 'unknown', header: { cwd: 'A:/fallback' } } }), 'A:/fallback')
  // 服务抛错也不能炸：回退 header
  const brokenCtx = { get: () => ({ get() { throw new Error('boom') } }) }
  assert.equal(createCwdResolver(brokenCtx)(agent), 'A:/parent')
})

test('issue #106：子代理的 project 记忆落执行目录的桶，而不是父项目', () => {
  const dir = tempDir()
  try {
    const store = new MemoryStore(dir, { cwdResolver: createCwdResolver(fakeCtx({ 'session-sub': 'B:/child' })) })
    const agent = subAgentProject()
    const added = store.add('project', '子代理写的进展', agent)
    assert.equal(added.ok, true)
    const located = store.locate('project', agent)
    // 桶目录按执行目录哈希：B 桶存在、A 桶不存在
    const entries = store.entriesOf('project', agent)
    assert.equal(entries.length, 1)
    assert.ok(entries[0].includes('子代理写的进展'))
    // 父项目的桶里拿不到这条（这正是 issue 里"B 项目没记忆"的反面）
    const parent = store.entriesOf('project', { session: { id: 'other', header: { cwd: 'A:/parent' } } })
    assert.deepEqual(parent, [])
    // 写盘位置在项目子目录下，且不是 daily
    assert.ok(located.file.endsWith('.md'))
    const bucketDir = join(dir, 'projects')
    assert.ok(existsSync(bucketDir))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('issue #106：没有 workingDirectory 服务时行为与旧版一致（回退 header.cwd）', () => {
  const dir = tempDir()
  try {
    const store = new MemoryStore(dir, { cwdResolver: createCwdResolver({}) })
    const agent = { session: { id: 'plain', header: { cwd: 'A:/parent' } } }
    assert.equal(store.cwdOf(agent), 'A:/parent')
    assert.equal(store.add('key', '回退路径', agent).ok, true)
    const keyEntries = store.entriesOf('key', agent)
    assert.equal(keyEntries.length, 1)
    assert.ok(keyEntries[0].includes('回退路径'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('issue #106：伪 agent（Web API / 复审指定目标项目）不受解析器影响', () => {
  const dir = tempDir()
  try {
    // 服务只认识会话 session-sub，伪 agent 只有 header → 必须仍按 header 落桶
    const store = new MemoryStore(dir, {
      cwdResolver: createCwdResolver(fakeCtx({ 'session-sub': 'B:/child' })),
    })
    const pseudo = { session: { header: { cwd: 'D:/target' } } }
    assert.equal(store.add('key', '从 Web UI 写入', pseudo).ok, true)
    const pseudoEntries = store.entriesOf('key', pseudo)
    assert.equal(pseudoEntries.length, 1)
    assert.ok(pseudoEntries[0].includes('从 Web UI 写入'))
    assert.equal(store.cwdOf(pseudo), 'D:/target')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('issue #106：影子 agent 走原型链、不改真实 header，且带得出原 session', () => {
  const base = subAgentProject()
  const shadow = withExplicitCwd('C:/explicit', base)
  assert.equal(shadow[EXPLICIT_CWD], 'C:/explicit')
  assert.equal(base.session.header.cwd, 'A:/parent', '真实 header 不得被改写')
  assert.equal(shadow.session.id, 'session-sub', '影子 agent 仍能读到原会话')
  assert.equal(Object.keys(base).length, 2, '真实 agent 不新增可枚举键')
  // 无 base 时给一个等价旧行为的伪 agent
  assert.equal(withExplicitCwd('C:/only').session.header.cwd, 'C:/only')
})

test('issue #106：sameCwd 归一（Windows 反斜杠 / 大小写 / 尾斜杠）', () => {
  assert.equal(sameCwd('D:/proj', 'D:/proj/'), true)
  if (process.platform === 'win32') {
    assert.equal(sameCwd('D:\\Proj\\Sub', 'd:/proj/sub'), true)
    assert.equal(sameCwd('D:\\proj', 'D:\\other'), false)
  }
  assert.equal(sameCwd(undefined, 'D:/proj'), false)
})

test('issue #106：快照在"执行目录 ≠ 归属项目"时给一次说明，且同一会话逐轮稳定', () => {
  const dir = tempDir()
  try {
    const config = resolveConfig({ memoryDir: dir, reviewEnabled: false })
    const store = new MemoryStore(dir, {
      cwdResolver: createCwdResolver(fakeCtx({ 'session-sub': 'B:/child' })),
    })
    const agent = subAgentProject()
    store.add('key', '执行目录下的事实', agent)
    const first = renderSnapshot(config, store, agent, counter)
    const second = renderSnapshot(config, store, agent, counter)
    assert.ok(first.includes('## 工作目录说明'), '应提示目录差异')
    assert.ok(first.includes('A:/parent') && first.includes('B:/child'), '两个目录都要出现')
    assert.equal(first, second, '同一会话内文本必须稳定（不能打穿 prefix cache）')
    // 目录一致时不得出现该段
    const same = { session: { id: 'session-same', header: { cwd: 'B:/child' } } }
    const sameStore = new MemoryStore(dir, {
      cwdResolver: createCwdResolver(fakeCtx({ 'session-same': 'B:/child' })),
    })
    const sameSnap = renderSnapshot(config, sameStore, same, counter)
    assert.equal(sameSnap.includes('## 工作目录说明'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('issue #106：分支标注取执行目录的 git 分支（不是父项目）', () => {
  const dir = tempDir()
  try {
    // 无 git 的两级目录：只要不抛错、能落桶即可（真实分支解析在 tests/git-* 覆盖）
    const store = new MemoryStore(dir, {
      cwdResolver: createCwdResolver(fakeCtx({ 'session-sub': join(dir, 'child') })),
    })
    const agent = { session: { id: 'session-sub', header: { cwd: join(dir, 'parent') } } }
    assert.equal(store.add('project', '分支标注不炸', agent).ok, true)
    const projectEntries = store.entriesOf('project', agent)
    assert.equal(projectEntries.length, 1)
    assert.ok(projectEntries[0].includes('分支标注不炸'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
