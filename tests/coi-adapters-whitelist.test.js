/**
 * COI 适配器白名单（2026-11-25 巡检 P0-2）。
 *
 * 背景：自定义适配器等于「任意命令执行」——`binary` / `args` / `testCmd` 都是
 * 用户可写字段，而「测试适配器」按钮会真的把它跑起来。巡检里确认了完整攻击链：
 * 跨站 POST 打开 COI → 写入 binary=任意程序的适配器 → 点测试。第一环由
 * http-guard 堵住，这里是第二环：适配器表只接受内置 id，且只接受外观/超时类
 * 字段覆盖。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AdapterStore, BUILTIN_ADAPTERS, sanitizeOverride } from '../lib/coi/adapters.js'

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-adapters-test-'))
  return { dir, file: join(dir, 'adapters.json') }
}

test('适配器白名单：拒绝注册自定义适配器（任意 binary 不再可能）', () => {
  const { dir, file } = tempFile()
  try {
    const store = new AdapterStore(file)
    assert.throws(
      () => store.upsert({ id: 'evil', name: 'Evil', type: 'plain-cli', binary: 'calc.exe', args: ['/c', 'start'] }),
      /已停止接受自定义适配器/,
    )
    assert.equal(store.get('evil'), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('适配器白名单：内置 id 只接受外观与超时字段，命令面字段被剔除', () => {
  const store = new AdapterStore(join(mkdtempSync(join(tmpdir(), 'dsh-adapters-test-')), 'adapters.json'))
  const builtin = BUILTIN_ADAPTERS.codex
  const merged = store.upsert({
    id: 'codex',
    name: '我的 Codex',
    useCase: '自定义说明',
    binary: 'evil.exe',
    args: ['--pwn'],
    testCmd: ['--pwn'],
    env: { NODE_OPTIONS: '--require /tmp/evil.js' },
    resume: { kind: 'flag', flag: '--pwn' },
    defaults: { timeoutMs: 600000 },
  })
  assert.equal(merged.name, '我的 Codex')
  assert.equal(merged.useCase, '自定义说明')
  assert.equal(merged.defaults.timeoutMs, 600000)
  // 命令面字段必须还是内置值
  assert.equal(merged.binary, builtin.binary)
  assert.deepEqual(merged.args, builtin.args)
  assert.deepEqual(merged.testCmd, builtin.testCmd)
  assert.deepEqual(merged.env, builtin.env)
  assert.deepEqual(merged.resume, builtin.resume)
})

test('适配器白名单：磁盘上已有的恶意自定义适配器在加载时被丢弃', () => {
  const { dir, file } = tempFile()
  try {
    writeFileSync(file, JSON.stringify({
      evil: { id: 'evil', name: 'Evil', type: 'plain-cli', binary: 'calc.exe', args: [] },
      codex: { id: 'codex', name: '被篡改', binary: 'evil.exe', args: ['--pwn'] },
    }))
    const store = new AdapterStore(file)
    assert.equal(store.get('evil'), undefined, '自定义 id 必须被丢弃')
    const codex = store.get('codex')
    assert.equal(codex.name, '被篡改', '外观字段保留')
    assert.equal(codex.binary, BUILTIN_ADAPTERS.codex.binary, '命令面字段回退内置值')
    assert.deepEqual(codex.args, BUILTIN_ADAPTERS.codex.args)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('适配器白名单：sanitizeOverride 对畸形输入不抛错', () => {
  assert.deepEqual(sanitizeOverride(null), {})
  assert.deepEqual(sanitizeOverride('x'), {})
  assert.deepEqual(sanitizeOverride([]), {})
  assert.deepEqual(sanitizeOverride({ name: '' }), {})
  assert.deepEqual(sanitizeOverride({ defaults: { timeoutMs: -5 } }), {})
  assert.deepEqual(sanitizeOverride({ defaults: { timeoutMs: 1000.7 } }), { defaults: { timeoutMs: 1000 } })
})

test('适配器白名单：覆盖项会落盘，但落盘内容不含命令面字段', () => {
  const { dir, file } = tempFile()
  try {
    const store = new AdapterStore(file)
    store.upsert({ id: 'kimi', name: 'Kimi（自定义）', binary: 'evil.exe' })
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(saved.kimi.name, 'Kimi（自定义）')
    assert.equal(saved.kimi.binary, undefined, '落盘文件里不得出现 binary')
    assert.equal(saved.kimi.args, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
