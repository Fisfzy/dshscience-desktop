/**
 * services/write-paper-assemble.ts — write-paper 各角色的确定性 prompt 组装器。
 * 移植自 danus/write_paper/assemble.py(纯函数,无 codex/网络/写)。
 *
 * 每个角色得到**最小、不相交**输入集(隔离契约):
 *   - writer 嵌入目标闭包事实 + style + structure(+ 可选 exemplar);
 *   - auditor 只拿到 main.tex + ledger(无事实/无 style/structure);
 *   - verifier 只拿到 main.tex + ledger + auditor findings(无事实/无 style/structure);
 *   - reviser 无事实图。
 * 每个角色 prompt 都逐字内嵌 roles/AGENTS.md。
 *
 * fixed 文件位于 skill dir(operator 可编辑),调用时经
 * DANUS_WRITE_PAPER_SKILL_DIR 定位(默认 <pkg>/assets/write-paper);绝不 import 时读。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FactGraph } from '../core/factgraph.ts'
import { parseFrontmatter, statementOf } from '../core/factgraph.ts'
import { bodySections, readFixed, readProject, section } from '../authoring/common.ts'
import { packageRoot } from '../shared/layout.ts'
import {
  DEFAULT_PAPER_ID, isDefaultPaper, targetFactIds, terminalFacts, validatePaperId,
} from '../shared/target.ts'

export const ROLES = ['writer', 'auditor', 'reviser', 'verifier'] as const
export const TARGET_FILE = 'TARGET.md'
export const HEADLINE_SOURCES = ['arg', 'brief', 'target', 'unset'] as const

/** 默认 paper slug。None/""/此 slug → legacy 路径。 */
export { DEFAULT_PAPER_ID as DEFAULT_PAPER_ID }

const TARGET_ID_RE = /fact_[A-Za-z0-9_]+|\b[0-9a-f]{8,}\b/g
const HEADLINE_FIELD_RE = /^\s*headline_fact_ids\s*:\s*(.*?)\s*$/i
const EXEMPLAR_FIELD_RE = /^\s*structural_exemplar\s*:\s*(.*?)\s*$/i

/** 文案(原版 TargetUnsetError)。 */
export class TargetUnsetError extends Error {
  constructor(message?: string) {
    super(message ?? defaultUnsetMessage())
    this.name = 'TargetUnsetError'
  }
}

function defaultUnsetMessage(): string {
  return (
    'no paper target is set: pass an explicit headline, set ' +
    'headline_fact_ids in PROJECT_BRIEF.md, or run ' +
    '`danus finalize <project> <fact_id>` to record TARGET.md'
  )
}

// --------------------------------------------------------------------------- //
// config resolution (env read at CALL time)                                   //
// --------------------------------------------------------------------------- //

export function writePaperSkillDir(): string {
  const override = process.env.DANUS_WRITE_PAPER_SKILL_DIR
  return override ? override : join(packageRoot(), 'assets', 'write-paper')
}

/** read_fixed 绑定 writePaperSkillDir()。 */
export function readWritePaperFixed(rel: string): string {
  return readFixed(writePaperSkillDir(), rel)
}

export function readWritePaperProject(projectDir: string, rel: string): string {
  return readProject(projectDir, rel)
}

// --------------------------------------------------------------------------- //
// per-paper workspace resolution                                             //
// --------------------------------------------------------------------------- //

export function paperWorkspace(projectDir: string, paperId?: string | null): string {
  if (isDefaultPaper(paperId)) return join(projectDir, 'paper')
  validatePaperId(paperId ?? '')
  return join(projectDir, 'papers', paperId!)
}

export function paperTargetPath(projectDir: string, paperId?: string | null): string {
  if (isDefaultPaper(paperId)) return join(projectDir, TARGET_FILE)
  return join(paperWorkspace(projectDir, paperId), TARGET_FILE)
}

