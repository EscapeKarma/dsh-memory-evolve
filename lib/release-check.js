/**
 * dsh-memory-evolve — 发布版本只读检查（lib/release-check.js）。
 *
 * 为什么需要它：`lib/update.js` 的一键更新完全建立在 git 之上（读 tag、比
 * `ls-remote`、`checkout --detach`），只对 `git clone` 安装的用户可用。用
 * `dsh plugin add github:…` 或插件市场装到 profile 的，是没有 `.git` 的
 * tarball 副本——这类用户打开「版本」页只会看到「插件目录不是 git 仓库」，
 * 既像报错、又给了做不到的建议（issues #…「更新按钮对我没用」）。
 *
 * 本模块提供一条**只读**的兜底通道：
 *   - 一次 GET GitHub Releases（必要时退回 tags），只读 `tag_name` 等元信息；
 *   - 与本机 `package.json` 的 version 比对，告诉用户「有没有新版」；
 *   - 缓存 24h，永不自动下载、不写 node_modules、不重启、不要 token；
 *   - 失败（断网 / 限流 / 403）静默沿用上次结果，绝不把插件搞崩。
 *
 * 升级动作仍然交给用户：包安装的升级路径是插件市场或 `dsh plugin add`，
 * 本模块只负责「告诉你该升了」，不替你升——把写权限收在用户手里。
 *
 * Zero runtime dependencies（只用 Node 内建 fetch/fs）。
 *
 * @module dsh-memory-evolve/release-check
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parseVersion, compareVersions } from './update.js'

/** 发布检查缓存有效期：24h（与 git 检测的 TTL 对齐）。 */
export const RELEASE_TTL_MS = 24 * 60 * 60 * 1000
/** 单次发布检查超时：8s（只读 GET，慢链路也不该挂住 UI）。 */
export const RELEASE_TIMEOUT_MS = 8000

/** 默认仓库（fork 自己的发布就在这儿）。 */
export const DEFAULT_OWNER = 'EscapeKarma'
export const DEFAULT_REPO = 'dsh-memory-evolve'

/** 缓存文件名（与 update-state.json 放同一目录，但互不影响）。 */
const RELEASE_STATE_FILE = 'release-state.json'

const API_BASE = 'https://api.github.com'

/**
 * 取「最新发布」。
 *
 * 优先 `/releases/latest`（自动排除 draft / prerelease，正是用户想要的
 * 「最新正式版」）；仓库只打了 tag 还没建 Release 时它返回 404，此时退回
 * `/tags?per_page=1`——GitHub 的 tags 接口按名排序，对本项目 `v0.x.y` 的
 * 递增命名来说…并不可靠（字符串序 `v0.10.0` < `v0.9.0`），所以退路里会取
 * 全部 tag 再用 `compareVersions` 求最大值，宁可贵一点也不能报错版本。
 *
 * @returns {Promise<{ok:boolean, tag:string|null, url:string, publishedAt:number|null,
 *   error:{kind:string, message:string}|null}>}
 */
export async function fetchLatestRelease(opts = {}) {
  const owner = opts.owner ?? DEFAULT_OWNER
  const repo = opts.repo ?? DEFAULT_REPO
  // 显式传 null 表示「这个运行时没有 fetch」（测试 & 极老运行时），
  // 不能用 ?? 兜底成全局 fetch。
  const fetchImpl = Object.hasOwn(opts, 'fetchImpl') ? opts.fetchImpl : globalThis.fetch
  const timeoutMs = opts.timeoutMs ?? RELEASE_TIMEOUT_MS
  const userAgent = opts.userAgent ?? `${repo} release-check`
  if (typeof fetchImpl !== 'function') {
    return { ok: false, tag: null, url: '', publishedAt: null, error: { kind: 'no-fetch', message: '当前运行时没有 fetch' } }
  }

  const headers = { accept: 'application/vnd.github+json', 'user-agent': userAgent }
  const request = async (path) => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
    try {
      const res = await fetchImpl(`${API_BASE}${path}`, { headers, signal: controller?.signal })
      return { status: res.status, json: await res.json().catch(() => null) }
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }

  try {
    const latest = await request(`/repos/${owner}/${repo}/releases/latest`)
    if (latest.status === 200 && latest.json) {
      const tag = normalizeTag(latest.json.tag_name)
      const at = Date.parse(latest.json.published_at ?? latest.json.created_at ?? '')
      return { ok: true, tag: tag.ok ? tag.tag : null, url: String(latest.json.html_url ?? ''), publishedAt: Number.isFinite(at) ? at : null, error: null }
    }
    if (latest.status !== 404) {
      return { ok: false, tag: null, url: '', publishedAt: null, error: { kind: 'http', message: `GitHub 返回 ${latest.status}` } }
    }
    // 只有 tag、没有 Release：退回 tags 列表，取版本最高的那个。
    const tags = await request(`/repos/${owner}/${repo}/tags?per_page=100`)
    if (tags.status !== 200 || !Array.isArray(tags.json)) {
      return { ok: false, tag: null, url: '', publishedAt: null, error: { kind: 'http', message: `GitHub 返回 ${tags.status}` } }
    }
    // 本项目历史上有两套 tag：日期制（`v26081301`）与语义化（`v0.3.0`）。
    // 日期制在字符串序与段数比较里都会「大于」语义化版本，直接取最大会
    // 把最新版报成两年前的日期版本。所以：有语义化 tag 时只在语义化里挑，
    // 一个都没有才退回日期制（v0.1.0 时期的老仓库）。
    const semver = []
    const dated = []
    for (const item of tags.json) {
      const text = typeof item?.name === 'string' ? item.name.trim() : ''
      if (/^v\d+\.\d+\.\d+$/.test(text)) semver.push(text)
      else if (parseVersion(text)) dated.push(text)
    }
    const pool = semver.length > 0 ? semver : dated
    let best = null
    for (const tag of pool) {
      if (best === null || cmpTags(tag, best) > 0) best = tag
    }
    if (best === null) {
      return { ok: false, tag: null, url: '', publishedAt: null, error: { kind: 'no-release', message: '仓库还没有发布版本' } }
    }
    return { ok: true, tag: best, url: `https://github.com/${owner}/${repo}/releases/tag/${best}`, publishedAt: null, error: null }
  } catch (err) {
    const aborted = err?.name === 'AbortError'
    return {
      ok: false,
      tag: null,
      url: '',
      publishedAt: null,
      error: { kind: aborted ? 'timeout' : 'network', message: aborted ? `请求超时（${timeoutMs}ms）` : String(err?.message ?? err) },
    }
  }
}

