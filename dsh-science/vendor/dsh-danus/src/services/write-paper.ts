/**
 * services/write-paper.ts — write-paper skill 的 MCP 服务(roles:main)。
 * 移植自 danus/write_paper/server.py + paper_chunked.py + paper_math_verify.py。
 *
 * 四个 paper 角色(writer/auditor/verifier/reviser)包在硬编码工具后,main agent 用
 * **结构化参数**调用(绝不手拼 prompt);大字节(style guide + fact-graph content)在
 * 工具内部组装(assemble),不进 main agent 的上下文;每个角色 codex 按构造隔离
 * (driver —— 空 cwd + 全嵌入 prompt)。引用链 auditor(offline,标记)-> verifier
 * (online,核查)-> reviser(编辑)。只有 reference_verify 走 networked 路径。
 *
 * 工具返回**小而诚实**:路径 + 状态 + 标志,绝不返回整份 .tex。status 绝不因
 * 非零退出/空 stdout/超时而成为 ok。
 *
 * Config 在调用时读 env(非 import 时)。
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { atomicWrite } from '../core/util.ts'
import { leakFindings, resolveProject } from '../authoring/common.ts'
import { driveOnce } from '../authoring/driver.ts'
import { FactGraph } from '../core/factgraph.ts'
import { utcNow } from '../core/util.ts'
import { envFirst, envInt, envStr } from '../shared/env.ts'
import { terminalFacts } from '../shared/target.ts'
import * as assemble from './write-paper-assemble.ts'
import * as chunked from './write-paper-chunked.ts'
import * as pmv from './write-paper-math-verify.ts'
import { compileCheck as nativeCompileCheck } from './compile-check.ts'
import type { DriveResult } from './write-paper-chunked.ts'

const _GAP_RE = /\[GAP:[^\]]*\]/

/** 所有持久写经 atomicWrite(硬约束:所有写文件用 atomicWrite)。 */
function writeFile(p: string, c: string, _enc?: string): void {
  atomicWrite(p, c)
}

// paper 专用 leak 集(5 项)。不禁止 predecessors/worker/verifier(纸面词汇)。
const _LEAK_PATTERNS: [RegExp, string][] = [
  [/\b[0-9a-f]{16}\b/, '16-hex id (fact_id / hash prefix)'],
  [/^\s*author:/im, "'author:' frontmatter line"],
  [/\bfact_[a-z0-9_]+/i, "'fact_' slug / identifier"],
  [/\bmaster_guidance\b/i, "'master_guidance' (strategy-consult machinery)"],
  [/\bfact_submit\b/i, "'fact_submit' (pipeline verb)"],
]

