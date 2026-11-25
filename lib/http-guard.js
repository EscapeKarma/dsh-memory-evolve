/**
 * 同源校验（插件所有 HTTP 端点的统一入口）。
 *
 * 设计目标：只回答一个问题——**这个请求是不是从本机插件界面发出的**。
 * 用户认证由宿主负责（DSH 0.2.2-rc.5 起宿主已对插件 prefix 路由做 401），
 * 这一层是纵深防御：更早的宿主版本没有认证，缺了它就是"任意网页可读写记忆"。
 *
 * 四层判定（写操作全过、读操作跳过内容类型那一层）：
 *   L1 方法：写操作必须是 JSON（跨站"简单请求"只能发 text/plain，被这一层拦住）
 *   L2 Sec-Fetch-Site：浏览器明确标注 cross-site / same-site 时直接拒绝
 *   L3 Origin：存在时要求与 Host 同值，且 **Host 必须是本机回环**（防 DNS rebinding：
 *      攻击者把 evil.com 解析到 127.0.0.1 后 Origin 与 Host 会相等，只比相等会被绕过）
 *   L4 无 Origin：要求 TCP 对端是本机；连对端信息都没有（宿主进程内转发）时退回要求
 *      Host 是本机回环。
 *
 * 非本机访问（局域网 / 内网穿透 / 反代）默认拒绝；确需使用时把域名写进
 * 配置项 `trustedHosts`（字符串数组，默认空），命中即视为可信 Host。
 *
 * @module dsh-memory-evolve/http-guard
 */

/** 恒定可信的本机主机名。 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** 把 Host 头归一成小写主机名（去端口、去 IPv6 方括号）。 */
export function hostName(hostHeader) {
  const raw = String(hostHeader ?? '').trim().toLowerCase()
  if (raw === '') return ''
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']')
    return end === -1 ? raw.slice(1) : raw.slice(1, end)
  }
  const parts = raw.split(':')
  // 一个冒号 = 主机:端口；多个冒号 = 裸 IPv6（不能按冒号切）
  return parts.length === 2 ? parts[0] : raw
}

/** 是否为本机回环主机名（含 trustedHosts 白名单）。 */
export function isTrustedHost(hostHeader, trustedHosts = []) {
  const name = hostName(hostHeader)
  if (name === '') return false
  if (LOOPBACK_HOSTS.has(name)) return true
  if (name.startsWith('127.')) return true
  for (const entry of trustedHosts ?? []) {
    const allowed = hostName(entry)
    if (allowed !== '' && allowed === name) return true
  }
  return false
}

/** 从配置里取 trustedHosts（容忍缺省与非数组写法）。 */
export function trustedHostsOf(config) {
  const raw = config?.trustedHosts
  if (!Array.isArray(raw)) return []
  return raw.map((item) => String(item ?? '').trim()).filter((item) => item !== '')
}

/** 请求对端是否为回环（拿不到对端信息时返回 null）。 */
export function peerIsLoopback(req) {
  const peer = String(req?.socket?.remoteAddress ?? req?.connection?.remoteAddress ?? '')
  if (peer === '') return null
  const addr = peer.startsWith('::ffff:') ? peer.slice(7) : peer
  return addr === '::1' || addr.startsWith('127.')
}

/**
 * 校验一个请求。
 *
 * @param {object} req - node:http 请求
 * @param {{ needJson?: boolean, trustedHosts?: string[] }} [opts]
 *   needJson：写操作要求 `application/json`（读操作传 false）。
 * @returns {null | { status: number, code: string, error: string }} 通过返回 null
 */
