/**
 * client/views/ExportView.tsx — 结果导出。
 *
 * JSON / Markdown 下载(window.open 导出 URL,浏览器直接下载);TARGET /
 * facts markdown 内容预览(fetch format=md 文本,截断展示);说明论文/报告
 * 由 main agent 的 paper_write / summary_write 工具产出。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import { Btn, C, Card, EmptyState, LoadingState, MONO, SEM, SectionTitle, useAsync } from './shared'

const MD_PREVIEW_LIMIT = 6000

export function ExportView(props: { project: string }): ReactNode {
  const [mdText, setMdText] = useState<string | null>(null)
  const [mdError, setMdError] = useState<string | null>(null)
  const [mdLoading, setMdLoading] = useState(false)
  const [full, setFull] = useState(false)
  const overview = useAsync(() => api.overview(), [])

  const loadMd = async (): Promise<void> => {
    setMdLoading(true)
    setMdError(null)
    try {
      const res = await fetch(api.exportUrl(props.project, 'md'))
      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try {
          const data = (await res.json()) as { detail?: unknown }
          if (typeof data.detail === 'string') detail = data.detail
        } catch { /* ignore */ }
        throw new Error(detail)
      }
      setMdText(await res.text())
    } catch (e) {
      setMdError(String((e as Error)?.message ?? e))
    } finally {
      setMdLoading(false)
    }
  }

  if (!props.project) return <EmptyState text="未选择项目" hint="请先在顶部选择一个项目" />

  const truncated = mdText && !full && mdText.length > MD_PREVIEW_LIMIT

  return (
    <div style={{ padding: 12 }}>
      <SectionTitle>下载事实库</SectionTitle>
      <Card>
        <div style={{ fontSize: 12, color: C.textDim, marginBottom: 10 }}>
          导出项目 <b style={{ color: C.text }}>{props.project}</b> 的全部已验证事实
          {overview.data ? `(共 ${overview.data.facts} 条)` : ''};浏览器直接下载。
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn primary onClick={() => window.open(api.exportUrl(props.project, 'json'), '_blank')}>
            下载 JSON
          </Btn>
          <Btn primary onClick={() => window.open(api.exportUrl(props.project, 'md'), '_blank')}>
            下载 Markdown
          </Btn>
        </div>
      </Card>

      <SectionTitle
        right={
          <Btn onClick={() => { void loadMd() }} disabled={mdLoading}>
            {mdLoading ? '加载中…' : mdText ? '刷新预览' : '加载预览'}
          </Btn>
        }
      >
        内容预览(facts markdown)
      </SectionTitle>
      {mdError && (
        <div style={{ fontSize: 12, color: SEM.red, marginBottom: 8 }}>预览加载失败:{mdError}</div>
      )}
      {!mdText && !mdError && !mdLoading && (
        <EmptyState text="尚未加载预览" hint="点击「加载预览」拉取 format=md 导出内容" />
      )}
      {mdLoading && !mdText && <LoadingState />}
      {mdText != null && (
        <>
          <pre style={{
            margin: 0, padding: 12, maxHeight: truncated ? 360 : '70vh', overflow: 'auto',
            border: `1px solid ${C.border}`, borderRadius: 8, background: C.tip,
            fontFamily: MONO, fontSize: 11, lineHeight: '17px', color: C.textDim,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {truncated ? mdText.slice(0, MD_PREVIEW_LIMIT) : mdText}
          </pre>
          {mdText.length > MD_PREVIEW_LIMIT && (
            <div style={{ marginTop: 6 }}>
              <Btn onClick={() => setFull(!full)}>
                {full ? '收起(仅前 6000 字符)' : `展开全部(${mdText.length} 字符)`}
              </Btn>
            </div>
          )}
        </>
      )}

      <SectionTitle>说明</SectionTitle>
      <Card style={{ fontSize: 12, color: C.textDim, lineHeight: '20px' }}>
        <div>· 本页导出的是 verifier 门控后的事实库(fact graph 全量)。</div>
        <div>· 论文与总结报告由 main agent 的 <span style={{ fontFamily: MONO }}>paper_write</span> /
          <span style={{ fontFamily: MONO }}> summary_write</span> 工具产出,请直接在会话中要求生成。</div>
        <div>· JSON 含每条事实的 frontmatter 与原始 markdown;Markdown 为事实合集,
          可直接作为 TARGET / 附录材料。</div>
      </Card>
    </div>
  )
}
