/**
 * client/views/FactGraphView.tsx — 事实图(SVG 分层 DAG)。
 *
 * x 按 depth 分层(深在左,depth 0 在右),同层按 id 排序均布;边为三次贝塞尔;
 * 节点大小/颜色随 depth;空白拖拽 pan、滚轮以指针为中心 zoom;hover 显示
 * id + statement 截断;点击节点右侧抽屉展开 statement/proof/intuition 全文 +
 * predecessors 链接跳转。手动刷新;「导出」按钮跳到导出视图。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { api } from '../api'
import type { FactNode } from '../api'
import {
  Btn, C, EmptyState, ErrorState, LoadingState, MONO, SEM, useAsync,
} from './shared'

const LAYER_W = 240
const ROW_H = 96
const PAD_X = 120
const PAD_Y = 80

interface Layout {
  pos: Map<string, { x: number; y: number }>
  width: number
  height: number
  layers: { depth: number; x: number; count: number }[]
}

function layoutGraph(nodes: FactNode[], maxDepth: number): Layout {
  const byDepth = new Map<number, FactNode[]>()
  for (const n of nodes) {
    const list = byDepth.get(n.depth) ?? []
    list.push(n)
    byDepth.set(n.depth, list)
  }
  const pos = new Map<string, { x: number; y: number }>()
  const layers: Layout['layers'] = []
  let maxRows = 1
  for (const [depth, list] of byDepth) maxRows = Math.max(maxRows, list.length)
  for (let d = 0; d <= maxDepth; d++) {
    const list = (byDepth.get(d) ?? []).slice().sort((a, b) => a.id.localeCompare(b.id))
    // 深在左:depth 越大 x 越小。
    const x = PAD_X + (maxDepth - d) * LAYER_W
    layers.push({ depth: d, x, count: list.length })
    // 同层按 id 排序后在整列高度内均布。
    list.forEach((n, i) => {
      const y = PAD_Y + ((i + 1) / (list.length + 1)) * (maxRows * ROW_H)
      pos.set(n.id, { x, y })
    })
  }
  return {
    pos,
    width: PAD_X * 2 + (maxDepth + 1) * LAYER_W,
    height: PAD_Y * 2 + maxRows * ROW_H,
    layers,
  }
}

function nodeColor(depth: number, maxDepth: number): string {
  const frac = maxDepth > 0 ? depth / maxDepth : 0
  // 浅层蓝 → 深层品红,亮暗主题均可读。
  return `hsl(${Math.round(215 - frac * 170)} 70% 58%)`
}

function nodeRadius(depth: number): number {
  return 12 + Math.min(depth, 8) * 1.6
}

interface ViewTransform { x: number; y: number; k: number }

export function FactGraphView(props: { onExport: () => void }): ReactNode {
  const { data, error, loading, reload } = useAsync(() => api.factgraph(), [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hover, setHover] = useState<{ id: string; px: number; py: number } | null>(null)
  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, k: 1 })
  const svgRef = useRef<SVGSVGElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  const layout = useMemo(
    () => (data ? layoutGraph(data.nodes ?? [], data.max_depth ?? 0) : null),
    [data],
  )
  const nodeById = useMemo(() => {
    const m = new Map<string, FactNode>()
    for (const n of data?.nodes ?? []) m.set(n.id, n)
    return m
  }, [data])

  // 滚轮缩放:以指针为中心(原生 listener,passive:false 才能 preventDefault)。
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const rect = svg.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const v = viewRef.current
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const k = Math.min(4, Math.max(0.15, v.k * factor))
      const ratio = k / v.k
      setView({
        k,
        x: px - (px - v.x) * ratio,
        y: py - (py - v.y) * ratio,
      })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [layout])

  const centerOn = (id: string): void => {
    const p = layout?.pos.get(id)
    const rect = containerRef.current?.getBoundingClientRect()
    if (!p || !rect) return
    const k = Math.max(viewRef.current.k, 0.8)
    setView({ k, x: rect.width / 2 - p.x * k, y: rect.height / 2 - p.y * k })
  }

  const onBackgroundDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    if (d.moved) setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }))
  }
  const onPointerUp = (): void => {
    const d = dragRef.current
    dragRef.current = null
    if (d && !d.moved) setSelectedId(null) // 点空白:取消选中
  }

  const selected = selectedId ? nodeById.get(selectedId) ?? null : null

  if (loading) return <LoadingState />
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data || !layout) return <EmptyState text="无事实图数据" />
  if (data.nodes.length === 0) {
    return (
      <EmptyState
        text="事实图为空"
        hint="尚无已验证事实;worker 产出经 verifier 门控的事实后会出现在这里"
      />
    )
  }

  const hoverNode = hover ? nodeById.get(hover.id) ?? null : null

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* 工具行 */}
      <div style={{
        position: 'absolute', top: 10, left: 10, zIndex: 5,
        display: 'flex', gap: 6, alignItems: 'center',
      }}>
        <Btn onClick={reload}>刷新</Btn>
        <Btn onClick={() => setView({ x: 0, y: 0, k: 1 })}>重置视图</Btn>
        <Btn primary onClick={props.onExport}>导出</Btn>
        <span style={{ fontSize: 11, color: C.caption }}>
          {data.nodes.length} 节点 · {data.edges.length} 边 · 最大深度 {data.max_depth}
        </span>
      </div>

      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ display: 'block', cursor: dragRef.current ? 'grabbing' : 'grab', touchAction: 'none' }}
        onPointerDown={onBackgroundDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {/* 层标签 */}
          {layout.layers.map((l) => (
            <text
              key={l.depth}
              x={l.x}
              y={30}
              textAnchor="middle"
              style={{ fontSize: 11, fill: C.caption, fontFamily: MONO }}
            >
              depth {l.depth}
            </text>
          ))}
          {/* 边(贝塞尔) */}
          {data.edges.map((e, i) => {
            const s = layout.pos.get(e.source)
            const t = layout.pos.get(e.target)
            if (!s || !t) return null
            const bend = Math.max(40, Math.abs(s.x - t.x) / 2)
            return (
              <path
                key={i}
                d={`M ${s.x} ${s.y} C ${s.x - bend} ${s.y}, ${t.x + bend} ${t.y}, ${t.x} ${t.y}`}
                fill="none"
                style={{ stroke: C.border, strokeWidth: 1.2, opacity: 0.8 }}
              />
            )
          })}
          {/* 节点 */}
          {data.nodes.map((n) => {
            const p = layout.pos.get(n.id)
            if (!p) return null
            const r = nodeRadius(n.depth)
            const isSel = n.id === selectedId
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                style={{ cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); setSelectedId(n.id) }}
                onPointerEnter={(e) => {
                  const rect = containerRef.current?.getBoundingClientRect()
                  setHover({ id: n.id, px: e.clientX - (rect?.left ?? 0), py: e.clientY - (rect?.top ?? 0) })
                }}
                onPointerLeave={() => setHover((h) => (h?.id === n.id ? null : h))}
              >
                <circle
                  r={r}
                  style={{
                    fill: nodeColor(n.depth, data.max_depth),
                    stroke: isSel ? C.text : 'transparent',
                    strokeWidth: isSel ? 2.5 : 0,
                    opacity: 0.92,
                  }}
                />
                <text
                  y={r + 12}
                  textAnchor="middle"
                  style={{ fontSize: 10, fill: C.textDim, fontFamily: MONO, pointerEvents: 'none' }}
                >
                  {n.id}
                </text>
              </g>
            )
          })}
        </g>
      </svg>

      {/* hover tooltip */}
      {hoverNode && hover && (
        <div style={{
          position: 'absolute', zIndex: 6, pointerEvents: 'none',
          left: Math.min(hover.px + 14, (containerRef.current?.clientWidth ?? 400) - 260),
          top: hover.py + 14,
          maxWidth: 260, padding: '6px 10px',
          border: `1px solid ${C.border}`, borderRadius: 8,
          background: 'var(--dsw-alias-background-primary, #1e1e1e)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        }}>
          <div style={{ fontSize: 11, fontFamily: MONO, color: C.brand }}>{hoverNode.id}</div>
          <div style={{
            marginTop: 2, fontSize: 11, color: C.textDim,
            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
          }}>
            {hoverNode.statement || '(无 statement)'}
          </div>
        </div>
      )}

      {/* 右侧详情抽屉 */}
      {selected && (
        <div style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 7,
          width: 340, maxWidth: '85%', overflow: 'auto',
          borderLeft: `1px solid ${C.border}`,
          background: 'var(--dsw-alias-background-primary, #1e1e1e)',
          padding: 14,
          boxShadow: '-4px 0 16px rgba(0,0,0,0.25)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 700, fontFamily: MONO, color: C.text }}>{selected.id}</span>
            <Btn onClick={() => setSelectedId(null)}>关闭</Btn>
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: C.caption }}>
            author {selected.author || '—'} · depth {selected.depth}
            {selected.problem_id ? ` · problem ${selected.problem_id}` : ''}
          </div>

          {(['statement', 'proof', 'intuition'] as const).map((sec) => (
            <div key={sec} style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.textDim, marginBottom: 4 }}>
                {sec === 'statement' ? 'Statement' : sec === 'proof' ? 'Proof' : 'Intuition'}
              </div>
              <div style={{
                fontSize: 12, color: C.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                padding: '6px 8px', border: `1px solid ${C.border}`, borderRadius: 6,
                background: C.tip, minHeight: 20,
              }}>
                {selected[sec] || <span style={{ color: C.caption }}>(空)</span>}
              </div>
            </div>
          ))}

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.textDim, marginBottom: 4 }}>
              Predecessors({selected.predecessors.length})
            </div>
            {selected.predecessors.length === 0 ? (
              <div style={{ fontSize: 12, color: C.caption }}>(根事实,无前驱)</div>
            ) : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {selected.predecessors.map((pid) => (
                  <Btn
                    key={pid}
                    onClick={() => { setSelectedId(pid); centerOn(pid) }}
                    style={{ fontFamily: MONO, fontSize: 11 }}
                  >
                    {pid}
                  </Btn>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
