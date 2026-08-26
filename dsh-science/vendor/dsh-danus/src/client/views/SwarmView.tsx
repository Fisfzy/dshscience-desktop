/**
 * client/views/SwarmView.tsx — Swarm 实时介入(worker 表格 + 行操作 + 日志)。
 *
 * worker 表格 5s 轮询;label 徽章着色(working 绿 / stuck? 橙 / dead 灰 /
 * error 红 / created 蓝);行操作:指派(弹窗 textarea)/ 启动 / 优雅停 / 强杀;
 * 点行展开该 worker 最新轮日志 tail(等宽 200 行,手动刷新)。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { WorkerInfo, WorkerLog } from '../api'
import {
  Badge, Btn, C, Card, EmptyState, ErrorState, Feedback, LoadingState, MONO,
  Modal, SEM, SectionTitle, textareaStyle, usePoll,
} from './shared'

function labelColor(label: string): string {
  if (label === 'working') return SEM.green
  if (label.startsWith('stuck')) return SEM.orange
  if (label === 'error') return SEM.red
  if (label === 'created') return SEM.blue
  if (label === 'deadline' || label === 'max_rounds') return SEM.purple
  return SEM.gray // dead / stopped / terminated / 其他
}

function fmtAge(age: number | null): string {
  if (age == null) return '—'
  if (age < 60) return `${Math.round(age)}s`
  if (age < 3600) return `${Math.floor(age / 60)}m${Math.round(age % 60)}s`
  return `${Math.floor(age / 3600)}h${Math.floor((age % 3600) / 60)}m`
}

function WorkerLogPanel(props: { project: string; worker: string }): ReactNode {
  const [log, setLog] = useState<WorkerLog | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async (): Promise<void> => {
    setBusy(true)
    try {
      setLog(await api.workerLog(props.project, props.worker, 200))
      setErr(null)
    } catch (e) {
      setErr(String((e as Error)?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: C.textDim }}>
          最新轮日志{log?.round ? `(${log.round})` : ''}
        </span>
        <Btn onClick={() => { void load() }} disabled={busy}>{log ? '刷新日志' : '加载日志'}</Btn>
        {busy && <span style={{ fontSize: 11, color: C.caption }}>加载中…</span>}
      </div>
      {err && <div style={{ fontSize: 12, color: SEM.red }}>日志加载失败:{err}</div>}
      {log && log.lines.length === 0 && <div style={{ fontSize: 12, color: C.caption }}>(无日志行)</div>}
      {log && log.lines.length > 0 && (
        <pre style={{
          margin: 0, padding: 10, maxHeight: 320, overflow: 'auto',
          border: `1px solid ${C.border}`, borderRadius: 8,
          background: C.tip,
          fontFamily: MONO, fontSize: 11, lineHeight: '16px', color: C.textDim,
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          {log.lines.join('\n')}
        </pre>
      )}
    </div>
  )
}

export function SwarmView(props: { project: string }): ReactNode {
  const [workers, setWorkers] = useState<WorkerInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [assignTarget, setAssignTarget] = useState<string | null>(null)
  const [assignTask, setAssignTask] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  usePoll(async () => {
    if (!props.project) return
    try {
      const res = await api.workers(props.project)
      setWorkers(res.workers ?? [])
      setError(null)
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    }
  }, 5000, [props.project])

  const act = async (fn: () => Promise<unknown>, okText: string): Promise<void> => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      setMsg({ ok: true, text: okText })
      const res = await api.workers(props.project)
      setWorkers(res.workers ?? [])
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error)?.message ?? e) })
    } finally {
      setBusy(false)
    }
  }

  const submitAssign = async (): Promise<void> => {
    if (!assignTarget || !assignTask.trim()) return
    await act(
      () => api.assign(props.project, assignTarget, assignTask.trim()),
      `已指派任务给 ${assignTarget}`,
    )
    setAssignTarget(null)
    setAssignTask('')
  }

  if (!props.project) return <EmptyState text="未选择项目" hint="请先在顶部选择一个项目" />
  if (!workers && error) return <ErrorState error={error} />
  if (!workers) return <LoadingState />

  const target = (w: string): string => `${props.project}/${w}`

  return (
    <div style={{ padding: 12 }}>
      <SectionTitle
        right={<span style={{ fontSize: 11, color: C.caption }}>5s 轮询 · 项目 {props.project}</span>}
      >
        Worker 列表({workers.length})
      </SectionTitle>
      {error && (
        <div style={{ marginBottom: 8, fontSize: 12, color: SEM.orange }}>
          本轮刷新失败(展示上一帧):{error}
        </div>
      )}
      <Feedback msg={msg} />

      {workers.length === 0 ? (
        <EmptyState text="该项目暂无 worker" hint="可经 main agent 的 swarm 工具启动 worker" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {workers.map((w) => {
            const open = expanded === w.worker
            return (
              <Card key={w.worker} style={{ padding: '8px 10px' }}>
                <div
                  onClick={() => setExpanded(open ? null : w.worker)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flexWrap: 'wrap' }}
                >
                  <span style={{ fontSize: 11, color: C.caption, width: 12 }}>{open ? '▾' : '▸'}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text, fontFamily: MONO }}>{w.worker}</span>
                  <Badge text={w.label} color={labelColor(w.label)} />
                  <span style={{ fontSize: 11, color: C.caption }}>
                    pid {w.pid ?? '—'} · round {w.round ?? '—'} · age {fmtAge(w.age_s)}
                  </span>
                  {w.last_fact_id && (
                    <span style={{ fontSize: 11, color: C.caption, fontFamily: MONO }}>last: {w.last_fact_id}</span>
                  )}
                  <span style={{ flex: 1 }} />
                  <span onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 6 }}>
                    <Btn onClick={() => { setAssignTarget(w.worker); setAssignTask('') }} disabled={busy}>指派</Btn>
                    <Btn onClick={() => { void act(() => api.startWorker(target(w.worker)), `已启动 ${w.worker}`) }} disabled={busy}>启动</Btn>
                    <Btn onClick={() => { void act(() => api.stopWorker(target(w.worker), false), `已优雅停止 ${w.worker}`) }} disabled={busy}>优雅停</Btn>
                    <Btn danger onClick={() => { void act(() => api.stopWorker(target(w.worker), true), `已强杀 ${w.worker}`) }} disabled={busy}>强杀</Btn>
                  </span>
                </div>
                {open && <WorkerLogPanel project={props.project} worker={w.worker} />}
              </Card>
            )
          })}
        </div>
      )}

      {assignTarget && (
        <Modal title={`指派任务 → ${assignTarget}`} onClose={() => setAssignTarget(null)}>
          <div style={{ fontSize: 12, color: C.caption, marginBottom: 6 }}>
            任务描述会写入该 worker 的指派队列,下一轮生效。
          </div>
          <textarea
            autoFocus
            value={assignTask}
            onChange={(e) => setAssignTask(e.target.value)}
            placeholder="输入要指派给该 worker 的任务…"
            style={textareaStyle}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
            <Btn onClick={() => setAssignTarget(null)}>取消</Btn>
            <Btn primary onClick={() => { void submitAssign() }} disabled={busy || !assignTask.trim()}>
              确认指派
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}
