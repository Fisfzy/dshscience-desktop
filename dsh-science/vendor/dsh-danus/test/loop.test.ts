/**
 * loop.test.ts — 移植 Danus execution/tests/test_loop.py 的外循环断言。
 * runRound 注入桩;真实临时 worker 目录。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  kickoff, parseLastFactId, readRole, runLoop, writeStatus, deadlinePassed,
  type LoopDeps,
} from '../src/swarm/loop.js'
import { WorkerLayout } from '../src/shared/layout.js'

function tmpWorker(project = 'P'): WorkerLayout {
  const root = mkdtempSync(join(tmpdir(), 'danus-loop-'))
  const dir = join(root, project, 'workers', 'high')
  mkdirSync(join(dir, 'logs'), { recursive: true })
  return new WorkerLayout(dir)
}

function status(wl: WorkerLayout): Record<string, unknown> {
  return JSON.parse(readFileSync(wl.status, 'utf8'))
}

function deps(rc: number | number[], overrides: Partial<LoopDeps> = {}): LoopDeps & { calls: number } {
  const rcs = Array.isArray(rc) ? [...rc] : null
  const d: LoopDeps & { calls: number } = {
    calls: 0,
    runRound: async () => {
      d.calls++
      return rcs ? rcs.shift()! : (rc as number)
    },
    sleep: async () => {},
    terminateChild: () => {},
    ...overrides,
  }
  return d
}

function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {}
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k]
    process.env[k] = vars[k]
  }
  return fn().finally(() => {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })
}

test('kickoff 含 project/worker/TASK.md 字样', () => {
  const p = kickoff('P', 'high2')
  assert.match(p, /worker 'high2'/)
  assert.match(p, /project 'P'/)
  assert.match(p, /TASK\.md/)
  assert.match(p, /continuation round/)
})

test('.stop 预置 → 消费 + stopped + rc 0', async () => {
  const wl = tmpWorker()
  writeFileSync(wl.stop, '', 'utf8')
  const d = deps(0)
  const rc = await runLoop(wl, d)
  assert.equal(rc, 0)
  assert.equal(status(wl).state, 'stopped')
  assert.ok(!existsSync(wl.stop)) // 被消费
  assert.equal(d.calls, 0) // 一轮都没跑
})

test('.run_deadline 过期 → deadline', async () => {
  const wl = tmpWorker()
  writeFileSync(join(wl.projectDir, '.run_deadline'), '1', 'utf8')
  const d = deps(0)
  const rc = await runLoop(wl, d)
  assert.equal(rc, 0)
  assert.equal(status(wl).state, 'deadline')
  assert.equal(d.calls, 0)
})

test('deadlinePassed:垃圾内容按未过期', () => {
  const wl = tmpWorker()
  writeFileSync(join(wl.projectDir, '.run_deadline'), 'garbage', 'utf8')
  assert.equal(deadlinePassed(wl.projectDir), false)
})

test('MAX_ROUNDS=2 → 恰 2 轮 + max_rounds + last_rc', async () => {
  const wl = tmpWorker()
  const d = deps(0)
  await withEnv({ DANUS_MAX_ROUNDS: '2', DANUS_ROUND_BEAT: '0' }, async () => {
    const rc = await runLoop(wl, d)
    assert.equal(rc, 0)
  })
  assert.equal(d.calls, 2)
  const st = status(wl)
  assert.equal(st.state, 'max_rounds')
  assert.equal(st.round, 2)
  assert.equal(st.last_rc, 0)
})

test('连续失败上限 → rc 1 + error;rc=124 中性不计失败', async () => {
  const wl = tmpWorker()
  const d = deps([5, 5, 5]) // 三次连续失败
  await withEnv({ DANUS_MAX_CONSEC_FAILURES: '3', DANUS_ROUND_BEAT: '0' }, async () => {
    const rc = await runLoop(wl, d)
    assert.equal(rc, 1)
  })
  const st = status(wl)
  assert.equal(st.state, 'error')
  assert.match(String(st.error), /consecutive failed rounds/)

  // 124(硬超时)重置计数:124,124,5,124 → 不触发(上限 2 也达不到,因为 124 打断)
  const wl2 = tmpWorker('P2')
  const d2 = deps([124, 124, 5, 124])
  await withEnv({ DANUS_MAX_CONSEC_FAILURES: '2', DANUS_MAX_ROUNDS: '4', DANUS_ROUND_BEAT: '0' }, async () => {
    const rc = await runLoop(wl2, d2)
    assert.equal(rc, 0) // 被 max_rounds 兜住,而非失败
  })
  assert.equal(status(wl2).state, 'max_rounds')
})

test('rc=127 → 短路返回 127 + error', async () => {
  const wl = tmpWorker()
  const d = deps(127)
  await withEnv({ DANUS_ROUND_BEAT: '0' }, async () => {
    const rc = await runLoop(wl, d)
    assert.equal(rc, 127)
  })
  assert.equal(status(wl).state, 'error')
  assert.match(String(status(wl).error), /not found/)
})

test('坏 worker dir → rc 2', async () => {
  const wl = new WorkerLayout(join(tmpdir(), 'definitely-missing', 'workers', 'x'))
  const d = deps(0)
  const rc = await runLoop(wl, d)
  assert.equal(rc, 2)
})

test('parseLastFactId / writeStatus 合并 / readRole', () => {
  const wl = tmpWorker()
  writeFileSync(join(wl.logs, 'round_1.log'), 'bla "fact_id": "0123456789abcdef" then fact_id=ffffffffffffffff', 'utf8')
  assert.equal(parseLastFactId(join(wl.logs, 'round_1.log')), 'ffffffffffffffff')
  assert.equal(parseLastFactId(join(wl.logs, 'missing.log')), null)

  // writeStatus:合并而非覆盖;损坏旧文件恢复
  writeFileSync(wl.status, '{not json', 'utf8')
  writeStatus(wl, { state: 'running', round: 1 })
  const st1 = status(wl)
  assert.equal(st1.state, 'running')
  writeStatus(wl, { state: 'idle' })
  const st2 = status(wl)
  assert.equal(st2.round, 1) // 旧字段保留
  assert.equal(st2.state, 'idle')
  assert.equal(st2.worker, 'high')
  assert.equal(st2.pid, process.pid)

  // readRole:默认 + 文件覆盖
  const r0 = readRole(wl, 'default-model')
  assert.equal(r0.MODEL, 'default-model')
  assert.equal(r0.DANUS_AUTHOR, 'high')
  writeFileSync(wl.role, '# comment\nMODEL=m-x\nREASONING_EFFORT=xhigh\n\nROLE=xhigh\n', 'utf8')
  const r1 = readRole(wl, 'default-model')
  assert.equal(r1.MODEL, 'm-x')
  assert.equal(r1.REASONING_EFFORT, 'xhigh')
})