function readBrief(projectDir: string, paperId?: string | null): string {
  const path = join(paperWorkspace(projectDir, paperId), 'PROJECT_BRIEF.md')
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

export function briefHeadlineFactIds(projectDir: string, paperId?: string | null): string[] {
  for (const line of readBrief(projectDir, paperId).split(/\r?\n/)) {
    const m = line.match(HEADLINE_FIELD_RE)
    if (m) return idsFrom(m[1]!)
  }
  return []
}

export function briefStructuralExemplar(projectDir: string, paperId?: string | null): string | null {
  for (const line of readBrief(projectDir, paperId).split(/\r?\n/)) {
    const m = line.match(EXEMPLAR_FIELD_RE)
    if (m) {
      const val = m[1]!.trim()
      if (!val || val.startsWith('<')) return null
      return val
    }
  }
  return null
}

function idsFrom(payload: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of payload.matchAll(TARGET_ID_RE)) {
    if (!seen.has(m[0])) {
      seen.add(m[0])
      out.push(m[0])
    }
  }
  return out
}

// --------------------------------------------------------------------------- //
// headline resolution (绝不猜)                                               //
// --------------------------------------------------------------------------- //

export function resolveHeadline(
  projectDir: string,
  headline?: string[] | null,
  paperId?: string | null,
): [string[], string] {
  // 原版 `if headline:` —— 空列表为 falsy,不视为显式 arg。
  if (headline !== undefined && headline !== null && headline.length > 0) return [[...headline], 'arg']
  const fromBrief = briefHeadlineFactIds(projectDir, paperId)
  if (fromBrief.length > 0) return [fromBrief, 'brief']
  const fromTarget = targetFactIds(projectDir, paperId)
  if (fromTarget.length > 0) return [fromTarget, 'target']
  return [[], 'unset']
}

// --------------------------------------------------------------------------- //
// fact-graph content (writer only)                                            //
// --------------------------------------------------------------------------- //

/** Kahn 稳定拓扑(前驱先行),同层按 fg.list() 的 sorted-id 序破平;环则确定性追加。 */
export function toposortWithPredecessors(fg: FactGraph, seeds?: string[] | null): string[] {
  const allIds = fg.list()
  const known = new Set(allIds)
  let wanted: string[]
  if (seeds === undefined || seeds === null) {
    wanted = [...allIds]
  } else {
    const wantedSet = new Set<string>()
    const frontier = [...seeds]
    while (frontier.length > 0) {
      const fid = frontier.pop()!
      if (wantedSet.has(fid)) continue
      if (!known.has(fid)) throw new Error(`unknown fact id in headline: ${JSON.stringify(fid)}`)
      wantedSet.add(fid)
      frontier.push(...fg.predecessors(fid))
    }
    wanted = allIds.filter((fid) => wantedSet.has(fid))
  }

  const wantedSet = new Set(wanted)
  const predsIn = new Map<string, string[]>()
  for (const fid of wanted) {
    predsIn.set(fid, fg.predecessors(fid).filter((p) => wantedSet.has(p)))
  }
  const ordered: string[] = []
  const placed = new Set<string>()
  let remaining = [...wanted]
  let progressed = true
  while (remaining.length > 0 && progressed) {
    progressed = false
    const still: string[] = []
    for (const fid of remaining) {
      if (predsIn.get(fid)!.every((p) => placed.has(p))) {
        ordered.push(fid)
        placed.add(fid)
        progressed = true
      } else {
        still.push(fid)
      }
    }
    remaining = still
  }
  ordered.push(...remaining)
  return ordered
}

function bodySectionsFor(raw: string): string {
  // 复用 common.bodySections(frontmatter 剥除)。前一 DAG 行由 _fact_block 重构。
  return bodySections(raw)
}

function factBlock(fg: FactGraph, fid: string): string {
  const raw = fg.getRaw(fid) ?? ''
  const preds = parseFrontmatter(raw).predecessors
  const predLine = preds.length > 0 ? preds.join(', ') : '(none)'
  const header = `[source_fact: ${fid}]\npredecessors (DAG): ${predLine}\n`
  return header + '\n' + bodySectionsFor(raw)
}

function statementBlock(fg: FactGraph, fid: string): string {
  const raw = fg.getRaw(fid) ?? ''
  const preds = parseFrontmatter(raw).predecessors
  const predLine = preds.length > 0 ? preds.join(', ') : '(none)'
  const header = `[source_fact: ${fid}]\npredecessors (DAG): ${predLine}\n`
  const stmt = statementOf(raw).trim()
  return header + '\n## statement\n' + (stmt ? stmt : '(empty statement)') + '\n'
}

