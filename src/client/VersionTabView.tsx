/**
 * dsh-memory-evolve — version tab (settings tab sub-entry).
 *
 * 「版本」子 Tab：插件版本 / 安装形态 / 可选升级方式（v0.4.0 改造）。
 *
 * 为什么改：旧版整页只为 `git clone` 安装设计——包安装（插件市场 /
 * `dsh plugin add github:…`）的目录里没有 `.git`，一进来就是「不支持自动
 * 检测 + 插件目录不是 git 仓库（请用 git clone 安装）」，既像报错、又给了
 * 一个普通用户不会做的建议。现在按安装形态分三种呈现：
 *
 *   1. `source`（git clone）：保留原有「检查 / 更新到 vX.Y.Z」全流程，
 *      并明确标注这是开发者路径（会切换本地工作树）；
 *   2. `package`（市场 / add 安装）：不再假装支持一键更新，改为显示
 *      当前版本 + 一条可复制的升级命令 + 只读的「有没有新版」提示；
 *   3. 加载中：只显示占位，避免闪一下「不支持」再变成正常内容。
 *
 * 数据面：GET /memory-evolve/api/update/status（?force=1 强制重检）与
 * POST /memory-evolve/api/update（{ expectedTag }）。服务端负责全部 git
 * 操作与安全校验（严格 tag 格式 / 24h 惰性缓存 / 原子更新锁 / dirty 检查 /
 * 信任校验 / 失败回滚），**更新结果不存组件 state**（restartRequired 由
 * 服务端派生并持久化，重挂/刷新后横幅仍在）。
 *
 * 只读检查（`state.release`）：服务端一次 GET GitHub Releases，缓存 24h；
 * 只显示，不下载、不重装——升级动作始终留给用户点。
 */
