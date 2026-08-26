/**
 * verify.test.ts — 移植 Danus verify/tests/{test_launcher,test_service,test_verify}.py。
 * 用 fake-dsh.mjs 桩(等价 fake_codex.py)走通整条 judge 管线。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DanusVerify, VerifyError, VERIFICATION_FILENAMES } from '../src/services/verify.js'

const FAKE_DSH = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-dsh.mjs')

const GOOD_STATEMENT = 'For every positive integer n, the sum of the first n odd positive integers equals n^2.'
const GOOD_PROOF =
  'We proceed by induction on n. The base case n = 1 is immediate since the sum is 1 = 1^2. ' +
  'For the induction step, assume the claim holds for n; adding the next odd number 2n + 1 to ' +
  'both sides yields n^2 + 2n + 1 = (n + 1)^2, which completes the induction and the proof.'

function makeVerify(stateDir: string): DanusVerify {
  return new DanusVerify({ stateDir, profile: 'danus-verifier' })
}

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

// ------------------------------------------------------------- run id / 路径
test('run_id 分配:冲突加 _N 后缀', () => {
  const v = makeVerify(mkdtempSync(join(tmpdir(), 'danus-vfy-')))
  const base = v.generateRunId('S')
  // 预建 base 目录制造冲突
  mkdirSync(join(v.resultsRoot, base), { recursive: true })
  const rid = v.allocateRunId('S')
  assert.equal(rid, `${base}_1`) // 第一个后缀为 _1
  assert.ok(existsSync(join(v.resultsRoot, rid)))
})

test('verificationPath:偏好序 + 刻意拼写错误文件名', () => {
  const v = makeVerify(mkdtempSync(join(tmpdir(), 'danus-vfy-')))
  const rid = v.allocateRunId('S')
  assert.equal(v.verificationPath(rid), null)
  // 先写 typo 文件名 → 被识别
  const typo = join(v.resultsRoot, rid, VERIFICATION_FILENAMES[1]!)
  writeFileSync(typo, '{}', 'utf8')
  assert.equal(v.verificationPath(rid), typo)
  // 再写主文件名 → 主文件优先
  const main = join(v.resultsRoot, rid, VERIFICATION_FILENAMES[0]!)
  writeFileSync(main, '{}', 'utf8')
  assert.equal(v.verificationPath(rid), main)
})

test('buildPrompt 含 run_id/statement/输出路径', () => {
  const v = makeVerify(mkdtempSync(join(tmpdir(), 'danus-vfy-')))
  const p = v.buildPrompt('RID', 'S(n)=n^2', 'by induction …')
  assert.match(p, /Run_id: RID\./)
  assert.match(p, /Statement: S\(n\)=n\^2\./)
  assert.match(p, /Proof:\nby induction/)
  assert.match(p, /verification\.json/)
})

// ------------------------------------------------------------------ precheck
test('预检:judge 之前拒绝(400),judge 不运行', async () => {
  const v = makeVerify(mkdtempSync(join(tmpdir(), 'danus-vfy-')))
  await withFakeDsh({}, async () => {
    await assert.rejects(v.verify('x', GOOD_PROOF), (e: VerifyError) => {
      assert.equal(e.status, 400)
      assert.match(e.detail, /vacuous statement/)
      return true
    })
    await assert.rejects(v.verify(GOOD_STATEMENT, 'QED'), (e: VerifyError) => {
      assert.equal(e.status, 400)
      assert.match(e.detail, /vacuous proof/)
      return true
    })
    await assert.rejects(v.verify(GOOD_STATEMENT, `${GOOD_PROOF} As stated in problem.md.`), (e: VerifyError) => {
      assert.equal(e.status, 400)
      assert.match(e.detail, /\[P1 on proof\]/)
      return true
    })
  })
})

// ------------------------------------------------------------- judge 全流程
test('judge accept via fake-dsh', async () => {
  const v = makeVerify(mkdtempSync(join(tmpdir(), 'danus-vfy-')))
  await withFakeDsh({}, async () => {
    const out = await v.verify(GOOD_STATEMENT, GOOD_PROOF)
    assert.equal(out.verdict, 'correct')
    const report = out.verification_report as { critical_errors: unknown[]; gaps: unknown[] }
    assert.deepEqual(report.critical_errors, [])
    assert.deepEqual(report.gaps, [])
  })
})

test('judge reject via fake-dsh([[FAKE:wrong]])', async () => {
  const v = makeVerify(mkdtempSync(join(tmpdir(), 'danus-vfy-')))
  await withFakeDsh({}, async () => {
    const out = await v.verify(GOOD_STATEMENT, `${GOOD_PROOF} [[FAKE:wrong]]`)
    assert.equal(out.verdict, 'wrong')
    assert.ok(out.repair_hints)
  })
})

test('judge 错误路径:非零退出/缺输出/坏 JSON/非 dict', async () => {
  await withFakeDsh({ FAKE_EXIT7: '1' }, async () => {
    const v = makeVerify(mkdtempSync(join(tmpdir(), 'danus-vfy-')))
    await assert.rejects(v.verify(GOOD_STATEMENT, GOOD_PROOF), (e: VerifyError) => {
      assert.equal(e.status, 500)
      assert.match(e.detail, /exit code 7/)
      return true
    })
  })
  await withFakeDsh({ FAKE_NO_OUTPUT: '1' }, async () => {
    const v = makeVerify(mkdtempSync(join(tmpdir(), 'danus-vfy-')))
    await assert.rejects(v.verify(GOOD_STATEMENT, GOOD_PROOF), (e: VerifyError) => {
      assert.equal(e.status, 500)
      assert.match(e.detail, /was not found/)
      return true
    })
  })
  await withFakeDsh({ FAKE_BAD_JSON: '1' }, async () => {
    const v = makeVerify(mkdtempSync(join(tmpdir(), 'danus-vfy-')))
    await assert.rejects(v.verify(GOOD_STATEMENT, GOOD_PROOF), (e: VerifyError) => {
      assert.equal(e.status, 500)
      assert.match(e.detail, /not valid JSON/)
      return true
    })
  })
  await withFakeDsh({ FAKE_NON_DICT: '1' }, async () => {
    const v = makeVerify(mkdtempSync(join(tmpdir(), 'danus-vfy-')))
    await assert.rejects(v.verify(GOOD_STATEMENT, GOOD_PROOF), (e: VerifyError) => {
      assert.equal(e.status, 500)
      assert.match(e.detail, /must be a JSON object/)
      return true
    })
  })
})

test('judge 超时 → 504', async () => {
  const v = new DanusVerify({
    stateDir: mkdtempSync(join(tmpdir(), 'danus-vfy-')),
    timeoutSeconds: 1,
  })
  await withFakeDsh({ FAKE_SLEEP_MS: '8000' }, async () => {
    await assert.rejects(v.verify(GOOD_STATEMENT, GOOD_PROOF), (e: VerifyError) => {
      assert.equal(e.status, 504)
      assert.match(e.detail, /timed out/)
      return true
    })
  })
})

test('agent home 预备:幂等 + 合同/skills 落地', () => {
  const v = makeVerify(mkdtempSync(join(tmpdir(), 'danus-vfy-')))
  const home = v.ensureAgentHome()
  assert.ok(existsSync(join(home, 'AGENTS.md')))
  assert.ok(existsSync(join(home, '.agents', 'skills')))
  // 幂等:二次调用不报错
  assert.equal(v.ensureAgentHome(), home)
})
