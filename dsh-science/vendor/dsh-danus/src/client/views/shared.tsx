/**
 * client/views/shared.tsx — 主题令牌、数据钩子与基础组件。
 *
 * 颜色一律走 DSH 设计令牌(var(--dsw-alias-*) / var(--dsw-specific-*)),
 * 令牌缺失时回退中性灰,保证亮/暗主题都可用;零运行时依赖,全手写。
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

// --------------------------------------------------------------------------- //
// 主题令牌                                                                      //
// --------------------------------------------------------------------------- //

export const C = {
  text: 'var(--dsw-alias-label-primary, #c8c8c8)',
  textDim: 'var(--dsw-alias-label-primary-dimmed, #9a9a9a)',
  caption: 'var(--dsw-alias-label-caption, #7a7a7a)',
  border: 'var(--dsw-alias-border-l1, #3c3c3c)',
  bg: 'var(--dsw-alias-background-primary, transparent)',
  bgRaised: 'var(--dsw-alias-background-secondary, rgba(128,128,128,0.10))',
  tip: 'var(--dsw-specific-tip, rgba(128,128,128,0.08))',
  brand: 'var(--dsw-alias-brand, #4d6bfe)',
} as const

/** 语义色(亮暗主题均可读的中间明度)。 */
export const SEM = {
  green: '#3fb950',
  orange: '#d29922',
  red: '#f85149',
  blue: '#58a6ff',
  purple: '#bc8cff',
  gray: '#8b949e',
} as const

export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

// --------------------------------------------------------------------------- //
// 数据钩子                                                                      //
// --------------------------------------------------------------------------- //

/**
 * 轮询钩子:立即执行一次,之后每 ms 执行;组件卸载或 deps 变化时重置。
 * fn 内部自行 setState;抛错被吞掉(调用方负责错误态),保证轮询不中断。
 */
export function usePoll(fn: () => Promise<void> | void, ms: number, deps: readonly unknown[]): void {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    let alive = true
    const tick = async (): Promise<void> => {
      if (!alive) return
      try {
        await ref.current()
      } catch {
        // 瞬态失败保持上一帧,下轮重试。
      }
    }
    void tick()
    const timer = setInterval(() => { void tick() }, ms)
    return () => { alive = false; clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps])
}

export interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

/** 一次性异步加载(带手动 reload);三态齐全:loading / error / data。 */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null, error: null, loading: true,
  })
  const [nonce, setNonce] = useState(0)
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    ref.current()
      .then((data) => { if (alive) setState({ data, error: null, loading: false }) })
      .catch((e) => { if (alive) setState({ data: null, error: String((e as Error)?.message ?? e), loading: false }) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps])
  return { ...state, reload: () => setNonce((n) => n + 1) }
}

// --------------------------------------------------------------------------- //
// 基础组件                                                                      //
// --------------------------------------------------------------------------- //

export function Badge(props: { text: string; color: string; title?: string }): ReactNode {
  return (
    <span
      title={props.title ?? props.text}
      style={{
        display: 'inline-block', flex: 'none',
        padding: '1px 8px', borderRadius: 999,
        fontSize: 11, lineHeight: '16px', fontWeight: 600,
        color: props.color,
        border: `1px solid ${props.color}`,
        background: `color-mix(in srgb, ${props.color} 14%, transparent)`,
        whiteSpace: 'nowrap',
      }}
    >
      {props.text}
    </span>
  )
}

export function Btn(props: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  danger?: boolean
  primary?: boolean
  title?: string
  style?: CSSProperties
}): ReactNode {
  const color = props.danger ? SEM.red : props.primary ? C.brand : C.textDim
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      style={{
        padding: '3px 10px', borderRadius: 6, fontSize: 12, lineHeight: '18px',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.5 : 1,
        color,
        border: `1px solid ${props.primary || props.danger ? color : C.border}`,
        background: props.primary ? `color-mix(in srgb, ${C.brand} 12%, transparent)` : 'transparent',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        ...props.style,
      }}
    >
      {props.children}
    </button>
  )
}

export function Card(props: { children: ReactNode; style?: CSSProperties }): ReactNode {
  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 10,
      background: C.tip, padding: '10px 12px',
      ...props.style,
    }}>
      {props.children}
    </div>
  )
}

export function SectionTitle(props: { children: ReactNode; right?: ReactNode }): ReactNode {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      margin: '14px 0 8px', gap: 8,
    }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{props.children}</span>
      {props.right}
    </div>
  )
}

export function EmptyState(props: { text: string; hint?: string }): ReactNode {
  return (
    <div style={{ padding: '32px 16px', textAlign: 'center' }}>
      <div style={{ fontSize: 13, color: C.textDim }}>{props.text}</div>
      {props.hint && <div style={{ marginTop: 6, fontSize: 12, color: C.caption }}>{props.hint}</div>}
    </div>
  )
}

export function ErrorState(props: { error: string; onRetry?: () => void }): ReactNode {
  return (
    <div style={{ padding: '16px', textAlign: 'center' }}>
      <div style={{ fontSize: 12, color: SEM.red }}>请求失败:{props.error}</div>
      {props.onRetry && (
        <div style={{ marginTop: 8 }}>
          <Btn onClick={props.onRetry}>重试</Btn>
        </div>
      )}
    </div>
  )
}

export function LoadingState(): ReactNode {
  return <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 12, color: C.caption }}>加载中…</div>
}

/** 轻量模态:遮罩 + 居中卡片;点遮罩关闭。 */
export function Modal(props: { title: string; onClose: () => void; children: ReactNode }): ReactNode {
  return (
    <div
      onClick={props.onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto',
          border: `1px solid ${C.border}`, borderRadius: 12,
          background: 'var(--dsw-alias-background-primary, #1e1e1e)',
          padding: 16,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10,
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{props.title}</span>
          <Btn onClick={props.onClose}>关闭</Btn>
        </div>
        {props.children}
      </div>
    </div>
  )
}

export const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '5px 8px', borderRadius: 6, fontSize: 12,
  border: `1px solid ${C.border}`,
  background: 'transparent', color: C.text,
  fontFamily: 'inherit',
  outline: 'none',
}

export const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: 72, resize: 'vertical', lineHeight: '18px',
}

/** 可截断展开的长文本。 */
export function ExpandableText(props: { text: string; limit?: number; style?: CSSProperties }): ReactNode {
  const [open, setOpen] = useState(false)
  const limit = props.limit ?? 160
  const text = props.text || ''
  if (!text) return <span style={{ color: C.caption }}>(空)</span>
  const truncated = !open && text.length > limit
  return (
    <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...props.style }}>
      {truncated ? `${text.slice(0, limit)}…` : text}
      {text.length > limit && (
        <a
          onClick={() => setOpen(!open)}
          style={{ marginLeft: 6, color: C.brand, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' }}
        >
          {open ? '收起' : '展开'}
        </a>
      )}
    </span>
  )
}

/** 操作反馈行(成功/失败小字)。 */
export function Feedback(props: { msg: { ok: boolean; text: string } | null }): ReactNode {
  if (!props.msg) return null
  return (
    <div style={{ marginTop: 6, fontSize: 12, color: props.msg.ok ? SEM.green : SEM.red }}>
      {props.msg.text}
    </div>
  )
}