function resolveHeadlineIds(projectDir: string, headline: string[] | null | undefined, paperId: string | null | undefined): string[] {
  // 原版:_toposort_with_predecessors 只在 headline 是 None 时才经 resolve_headline;
  // 显式 headline(含 [])直接使用(空 [] → no-facts sentinel,不抛 unset)。
  if (headline !== undefined && headline !== null) return headline
  const [ids, source] = resolveHeadline(projectDir, null, paperId)
  if (source === 'unset') throw new TargetUnsetError()
  return ids
}

export function statementsOnlyContent(projectDir: string, headline?: string[] | null, paperId?: string | null): string {
  const fg = newFactGraph(projectDir)
  const ids = toposortWithPredecessors(fg, resolveHeadlineIds(projectDir, headline, paperId))
  if (ids.length === 0) return '_(no verified facts found in the project fact graph)_\n'
  return ids.map((fid) => statementBlock(fg, fid)).join('\n')
}

export function closureOrder(projectDir: string, headline?: string[] | null, paperId?: string | null): string[] {
  const fg = newFactGraph(projectDir)
  return toposortWithPredecessors(fg, resolveHeadlineIds(projectDir, headline, paperId))
}

export function fullBodiesFor(projectDir: string, factIds: string[]): string {
  const fg = newFactGraph(projectDir)
  if (factIds.length === 0) return '_(this section has no assigned facts — write only its prose)_\n'
  return factIds.map((fid) => factBlock(fg, fid)).join('\n')
}

export function statementsFor(projectDir: string, factIds: string[]): string {
  const fg = newFactGraph(projectDir)
  if (factIds.length === 0) return '_(no other closure facts)_\n'
  return factIds.map((fid) => statementBlock(fg, fid)).join('\n')
}

export function sectionRefContextIds(projectDir: string, sectionFactIds: string[], order: string[]): string[] {
  const fg = newFactGraph(projectDir)
  const exclude = new Set(sectionFactIds)
  const want = new Set<string>()
  for (const fid of sectionFactIds) {
    for (const p of fg.predecessors(fid)) {
      if (!exclude.has(p)) want.add(p)
    }
  }
  const pos = new Map<string, number>()
  order.forEach((f, i) => pos.set(f, i))
  return [...want].sort((a, b) => (pos.get(a) ?? order.length) - (pos.get(b) ?? order.length))
}

export function selectedPartition(projectDir: string, factIds: string[]): [string[], string[]] {
  const fg = newFactGraph(projectDir)
  const known = new Set(fg.list())
  const unknown = factIds.filter((f) => !known.has(f))
  if (unknown.length > 0) throw new Error(`unknown fact id(s) in fact_ids: ${JSON.stringify(unknown)}`)
  const globalOrder = toposortWithPredecessors(fg, null)
  const sel = new Set(factIds)
  const orderedSelected = globalOrder.filter((f) => sel.has(f))
  const ref = new Set<string>()
  for (const f of factIds) {
    for (const p of fg.predecessors(f)) {
      if (!sel.has(p)) ref.add(p)
    }
  }
  const referencedIds = globalOrder.filter((f) => ref.has(f))
  return [orderedSelected, referencedIds]
}

export function subgraphSkeleton(projectDir: string, headline?: string[] | null, paperId?: string | null): Record<string, unknown> {
  const fg = newFactGraph(projectDir)
  const ids = closureOrder(projectDir, headline, paperId)
  const idSet = new Set(ids)
  const dependents = new Map<string, number>(ids.map((fid) => [fid, 0]))
  const predsBy = new Map<string, string[]>()
  for (const fid of ids) {
    const preds = fg.predecessors(fid).filter((p) => idSet.has(p))
    predsBy.set(fid, preds)
    for (const p of preds) dependents.set(p, (dependents.get(p) ?? 0) + 1)
  }
  const facts: Record<string, unknown>[] = []
  for (const fid of ids) {
    const raw = fg.getRaw(fid) ?? ''
    const gi = parseFrontmatter(raw).glossary_introduces
    facts.push({
      id: fid,
      statement: statementOf(raw).trim(),
      predecessors: predsBy.get(fid),
      dependents: dependents.get(fid),
      glossary_introduces: gi ? Object.keys(gi).sort() : [],
    })
  }
  return { count: facts.length, facts }
}

