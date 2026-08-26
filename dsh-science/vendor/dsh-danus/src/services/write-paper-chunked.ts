/**
 * services/write-paper-chunked.ts — 分块论文生成(闭包超上下文窗口时的回退)。
 * 移植自 danus/write_paper/paper_chunked.py。
 *
 * 三阶段(均非 agentic 隔离 codex,空 cwd + 全嵌入,输出即文本):
 *   1. PLAN(statements only)-> 固定 preamble/front matter + 逐闭包事实一个 section 的
 *      section plan + bibliography(%%%PREAMBLE%%% / %%%FRONTMATTER%%% / %%%SECTIONS%%% /
 *      %%%BIBLIOGRAPHY%%% 分隔)。
 *   2. FILL(每 section 一调):本节事实完整正文 + 其它闭包事实 STATEMENT-only(\ref 语境,
 *      section_ref_context_ids 只取本节的直接前驱)+ 固定 preamble/front matter + 整份
 *      section plan + 本节 title/label。输出本节 LaTeX + %%%PROVENANCE%%%。
 *   3. STITCH(确定性):preamble + front matter + 各 section body(按 plan 序)+
 *      bibliography + \end{document};逐节 provenance 合并(setdefault)。
 *
 * drive 注入(server._drive),使本模块 codex/network-free、可离线测试。
 */

import {
  buildPlannerPrompt, buildSectionWriterPrompt, buildWriterPrompt, closureOrder,
  fullBodiesFor, sectionRefContextIds, selectedPartition, statementsFor,
} from './write-paper-assemble.ts'

const SEP_PREAMBLE = '%%%PREAMBLE%%%'
const SEP_FRONTMATTER = '%%%FRONTMATTER%%%'
const SEP_SECTIONS = '%%%SECTIONS%%%'
const SEP_BIBLIOGRAPHY = '%%%BIBLIOGRAPHY%%%'
const SEP_PROVENANCE = '%%%PROVENANCE%%%'

const DEFAULT_CHUNK_CHARS = 800000

const FENCE_OPEN_RE = /^```[A-Za-z0-9_+-]*[ \t]*\n/

export interface DriveResult {
  status: string
  stdout: string
  returncode: number | null
  stderr_tail: string
  error?: string
}

export type Drive = (prompt: string) => Promise<DriveResult>

export interface Section {
  title: string
  label: string
  fact_ids: string[]
}

export class ChunkError extends Error {
  readonly phase: string
  constructor(phase: string, message: string) {
    super(message)
    this.name = 'ChunkError'
    this.phase = phase
  }
}

function stripCodeFence(s: string): string {
  const t = s.replace(/^\n+/, '')
  const m = t.match(FENCE_OPEN_RE)
  if (!m) return s
  let tt = t.slice(m[0].length)
  if (tt.replace(/\s+$/, '').endsWith('```')) {
    tt = tt.replace(/\s+$/, '').slice(0, -3)
  }
  return tt + '\n'
}

// --------------------------------------------------------------------------- //
// threshold                                                                   //
// --------------------------------------------------------------------------- //

export function chunkCharBudget(): number {
  const raw = process.env.DANUS_PAPER_WRITE_CHUNK_CHARS ?? ''
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n)) return DEFAULT_CHUNK_CHARS
  return n > 0 ? n : DEFAULT_CHUNK_CHARS
}

export function shouldChunk(
  projectDir: string,
  headline: string[] | null | undefined,
  paperId: string | null | undefined,
  opts: { factIds?: string[] | null; instructions?: string | null } = {},
): [boolean, number, number] {
  // 原版用 build_writer_prompt 估算(selection-aware,反映 fact_ids/instructions 精确)。此处一致。
  const prompt = buildWriterPrompt(projectDir, { headline, paperId, factIds: opts.factIds, instructions: opts.instructions })
  const budget = chunkCharBudget()
  const n = prompt.length
  return [n > budget, n, budget]
}

// --------------------------------------------------------------------------- //
// phase 1 — planner output parsing + coverage                                 //
// --------------------------------------------------------------------------- //

function splitPlannerOutput(stdout: string): Record<string, string> {
  const order: [string, string][] = [
    ['preamble', SEP_PREAMBLE],
    ['frontmatter', SEP_FRONTMATTER],
    ['sections', SEP_SECTIONS],
    ['bibliography', SEP_BIBLIOGRAPHY],
  ]
  const found: [string, string, number][] = []
  for (const [name, sep] of order) {
    const i = stdout.indexOf(sep)
    if (i === -1) throw new ChunkError('plan', `planner output missing separator ${sep}`)
    found.push([name, sep, i])
  }
  const positions = found.map((f) => f[2])
  if (positions.join(',') !== [...positions].sort((a, b) => a - b).join(',')) {
    throw new ChunkError('plan', 'planner separators are out of order (expected preamble, frontmatter, sections, bibliography)')
  }
  const out: Record<string, string> = {}
  for (let k = 0; k < found.length; k++) {
    const [name, sep, i] = found[k]!
    const start = i + sep.length
    const end = k + 1 < found.length ? found[k + 1]![2] : stdout.length
    let body = stdout.slice(start, end)
    const nl = body.indexOf('\n')
    out[name] = nl !== -1 ? body.slice(nl + 1) : ''
  }
  return out
}

