/**
 * client/DanusConsole.tsx — Danus Console 主组件。
 *
 * 单 Tab 内顶部视图切换:进度 / Swarm / 假设 / 事实图 / 导出;顶部另有项目
 * 选择器(GET /danus/api/workers 的项目列表;无项目时显示空态)。全部数据
 * 走同源 /danus/api/*;中文 UI;主题走 --dsw-alias-* 令牌,亮暗自适应。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api'
import type { ProjectInfo } from './api'
import { ProgressView } from './views/ProgressView'
import { SwarmView } from './views/SwarmView'
import { HypothesesView } from './views/HypothesesView'
import { FactGraphView } from './views/FactGraphView'
import { ExportView } from './views/ExportView'
import { C, EmptyState, SEM, inputStyle, usePoll } from './views/shared'

type ViewId = 'progress' | 'swarm' | 'hypotheses' | 'factgraph' | 'export'

const VIEWS: ReadonlyArray<{ id: ViewId; label: string }> = [
  { id: 'progress', label: '进度' },
  { id: 'swarm', label: 'Swarm' },
  { id: 'hypotheses', label: '假设' },
  { id: 'factgraph', label: '事实图' },
  { id: 'export', label: '导出' },
]

export function DanusConsole(): ReactNode {
  const [view, setView] = useState<ViewId>('progress')
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null)
  const [project, setProject] = useState('')
  const [projectsError, setProjectsError] = useState<string | null>(null)

  // 项目列表(慢速轮询;新 worker 项目出现时自动可见)。
  usePoll(async () => {
    try {
      const res = await api.projects()
      const list = res.projects ?? []
      setProjects(list)
      setProjectsError(null)
      // 未选择或所选项目已消失时,回落到第一个项目。
      if (list.length > 0 && !list.some((p) => p.project === project)) {
        setProject(list[0]!.project)
      }
    } catch (e) {
      setProjectsError(String((e as Error)?.message ?? e))
    }
  }, 5000, [project])

  const noProjects = projects !== null && projects.length === 0

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
      color: C.text, fontSize: 13, fontFamily: 'system-ui, sans-serif',
    }}>
      {/* 顶栏:视图切换 + 项目选择器 */}
      <div style={{
        flex: 'none', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
        padding: '8px 10px', borderBottom: `1px solid ${C.border}`,
      }}>
        {VIEWS.map((v) => {
          const active = v.id === view
          return (
            <span
              key={v.id}
              onClick={() => setView(v.id)}
              style={{
                padding: '4px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                fontWeight: active ? 600 : 400,
                color: active ? C.brand : C.textDim,
                background: active ? `color-mix(in srgb, ${C.brand} 14%, transparent)` : 'transparent',
                border: `1px solid ${active ? C.brand : 'transparent'}`,
                whiteSpace: 'nowrap',
              }}
            >
              {v.label}
            </span>
          )
        })}
        <span style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.caption }}>
          项目
          <select
            value={project}
            onChange={(e) => setProject(e.target.value)}
            disabled={!projects || projects.length === 0}
            style={{ ...inputStyle, width: 'auto', minWidth: 120 }}
          >
            {(!projects || projects.length === 0) && <option value="">(无项目)</option>}
            {projects?.map((p) => (
              <option key={p.project} value={p.project}>
                {p.project}{p.live > 0 ? ` (${p.live} live)` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, minHeight: 0, overflow: view === 'factgraph' ? 'hidden' : 'auto', display: 'flex', flexDirection: 'column' }}>
        {noProjects ? (
          <EmptyState
            text="暂无项目"
            hint="后端未报告任何 worker 项目;经 main agent 启动 swarm 后会出现在这里"
          />
        ) : (
          <>
            {projectsError && (
              <div style={{ padding: '6px 12px', fontSize: 12, color: SEM.orange }}>
                项目列表刷新失败:{projectsError}
              </div>
            )}
            {view === 'progress' && <ProgressView project={project} />}
            {view === 'swarm' && <SwarmView project={project} />}
            {view === 'hypotheses' && <HypothesesView project={project} />}
            {view === 'factgraph' && <FactGraphView onExport={() => setView('export')} />}
            {view === 'export' && <ExportView project={project} />}
          </>
        )}
      </div>
    </div>
  )
}
