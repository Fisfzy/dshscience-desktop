/**
 * services/human-summary.ts — human-summary skill 的 MCP 服务(roles:main)。
 * 移植自 danus/human_summary/{assemble,server}.py。
 *
 * 唯一工具 summary_write 写读者向进度报告。隔离 codex(空 cwd + 全嵌入 prompt)驱动,
 * 输出经 LEAK 检查。scrubbing:对每个选中事实只嵌入 body_sections(statement/proof/
 * intuition),整段 YAML frontmatter 剥掉,任何 fact id/slug 不出现 —— writer 从纯数学
 * 角度工作。正文逐字保留,绝不总结证明。
 *
 * 更严 leak 集(9 项,禁止 predecessors/verifier/worker/global memory —— 读者报告无
 * 用途)。
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { atomicWrite } from '../core/util.ts'
import { bodySections, leakFindings, readFixed, readProject, resolveProject, section } from '../authoring/common.ts'
import { driveOnce } from '../authoring/driver.ts'
import type { ClassifiedOutcome } from '../authoring/common.ts'
import { FactGraph } from '../core/factgraph.ts'
import { envFirst, envInt } from '../shared/env.ts'
import { packageRoot } from '../shared/layout.ts'

const WRITER_PROMPT_REL = 'REPORT_WRITER_PROMPT.md'

/** 所有持久写经 atomicWrite(硬约束)。 */
function writeFile(p: string, c: string, _enc?: string): void {
  atomicWrite(p, c)
}

// human-summary 专用更严 leak 集(9 项)。
const _LEAK_PATTERNS: [RegExp, string][] = [
  [/\b[0-9a-f]{16}\b/, '16-hex id (fact_id / hash prefix)'],
  [/^\s*author:/im, "'author:' frontmatter line"],
  [/\bpredecessors\b/i, "'predecessors' (frontmatter / DAG vocabulary)"],
  [/\bfact_[a-z0-9_]+/i, "'fact_' slug / identifier"],
  [/\bmaster_guidance\b/i, "'master_guidance' (strategy-consult machinery)"],
  [/\bfact_submit\b/i, "'fact_submit' (pipeline verb)"],
  [/\bverifier\b/i, "'verifier' (system machinery)"],
  [/\bworker\b/i, "'worker' (swarm machinery)"],
  [/\bglobal memory\b/i, "'global memory' (system store)"],
]

// --------------------------------------------------------------------------- //
// config (env read at CALL time)                                              //
// --------------------------------------------------------------------------- //

export function humanSummarySkillDir(): string {
  const override = process.env.DANUS_HUMAN_SUMMARY_SKILL_DIR
  return override ? override : join(packageRoot(), 'assets', 'human-summary')
}

function readSkillFile(rel: string): string {
  return readFixed(humanSummarySkillDir(), rel)
}

// --------------------------------------------------------------------------- //
// load-bearing ordering (topological; tie-break by depth/in-degree)           //
// --------------------------------------------------------------------------- //

function depthOf(fg: FactGraph, fid: string, cache: Map<string, number>): number {
  if (cache.has(fid)) return cache.get(fid)!
  cache.set(fid, 0) // 环防护:back-edge 视 depth 0
  const preds = fg.predecessors(fid)
  let d = 0
  if (preds.length > 0) d = 1 + Math.max(...preds.map((p) => depthOf(fg, p, cache)))
  cache.set(fid, d)
  return d
}

function inDegree(fg: FactGraph, ids: string[]): Map<string, number> {
  const deg = new Map<string, number>(ids.map((fid) => [fid, 0]))
  for (const fid of ids) {
    for (const p of fg.predecessors(fid)) {
      if (deg.has(p)) deg.set(p, deg.get(p)! + 1)
    }
  }
  return deg
}

function orderedLoadBearing(fg: FactGraph): string[] {
  const ids = fg.list()
  if (ids.length === 0) return []
  const depthCache = new Map<string, number>()
  const depth = new Map<string, number>()
  for (const fid of ids) depth.set(fid, depthOf(fg, fid, depthCache))
  const indeg = inDegree(fg, ids)
  const idSet = new Set(ids)
  const predsIn = new Map<string, string[]>()
  for (const fid of ids) predsIn.set(fid, fg.predecessors(fid).filter((p) => idSet.has(p)))
  const placed = new Set<string>()
  const ordered: string[] = []
  const remaining = new Set(ids)
  while (remaining.size > 0) {
    let ready = [...remaining].filter((fid) => predsIn.get(fid)!.every((p) => placed.has(p)))
    if (ready.length === 0) ready = [...remaining].sort()
    ready.sort((a, b) => (depth.get(b)! - depth.get(a)!) || (indeg.get(b)! - indeg.get(a)!) || (a < b ? -1 : a > b ? 1 : 0))
    const chosen = ready[0]!
    ordered.push(chosen)
    placed.add(chosen)
    remaining.delete(chosen)
  }
  return ordered
}