/** 比较两个版本号字符串（允许 `0.3.0` 与 `v0.3.0` 混用）。 */
function cmpTags(a, b) {
  const pa = parseVersion(normalizeVersionText(a))
  const pb = parseVersion(normalizeVersionText(b))
  if (!pa || !pb) return 0
  return compareVersions(pa, pb)
}

/**
 * 统一成 `parseVersion` 认识的严格格式：
 *   - `0.3.0`（package.json 的写法）→ `v0.3.0`；
 *   - `v0.3.0` 原样；
 *   - 其它（日期制 tag `v26092801` 等）原样返回，由 parseVersion 决定是否合法。
 */
function normalizeVersionText(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (/^\d+\.\d+\.\d+$/.test(text)) return `v${text}`
  return text
}

/** 只认 `v<major>.<minor>.<patch>`（与 lib/update.js 的严格格式一致）。 */
function normalizeTag(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  return parseVersion(text) ? { ok: true, tag: text } : { ok: false, tag: null }
}

/** 原子写 JSON（先写临时文件再 rename，避免半截文件被读到）。 */
function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}

/**
 * 创建发布检查器。
 *
 * @param {object} opts
 * @param {string} [opts.currentVersion] 本机版本（缺省读 package.json）
 * @param {string} [opts.stateDir] 缓存目录（缺省 `~/.dsh`）
 * @param {Function} [opts.fetchImpl] 注入点（测试用假 fetch）
 * @param {() => number} [opts.now] 注入点（测试用假时钟）
 */
export function createReleaseChecker(opts = {}) {
  const stateDir = opts.stateDir ?? join(homedir(), '.dsh')
  const stateFile = join(stateDir, RELEASE_STATE_FILE)
  const now = opts.now ?? Date.now
  const fetchOpts = { ...opts }

  let inFlight = null

  function loadCache() {
    try {
      const parsed = JSON.parse(readFileSync(stateFile, 'utf8'))
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  function readCurrentVersion() {
    if (typeof opts.currentVersion === 'string' && opts.currentVersion.length > 0) return opts.currentVersion
    try {
      const pkg = JSON.parse(readFileSync(opts.packageJsonPath ?? defaultPackageJson(), 'utf8'))
      return typeof pkg?.version === 'string' ? pkg.version : null
    } catch {
      return null
    }
  }

  /** 把缓存 + 本次结果拼成对外结构（不含任何上游原始 JSON）。 */
  function shape(cache, extra = {}) {
    const current = readCurrentVersion()
    const latest = cache.latest ?? null
    const hasUpdate = Boolean(current && latest && cmpTags(latest, current) > 0)
    return {
      current,
      latest,
      hasUpdate,
      url: typeof cache.url === 'string' ? cache.url : '',
      publishedAt: typeof cache.publishedAt === 'number' ? cache.publishedAt : null,
      checkedAt: typeof cache.checkedAt === 'number' ? cache.checkedAt : null,
      error: extra.error ?? null,
    }
  }

  async function runCheck(cache) {
    const res = await fetchLatestRelease(fetchOpts)
    const at = now()
    if (!res.ok) {
      // 失败不覆盖已知的最新版本：网络抖一下不该让「有新版本」提示消失。
      return shape(cache, { error: res.error })
    }
    const next = { latest: res.tag, url: res.url, publishedAt: res.publishedAt, checkedAt: at }
    try {
      writeJsonAtomic(stateFile, next)
    } catch {
      /* 缓存写不了（只读目录等）不影响本次结果 */
    }
    return shape(next)
  }

  /**
   * 查询发布状态。
   * @param {boolean} [force] 绕过 24h 缓存（用户点「检查」时）
   */
  async function status(force = false) {
    const cache = loadCache()
    const at = now()
    const fresh = typeof cache.checkedAt === 'number' && cache.checkedAt > 0 && at - cache.checkedAt < RELEASE_TTL_MS
    if (!force && fresh) return shape(cache)
    if (inFlight !== null) return inFlight
    inFlight = runCheck(cache).finally(() => { inFlight = null })
    return inFlight
  }

  return {
    status,
    /**
     * 只读缓存、绝不发起网络请求——给 30s 轮询的红点用。
     * 包安装形态下 `badgeUpdate()` 恒为 0（没有 git 就没有 tag 比对），
     * 红点只能靠这里缓存下来的 `hasUpdate`。
     */
    cached: () => shape(loadCache()),
    _internal: { loadCache, stateFile },
  }
}

/** 默认 package.json 路径（插件根目录，与 lib/ 同级）。 */
function defaultPackageJson() {
  return join(dirname(dirname(fileURLToPath(import.meta.url))), 'package.json')
}

/** 生产单例：进程内只建一次（缓存路径、单飞都在实例内）。 */
let singleton = null
export function getReleaseChecker(opts = {}) {
  if (singleton === null) singleton = createReleaseChecker(opts)
  return singleton
}
