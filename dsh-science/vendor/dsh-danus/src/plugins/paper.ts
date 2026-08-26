/**
 * plugins/paper.ts — write-paper 的 6 个模型工具(thin shell over WritePaper service)。
 * 移植自 danus/write_paper/server.py 的 _TOOLS 注册表(全 main-agent 动词,无角色拆分)。
 *
 * 工具返回**小而诚实**:路径 + 状态 + 标志,绝不返回整份 .tex。
 */

import type { Context } from 'cordis'
import Schema from 'schemastery'
import { WritePaper, type WritePaperConfig } from '../services/write-paper.ts'

export const name = 'danus-paper'
export const inject = ['tools'] as const

export interface Config {
  skillDir?: string
  model?: string
  effort?: string
  timeout?: number
  compileAttempts?: number
  runLogEnabled?: boolean
}

export const Config: Schema<Config> = Schema.object({
  skillDir: Schema.string(),
  model: Schema.string(),
  effort: Schema.string(),
  timeout: Schema.number(),
  compileAttempts: Schema.number(),
  runLogEnabled: Schema.boolean(),
})

interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown
}

function safeStringify(value: unknown): string {
  try {
    const s = JSON.stringify(value)
    return s === undefined ? String(value) : s
  } catch {
    return Object.prototype.toString.call(value)
  }
}

function registerTool(ctx: Context, def: ToolDef): void {
  const tools = (ctx as unknown as { tools: { register(d: unknown): unknown } }).tools
  tools.register({
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: safeStringify(value) }],
    },
    execute: def.execute,
  })
}

const PROJECT_PARAM = {
  type: 'string',
  description: 'Project name (main agent only; resolved under the agents root). Omit when pinned to a project.',
}
const PAPER_ID_PARAM = {
  type: 'string',
  description: 'Paper id (multiple papers per project; default legacy paper).',
}

export function apply(ctx: Context, config: Config): void {
  const wp = new WritePaper(config as WritePaperConfig)
  const tools: ToolDef[] = [
    {
      name: 'paper_subgraph',
      description:
        'Return a COMPACT skeleton of the paper target-fact closure (statements only, no proofs) ' +
        'for the main agent to read and SELECT from. Read this, choose facts to PRESENT, then ' +
        'call paper_write(fact_ids=[...]).',
      parameters: {
        type: 'object',
        properties: {
          project: PROJECT_PARAM,
          headline: { type: 'array', items: { type: 'string' } },
          paper_id: PAPER_ID_PARAM,
        },
      },
      execute: (a) => wp.paper_subgraph({ project: a.project as string | null, headline: a.headline as string[] | null, paperId: a.paper_id as string | null }),
    },
    {
      name: 'paper_write',
      description:
        'Write the first complete main.tex for a project from its verified fact graph, house ' +
        'style, and structure plan. Never compiles. Optionally stops the worker swarm ' +
        '(stop_workers=True). Fact selection via fact_ids (curation seam).',
      parameters: {
        type: 'object',
        properties: {
          project: PROJECT_PARAM,
          headline: { type: 'array', items: { type: 'string' } },
          stop_workers: { type: 'boolean' },
          paper_id: PAPER_ID_PARAM,
          fact_ids: { type: 'array', items: { type: 'string' } },
          instructions: { type: 'string' },
        },
      },
      execute: (a) => wp.paper_write({ project: a.project as string | null, headline: a.headline as string[] | null, stop_workers: a.stop_workers as boolean | undefined, paperId: a.paper_id as string | null, fact_ids: a.fact_ids as string[] | null, instructions: a.instructions as string | null }),
    },
    {
      name: 'reference_audit',
      description:
        'Audit the paper bibliography: the auditor reads ONLY main.tex + ledger and FLAGS ' +
        'entries it cannot vouch for (no tools, no network). Writes NO main.tex. Feed the ' +
        'findings to reference_verify.',
      parameters: {
        type: 'object',
        properties: {
          project: PROJECT_PARAM,
          paper_id: PAPER_ID_PARAM,
        },
      },
      execute: (a) => wp.reference_audit({ project: a.project as string | null, paperId: a.paper_id as string | null }),
    },
    {
      name: 'reference_verify',
      description:
        'Verify the paper flagged references ONLINE (networked codex: gateway ' +
        'search_arxiv_theorems + web_search). Updates REFERENCE_LEDGER.md in place; NEVER ' +
        'writes main.tex.',
      parameters: {
        type: 'object',
        properties: {
          project: PROJECT_PARAM,
          findings: { type: 'string' },
          paper_id: PAPER_ID_PARAM,
        },
      },
      execute: (a) => wp.reference_verify({ project: a.project as string | null, findings: a.findings as string | null, paperId: a.paper_id as string | null }),
    },
    {
      name: 'paper_revise',
      description:
        'Revise an existing main.tex (compile failure, citation blockers, editorial notes, or ' +
        'a GAP-FILL round). Runs an in-tool compile-retry loop. On gap-fill, pass ' +
        'verifier_feedback + notes + add_facts together.',
      parameters: {
        type: 'object',
        properties: {
          project: PROJECT_PARAM,
          compile_log: { type: 'string' },
          notes: { type: 'string' },
          citation_fixes: { type: 'string' },
          verifier_feedback: { type: 'string' },
          add_facts: { type: 'array', items: { type: 'string' } },
          paper_id: PAPER_ID_PARAM,
        },
      },
      execute: (a) => wp.paper_revise({ project: a.project as string | null, compile_log: a.compile_log as string | null, notes: a.notes as string | null, citation_fixes: a.citation_fixes as string | null, verifier_feedback: a.verifier_feedback as string | null, add_facts: a.add_facts as string[] | null, paperId: a.paper_id as string | null }),
    },
    {
      name: 'paper_verify_math',
      description:
        'WHOLE-PAPER MATH VERIFICATION: verify the assembled paper AS WRITTEN as ONE document, ' +
        'and gate deliver on a durable VERIFY_LEDGER.md. Passed only when there are zero ' +
        'must-fix findings.',
      parameters: {
        type: 'object',
        properties: {
          project: PROJECT_PARAM,
          paper_id: PAPER_ID_PARAM,
        },
      },
      execute: (a) => wp.paper_verify_math({ project: a.project as string | null, paperId: a.paper_id as string | null }),
    },
  ]
  for (const def of tools) registerTool(ctx, def)
}