export function factGraphContent(projectDir: string, headline?: string[] | null, paperId?: string | null): string {
  const fg = newFactGraph(projectDir)
  const ids = toposortWithPredecessors(fg, resolveHeadlineIds(projectDir, headline, paperId))
  if (ids.length === 0) return '_(no verified facts found in the project fact graph)_\n'
  return ids.map((fid) => factBlock(fg, fid)).join('\n')
}

export function citationMap(projectDir: string, headline?: string[] | null, paperId?: string | null): string {
  const fg = newFactGraph(projectDir)
  let ids: string[]
  try {
    ids = toposortWithPredecessors(fg, resolveHeadlineIds(projectDir, headline, paperId))
  } catch {
    return ''
  }
  const refs = new Map<string, { title: string; arxiv: string; citedFor: string[] }>()
  for (const fid of ids) {
    for (const r of parseFrontmatter(fg.getRaw(fid) ?? '').external_refs) {
      const key = String(r['key'] ?? '')
      if (!key) continue
      let e = refs.get(key)
      if (!e) {
        e = { title: String(r['title'] ?? ''), arxiv: String(r['arxiv'] ?? ''), citedFor: [] }
        refs.set(key, e)
      }
      const cf = String(r['cited_for'] ?? '').trim()
      if (cf && !e.citedFor.includes(cf)) e.citedFor.push(cf)
    }
  }
  if (refs.size === 0) return ''
  const lines: string[] = []
  for (const key of [...refs.keys()].sort()) {
    const e = refs.get(key)!
    let head = `[${key}] ${e.title}`.replace(/\s+$/, '')
    if (e.arxiv) head += ` (arXiv:${e.arxiv})`
    lines.push(head)
    for (const cf of e.citedFor.slice(0, 4)) lines.push(`    establishes: ${cf}`)
  }
  return lines.join('\n')
}

// --------------------------------------------------------------------------- //
// aesthetic exemplar(仅 writer)                                              //
// --------------------------------------------------------------------------- //

function anchorBlock(anchor: string | null): string | null {
  if (!anchor) return null
  const adir = join(writePaperSkillDir(), 'style', 'anchors', anchor)
  const exists = readdirExists(adir)
  if (!exists) return null
  const parts: string[] = []
  const files = listFilesRecursive(adir)
  for (const path of files) {
    const text = readUtf8OrNull(path)
    const rel = toPosix(path.slice(adir.length + 1))
    if (text === null) {
      parts.push(`--- ${rel} (binary; not embedded) ---`)
      continue
    }
    parts.push(`--- ${rel} ---\n${text.replace(/\s+$/, '')}`)
  }
  return parts.length > 0 ? parts.join('\n\n') : null
}

// --------------------------------------------------------------------------- //
// per-role assemblers                                                         //
// --------------------------------------------------------------------------- //

