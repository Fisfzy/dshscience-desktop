/**
 * global-memory.ts — 项目共享的强类型发现记忆。移植自 danus/core/global_memory.py。
 *
 * 布局:<project>/global_memory/<kind>.jsonl(每 kind 一个 append-only 文件)
 * + _status.jsonl(status 折叠日志,last wins)。
 * 共享感知,不是正确性来源(唯一真源是 fact graph)。
 */

import { join } from 'node:path'
import { bm25Scores, tokenize } from './bm25.ts'
import { GLOBAL_KINDS, STATUSES, type Status } from './schema.ts'
import { appendJsonl, contentId16, pyDumps, readJsonl, utcNow } from './util.ts'

const STATUS_LOG = '_status.jsonl'

export interface GmEntry {
  id: string
  timestamp_utc: string
  author: string
  kind: string
  claim: string
  evidence: string
  verifiable: boolean
  status: string
  fact_id: string | null
  links: Record<string, unknown>
  glossary: Record<string, unknown>
  [extra: string]: unknown
}

export class GlobalMemory {
  readonly dir: string

  constructor(root: string) {
    this.dir = join(root, 'global_memory')
  }

  private path(kind: string): string {
    return join(this.dir, `${kind}.jsonl`)
  }

  /**
   * 追加一条条目,返回 entry id。
   * id = sha256(json([kind, claim, author, ts]))[:16] —— 含时间戳,非内容寻址。
   * verifiable 缺省取 GLOBAL_KINDS[kind];可验证条目必须有非空 evidence。
   */
  append(
    kind: string,
    claim: string,
    evidence: string,
    author: string,
    opts: {
      verifiable?: boolean | null
      links?: Record<string, unknown> | null
      glossary?: Record<string, unknown> | null
      extra?: Record<string, unknown>
    } = {},
  ): string {
    if (!(kind in GLOBAL_KINDS)) {
      throw new Error(`unknown kind '${kind}'. Known: ${Object.keys(GLOBAL_KINDS).sort()}`)
    }
    const verifiable = opts.verifiable ?? GLOBAL_KINDS[kind]!
    if (verifiable && !(evidence ?? '').trim()) {
      throw new Error(`kind '${kind}' is verifiable and requires explicit evidence`)
    }
    const ts = utcNow()
    const entryId = contentId16(pyDumps([kind, claim, author, ts]))
    const entry: GmEntry = {
      id: entryId,
      timestamp_utc: ts,
      author,
      kind,
      claim,
      evidence,
      verifiable,
      status: verifiable ? 'unverified' : 'open',
      fact_id: null,
      links: opts.links ?? {},
      glossary: opts.glossary ?? {},
      ...(opts.extra ?? {}),
    }
    appendJsonl(this.path(kind), entry as unknown as Record<string, unknown>)
    return entryId
  }

  /** append-only 状态推进;不改原 entry。 */
  setStatus(entryId: string, status: string, factId: string | null = null): void {
    if (!(STATUSES as readonly string[]).includes(status)) {
      throw new Error(`invalid status '${status}'. Valid: ${STATUSES}`)
    }
    appendJsonl(join(this.dir, STATUS_LOG), {
      timestamp_utc: utcNow(),
      id: entryId,
      status,
      fact_id: factId,
    })
  }

  /** _status.jsonl 折叠:last wins。 */
  private latestStatus(): Map<string, { status: string; fact_id: unknown }> {
    const latest = new Map<string, { status: string; fact_id: unknown }>()
    for (const rec of readJsonl(join(this.dir, STATUS_LOG))) {
      if (rec.id) {
        latest.set(String(rec.id), { status: String(rec.status), fact_id: rec.fact_id })
      }
    }
    return latest
  }

  private fold(entry: GmEntry, latest: Map<string, { status: string; fact_id: unknown }>): GmEntry {
    const st = latest.get(entry.id)
    if (st) {
      return { ...entry, status: st.status, fact_id: (st.fact_id as string | null) || entry.fact_id }
    }
    return entry
  }

  /** 读某 kind 全部条目(status 折叠后)。 */
  read(kind: string): GmEntry[] {
    const latest = this.latestStatus()
    return readJsonl(this.path(kind)).map((e) => this.fold(e as unknown as GmEntry, latest))
  }

  /**
   * 按 kind 分桶 BM25 搜索。对整条 entry 的 JSON 文本分词;
   * 每桶按 score 降序、剔除零分、最多 limitPerKind 条。
   */
  search(
    query: string,
    kinds: string[] | null = null,
    limitPerKind = 10,
  ): { query: string; results_by_kind: Record<string, { count: number; results: { score: number; entry: GmEntry }[] }> } {
    const latest = this.latestStatus()
    const out: Record<string, { count: number; results: { score: number; entry: GmEntry }[] }> = {}
    for (const kind of kinds ?? Object.keys(GLOBAL_KINDS)) {
      const entries = readJsonl(this.path(kind)) as unknown as GmEntry[]
      const docs = entries.map((e) => tokenize(pyDumps(e)))
      const scores = bm25Scores(query, docs)
      const order = entries.map((_, i) => i).sort((a, b) => scores[b]! - scores[a]!)
      const ranked: { score: number; entry: GmEntry }[] = []
      for (const i of order) {
        const s = scores[i]!
        if (s <= 0) break
        ranked.push({ score: s, entry: this.fold(entries[i]!, latest) })
        if (ranked.length >= limitPerKind) break
      }
      out[kind] = { count: ranked.length, results: ranked }
    }
    return { query, results_by_kind: out }
  }
}
