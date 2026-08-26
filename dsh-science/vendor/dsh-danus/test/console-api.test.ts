/**
 * console-api.test.ts — Danus Console 操作路由(workers/log/export/assign/gm/revoke)。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FactGraph } from '../src/core/factgraph.ts'
import { GlobalMemory } from '../src/core/global-memory.ts'
import { DanusSwarm } from '../src/services/swarm.ts'
import { registerConsoleRoutes } from '../src/plugins/console-api.ts'

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'danus-console-'))
  process.env.DANUS_AGENTS_ROOT = root // swarm 的布局层与路由共用同一根
  const routes = new Map<string, { kind: string; handler: (req: unknown, res: unknown) => unknown }>()
  const swarm = new DanusSwarm(() => process.pid)
  const ctx = { danusSwarm: swarm, effect: (fn: () => unknown) => fn() }
  registerConsoleRoutes(ctx as never, {
    register: (r: { path: string; kind: string; handler: never }) => routes.set(r.path, r as never),
  } as never, { agentsRoot: root })
  swarm.newProject('P', 'high:1')
  return { root, routes, swarm }
}

interface MockRes {
  statusCode?: number
  body?: string
  headers: Record<string, string>
  setHeader(k: string, v: string): void
  end(v?: string): void
}

function mockRes(): MockRes {
  const r: MockRes = {
    headers: {},
    setHeader(k: string, v: string) {
      r.headers[k] = v
    },
    end(v?: string) {
      r.body = v
    },
  }
  return r
}

async function call(
  h: (req: unknown, res: unknown) => unknown,
  u: string,
  b?: Record<string, unknown>,
): Promise<MockRes> {
  const res = mockRes()
  const req = b
    ? { url: u, async *[Symbol.asyncIterator]() { yield JSON.stringify(b) } }
    : { url: u }
  await h(req, res)
  return res
}

test('workers:全项目总览 + 指定项目状态', async () => {
  const { routes } = setup()
  const h = routes.get('/danus/api/workers')!.handler
  const all = await call(h, '/danus/api/workers')
  const parsed = JSON.parse(all.body!)
  assert.equal(parsed.projects.length, 1)
  assert.equal(parsed.projects[0].project, 'P')

  const one = await call(h, '/danus/api/workers?project=P')
  const p2 = JSON.parse(one.body!)
  assert.equal(p2.workers.length, 1)
  assert.equal(p2.workers[0].worker, 'high')

  const bad = await call(h, '/danus/api/workers?project=../evil')
  assert.equal(bad.statusCode, 400)
})

test('worker-log:无日志空结构;有日志取 tail', async () => {
  const { root, routes } = setup()
  const h = routes.get('/danus/api/worker-log')!.handler
  const empty = await call(h, '/danus/api/worker-log?project=P&worker=high')
  assert.deepEqual(JSON.parse(empty.body!).lines, [])

  const logsDir = join(root, 'P', 'workers', 'high', 'logs')
  mkdirSync(logsDir, { recursive: true })
  writeFileSync(join(logsDir, 'round_1.log'), 'l1\nl2\nl3\n', 'utf8')
  const out = await call(h, '/danus/api/worker-log?project=P&worker=high&tail=2')
  const parsed = JSON.parse(out.body!)
  assert.equal(parsed.round, 'round_1.log')
  assert.deepEqual(parsed.lines, ['l2', 'l3'])
})

test('export:json bundle + markdown 合集', async () => {
  const { root, routes } = setup()
  const fg = new FactGraph(join(root, 'P'))
  const f1 = fg.add({ problem_id: 'P', author: 'w', statement: 's1', proof: 'p1' })

  const h = routes.get('/danus/api/export')!.handler
  const js = await call(h, '/danus/api/export?project=P&format=json')
  const parsed = JSON.parse(js.body!)
  assert.equal(parsed.count, 1)
  assert.equal(parsed.facts[0].fact_id, f1)

  const md = await call(h, '/danus/api/export?project=P&format=md')
  assert.ok(md.body!.includes('## statement'))
  assert.ok(md.headers['Content-Disposition']!.includes('-facts.md'))
})

test('assign/start/stop 转发', async () => {
  const { routes, root } = setup()
  const assign = await call(routes.get('/danus/api/assign')!.handler, '/danus/api/assign', {
    project: 'P', worker: 'high', task: 'prove it',
  })
  assert.equal(JSON.parse(assign.body!).ok, true)
  assert.match(readFileSync(join(root, 'P', 'workers', 'high', 'TASK.md'), 'utf8'), /prove it/)

  const start = await call(routes.get('/danus/api/worker/start')!.handler, '/danus/api/worker/start', {
    target: 'P/high',
  })
  assert.equal(JSON.parse(start.body!).results[0].result, 'started')

  const stop = await call(routes.get('/danus/api/worker/stop')!.handler, '/danus/api/worker/stop', {
    target: 'P/high',
  })
  assert.equal(JSON.parse(stop.body!).results[0].result, 'stopping (graceful)')
})

test('gm/add + gm/status(假设管理)', async () => {
  const { root, routes } = setup()
  const add = await call(routes.get('/danus/api/gm/add')!.handler, '/danus/api/gm/add?project=P', {
    kind: 'direction', claim: 'try induction on the even case', evidence: '',
  })
  const id = JSON.parse(add.body!).id as string
  assert.ok(id)

  const st = await call(routes.get('/danus/api/gm/status')!.handler, '/danus/api/gm/status?project=P', {
    id, status: 'supported',
  })
  assert.equal(JSON.parse(st.body!).ok, true)
  const entry = new GlobalMemory(join(root, 'P')).read('direction')[0]!
  assert.equal(entry.status, 'supported')
})

test('fact/revoke 级联', async () => {
  const { root, routes } = setup()
  const fg = new FactGraph(join(root, 'P'))
  const base = fg.add({ problem_id: 'P', author: 'w', statement: 'A', proof: 'pa' })
  const child = fg.add({ problem_id: 'P', author: 'w', statement: 'B', proof: 'pb', predecessors: [base] })

  const out = await call(routes.get('/danus/api/fact/revoke')!.handler, '/danus/api/fact/revoke?project=P', {
    fact_id: base, reason: 'wrong premise',
  })
  const parsed = JSON.parse(out.body!)
  assert.deepEqual(new Set(parsed.revoked), new Set([base, child]))
  assert.ok(!fg.exists(base))
})
