/**
 * plugins/summary.ts — human-summary 的 summary_write 模型工具(thin shell over HumanSummary)。
 * 移植自 danus/human_summary/server.py 的唯一工具。
 */

import type { Context } from 'cordis'
import Schema from 'schemastery'
import { HumanSummary, type HumanSummaryConfig } from '../services/human-summary.ts'

export const name = 'danus-summary'
export const inject = ['tools'] as const

export interface Config {
  skillDir?: string
  model?: string
  effort?: string
  timeout?: number
}

export const Config: Schema<Config> = Schema.object({
  skillDir: Schema.string(),
  model: Schema.string(),
  effort: Schema.string(),
  timeout: Schema.number(),
})

function safeStringify(value: unknown): string {
  try {
    const s = JSON.stringify(value)
    return s === undefined ? String(value) : s
  } catch {
    return Object.prototype.toString.call(value)
  }
}

export function apply(ctx: Context, config: Config): void {
  const tools = (ctx as unknown as { tools: { register(d: unknown): unknown } }).tools
  const hs = new HumanSummary(config as HumanSummaryConfig)
  tools.register({
    name: 'summary_write',
    description:
      'Write a clean, human-facing progress report for a project to <project>/report/report.md. ' +
      'Assembles the report writer prompt (verbatim problem statement + a SCRUBBED id-free ' +
      'bundle of verified results), drives an ISOLATED local codex, writes its stdout, then ' +
      'runs a LEAK CHECK. status="ok" only on zero exit + non-empty output + zero leaks.',
    parameters: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project name (main agent only; resolved under the agents root). Omit when pinned to a project.',
        },
        language: { type: 'string', description: 'Narrative language (default: operator OPERATOR.md **Language:**, else English).' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: safeStringify(value) }],
    },
    execute: (a: Record<string, unknown>) => hs.summary_write({ project: a.project as string | null, language: a.language as string | null }),
  })
}
