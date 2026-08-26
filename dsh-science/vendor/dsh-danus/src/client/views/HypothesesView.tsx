/**
 * client/views/HypothesesView.tsx — 推理假设(global memory)管理。
 *
 * 11 种频道 chips 过滤;条目列表(claim/evidence 截断展开、status 徽章、
 * author、时间);judgment 类标记 supported/challenged,verifiable 类标记
 * verified/refuted;新增条目表单(kind/claim/evidence,verifiable 随 kind
 * 自动);撤销事实(fact_id + reason,二次确认,展示级联结果)。手动刷新。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { CHANNEL_KINDS, api, channelRole } from '../api'
import type { ChannelEntry } from '../api'
import {
  Badge, Btn, C, Card, EmptyState, ErrorState, ExpandableText, Feedback,
  LoadingState, MONO, SEM, SectionTitle, inputStyle, textareaStyle, useAsync,
} from './shared'

function statusColor(status: string): string {
  switch (status) {
    case 'supported': case 'verified': return SEM.green
    case 'challenged': return SEM.orange
    case 'refuted': return SEM.red
    case 'open': return SEM.blue
    default: return SEM.gray
  }
}

/** 该条目可执行的状态标记:judgment 类 → supported/challenged;verifiable → verified/refuted。 */
function statusActions(kind: string, entry: ChannelEntry): string[] {
  if (channelRole(kind) === 'judgment') return ['supported', 'challenged']
  if (entry.verifiable === true) return ['verified', 'refuted']
  return []
}

const KIND_LABEL: Record<string, string> = {
  conclusion: '结论', example: '示例', counterexample: '反例', proof_attempt: '证明尝试',
  plan: '计划', direction: '方向', obstacle: '障碍', dead_end: '死路',
  verification: '验证', elaboration: '阐述', master_guidance: '主指导',
}