const _MAIN_TEX_SEP = '%%%MAIN_TEX%%%'
const _REVISION_SUMMARY_SEP = '%%%REVISION_SUMMARY%%%'
const _PATCH_SEP = '%%%PATCH%%%'
const _PROVENANCE_SEP = '%%%PROVENANCE%%%'
const _PATCH_BLOCK_RE = /<<<<<<< FIND\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g
const _FENCE_OPEN_RE = /^```[^\n]*\n/

const _VALID_VERDICTS = new Set(['verified', 'corrected', 'rejected', 'unverifiable', 'retarget-internal'])
const _JSON_OBJ_RE = /\{[^{}]*\}/g
const _KV_TOP_RE = /^([A-Za-z_][A-Za-z0-9_]*):[ \t]?(.*)$/
const _KV_SUB_RE = /^[ \t]+([A-Za-z_][A-Za-z0-9_]*):[ \t]?(.*)$/
const _KV_MAPPING_FIELDS = new Set(['confirmed_metadata'])
const _LEDGER_FIELD_RE = /^-\s+([A-Za-z_][\w-]*):\s*(.*)$/
const _LEDGER_HEAD_RE = /^##\s+(.+?)\s*$/

export interface WritePaperConfig {
  skillDir?: string
  model?: string
  effort?: string
  timeout?: number
  compileAttempts?: number
  compileEffort?: string
  keepSwarmOnWrite?: boolean
  runLogEnabled?: boolean
  /** 注入 drive(离线)。默认 driveOnce。 */
  drive?: (prompt: string, effort?: string) => Promise<DriveResult & { stderr_full?: string; cmd?: string[] }>
  /** 注入 drive(networked)。默认 driveOnce(networked)。 */
  driveNetworked?: (prompt: string) => Promise<DriveResult & { stderr_full?: string; cmd?: string[] }>
  /** 注入 swarm stop(默认尝试 via danusSwarm 服务 hook)。 */
  swarmStop?: (project: string) => unknown
  /** 注入编译检查(默认 bash compile_verify.sh;缺失引擎 → skipped: no engine)。 */
  compileCheck?: (tex: string) => { ok: boolean; log: string; engine_available: boolean }
}

export type Drive = (prompt: string, effort?: string) => Promise<DriveResult & { stderr_full?: string; cmd?: string[] }>

export class WritePaper {
  private _drive: Drive
  private _driveNetworked: Drive
  private _swarmStop: (project: string) => unknown
  private _compileCheck: (tex: string) => { ok: boolean; log: string; engine_available: boolean }

  constructor(private cfg: WritePaperConfig = {}) {
    this._drive = cfg.drive ?? ((prompt, effort) => driveOnce(prompt, { effort }) as Promise<DriveResult & { stderr_full?: string; cmd?: string[] }>)
    this._driveNetworked = cfg.driveNetworked ?? ((prompt) => driveOnce(prompt, { networked: true, artifactNoun: 'verdicts' }) as Promise<DriveResult & { stderr_full?: string; cmd?: string[] }>)
    this._swarmStop = cfg.swarmStop ?? defaultSwarmStop
    this._compileCheck = cfg.compileCheck ?? defaultCompileCheck
  }

  // ---------------------------------------------------------------- config
  private model(): string {
    return this.cfg.model ?? envFirst(['DANUS_WRITE_PAPER_MODEL', 'DANUS_CODEX_MODEL'])
  }
  private effort(): string {
    return this.cfg.effort ?? envFirst(['DANUS_WRITE_PAPER_EFFORT', 'DANUS_CODEX_EFFORT'])
  }
  private timeout(): number {
    return this.cfg.timeout ?? envInt('DANUS_AUTHORING_TIMEOUT', 7200)
  }
  private compileAttempts(): number {
    if (this.cfg.compileAttempts !== undefined) return this.cfg.compileAttempts > 0 ? this.cfg.compileAttempts : 3
    const n = envInt('DANUS_WRITE_PAPER_COMPILE_ATTEMPTS', 3)
    return n > 0 ? n : 3
  }
  private compileFixEffort(): string {
    return this.cfg.compileEffort ?? envStr('DANUS_WRITE_PAPER_COMPILE_EFFORT', 'low')
  }
  private runLogEnabled(): boolean {
    if (this.cfg.runLogEnabled !== undefined) return this.cfg.runLogEnabled
    const raw = process.env.DANUS_WRITE_PAPER_RUN_LOG ?? '1'
    return !['0', 'false', 'no'].includes(raw.toLowerCase())
  }
  private keepSwarmEnv(): boolean {
    if (this.cfg.keepSwarmOnWrite !== undefined) return this.cfg.keepSwarmOnWrite
    return ['1', 'true', 'yes'].includes((process.env.DANUS_KEEP_SWARM_ON_WRITE ?? '').toLowerCase())
  }

  // ----------------------------------------------------------------- drive
  private async drive(prompt: string, effort?: string): Promise<DriveResult & { stderr_full?: string; cmd?: string[] }> {
    return this._drive(prompt, effort)
  }
  private async driveNetworked(prompt: string): Promise<DriveResult & { stderr_full?: string; cmd?: string[] }> {
    return this._driveNetworked(prompt)
  }

  // ------------------------------------------------------------- run log
  private writeRunLog(
    tool: string,
    projectDir: string,
    prompt: string | null | undefined,
    res: Record<string, unknown> | null | undefined,
    decisions: Record<string, unknown>,
    envelope: Record<string, unknown> | null | undefined = null,
    paperId?: string | null,
  ): string | null {
    if (!this.runLogEnabled()) return null
    try {
      const r = res ?? {}
      const stamp = utcNow().replace(/:/g, '-')
      const runDir = join(assemble.paperWorkspace(projectDir, paperId), '.runs', `${stamp}-${tool}`)
      mkdirSync(runDir, { recursive: true })
      const logPath = join(runDir, 'log.md')
      const cmdVal = r['cmd'] as string[] | undefined
      const command = cmdVal && cmdVal.length > 0 ? cmdVal.join(' ') : '(no codex run)'
      const stdout = String(r['stdout'] ?? '') || '(empty)'
      const stderr = String(r['stderr_full'] ?? '') || '(empty)'
      const promptBody = prompt ?? '(no prompt — early return before codex was driven)'
      const parts: string[] = []
      parts.push('## Header')
      parts.push(`- utc: ${utcNow()}`)
      parts.push(`- tool: ${tool}`)
      parts.push(`- project: ${projectDir}`)
      parts.push(`- model: ${this.model()} / effort: ${this.effort()}`)
      parts.push(`- networked: ${tool === 'reference_verify'}`)
      parts.push(`- command: ${command}`)
      parts.push('\n## INPUT — assembled prompt\n')
      parts.push(promptBody)
      parts.push('\n## CODEX OUTPUT — stdout\n')
      parts.push(stdout)
      parts.push('\n## CODEX OUTPUT — stderr\n')
      parts.push(stderr)
      parts.push('\n## RESULT')
      parts.push(`- status: ${String(r['status'] ?? '')}`)
      parts.push(`- returncode: ${String(r['returncode'] ?? '')}`)
      if (r['error']) parts.push(`- error: ${String(r['error'])}`)
      parts.push('\n## TOOL DECISIONS')
      for (const [k, v] of Object.entries(decisions)) parts.push(`- ${k}: ${String(v)}`)
      if (envelope !== null) {
        parts.push('\n## RETURNED ENVELOPE\n')
        parts.push('```json')
        parts.push(jsonIndent(envelope))
        parts.push('```')
      }
      writeFile(logPath, parts.join('\n') + '\n', 'utf8')
      return logPath
    } catch {
      return null
    }
  }

  // --------------------------------------------------------------- utils
  private gaps(tex: string): string[] {
    return tex.match(_GAP_RE) ?? []
  }

  private ensureSwarmStopped(project: string): Record<string, unknown> {
    try {
      return { result: this._swarmStop(project) }
    } catch (e) {
      // SystemExit for absent swarm —— idempotent noop。此处封到 noop。
      const msg = String((e as Error).message ?? e)
      if (/no workers for target|no worker|nothing to stop/i.test(msg) || msg.includes('SystemExit')) {
        return { noop: msg }
      }
      return { error: `${(e as Error).name ?? 'Error'}: ${msg}` }
    }
  }

  // ----------------------------------------------------------------- tools
  // ---- paper_subgraph -----------------------------------------------------
  async paper_subgraph(args: {
    project?: string | null; headline?: string[] | null; paperId?: string | null
  } = {}): Promise<Record<string, unknown>> {
    const pdir = resolveProject(args.project)
    const resolved = assemble.resolveHeadline(pdir, args.headline, args.paperId)
    const [headlineIds, source] = resolved
    if (source === 'unset') {
      const candidates = terminalFacts(new FactGraph(pdir))
      return {
        status: 'needs_target', headline: [], headline_source: source, paper_id: args.paperId,
        count: 0, facts: [],
        message: 'no paper target is set — run `danus finalize <project> [--paper <paper_id>] <fact_id>` to record it, or set headline_fact_ids in the project brief',
        candidates,
      }
    }
    const skel = assemble.subgraphSkeleton(pdir, headlineIds, args.paperId)
    return {
      status: 'ok', headline: headlineIds, headline_source: source, paper_id: args.paperId,
      count: skel['count'] as number, facts: skel['facts'] as Record<string, unknown>[],
    }
  }

  // ---- paper_write --------------------------------------------------------
  async paper_write(args: {
    project?: string | null; headline?: string[] | null; stop_workers?: boolean; paperId?: string | null;
    fact_ids?: string[] | null; instructions?: string | null
  } = {}): Promise<Record<string, unknown>> {
    const pdir = resolveProject(args.project)
    const paperId = args.paperId ?? null
    const ws = assemble.paperWorkspace(pdir, paperId)
    const texPath = join(ws, 'main.tex')
    const [resolved, source] = assemble.resolveHeadline(pdir, args.headline, paperId)
    if (source === 'unset') {
      const candidates = terminalFacts(new FactGraph(pdir))
      const out: Record<string, unknown> = {
        tex_path: texPath, status: 'needs_target', headline: [], headline_source: source,
        paper_id: paperId,
        message: 'no paper target is set — run `danus finalize <project> [--paper <paper_id>] <fact_id>` to record it, or set headline_fact_ids in the project brief; write-paper will not guess',
        candidates,
      }
      out['log_path'] = this.writeRunLog('paper_write', pdir, null, null, { needs_target: true, candidates_count: candidates.length }, out, paperId)
      return out
    }
    // 校验 main-agent selection
    const factIdWarnings: string[] = []
    if (args.fact_ids && args.fact_ids.length > 0) {
      const known = new Set(new FactGraph(pdir).list())
      const unknown = args.fact_ids.filter((f) => !known.has(f))
      if (unknown.length > 0) {
        const out: Record<string, unknown> = {
          tex_path: texPath, status: 'bad_fact_ids', headline: resolved, headline_source: source,
          paper_id: paperId, selected_facts: args.fact_ids.length, unknown_fact_ids: unknown,
          message: `${unknown.length} selected fact id(s) are not in the fact graph — check paper_subgraph output; no main.tex written`,
        }
        out['log_path'] = this.writeRunLog('paper_write', pdir, null, null, { bad_fact_ids: unknown }, out, paperId)
        return out
      }
      try {
        const closure = new Set(assemble.closureOrder(pdir, resolved, paperId))
        const outside = args.fact_ids.filter((f) => !closure.has(f))
        if (outside.length > 0) {
          factIdWarnings.push(`${outside.length} selected fact(s) are outside the target closure (kept anyway): ${JSON.stringify(outside)}`)
        }
      } catch { /* unreachable (source != unset) */ }
    }
    // swarm stop
    let swarmStop: Record<string, unknown>
    if (args.stop_workers && !this.keepSwarmEnv()) {
      swarmStop = this.ensureSwarmStopped(args.project ?? basename(pdir))
    } else {
      swarmStop = { skipped: args.stop_workers ? 'DANUS_KEEP_SWARM_ON_WRITE' : 'stop_workers=False' }
    }
    // chunk threshold
    const [over, promptChars, budget] = chunked.shouldChunk(pdir, resolved, paperId, { factIds: args.fact_ids, instructions: args.instructions })
    if (over) {
      return this.paperWriteChunked(pdir, resolved, source, paperId, swarmStop, promptChars, budget, args.fact_ids, args.instructions, factIdWarnings)
    }
    const prompt = assemble.buildPrompt('writer', pdir, { headline: resolved, paperId, factIds: args.fact_ids, instructions: args.instructions })
    const res = await this.drive(prompt)
    const out: Record<string, unknown> = {
      tex_path: texPath, status: res.status, returncode: res.returncode, headline: resolved,
      headline_source: source, paper_id: paperId, swarm_stop: swarmStop,
      selected_facts: args.fact_ids ? args.fact_ids.length : 0, fact_id_warnings: factIdWarnings,
      gaps: [], leak_findings: [], stderr_tail: res.stderr_tail,
    }
    if (res.status !== 'ok') {
      out['error'] = res.error
      out['log_path'] = this.writeRunLog('paper_write', pdir, prompt, res as unknown as Record<string, unknown>, { headline: resolved, headline_source: source, swarm_stop: swarmStop, leak_findings: out['leak_findings'], gaps: out['gaps'] }, out, paperId)
      return out
    }
    const [tex, provenance] = splitProvenance(stripCodeFence(res.stdout))
    const leaks = leakFindings(tex, _LEAK_PATTERNS)
    out['leak_findings'] = leaks
    mkdirSync(dirname(texPath), { recursive: true })
    if (leaks.length > 0) {
      const leakyPath = texPath.replace(/main\.tex$/, 'main.leaky.tex')
      writeFile(leakyPath, tex, 'utf8')
      if (existsSync(texPath)) unlinkOrThrow(texPath)
      out['status'] = 'leak'
      out['error'] = 'paper contains leaked identifiers/machinery; not kept as main.tex'
      out['leaky_tex_path'] = leakyPath
      out['gaps'] = this.gaps(tex)
      out['log_path'] = this.writeRunLog('paper_write', pdir, prompt, res as unknown as Record<string, unknown>, { headline: resolved, headline_source: source, swarm_stop: swarmStop, leak_findings: leaks, gaps: out['gaps'] }, out, paperId)
      return out
    }
    writeFile(texPath, tex, 'utf8')
    out['gaps'] = this.gaps(tex)
    const provPath = writeProvenance(pdir, paperId, provenance)
    out['provenance_path'] = provPath
    out['log_path'] = this.writeRunLog('paper_write', pdir, prompt, res as unknown as Record<string, unknown>, { headline: resolved, headline_source: source, swarm_stop: swarmStop, leak_findings: leaks, gaps: out['gaps'], provenance_path: provPath }, out, paperId)
    return out
  }

  private async paperWriteChunked(
    pdir: string, resolved: string[], source: string, paperId: string | null,
    swarmStop: Record<string, unknown>, promptChars: number, budget: number,
    factIds?: string[] | null, instructions?: string | null, factIdWarnings?: string[],
  ): Promise<Record<string, unknown>> {
    const ws = assemble.paperWorkspace(pdir, paperId)
    const texPath = join(ws, 'main.tex')
    const base: Record<string, unknown> = {
      tex_path: texPath, headline: resolved, headline_source: source, paper_id: paperId,
      swarm_stop: swarmStop, chunked: true, chunk_chars: promptChars, chunk_budget: budget,
      selected_facts: factIds ? factIds.length : 0, fact_id_warnings: factIdWarnings ?? [],
      gaps: [], leak_findings: [],
    }
    const gen = await chunked.generate(pdir, {
      headline: resolved, paperId, drive: (prompt) => this.drive(prompt), factIds, instructions,
    })
    if (!gen['ok']) {
      const out: Record<string, unknown> = { ...base, status: 'chunk_failed', failed_phase: gen['phase'], error: gen['error'], sections: gen['sections'] ?? 0, stderr_tail: ((gen['res'] as Record<string, unknown>) ?? {})['stderr_tail'] ?? '' }
      out['log_path'] = this.writeRunLog('paper_write', pdir, gen['prompt'] as string | null, (gen['res'] as Record<string, unknown>) ?? null, { chunked: true, failed_phase: gen['phase'], chunk_error: gen['error'], phase_logs: gen['phase_logs'], chunk_chars: promptChars, chunk_budget: budget, headline: resolved, headline_source: source, swarm_stop: swarmStop }, out, paperId)
      return out
    }
    const tex = gen['tex'] as string
    const provenance = gen['provenance'] as Record<string, unknown> | null
    const nSections = (gen['sections'] ?? 0) as number
    const leaks = leakFindings(tex, _LEAK_PATTERNS)
    const out: Record<string, unknown> = { ...base, sections: nSections, leak_findings: leaks, returncode: 0, stderr_tail: '' }
    mkdirSync(dirname(texPath), { recursive: true })
    if (leaks.length > 0) {
      const leakyPath = texPath.replace(/main\.tex$/, 'main.leaky.tex')
      writeFile(leakyPath, tex, 'utf8')
      if (existsSync(texPath)) unlinkOrThrow(texPath)
      out['status'] = 'leak'
      out['error'] = 'paper contains leaked identifiers/machinery; not kept as main.tex'
      out['leaky_tex_path'] = leakyPath
      out['gaps'] = this.gaps(tex)
      out['log_path'] = this.writeRunLog('paper_write', pdir, null, null, { chunked: true, sections: nSections, phase_logs: gen['phase_logs'], chunk_chars: promptChars, chunk_budget: budget, leak_findings: leaks, gaps: out['gaps'], headline: resolved, headline_source: source, swarm_stop: swarmStop }, out, paperId)
      return out
    }
    writeFile(texPath, tex, 'utf8')
    out['status'] = 'ok'
    out['gaps'] = this.gaps(tex)
    const provPath = writeProvenance(pdir, paperId, provenance)
    out['provenance_path'] = provPath
    out['log_path'] = this.writeRunLog('paper_write', pdir, null, null, { chunked: true, sections: nSections, phase_logs: gen['phase_logs'], chunk_chars: promptChars, chunk_budget: budget, leak_findings: leaks, gaps: out['gaps'], provenance_path: provPath, headline: resolved, headline_source: source, swarm_stop: swarmStop }, out, paperId)
    return out
  }

  // ---- reference_audit ----------------------------------------------------
  async reference_audit(args: { project?: string | null; paperId?: string | null } = {}): Promise<Record<string, unknown>> {
    const pdir = resolveProject(args.project)
    const paperId = args.paperId ?? null
    const ledgerPath = join(assemble.paperWorkspace(pdir, paperId), 'REFERENCE_LEDGER.md')
    const prompt = assemble.buildPrompt('auditor', pdir, { paperId })
    const res = await this.drive(prompt)
    const out: Record<string, unknown> = {
      findings: res.status === 'ok' ? res.stdout : '', ledger_path: ledgerPath,
      status: res.status, returncode: res.returncode, stderr_tail: res.stderr_tail,
    }
    if (res.status !== 'ok') out['error'] = res.error
    out['log_path'] = this.writeRunLog('reference_audit', pdir, prompt, res as unknown as Record<string, unknown>, { status: res.status, findings_len: (out['findings'] as string).length }, out, paperId)
    return out
  }

  // ---- reference_verify ---------------------------------------------------
  async reference_verify(args: { project?: string | null; findings?: string | null; paperId?: string | null } = {}): Promise<Record<string, unknown>> {
    const pdir = resolveProject(args.project)
    const paperId = args.paperId ?? null
    const ledgerPath = join(assemble.paperWorkspace(pdir, paperId), 'REFERENCE_LEDGER.md')
    const prompt = assemble.buildPrompt('verifier', pdir, { findings: args.findings, paperId })
    const res = await this.driveNetworked(prompt)
    const out: Record<string, unknown> = { verdicts: [], ledger_path: ledgerPath, status: res.status, returncode: res.returncode, stderr_tail: res.stderr_tail }
    if (res.status !== 'ok') {
      out['error'] = res.error
      out['log_path'] = this.writeRunLog('reference_verify', pdir, prompt, res as unknown as Record<string, unknown>, { status: res.status, verdicts_count: 0, applied_keys: [] }, out, paperId)
      return out
    }
    const verdicts = parseVerdicts(res.stdout)
    out['verdicts'] = verdicts
    if (verdicts.length > 0) applyLedgerVerdicts(ledgerPath, verdicts)
    const appliedKeys = verdicts.filter((v) => ['verified', 'corrected'].includes(v['verdict'] as string) && String(v['source_url'] ?? '').trim()).map((v) => v['key'] as string)
    out['log_path'] = this.writeRunLog('reference_verify', pdir, prompt, res as unknown as Record<string, unknown>, { status: res.status, verdicts_count: verdicts.length, applied_keys: appliedKeys }, out, paperId)
    return out
  }

  // ---- paper_revise -------------------------------------------------------
  async paper_revise(args: {
    project?: string | null; compile_log?: string | null; notes?: string | null;
    citation_fixes?: string | null; verifier_feedback?: string | null; add_facts?: string[] | null;
    paperId?: string | null
  } = {}): Promise<Record<string, unknown>> {
    const pdir = resolveProject(args.project)
    const paperId = args.paperId ?? null
    const ws = assemble.paperWorkspace(pdir, paperId)
    const texPath = join(ws, 'main.tex')
    const logPath = join(ws, 'REVISION_LOG.md')
    const maxAttempts = this.compileAttempts()
    const baseTex = existsSync(texPath) ? readFileSync(texPath, 'utf8') : ''
    const origTexLen = baseTex.length

    // gap-fill assembly
    let gapFillText: string | null = null
    let gapFillFacts: string[] = []
    if (args.verifier_feedback || args.add_facts) {
      const pieces: string[] = []
      if (args.verifier_feedback && args.verifier_feedback.trim()) {
        pieces.push('VERIFIER FEEDBACK (why the whole-document verifier judged the paper not self-contained / wrong — close these gaps):\n' + args.verifier_feedback.trim())
      }
      const cmap = closureCitationMap(pdir, paperId)
      if (cmap) {
        pieces.push('PUBLISHED CITATIONS AVAILABLE (each is a real reference the development\'s facts already cite, with what it establishes). For a STANDARD / already-published supporting result the verifier flagged, CITE the matching reference by its key (add a \\bibitem if missing) with the precise theorem/def it gives — do NOT re-prove it. Only genuinely NOVEL central results need a full in-paper proof:\n' + cmap)
      }
      if (args.add_facts) {
        gapFillFacts = [...args.add_facts]
        pieces.push('FACTS TO ADD (the main agent selected these NOVEL results to prove in full; their VERIFIED statements+proofs follow — prove them into the paper, inline where natural or as new labelled results, adapting to the paper\'s notation):\n' + assemble.fullBodiesFor(pdir, args.add_facts))
      }
      gapFillText = pieces.join('\n\n') || null
    }

    const out: Record<string, unknown> = {
      tex_path: texPath, revision_log_path: logPath, status: 'error', returncode: null,
      leak_findings: [], compile: 'not run', compile_attempts: 0, stderr_tail: '',
    }
    if (gapFillText !== null) out['gap_fill_facts'] = gapFillFacts

    let mode: string
    if (gapFillText) mode = args.compile_log ? 'gap-fill+compile-fix' : 'gap-fill'
    else if (args.compile_log) mode = 'compile-fix'
    else if (args.notes || args.citation_fixes) mode = 'targeted-notes'
    else mode = 'style-audit-pass'
    const triggerBits = [...(args.compile_log ? ['compile_log'] : []), ...(args.citation_fixes ? ['citation_fixes'] : []), ...(args.notes ? ['notes'] : [])]
    const modeTrigger = `${mode} (trigger: ${triggerBits.join(', ') || 'none'})`

    let curCompileLog = args.compile_log
    let lastTex: string | null = null
    let lastSummary: string | null = null
    let lastLog = ''
    let attempts = 0
    let prompt: string | null = null
    let res: DriveResult & { stderr_full?: string; cmd?: string[] } = { status: 'error', stdout: '', returncode: null, stderr_tail: '' }
    const compileOutcomes: string[] = []

    for (attempts = 1; attempts <= maxAttempts; attempts++) {
      if (attempts === 1) {
        prompt = assemble.buildPrompt('reviser', pdir, { compileLog: curCompileLog, notes: args.notes, citationFixes: args.citation_fixes, gapFill: gapFillText, paperId })
        res = await this.drive(prompt)
      } else {
        prompt = compileFixPrompt(lastTex ?? '', curCompileLog ?? '')
        res = await this.drive(prompt, this.compileFixEffort())
      }
      out['status'] = res.status
      out['returncode'] = res.returncode
      out['stderr_tail'] = res.stderr_tail
      if (res.status !== 'ok') {
        out['error'] = res.error
        out['compile'] = 'not run'
        out['compile_attempts'] = 0
        out['log_path'] = this.writeRunLog('paper_revise', pdir, prompt, res as unknown as Record<string, unknown>, { 'mode/trigger': modeTrigger, split: 'n/a (non-ok codex)', leak_findings: [], compile: 'not run', compile_attempts: 0, compile_outcomes: compileOutcomes }, out, paperId)
        return out
      }
      // PATCH
      const [patchText, summary] = splitReviserPatch(stripCodeFence(res.stdout))
      const patchBase = lastTex === null ? baseTex : lastTex
      const [tex, applied, patchErrors] = applyReviserPatch(patchBase, patchText)
      lastTex = tex
      lastSummary = summary
      const splitState = `patch: ${applied} edit(s) applied` + (patchErrors.length ? `, ${patchErrors.length} skipped` : '')
      if (applied === 0) {
        out['status'] = 'no_edits_applied'
        out['error'] = 'the reviser\'s patch applied no edits (no FIND matched the paper, or no patch emitted); main.tex unchanged. ' + (patchErrors.slice(0, 5).join('; '))
        out['patch_errors'] = patchErrors
        out['compile'] = 'not run'
        out['compile_attempts'] = attempts - 1
        out['log_path'] = this.writeRunLog('paper_revise', pdir, prompt, res as unknown as Record<string, unknown>, { 'mode/trigger': modeTrigger, split: splitState, patch_errors: patchErrors, compile: 'not run', compile_attempts: attempts - 1, compile_outcomes: compileOutcomes }, out, paperId)
        return out
      }
      // degenerate-shrink
      if (origTexLen > 2000 && tex.length < 0.6 * origTexLen) {
        const shrunkPath = texPath.replace(/main\.tex$/, 'main.shrunk.tex')
        writeFile(shrunkPath, tex, 'utf8')
        out['status'] = 'degenerate_revision'
        out['error'] = `revision collapsed the paper from ${origTexLen} to ${tex.length} chars — rejected; main.tex NOT overwritten (quarantined to ${basename(shrunkPath)}). Re-run the round.`
        out['shrunk_tex_path'] = shrunkPath
        out['compile'] = 'not run'
        out['compile_attempts'] = attempts - 1
        out['log_path'] = this.writeRunLog('paper_revise', pdir, prompt, res as unknown as Record<string, unknown>, { 'mode/trigger': modeTrigger, split: splitState, degenerate_shrink: `${tex.length} < 0.6*${origTexLen}`, compile: 'not run', compile_attempts: attempts - 1, compile_outcomes: compileOutcomes }, out, paperId)
        return out
      }
      const leaks = leakFindings(tex, _LEAK_PATTERNS)
      out['leak_findings'] = leaks
      mkdirSync(dirname(texPath), { recursive: true })
      if (leaks.length > 0) {
        const leakyPath = texPath.replace(/main\.tex$/, 'main.leaky.tex')
        writeFile(leakyPath, tex, 'utf8')
        out['status'] = 'leak'
        out['error'] = 'revision contains leaked identifiers/machinery; main.tex not overwritten'
        out['leaky_tex_path'] = leakyPath
        out['compile'] = 'not run'
        out['compile_attempts'] = attempts - 1
        out['log_path'] = this.writeRunLog('paper_revise', pdir, prompt, res as unknown as Record<string, unknown>, { 'mode/trigger': modeTrigger, split: splitState, leak_findings: leaks, compile: 'not run', compile_attempts: attempts - 1, compile_outcomes: compileOutcomes }, out, paperId)
        return out
      }
      const check = this._compileCheck(tex)
      lastLog = check['log']
      if (!check['engine_available']) {
        compileOutcomes.push('skipped: no engine')
        writeFile(texPath, tex, 'utf8')
        appendRevisionLog(logPath, args.compile_log, args.notes, args.citation_fixes, summary, 'skipped: no engine')
        out['status'] = 'ok'
        out['compile'] = 'skipped: no engine'
        out['compile_attempts'] = 0
        out['log_path'] = this.writeRunLog('paper_revise', pdir, prompt, res as unknown as Record<string, unknown>, { 'mode/trigger': modeTrigger, split: splitState, leak_findings: [], compile: 'skipped: no engine', compile_attempts: 0, compile_outcomes: compileOutcomes }, out, paperId)
        return out
      }
      if (check['ok']) {
        compileOutcomes.push('ok')
        writeFile(texPath, tex, 'utf8')
        appendRevisionLog(logPath, args.compile_log, args.notes, args.citation_fixes, summary, 'ok')
        out['status'] = 'ok'
        out['compile'] = 'ok'
        out['compile_attempts'] = attempts
        out['log_path'] = this.writeRunLog('paper_revise', pdir, prompt, res as unknown as Record<string, unknown>, { 'mode/trigger': modeTrigger, split: splitState, leak_findings: [], compile: 'ok', compile_attempts: attempts, compile_outcomes: compileOutcomes }, out, paperId)
        return out
      }
      compileOutcomes.push('failed')
      curCompileLog = logTail(check['log'])
    }
    // attempts exhausted
    if (lastTex !== null) {
      const uncompiled = texPath.replace(/main\.tex$/, 'main.uncompiled.tex')
      writeFile(uncompiled, lastTex, 'utf8')
      out['uncompiled_tex_path'] = uncompiled
    }
    out['status'] = 'compile_failed'
    out['compile'] = 'failed'
    out['compile_attempts'] = attempts
    out['compile_log_tail'] = logTail(lastLog)
    out['error'] = `revision did not compile after ${attempts} attempt(s); main.tex not overwritten (quarantined to main.uncompiled.tex)`
    out['log_path'] = this.writeRunLog('paper_revise', pdir, prompt, res as unknown as Record<string, unknown>, { 'mode/trigger': modeTrigger, split: lastSummary !== null ? 'ok' : 'degraded (no summary)', leak_findings: [], compile: 'failed', compile_attempts: attempts, compile_outcomes: compileOutcomes, compile_log_tail: logTail(lastLog) }, out, paperId)
    return out
  }

  // ---- paper_verify_math --------------------------------------------------
  async paper_verify_math(args: { project?: string | null; paperId?: string | null } = {}): Promise<Record<string, unknown>> {
    const pdir = resolveProject(args.project)
    const paperId = args.paperId ?? null
    const ws = assemble.paperWorkspace(pdir, paperId)
    const ledgerPath = join(ws, 'VERIFY_LEDGER.md')
    const texPath = join(ws, 'main.tex')
    if (!existsSync(texPath)) {
      const out: Record<string, unknown> = {
        status: 'no_paper', error: `no main.tex at ${texPath} — write the paper first`,
        units_total: 0, correct: 0, wrong: 0, unresolved: 0, oversized: 0, uncovered: 0,
        ledger_path: ledgerPath, deliver_ok: false, blockers: ['no main.tex'],
      }
      out['log_path'] = this.writeRunLog('paper_verify_math', pdir, null, null, { no_paper: true }, out, paperId)
      return out
    }
    const tex = readFileSync(texPath, 'utf8')
    const prev = pmv.readLedger(ledgerPath)
    const cap = pmv.wholeDocBudget()
    const body = pmv.documentBody(tex)
    const prompt = assemble.buildPaperMathVerifierPrompt(pdir, { paperId })
    if (prompt.length > cap) {
      const row = pmv.makeRow('whole-paper')
      row.label = 'whole-paper'
      row.status = 'oversized'
      row.last_verdict = 'not-sent'
      row.repair_hints = `verifier prompt is ${prompt.length} chars (~${Math.floor(prompt.length / 4)} tokens), over the single whole-doc budget ${cap} — decompose by results into self-contained parts, each culminating in a designated result (see the write-paper skill), or raise DANUS_PAPER_VERIFY_WHOLE_DOC_CAP`
      row.attempts = pmv.mergeAttempts(prev, 'whole-paper')
      row.last_checked_utc = pmv.utc()
      pmv.writeLedger(ledgerPath, [row])
      const [ok, blockers] = pmv.deliverOk(ledgerPath)
      const out: Record<string, unknown> = { status: 'too_large', units_total: 1, correct: 0, wrong: 0, body_chars: body.length, whole_doc_cap: cap, ledger_path: ledgerPath, deliver_ok: ok, blockers }
      out['log_path'] = this.writeRunLog('paper_verify_math', pdir, prompt, null, { whole_doc: true, too_large: prompt.length, cap }, out, paperId)
      return out
    }
    let verifyError: string | null = null
    let verdict: string | null = null
    let mustFix: unknown[] = []
    let ignorable: unknown[] = []
    let hints = ''
    let ignText = ''
    const res = await this.drive(prompt)
    if (res.status !== 'ok') {
      verifyError = res.error ?? 'paper-math verifier codex returned non-ok'
      hints = verifyError
    } else {
      const parsed = parsePaperVerdict(res.stdout)
      verdict = parsed[0]
      mustFix = parsed[1]
      ignorable = parsed[2]
      if (verdict === null) {
        verifyError = 'could not parse a verdict from the paper-math verifier output'
        hints = verifyError
      } else {
        hints = renderFindings(mustFix)
        ignText = renderFindings(ignorable)
      }
    }
    let statusRow: string, last: string
    if (verifyError !== null) {
      statusRow = 'pending'
      last = 'verify-error'
    } else {
      statusRow = verdict === 'correct' ? 'correct' : 'wrong'
      last = String(verdict)
    }
    const row = pmv.makeRow('whole-paper')
    row.label = 'whole-paper'
    row.status = statusRow
    row.last_verdict = last
    row.repair_hints = String(hints)
    row.ignorable = ignText
    row.attempts = pmv.mergeAttempts(prev, 'whole-paper')
    row.last_checked_utc = pmv.utc()
    pmv.writeLedger(ledgerPath, [row])
    const [ok, blockers] = pmv.deliverOk(ledgerPath)
    let status: string
    if (verifyError !== null) status = 'verify_error'
    else if (ok) status = 'passed'
    else status = 'blocked'
    const out: Record<string, unknown> = {
      status, units_total: 1, correct: statusRow === 'correct' ? 1 : 0, wrong: statusRow === 'wrong' ? 1 : 0,
      verdict, repair_hints: String(hints), must_fix: mustFix.length, ignorable: ignorable.length,
      ignorable_findings: ignText, body_chars: body.length, ledger_path: ledgerPath, deliver_ok: ok, blockers,
    }
    if (verifyError !== null) out['error'] = verifyError
    out['log_path'] = this.writeRunLog('paper_verify_math', pdir, prompt, res as unknown as Record<string, unknown>, { whole_doc: true, verifier: 'paper-math (third verifier)', verdict, status_row: statusRow, must_fix: mustFix.length, ignorable: ignorable.length, deliver_ok: ok, body_chars: body.length, repair_hints: String(hints).slice(0, 500), ignorable_findings: ignText.slice(0, 500) }, out, paperId)
    return out
  }
}

