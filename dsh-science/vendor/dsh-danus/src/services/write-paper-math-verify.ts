/**
 * services/write-paper-math-verify.ts — 全文档数学复验 helpers。
 * 移植自 danus/write_paper/paper_math_verify.py。
 *
 * 单独的第三验证器(不同于事实提交验证器与 reference verifier):paper 是重渲染/重拼接的
 * 另一产物,故须**按写作原样**整体复验。本模块是确定性、可离线测试的一半:
 *   document_body / whole_doc_budget —— 全文档输入 + 大小上限。
 *   ledger 读/写 + deliver_ok 门(VERIFY_LEDGER.md)。
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { atomicWrite, utcNow } from '../core/util.ts'

export function documentBody(tex: string): string {
  const m = tex.match(/\\begin\{document\}([\s\S]*)\\end\{document\}/)
  return m ? m[1]! : tex
}

export function wholeDocBudget(): number {
  const raw = process.env.DANUS_PAPER_VERIFY_WHOLE_DOC_CAP ?? ''
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n)) return 700000
  return n > 0 ? n : 700000
}

export const LEDGER_STATUSES = [
  'pending', 'correct', 'wrong', 'unresolved-context', 'oversized', 'uncovered',
  'overridden', 'trusted',
] as const

const LEDGER_HEADER =
  '# VERIFY_LEDGER — whole-paper math verification\n\n' +
  '<!-- ONLY the paper_verify_math tool writes verdict rows here. The main agent ' +
  'READS this file to know per-unit status + hints + attempts, and gates deliver ' +
  'on it (deliver is blocked unless every row is `correct` or `overridden`). The ' +
  'whole-paper gate writes one `whole-paper` row. The paper-math verifier CLASSIFIES ' +
  'its findings: `must-fix` (an undergraduate could not fill the step) drive the ' +
  'verdict — any must-fix => status `wrong`; `ignorable` findings (an undergraduate ' +
  'could fill them unaided) are recorded in the `ignorable` field and NEVER block ' +
  'deliver — surface them to the operator, do not chase them. -->\n'

const ROW_HEAD_RE = /^##\s+(\S+)\s*$/
const ROW_FIELD_RE = /^-\s+([A-Za-z_][\w-]*):\s*(.*)$/

export interface LedgerRow {
  unit_id: string
  label: string
  source_fact: string
  status: string
  last_verdict: string
  repair_hints: string
  ignorable: string
  attempts: number
  last_checked_utc: string
}

export function makeRow(unit_id: string): LedgerRow {
  return {
    unit_id, label: '', source_fact: '', status: 'pending', last_verdict: '',
    repair_hints: '', ignorable: '', attempts: 0, last_checked_utc: '',
  }
}

export function readLedger(path: string): Map<string, LedgerRow> {
  const rows = new Map<string, LedgerRow>()
  if (!existsSync(path)) return rows
  let cur: LedgerRow | null = null
  for (const ln of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const h = ln.match(ROW_HEAD_RE)
    if (h) {
      cur = makeRow(h[1]!)
      rows.set(cur.unit_id, cur)
      continue
    }
    if (cur === null) continue
    const f = ln.match(ROW_FIELD_RE)
    if (!f) continue
    const [key, val] = [f[1]!, f[2]!.trim()]
    if (key === 'label') cur.label = val
    else if (key === 'source_fact') cur.source_fact = val
    else if (key === 'status') cur.status = val
    else if (key === 'last_verdict') cur.last_verdict = val
    else if (key === 'repair_hints') cur.repair_hints = val
    else if (key === 'ignorable') cur.ignorable = val
    else if (key === 'attempts') {
      const n = Number.parseInt(val, 10)
      cur.attempts = Number.isNaN(n) ? 0 : n
    } else if (key === 'last_checked_utc') cur.last_checked_utc = val
  }
  return rows
}

export function writeLedger(path: string, rows: LedgerRow[]): void {
  const parts = [LEDGER_HEADER]
  for (const r of rows) {
    parts.push(`\n## ${r.unit_id}`)
    parts.push(`- label: ${r.label}`)
    parts.push(`- source_fact: ${r.source_fact}`)
    parts.push(`- status: ${r.status}`)
    parts.push(`- last_verdict: ${r.last_verdict}`)
    parts.push(`- repair_hints: ${r.repair_hints}`)
    parts.push(`- ignorable: ${r.ignorable}`)
    parts.push(`- attempts: ${r.attempts}`)
    parts.push(`- last_checked_utc: ${r.last_checked_utc}`)
  }
  mkdirSync(dirname(path), { recursive: true })
  atomicWrite(path, parts.join('\n').replace(/\n+$/, '') + '\n')
}

export function mergeAttempts(prev: Map<string, LedgerRow>, unitId: string): number {
  const old = prev.get(unitId)
  return (old ? old.attempts : 0) + 1
}

export function deliverOk(path: string): [boolean, string[]] {
  const rows = readLedger(path)
  if (rows.size === 0) return [false, ['no ledger (run paper_verify_math first)']]
  const blockers: string[] = []
  for (const r of rows.values()) {
    if (!['correct', 'trusted', 'overridden'].includes(r.status)) {
      blockers.push(`${r.unit_id} [${r.label}] (${r.status})`)
    }
  }
  return [blockers.length === 0, blockers]
}

export function utc(): string {
  return utcNow()
}
