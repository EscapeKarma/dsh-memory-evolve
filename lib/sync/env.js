/**
 * lib/sync/env.js — git 子进程的环境白名单（2026-11-26，巡检 B2）。
 *
 * 为什么单独成模块：`lib/sync/index.js`（worker 子进程）与 `lib/sync/repo.js`
 * （runGit 热路径）都要用同一份白名单；写在 index.js 里会被 repo.js 反向
 * import 出环。
 *
 * 旧实现是 `{ ...process.env }`——把宿主进程的全部环境变量（模型 API key、
 * `DSH_*` 令牌、CI secret）都交给了 git 子进程。git 只需要：找得到自己、
 * 找得到用户主目录与凭据、走对代理、拿到 locale。
 *
 * 明确**不放行**：`GH_TOKEN` / `GITHUB_TOKEN`（2026-08-16 那次 403 的根因，
 * 以前是手动 delete，现在靠白名单天然挡住）、任何 `*_API_KEY` / `*_TOKEN` /
 * `*_SECRET`。
 */

/** 精确放行的键（其余一律丢弃）。 */
const ALLOWED_KEYS = new Set([
  // 起进程 / 找可执行文件
  'PATH', 'PATHEXT', 'COMSPEC', 'SYSTEMROOT', 'SystemRoot', 'SYSTEMDRIVE', 'WINDIR',
  // 临时目录
  'TEMP', 'TMP', 'TMPDIR',
  // 用户主目录与配置（git 找 ~/.gitconfig、~/.ssh、凭据管理器）
  'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'USERNAME', 'USER', 'LOGNAME',
  // 代理（git/curl 读的名字大小写不统一，两种都放）
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY',
  'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
  // ssh 远程
  'SSH_AUTH_SOCK', 'SSH_AGENT_PID',
  // 企业根证书
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  // locale（git 消息语言会影响我们的英文正则判定）
  'LANG', 'LANGUAGE',
])

/**
 * 构造 git 子进程可用的环境对象。
 * @param {object} [base] - 源环境（默认 `process.env`）。
 * @returns {object} 只含白名单键的新对象（`undefined` 值被跳过）。
 */
export function workerEnv(base = process.env) {
  const out = {}
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue
    if (ALLOWED_KEYS.has(key) || key.startsWith('GIT_') || key.startsWith('LC_')) out[key] = value
  }
  return out
}