// --------------------------------------------------------------------------- //
// module-level helpers                                                         //
// --------------------------------------------------------------------------- //

function closureCitationMap(pdir: string, paperId: string | null): string {
  try {
    return assemble.citationMap(pdir, null, paperId)
  } catch {
    return ''
  }
}

// ---- splitter helpers -------------------------------------------------------

function splitProvenance(stdout: string): [string, Record<string, unknown> | null] {
  if (!stdout.includes(_PROVENANCE_SEP)) return [stdout, null]
  const [texPart, provPart] = splitOnce(stdout, _PROVENANCE_SEP)
  try {
    const data = JSON.parse(provPart.trim())
    return [texPart, data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null]
  } catch {
    return [texPart, null]
  }
}

function stripCodeFence(s: string): string {
  const t = s.replace(/^\n+/, '')
  const m = t.match(_FENCE_OPEN_RE)
  if (!m) return s
  let tt = t.slice(m[0].length)
  if (tt.replace(/\s+$/, '').endsWith('```')) tt = tt.replace(/\s+$/, '').slice(0, -3)
  return tt + '\n'
}

function writeProvenance(pdir: string, paperId: string | null, provenance: Record<string, unknown> | null): string | null {
  if (!provenance) return null
  try {
    const path = join(assemble.paperWorkspace(pdir, paperId), '.provenance.json')
    mkdirSync(dirname(path), { recursive: true })
    writeFile(path, jsonIndent(provenance), 'utf8')
    return path
  } catch {
    return null
  }
}

