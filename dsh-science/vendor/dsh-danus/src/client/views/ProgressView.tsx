/**
 * client/views/ProgressView.tsx — 推导进度总览(默认视图,5s 轮询)。
 *
 * 统计卡(事实数 / 含前驱 / verdict correct / wrong / live workers)+
 * 最近 verification 条目(verdict 徽章)+ master_guidance / elaboration 最新高亮。
 * 注:overview / channel 数据固定在 host 项目侧(忽略 project 参数);
 * live workers 数按当前选中项目统计。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { ChannelEntry, Overview } from '../api'
import { Badge, C, Card, EmptyState, ErrorState, LoadingState, SEM, SectionTitle, usePoll } from './shared'

interface ProgressData {
  overview: Overview
  verification: ChannelEntry[]
  guidance: ChannelEntry | null
  elaboration: ChannelEntry | null
  liveWorkers: number | null
}

function verdictColor(v: string): string {
  if (v === 'correct') return SEM.green
  if (v === 'wrong') return SEM.red
  return SEM.gray
}

function StatCard(props: { label: string; value: ReactNode; color?: string }): ReactNode {
  return (
    <Card style={{ flex: 1, minWidth: 110, textAlign: 'center', padding: '12px 8px' }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: props.color ?? C.text, fontVariantNumeric: 'tabular-nums' }}>
        {props.value}
      </div>
      <div style={{ marginTop: 2, fontSize: 11, color: C.caption }}>{props.label}</div>
    </Card>
  )
}

function ChannelHighlight(props: { title: string; entry: ChannelEntry | null }): ReactNode {
  return (
    <Card style={{ flex: 1, minWidth: 240 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Badge text={props.title} color={SEM.purple} />
        {props.entry?.timestamp_utc && (
          <span style={{ fontSize: 11, color: C.caption }}>{props.entry.timestamp_utc}</span>
        )}
      </div>
      {props.entry ? (
        <div style={{ fontSize: 12, color: C.textDim, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {props.entry.claim || '(无 claim)'}
          {props.entry.author && (
            <span style={{ marginLeft: 8, fontSize: 11, color: C.caption }}>— {props.entry.author}</span>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: C.caption }}>暂无条目</div>
      )}
    </Card>
  )
}

export function ProgressView(props: { project: string }): ReactNode {
  const [data, setData] = useState<ProgressData | null>(null)
  const [error, setError] = useState<string | null>(null)

  usePoll(async () => {
    try {
      const [overview, ver, guidanceCh, elabCh] = await Promise.all([
        api.overview(),
        api.channel('verification'),
        api.channel('master_guidance'),
        api.channel('elaboration'),
      ])
      let liveWorkers: number | null = null
      if (props.project) {
        try {
          const w = await api.workers(props.project)
          liveWorkers = (w.workers ?? []).filter((x) => x.alive).length
        } catch {
          liveWorkers = null
        }
      }
      setData({
        overview,
        verification: (ver.entries ?? []).slice(0, 8),
        guidance: guidanceCh.entries?.[0] ?? null,
        elaboration: elabCh.entries?.[0] ?? null,
        liveWorkers,
      })
      setError(null)
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    }
  }, 5000, [props.project])

  if (!data && error) return <ErrorState error={error} />
  if (!data) return <LoadingState />

  const { overview, verification, guidance, elaboration, liveWorkers } = data
  const correct = overview.verdicts?.['correct'] ?? 0
  const wrong = overview.verdicts?.['wrong'] ?? 0

  return (
    <div style={{ padding: 12 }}>
      {error && (
        <div style={{ marginBottom: 8, fontSize: 12, color: SEM.orange }}>
          本轮刷新失败(展示上一帧):{error}
        </div>
      )}

      {/* 统计卡 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <StatCard label="事实数" value={overview.facts} />
        <StatCard label="含前驱" value={overview.facts_with_predecessors} />
        <StatCard label="verdict correct" value={correct} color={SEM.green} />
        <StatCard label="verdict wrong" value={wrong} color={wrong > 0 ? SEM.red : undefined} />
        <StatCard label="live workers" value={liveWorkers ?? '—'} color={liveWorkers ? SEM.blue : undefined} />
      </div>

      {/* 最新指导/阐述高亮 */}
      <SectionTitle>最新指导 / 阐述</SectionTitle>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <ChannelHighlight title="master_guidance" entry={guidance} />
        <ChannelHighlight title="elaboration" entry={elaboration} />
      </div>

      {/* 最近 verification 条目 */}
      <SectionTitle>最近 verification</SectionTitle>
      {verification.length === 0 ? (
        <EmptyState text="暂无 verification 条目" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {verification.map((e, i) => (
            <Card key={e.id ?? i} style={{ padding: '8px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Badge text={String(e.verdict ?? '?')} color={verdictColor(String(e.verdict ?? '?'))} />
                {e.fact_id && <span style={{ fontSize: 11, fontFamily: 'monospace', color: C.caption }}>{e.fact_id}</span>}
                {e.author && <span style={{ fontSize: 11, color: C.caption }}>{e.author}</span>}
                <span style={{ flex: 1 }} />
                {e.timestamp_utc && <span style={{ fontSize: 11, color: C.caption }}>{e.timestamp_utc}</span>}
              </div>
              <div style={{
                marginTop: 4, fontSize: 12, color: C.textDim,
                overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              }}>
                {e.claim || '(无 claim)'}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
