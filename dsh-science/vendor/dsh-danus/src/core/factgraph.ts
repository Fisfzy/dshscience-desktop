/**
 * factgraph.ts — 项目共享、已验证、内容寻址 DAG。移植自 danus/core/factgraph.py。
 *
 * 每个事实一个可读 markdown 文件:YAML-ish frontmatter(fact_id / problem_id /
 * author / predecessors / glossary_introduces / external_refs)+ markdown 正文
 * (## statement / ## proof / 可选 ## intuition)。另有项目 glossary、撤销日志
 * 与 _revoked/ 归档。
 *
 * 纯数据结构 I/O:"一条断言是否配得上成为事实"是 verifier 的判断(写门在
 * fact_submit,仅 accept 才调 add)。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { bm25Scores, tokenize } from './bm25.ts'
import { flattenGlossary, globalTerms, undefinedSymbols } from './glossary.ts'
import {
  appendJsonl, atomicWrite, codePointCompare, pyDumps, utcNow,
} from './util.ts'
import { cleanExternalRefs, computeFactId, type Fact, type JsonObject } from './schema.ts'

const PRED_RE = /^predecessors:\s*\[(.*)\]\s*$/
const GLOSS_LINE_RE = /^\s{2}([^:]+):\s*(.*)$/

/** fact 的 ## statement 段(到下一个 ## 标题为止)拼成的单行摘要。 */
export function statementOf(text: string): string {
  const out: string[] = []
  let inStmt = false
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (t.startsWith('## ')) {
      if (inStmt) break
      inStmt = t.toLowerCase() === '## statement'
      continue
    }
    if (inStmt) out.push(t)
  }
  return out.filter((s) => s).join(' ').trim()
}

/** 把 Fact 渲染为可读 markdown+frontmatter 形态(字节级对齐原版 serialize_fact)。 */
export function serializeFact(fact: Fact): string {
  const lines: string[] = [
    '---',
    `fact_id: ${fact.fact_id}`,
    `problem_id: ${fact.problem_id}`,
    `author: ${fact.author}`,
    `predecessors: [${fact.predecessors.join(', ')}]`,
  ]
  const gkeys = Object.keys(fact.glossary_introduces)
  if (gkeys.length > 0) {
    lines.push('glossary_introduces:')
    for (const k of gkeys.sort(codePointCompare)) {
      lines.push(`  ${k}: ${fact.glossary_introduces[k]}`)
    }
  } else {
    lines.push('glossary_introduces: {}')
  }
  // external_refs:单行 JSON 流式数组(总是输出,空为 [])——Python 默认分隔符形态。
  lines.push('external_refs: ' + pyDumps(fact.external_refs))
  lines.push('---', '', '## statement', fact.statement.trim(), '', '## proof', fact.proof.trim())
  if (fact.intuition.trim()) {
    lines.push('', '## intuition', fact.intuition.trim())
  }
  lines.push('')
  return lines.join('\n')
}

export interface Frontmatter {
  predecessors: string[]
  glossary_introduces: Record<string, string>
  external_refs: JsonObject[]
}

/** 从 frontmatter 提取 predecessors / glossary_introduces / external_refs(旧格式缺省 [])。 */
export function parseFrontmatter(text: string): Frontmatter {
  let preds: string[] = []
  const gloss: Record<string, string> = {}
  let refs: JsonObject[] = []
  let inGloss = false
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const stripped = line.trim()
    if (i > 0 && stripped === '---') break
    const m = stripped.match(PRED_RE)
    if (m) {
      preds = m[1]!.split(',').map((x) => x.trim()).filter((x) => x)
      inGloss = false
      continue
    }
    if (stripped.startsWith('glossary_introduces:')) {
      inGloss = !stripped.includes('{}')
      continue
    }
    if (stripped.startsWith('external_refs:')) {
      inGloss = false
      const payload = stripped.slice('external_refs:'.length).trim()
      if (!payload) {
        refs = []
      } else {
        try {
          const parsed = JSON.parse(payload)
          refs = Array.isArray(parsed) ? parsed : []
        } catch {
          refs = []
        }
      }
      continue
    }
    if (inGloss) {
      const gm = line.match(GLOSS_LINE_RE)
      if (gm) {
        gloss[gm[1]!.trim()] = gm[2]!.trim()
      } else {
        inGloss = false
      }
    }
  }
  return { predecessors: preds, glossary_introduces: gloss, external_refs: refs }
}