export function buildWriterPrompt(
  projectDir: string,
  opts: { headline?: string[] | null; paperId?: string | null; factIds?: string[] | null; instructions?: string | null } = {},
): string {
  const ws = paperWorkspace(projectDir, opts.paperId)
  const briefRel = toPosix(join(ws, 'PROJECT_BRIEF.md').slice(projectDir.length + 1))
  const ledgerRel = toPosix(join(ws, 'REFERENCE_LEDGER.md').slice(projectDir.length + 1))
  const parts: string[] = [
    'You are the PAPER WRITER. Everything you need is embedded below; you have ' +
      'no filesystem to read. Produce a single complete main.tex per the ' +
      'contract and role prompt.',
    section('AGENTS.md', readWritePaperFixed('roles/AGENTS.md')),
    section('PAPER_WRITER_PROMPT.md', readWritePaperFixed('roles/PAPER_WRITER_PROMPT.md')),
    section('STYLE_GUIDE.md', readWritePaperFixed('style/STYLE_GUIDE.md')),
    section('PAPER_STRUCTURE.md', readWritePaperFixed('style/PAPER_STRUCTURE.md')),
    section('ACKNOWLEDGEMENT_BOILERPLATE.md', readWritePaperFixed('boilerplate/acknowledgement.md')),
    section('PROJECT_BRIEF.md', readWritePaperProject(projectDir, briefRel)),
  ]
  if (opts.instructions && opts.instructions.trim()) {
    parts.push(section('MAIN_AGENT_INSTRUCTIONS', opts.instructions.trim()))
  }
  parts.push(section('REFERENCE_LEDGER.md', readWritePaperProject(projectDir, ledgerRel)))
  if (opts.factIds && opts.factIds.length > 0) {
    const [orderedSelected] = selectedPartition(projectDir, opts.factIds)
    parts.push(section(
      'SELECTED_FACTS (the important results to PRESENT and PROVE, in full)',
      fullBodiesFor(projectDir, orderedSelected)))
    const cmap = citationMap(projectDir, opts.headline, opts.paperId)
    if (cmap) {
      parts.push(section(
        'PUBLISHED_CITATIONS (cite these for standard/published supporting ' +
          'results — exact key + what each establishes; add a \\bibitem; do NOT ' +
          're-prove them. Prove only the SELECTED_FACTS)', cmap))
    }
  } else {
    parts.push(section('FACT_GRAPH_CONTENT', factGraphContent(projectDir, opts.headline, opts.paperId)))
  }
  const exemplar = briefStructuralExemplar(projectDir, opts.paperId)
  const exemplarBody = anchorBlock(exemplar)
  if (exemplarBody !== null) {
    parts.push(section(`STRUCTURAL_EXEMPLAR (${exemplar})`, exemplarBody))
  }
  return parts.join('')
}

export function buildPlannerPrompt(
  projectDir: string,
  opts: { headline?: string[] | null; paperId?: string | null; factIds?: string[] | null; instructions?: string | null } = {},
): string {
  const ws = paperWorkspace(projectDir, opts.paperId)
  const briefRel = toPosix(join(ws, 'PROJECT_BRIEF.md').slice(projectDir.length + 1))
  const ledgerRel = toPosix(join(ws, 'REFERENCE_LEDGER.md').slice(projectDir.length + 1))
  let closureStatements: string
  if (opts.factIds && opts.factIds.length > 0) {
    const [orderedSelected] = selectedPartition(projectDir, opts.factIds)
    closureStatements = statementsFor(projectDir, orderedSelected)
  } else {
    closureStatements = statementsOnlyContent(projectDir, opts.headline, opts.paperId)
  }
  const parts: string[] = [
    'You are the PAPER PLANNER. Everything you need is embedded below; you have ' +
      'no filesystem to read. This paper is generated section-by-section because ' +
      'its closure is too large for one pass. Produce the fixed preamble, front ' +
      'matter, section plan, and bibliography per the contract and role prompt.',
    section('AGENTS.md', readWritePaperFixed('roles/AGENTS.md')),
    section('PAPER_PLANNER_PROMPT.md', readWritePaperFixed('roles/PAPER_PLANNER_PROMPT.md')),
    section('STYLE_GUIDE.md', readWritePaperFixed('style/STYLE_GUIDE.md')),
    section('PAPER_STRUCTURE.md', readWritePaperFixed('style/PAPER_STRUCTURE.md')),
    section('ACKNOWLEDGEMENT_BOILERPLATE.md', readWritePaperFixed('boilerplate/acknowledgement.md')),
    section('PROJECT_BRIEF.md', readWritePaperProject(projectDir, briefRel)),
  ]
  if (opts.instructions && opts.instructions.trim()) {
    parts.push(section('MAIN_AGENT_INSTRUCTIONS', opts.instructions.trim()))
  }
  parts.push(section('REFERENCE_LEDGER.md', readWritePaperProject(projectDir, ledgerRel)))
  parts.push(section('CLOSURE_STATEMENTS', closureStatements))
  return parts.join('')
}

