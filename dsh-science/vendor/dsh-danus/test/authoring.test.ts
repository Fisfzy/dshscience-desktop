/**
 * authoring.test.ts — 移植 Danus authoring/tests/{test_common,test_driver}.py。
 * 用 fake-dsh-authoring.mjs 桩(等价 fake_codex.py)走通一次性渲染驱动。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  classifyOutcome, bodySections, leakFindings, readFixed, readProject, resolveProject,
  section, FileNotFoundError,
} from '../src/authoring/common.js'
import { classifyRes, runOnce, DEFAULT_TIMEOUT } from '../src/authoring/driver.js'
import type { HeadlessRunResult } from '../src/shared/headless.js'

const FAKE_DSH = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-dsh-authoring.mjs')

async function withFakeDsh<T>(extraEnv: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {}
  const vars: Record<string, string> = { DSH_BIN: FAKE_DSH, ...extraEnv }
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k]
    process.env[k] = vars[k]
  }
  try {
    return await fn()
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
}

function tempProject(extra: Record<string, string> = {}): string {
  const d = mkdtempSync(join(tmpdir(), 'danus-auth-proj-'))
  process.env.DANUS_PROJECT_DIR = d
  for (const [k, v] of Object.entries(extra)) process.env[k] = v
  return d
}
void tempProject

// --------------------------------------------------------------------- common
test('resolve_project:按名解析;非法名;root 未设;回退 project dir;皆空', () => {
  const root = mkdtempSync(join(tmpdir(), 'danus-agents-'))
  mkdirSync(join(root, 'proj-a'), { recursive: true })
  process.env.DANUS_AGENTS_ROOT = root
  assert.equal(resolveProject('proj-a'), join(root, 'proj-a'))

  assert.throws(() => resolveProject('../evil'), /invalid project name/)
  assert.throws(() => resolveProject('a/b'), /invalid project name/)
  assert.throws(() => resolveProject('/abs'), /invalid project name/)

  // 未知但格式良好名 → 抛(在 root 仍设置时)
  assert.throws(() => resolveProject('unknown'), /no such project/)

  delete process.env.DANUS_AGENTS_ROOT
  assert.throws(() => resolveProject('good'), /DANUS_AGENTS_ROOT/)

  // 回退 DANUS_PROJECT_DIR
  const pd = mkdtempSync(join(tmpdir(), 'danus-pd-'))
  process.env.DANUS_PROJECT_DIR = pd
  assert.equal(resolveProject(), pd)

  // 皆空
  delete process.env.DANUS_PROJECT_DIR
  assert.throws(() => resolveProject(null), /DANUS_PROJECT_DIR is not set/)
})

test('section 包装含 BEGIN/END', () => {
  const s = section('X', 'body')
  assert.ok(s.includes('===== BEGIN X ====='))
  assert.ok(s.includes('===== END X ====='))
  assert.ok(s.includes('body'))
})

test('read_fixed / read_project 缺文件抛 FileNotFoundError', () => {
  const d = mkdtempSync(join(tmpdir(), 'danus-rf-'))
  writeFileSync(join(d, 'a.md'), 'hi', 'utf8')
  assert.equal(readFixed(d, 'a.md'), 'hi')
  assert.equal(readProject(d, 'a.md'), 'hi')
  assert.throws(() => readFixed(d, 'missing.md'), FileNotFoundError)
  assert.throws(() => readProject(d, 'missing.md'), FileNotFoundError)
})

test('body_sections:frontmatter 擦洗 / 闭 fence / 无标题无 fence / 未闭合 fence', () => {
  const withBody =
    '---\nfact_id: factorial\nproblem_id: p\n---\n\n## statement\nS(n).\n## proof\nP.\n'
  const b = bodySections(withBody)
  assert.ok(b.startsWith('## statement'))
  assert.ok(!b.includes('fact_id:'))
  assert.ok(!b.includes('authors:\n'))

  // 无 `## ` 但有关闭 fence → 返回闭 fence 后内容
  const onlyFm = '---\nfact_id: x\n---\nprovablebody\n'
  assert.equal(bodySections(onlyFm), 'provablebody\n')

  // 无标题无 fence → 原样 strip
  assert.equal(bodySections('plain content\n'), 'plain content\n')

  // 未闭合 fence → 落回原样(以 --- 开头,不崩溃)
  const unclosed = '---\nfact_id: x\n'
  assert.equal(bodySections(unclosed), unclosed.trimEnd() + '\n')
})

test('classify_outcome:ok / nonzero / empty / timeout / missing-binary', () => {
  const ok = classifyOutcome({ exitCode: 0, timedOut: false, stdout: 'data' })
  assert.equal(ok.status, 'ok')
  assert.equal(ok.stdout, 'data')

  const nz = classifyOutcome({ exitCode: 3, timedOut: false, stdout: '', stderr: 'boom\nline' })
  assert.equal(nz.status, 'error')
  assert.equal(nz.returncode, 3)
  assert.match(nz.error!, /nonzero code 3/)
  assert.ok(nz.stderr_tail.includes('boom'))

  const empty = classifyOutcome({ exitCode: 0, timedOut: false, stdout: '   \n' }, { artifactNoun: 'report' })
  assert.equal(empty.status, 'error')
  assert.match(empty.error!, /no report/)

  const to = classifyOutcome({ exitCode: null, timedOut: true, timeoutSeconds: 5 })
  assert.equal(to.status, 'timeout')
  assert.equal(to.returncode, null)
  assert.match(to.error!, /timed out after 5s/)

  const mb = classifyOutcome({ exitCode: null, timedOut: false, spawnError: 'spawn dsh ENOENT' })
  assert.equal(mb.status, 'error')
  assert.match(mb.error!, /codex binary not found/)
})

test('leak_findings 只扫描调用方提供 pattern', () => {
  const hits = leakFindings('a 1a131721f439cade b', [[/\b[0-9a-f]{16}\b/, 'hex']])
  assert.equal(hits.length, 1)
  assert.match(hits[0]!, /hex: matched/)
  // 空 pattern 集 → 干净
  assert.deepEqual(leakFindings('anything', []), [])
})

// --------------------------------------------------------------------- driver
test('driver.runOnce:stdout 逐字转发;cwd 全新临时目录且事后清掉', async () => {
  const cwdFile = join(mkdtempSync(join(tmpdir(), 'danus-cwd-')), 'cwd.txt')
  await withFakeDsh({ FAKE_CWD_OUT: cwdFile }, async () => {
    const res = await runOnce('[[FAKE:documentclass]] write the paper', { timeout: 10 })
    assert.equal(res.exitCode, 0)
    assert.equal(res.timedOut, false)
    assert.match(res.stdout!, /\\documentclass\{amsart\}/)
    const cwd = readFileSync(cwdFile, 'utf8')
    assert.match(cwd, /danus-authoring-/)
    assert.equal(existsSync(cwd), false) // 事后清掉
  })
})

test('driver.runOnce:nonzero returncode 透传([[FAKE:exit=7]])', async () => {
  await withFakeDsh({}, async () => {
    const res = await runOnce('[[FAKE:exit=7]] x', { timeout: 10 })
    assert.equal(res.exitCode, 7)
    assert.equal(res.stdout, '')
    assert.match(res.stderr ?? '', /forced nonzero exit/)
    const cls = classifyRes(res)
    assert.equal(cls.status, 'error')
    assert.equal(cls.returncode, 7)
  })
})

test('driver.runOnce:缺二进制 → spawnError', async () => {
  // 用绝对但不存在、且非 .mjs/.js 的路径,令 spawn 本身 ENOENT(而非 node 找不到脚本)。
  await withFakeDsh({ DSH_BIN: join(tmpdir(), 'no-such-dsh') }, async () => {
    const res = await runOnce('write', { timeout: 10 })
    assert.ok(res.spawnError)
    const cls = classifyRes(res)
    assert.equal(cls.status, 'error')
    assert.match(cls.error!, /codex binary not found/)
  })
})

test('driver.runOnce:超时 → timedOut', async () => {
  await withFakeDsh({ FAKE_SLEEP_MS: '2000' }, async () => {
    const res = await runOnce('write', { timeout: 0.3 })
    assert.equal(res.timedOut, true)
    const cls = classifyRes(res, { timeoutSeconds: 0.3 })
    assert.equal(cls.status, 'timeout')
  })
})

test('driver:中性默认(DEFAULT_TIMEOUT)', () => {
  assert.equal(DEFAULT_TIMEOUT, 7200)
})