export interface FactSearchHit {
  fact_id: string
  score: number
  statement: string
}

/** 以项目目录为根;唯一正确性来源。 */
export class FactGraph {
  readonly dir: string
  readonly factsDir: string
  readonly revokedDir: string
  readonly glossaryPath: string
  readonly revocationLog: string

  constructor(root: string) {
    this.dir = join(root, 'fact_graph')
    this.factsDir = join(this.dir, 'facts')
    this.revokedDir = join(this.dir, '_revoked')
    this.glossaryPath = join(this.dir, 'glossary.json')
    this.revocationLog = join(this.dir, 'revocation_log.jsonl')
  }

  private path(factId: string): string {
    return join(this.factsDir, `${factId}.md`)
  }

  // ------------------------------------------------------------------ write
  /**
   * 写入一个已验证事实,返回内容寻址 fact_id。
   * 拒绝已撤销前驱(级联完整性)。幂等:同内容 → 同 id → 同文件。
   * 合并该事实引入的符号进项目 glossary。external_refs 不影响 fact_id。
   */
  add(input: {
    problem_id: string
    author: string
    statement: string
    proof: string
    predecessors?: string[] | null
    glossary_introduces?: Record<string, string> | null
    intuition?: string
    external_refs?: unknown
  }): string {
    const predecessors = (input.predecessors ?? []).filter((p) => p)
    const glossaryIntroduces = input.glossary_introduces ?? {}
    const externalRefs = cleanExternalRefs(input.external_refs)
    for (const pid of predecessors) {
      if (existsSync(join(this.revokedDir, `${pid}.md`))) {
        throw new Error(`predecessor_revoked: ${pid}`)
      }
    }
    const factId = computeFactId({
      problem_id: input.problem_id,
      predecessors,
      glossary_introduces: glossaryIntroduces,
      statement: input.statement,
      proof: input.proof,
    })
    const fact: Fact = {
      fact_id: factId,
      problem_id: input.problem_id,
      author: input.author,
      predecessors,
      statement: input.statement,
      proof: input.proof,
      glossary_introduces: glossaryIntroduces,
      intuition: input.intuition ?? '',
      external_refs: externalRefs,
    }
    mkdirSync(this.factsDir, { recursive: true })
    atomicWrite(this.path(factId), serializeFact(fact))
    this.mergeGlossary(glossaryIntroduces)
    return factId
  }

  private mergeGlossary(next: Record<string, string>): void {
    if (Object.keys(next).length === 0) return
    const cur = this.glossary()
    for (const [k, v] of Object.entries(next)) cur[String(k)] = String(v)
    mkdirSync(this.dir, { recursive: true })
    atomicWrite(this.glossaryPath, pyDumps(cur, { indent: 2 }))
  }

  // ------------------------------------------------------------------- read
  exists(factId: string): boolean {
    return existsSync(this.path(factId))
  }

  list(): string[] {
    if (!existsSync(this.factsDir)) return []
    return readdirSync(this.factsDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.slice(0, -3))
      .sort(codePointCompare)
  }

  /** 事实的 markdown(agent 直接读 markdown)。 */
  getRaw(factId: string): string | null {
    const p = this.path(factId)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }

  /** 累积的项目 glossary(symbol -> definition);坏 JSON → {}(永不抛)。 */
  glossary(): Record<string, string> {
    if (!existsSync(this.glossaryPath)) return {}
    try {
      const parsed = JSON.parse(readFileSync(this.glossaryPath, 'utf8'))
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, string>
      }
      return {}
    } catch {
      return {}
    }
  }

  /**
   * 对 fact 正文做 BM25;派生索引按需即时重建(无持久 board,无双写漂移)。
   * 返回 {fact_id, score, statement} 降序 top-limit;零分截断。
   */
  search(query: string, limit = 10): FactSearchHit[] {
    const fids = this.list()
    if (fids.length === 0) return []
    const raws = fids.map((fid) => this.getRaw(fid) ?? '')
    const docs = raws.map((r) => tokenize(r))
    const scores = bm25Scores(query, docs)
    const order = fids.map((_, i) => i).sort((a, b) => scores[b]! - scores[a]!)
    const ranked: FactSearchHit[] = []
    for (const i of order) {
      const score = scores[i]!
      if (score <= 0) break
      ranked.push({ fact_id: fids[i]!, score, statement: statementOf(raws[i]!) })
      if (ranked.length >= limit) break
    }
    return ranked
  }

  predecessors(factId: string): string[] {
    return parseFrontmatter(this.getRaw(factId) ?? '').predecessors
  }

  externalRefs(factId: string): JsonObject[] {
    return parseFrontmatter(this.getRaw(factId) ?? '').external_refs
  }

  /**
   * 就地替换一个事实的 external_refs —— reference auditor 的写路径。
   * 只动这一行可变 frontmatter;正文与内容寻址 fact_id 不变(refs 不参与哈希)。
   */
  setExternalRefs(factId: string, externalRefs: unknown): JsonObject[] {
    const p = this.path(factId)
    if (!existsSync(p)) throw new Error(`unknown fact_id: ${factId}`)
    const refs = cleanExternalRefs(externalRefs)
    const newLine = 'external_refs: ' + pyDumps(refs)
    const lines = readFileSync(p, 'utf8').split('\n')
    // Python splitlines() 语义:去掉行尾换行;末尾的 '\n' 不产生空行元素。
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    let close = -1
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]!.trim() === '---') {
        close = i
        break
      }
    }
    if (close === -1) throw new Error(`malformed fact file (no frontmatter close): ${factId}`)
    let idx = -1
    for (let i = 1; i < close; i++) {
      if (lines[i]!.startsWith('external_refs:')) {
        idx = i
        break
      }
    }
    if (idx !== -1) {
      lines[idx] = newLine
    } else {
      lines.splice(close, 0, newLine) // 旧格式无该字段:插入
    }
    atomicWrite(p, lines.join('\n') + '\n')
    return refs
  }

  /** 所有(传递)依赖 fact_id 的事实(不含自身;DFS,序确定但非拓扑序)。 */
  descendants(factId: string): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    const frontier = [factId]
    while (frontier.length) {
      const cur = frontier.pop()!
      for (const fid of this.list()) {
        if (seen.has(fid)) continue
        if (this.predecessors(fid).includes(cur)) {
          out.push(fid)
          seen.add(fid)
          frontier.push(fid)
        }
      }
    }
    return out
  }

  // --------------------------------------------------------- glossary check
  /**
   * 正文中使用但无处可定义的符号(advisory):(本 fact glossary)∪(各前驱 glossary)
   * ∪(项目 glossary)∪(全局 universal notation)。
   */
  undefinedSymbols(input: {
    statement: string
    proof: string
    intuition?: string
    predecessors?: string[] | null
    glossary_introduces?: Record<string, string> | null
  }): string[] {
    const defined = globalTerms()
    for (const k of Object.keys(this.glossary())) defined.add(k)
    for (const k of Object.keys(input.glossary_introduces ?? {})) defined.add(k)
    for (const pid of input.predecessors ?? []) {
      const raw = this.getRaw(pid)
      if (raw) {
        for (const k of Object.keys(parseFrontmatter(raw).glossary_introduces)) defined.add(k)
      }
    }
    return undefinedSymbols({
      statement: input.statement,
      proof: input.proof,
      intuition: input.intuition ?? '',
      defined,
    })
  }

  // --------------------------------------------------------------- revoke
  /** 级联撤销 fact_id 及其全部依赖者;文件移入 _revoked/ 并逐条记日志。 */
  revoke(factId: string, reason: string): string[] {
    if (!this.exists(factId)) throw new Error(`unknown fact_id: ${factId}`)
    const toRevoke = [factId, ...this.descendants(factId)]
    mkdirSync(this.revokedDir, { recursive: true })
    for (const fid of toRevoke) {
      const src = this.path(fid)
      if (existsSync(src)) {
        renameSync(src, join(this.revokedDir, `${fid}.md`))
      }
      appendJsonl(this.revocationLog, {
        timestamp_utc: utcNow(),
        fact_id: fid,
        reason,
        revoked_as_dependent_of: fid !== factId ? factId : null,
      })
    }
    return toRevoke
  }
}

// 重新导出 flattenGlossary 供 verify/工具层使用(与原版 _glossary.flatten 对应)。
export { flattenGlossary }
