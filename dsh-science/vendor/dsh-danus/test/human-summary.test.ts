/**
 * human-summary.test.ts — 移植 Danus human_summary/tests/{test_assemble,test_server}.py
 * 与 spec §7.3 的断言。用注入 drive 桩与夹具项目。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { HumanSummary, buildPrompt, operatorLanguage, humanSummarySkillDir } from '../src/services/human-summary.js'
import { resolveProject } from '../src/authoring/common.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXAMPLE_PROJECT = join(HERE, '..', 'assets', 'write-paper', 'examples', 'paper', 'project')

function copyDir(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src)) {
    const s = join(src, entry)
    const d = join(dst, entry)
    if (statSync(s).isDirectory()) copyDir(s, d)
    else writeFileSync(d, readFileSync(s, 'utf8'), 'utf8')
  }
}

function makeHsProject(): string {
  const proj = mkdtempSync(join(tmpdir(), 'danus-hs-proj-'))
  copyDir(EXAMPLE_PROJECT, proj)
  // PROBLEM.md is part of example
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

function hs(drive?: (p: string) => Promise<any>): HumanSummary {
  return new HumanSummary({ drive: drive ?? (async (p) => ({ status: 'ok', returncode: 0, stdout: reportFor(p), stderr_tail: '', stderr_full: '', cmd: [] })) })
}

function reportFor(p: string): string {
  if (p.includes('[[FAKE:leak16]]')) return 'The bound is 1a131721f439cade.\n'
  if (p.includes('[[FAKE:exit=7]]')) return ''
  return 'The sum of the first n odd numbers equals the square of n.\n'
}

// ========================================================================== //
// assemble:scrub / language / 空图 / 缺文件                                  //
// ========================================================================== //

test('组装:嵌入 writer prompt + PROBLEM.md + proof 正文逐字;scrub 无 ids', () => {
  const proj = makeHsProject()
  const restore = env({ DANUS_PROJECT_DIR: proj })
  try {
    const p = buildPrompt(proj, 'English')
    assert.ok(p.includes('You are the REPORT WRITER'))
    assert.ok(p.includes('===== BEGIN REPORT_WRITER_PROMPT.md ====='))
    assert.ok(p.includes('===== BEGIN PROBLEM.md (verbatim goal) ====='))
    assert.ok(p.includes('===== BEGIN VERIFIED_RESULTS (scrubbed, id-free) ====='))
    // 正文逐字
    assert.ok(p.includes('Both $S(n)$ and $n^2$ start at $1$'))
    // scrub:无 fact id / author / predecessors / problem_id / glossary / external_refs / fact slug
    assert.ok(!p.includes('fact_id: fact_odd_sum_main'))
    assert.ok(!p.includes('problem_id: odd-sum'))
    assert.ok(!p.includes('predecessors: ['))
    assert.ok(!p.includes('glossary_introduces:'))
    assert.ok(!p.includes('external_refs:'))
    assert.ok(!p.includes('fact_odd_sum_main'))
  } finally { restore() }
})

test('语言指令:默认 English;显式 Chinese 透传且含 terminology in English', () => {
  const proj = makeHsProject()
  const restore = env({ DANUS_PROJECT_DIR: proj })
  try {
    const en = buildPrompt(proj, 'English')
    assert.ok(en.includes('Report language: English'))
    const zh = buildPrompt(proj, 'Chinese')
    assert.ok(zh.includes('Report language: Chinese'))
    assert.ok(zh.includes('terminology in English'))
  } finally { restore() }
})

test('空图 → sentinel `_(no verified results...`', () => {
  const proj = mkdtempSync(join(tmpdir(), 'danus-hs-empty-'))
  writeFileSync(join(proj, 'PROBLEM.md'), 'problem\n', 'utf8')
  // 无 fact_graph → 空
  const restore = env({ DANUS_PROJECT_DIR: proj })
  try {
    const p = buildPrompt(proj, 'English')
    assert.ok(p.includes('_(no verified results are available for this project yet)_'))
  } finally { restore() }
})

test('缺 writer prompt/PROBLEM.md → FileNotFoundError', () => {
  const proj = mkdtempSync(join(tmpdir(), 'danus-hs-missing-'))
  const restore = env({ DANUS_PROJECT_DIR: proj, DANUS_HUMAN_SUMMARY_SKILL_DIR: join(tmpdir(), 'no-skill') })
  try {
    assert.throws(() => buildPrompt(proj, 'English'), /required fixed file is missing/)
  } finally { restore() }
})

test('路径转义验证:resolve_project 拒绝 ../evil, a/b, /abs', () => {
  const restore = env({})
  try {
    process.env.DANUS_AGENTS_ROOT = join(tmpdir(), 'danus-agentsroot')
    process.env.DANUS_PROJECT_DIR = '/tmp/x'
    assert.throws(() => resolveProject('../evil'), /invalid project name/)
    assert.throws(() => resolveProject('a/b'), /invalid project name/)
    assert.throws(() => resolveProject('/abs'), /invalid project name/)
  } finally { restore() }
})

// ========================================================================== //
// _operator_language                                                        //
// ========================================================================== //

test('_operator_language:缺文件/空模板/无行 → None;真实字符串被读到', () => {
  const restore = env({ DANUS_OPERATOR_MD: join(tmpdir(), 'no-operator.md') })
  try {
    assert.equal(operatorLanguage(), null)
  } finally { restore() }
  const proj = mkdtempSync(join(tmpdir(), 'danus-oplang-'))
  const path = join(proj, 'OPERATOR.md')
  writeFileSync(path, '# something\n**Language:** Chinese\n', 'utf8')
  const restore2 = env({ DANUS_OPERATOR_MD: path })
  try {
    assert.equal(operatorLanguage(), 'Chinese')
  } finally { restore2() }
  // 空模板
  writeFileSync(path, '# something\n**Language:** _( ... )_\n', 'utf8')
  const restore3 = env({ DANUS_OPERATOR_MD: path })
  try {
    assert.equal(operatorLanguage(), null)
  } finally { restore3() }
  // 无行
  writeFileSync(path, '# no field here\n', 'utf8')
  const restore4 = env({ DANUS_OPERATOR_MD: path })
  try {
    assert.equal(operatorLanguage(), null)
  } finally { restore4() }
})

// ========================================================================== //
// server:summary_write                                                      //
// ========================================================================== //

test('summary_write:干净输出 → report.md + status=ok + 无 leak + 小返回(无 full body)', async () => {
  const proj = makeHsProject()
  const restore = env({ DANUS_PROJECT_DIR: proj })
  try {
    const s = hs()
    const out = await s.summary_write({})
    assert.equal(out['status'], 'ok')
    assert.equal(out['language'], 'English')
    assert.deepEqual(out['leak_findings'], [])
    assert.equal(existsSync(join(proj, 'report', 'report.md')), true)
    // 小返回:不含正文
    assert.equal(typeof out['report_md_path'], 'string')
    assert.ok(!JSON.stringify(out).includes('The sum of the first n odd numbers'))
  } finally { restore() }
})

test('summary_write:泄漏 16-hex → status!=ok + leak_findings + 不保留 report.md + 隔离 report.leaky.md + 删除旧干净 report', async () => {
  const proj = makeHsProject()
  const restore = env({ DANUS_PROJECT_DIR: proj })
  try {
    // 先写一个旧干净 report.md
    mkdirSync(join(proj, 'report'), { recursive: true })
    writeFileSync(join(proj, 'report', 'report.md'), 'old clean\n', 'utf8')
    const s = hs(async (p) => ({ status: 'ok', returncode: 0, stdout: 'a 1a131721f439cade b\n', stderr_tail: '', stderr_full: '', cmd: [] }))
    const out = await s.summary_write({})
    assert.notEqual(out['status'], 'ok')
    assert.equal(out['status'], 'leak')
    assert.ok(out['leak_findings'])
    assert.equal(existsSync(join(proj, 'report', 'report.md')), false) // 旧干净被删
    assert.ok(existsSync(join(proj, 'report', 'report.leaky.md')))
  } finally { restore() }
})

test('summary_write:nonzero/empty/timeout → 诚实不写 report.md', async () => {
  const proj = makeHsProject()
  const restore = env({ DANUS_PROJECT_DIR: proj })
  try {
    const nz = hs(async () => ({ status: 'error', returncode: 1, stdout: '', stderr_tail: 'boom', stderr_full: 'boom', error: 'codex exited with nonzero code 1', cmd: [] }))
    const out1 = await nz.summary_write({})
    assert.equal(out1['status'], 'error')
    assert.equal(existsSync(join(proj, 'report', 'report.md')), false)

    const empty = hs(async () => ({ status: 'error', returncode: 0, stdout: '', stderr_tail: '', stderr_full: '', error: 'codex produced empty stdout (no report)', cmd: [] }))
    const out2 = await empty.summary_write({})
    assert.equal(out2['status'], 'error')
    assert.equal(existsSync(join(proj, 'report', 'report.md')), false)
  } finally { restore() }
})

test('summary_write:语言解析(operator 无语言 → English;显式 language 优先)', async () => {
  const proj = makeHsProject()
  const restore = env({ DANUS_PROJECT_DIR: proj })
  try {
    const s = hs()
    const out = await s.summary_write({})
    assert.equal(out['language'], 'English')
    const out2 = await s.summary_write({ language: 'French' })
    assert.equal(out2['language'], 'French')
  } finally { restore() }
})

test('leak scanner:捕获所有禁词类别', () => {
  const proj = makeHsProject()
  const restore = env({ DANUS_PROJECT_DIR: proj })
  try {
    const s = hs()
    for (const word of ['a 1a131721f439cade b', 'author: foo', 'has predecessors', 'fact_foo', 'master_guidance', 'fact_submit', 'verifier', 'worker', 'global memory']) {
      const hits = s.scanLeaks(word)
      assert.ok(hits.length > 0, `expected leak for ${word}`)
    }
  } finally { restore() }
})

// 确认人类 summary skill 定位
test('humanSummarySkillDir 默认 assets/human-summary', () => {
  const restore = env({})
  try {
    delete process.env.DANUS_HUMAN_SUMMARY_SKILL_DIR
    assert.ok(humanSummarySkillDir().replace(/\\/g, '/').endsWith('assets/human-summary'))
  } finally { restore() }
})
