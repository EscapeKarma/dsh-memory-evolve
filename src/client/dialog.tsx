/**
 * 页面内确认框 / 提示框（替代原生 window.confirm / window.alert）。
 *
 * 为什么不用原生对话框（issue #88）：
 * - DSH 桌面版是 Electron（Windows 上任务对话框走 Win32 TaskDialog）。原生
 *   confirm/alert 关闭后主窗口**不会重新拿到键盘焦点**：`document.hasFocus()`
 *   持续为 false，输入框要再点一下窗口才能打字，切到别的窗口再切回来才恢复。
 *   这是 Electron 的已知问题（upstream electron#41602，状态 not_planned），
 *   从 DSH 侧修不了，只能不用原生对话框。
 * - 顺带解决另外两件事：①原生 confirm 是**同步阻塞**，会卡住整个渲染线程，
 *   后台轮询/SSE 全停；②原生对话框不能定制按钮文案、不能展示多行内容。
 *
 * 用法（与原生写法一一对应，改起来只是加 await）：
 *   if (!await confirmDialog(message, { okLabel: t('common.delete'), danger: true })) return
 *   await alertDialog(message, { title: t('bookmark.error') })
 *
 * 兜底：没有 DOM（单元测试 / SSR）时直接返回「取消」/「已确认」，不抛错；
 * 连续调用会排队，避免两个遮罩互相盖住。
 */
import { createRoot, type Root } from 'react-dom/client'
import { useEffect, useRef } from 'react'

export interface DialogTextOptions {
  /** 标题，可省略。 */
  title?: string
  /** 确认按钮文案（confirm 与 alert 都用它）。 */
  okLabel?: string
  /** 取消按钮文案；alert 传 undefined 表示单按钮。 */
  cancelLabel?: string
  /** 确认按钮是否用危险色（删除类操作）。 */
  danger?: boolean
}

interface DialogSpec extends DialogTextOptions {
  message: string
  /** true = 只有一个按钮（alert 语义）。 */
  single: boolean
}

const DEFAULT_OK = '确定'
const DEFAULT_CANCEL = '取消'

/**
 * 当前语言的按钮文案。插件是双语 UI，这里由 index.ts 在 apply 时用 t() 注入，
 * 之后所有对话框都跟随语言设置（不必在每个调用点重复传文案）。
 */
let labels: { ok: string; cancel: string } = { ok: DEFAULT_OK, cancel: DEFAULT_CANCEL }

/**
 * 设置对话框默认按钮文案（跟随插件语言）。
 * @param next - 确认 / 取消文案；缺省项保持原值。
 */
export function setDialogLabels(next: { ok?: string; cancel?: string }): void {
  labels = {
    ok: next.ok ?? labels.ok,
    cancel: next.cancel ?? labels.cancel,
  }
}

/** 同时只允许一个对话框；后来的排队等前一个关掉。 */
let queue: Promise<unknown> = Promise.resolve()

function DialogView(props: { spec: DialogSpec; close: (ok: boolean) => void }): JSX.Element {
  const { spec, close } = props
  const okRef = useRef<HTMLButtonElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    // 打开时把焦点放到「确认」上：键盘用户可以直接回车，
    // 也顺手把焦点从原来可能已经失效的元素上挪开。
    okRef.current?.focus({ preventScroll: true })
  }, [])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(false)
      return
    }
    if (event.key === 'Enter') {
      // 焦点在「取消」上时回车应当取消，其余情况确认。
      const onCancel = cancelRef.current !== null && document.activeElement === cancelRef.current
      event.preventDefault()
      event.stopPropagation()
      close(!onCancel)
    }
  }

  return (
    <div
      className="me-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        // 点遮罩空白处等价于取消（与原生 confirm 的「关闭」一致）。
        if (event.target === event.currentTarget) close(false)
      }}
      onKeyDown={onKeyDown}
      tabIndex={-1}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.45)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={spec.title ?? spec.message}
        className="me-dialog"
        style={{
          minWidth: 280,
          maxWidth: 460,
          padding: '18px 20px 14px',
          borderRadius: 12,
          background: 'var(--dsh-color-surface, #23242a)',
          color: 'var(--dsh-color-text, #e8e8ea)',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.45)',
          border: '1px solid rgba(255, 255, 255, 0.10)',
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        {spec.title !== undefined && spec.title !== '' && (
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{spec.title}</div>
        )}
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{spec.message}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          {!spec.single && (
            <button
              type="button"
              ref={cancelRef}
              className="me-dialog-cancel"
              onClick={() => close(false)}
              style={{
                padding: '5px 14px',
                borderRadius: 8,
                border: '1px solid rgba(255, 255, 255, 0.16)',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
              }}
            >
              {spec.cancelLabel ?? labels.cancel}
            </button>
          )}
          <button
            type="button"
            ref={okRef}
            className="me-dialog-ok"
            onClick={() => close(true)}
            style={{
              padding: '5px 14px',
              borderRadius: 8,
              border: '1px solid transparent',
              background: spec.danger === true ? '#d9534f' : 'var(--dsh-color-accent, #3b82f6)',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            {spec.okLabel ?? labels.ok}
          </button>
        </div>
      </div>
    </div>
  )
}

function showDialog(spec: DialogSpec): Promise<boolean> {
  const run = (): Promise<boolean> => {
    if (typeof document === 'undefined' || typeof document.body === 'undefined') {
      // 没有 DOM：alert 视为已确认，confirm 视为取消（最保守）。
      return Promise.resolve(spec.single)
    }
    return new Promise<boolean>((resolve) => {
      const host = document.createElement('div')
      host.className = 'me-dialog-host'
      document.body.appendChild(host)
      const root: Root = createRoot(host)
      // 记住原来的焦点，关掉之后还回去（否则页面会「没有焦点」，与原生同一个毛病）。
      const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
      let settled = false
      const close = (ok: boolean): void => {
        if (settled) return
        settled = true
        try {
          root.unmount()
        } catch {
          /* 卸载失败不影响结果 */
        }
        host.remove()
        if (previous !== null && previous.isConnected) {
          try {
            previous.focus({ preventScroll: true })
          } catch {
            /* 元素可能已不可聚焦 */
          }
        }
        resolve(ok)
      }
      root.render(<DialogView spec={spec} close={close} />)
    })
  }
  // 串行化：前一个对话框关掉之后再开下一个。
  const next = queue.then(run, run)
  queue = next.catch(() => undefined)
  return next
}

/**
 * 页面内确认框（替代 `window.confirm`）。
 * @param message - 主体文案（可多行）。
 * @param opts - 标题 / 按钮文案 / 是否危险色。
 * @returns 点「确认」为 true；点取消、按 Esc、点遮罩为 false。
 */
export function confirmDialog(message: string, opts: DialogTextOptions = {}): Promise<boolean> {
  return showDialog({ ...opts, message, single: false })
}

/**
 * 页面内提示框（替代 `window.alert`）。
 * @param message - 主体文案（可多行）。
 * @param opts - 标题 / 按钮文案。
 */
export async function alertDialog(message: string, opts: DialogTextOptions = {}): Promise<void> {
  await showDialog({ ...opts, message, single: true })
}
