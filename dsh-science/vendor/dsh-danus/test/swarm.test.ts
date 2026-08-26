/**
 * swarm.test.ts — 移植 Danus execution/orchestration 测试的核心断言(spec §6)。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FactGraph } from '../src/core/factgraph.js'
import { DanusSwarm } from '../src/services/swarm.js'
import { parseRoles, resolveTarget, WorkerLayout, listProjects, listWorkers } from '../src/shared/layout.js'
import { targetFactIds } from '../src/shared/target.js'

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'danus-swarm-'))
}

function withAgentsRoot<T>(root: string, fn: () => T): T {
  const saved = process.env.DANUS_AGENTS_ROOT
  process.env.DANUS_AGENTS_ROOT = root
  const restore = () => {
    if (saved === undefined) delete process.env.DANUS_AGENTS_ROOT
    else process.env.DANUS_AGENTS_ROOT = saved
  }
  try {
    const out = fn()
    if (out instanceof Promise) {
      return out.finally(restore) as T
    }
    restore()
    return out
  } catch (e) {
    restore()
    throw e
  }
}

// ---------------------------------------------------------------- parse_roles
test('parse_roles:命名规则与全部拒绝形态', () => {
  assert.deepEqual(parseRoles('high:3,xhigh:4').map(([w]) => w), [
    'high', 'high2', 'high3', 'xhigh', 'xhigh2', 'xhigh3', 'xhigh4',
  ])
  assert.deepEqual(parseRoles('high:2,xhigh:1').map(([, b]) => b), ['high', 'high', 'xhigh'])
  for (const bad of ['', '   ', 'high:0', 'high', 'high:abc', ':3', '3:high']) {
    assert.throws(() => parseRoles(bad), undefined as never, `should reject: ${JSON.stringify(bad)}`)
  }
})

test('resolveTarget / list 空 root', () => {
  assert.deepEqual(resolveTarget('proj'), { project: 'proj', worker: null })
  assert.deepEqual(resolveTarget('proj/high'), { project: 'proj', worker: 'high' })
  assert.deepEqual(resolveTarget('/proj/high/'), { project: 'proj', worker: 'high' })
  withAgentsRoot(join(tmpRoot(), 'missing'), () => {
    assert.deepEqual(listProjects(), [])
  })
})

// ------------------------------------------------------------------- do_new
test('newProject:目录骨架、project.json、.role、TASK.md、status、拒重名', () => {
  const root = tmpRoot()
  withAgentsRoot(root, () => {
    const swarm = new DanusSwarm()
    const out = swarm.newProject('P', 'high:2,xhigh:1', 'gpt-5.5')
    assert.deepEqual(out.workers, ['high', 'high2', 'xhigh'])
    assert.ok(existsSync(join(out.project_dir, 'global_memory')))
    assert.ok(existsSync(join(out.project_dir, 'fact_graph')))

    const meta = JSON.parse(readFileSync(join(out.project_dir, 'project.json'), 'utf8'))
    assert.deepEqual(meta.workers, ['high', 'high2', 'xhigh'])
    assert.equal(meta.model, 'gpt-5.5')
    assert.equal(meta.roles, 'high:2,xhigh:1')

    for (const w of ['high', 'high2', 'xhigh']) {
      const wl = new WorkerLayout(join(out.project_dir, 'workers', w))
      assert.ok(existsSync(wl.localMemory))
      assert.ok(existsSync(wl.logs))
      assert.ok(existsSync(join(wl.dir, 'AGENTS.md')), 'AGENTS.md 合同')
      assert.ok(existsSync(join(wl.dir, '.agents', 'skills')), 'skills 链接')
      assert.match(readFileSync(wl.task, 'utf8'), /\(unassigned/)
      const role = readFileSync(wl.role, 'utf8')
      assert.match(role, /MODEL=gpt-5\.5/)
      assert.match(role, /DANUS_AUTHOR=/)
      const st = JSON.parse(readFileSync(wl.status, 'utf8'))
      assert.equal(st.state, 'created')
      assert.equal(st.round, 0)
    }
    // .role 的 REASONING_EFFORT 是 base role(去数字后缀)
    assert.match(readFileSync(join(out.project_dir, 'workers', 'high2', '.role'), 'utf8'), /REASONING_EFFORT=high/)

    assert.throws(() => swarm.newProject('P'), /already exists/)
    assert.deepEqual(listProjects(), ['P'])
    assert.deepEqual(listWorkers('P'), ['high', 'high2', 'xhigh'])
  })
})

// ------------------------------------------------------------------- assign
test('assign:覆盖写、校验、错误路径', () => {
  const root = tmpRoot()
  withAgentsRoot(root, () => {
    const swarm = new DanusSwarm()
    swarm.newProject('P', 'high:1')
    const out = swarm.assign('P/high', 'prove lemma 1')
    assert.ok(out.task_file.endsWith('TASK.md'))
    assert.equal(readFileSync(out.task_file, 'utf8'), 'prove lemma 1\n') // 补结尾换行
    swarm.assign('P/high', 'prove lemma 2\n')
    assert.equal(readFileSync(out.task_file, 'utf8'), 'prove lemma 2\n') // 覆盖非追加

    assert.throws(() => swarm.assign('P', 'x'), /specific worker/)
    assert.throws(() => swarm.assign('P/ghost', 'x'), /no such worker/)
    assert.throws(() => swarm.assign('P/high', '   '), /empty task/)
  })
})

// ----------------------------------------------------------------- finalize
test('finalize:建议模式不写文件;校验;去重保序;TARGET 可读回', () => {
  const root = tmpRoot()
  withAgentsRoot(root, () => {
    const swarm = new DanusSwarm()
    swarm.newProject('P', 'high:1')
    const pdir = join(root, 'P')
    const fg = new FactGraph(pdir)
    const f1 = fg.add({ problem_id: 'P', author: 'w', statement: 's1', proof: 'p1' })
    const f2 = fg.add({ problem_id: 'P', author: 'w', statement: 's2', proof: 'p2', predecessors: [f1] })

    // 建议模式:终端事实 = f2(f1 是 f2 的前驱);不写文件
    const sug = swarm.finalize('P', [])
    assert.deepEqual(sug.suggested, [f2])
    assert.ok(!existsSync(join(pdir, 'TARGET.md')))

    // 未知 id
    assert.throws(() => swarm.finalize('P', ['deadbeefdeadbeef']), /unknown fact id/)
    // 未知项目
    assert.throws(() => swarm.finalize('ghost', []), /no such project/)

    // 去重保序
    const out = swarm.finalize('P', [f1, f2, f1])
    assert.deepEqual(out.target_fact_ids, [f1, f2])
    assert.deepEqual(targetFactIds(pdir), [f1, f2])

    // 非默认 paper
    const out2 = swarm.finalize('P', [f2], 'companion')
    assert.ok(String(out2.target_file).includes(join('papers', 'companion')))
    assert.deepEqual(targetFactIds(pdir, 'companion'), [f2])
    assert.throws(() => swarm.finalize('P', [f2], 'bad/id'), /invalid paper_id|cannot finalize/)
  })
})

// ---------------------------------------------------------------- start/stop
test('start:幂等(started → already-running;locked);status label;stop', async () => {
  const root = tmpRoot()
  await withAgentsRoot(root, async () => {
    let spawnCount = 0
    const swarm = new DanusSwarm(() => {
      spawnCount += 1
      return process.pid // 伪装:用本进程 pid 充当"活" loop
    })
    swarm.newProject('P', 'high:2')

    const r1 = swarm.start('P', 0)
    assert.deepEqual(r1.map((r) => r.result), ['started', 'started'])
    assert.equal(spawnCount, 2)

    const r2 = swarm.start('P', 0)
    assert.deepEqual(r2.map((r) => r.result), ['already-running', 'already-running'])

    // status:alive + state 非 running → working(原版:alive 即 working/stuck?)
    const rows = swarm.status('P')
    assert.equal(rows.length, 2)
    assert.equal(rows[0]!.alive, true)
    assert.equal(rows[0]!.label, 'working')

    // stuck? 判定:state=running 且 round_started_at 陈旧
    const wl = new WorkerLayout(join(root, 'P', 'workers', 'high'))
    writeFileSync(wl.status, JSON.stringify({ state: 'running', round_started_at: 1 }), 'utf8')
    assert.equal(swarm.workerStatus(wl).label, 'stuck?')
    writeFileSync(wl.status, JSON.stringify({ state: 'running', round_started_at: Date.now() / 1000 }), 'utf8')
    assert.equal(swarm.workerStatus(wl).label, 'working')

    // stop(优雅):touch .stop
    const stopRows = await swarm.stop('P/high')
    assert.equal(stopRows[0]!.result, 'stopping (graceful)')
    assert.ok(existsSync(wl.stop))

    // 非运行目标
    const ghost = new WorkerLayout(join(root, 'P', 'workers', 'high2'))
    // high2 的 .pid 也指向本进程 → alive;先删 .pid 使其 not-running
    assert.equal(await swarm.stop('P/high2', false).then((r) => r[0]!.result), 'stopping (graceful)')
    void ghost

    assert.throws(() => swarm.status('nope'), /no workers/)
  })
})

test('status label:死进程的 state 映射', () => {
  const root = tmpRoot()
  withAgentsRoot(root, () => {
    const swarm = new DanusSwarm()
    swarm.newProject('P', 'high:1')
    const wl = new WorkerLayout(join(root, 'P', 'workers', 'high'))
    // 无 .pid → dead 逻辑;state created(白名单)→ created
    assert.equal(swarm.workerStatus(wl).label, 'created')
    writeFileSync(wl.status, JSON.stringify({ state: 'deadline' }), 'utf8')
    assert.equal(swarm.workerStatus(wl).label, 'deadline')
    writeFileSync(wl.status, JSON.stringify({ state: 'weird' }), 'utf8')
    assert.equal(swarm.workerStatus(wl).label, 'dead')
  })
})