export function buildSectionWriterPrompt(
  projectDir: string,
  opts: {
    sectionTitle: string; sectionLabel: string; sectionFacts: string; otherStatements: string;
    preambleFrontmatter: string; sectionPlan: string; paperId?: string | null;
  },
): string {
  const ws = paperWorkspace(projectDir, opts.paperId)
  const briefRel = toPosix(join(ws, 'PROJECT_BRIEF.md').slice(projectDir.length + 1))
  const ledgerRel = toPosix(join(ws, 'REFERENCE_LEDGER.md').slice(projectDir.length + 1))
  const parts: string[] = [
    'You are the PAPER SECTION WRITER. Everything you need is embedded below; ' +
      'you have no filesystem to read. The preamble, front matter, section plan, ' +
      'and bibliography are already FIXED by the planner — write ONLY this ' +
      "section's body per the contract and role prompt.",
    section('AGENTS.md', readWritePaperFixed('roles/AGENTS.md')),
    section('PAPER_SECTION_WRITER_PROMPT.md', readWritePaperFixed('roles/PAPER_SECTION_WRITER_PROMPT.md')),
    section('STYLE_GUIDE.md', readWritePaperFixed('style/STYLE_GUIDE.md')),
    section('PAPER_STRUCTURE.md', readWritePaperFixed('style/PAPER_STRUCTURE.md')),
    section('PROJECT_BRIEF.md', readWritePaperProject(projectDir, briefRel)),
    section('REFERENCE_LEDGER.md', readWritePaperProject(projectDir, ledgerRel)),
    section('FIXED_PREAMBLE_AND_FRONTMATTER (reference only — do NOT re-emit)',
      opts.preambleFrontmatter),
    section('SECTION_PLAN (all sections\' titles+labels, in order)', opts.sectionPlan),
    section(`THIS_SECTION (title=${JSON.stringify(opts.sectionTitle)}, label=${JSON.stringify(opts.sectionLabel)})`,
      `Write \\section{${opts.sectionTitle}}\\label{${opts.sectionLabel}} and its body.`),
    section('THIS_SECTION_FACTS (full bodies — render these)', opts.sectionFacts),
    section('OTHER_CLOSURE_FACTS (STATEMENTS ONLY — \\ref these, never re-prove)',
      opts.otherStatements),
  ]
  return parts.join('')
}

function wsRel(projectDir: string, paperId: string | null | undefined, name: string): string {
  const ws = paperWorkspace(projectDir, paperId)
  return toPosix(ws.slice(projectDir.length + 1) + (name.startsWith('/') ? name : '/' + name))
}

export function buildPaperMathVerifierPrompt(projectDir: string, opts: { paperId?: string | null } = {}): string {
  const parts: string[] = [
    'You are the PAPER MATH VERIFIER (a dedicated third verifier). Judge whether ' +
      'the whole paper below correctly and self-containedly establishes its main ' +
      'result, TRUSTING the confirmed precise citations in the ledger and ' +
      'scrutinizing the paper\'s own reasoning. Everything you need is embedded.',
    section('AGENTS.md', readWritePaperFixed('roles/AGENTS.md')),
    section('PAPER_MATH_VERIFIER_PROMPT.md', readWritePaperFixed('roles/PAPER_MATH_VERIFIER_PROMPT.md')),
    section('REFERENCE_LEDGER.md (citations already CONFIRMED by the reference verifier — trust the `verified-by: verifier` rows)',
      readWritePaperProject(projectDir, wsRel(projectDir, opts.paperId, 'REFERENCE_LEDGER.md'))),
    section('PAPER (the whole main.tex — read the mathematics in order)',
      readWritePaperProject(projectDir, wsRel(projectDir, opts.paperId, 'main.tex'))),
  ]
  return parts.join('')
}

export function buildAuditorPrompt(projectDir: string, opts: { paperId?: string | null } = {}): string {
  const parts: string[] = [
    'You are the REFERENCE AUDITOR. You have no live tools and no network; you ' +
      'FLAG entries, you do not verify them online (the reference verifier / reference_verify does that). ' +
      'Everything you need is embedded below.',
    section('AGENTS.md', readWritePaperFixed('roles/AGENTS.md')),
    section('REFERENCE_AUDITOR_PROMPT.md', readWritePaperFixed('roles/REFERENCE_AUDITOR_PROMPT.md')),
    section('main.tex', readWritePaperProject(projectDir, wsRel(projectDir, opts.paperId, 'main.tex'))),
    section('REFERENCE_LEDGER.md', readWritePaperProject(projectDir, wsRel(projectDir, opts.paperId, 'REFERENCE_LEDGER.md'))),
  ]
  return parts.join('')
}

