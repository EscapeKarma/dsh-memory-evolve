import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'

/**
 * 在本机网络对 github.com 间歇性不通时，用「直连 → 本机 TLS 直通代理」两级策略推代码。
 *
 * 用法：node scripts/push.mjs [git push 的其余参数…]
 *   node scripts/push.mjs                # push origin main（或当前分支）
 *   node scripts/push.mjs origin refs/tags/v0.7.2
 *
 * 背景（2026-11-27 实测）：github.com 的部分 IP 会整段超时，只有个别 IP（当时是
 * 140.82.113.3）可用；Windows 的 git 只有 schannel 后端，无法「连 IP 但带着 github.com 的
 * SNI 做证书校验」，所以要么直连（DNS 恰好还通），要么走一个只做 TCP 转发、TLS 仍由 git
 * 端到端完成的本地代理（证书校验不受影响）。全部候选 IP 都不通时直接报错，不做 hosts 改动。
 */

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PROXY_PORT = Number(process.env.GH_PROXY_PORT ?? 8899)
const CANDIDATE_IPS = (process.env.GH_TARGET_IP ?? '140.82.113.3,20.205.243.166,20.27.177.113,140.82.112.3')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const ATTEMPTS = Number(process.env.GH_PUSH_ATTEMPTS ?? 3)
const DIRECT_TIMEOUT_MS = Number(process.env.GH_DIRECT_TIMEOUT_MS ?? 20_000)
const PROXY_TIMEOUT_MS = Number(process.env.GH_PROXY_TIMEOUT_MS ?? 60_000)

function log(...args) {
  console.log('[push]', ...args)
}

function git(args, { proxy, timeoutMs }) {
  const command = ['git', ...(proxy ? ['-c', `http.proxy=http://127.0.0.1:${PROXY_PORT}`] : []), ...args]
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ ok: false, timedOut: true, stdout, stderr: stderr + `\n[timeout ${timeoutMs}ms]` })
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
      process.stdout.write(String(chunk))
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
      process.stderr.write(String(chunk))
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, stdout, stderr: stderr + `\n${error.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, code, stdout, stderr })
    })
  })
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.setTimeout(800)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(false))
  })
}

function canReach(ip) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: ip, port: 443 })
    socket.setTimeout(2500)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(false))
  })
}

async function pickTargetIp() {
  for (const ip of CANDIDATE_IPS) {
    if (await canReach(ip)) return ip
  }
  return null
}

async function ensureProxy() {
  if (await portOpen(PROXY_PORT)) return { started: false }
  const ip = await pickTargetIp()
  if (ip === null) {
    log(`候选 IP 全部不可达：${CANDIDATE_IPS.join(', ')}`)
    return { started: false, unreachable: true }
  }
  if (!existsSync(join(ROOT, 'tmp'))) mkdirSync(join(ROOT, 'tmp'), { recursive: true })
  const out = join(ROOT, 'tmp', 'gh-proxy.log')
  appendFileSync(out, `\n=== ${new Date().toISOString()} start proxy -> ${ip}:443 ===\n`)
  const child = spawn(process.execPath, [join(ROOT, 'tmp', 'gh-proxy.mjs')], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, GH_TARGET_IP: ip },
  })
  child.unref()
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    if (await portOpen(PROXY_PORT)) return { started: true, ip }
  }
  return { started: false, unreachable: true }
}

async function main() {
  const passthrough = process.argv.slice(2)
  const args = passthrough.length > 0 ? ['push', ...passthrough] : ['push', 'origin', 'HEAD']

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    log(`直连尝试 ${attempt}/${ATTEMPTS}: git ${args.join(' ')}`)
    const direct = await git(args, { proxy: false, timeoutMs: DIRECT_TIMEOUT_MS })
    if (direct.ok) {
      log('直连成功')
      return
    }
    if (direct.timedOut || /timed out|Connection was reset|Could not resolve|Failed to connect/i.test(direct.stderr)) {
      log('直连失败，改用本机 TLS 直通代理')
    } else {
      log('直连失败（非网络原因），不再重试')
      process.exit(direct.code ?? 1)
    }

    const proxy = await ensureProxy()
    if (proxy.unreachable) {
      log('代理不可用（无可用 github.com IP），稍后重试')
      await new Promise((r) => setTimeout(r, 5000))
      continue
    }
    log(`代理就绪（${proxy.started ? `新起，目标 ${proxy.ip}` : '复用已有进程'}），尝试推送`)
    const proxied = await git(args, { proxy: true, timeoutMs: PROXY_TIMEOUT_MS })
    if (proxied.ok) {
      log('代理推送成功')
      return
    }
    log('代理推送失败，重试')
    await new Promise((r) => setTimeout(r, 4000))
  }
  log('多次尝试仍失败；可稍后再试，或用 node scripts/push.mjs 指定 GH_TARGET_IP')
  process.exit(1)
}

main()
