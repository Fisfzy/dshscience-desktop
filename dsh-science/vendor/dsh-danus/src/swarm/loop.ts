/**
 * swarm/loop.ts — 每 worker 自治外循环(轮驱动)。移植自 danus/execution/loop.py。
 *
 * 每轮 = 一次 headless dsh 会话,从持久化记忆续跑(不是一次增量)。
 * 停止条件:.stop 旗标(优雅,轮边界)、项目 .run_deadline、DANUS_MAX_ROUNDS、
 * 连续失败上限。进程监督细节在 spawn.ts;本模块逻辑可注入 runRound 测试。
 */

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { envInt } from '../shared/env.ts'
import { atomicWrite } from '../core/util.ts'
import { DEADLINE_FILE, WorkerLayout } from '../shared/layout.ts'

const FACT_ID_RE = /"?fact_id"?\s*[:=]\s*"?([0-9a-f]{16})"?/g

/** 轮 kickoff prompt(逐字移植原版 kickoff)。 */
export function kickoff(project: string, worker: string): string {
  return (
    `You are worker '${worker}' on project '${project}'. Continue solving the ` +
    `problem (this is a continuation round, not a fresh start).\n` +
    `1. Read TASK.md — your current assignment (which direction/subgoal is yours).\n` +
    `2. Follow AGENTS.md (worker.md) exactly — your standing contract (the adaptive ` +
    `control loop, memory discipline, the fact_submit gate). Drive toward a full ` +
    `verified result.\n` +
    `3. Resume from state: gm_search relevant findings + dead ends, read the fact ` +
    `graph and the latest master_guidance — DO NOT restart from zero; build on what ` +
    `is already there.\n` +
    `4. Keep going: assess -> pick skills adaptively -> act -> persist, repeatedly. ` +
    `An open problem is not a reason to stop. Do NOT finalize prematurely.\n` +
    `5. Persist as you go: rough progress to local memory; shareable findings via ` +
    `gm_add; any verified result via fact_submit.`
  )
}

export interface RoleConfig {
  MODEL: string
  REASONING_EFFORT: string
  ROLE: string
  DANUS_AUTHOR: string
  [k: string]: string
}