// --------------------------------------------------------------------------- //
// assembler                                                                    //
// --------------------------------------------------------------------------- //

function factBundle(projectDir: string): string {
  const fg = new FactGraph(projectDir)
  const ids = orderedLoadBearing(fg)
  if (ids.length === 0) return '_(no verified results are available for this project yet)_\n'
  const blocks: string[] = []
  ids.forEach((fid, n) => {
    const raw = fg.getRaw(fid) ?? ''
    blocks.push(`--- Result ${n + 1} ---\n${bodySections(raw)}`)
  })
  return blocks.join('\n')
}

export function buildPrompt(projectDir: string, language = 'English'): string {
  const parts: string[] = [
    'You are the REPORT WRITER. Everything you need is embedded below; you have ' +
      'no filesystem to read and no tools. Write the human-facing progress report ' +
      'per the rules, from ONLY the problem statement and the scrubbed results ' +
      'below. You have no identifiers, no author names, and no system vocabulary ' +
      '— never invent or mention any.',
    `\n\nReport language: ${language}. Write the narrative in ${language}; keep ` +
      'ALL standard mathematical terminology in English regardless (never a ' +
      'native-language calque for an established term) — see the register rule in ' +
      'the writer prompt. The mathematics is identical in any language.',
    section(WRITER_PROMPT_REL, readSkillFile(WRITER_PROMPT_REL)),
    section('PROBLEM.md (verbatim goal)', readProject(projectDir, 'PROBLEM.md')),
    section('VERIFIED_RESULTS (scrubbed, id-free)', factBundle(projectDir)),
  ]
  return parts.join('')
}

export function operatorLanguage(): string | null {
  // TODO-PARITY:原版读 repo 根 OPERATOR.md;DSH 插件无固定的 Danus repo 根,故默认
  // <cwd>/OPERATOR.md,可用 DANUS_OPERATOR_MD 覆写。只读 **Language:** 字段。
  const path = process.env.DANUS_OPERATOR_MD || join(process.cwd(), 'OPERATOR.md')
  if (!existsSync(path)) return null
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (line.includes('**Language:**')) {
      const val = line.split('**Language:**', 2)[1]!.trim()
      return val && !val.startsWith('_(') ? val : null
    }
  }
  return null
}

export interface HumanSummaryConfig {
  skillDir?: string
  model?: string
  effort?: string
  timeout?: number
  drive?: (prompt: string) => Promise<ClassifiedOutcome & { stderr_full?: string; cmd?: string[] }>
}

export class HumanSummary {
  private drive: (prompt: string) => Promise<ClassifiedOutcome & { stderr_full?: string; cmd?: string[] }>

  constructor(private cfg: HumanSummaryConfig = {}) {
    this.drive = cfg.drive ?? ((prompt) => driveOnce(prompt, { artifactNoun: 'report' }) as Promise<ClassifiedOutcome & { stderr_full?: string; cmd?: string[] }>)
  }

  private model(): string {
    return this.cfg.model ?? envFirst(['DANUS_HUMAN_SUMMARY_MODEL', 'DANUS_CODEX_MODEL'])
  }
  private effort(): string {
    return this.cfg.effort ?? envFirst(['DANUS_HUMAN_SUMMARY_EFFORT', 'DANUS_CODEX_EFFORT'])
  }
  private timeout(): number {
    return this.cfg.timeout ?? envInt('DANUS_AUTHORING_TIMEOUT', 7200)
  }

  async summary_write(args: { project?: string | null; language?: string | null } = {}): Promise<Record<string, unknown>> {
    const pdir = resolveProject(args.project)
    const lang = args.language || operatorLanguage() || 'English'
    const reportPath = join(pdir, 'report', 'report.md')
    const prompt = buildPrompt(pdir, lang)
    const res = await this.drive(prompt)
    const out: Record<string, unknown> = {
      report_md_path: reportPath,
      language: lang,
      status: res.status,
      returncode: res.returncode,
      leak_findings: [],
      stderr_tail: res.stderr_tail,
    }
    if (res.status !== 'ok') {
      out['error'] = res.error
      return out
    }
    const report = res.stdout
    const leaks = this.scanLeaks(report)
    out['leak_findings'] = leaks
    mkdirSync(dirname(reportPath), { recursive: true })
    if (leaks.length > 0) {
      const leakyPath = reportPath.replace(/report\.md$/, 'report.leaky.md')
      writeFile(leakyPath, report, 'utf8')
      if (existsSync(reportPath)) unlinkOrThrow(reportPath)
      out['status'] = 'leak'
      out['error'] = 'report contains leaked identifiers/machinery; not kept as report.md'
      out['leaky_md_path'] = leakyPath
      return out
    }
    writeFile(reportPath, report, 'utf8')
    return out
  }

  scanLeaks(report: string): string[] {
    return leakFindings(report, _LEAK_PATTERNS)
  }
}

function unlinkOrThrow(p: string): void {
  unlinkSync(p)
}