function splitReviserPatch(stdout: string): [string, string | null] {
  let patchPart: string, summary: string | null
  if (stdout.includes(_REVISION_SUMMARY_SEP)) {
    const [a, b] = splitOnce(stdout, _REVISION_SUMMARY_SEP)
    patchPart = a
    summary = b.trim() || null
  } else {
    patchPart = stdout
    summary = null
  }
  const idx = patchPart.indexOf(_PATCH_SEP)
  if (idx !== -1) patchPart = patchPart.slice(idx + _PATCH_SEP.length)
  return [patchPart, summary]
}

function applyReviserPatch(baseTex: string, patchText: string): [string, number, string[]] {
  const edits: [string, string][] = []
  let m: RegExpExecArray | null
  const re = new RegExp(_PATCH_BLOCK_RE.source, _PATCH_BLOCK_RE.flags)
  while ((m = re.exec(patchText)) !== null) edits.push([m[1]!, m[2]!])
  let nextTex = baseTex
  let applied = 0
  const errors: string[] = []
  for (let i = 0; i < edits.length; i++) {
    const [find, repl] = edits[i]!
    if (find === '') {
      errors.push(`edit ${i + 1}: empty FIND (skipped)`)
      continue
    }
    const count = nextTex.split(find).length - 1
    if (count === 1) {
      nextTex = nextTex.replace(find, repl)
      applied++
    } else if (count === 0) {
      errors.push(`edit ${i + 1}: FIND not found (skipped): ${JSON.stringify(find.slice(0, 80))}`)
    } else {
      errors.push(`edit ${i + 1}: FIND matches ${count}× — not unique (skipped): ${JSON.stringify(find.slice(0, 80))}`)
    }
  }
  return [nextTex, applied, errors]
}

