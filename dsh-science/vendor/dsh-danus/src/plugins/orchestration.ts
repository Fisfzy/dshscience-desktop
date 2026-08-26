/**
 * plugins/orchestration.ts — main agent 的 swarm 控制面(原 `danus` CLI 的模型工具等价)。
 *
 * 工具:danus_list / danus_new / danus_assign / danus_finalize /
 *       danus_start / danus_status / danus_stop。
 * 语义与原版 CLI 动词一致;错误以异常抛出(isError 路径)。
 */

import type { Context } from 'cordis'
import Schema from 'schemastery'
import type { DanusSwarm } from '../services/swarm.ts'

export const name = 'danus-orchestration'
export const inject = ['tools', 'danusSwarm'] as const

export interface Config {
  staggerMs?: number
}

export const Config: Schema<Config> = Schema.object({
  staggerMs: Schema.number().default(200),
})

interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  /** 数组结果的工具(danus_list/start/status/stop)用数组 schema。 */
  outputIsArray?: boolean
  /** 只读工具声明并发安全(未声明 → exclusive)。 */
  concurrencySafe?: boolean
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown
}

const OBJECT_OUTPUT = { type: 'object', additionalProperties: true, properties: {} }
const ARRAY_OUTPUT = {
  type: 'array',
  items: { type: 'object', additionalProperties: true, properties: {} },
}

function safeStringify(value: unknown): string {
  try {
    const s = JSON.stringify(value, null, 2)
    return s === undefined ? String(value) : s
  } catch {
    return Object.prototype.toString.call(value)
  }
}

export function apply(ctx: Context, config: Config): void {
  const tools = (ctx as unknown as { tools: { register(d: unknown): unknown } }).tools

  const swarmOf = (): DanusSwarm =>
    (ctx as unknown as { danusSwarm: DanusSwarm }).danusSwarm

  const defs: ToolDef[] = [
    {
      name: 'danus_list',
      description: 'List all Danus projects with worker counts, live counts, and model.',
      parameters: { type: 'object', properties: {} },
      outputIsArray: true,
      concurrencySafe: true,
      execute: () => swarmOf().list(),
    },
    {
      name: 'danus_new',
      description:
        'Scaffold a new Danus project with a worker roster. roles syntax: "high:3,xhigh:4" ' +
        '(base role : count). Refuses to overwrite an existing project.',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          roles: { type: 'string', description: 'e.g. "high:3,xhigh:4"' },
          model: { type: 'string' },
        },
        required: ['project'],
      },
      execute: (args) =>
        swarmOf().newProject(
          String(args.project),
          typeof args.roles === 'string' && args.roles ? args.roles : 'high:3,xhigh:4',
          (args.model as string | undefined) ?? null,
        ),
    },
    {
      name: 'danus_assign',
      description:
        "Overwrite (replace, NOT append) a worker's TASK.md — the per-round assignment the worker " +
        'reads at the start of every round.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: '<project>/<worker>' },
          task: { type: 'string' },
        },
        required: ['target', 'task'],
      },
      execute: (args) => swarmOf().assign(String(args.target), String(args.task)),
    },
    {
      name: 'danus_finalize',
      description:
        'Record the finalized target fact_id(s) for a project paper in TARGET.md (write-paper ' +
        'reads this). With no fact_ids, returns candidate terminal facts without writing anything.',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          paper: { type: 'string', description: 'paper_id; default/"main" → legacy TARGET.md' },
          fact_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['project'],
      },
      execute: (args) =>
        swarmOf().finalize(
          String(args.project),
          (args.fact_ids as string[] | undefined) ?? [],
          (args.paper as string | undefined) ?? null,
        ),
    },
    {
      name: 'danus_start',
      description:
        'Launch worker loop(s) — detached, idempotent. Target: <project> or <project>/<worker>.',
      parameters: {
        type: 'object',
        properties: { target: { type: 'string' } },
        required: ['target'],
      },
      outputIsArray: true,
      execute: (args) => swarmOf().start(String(args.target), config.staggerMs),
    },
    {
      name: 'danus_status',
      description:
        'Per-worker liveness + round + last fact. Labels: working / stuck? / stopped / deadline / ' +
        'max_rounds / error / terminated / created / dead.',
      parameters: {
        type: 'object',
        properties: { target: { type: 'string' } },
        required: ['target'],
      },
      outputIsArray: true,
      concurrencySafe: true,
      execute: (args) => swarmOf().status(String(args.target)),
    },
    {
      name: 'danus_stop',
      description:
        'Stop worker loop(s). Graceful by default (loop exits at the round boundary); ' +
        'force=true kills the process tree now.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string' },
          force: { type: 'boolean' },
        },
        required: ['target'],
      },
      outputIsArray: true,
      execute: (args) => swarmOf().stop(String(args.target), args.force === true),
    },
  ]

  for (const def of defs) {
    tools.register({
      name: def.name,
      description: def.description,
      parameters: def.parameters,
      output: {
        schema: def.outputIsArray ? ARRAY_OUTPUT : OBJECT_OUTPUT,
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: safeStringify(value) }],
      },
      isConcurrencySafe: def.concurrencySafe ? () => true : undefined,
      execute: def.execute,
    })
  }
}
