/**
 * write-paper.test.ts — 移植 Danus write_paper/tests/{test_server,test_assemble,
 * test_chunked,test_multi_paper,test_paper_math_verify}.py 里固化在 spec §7.2 的断言。
 * 用注入的 drive 桩(等价 fake codex)与一个从 assets/ 复制的夹具项目。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { WritePaper, type WritePaperConfig } from '../src/services/write-paper.js'
import type { DriveResult } from '../src/services/write-paper-chunked.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXAMPLE_PROJECT = join(HERE, '..', 'assets', 'write-paper', 'examples', 'paper', 'project')

const GOOD_TEX = '\\documentclass{amsart}\n\\begin{document}\n\\section{Main}\nhello\n\\end{document}\n'

function copyDir(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src)) {
    const s = join(src, entry)
    const d = join(dst, entry)
    if (statSync(s).isDirectory()) copyDir(s, d)
    else writeFileSync(d, readFileSync(s, 'utf8'), 'utf8')
  }
}

// ---- fixture ------------------------------------------------------------------

function makePaperProject(): string {
  const proj = mkdtempSync(join(tmpdir(), 'danus-wp-proj-'))
  copyDir(EXAMPLE_PROJECT, proj)
  // seed a reference ledger (partial) + PROBLEM.md is part of the example
  const ws = join(proj, 'paper')
  mkdirSync(ws, { recursive: true })
  writeFileSync(join(ws, 'REFERENCE_LEDGER.md'),
    '# REFERENCE_LEDGER\n\n## AC24\n- title: A note on telescoping sums\n- verified-by: unverified\n\n## Exm20\n- title: Elementary induction, revisited\n- verified-by: unverified\n',
    'utf8')
  return proj
}

const env = (vars: Record<string, string>) => {
  const saved: Record<string, string | undefined> = {}
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k]
    process.env[k] = vars[k]
  }
  return () => {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
}

function reviserOutputFix(): string {
  const patch = '%%%PATCH%%%\n<<<<<<< FIND\n\\section{Main (revised)}\n=======\n\\section{Main (revised)!}\n>>>>>>> REPLACE\n%%%REVISION_SUMMARY%%%\ncompile fixed\n'
  return '%%%MAIN_TEX%%%\n' + patch + '\n'
}

// ---- drive stub ----------------------------------------------------------------

async function stubDrive(prompt: string, _effort?: string): Promise<DriveResult & { stderr_full?: string; cmd?: string[] }> {
  const ok = (stdout: string, rc = 0): DriveResult & { stderr_full?: string; cmd?: string[] } => ({ status: 'ok', returncode: rc, stdout, stderr_tail: '', stderr_full: '', cmd: [] })
  const fail = (rc: number, err: string): DriveResult & { stderr_full?: string; cmd?: string[] } => ({ status: 'error', returncode: rc, stdout: '', stderr_tail: err, stderr_full: err, error: err, cmd: [] })

  if (prompt.includes('[[FAKE:exit=7]]')) return fail(7, 'codex exited with nonzero code 7')
  if (prompt.includes('[[FAKE:empty]]')) return { status: 'error', returncode: 0, stdout: '', stderr_tail: '', stderr_full: '', error: 'codex produced empty stdout (no artifact)', cmd: [] }

  if (prompt.includes('You are the PAPER WRITER')) {
    let body = '' // detect markers
    if (prompt.includes('[[FAKE:leak16]]')) body = '\\documentclass{amsart}\n\\begin{document}\n1a131721f439cade\n\\end{document}\n'
    else if (prompt.includes('[[FAKE:provenance]]')) body = GOOD_TEX + '\n%%%PROVENANCE%%%\n{"thm:main":"fact_odd_sum_main"}\n'
    else if (prompt.includes('[[FAKE:fence]]')) body = '```tex\n' + GOOD_TEX + '```\n'
    else body = GOOD_TEX
    return ok(body)
  }
  if (prompt.includes('You are the PAPER PLANNER')) {
    if (prompt.includes('[[FAKE:missing_sep]]')) return ok('%%%PREAMBLE%%%\npreamble\n(garbage no more separators)\n')
    return ok(plannerOutput())
  }
  if (prompt.includes('You are the PAPER SECTION WRITER')) {
    return ok('\\section{Section one}\\label{sec:one}\n\\begin{document}\ncontents\n\\end{document}\n')
  }
  if (prompt.includes('You are the REFERENCE AUDITOR')) return ok('AUDITOR: the AC24 entry needs a source url.\n')
  if (prompt.includes('You are the REFERENCE VERIFIER')) {
    return ok(JSON.stringify([{ key: 'AC24', verdict: 'verified', source_url: 'https://doi.org/10.1/x', confirmed_metadata: { title: 'A note on telescoping sums', arxiv_id: '2401.00001', year: '2024' } }]))
  }
  if (prompt.includes('You are the PAPER REVISER')) {
    if (prompt.includes('[[FAKE:noop]]')) {
      return ok('%%%MAIN_TEX%%%\n' + GOOD_TEX + '\n%%%REVISION_SUMMARY%%%\nno edits\n')
    }
    return ok(reviserOutput())
  }
  if (prompt.includes('You are the PAPER MATH VERIFIER')) {
    if (prompt.includes('[[FAKE:mustfix]]')) return ok(JSON.stringify({ findings: [{ location: 'sec2', issue: 'WLOG skips a step', class: 'must-fix' }] }))
    return ok(JSON.stringify({ findings: [{ location: 'sec1', issue: 'routine', class: 'ignorable' }] }))
  }
  return ok('fallback')
}

function plannerOutput(): string {
  const sections = JSON.stringify([
    { title: 'Introduction', label: 'sec:intro', fact_ids: ['fact_odd_recurrence'] },
    { title: 'Main theorem', label: 'sec:main', fact_ids: ['fact_odd_sum_main'] },
  ])
  return '%%%PREAMBLE%%%\n\\documentclass{amsart}\n%%%FRONTMATTER%%%\n\\begin{document}\n%%%SECTIONS%%%\n' + sections + '\n%%%BIBLIOGRAPHY%%%\n\\begin{thebibliography}\n\\end{document? no bib item}\n'
}

function reviserOutput(): string {
  const patch = '%%%PATCH%%%\n<<<<<<< FIND\n\\section{Main}\n=======\n\\section{Main (revised)}\n>>>>>>> REPLACE\n%%%REVISION_SUMMARY%%%\nrenamed section\n'
  return '%%%MAIN_TEX%%%\n' + patch + '\n'
}

function wp(config?: WritePaperConfig): WritePaper {
  const drive = config?.drive ?? ((p: string, e?: string) => stubDrive(p, e))
  const driveNetworked = config?.driveNetworked ?? drive
  return new WritePaper({ ...config, drive, driveNetworked } as WritePaperConfig)
}

// ========================================================================== //
// honesty / needs_target / bad_fact_ids                                       //
// ========================================================================== //

test('paper_write 诚实性:nonzero/empty → 非 ok,无 main.tex 写入', async () => {
  const proj = makePaperProject()
  const restore = env({ DANUS_PROJECT_DIR: proj })
  try {
    const w = wp()
    const bad = await w.paper_write({ fact_ids: ['fact_odd_sum_main'], instructions: '[[FAKE:exit=7]]' })
    assert.notEqual(bad['status'], 'ok')
    assert.equal(bad['returncode'], 7)
    assert.equal(existsSync(join(proj, 'paper', 'main.tex')), false)
  } finally { restore() }
})

test('needs_target:brief 空 + 无 TARGET → needs_target,candidates 为终端事实', async () => {
  const proj = makePaperProject()
  // 清空 brief 的 headline_fact_ids,去掉 TARGET
  writeFileSync(join(proj, 'paper', 'PROJECT_BRIEF.md'), '# empty brief\n', 'utf8')
  const restore = env({ DANUS_PROJECT_DIR: proj })
  try {
    const w = wp()
    const out = await w.paper_write({})
    assert.equal(out['status'], 'needs_target')
    assert.equal(out['headline_source'], 'unset')
    assert.deepEqual(out['candidates'], ['fact_odd_sum_main'])
    assert.equal(existsSync(join(proj, 'paper', 'main.tex')), false)
  } finally { restore() }
})

test('bad_fact_ids:未知 fact id → bad_fact_ids,不写', async () => {
  const proj = makePaperProject()
  const restore = env({ DANUS_PROJECT_DIR: proj })
  try {
    const w = wp()
    const out = await w.paper_write({ fact_ids: ['fact_nonexistent'] })
    assert.equal(out['status'], 'bad_fact_ids')
    assert.deepEqual(out['unknown_fact_ids'], ['fact_nonexistent'])
    assert.equal(existsSync(join(proj, 'paper', 'main.tex')), false)
  } finally { restore() }
})

// ========================================================================== //
// leak gate / provenance / code fence                                         //
// ========================================================================== //

test('leak 门:16-hex fact_id 混入 .tex → leak,隔离 main.leaky.tex,main.tex 不写', async () => {
  const proj = makePaperProject()
  const restore = env({ DANUS_PROJECT_DIR: proj })
  try {
    const w = wp()
    const out = await w.paper_write({ fact_ids: ['fact_odd_sum_main'], instructions: '[[FAKE:leak16]]' })
    assert.equal(out['status'], 'leak')
    assert.equal(existsSync(join(proj, 'paper', 'main.tex')), false)
    assert.ok(existsSync(join(proj, 'paper', 'main.leaky.tex')))
    assert.ok(out['leak_findings'])
  } finally { restore() }
})

test('provenance:%%%PROVENANCE%%% 在 leak 门之前剥走,16-hex 只进 .provenance.json', async () => {
  const proj = makePaperProject()
  const restore = env({ DANUS_PROJECT_DIR: proj })
  try {
    const w = wp()
    const out = await w.paper_write({ fact_ids: ['fact_odd_sum_main'], instructions: '[[FAKE:provenance]]' })
    assert.equal(out['status'], 'ok')
    assert.ok(existsSync(join(proj, 'paper', 'main.tex')))
    assert.equal(out['provenance_path'], join(proj, 'paper', '.provenance.json'))
    const prov = JSON.parse(readFileSync(join(proj, 'paper', '.provenance.json'), 'utf8'))
    assert.equal(prov['thm:main'], 'fact_odd_sum_main')
    // tex 本身不含 16-hex
    assert.equal(readFileSync(join(proj, 'paper', 'main.tex'), 'utf8').includes('1a131721f439cade'), false)
  } finally { restore() }
})

test('code fence:整份输出包进 ```tex 时剥外层,tex 可编译', async () => {
  const proj = makePaperProject()
  const restore = env({ DANUS_PROJECT_DIR: proj })
  try {
    const w = wp()
    const out = await w.paper_write({ fact_ids: ['fact_odd_sum_main'], instructions: '[[FAKE:fence]]' })
    assert.equal(out['status'], 'ok')
    assert.ok(readFileSync(join(proj, 'paper', 'main.tex'), 'utf8').startsWith('\\documentclass'))
  } finally { restore() }
})

// ========================================================================== //
// swarm stop                                                                  //
// ========================================================================== //

test('swarm stop:默认不停;stop_workers=True 且 keep 未设 → 调 stop;DANUS_KEEP_SWARM_ON_WRITE=1 强制 keep', async () => {
  const proj = makePaperProject()
  let stopCalled = 0
  const restore = env({ DANUS_PROJECT_DIR: proj })
  try {
    const w = wp({ swarmStop: () => { stopCalled++; return [{ result: 'not-running' }] } })
    const a = await w.paper_write({}) // no stop_workers
    assert.equal((a['swarm_stop'] as Record<string, unknown>)['skipped'], 'stop_workers=False')
    assert.equal(stopCalled, 0)
    const b = await w.paper_write({ stop_workers: true })
    assert.equal(stopCalled, 1)
    assert.deepEqual((b['swarm_stop'] as Record<string, unknown>)['result'], [{ result: 'not-running' }])
    // keep env 强制
    const restore2 = env({ DANUS_PROJECT_DIR: proj, DANUS_KEEP_SWARM_ON_WRITE: '1' })
    const c = await w.paper_write({ stop_workers: true })
    assert.equal((c['swarm_stop'] as Record<string, unknown>)['skipped'], 'DANUS_KEEP_SWARM_ON_WRITE')
    restore2()
  } finally { restore() }
})

// ========================================================================== //
// reference_verify:只写 ledger,绝不写 main.tex                              //
// ========================================================================== //

test('reference_verify:verified → verified-by: verifier + source_url + 元数据;就地单一表', async () => {
  const proj = makePaperProject()
  writeFileSync(join(proj, 'paper', 'main.tex'), GOOD_TEX, 'utf8')
  const restore = env({ DANUS_PROJECT_DIR: proj })
  try {
    const w = wp()
    const out = await w.reference_verify({})
    assert.equal(out['status'], 'ok')
    assert.equal((out['verdicts'] as unknown[]).length, 1)
    const ledger = readFileSync(join(proj, 'paper', 'REFERENCE_LEDGER.md'), 'utf8')
    assert.ok(ledger.includes('## AC24'))
    assert.ok(ledger.includes('verified-by: verifier'))
    assert.ok(ledger.includes('source_url: https://doi.org/10.1/x'))
    assert.ok(ledger.includes('arxiv: 2401.00001'))
    assert.equal(ledger.match(/## AC24/g)!.length, 1) // 就地单一表
    // 绝不写 main.tex
    assert.match(readFileSync(join(proj, 'paper', 'main.tex'), 'utf8'), /\\documentclass/)
  } finally { restore() }
})

// ========================================================================== //
// paper_revise:patch / compile-retry / degenerate                            //
// ========================================================================== //

test('paper_revise:patch 应用成功 → ok,REVISION_LOG 追加真实 summary', async () => {
  const proj = makePaperProject()
  writeFileSync(join(proj, 'paper', 'main.tex'), GOOD_TEX, 'utf8')
  const restore = env({ DANUS_PROJECT_DIR: proj })
  try {
    const w = wp({ compileCheck: () => ({ ok: true, log: '', engine_available: true }) })
    const out = await w.paper_revise({})
    assert.equal(out['status'], 'ok')
    assert.equal(out['compile'], 'ok')
    const tex = readFileSync(join(proj, 'paper', 'main.tex'), 'utf8')
    assert.ok(tex.includes('Main (revised)'))
    const log = readFileSync(join(proj, 'paper', 'REVISION_LOG.md'), 'utf8')
    assert.ok(log.includes('# REVISION_LOG'))
    assert.ok(log.includes('reviser (danus.write_paper)'))
    assert.equal(log.match(/reviser \(danus\.write_paper\)/g)!.length, 1) // 头只一次
    assert.ok(log.includes('renamed section')) // 真实 summary
  } finally { restore() }
})

test('paper_revise:首次编译失败后台重试低 effort;次数尽 → compile_failed + main.uncompiled.tex', async () => {
  const proj = makePaperProject()
  writeFileSync(join(proj, 'paper', 'main.tex'), GOOD_TEX, 'utf8')
  const restore = env({ DANUS_PROJECT_DIR: proj, DANUS_WRITE_PAPER_COMPILE_ATTEMPTS: '2' })
  try {
    let compileCalls = 0
    let driveEfforts: (string | undefined)[] = []
    const drive = async (p: string, effort?: string) => {
      driveEfforts.push(effort)
      if (p.includes('You are fixing LaTeX COMPILE ERRORS')) {
        return { status: 'ok', returncode: 0, stdout: reviserOutputFix(), stderr_tail: '', stderr_full: '', cmd: [] }
      }
      if (p.includes('You are the PAPER REVISER')) {
        return { status: 'ok', returncode: 0, stdout: reviserOutput(), stderr_tail: '', stderr_full: '', cmd: [] }
      }
      return stubDrive(p, effort)
    }
    const w = wp({
      drive,
      compileCheck: (tex: string) => {
        compileCalls++
        return compileCalls <= 1 ? { ok: false, log: 'l.42: undefined control sequence', engine_available: true } : { ok: true, log: '', engine_available: true }
      },
    })
    const out = await w.paper_revise({ notes: 'fix it', compile_log: 'l.5 error' })
    assert.equal(out['status'], 'ok')
    assert.equal(out['compile'], 'ok')
    assert.equal(out['compile_attempts'], 2)
    assert.ok(driveEfforts.includes('low')) // 第二次为低 effort
  } finally { restore() }
})

test('paper_revise:patched tex < 0.6*原长(且原长>2000) → degenerate_revision,main.tex 不覆盖', async () => {
  const proj = makePaperProject()
  const bigTail = 'A'.repeat(2500)
  const bigTex = GOOD_TEX + '\n' + bigTail
  writeFileSync(join(proj, 'paper', 'main.tex'), bigTex, 'utf8')
  const restore = env({ DANUS_PROJECT_DIR: proj })
  try {
    // reviser 输出一个把大块替换掉、导致 tex 骤缩的 patch
    const drive = async (p: string, _e?: string) => {
      if (p.includes('You are the PAPER REVISER')) {
        const patch = '%%%PATCH%%%\n<<<<<<< FIND\n' + bigTail + '\n=======\nx\n>>>>>>> REPLACE\n%%%REVISION_SUMMARY%%%\ncollapsed\n'
        return { status: 'ok', returncode: 0, stdout: '%%%MAIN_TEX%%%\n' + patch + '\n', stderr_tail: '', stderr_full: '', cmd: [] as string[] }
      }
      return stubDrive(p, _e)
    }
    const w = wp({ drive })
    const out = await w.paper_revise({})
    assert.equal(out['status'], 'degenerate_revision')
    assert.ok(existsSync(join(proj, 'paper', 'main.shrunk.tex')))
    assert.ok(readFileSync(join(proj, 'paper', 'main.tex'), 'utf8').length > 2500) // 未被覆盖
  } finally { restore() }
})

// ========================================================================== //
// paper_verify_math                                                          //
// ========================================================================== //

test('paper_verify_math:correct → passed+deliver_ok;wrong → blocked;verify run 失败 → verify_error;无 main.tex → no_paper', async () => {
  const proj = makePaperProject()
  const restore = env({ DANUS_PROJECT_DIR: proj })
  try {
    writeFileSync(join(proj, 'paper', 'main.tex'), GOOD_TEX, 'utf8')
    const w = wp()
    const ok = await w.paper_verify_math({})
    assert.equal(ok['status'], 'passed')
    assert.equal(ok['deliver_ok'], true)

    const w2 = wp({ drive: async (p, e) => p.includes('PAPER MATH VERIFIER') ? { status: 'ok', returncode: 0, stdout: JSON.stringify({ findings: [{ class: 'must-fix', issue: 'gap' }] }), stderr_tail: '', stderr_full: '', cmd: [] } : stubDrive(p, e) })
    const wrong = await w2.paper_verify_math({})
    assert.equal(wrong['status'], 'blocked')

    const w3 = wp({ drive: async (p, e) => p.includes('PAPER MATH VERIFIER') ? { status: 'error', returncode: 1, stdout: '', stderr_tail: 'boom', stderr_full: 'boom', error: 'codex exited with nonzero code 1', cmd: [] } : stubDrive(p, e) })
    const verr = await w3.paper_verify_math({})
    assert.equal(verr['status'], 'verify_error')

    // 无 main.tex
    const proj2 = makePaperProject()
    const restore2 = env({ DANUS_PROJECT_DIR: proj2 })
    const w4 = wp()
    const nop = await w4.paper_verify_math({})
    assert.equal(nop['status'], 'no_paper')
    restore2()
  } finally { restore() }
})

// ========================================================================== //
// run log                                                                     //
// ========================================================================== //

test('run log:log_path 指向 .runs/<utc>/<tool>/log.md,含完整 stderr;DANUS_WRITE_PAPER_RUN_LOG=0 → None', async () => {
  const proj = makePaperProject()
  const restore = env({ DANUS_PROJECT_DIR: proj })
  try {
    const w = wp()
    const out = await w.paper_write({ })
    assert.equal(out['status'], 'ok')
    const lp = out['log_path'] as string
    assert.ok(lp.includes(join('paper', '.runs')))
    assert.ok(lp.includes('paper_write'))
    const log = readFileSync(lp, 'utf8')
    assert.ok(log.includes('## Header'))
    assert.ok(log.includes('## INPUT — assembled prompt'))
    assert.ok(log.includes('## CODEX OUTPUT — stdout'))
    assert.ok(log.includes('## CODEX OUTPUT — stderr'))
    assert.ok(log.includes('## RETURNED ENVELOPE'))

    const restore2 = env({ DANUS_PROJECT_DIR: proj, DANUS_WRITE_PAPER_RUN_LOG: '0' })
    const out2 = await w.paper_write({ })
    assert.equal(out2['log_path'], null)
    restore2()
  } finally { restore() }
})

// ========================================================================== //
// chunked:超预算触发分块;selection 时覆盖集=选中子集                        //
// ========================================================================== //

test('chunked:小闭包走单遍(无 chunked 标志);超预算 → chunk_failed(缺分隔符)', async () => {
  const proj = makePaperProject()
  const restore = env({ DANUS_PROJECT_DIR: proj })
  try {
    const w = wp()
    const a = await w.paper_write({ fact_ids: ['fact_odd_sum_main'] })
    assert.equal(a['chunked'], undefined) // 单遍路径
    restore()

    const proj2 = makePaperProject()
    const restore2 = env({ DANUS_PROJECT_DIR: proj2, DANUS_PAPER_WRITE_CHUNK_CHARS: '100' })
    // planner 缺分隔符 → chunk_failed,failed_phase=plan
    const w2 = wp({ drive: async (p, e) => { if (p.includes('PAPER PLANNER')) return { status: 'ok', returncode: 0, stdout: '%%%PREAMBLE%%%\nx', stderr_tail: '', stderr_full: '', cmd: [] }; return stubDrive(p, e) } })
    const b = await w2.paper_write({ fact_ids: ['fact_odd_sum_main'] })
    assert.equal(b['status'], 'chunk_failed')
    assert.equal(b['failed_phase'], 'plan')
    assert.equal(existsSync(join(proj2, 'paper', 'main.tex')), false) // 诚实不产出半成品
    restore2()
  } finally { restore() }
})

test('chunked:成功路径 → ok,stitch 含 preamble+bib+\\end{document},provenance 只进 .provenance.json', async () => {
  const proj = makePaperProject()
  const restore = env({ DANUS_PROJECT_DIR: proj, DANUS_PAPER_WRITE_CHUNK_CHARS: '100' })
  try {
    const drive = async (p: string, _e?: string) => {
      if (p.includes('PAPER PLANNER')) {
        return { status: 'ok', returncode: 0, stdout: plannerOutput(), stderr_tail: '', stderr_full: '', cmd: [] }
      }
      if (p.includes('PAPER SECTION WRITER')) {
        return {
          status: 'ok', returncode: 0,
          stdout: '\\section{A section}\\label{sec:x}\nbody\n%%%PROVENANCE%%%\n{"thm:main":"fact_odd_sum_main"}\n',
          stderr_tail: '', stderr_full: '', cmd: [],
        }
      }
      return stubDrive(p, _e)
    }
    const w = wp({ drive })
    const out = await w.paper_write({ fact_ids: ['fact_odd_sum_main'] })
    assert.equal(out['status'], 'ok')
    assert.equal(out['chunked'], true)
    const tex = readFileSync(join(proj, 'paper', 'main.tex'), 'utf8')
    assert.ok(tex.includes('\\documentclass{amsart}')) // preamble
    assert.ok(tex.includes('\\end{document}')) // closer
    assert.ok(tex.includes('\\section{A section}'))
    assert.ok(existsSync(join(proj, 'paper', '.provenance.json')))
    // provenance 不进 tex
    assert.ok(!tex.includes('%%%PROVENANCE%%%'))
  } finally { restore() }
})