function splitOnce(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep)
  if (i === -1) return [s, '']
  return [s.slice(0, i), s.slice(i + sep.length)]
}

function logTail(text: string, maxChars = 4000): string {
  text = text ?? ''
  if (text.length <= maxChars) return text
  return '… (log head truncated)\n' + text.slice(-maxChars)
}

function compileFixPrompt(tex: string, compileLog: string): string {
  return (
    'You are fixing LaTeX COMPILE ERRORS in a mathematics paper. Emit the MINIMAL ' +
    'edits to fix ONLY the compile error(s) below — change nothing else. Output ' +
    'ONLY a patch of exact find/replace edits in this contract:\n' +
    '%%%PATCH%%%\n<<<<<<< FIND\n<exact snippet copied verbatim from the file, ' +
    'including enough surrounding text to be UNIQUE>\n=======\n<the corrected ' +
    'snippet>\n>>>>>>> REPLACE\n(repeat one block per fix)\n%%%REVISION_SUMMARY%%%\n' +
    '<one line naming what you fixed>\n\nCommon causes: a double subscript ' +
    '(`x_a_b` -> `x_{a,b}`), an undeclared macro/operator (declare it in the ' +
    'preamble), an unbalanced/stray brace, delimiter, or environment.\n\n' +
    '=== COMPILE OUTPUT (the failing pdflatex/tectonic log; `l.NNN` marks the ' +
    'offending line/macro) ===\n' + (compileLog ?? '').replace(/\s+$/, '')
    + '\n\n=== CURRENT main.tex (find the offending snippets here) ===\n' + tex
  )
}