import { useEffect, useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'

/** Locale-bound props（memory-evolve 命名空间）。 */
export interface VersionTabViewProps {
  t: Translate
}

/** SettingsTabView 引用用（同 VersionTabViewProps，兼容名）。 */
export type VersionTabTabProps = VersionTabViewProps

/** 只读发布检查结果（服务端 /api/update/status 的 release 字段）。 */
interface ReleaseInfo {
  current?: string | null
  latest?: string | null
  hasUpdate?: boolean
  url?: string
  checkedAt?: number | null
  publishedAt?: number | null
  error?: { kind?: string; message?: string } | null
}

/** 服务端状态对象（/api/update/status 的 DTO 白名单，字段对齐 lib/update.js）。 */
interface UpdateState {
  ok?: boolean
  status?: string // latest | outdated | no-release | unsupported | unknown
  /** source=git clone；package=市场/`dsh plugin add` 安装（无 .git）。 */
  installKind?: 'source' | 'package'
  /** 插件自身版本（package.json version）。 */
  pluginVersion?: string | null
  latestTag?: string | null
  localTag?: string | null
  noteCode?: string
  lastAttemptAt?: number | null
  lastSuccessAt?: number | null
  lastError?: { kind?: string; message?: string } | null
  restartRequired?: boolean
  lastUpdated?: { tag?: string; at?: number; notes?: string } | null
  release?: ReleaseInfo | null
}

/** 更新接口返回（POST /api/update）。 */
interface UpdateOutcome {
  ok: boolean
  code?: string
  error?: string
  tag?: string
  releaseNotes?: string
  restartRequired?: boolean
}

/** 统一错误对象（code → 字典文案；message 兜底展示）。 */
interface ViewError {
  code: string
  message: string
}

/** 包安装的升级命令（用户复制到终端，或去插件页点「更新」）。 */
export const UPGRADE_COMMAND = 'dsh plugin --profile <profile> add github:EscapeKarma/dsh-memory-evolve'

/** 刷新当前状态（force 走「检查更新」语义）。 */
async function fetchStatus(force: boolean): Promise<UpdateState> {
  const res = await fetch(`/memory-evolve/api/update/status${force ? '?force=1' : ''}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as UpdateState
}

/** 毫秒时间戳 → 本地短时间（不显示秒级；展示用）。 */
function formatTime(ms?: number | null): string {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return '—'
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 复制文本（有剪贴板 API 用 API，没有就退回隐藏 textarea）。 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 权限被拒时走下面的兜底 */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

/** The conversation view version tab component. */
export function VersionTabView(props: VersionTabTabProps): JSX.Element {
  const { t } = props

  /** 状态数据（null=首次加载中——期间不渲染任何「不支持」判断）。 */
  const [state, setState] = useState<UpdateState | null>(null)
  /** 最近一次成功更新的发布说明（tag 附注，服务端截断 500 字符）。 */
  const [releaseNotes, setReleaseNotes] = useState<string>('')
  /** 「检查更新」进行中。 */
  const [checking, setChecking] = useState(false)
  /** 「立即更新」进行中。 */
  const [updating, setUpdating] = useState(false)
  /** 复制命令后的短暂反馈。 */
  const [copied, setCopied] = useState(false)
  /** 统一错误对象（code 驱动字典文案；网络异常用 'network'）。 */
  const [error, setError] = useState<ViewError | null>(null)

  /** 拉取状态并落屏（可选 force）。 */
  const refresh = (force: boolean): void => {
    setError(null)
    if (force) setChecking(true)
    fetchStatus(force)
      .then((data) => {
        setState(data)
        // 状态变化（红点 0/1）广播给宿主层：index.ts 的 badge 监听会同步
        // 各 Tab 红点（设置 Tab 的 🔴 由此出现/消失）。
        window.dispatchEvent(new CustomEvent('dsh-memory-evolve:badge-change'))
      })
      .catch((err: unknown) => setError({ code: 'network', message: err instanceof Error ? err.message : 'network error' }))
      .finally(() => setChecking(false))
  }

  /** 挂载即触发一次惰性检测（24h 缓存内不跑 git；force 留给按钮）。 */
  useEffect(() => { refresh(false) }, [])

  /** 执行更新（提交当前看到的 expectedTag，防目标变化竞态）。 */
  const doUpdate = (): void => {
    if (updating || !state?.latestTag) return
    setUpdating(true)
    setError(null)
    void fetch('/memory-evolve/api/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedTag: state.latestTag }),
    })
      .then(async (res) => {
        const outcome = (await res.json()) as UpdateOutcome
        if (!res.ok || !outcome.ok) {
          setError({ code: outcome.code ?? 'unknown', message: outcome.error ?? '' })
          return
        }
        // 成功：先落屏发布说明与"等待重启"（即使随后的状态刷新失败也
        // 不能显示成更新失败）。
        setReleaseNotes(outcome.releaseNotes ?? '')
        setState({ ...(state ?? {}), restartRequired: true })
        try {
          const data = await fetchStatus(false)
          setState(data)
        } catch {
          /* 状态刷新失败：保持"更新已完成"呈现，不覆盖为错误 */
        }
        setError(null)
        window.dispatchEvent(new CustomEvent('dsh-memory-evolve:badge-change'))
      })
      .catch((err: unknown) => setError({ code: 'network', message: err instanceof Error ? err.message : 'network error' }))
      .finally(() => setUpdating(false))
  }

  /** 复制升级命令（包安装用户的唯一手动路径）。 */
  const doCopy = (): void => {
    void copyText(UPGRADE_COMMAND).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    })
  }

  const busy = checking || updating || state === null
  // 老服务端没有 installKind 字段：按 status 推断（unsupported 基本等价于
  // 包安装），保证降级时不至于把两种形态混在一起显示。
  const installKind: 'source' | 'package' = state?.installKind === 'source'
    ? 'source'
    : state?.installKind === 'package'
      ? 'package'
      : state?.status === 'unsupported' ? 'package' : 'source'
  const release = state?.release ?? null
  const currentVersion = state?.pluginVersion ?? state?.localTag ?? null
  const latestVersion = release?.latest ?? state?.latestTag ?? null
  const releaseHasUpdate = release?.hasUpdate === true
  // 状态文案：包安装的「检测不支持」是预期行为，换成「由插件市场管理」。
  const statusText = state === null
    ? t('version.loading')
    : installKind === 'package'
      ? (releaseHasUpdate ? `${t('version.status.package')} · ${t('version.status.outdated')}` : t('version.status.package'))
      : t(`version.status.${state.status ?? 'unknown'}`)
  const noteText = installKind === 'source' && state?.noteCode ? t(`version.note.${state.noteCode}`) : ''

  return (
    <div className="me-panel">
      {/* —— 等待重启横幅：服务端派生状态驱动，重挂/刷新后依然显示 —— */}
      {state?.restartRequired === true && (
        <div className="me-notice me-notice-warn" role="alert">
          <strong>{t('version.restart.title')}</strong>：{t('version.restart.hint')}
        </div>
      )}

      {/* —— 版本状态卡 —— */}
      <div className="me-block">
        <div className="me-group">
          <div className="me-field">
            <span className="me-field-label">{t('version.installKind')}</span>
            <span className="me-field-value">
              {state === null ? '—' : t(`version.installKind.${installKind}`)}
            </span>
          </div>
          <div className="me-field">
            <span className="me-field-label">{t('version.current')}</span>
            <span className="me-field-value">{currentVersion ?? '—'}</span>
          </div>
          <div className="me-field">
            <span className="me-field-label">{t('version.latest')}</span>
            <span className="me-field-value">{latestVersion ?? '—'}</span>
          </div>
          <div className="me-field">
            <span className="me-field-label">{t('version.statusLabel')}</span>
            <span className="me-field-value">{statusText}</span>
          </div>
          {noteText !== '' && <p className="me-help">{noteText}</p>}
          {/* 源码安装的检测失败信息（stale 附加展示，不覆盖最后成功状态）；
              包安装的 lastError 是"没有 git"，不是故障，不显示。 */}
          {installKind === 'source' && state?.lastError && (
            <p className="me-help">
              {t('version.lastError')}：{state.lastError.message ?? state.lastError.kind ?? '—'}
            </p>
          )}
          <p className="me-help">
            {t('version.checkTime')}：{formatTime(state?.lastSuccessAt ?? state?.lastAttemptAt)}
          </p>
        </div>
      </div>

      {/* —— 操作区 —— */}
      <div className="me-block">
        <button type="button" className="me-btn" disabled={busy} onClick={() => refresh(true)}>
          {checking ? t('version.checking') : t('version.checkNow')}
        </button>
        {/* 源码安装：保留一键更新（开发者路径） */}
        {installKind === 'source' && state?.status === 'outdated' && state.latestTag && (
          <button type="button" className="me-btn me-btn-primary" disabled={busy} onClick={doUpdate}>
            {updating ? t('version.updating') : t('version.updateNow', { tag: state.latestTag })}
          </button>
        )}
        {/* 包安装：一键更新做不到，也不假装做得到——给可复制的命令 */}
        {installKind === 'package' && (
          <button type="button" className="me-btn me-btn-primary" disabled={state === null} onClick={doCopy}>
            {copied ? t('version.copied') : t('version.copy')}
          </button>
        )}
        {release?.url && releaseHasUpdate && (
          <a className="me-btn" href={release.url} target="_blank" rel="noreferrer">
            {t('version.openRelease')}
          </a>
        )}
        {error && (
          <p className="me-notice me-notice-error" role="alert">
            {t(`version.error.${error.code}`, { message: error.message })}
          </p>
        )}
      </div>

      {/* —— 安装形态说明 + 包安装的升级命令 —— */}
      <div className="me-block">
        <p className="me-help">{installKind === 'package' ? t('version.package.hint') : t('version.source.hint')}</p>
        {installKind === 'package' && (
          <pre className="me-notes-pre" style={{ userSelect: 'all' }}>{UPGRADE_COMMAND}</pre>
        )}
      </div>

      {/* —— 只读发布检查（所有安装形态都显示） —— */}
      <div className="me-block">
        <div className="me-group">
          <div className="me-field">
            <span className="me-field-label">{t('version.release.checkTime')}</span>
            <span className="me-field-value">{formatTime(release?.checkedAt)}</span>
          </div>
          {release?.publishedAt && (
            <div className="me-field">
              <span className="me-field-label">{t('version.release.publishedAt')}</span>
              <span className="me-field-value">{formatTime(release.publishedAt)}</span>
            </div>
          )}
        </div>
        {release?.error && (
          <p className="me-help">
            {t('version.release.error')}：{release.error.message ?? release.error.kind ?? '—'}
          </p>
        )}
      </div>

      {/* —— 更新结果（最近一次成功更新的发布说明，tag 附注） —— */}
      {(releaseNotes !== '' || state?.lastUpdated?.notes) && (
        <div className="me-block">
          <div className="me-group">
            <div className="me-field">
              <span className="me-field-label">{t('version.releaseNotes')}</span>
              <span className="me-field-value me-notes-pre">{state?.lastUpdated?.notes ?? releaseNotes}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