/** .role 读取:默认值被文件值覆盖(逐行 KEY=VALUE,跳过空行/# 注释)。 */
export function readRole(wl: WorkerLayout, defaultModel: string): RoleConfig {
  const out: RoleConfig = {
    MODEL: defaultModel,
    REASONING_EFFORT: 'high',
    ROLE: 'high',
    DANUS_AUTHOR: wl.name,
  }
  if (!existsSync(wl.role)) return out
  for (const rawLine of readFileSync(wl.role, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const i = line.indexOf('=')
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

/** 原子状态写:合并旧值,强制 worker/pid/updated_at。 */
export function writeStatus(wl: WorkerLayout, fields: Record<string, unknown>): void {
  let cur: Record<string, unknown> = {}
  if (existsSync(wl.status)) {
    try {
      cur = JSON.parse(readFileSync(wl.status, 'utf8'))
    } catch {
      cur = {}
    }
  }
  Object.assign(cur, fields)
  cur.worker = wl.name
  cur.pid = process.pid
  cur.updated_at = Date.now() / 1000
  atomicWrite(wl.status, JSON.stringify(cur, null, 2))
}

/** .run_deadline:不存在/垃圾内容 → 未过期。 */
export function deadlinePassed(projectDir: string): boolean {
  const f = join(projectDir, DEADLINE_FILE)
  if (!existsSync(f)) return false
  try {
    return Date.now() / 1000 >= Number.parseFloat(readFileSync(f, 'utf8').trim())
  } catch {
    return false
  }
}

/** 从轮日志抓最后一个 fact_id(读失败 → null)。 */
export function parseLastFactId(logPath: string): string | null {
  let text: string
  try {
    text = readFileSync(logPath, 'utf8')
  } catch {
    return null
  }
  let last: string | null = null
  for (const m of text.matchAll(FACT_ID_RE)) last = m[1]!
  return last
}

export interface LoopEnv {
  beatSec: number
  hardTimeoutSec: number
  maxRounds: number
  maxConsecFailures: number
}

export function loopEnv(): LoopEnv {
  return {
    beatSec: Number(process.env.DANUS_ROUND_BEAT ?? '5') || 0,
    hardTimeoutSec: envInt('DANUS_ROUND_HARD_TIMEOUT', 14400),
    maxRounds: envInt('DANUS_MAX_ROUNDS', 0),
    maxConsecFailures: envInt('DANUS_MAX_CONSEC_FAILURES', 5),
  }
}

export interface LoopDeps {
  /** 执行一轮;返回进程退出码(124=硬超时,127=runner 缺失)。 */
  runRound: (round: number, logPath: string, hardTimeoutSec: number) => Promise<number>
  sleep: (ms: number) => Promise<void>
  /** SIGTERM 时终止在飞子进程。 */
  terminateChild: () => void
}

/**
 * 外循环主程序。返回进程退出码:
 * 0 = 正常停(.stop/deadline/max_rounds);1 = 连续失败;127 = runner 缺失;2 = 目录不存在。
 */
export async function runLoop(wl: WorkerLayout, deps: LoopDeps): Promise<number> {
  if (!existsSync(wl.dir)) {
    console.error(`worker dir not found: ${wl.dir}`)
    return 2
  }
  const env = loopEnv()
  const prompt = kickoff(wl.project, wl.name)

  const onTerm = () => {
    deps.terminateChild()
    writeStatus(wl, { state: 'terminated' })
    cleanupPid(wl)
    process.exit(0)
  }
  process.on('SIGTERM', onTerm)

  writeStatus(wl, { state: 'running', round: 0, started_at: Date.now() / 1000 })
  let rnd = 0
  let consecFail = 0
  try {
    for (;;) {
      if (existsSync(wl.stop)) {
        try {
          rmSync(wl.stop, { force: true }) // 消费 .stop
        } catch { /* ignore */ }
        writeStatus(wl, { state: 'stopped' })
        break
      }
      if (deadlinePassed(wl.projectDir)) {
        writeStatus(wl, { state: 'deadline' })
        break
      }
      if (env.maxRounds && rnd >= env.maxRounds) {
        writeStatus(wl, { state: 'max_rounds' })
        break
      }

      rnd += 1
      const logPath = join(wl.logs, `round_${rnd}.log`)
      writeStatus(wl, { state: 'running', round: rnd, round_started_at: Date.now() / 1000 })
      const rc = await deps.runRound(rnd, logPath, env.hardTimeoutSec)
      writeStatus(wl, {
        state: 'idle',
        round: rnd,
        last_round_at: Date.now() / 1000,
        last_rc: rc,
        last_fact_id: parseLastFactId(logPath),
      })

      if (rc === 127) {
        // runner 缺失 —— 不空转
        writeStatus(wl, { state: 'error', error: 'dsh binary not found' })
        return 127
      }
      consecFail = rc !== 0 && rc !== 124 ? consecFail + 1 : 0
      if (env.maxConsecFailures && consecFail >= env.maxConsecFailures) {
        writeStatus(wl, { state: 'error', error: `${consecFail} consecutive failed rounds` })
        return 1
      }
      if (env.beatSec > 0) await deps.sleep(env.beatSec * 1000)
    }
  } finally {
    cleanupPid(wl)
  }
  return 0
}

/** 清自己的 .pid(仅当指向本进程)。 */
export function cleanupPid(wl: WorkerLayout): void {
  try {
    if (existsSync(wl.pid) && readFileSync(wl.pid, 'utf8').trim() === String(process.pid)) {
      rmSync(wl.pid, { force: true })
    }
  } catch { /* OSError 静默 */ }
}