function defaultCompileCheck(tex: string): { ok: boolean; log: string; engine_available: boolean } {
  // 原生 TS 编译门(compile-check.ts,逐语义移植 compile_verify.sh,免 bash);
  // 引擎缺失 → engine_available=false,诚实降级。
  const tmp = join(tmpdir(), `wp_compile_check_${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(tmp, { recursive: true })
  const texPath = join(tmp, 'main.tex')
  writeFile(texPath, tex, 'utf8')
  return nativeCompileCheck(texPath)
}

// --------------------------------------------------------------------------- //
// reference-verdict parsing (JSON + YAML-ish labelled blocks)                  //
// --------------------------------------------------------------------------- //

function normVerdict(obj: unknown): Record<string, unknown> | null {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null
  const o = obj as Record<string, unknown>
  const key = o['key']
  const verdict = o['verdict']
  if (typeof key !== 'string') return null
  if (typeof verdict !== 'string' || !_VALID_VERDICTS.has(verdict)) return null
  return o
}

function coerceScalar(v: string): unknown {
  let s = v.trim()
  if (s.length >= 2 && s[0] === s[s.length - 1] && (s[0] === '"' || s[0] === "'")) s = s.slice(1, -1)
  if (['null', 'none', '~', ''].includes(s.toLowerCase())) return null
  return s
}

function parseLabelledBlocks(text: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = []
  let cur: Record<string, unknown> | null = null
  let openMap: string | null = null
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trimStart().startsWith('```')) { openMap = null; continue }
    if (!raw.trim()) { openMap = null; continue }
    const top = raw.match(_KV_TOP_RE)
    if (top && top[1] === 'key') {
      if (cur !== null) records.push(cur)
      cur = { key: coerceScalar(top[2]!) }
      openMap = null
      continue
    }
    if (cur === null) continue
    const sub = raw.match(_KV_SUB_RE)
    if (sub && openMap) {
      let mapping = cur[openMap] as Record<string, unknown>
      if (typeof mapping !== 'object' || mapping === null || Array.isArray(mapping)) {
        mapping = {}
        cur[openMap] = mapping
      }
      const val = coerceScalar(sub[2]!)
      if (val !== null) mapping[sub[1]!] = val
      continue
    }
    if (top) {
      const field = top[1]!
      const rawval = top[2]!
      if (rawval.trim() === '' && _KV_MAPPING_FIELDS.has(field)) {
        cur[field] = {}
        openMap = field
      } else {
        cur[field] = coerceScalar(rawval)
        openMap = null
      }
    }
  }
  if (cur !== null) records.push(cur)
  return records
}