function parseSections(sectionsBlock: string): Section[] {
  let text = sectionsBlock.trim()
  if (text.startsWith('```')) {
    const lines = text.split('\n')
    if (lines.length > 0 && lines[0]!.trimStart().startsWith('```')) lines.shift()
    if (lines.length > 0 && lines[lines.length - 1]!.trim().startsWith('```')) lines.pop()
    text = lines.join('\n').trim()
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new ChunkError('plan', `SECTIONS block is not valid JSON: ${String(e)}`)
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new ChunkError('plan', 'SECTIONS block must be a non-empty JSON array')
  }
  const out: Section[] = []
  const seenLabels = new Set<string>()
  for (let i = 0; i < data.length; i++) {
    const sec = data[i] as Record<string, unknown>
    if (typeof sec !== 'object' || sec === null || Array.isArray(sec)) {
      throw new ChunkError('plan', `SECTIONS[${i}] is not an object`)
    }
    const title = sec['title']
    const label = sec['label']
    const factIds = sec['fact_ids']
    if (typeof title !== 'string' || !title.trim()) {
      throw new ChunkError('plan', `SECTIONS[${i}] has no valid 'title'`)
    }
    if (typeof label !== 'string' || !label.trim()) {
      throw new ChunkError('plan', `SECTIONS[${i}] has no valid 'label'`)
    }
    if (seenLabels.has(label)) throw new ChunkError('plan', `duplicate section label ${JSON.stringify(label)}`)
    seenLabels.add(label)
    if (!Array.isArray(factIds) || !factIds.every((f) => typeof f === 'string')) {
      throw new ChunkError('plan', `SECTIONS[${i}] 'fact_ids' must be a list of strings`)
    }
    out.push({ title, label, fact_ids: factIds as string[] })
  }
  return out
}

export function normalizeCoverage(sections: Section[], closureIds: string[]): [Section[], string[]] {
  const closureSet = new Set(closureIds)
  const seen = new Set<string>()
  const repaired: Section[] = []
  let dup = 0
  let extra = 0
  for (const sec of sections) {
    const kept: string[] = []
    for (const f of sec.fact_ids) {
      if (!closureSet.has(f)) {
        extra++
        continue
      }
      if (seen.has(f)) {
        dup++
        continue
      }
      seen.add(f)
      kept.push(f)
    }
    repaired.push({ ...sec, fact_ids: kept })
  }
  const missing = closureIds.filter((f) => !seen.has(f))
  const log: string[] = []
  if (dup) log.push(`deduped ${dup} fact(s) assigned to >1 section (kept first)`)
  if (extra) log.push(`dropped ${extra} assigned id(s) not in the closure`)
  if (missing.length > 0) {
    const usedLabels = new Set(repaired.map((s) => s.label))
    let lbl = 'sec:additional'
    let i = 1
    while (usedLabels.has(lbl)) {
      i++
      lbl = `sec:additional-${i}`
    }
    repaired.push({ title: 'Additional results', label: lbl, fact_ids: missing })
    log.push(`swept ${missing.length} unassigned closure fact(s) into '${lbl}'`)
  }
  return [repaired, log]
}

export function checkCoverage(sections: Section[], closureIds: string[]): void {
  const closureSet = new Set(closureIds)
  const assigned: string[] = []
  for (const sec of sections) assigned.push(...sec.fact_ids)
  const assignedSet = new Set(assigned)
  if (assigned.length !== assignedSet.size) {
    const seen = new Set<string>()
    const dups = [...new Set(assigned.filter((f) => seen.has(f) || (seen.add(f), false)))].sort()
    throw new ChunkError('plan', `facts assigned to more than one section: ${JSON.stringify(dups)}`)
  }
  const extra = [...assignedSet].filter((f) => !closureSet.has(f)).sort()
  if (extra.length > 0) {
    throw new ChunkError('plan', `section plan assigns ids not in the closure: ${JSON.stringify(extra)}`)
  }
  const missing = closureIds.filter((f) => !assignedSet.has(f))
  if (missing.length > 0) {
    throw new ChunkError('plan', `closure facts unassigned to any section: ${JSON.stringify(missing)}`)
  }
}

// --------------------------------------------------------------------------- //
// phase 2 — section fill output split                                         //
// --------------------------------------------------------------------------- //

function splitSectionOutput(stdout: string): [string, Record<string, unknown> | null] {
  if (!stdout.includes(SEP_PROVENANCE)) return [stripCodeFence(stdout), null]
  const [texPart, provPart] = splitOnce(stdout, SEP_PROVENANCE)
  try {
    const data = JSON.parse(provPart.trim())
    return [stripCodeFence(texPart), data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null]
  } catch {
    return [stripCodeFence(texPart), null]
  }
}

function splitOnce(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep)
  if (i === -1) return [s, '']
  return [s.slice(0, i), s.slice(i + sep.length)]
}

