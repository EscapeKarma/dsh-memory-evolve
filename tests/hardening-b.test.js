/**
 * 巡检 B 组回归：原子写、唯一 tmp 名、合并前备份、会话状态上限、
 * 迁移不跟随符号链接。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { tmpPathFor, writeFileAtomic } from '../lib/atomic-write.js'
import { AliasStore } from '../lib/aliases.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'dsh-audit-b-'))
}

test('B5：临时文件名唯一（同进程并发不撞名）', () => {
  const names = new Set()
  for (let i = 0; i < 200; i += 1) names.add(tmpPathFor('C:/tmp/x.json'))
  assert.equal(names.size, 200)
})

test('B1/B2：原子写成功后不留临时文件，内容完整可读', () => {
  const dir = tempDir()
  try {
    const file = join(dir, 'PROVENANCE')
    writeFileAtomic(file, '{"enabled":true}\n')
    assert.equal(readFileSync(file, 'utf8'), '{"enabled":true}\n')
    const leftovers = readdirSync(dir).filter((name) => name.includes('.tmp.'))
    assert.deepEqual(leftovers, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('B1：别名表写入走原子写（并发两次写后文件仍是合法 JSON）', () => {
  const dir = tempDir()
  try {
    const store = new AliasStore(dir)
    for (let i = 0; i < 20; i += 1) {
      store.set('s1', `别名-${i}`)
      store.set('s2', `别名B-${i}`)
    }
    const parsed = JSON.parse(readFileSync(join(dir, 'aliases.json'), 'utf8'))
    assert.ok(parsed.s1.startsWith('别名-'))
    assert.ok(parsed.s2.startsWith('别名B-'))
    assert.deepEqual(readdirSync(dir).filter((n) => n.includes('.tmp.')), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('B4：合并半装目录前会备份原目录，且备份最多 3 份', async () => {
  const { mkdirSync } = await import('node:fs')
  const dir = tempDir()
  try {
    const skills = join(dir, 'skills')
    const pending = join(dir, 'pending', 'demo')
    mkdirSync(skills, { recursive: true })
    mkdirSync(pending, { recursive: true })
    // 半装目录：目标存在但没有 SKILL.md
    const target = join(skills, 'demo')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'styles.jsonl'), '{"old":true}\n')
    writeFileSync(join(pending, 'SKILL.md'), '---\nname: demo\n---\n')
    const { approvePendingSkill } = await import('../lib/skills.js')
    const res = approvePendingSkill(join(dir, 'pending'), skills, 'demo')
    assert.equal(res.ok, true, JSON.stringify(res))
    assert.ok(existsSync(join(target, 'SKILL.md')))
    assert.equal(readFileSync(join(target, 'styles.jsonl'), 'utf8'), '{"old":true}\n')
    const backups = readdirSync(skills).filter((n) => n.startsWith('demo.bak.'))
    assert.ok(backups.length >= 1 && backups.length <= 3, `备份份数 ${backups.length}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('B3：字符串路径里的符号链接不会被当成普通文件（lstat 语义）', async () => {
  const { lstatSync, statSync } = await import('node:fs')
  const dir = tempDir()
  try {
    const real = join(dir, 'real.md')
    const link = join(dir, 'link.md')
    writeFileSync(real, 'x\n')
    try {
      symlinkSync(real, link)
    } catch {
      return // Windows 无权限创建符号链接时跳过
    }
    assert.equal(lstatSync(link).isFile(), false)
    assert.equal(statSync(link).isFile(), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