function parseVerdicts(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const stripped = text.trim()
  try {
    const whole = JSON.parse(stripped)
    const items = Array.isArray(whole) ? whole : [whole]
    for (const it of items) {
      const n = normVerdict(it)
      if (n !== null) out.push(n)
    }
    if (out.length > 0) return out
  } catch { /* fall through */ }
  const re = new RegExp(_JSON_OBJ_RE.source, _JSON_OBJ_RE.flags)
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped)) !== null) {
    try {
      const obj = JSON.parse(m[0])
      const n = normVerdict(obj)
      if (n !== null) out.push(n)
    } catch { /* skip */ }
  }
  if (out.length > 0) return out
  for (const block of parseLabelledBlocks(stripped)) {
    const n = normVerdict(block)
    if (n !== null) out.push(n)
  }
  return out
}

// ---- ledger verdict application (in place) ---------------------------------

function parseLedgerSections(text: string): [string[], Array<[string, [string, string][]]>] {
  const preamble: string[] = []
  const sections: Array<[string, [string, string][]]> = []
  let cur: [string, [string, string][]] | null = null
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('## ') && !line.startsWith('###')) {
      const h = line.match(_LEDGER_HEAD_RE)
      cur = [h ? h[1]!.trim() : '', []]
      sections.push(cur)
      continue
    }
    if (cur === null) {
      preamble.push(line)
    } else {
      const fm = line.match(_LEDGER_FIELD_RE)
      cur[1].push(fm ? [fm[1]!, fm[2]!] : ['_raw', line])
    }
  }
  return [preamble, sections.filter((s) => !s[0].toLowerCase().startsWith('verifier delta'))]
}

function setField(body: [string, string][], field: string, value: string): void {
  for (let i = 0; i < body.length; i++) {
    if (body[i]![0] === field) { body[i] = [field, value]; return }
  }
  body.push([field, value])
}