export function HypothesesView(props: { project: string }): ReactNode {
  const [kind, setKind] = useState<string>('verification')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  // 新增条目表单
  const [showAdd, setShowAdd] = useState(false)
  const [newKind, setNewKind] = useState('plan')
  const [newClaim, setNewClaim] = useState('')
  const [newEvidence, setNewEvidence] = useState('')
  const [newVerifiable, setNewVerifiable] = useState(false)

  // 撤销事实
  const [showRevoke, setShowRevoke] = useState(false)
  const [revokeId, setRevokeId] = useState('')
  const [revokeReason, setRevokeReason] = useState('')
  const [revokeConfirm, setRevokeConfirm] = useState(false)
  const [revoked, setRevoked] = useState<string[] | null>(null)

  const channels = useAsync(() => api.channels(), [])
  const entries = useAsync(() => api.channel(kind), [kind])

  const countOf = (k: string): number | null =>
    channels.data?.channels.find((c) => c.kind === k)?.count ?? null

  const mark = async (id: string | undefined, status: string): Promise<void> => {
    if (!id) { setMsg({ ok: false, text: '该条目缺少 id,无法标记' }); return }
    setBusy(true)
    setMsg(null)
    try {
      await api.gmStatus(props.project, id, status)
      setMsg({ ok: true, text: `已标记 ${id} → ${status}` })
      entries.reload()
      channels.reload()
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error)?.message ?? e) })
    } finally {
      setBusy(false)
    }
  }

  const submitAdd = async (): Promise<void> => {
    if (!newClaim.trim()) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await api.gmAdd(props.project, {
        kind: newKind, claim: newClaim.trim(), evidence: newEvidence.trim(), verifiable: newVerifiable,
      })
      setMsg({ ok: true, text: `已新增条目 ${res.id}` })
      setNewClaim('')
      setNewEvidence('')
      setShowAdd(false)
      if (newKind === kind) entries.reload()
      channels.reload()
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error)?.message ?? e) })
    } finally {
      setBusy(false)
    }
  }

  const submitRevoke = async (): Promise<void> => {
    if (!revokeId.trim()) return
    setBusy(true)
    setMsg(null)
    setRevoked(null)
    try {
      const res = await api.revokeFact(props.project, revokeId.trim(), revokeReason.trim() || 'operator console revoke')
      setRevoked(res.revoked ?? [])
      setMsg({ ok: true, text: `已撤销 ${res.revoked?.length ?? 0} 条事实` })
      setRevokeConfirm(false)
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error)?.message ?? e) })
      setRevokeConfirm(false)
    } finally {
      setBusy(false)
    }
  }

  if (!props.project) return <EmptyState text="未选择项目" hint="请先在顶部选择一个项目" />

  return (
    <div style={{ padding: 12 }}>
      {/* kind 过滤 chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {CHANNEL_KINDS.map(([k, role]) => {
          const active = k === kind
          const count = countOf(k)
          return (
            <span
              key={k}
              onClick={() => setKind(k)}
              title={`${k} (${role})`}
              style={{
                padding: '3px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
                border: `1px solid ${active ? C.brand : C.border}`,
                color: active ? C.brand : C.textDim,
                background: active ? `color-mix(in srgb, ${C.brand} 12%, transparent)` : 'transparent',
                whiteSpace: 'nowrap',
              }}
            >
              {KIND_LABEL[k] ?? k}
              {count != null && <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.75 }}>{count}</span>}
            </span>
          )
        })}
      </div>

      <SectionTitle
        right={
          <span style={{ display: 'flex', gap: 6 }}>
            <Btn onClick={() => { setShowAdd(!showAdd); setShowRevoke(false) }}>{showAdd ? '收起表单' : '新增条目'}</Btn>
            <Btn danger onClick={() => { setShowRevoke(!showRevoke); setShowAdd(false); setRevoked(null) }}>
              {showRevoke ? '收起撤销' : '撤销事实'}
            </Btn>
            <Btn onClick={() => { entries.reload(); channels.reload() }}>刷新</Btn>
          </span>
        }
      >
        {KIND_LABEL[kind] ?? kind}({entries.data?.count ?? '…'})
      </SectionTitle>
      <Feedback msg={msg} />

      {/* 新增条目表单 */}
      {showAdd && (
        <Card style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: C.caption, width: 64 }}>kind</span>
              <select
                value={newKind}
                onChange={(e) => {
                  const k = e.target.value
                  setNewKind(k)
                  // verifiable 自动:result/verify 类可验证,其余默认不可。
                  const role = channelRole(k)
                  setNewVerifiable(role === 'result' || role === 'verify')
                }}
                style={{ ...inputStyle, width: 'auto' }}
              >
                {CHANNEL_KINDS.map(([k]) => (
                  <option key={k} value={k}>{KIND_LABEL[k] ?? k}({k})</option>
                ))}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: C.textDim }}>
                <input
                  type="checkbox"
                  checked={newVerifiable}
                  onChange={(e) => setNewVerifiable(e.target.checked)}
                />
                verifiable
              </label>
            </div>
            <input
              value={newClaim}
              onChange={(e) => setNewClaim(e.target.value)}
              placeholder="claim(断言,必填)"
              style={inputStyle}
            />
            <textarea
              value={newEvidence}
              onChange={(e) => setNewEvidence(e.target.value)}
              placeholder="evidence(证据/论证)"
              style={textareaStyle}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Btn onClick={() => setShowAdd(false)}>取消</Btn>
              <Btn primary onClick={() => { void submitAdd() }} disabled={busy || !newClaim.trim()}>提交</Btn>
            </div>
          </div>
        </Card>
      )}

      {/* 撤销事实 */}
      {showRevoke && (
        <Card style={{ marginTop: 8, borderColor: `color-mix(in srgb, ${SEM.red} 50%, ${C.border})` }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, color: SEM.red }}>
              撤销会级联删除依赖该事实的所有下游事实,不可恢复。
            </div>
            <input
              value={revokeId}
              onChange={(e) => { setRevokeId(e.target.value); setRevokeConfirm(false) }}
              placeholder="fact_id(如 f000123)"
              style={{ ...inputStyle, fontFamily: MONO }}
            />
            <input
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              placeholder="reason(撤销原因)"
              style={inputStyle}
            />
            {!revokeConfirm ? (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Btn danger onClick={() => setRevokeConfirm(true)} disabled={!revokeId.trim()}>
                  撤销…
                </Btn>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                <span style={{ fontSize: 12, color: SEM.red }}>确认撤销 {revokeId} 及其全部下游?</span>
                <Btn onClick={() => setRevokeConfirm(false)}>再想想</Btn>
                <Btn danger onClick={() => { void submitRevoke() }} disabled={busy}>确认撤销</Btn>
              </div>
            )}
            {revoked && (
              <div style={{ fontSize: 12, color: C.textDim }}>
                级联撤销({revoked.length}):
                <span style={{ fontFamily: MONO, marginLeft: 4 }}>
                  {revoked.length > 0 ? revoked.join(', ') : '(无)'}
                </span>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* 条目列表 */}
      <div style={{ marginTop: 8 }}>
        {entries.loading && <LoadingState />}
        {entries.error && <ErrorState error={entries.error} onRetry={entries.reload} />}
        {entries.data && entries.data.entries.length === 0 && (
          <EmptyState text="该频道暂无条目" />
        )}
        {entries.data && entries.data.entries.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {entries.data.entries.map((e, i) => {
              const actions = statusActions(kind, e)
              return (
                <Card key={e.id ?? i} style={{ padding: '8px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {e.status && <Badge text={e.status} color={statusColor(e.status)} />}
                    {e.verifiable === true && <Badge text="verifiable" color={SEM.blue} />}
                    {e.id && <span style={{ fontSize: 11, fontFamily: MONO, color: C.caption }}>{e.id}</span>}
                    {e.author && <span style={{ fontSize: 11, color: C.caption }}>{e.author}</span>}
                    <span style={{ flex: 1 }} />
                    {e.timestamp_utc && <span style={{ fontSize: 11, color: C.caption }}>{e.timestamp_utc}</span>}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: C.text }}>
                    <ExpandableText text={String(e.claim ?? '')} />
                  </div>
                  {typeof e.evidence === 'string' && e.evidence && (
                    <div style={{ marginTop: 4, fontSize: 12, color: C.textDim }}>
                      <ExpandableText text={e.evidence} limit={220} />
                    </div>
                  )}
                  {e.fact_id && (
                    <div style={{ marginTop: 4, fontSize: 11, fontFamily: MONO, color: C.caption }}>
                      fact: {e.fact_id}
                    </div>
                  )}
                  {actions.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      {actions.map((s) => (
                        <Btn key={s} onClick={() => { void mark(e.id, s) }} disabled={busy || e.status === s}>
                          标记 {s}
                        </Btn>
                      ))}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