// --------------------------------------------------------------------------- //
// phase 3 — stitch                                                            //
// --------------------------------------------------------------------------- //

export function stitch(preamble: string, frontmatter: string, sectionBodies: string[], bibliography: string): string {
  const parts = [preamble.replace(/\n+$/, ''), frontmatter.replace(/\n+$/, '')]
  for (const body of sectionBodies) parts.push(body.replace(/\n+$/, ''))
  parts.push(bibliography.replace(/\n+$/, ''))
  let stitched = parts.filter((p) => p.trim()).join('\n\n')
  if (!stitched.includes('\\end{document}')) {
    stitched = stitched + '\n\n\\end{document}\n'
  } else {
    stitched = stitched + '\n'
  }
  return stitched
}

// --------------------------------------------------------------------------- //
// orchestration                                                                //
// --------------------------------------------------------------------------- //

export async function generate(
  projectDir: string,
  opts: { headline: string[]; paperId: string | null; drive: Drive; factIds?: string[] | null; instructions?: string | null },
): Promise<Record<string, unknown>> {
  const phaseLogs: Record<string, unknown>[] = []
  const planPrompt = buildPlannerPrompt(projectDir, { headline: opts.headline, paperId: opts.paperId, factIds: opts.factIds, instructions: opts.instructions })
  const planRes = await opts.drive(planPrompt)
  phaseLogs.push({ phase: 'plan', status: planRes.status, returncode: planRes.returncode })
  if (planRes.status !== 'ok') {
    return { ok: false, phase: 'plan', error: planRes.error ?? 'planner codex returned non-ok', phase_logs: phaseLogs, res: planRes, prompt: planPrompt }
  }

  let blocks: Record<string, string>
  let sections: Section[]
  let coverageIds: string[]
  let referencedIds: string[]
  try {
    blocks = splitPlannerOutput(planRes.stdout)
    sections = parseSections(blocks['sections']!)
    if (opts.factIds && opts.factIds.length > 0) {
      ;[coverageIds, referencedIds] = selectedPartition(projectDir, opts.factIds)
    } else {
      coverageIds = closureOrder(projectDir, opts.headline, opts.paperId)
      referencedIds = []
    }
    const [repaired, covLog] = normalizeCoverage(sections, coverageIds)
    sections = repaired
    phaseLogs.push({ phase: 'coverage', repairs: covLog })
  } catch (e) {
    if (e instanceof ChunkError) {
      return { ok: false, phase: e.phase, error: String(e), phase_logs: phaseLogs, res: planRes, prompt: planPrompt }
    }
    throw e
  }

  const preamble = blocks['preamble']!
  const frontmatter = blocks['frontmatter']!
  const bibliography = blocks['bibliography']!
  const preambleFrontmatter = preamble.replace(/\n+$/, '') + '\n\n' + frontmatter.replace(/\n+$/, '') + '\n'
  const sectionPlanDigest = sections
    .map((s, i) => `${i + 1}. \\section{${s.title}}  ->  \\label{${s.label}}`)
    .join('\n')

  const sectionBodies: string[] = []
  const mergedProvenance: Record<string, unknown> = {}
  const sectionResLog: Record<string, unknown>[] = []
  for (const sec of sections) {
    const thisIds = sec.fact_ids
    const otherIds = sectionRefContextIds(projectDir, thisIds, coverageIds.concat(referencedIds))
    const secPrompt = buildSectionWriterPrompt(projectDir, {
      sectionTitle: sec.title,
      sectionLabel: sec.label,
      sectionFacts: fullBodiesFor(projectDir, thisIds),
      otherStatements: statementsFor(projectDir, otherIds),
      preambleFrontmatter: preambleFrontmatter,
      sectionPlan: sectionPlanDigest,
      paperId: opts.paperId,
    })
    const secRes = await opts.drive(secPrompt)
    sectionResLog.push({ label: sec.label, status: secRes.status, returncode: secRes.returncode })
    phaseLogs.push({ phase: `section:${sec.label}`, status: secRes.status, returncode: secRes.returncode })
    if (secRes.status !== 'ok') {
      return { ok: false, phase: `section:${sec.label}`, error: secRes.error ?? 'section-writer codex returned non-ok', phase_logs: phaseLogs, res: secRes, prompt: secPrompt, section_res: sectionResLog }
    }
    const [body, prov] = splitSectionOutput(secRes.stdout)
    sectionBodies.push(body)
    if (prov !== null) {
      for (const [k, v] of Object.entries(prov)) {
        if (!(k in mergedProvenance)) mergedProvenance[k] = v
      }
    }
  }

  const tex = stitch(preamble, frontmatter, sectionBodies, bibliography)
  phaseLogs.push({ phase: 'stitch', status: 'ok', sections: sections.length })
  return { ok: true, tex, provenance: Object.keys(mergedProvenance).length > 0 ? mergedProvenance : null, sections: sections.length, phase_logs: phaseLogs, plan_res: planRes, section_res: sectionResLog }
}
