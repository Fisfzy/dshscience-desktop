/**
 * observability.test.ts — 移植 Danus observability/tests/{test_observability,test_main}.py
 * 与 spec §7.5 的断言。用内存夹具目录。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CHANNELS, buildChannel, buildChannels, buildFactgraph, buildOverview,
  indexPageHtml, registerRoutes,
} from '../src/plugins/observability.js'

function makeObsProject(): string {
  const proj = mkdtempSync(join(tmpdir(), 'danus-obsv-'))
  const facts = join(proj, 'fact_graph', 'facts')
  mkdirSync(facts, { recursive: true })
  mkdirSync(join(proj, 'global_memory'), { recursive: true })

  writeFileSync(join(facts, 'fact_a.md'),
    '---\nfact_id: fact_a\nproblem_id: p\nauthor: alice\npredecessors: []\n---\n\n## statement\nA.\n## proof\nAp.\n## intuition\nAi.\n', 'utf8')
  writeFileSync(join(facts, 'fact_b.md'),
    '---\nfact_id: fact_b\nproblem_id: p\nauthor: alice\npredecessors: [fact_a]\n---\n\n## statement\nB.\n## proof\nBp.\n', 'utf8')
  writeFileSync(join(facts, 'fact_c.md'),
    '---\nfact_id: fact_c\nproblem_id: p\nauthor: bob\npredecessors: [fact_b]\n---\n\n## statement\nC.\n## proof\nCp.\n', 'utf8')
  // 无 fact_id → 文件名 stem 回退,作者用默认 ''
  writeFileSync(join(facts, 'fact_d.md'),
    '---\nproblem_id: p\npredecessors: []\n---\n\n## statement\nD.\n## proof\nDp.\n', 'utf8')

  // plan 通道:2 有效 + 1 空 + 1 坏行 跳过
  writeFileSync(join(proj, 'global_memory', 'plan.jsonl'),
    '{"id":1,"claim":"plan A","timestamp_utc":"2024-01-01T00:00:00Z"}\n' +
    '\n' +
    '{not json\n' +
    '{"id":2,"claim":"plan B","timestamp_utc":"2024-01-02T00:00:00Z"}\n', 'utf8')

  // verification:correct + wrong
  writeFileSync(join(proj, 'global_memory', 'verification.jsonl'),
    '{"id":1,"verdict":"correct"}\n{"id":2,"verdict":"wrong"}\n', 'utf8')
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

// ========================================================================== //
// overview                                                                    //
// ========================================================================== //

test('overview:计数(3 种子 + 1 文件名 stem 回退),facts_with_predecessors==2,facts_by_author,plan 空/坏行跳过->2,verdicts', () => {
  const proj = makeObsProject()
  const o = buildOverview(proj) as { project: string; facts: number; facts_with_predecessors: number; facts_by_author: Record<string, number>; channel_counts: Record<string, number>; verdicts: Record<string, number> }
  assert.equal(o.facts, 4)
  assert.equal(o.facts_with_predecessors, 2)
  assert.equal(o.facts_by_author['alice'], 2)
  assert.equal(o.facts_by_author['bob'], 1)
  assert.equal(o.facts_by_author[''], 1)
  assert.equal(o.channel_counts['plan'], 2)
  assert.deepEqual(o.verdicts, { correct: 1, wrong: 1 })
})

// ========================================================================== //
// factgraph                                                                   //
// ========================================================================== //

test('factgraph:depth 0/1/2、max_depth==2、边 2 条、section body 保留', () => {
  const proj = makeObsProject()
  const g = buildFactgraph(proj) as { nodes: any[]; edges: any[]; max_depth: number }
  assert.equal(g.max_depth, 2)
  assert.equal(g.edges.length, 2)
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  assert.equal(byId.get('fact_a')!.depth, 0)
  assert.equal(byId.get('fact_b')!.depth, 1)
  assert.equal(byId.get('fact_c')!.depth, 2)
  assert.ok(byId.get('fact_a')!.statement.includes('A.'))
  assert.ok(byId.get('fact_b')!.proof.includes('Bp.'))
})

// ========================================================================== //
// channels                                                                    //
// ========================================================================== //

test('channels:11 kinds,plan role=judgment;channel 最新在前;未知 kind 抛', () => {
  const proj = makeObsProject()
  const c = buildChannels(proj) as { channels: { kind: string; role: string; count: number }[] }
  assert.equal(c.channels.length, 11)
  const plan = c.channels.find((x) => x.kind === 'plan')!
  assert.equal(plan.role, 'judgment')
  assert.equal(plan.count, 2)

  const ch = buildChannel('plan', proj) as { count: number; entries: any[] }
  assert.equal(ch.count, 2)
  assert.equal(ch.entries[0]!.claim, 'plan B') // 最新在前(降序)
  assert.throws(() => buildChannel('bogus', proj), /unknown channel/)
})

// ========================================================================== //
// 缺失目录容忍 / 环防护                                                       //
// ========================================================================== //

test('缺失目录容忍:空 facts、空 nodes、空 entries', () => {
  const proj = mkdtempSync(join(tmpdir(), 'danus-obsv-empty-'))
  const o = buildOverview(proj) as { facts: number; channel_counts: Record<string, number> }
  assert.equal(o.facts, 0)
  const g = buildFactgraph(proj) as { nodes: any[]; edges: any[]; max_depth: number }
  assert.deepEqual(g.nodes, [])
  assert.deepEqual(g.edges, [])
  assert.equal(g.max_depth, 0)
  const ch = buildChannel('plan', proj) as { entries: any[]; count: number }
  assert.deepEqual(ch.entries, [])
  assert.equal(ch.count, 0)
})

test('环防护:互指 predecessors 不 hang/raise', () => {
  const proj = mkdtempSync(join(tmpdir(), 'danus-obsv-cycle-'))
  const facts = join(proj, 'fact_graph', 'facts')
  mkdirSync(facts, { recursive: true })
  writeFileSync(join(facts, 'x.md'), '---\nfact_id: x\npredecessors: [y]\n---\n\n## statement\nX.\n', 'utf8')
  writeFileSync(join(facts, 'y.md'), '---\nfact_id: y\npredecessors: [x]\n---\n\n## statement\nY.\n', 'utf8')
  const g = buildFactgraph(proj) as { nodes: any[]; max_depth: number }
  assert.equal(g.nodes.length, 2)
  assert.equal(typeof g.max_depth, 'number')
})

// ========================================================================== //
// HTTP 路由                                                                   //
// ========================================================================== //

interface MockRes {
  body?: string
  statusCode?: number
  setHeader(k: string, v: string): void
  end(v?: string): void
  json(v: unknown): void
}
function makeMockRes(): MockRes {
  const res: MockRes = {
    body: undefined,
    setHeader() {},
    end(v) { res.body = v },
    json(v) { res.body = JSON.stringify(v) },
  }
  return res
}

test('HTTP 路由:registerRoutes 挂 5 路;overview 200;未知 channel 404;index 含 Danus', () => {
  const proj = makeObsProject()
  const routes: any[] = []
  registerRoutes({ register(r: any) { routes.push(r) } }, proj)
  assert.equal(routes.length, 5)

  const find = (path: string) => routes.find((r) => r.path === path)!
  // overview
  const res1 = makeMockRes()
  find('/danus/api/overview').handler({}, res1)
  assert.equal(typeof JSON.parse(res1.body!).facts, 'number')
  const res1b = makeMockRes(); find('/danus/api/channels').handler({}, res1b)
  assert.equal(JSON.parse(res1b.body!).channels.length, 11)
  const resG = makeMockRes(); find('/danus/api/factgraph').handler({}, resG)
  assert.ok(JSON.parse(resG.body!).nodes.length === 4)

  // index 页面含 Danus
  const resIdx = makeMockRes()
  find('/danus').handler({}, resIdx)
  assert.ok(resIdx.body!.includes('Danus'))
  assert.ok(indexPageHtml().includes('Danus'))

  // 未知 channel → 404(res.statusCode);prefix 路由从 req.url 提取 kind
  const channelRoute = routes.find((r) => r.kind === 'prefix' && r.path === '/danus/api/channel/')!
  const res404 = makeMockRes()
  channelRoute.handler({ url: '/danus/api/channel/bogus' }, res404)
  assert.equal(res404.statusCode, 404)
  assert.ok(res404.body!.includes('unknown channel'))

  // 已知 channel → 200
  const resCh = makeMockRes()
  channelRoute.handler({ url: '/danus/api/channel/plan' }, resCh)
  assert.equal(resCh.statusCode, undefined)
  assert.equal(JSON.parse(resCh.body!).kind, 'plan')
})

// ========================================================================== //
// config                                                                      //
// ========================================================================== //

test('_project_dir 未设 → RuntimeError', () => {
  const restore = env({})
  try {
    delete process.env.DANUS_DASHBOARD_PROJECT
    delete process.env.DANUS_PROJECT_DIR
    assert.throws(() => buildOverview(), /no project dir/)
  } finally { restore() }
})

test('CHANNELS 常量:11 kinds + 角色标签', () => {
  assert.equal(CHANNELS.length, 11)
  const kinds = new Set(CHANNELS.map(([k]) => k))
  for (const k of ['conclusion', 'example', 'counterexample', 'proof_attempt', 'plan', 'direction', 'obstacle', 'dead_end', 'verification', 'elaboration', 'master_guidance']) {
    assert.ok(kinds.has(k), `missing kind ${k}`)
  }
  assert.equal(CHANNELS.find(([k]) => k === 'plan')![1], 'judgment')
  assert.equal(CHANNELS.find(([k]) => k === 'verification')![1], 'verify')
  assert.equal(CHANNELS.find(([k]) => k === 'master_guidance')![1], 'strategy')
})