function applyVerdictToBody(body: [string, string][], v: Record<string, unknown>): void {
  const verdict = v['verdict'] as string
  const metaRaw = v['confirmed_metadata']
  const meta = (typeof metaRaw === 'object' && metaRaw !== null && !Array.isArray(metaRaw)) ? (metaRaw as Record<string, unknown>) : {}
  const src = String(v['source_url'] ?? '').trim()
  const note = String(v['note'] ?? '').trim()
  if ((verdict === 'verified' || verdict === 'corrected') && src) {
    for (const f of ['authors', 'title', 'venue', 'year', 'doi']) {
      if (meta[f]) setField(body, f, String(meta[f]))
    }
    if (meta['arxiv_id']) setField(body, 'arxiv', String(meta['arxiv_id']))
    setField(body, 'source_url', src)
    setField(body, 'verified-by', 'verifier')
  } else {
    setField(body, 'verified-by', `unverified (${verdict})`)
  }
  if (note) setField(body, 'note', note)
}

function applyLedgerVerdicts(ledgerPath: string, verdicts: Record<string, unknown>[]): void {
  const text = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : ''
  const [preamble, sections] = parseLedgerSections(text)
  const byKey = new Map<string, [string, string][]>()
  for (const [key, body] of sections) byKey.set(key, body)
  for (const v of verdicts) {
    const key = v['key'] as string
    if (typeof key !== 'string') continue
    let body = byKey.get(key)
    if (body) {
      applyVerdictToBody(body, v)
    } else {
      const newBody: [string, string][] = []
      applyVerdictToBody(newBody, v)
      sections.push([key, newBody])
      byKey.set(key, newBody)
    }
  }
  const out: string[] = []
  const pre = preamble.join('\n').replace(/\n+$/, '')
  if (pre) out.push(pre)
  for (const [key, body] of sections) {
    out.push('')
    out.push(`## ${key}`)
    for (const [f, val] of body) {
      if (f === '_raw') { if (val.trim()) out.push(val) }
      else out.push(`- ${f}: ${val}`)
    }
  }
  mkdirSync(dirname(ledgerPath), { recursive: true })
  writeFile(ledgerPath, out.join('\n').replace(/\n+$/, '') + '\n', 'utf8')
}

// --------------------------------------------------------------------------- //
// paper-math verdict parsing                                                   //
// --------------------------------------------------------------------------- //

function renderFindings(findings: unknown[]): string {
  const out: string[] = []
  for (const f of findings) {
    if (typeof f === 'object' && f !== null && !Array.isArray(f)) {
      const o = f as Record<string, unknown>
      const loc = String(o['location'] ?? '').trim()
      const iss = String(o['issue'] ?? o['report'] ?? o['hint'] ?? '').trim()
      out.push((loc ? loc + ': ' : '') + iss)
    } else {
      out.push(String(f).trim())
    }
  }
  return out.filter(Boolean).join(' | ')
}

function parsePaperVerdict(stdout: string): [string | null, unknown[], unknown[]] {
  let bestFindings: unknown[] | null = null
  let bestVerdictObj: Record<string, unknown> | null = null
  let i = 0
  while (true) {
    const j = stdout.indexOf('{', i)
    if (j === -1) break
    let obj: unknown, end: number
    try {
      ;[obj, end] = rawDecode(stdout, j)
    } catch {
      i = j + 1
      continue
    }
    i = end
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) continue
    const o = obj as Record<string, unknown>
    if (Array.isArray(o['findings'])) bestFindings = o['findings']
    else if (['correct', 'wrong'].includes(String(o['verdict'] ?? '').trim().toLowerCase())) bestVerdictObj = o
  }
  if (bestFindings !== null) {
    const must: unknown[] = []
    const ign: unknown[] = []
    for (const f of bestFindings) {
      const cls = (typeof f === 'object' && f !== null && !Array.isArray(f)) ? String((f as Record<string, unknown>)['class'] ?? '').trim().toLowerCase() : ''
      ;(cls === 'ignorable' ? ign : must).push(f)
    }
    return [must.length === 0 ? 'correct' : 'wrong', must, ign]
  }
  if (bestVerdictObj !== null) {
    const v = String(bestVerdictObj['verdict']).trim().toLowerCase()
    if (v === 'correct') return ['correct', [], []]
    const hints = String(bestVerdictObj['repair_hints'] ?? bestVerdictObj['report'] ?? '')
    return ['wrong', hints ? [{ issue: hints }] : [{ issue: 'unspecified gap' }], []]
  }
  return [null, [], []]
}

function rawDecode(text: string, from: number): [unknown, number] {
  // Balanced JSON scanner (tolerate LaTeX braces). Uses a simple brace counter.
  let depth = 0
  let inStr = false
  let esc = false
  for (let k = from; k < text.length; k++) {
    const c = text[k]!
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; continue }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        const raw = text.slice(from, k + 1)
        return [JSON.parse(raw), k + 1]
      }
    }
  }
  throw new Error('unbalanced JSON')
}

// --------------------------------------------------------------------------- //
// revision log append                                                         //
// --------------------------------------------------------------------------- //

function appendRevisionLog(logPath: string, compileLog?: string | null, notes?: string | null, citationFixes?: string | null, summary?: string | null, compileStatus = 'ok'): void {
  let mode: string
  if (compileLog) mode = 'compile-fix'
  else if (notes || citationFixes) mode = 'targeted-notes'
  else mode = 'style-audit-pass'
  const triggerBits: string[] = []
  if (compileLog) triggerBits.push('compile_log')
  if (citationFixes) triggerBits.push('citation_fixes')
  if (notes) triggerBits.push('notes')
  const trigger = triggerBits.length > 0 ? triggerBits.join(', ') : 'none (style-audit pass)'
  const body = summary !== null && summary !== undefined ? summary : '[degraded: reviser emitted no REVISION_SUMMARY section — the tex was still leak-checked, compiled, and written, but no round summary is available]'
  const entry = `\n## ${utcNow()} — reviser (danus.write_paper)\n- **mode:** ${mode}  |  **trigger:** ${trigger}  |  **compile:** ${compileStatus}\n\n${body}\n`
  if (!existsSync(logPath)) {
    mkdirSync(dirname(logPath), { recursive: true })
    const header = '# REVISION_LOG\n\n<!-- newest entries on top; tool entries appended -->\n'
    writeFile(logPath, header + entry, 'utf8')
  } else {
    const cur = readFileSync(logPath, 'utf8')
    writeFile(logPath, cur + entry, 'utf8')
  }
}

// --------------------------------------------------------------------------- //
// misc                                                                        //
// --------------------------------------------------------------------------- //

function jsonIndent(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

function unlinkOrThrow(p: string): void {
  unlinkSync(p)
}

// default swarm stop —— best-effort;若无 swarm 服务,返回 noop 列表。
function defaultSwarmStop(project: string): unknown[] {
  return [{ result: 'not-running' }]
}
