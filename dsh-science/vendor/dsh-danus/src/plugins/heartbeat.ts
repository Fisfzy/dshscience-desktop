/**
 * plugins/heartbeat.ts — main agent 的 wall-clock 节拍(替代原版 clock.sleep 机制)。
 *
 * - 30 分钟 control beat:投递节拍 prompt(走 agent.followup = 真实唤醒,
 *   与 goal-session 同机制);agent 忙则跳过本轮(不堆积)。
 * - 4 小时宏观审计:独立节拍。
 * - main agent 用 danus_heartbeat 工具 start/stop/status;或 /danus-beat 命令。
 *
 * 节拍文本是 AGENTS.md 合同的浓缩清单(完整合同见 contracts/main_agent.md,
 * 由 main agent 的会话指令承载)。
 */

import type { Context } from 'cordis'
import Schema from 'schemastery'

export const name = 'danus-heartbeat'
export const inject = ['agents', 'tools', 'timer'] as const

export interface Config {
  beatMinutes?: number
  auditHours?: number
}

export const Config: Schema<Config> = Schema.object({
  beatMinutes: Schema.number().default(30),
  auditHours: Schema.number().default(4),
})

const BEAT_PROMPT = [
  '[Danus control beat] 30 分钟控制节拍到了。立即执行一次真正的全项目控制(不是状态汇报):',
  '1. 读 PROBLEM、global memory(gm_search master_guidance/elaboration/各 kind)、fact graph(fact_search)、',
  '   以及每个 worker 的 danus_status。绝不读 worker 的 local memory。',
  '2. 重建全部可信路线组合:每条路线的机制、前沿、决定性障碍、正反证据、占用 worker、',
  '   以及什么条件会 justify 回到已停放路线。',
  '3. 综合已完成的 subagent 探索;正交路线/反例/文献/证明审计上有空缺就立即补充 subagent。',
  '4. 若全局综合有实质变化,用 gm_add 发一条新的 elaboration(引用已确立的 fact_id)。',
  '5. 用 gm_add 写你自己的 master_guidance(明确区分已验证事实 vs 假设 vs 探索线索)。',
  '6. 逐个审查 worker 的实际进展与任务;明确决定继续/聚焦/转向;用 danus_assign 下达具体任务,',
  '   确保没有空闲 worker 无事可做;danus_start 保持 swarm 运行。',
  '节拍只有在这些观察与分配决定做完后才算完成。',
].join('\n')

const AUDIT_PROMPT = [
  '[Danus macro audit] 4 小时宏观审计到期。即使有事实在到达、即使当前路线感觉接近,也必须执行:',
  '盘点每一条可信进攻方向:机制实际推进到哪、决定性障碍还剩什么、证据增强还是减弱、',
  'worker 分配是否仍合理、主路线应继续/补充/让位给已停放路线。',
  '这是关于通往定理的全局道路,不是局部活动量。',
  '把审计、时间戳、路线决定、 revisit 条件写进 master_guidance(gm_add)——这条记录是强制的。',
].join('\n')

interface Beat {
  id: string
  kind: 'beat' | 'audit'
  agent: unknown
  intervalMs: number
  dispose: () => void
  startedAt: number
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

interface AgentsLike {
  currentInitiator(): { id: string; status: string; followup(msg: unknown): unknown } | undefined
  get(id: string): unknown
}

export function apply(ctx: Context, config: Config): void {
  const beats = new Map<string, Beat>()
  let seq = 0

  const agents = (ctx as unknown as { agents: AgentsLike }).agents
  const tools = (ctx as unknown as { tools: { register(d: unknown): unknown } }).tools

  type AgentLike = NonNullable<ReturnType<typeof agents.currentInitiator>>

  function startBeat(kind: Beat['kind'], agent: AgentLike, intervalMs: number): Beat {
    const id = `${kind}-${++seq}`
    const prompt = kind === 'beat' ? BEAT_PROMPT : AUDIT_PROMPT
    const beat: Beat = {
      id,
      kind,
      agent,
      intervalMs,
      startedAt: Date.now(),
      dispose: () => {},
    }
    const deliver = () => {
      if (agents.get(agent.id) !== agent) {
        stopBeat(id)
        return
      }
      if (agent.status !== 'idle') return // 忙则跳过,不堆积(对齐 dsh-loop)
      agent.followup({
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'plugin', plugin: 'danus-heartbeat' },
      })
    }
    const interval = (ctx as { interval?: (fn: () => void, ms: number) => () => void }).interval
    if (!interval) throw new Error('danus-heartbeat requires the timer service (ctx.interval)')
    beat.dispose = interval.call(ctx, deliver, intervalMs)
    beats.set(id, beat)
    return beat
  }

  function stopBeat(id: string): boolean {
    const b = beats.get(id)
    if (!b) return false
    b.dispose()
    beats.delete(id)
    return true
  }

  function stopAll(agent: AgentLike): number {
    let n = 0
    for (const [id, b] of [...beats]) {
      if (b.agent !== agent) continue
      stopBeat(id)
      n++
    }
    return n
  }

  ;(ctx as { on?: (e: string, fn: (agent: AgentLike) => void) => void }).on?.(
    'agent/disposed',
    (agent: AgentLike) => stopAll(agent),
  )

  tools.register({
    name: 'danus_heartbeat',
    description:
      'Start/stop/status the Danus wall-clock beats on this (main-agent) session: the 30-minute ' +
      'control beat and the 4-hour macro audit. Start both when a project becomes active; the ' +
      'persistent Goal keeps continuity, these beats keep the wall-clock schedule.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'start | stop | status' },
        which: { type: 'string', description: 'beat | audit | both (default both)' },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_a: unknown, v: unknown) => [{ type: 'text', text: safeStringify(v) }],
    },
    execute: (args: Record<string, unknown>) => {
      const agent = agents.currentInitiator()
      if (!agent) throw new Error('danus_heartbeat requires an active agent turn')
      const which = String(args.which ?? 'both')
      const action = String(args.action)

      if (action === 'status') {
        const mine = [...beats.values()].filter((b) => b.agent === agent)
        return {
          beats: mine.map((b) => ({
            id: b.id,
            kind: b.kind,
            intervalMs: b.intervalMs,
            runningForSec: Math.round((Date.now() - b.startedAt) / 1000),
          })),
        }
      }
      if (action === 'stop') {
        const n = stopAll(agent)
        return { stopped: n }
      }
      if (action === 'start') {
        const started: string[] = []
        if (which === 'beat' || which === 'both') {
          if (![...beats.values()].some((b) => b.agent === agent && b.kind === 'beat')) {
            started.push(startBeat('beat', agent, config.beatMinutes! * 60_000).id)
          }
        }
        if (which === 'audit' || which === 'both') {
          if (![...beats.values()].some((b) => b.agent === agent && b.kind === 'audit')) {
            started.push(startBeat('audit', agent, config.auditHours! * 3_600_000).id)
          }
        }
        return { started, already_running: started.length === 0 }
      }
      throw new Error(`unknown action: ${action}`)
    },
  })
}