export function buildVerifierPrompt(projectDir: string, opts: { findings?: string | null; paperId?: string | null } = {}): string {
  const findingsBody = (opts.findings ?? '').trim() || (
    '_(no auditor findings passed; verify every ledger row still marked ' +
    '`verified-by: unverified` and every `\\note{[cite/blocker]}` in main.tex)_'
  )
  const parts: string[] = [
    'You are the REFERENCE VERIFIER. You HAVE network: search_arxiv_theorems ' +
      '(gateway) + web_search. Verify ONLY the entries the auditor flagged, ' +
      'against an authoritative source. You emit one verdict per entry (the ' +
      'orchestrator updates REFERENCE_LEDGER.md in place from them); you ' +
      'do NOT touch main.tex (that is the reviser\'s job). Everything you need is ' +
      'embedded below.',
    section('AGENTS.md', readWritePaperFixed('roles/AGENTS.md')),
    section('REFERENCE_VERIFIER_PROMPT.md', readWritePaperFixed('roles/REFERENCE_VERIFIER_PROMPT.md')),
    section('main.tex', readWritePaperProject(projectDir, wsRel(projectDir, opts.paperId, 'main.tex'))),
    section('REFERENCE_LEDGER.md', readWritePaperProject(projectDir, wsRel(projectDir, opts.paperId, 'REFERENCE_LEDGER.md'))),
    section('AUDITOR_FINDINGS', findingsBody),
  ]
  return parts.join('')
}

export function buildReviserPrompt(
  projectDir: string,
  opts: {
    compileLog?: string | null; notes?: string | null; citationFixes?: string | null;
    gapFill?: string | null; paperId?: string | null;
  } = {},
): string {
  const parts: string[] = [
    'You are the PAPER REVISER. Everything you need is embedded below; you have ' +
      'no filesystem to read. Revise the embedded main.tex per the contract, the ' +
      'role prompt, and the trigger below.',
    section('AGENTS.md', readWritePaperFixed('roles/AGENTS.md')),
    section('PAPER_REVISER_PROMPT.md', readWritePaperFixed('roles/PAPER_REVISER_PROMPT.md')),
    section('STYLE_GUIDE.md', readWritePaperFixed('style/STYLE_GUIDE.md')),
    section('main.tex', readWritePaperProject(projectDir, wsRel(projectDir, opts.paperId, 'main.tex'))),
    section('REVISION_LOG.md (tail)', revisionLogTail(projectDir, opts.paperId)),
    section('TRIGGER', reviserTrigger(opts.compileLog, opts.notes, opts.citationFixes, opts.gapFill)),
  ]
  return parts.join('')
}

export function revisionLogTail(projectDir: string, paperId?: string | null, maxChars = 8000): string {
  const path = join(paperWorkspace(projectDir, paperId), 'REVISION_LOG.md')
  if (!exists(path)) return '_(no REVISION_LOG.md yet — this is an early round)_'
  const text = readFileSync(path, 'utf8')
  return text.length <= maxChars ? text : text.slice(0, maxChars) + '\n… (truncated)\n'
}