export function guardRequest(req, opts = {}) {
  const needJson = opts.needJson !== false
  const explicit = Array.isArray(opts.trustedHosts) ? opts.trustedHosts : []
  const trustedHosts = explicit.length > 0 ? explicit : moduleTrustedHosts
  const method = String(req?.method ?? "GET").toUpperCase()
  const isWrite = method !== "GET" && method !== "HEAD" && method !== "OPTIONS"
  const headers = req?.headers ?? {}
  const host = String(headers.host ?? "")
  const origin = String(headers.origin ?? "")

  // ① 浏览器主动标注的跨站请求：最明确、最先判。
  const site = String(headers["sec-fetch-site"] ?? "").toLowerCase()
  if (site === "cross-site" || site === "same-site") {
    return { status: 403, code: "GUARD_CROSS_SITE", error: "跨站请求已拒绝" }
  }

  // ② Origin 与 Host 不一致 = 跨站（浏览器发起的写/读都带 Origin）。
  if (origin !== "") {
    if (origin === "null") {
      return { status: 403, code: "GUARD_ORIGIN_NULL", error: "跨站请求已拒绝（Origin: null）" }
    }
    let originHost = ""
    try {
      originHost = new URL(origin).host
    } catch {
      return { status: 403, code: "GUARD_ORIGIN_INVALID", error: "跨站请求已拒绝" }
    }
    if (originHost !== host) {
      return { status: 403, code: "GUARD_CROSS_SITE", error: "跨站请求已拒绝" }
    }
  }

  // ③ 写操作「带请求体」时必须是 JSON：跨站表单只能发 text/plain 与
  //    form-urlencoded，这一层让「同源但非插件界面」的调用也无法塞载荷。
  //    无体的 POST（「立即评审」「重试」等按钮）由 fetch 发出、不带
  //    content-type，放行。
  if (needJson && isWrite) {
    const contentType = String(headers["content-type"] ?? "").split(";")[0].trim().toLowerCase()
    const hasBody = (Number(String(headers["content-length"] ?? "0")) || 0) > 0
      || headers["transfer-encoding"] !== undefined
    if ((hasBody || contentType !== "") && contentType !== "application/json") {
      return { status: 415, code: "GUARD_CONTENT_TYPE", error: "请求必须为 application/json" }
    }
  }

  // ④ 带 Origin 的同值请求：还要求 Host 本身可信（防 DNS rebinding——把
  //    evil.com 解析到 127.0.0.1 后 Origin 与 Host 都是 evil.com）。
  if (origin !== "") {
    if (!isTrustedHost(host, trustedHosts)) {
      return { status: 403, code: "GUARD_UNTRUSTED_HOST", error: "非本机访问已拒绝（如确需远程访问，请配置 trustedHosts）" }
    }
    return null
  }

  // ⑤ 无 Origin：本机脚本、桌面端宿主进程内转发都走这条。
  //    Host 完全缺失 = 进程内合成的请求（浏览器与代理一定会带 Host），
  //    这类调用没有 CSRF 面（不是来自浏览器），按旧行为放行。
  if (host === "") return null
  const loopbackPeer = peerIsLoopback(req)
  if (loopbackPeer === null) {
    // 连对端信息都没有：只可能是宿主内部转发，此时 Host 必须可信。
    if (!isTrustedHost(host, trustedHosts)) {
      return { status: 403, code: "GUARD_UNTRUSTED_HOST", error: "非本机访问已拒绝（如确需远程访问，请配置 trustedHosts）" }
    }
    return null
  }
  if (loopbackPeer === false) {
    return { status: 403, code: "GUARD_REMOTE_PEER", error: "非本机访问已拒绝" }
  }
  return null
}

/** 插件级 trustedHosts（apply 时由 lib/index.js 设置一次；测试可传 opts 覆盖）。 */
let moduleTrustedHosts = []

/** 设置插件级 trustedHosts（供 30 处 handler 免参调用）。 */
export function setTrustedHosts(next) {
  moduleTrustedHosts = Array.isArray(next) ? next.map((item) => String(item ?? '')) : []
  return moduleTrustedHosts.length
}

/** 当前插件级 trustedHosts（只读副本）。 */
export function currentTrustedHosts() {
  return [...moduleTrustedHosts]
}

/**
 * 把 guard 的失败结果直接写成 JSON 响应（各 handler 开头统一调用）。
 *
 * @param {object} res - node:http 响应
 * @param {{ status: number, code: string, error: string }} failure
 */
export function rejectGuarded(res, failure) {
  const body = JSON.stringify({ ok: false, code: failure.code, error: failure.error })
  res.writeHead(failure.status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

/**
 * 端点包装：把 guard 的失败结果直接写成 JSON 响应。
 *
 * @param {object} deps - `{ getTrustedHosts?: () => string[] }`
 * @param {(req: object) => Promise<void>} handler
 * @returns {(req: object, res: object) => Promise<void>}
 */
export function withGuard(deps, handler) {
  return async function guarded(req, res) {
    const trustedHosts = typeof deps?.getTrustedHosts === 'function' ? deps.getTrustedHosts() : []
    const failure = guardRequest(req, { trustedHosts })
    if (failure !== null) {
      rejectGuarded(res, failure)
      return
    }
    return handler(req, res)
  }
}
