/**
 * gateway.test.ts — 移植 Danus gateway/tests/test_gateway.py 的行为断言。
 * 用假 ctx(捕获工具注册)+ stub danusVerify;真实临时项目目录。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FactGraph } from '../src/core/factgraph.js'
import { GlobalMemory } from '../src/core/global-memory.js'
import { ALL_TOOLS, ROLE_TOOLS, toolsFor, apply as gatewayApply } from '../src/plugins/gateway.js'

// ---------------------------------------------------------------- fake ctx
interface RegisteredTool {
  name: string
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown
}

function fakeCtx(verifyStub?: unknown): {
  ctx: Parameters<typeof gatewayApply>[0]
  tools: Map<string, RegisteredTool>
} {
  const tools = new Map<string, RegisteredTool>()
  const ctx = {
    tools: { register: (d: RegisteredTool) => tools.set(d.name, d) },
    get(name: string): unknown {
      if (name === 'danusVerify') return verifyStub
      return undefined
    },
  }
  return { ctx: ctx as never, tools }
}

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), 'danus-gw-'))
}

const GOOD_STATEMENT = 'For every n, the sum of the first n odd numbers equals n^2.'
const GOOD_PROOF =
  'By induction on n. Base n = 1 is immediate. The step adds the next odd number 2n + 1 ' +
  'to both sides and completes the square, finishing the induction.'

// ------------------------------------------------------------- 角色表(parity)
test('role table: main 无 fact_submit;verifier 只读;未知 fail-closed', () => {
  assert.ok(!ROLE_TOOLS.main.includes('fact_submit'))
  assert.ok(ROLE_TOOLS.main.includes('fact_revoke'))
  assert.deepEqual(ROLE_TOOLS.verifier, ['search_arxiv_theorems'])
  assert.ok(ROLE_TOOLS.worker.includes('fact_submit'))
  for (const r of ['worker', 'main', 'verifier'] as const) {
    assert.ok(ROLE_TOOLS[r].includes('search_arxiv_theorems'))
  }
  assert.deepEqual(toolsFor('nope'), toolsFor('verifier'))
  assert.ok(!toolsFor('nope').includes('fact_submit'))
  assert.ok(!toolsFor('nope').includes('gm_add'))
  assert.equal(ALL_TOOLS.length, 6)
})

test('角色门控:注册的工具物理上只有该角色可见集', () => {
  const dir = tmpProject()
  for (const [role, expected] of Object.entries({
    worker: ROLE_TOOLS.worker,
    main: ROLE_TOOLS.main,
    verifier: ROLE_TOOLS.verifier,
    all: ALL_TOOLS,
    nope: ROLE_TOOLS.verifier, // fail-closed
  })) {
    const { ctx, tools } = fakeCtx()
    gatewayApply(ctx, { role: role as never, projectDir: dir })
    assert.deepEqual([...tools.keys()].sort(), [...expected].sort())
  }
})

// ----------------------------------------------------------- gm / fact_search
test('gm_add/gm_search/fact_search 跨临时项目', async () => {
  const dir = tmpProject()
  const { ctx, tools } = fakeCtx()
  gatewayApply(ctx, { role: 'worker', projectDir: dir, author: 'w1' })

  const out = (await tools.get('gm_add')!.execute({
    kind: 'plan', claim: 'reduce to q>=2 case', evidence: '',
  })) as Record<string, unknown>
  assert.equal(out.kind, 'plan')
  assert.ok(out.id)

  const hits = (await tools.get('gm_search')!.execute({ query: 'reduce' })) as never as {
    results_by_kind: Record<string, { count: number }>
  }
  assert.equal(hits.results_by_kind['plan']!.count, 1)

  const fs = (await tools.get('fact_search')!.execute({ query: 'anything' })) as { results: unknown[] }
  assert.deepEqual(fs.results, []) // 空图良好结构
})

// ------------------------------------------------------------- fact_submit
function stubVerify(payload: unknown): { verify: () => Promise<unknown> } {
  return {
    verify: async () => {
      if (payload instanceof Error) throw payload
      return payload
    },
  }
}

test('fact_submit accept:写 fact + trace verification', async () => {
  const dir = tmpProject()
  const { ctx, tools } = fakeCtx(
    stubVerify({ verdict: 'correct', repair_hints: '', verification_report: { summary: 'ok', critical_errors: [], gaps: [] } }),
  )
  gatewayApply(ctx, { role: 'worker', projectDir: dir, author: 'w1' })

  const res = (await tools.get('fact_submit')!.execute({
    statement: GOOD_STATEMENT, proof: GOOD_PROOF,
  })) as Record<string, unknown>
  assert.equal(res.accepted, true)
  assert.ok(res.fact_id)
  assert.ok(new FactGraph(dir).exists(String(res.fact_id)))
  const traces = new GlobalMemory(dir).read('verification')
  assert.equal(traces.at(-1)!['verdict'], 'correct')
  assert.equal(traces.at(-1)!.fact_id, res.fact_id)
})

test('fact_submit reject:什么都不写但 trace', async () => {
  const dir = tmpProject()
  const { ctx, tools } = fakeCtx(
    stubVerify({ verdict: 'wrong', repair_hints: 'gap in step 2', verification_report: null }),
  )
  gatewayApply(ctx, { role: 'worker', projectDir: dir, author: 'w1' })

  const res = (await tools.get('fact_submit')!.execute({
    statement: GOOD_STATEMENT, proof: GOOD_PROOF,
  })) as Record<string, unknown>
  assert.equal(res.accepted, false)
  assert.equal(res.verdict, 'wrong')
  assert.equal(res.repair_hints, 'gap in step 2')
  assert.deepEqual(new FactGraph(dir).list(), [])
  assert.equal(new GlobalMemory(dir).read('verification').at(-1)!['verdict'], 'wrong')
})

test('fact_submit verify 错误:干净信封,不写不 trace', async () => {
  const dir = tmpProject()
  const { ctx, tools } = fakeCtx(stubVerify(new Error('service down')))
  gatewayApply(ctx, { role: 'worker', projectDir: dir, author: 'w1' })

  const res = (await tools.get('fact_submit')!.execute({
    statement: GOOD_STATEMENT, proof: GOOD_PROOF,
  })) as Record<string, unknown>
  assert.equal(res.accepted, false)
  assert.equal(res.verdict, 'error')
  assert.match(String(res.error), /service down/)
  assert.deepEqual(new FactGraph(dir).list(), [])
  assert.deepEqual(new GlobalMemory(dir).read('verification'), [])
})

test('fact_submit accept 但写失败(前驱被撤销):仍 trace correct', async () => {
  const dir = tmpProject()
  const fg = new FactGraph(dir)
  const base = fg.add({ problem_id: 'p', author: 'w', statement: 'base s', proof: 'base p' })
  fg.revoke(base, 'wrong')

  const { ctx, tools } = fakeCtx(stubVerify({ verdict: 'correct', repair_hints: '', verification_report: null }))
  gatewayApply(ctx, { role: 'worker', projectDir: dir, author: 'w1' })

  const res = (await tools.get('fact_submit')!.execute({
    statement: GOOD_STATEMENT, proof: GOOD_PROOF, predecessors: [base],
  })) as Record<string, unknown>
  assert.equal(res.accepted, true)
  assert.equal(res.fact_id, null)
  assert.ok(res.write_error)
  const traces = new GlobalMemory(dir).read('verification')
  assert.equal(traces.at(-1)!['verdict'], 'correct') // verdict 仍被 trace
})

test('fact_submit 未挂 verify 服务:error 信封(等价 DANUS_VERIFY_URL 未接)', async () => {
  const dir = tmpProject()
  const { ctx, tools } = fakeCtx(undefined)
  gatewayApply(ctx, { role: 'worker', projectDir: dir })
  const res = (await tools.get('fact_submit')!.execute({
    statement: GOOD_STATEMENT, proof: GOOD_PROOF,
  })) as Record<string, unknown>
  assert.equal(res.accepted, false)
  assert.equal(res.verdict, 'error')
  assert.match(String(res.error), /not wired yet/)
})

// ------------------------------------------------------------ project 解析
test('project 按名寻址 + 校验(agentsRoot)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'danus-root-'))
  const { mkdirSync } = await import('node:fs')
  mkdirSync(join(root, 'proj_a'), { recursive: true })

  const { ctx, tools } = fakeCtx()
  gatewayApply(ctx, { role: 'main', agentsRoot: root, author: 'main_agent' })

  const out = (await tools.get('gm_add')!.execute({
    kind: 'master_guidance', claim: 'focus on route A', project: 'proj_a',
  })) as Record<string, unknown>
  assert.ok(out.id)
  assert.ok(new GlobalMemory(join(root, 'proj_a')).read('master_guidance').length > 0)

  for (const bad of ['../evil', 'a/b', '', '/abs']) {
    await assert.rejects(
      async () => tools.get('gm_add')!.execute({ kind: 'plan', claim: 'x', project: bad }),
      /invalid project name|no such project/,
    )
  }
  await assert.rejects(
    async () => tools.get('gm_add')!.execute({ kind: 'plan', claim: 'x', project: 'missing' }),
    /no such project/,
  )
})

test('给了 project 但无 agentsRoot → 响亮错误', async () => {
  const saved = process.env.DANUS_AGENTS_ROOT
  delete process.env.DANUS_AGENTS_ROOT
  try {
    const { ctx, tools } = fakeCtx()
    gatewayApply(ctx, { role: 'main' })
    await assert.rejects(
      async () => tools.get('gm_add')!.execute({ kind: 'plan', claim: 'x', project: 'p1' }),
      /DANUS_AGENTS_ROOT/,
    )
  } finally {
    if (saved !== undefined) process.env.DANUS_AGENTS_ROOT = saved
  }
})

// ------------------------------------------------------------ fact_revoke
test('fact_revoke 级联', async () => {
  const dir = tmpProject()
  const fg = new FactGraph(dir)
  const base = fg.add({ problem_id: 'p', author: 'w', statement: 'A', proof: 'pa' })
  const child = fg.add({ problem_id: 'p', author: 'w', statement: 'B', proof: 'pb', predecessors: [base] })

  const { ctx, tools } = fakeCtx()
  gatewayApply(ctx, { role: 'main', projectDir: dir })
  const out = (await tools.get('fact_revoke')!.execute({ fact_id: base, reason: 'wrong' })) as {
    revoked: string[]
  }
  assert.deepEqual(new Set(out.revoked), new Set([base, child]))
  assert.ok(!fg.exists(base))
  assert.ok(!fg.exists(child))
})