export function reviserTrigger(
  compileLog?: string | null, notes?: string | null, citationFixes?: string | null,
  gapFill?: string | null,
): string {
  let mode: string
  if (gapFill && compileLog) mode = 'gap-fill+compile-fix'
  else if (gapFill) mode = 'gap-fill'
  else if (compileLog && (notes || citationFixes)) mode = 'compile-fix+targeted'
  else if (compileLog) mode = 'compile-fix'
  else if (notes || citationFixes) mode = 'targeted-notes'
  else mode = 'style-audit-pass'
  const parts: string[] = [`MODE: ${mode}`]
  if (gapFill) {
    parts.push(
      '--- gap_fill (the whole-document verifier said the paper is NOT ' +
        'self-contained; below is the verifier\'s feedback, the main agent\'s ' +
        'guidance, and the VERIFIED statements/proofs of the facts the main agent ' +
        'chose to add. INCORPORATE them: prove the missing lemmas into the paper ' +
        '— inline where natural, or as new labelled results — so the development ' +
        'becomes self-contained. Adapt to the paper\'s notation; keep existing ' +
        '\\label targets valid; never emit a fact id or a fabricated citation. ' +
        'Emit your changes as a PATCH of find/replace edits per the output ' +
        'contract — an insertion is a find/replace whose replacement re-includes ' +
        'the anchor.\n' +
        'HOW MUCH TO WRITE OUT (this is what decides whether the paper passes the ' +
        'whole-paper verifier). The verifier accepts a step only if it is (a) ' +
        'derived in the paper, (b) backed by a precise citation to a confirmed ' +
        'reference, or (c) so routine that a mathematics undergraduate could fill ' +
        'it unaided (the whole-paper verifier\'s own bar). It REJECTS — as a ' +
        'must-fix gap — any ' +
        'LOAD-BEARING, non-obvious step that is asserted or waved away with a ' +
        'summarizing phrase (\'by the same argument\', \'a high-level appeal to the ' +
        '... computation\', \'analogously\', \'similarly\', \'it follows that\') IN PLACE ' +
        'OF the actual derivation. The supplied proofs below are already verified ' +
        'and correct, so for every such load-bearing step WRITE OUT the derivation ' +
        'they give you (the specific computation, inequality, construction, base ' +
        'case, induction step, or combinatorial check) — or cite a confirmed ' +
        'reference for it. You MAY still abbreviate a genuinely routine step; the ' +
        'rule is not \'never compress\', it is \'never compress a load-bearing ' +
        'non-routine step into a phrase the verifier cannot check\'. ' +
        '---\n' + (gapFill || '').replace(/\s+$/, ''))
  }
  if (compileLog) {
    parts.push('--- compile_log (the failing pdflatex output) ---\n' + compileLog.replace(/\s+$/, ''))
  }
  if (citationFixes) {
    parts.push(
      '--- citation_fixes (the verifier\'s per-entry replacement suggestions; ' +
        'apply against \\bibitem/ledger keys ALREADY present, never invented) ---\n' +
        citationFixes.replace(/\s+$/, ''))
  }
  if (notes) {
    parts.push('--- notes (operator editorial direction for this round) ---\n' + notes.replace(/\s+$/, ''))
  }
  if (!compileLog && !notes && !citationFixes && !gapFill) {
    parts.push(
      '_(no explicit trigger passed; do a style-audit revision pass per the ' +
        'role prompt and the operator\'s editorial annotations already in main.tex)_')
  }
  return parts.join('\n\n')
}

export function buildPrompt(
  role: string,
  projectDir: string,
  opts: {
    headline?: string[] | null; compileLog?: string | null; notes?: string | null;
    citationFixes?: string | null; gapFill?: string | null; findings?: string | null;
    paperId?: string | null; factIds?: string[] | null; instructions?: string | null;
  } = {},
): string {
  if (role === 'writer') return buildWriterPrompt(projectDir, opts)
  if (role === 'auditor') return buildAuditorPrompt(projectDir, { paperId: opts.paperId })
  if (role === 'verifier') return buildVerifierPrompt(projectDir, { findings: opts.findings, paperId: opts.paperId })
  if (role === 'reviser') {
    return buildReviserPrompt(projectDir, {
      compileLog: opts.compileLog, notes: opts.notes, citationFixes: opts.citationFixes,
      gapFill: opts.gapFill, paperId: opts.paperId,
    })
  }
  throw new Error(`unknown paper role: ${JSON.stringify(role)} (expected one of ${ROLES.join(', ')})`)
}

// --------------------------------------------------------------------------- //
// small fs helpers                                                            //
// --------------------------------------------------------------------------- //

import { existsSync as fsExists, readdirSync, statSync } from 'node:fs'

function newFactGraph(projectDir: string): FactGraph {
  return new FactGraph(projectDir)
}

function exists(p: string): boolean {
  return fsExists(p)
}
function readdirExists(p: string): boolean {
  return fsExists(p) && statSync(p).isDirectory()
}
function listFilesRecursive(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, name.name)
      if (name.isDirectory()) walk(full)
      else if (name.isFile()) out.push(full)
    }
  }
  walk(dir)
  return out.sort()
}
function readUtf8OrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}
function toPosix(p: string): string {
  return p.split('\\').join('/').replace(/\/+/g, '/')
}
