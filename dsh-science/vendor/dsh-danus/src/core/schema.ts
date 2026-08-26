/**
 * schema.ts — 三个核心数据结构的 schema + 内容寻址 fact id。
 * 逐行移植自 danus/core/schema.py(行为规格见 spec/core.md)。
 */

import { canonJson, contentId16, normalizeText, pySortedStrings, codePointCompare } from './util.ts'

// --------------------------------------------------------------------------- //
// global memory kinds(强分类)+ 状态机                                        //
// --------------------------------------------------------------------------- //

/** kind -> 默认 `verifiable`(客观可查 vs 判断)。顺序与原版 dict 一致。 */
export const GLOBAL_KINDS: Readonly<Record<string, boolean>> = {
  conclusion: true,
  example: true,
  counterexample: true,
  proof_attempt: true,
  plan: false,
  dead_end: false,
  direction: false,
  obstacle: false,
  master_guidance: false, // main agent 自己的周期性方向(DATA_MODEL.md §2.3)
  verification: false, // fact_submit 验证结果的轨迹(由 fact_submit 记录)
  elaboration: false, // main agent 的周期高信号进展综合(DATA_MODEL.md §2.4)
}

/** global-memory 条目生命周期。由 agent 设置;存储只记录(无强制机制)。 */
export const STATUSES = [
  'unverified', 'verifying', 'verified', 'refuted', // verifiable 条目
  'open', 'supported', 'challenged', // judgment 条目
] as const
export type Status = (typeof STATUSES)[number]

// --------------------------------------------------------------------------- //
// fact 节点                                                                   //
// --------------------------------------------------------------------------- //

/** 结构化 external ref 的 canonical 键序;额外键按码点序排在其后。 */
export const EXTERNAL_REF_KEYS = [
  'key', 'authors', 'title', 'arxiv', 'year', 'venue', 'doi', 'cited_for',
] as const

export type JsonObject = { [key: string]: unknown }

/**
 * clean_external_refs:归一化为 JSON-safe dict 列表,键序稳定。
 * 丢弃非 dict 条目;永不抛错(advisory 数据)。
 */
export function cleanExternalRefs(refs: unknown): JsonObject[] {
  if (!refs || !Array.isArray(refs)) return []
  const out: JsonObject[] = []
  for (const r of refs) {
    if (typeof r !== 'object' || r === null || Array.isArray(r)) continue
    const rec = r as JsonObject
    const ordered: JsonObject = {}
    for (const k of EXTERNAL_REF_KEYS) if (k in rec) ordered[k] = rec[k]
    for (const k of Object.keys(rec).sort(codePointCompare)) {
      if (!(k in ordered)) ordered[k] = rec[k]
    }
    out.push(ordered)
  }
  return out
}

/** 一个已验证事实 = fact graph 的一个节点。 */
export interface Fact {
  fact_id: string
  problem_id: string
  author: string
  predecessors: string[] // bare-hex fact ids(DAG)
  statement: string
  proof: string
  glossary_introduces: Record<string, string> // symbol -> definition
  intuition: string
  /**
   * 结构化外部文献(证明引用的已发表结果)。可变元数据 —— 不参与
   * 内容寻址 fact_id(见 computeFactId);引用 key 本身已在 proof 中被哈希。
   */
  external_refs: JsonObject[]
}

export function emptyFact(partial: Partial<Fact> & Pick<Fact, 'fact_id' | 'problem_id' | 'author' | 'predecessors' | 'statement' | 'proof'>): Fact {
  return {
    glossary_introduces: {},
    intuition: '',
    external_refs: [],
    ...partial,
  }
}

/**
 * compute_fact_id:确定性 16-hex SHA-256,输入为规范化内容(Danus 方案)。
 * 同内容 → 同 id → 自然去重。external_refs 刻意排除(可变文献元数据)。
 */
export function computeFactId(input: {
  problem_id: string
  predecessors: string[]
  glossary_introduces: Record<string, string>
  statement: string
  proof: string
}): string {
  const glossary: Record<string, string> = {}
  const pairs = Object.entries(input.glossary_introduces)
    .map(([k, v]) => [String(k), String(v)] as const)
    .sort((a, b) => codePointCompare(a[0], b[0]) || codePointCompare(a[1], b[1]))
  for (const [k, v] of pairs) glossary[k] = v
  const body = {
    problem_id: input.problem_id,
    predecessors: pySortedStrings(input.predecessors),
    glossary_introduces: glossary,
    statement: normalizeText(input.statement),
    proof: normalizeText(input.proof),
  }
  return contentId16(canonJson(body))
}
