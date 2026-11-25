/**
 * 有效工作目录（issue #106）。
 *
 * 问题：`project` / `key` 轨的桶只按 `agent.session.header.cwd` 定位，而 DSH
 * 官方语义里 `session.header.cwd` 是**归属项目**，不是当前执行目录：
 *   - 子代理 / Team 成员可以把 `cwd` 指到别的项目，但 header 仍保留父会话目录；
 *   - 看板卡片、squad 成员可以钉一个和会话不同的 workspace。
 * 结果是这些会话写 `project` / `key` 记忆时静默落到父项目桶，B 项目一条都没有。
 *
 * 官方架构要求「消费者读取 working-directory 服务，而不是从 header 或沙箱根
 * 目录派生执行路径」。所以这里做一个**单一入口**，优先级从高到低：
 *   1. 显式覆盖（`EXPLICIT_CWD` 符号）：本插件自己的跨桶读写 / Web API 用
 *      「影子 agent」指定目标项目时使用，语义等价于旧版覆写 header.cwd；
 *   2. 宿主 `workingDirectory` 服务（`get(session)`）——真正执行目录；
 *   3. `session.header.cwd`——兜底，并在注释里标注为历史兼容。
 *
 * 两条纪律：
 *   - 绝不改写 Session header（官方已把它列为否决方案，改了会污染会话记录）；
 *   - 服务缺失 / 抛错一律静默回退，不能让旧运行时上的读写直接失败。
 */

/**
 * 显式工作目录覆盖：挂在「影子 agent」上的符号键。
 * 用 Symbol.for 保证跨模块实例（不同 import 图）拿到同一个键。
 */
export const EXPLICIT_CWD = Symbol.for('dsh-memory-evolve.explicitCwd')

/**
 * 安全读一个宿主服务：Cordis 4 起未声明的属性访问会抛错，必须包起来。
 * @param {object} ctx - 插件上下文。
 * @param {string} name - 服务名。
 * @returns {any} 服务实例或 undefined。
 */
function serviceOf(ctx, name) {
  if (ctx === null || typeof ctx !== 'object') return undefined
  try {
    const got = typeof ctx.get === 'function' ? ctx.get(name) : undefined
    if (got !== undefined && got !== null) return got
  } catch { /* 未声明/未装配：继续尝试属性访问 */ }
  try {
    return ctx[name] ?? undefined
  } catch {
    return undefined
  }
}

/**
 * 安全读 session.header：子代理场景下的 session 可能是只读投影。
 * @param {object} session - 会话对象。
 * @returns {object | undefined} header。
 */
function headerOf(session) {
  try {
    return session?.header ?? undefined
  } catch {
    return undefined
  }
}

/**
 * 创建一个「有效工作目录」解析器（绑定了 ctx）。
 * @param {object} ctx - 插件上下文（可为 null：纯回退模式）。
 * @returns {(agent: object | undefined) => string | undefined}
 */
export function createCwdResolver(ctx) {
  // 只查一次服务：workingDirectory 是常驻服务，热路径上不必每次 ctx.get。
  const workingDirectory = serviceOf(ctx, 'workingDirectory')
  return function resolveCwd(agent) {
    if (agent === null || typeof agent !== 'object') return undefined
    // 1) 显式覆盖（跨桶读写用的影子 agent）。
    const explicit = agent[EXPLICIT_CWD]
    if (typeof explicit === 'string' && explicit !== '') return explicit
    // 2) 宿主 working-directory 服务：子代理 / pinned workspace 的真实执行目录。
    if (workingDirectory !== undefined && typeof workingDirectory.get === 'function') {
      try {
        const dir = workingDirectory.get(agent.session)
        if (typeof dir === 'string' && dir.trim() !== '') return dir
      } catch { /* 会话未注册/服务暂不可用：回退 header */ }
    }
    // 3) header.cwd 兜底（历史行为；子代理上它等于父项目）。
    const header = headerOf(agent.session)
    const cwd = header?.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
  }
}

/**
 * 判断两个目录字符串是否指向同一位置（仅用于提示「落桶不同于会话项目」）。
 * Windows 大小写不敏感、两种分隔符混用；不做 realpath（不碰文件系统）。
 * @param {string} a - 目录 a。
 * @param {string} b - 目录 b。
 * @returns {boolean} 是否相同。
 */
export function sameCwd(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const norm = (p) => {
    let out = p.replace(/\\/g, '/')
    out = out.replace(/\/+$/, '')
    return process.platform === 'win32' ? out.toLowerCase() : out
  }
  return norm(a) === norm(b)
}

/**
 * 构造一个「指定工作目录」的影子 agent（跨桶读写 / Web API 用）。
 * 与旧版覆写 header.cwd 的区别：不打乱真实 header，只挂一个符号覆盖。
 * @param {string} cwd - 目标项目目录。
 * @param {object} [base] - 可选的原始 agent（保留其 session 供审核/日志读取）。
 * @returns {object} 影子 agent。
 */
export function withExplicitCwd(cwd, base) {
  const shadow = base === null || typeof base !== 'object'
    ? { session: { header: { cwd } } }
    : Object.create(base, {
      [EXPLICIT_CWD]: {
        value: cwd,
        enumerable: false,
        configurable: true,
        writable: true,
      },
    })
  return shadow
}
