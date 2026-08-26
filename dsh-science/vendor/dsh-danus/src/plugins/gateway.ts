/**
 * plugins/gateway.ts — 角色门控的 truth-store 工具层(原 danus.gateway 的 DSH 原生等价)。
 *
 * 权限按"角色能看到哪些工具"实施(结构性,非 prompt 约定):
 *   worker:   gm_add gm_search fact_submit fact_search search_arxiv_theorems
 *   main:     gm_add gm_search fact_search fact_revoke search_arxiv_theorems(无 fact_submit!)
 *   verifier: search_arxiv_theorems(只读)
 *   all:      全部 6 个(显式开发用)
 * 未知/未配角色 fail-closed → verifier。
 *
 * fact_submit 是唯一写 fact 路径:verifier accept 才入图;verdict 总是 trace 到
 * global memory(kind=verification)。
 *
 * 配置一律 Schemastery;DANUS_* env 作为每项的运行时回退(原版 parity 契约)。
 */

import type { Context } from 'cordis'
import Schema from 'schemastery'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { FactGraph } from '../core/factgraph.ts'
import { GlobalMemory } from '../core/global-memory.ts'
import { searchArxivTheorems } from '../integrations/matlas.ts'
import { envStr } from '../shared/env.ts'
import type { DanusVerify } from '../services/verify.ts'

export const name = 'danus-gateway'
// danusVerify 在本 bundle 的组合里总是挂载;声明 inject 让解析器追踪它
// (fact_submit 内部仍保留调用时 undefined 检查,复刻"verify not wired yet"语义)。
export const inject = ['tools', 'danusVerify'] as const

export type Role = 'worker' | 'main' | 'verifier' | 'all'

export interface Config {
  role?: Role
  projectDir?: string
  agentsRoot?: string
  author?: string
  problemId?: string
}

export const Config: Schema<Config> = Schema.object({
  role: Schema.union(['worker', 'main', 'verifier', 'all'] as const),
  projectDir: Schema.string(),
  agentsRoot: Schema.string(),
  author: Schema.string(),
  problemId: Schema.string(),
})

// --------------------------------------------------------------------------- //
// 角色表(roles.py 移植;fail-closed)                                          //
// --------------------------------------------------------------------------- //

export const ALL_TOOLS = [
  'gm_add', 'gm_search', 'fact_submit', 'fact_search', 'fact_revoke', 'search_arxiv_theorems',
] as const

export const ROLE_TOOLS: Record<Role, readonly string[]> = {
  worker: ['gm_add', 'gm_search', 'fact_submit', 'fact_search', 'search_arxiv_theorems'],
  main: ['gm_add', 'gm_search', 'fact_search', 'fact_revoke', 'search_arxiv_theorems'],
  verifier: ['search_arxiv_theorems'],
  all: ALL_TOOLS,
}

export function toolsFor(role: string): readonly string[] {
  return ROLE_TOOLS[role as Role] ?? ROLE_TOOLS.verifier
}

// --------------------------------------------------------------------------- //
// 运行时决议(config 优先,env 回退,call-time —— 原版 parity)                  //
// --------------------------------------------------------------------------- //

const PROJECT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function resolveRole(config: Config): Role {
  const raw = config.role ?? envStr('DANUS_ROLE', 'verifier')
  return (raw in ROLE_TOOLS ? raw : 'verifier') as Role
}

function resolveAuthor(config: Config): string {
  return config.author ?? envStr('DANUS_AUTHOR', 'unknown')
}

function resolveProject(config: Config, project?: string | null): string {
  // parity:原版判 `project is not None` —— 空串也走按名寻址并被正则拒绝。
  if (project !== undefined && project !== null) {
    const root = config.agentsRoot ?? envStr('DANUS_AGENTS_ROOT')
    if (!root) throw new Error('DANUS_AGENTS_ROOT is not set; cannot resolve a project by name')
    if (!PROJECT_NAME_RE.test(project)) throw new Error(`invalid project name: ${JSON.stringify(project)}`)
    const dir = join(resolve(root), project)
    if (!existsSync(dir)) throw new Error(`no such project: ${JSON.stringify(project)} (under ${root})`)
    return dir
  }
  const dir = config.projectDir ?? envStr('DANUS_PROJECT_DIR')
  if (!dir) throw new Error('DANUS_PROJECT_DIR is not set and no project was given')
  return resolve(dir)
}

// --------------------------------------------------------------------------- //
// 工具定义辅助(原始 JSON Schema 注册;lean-prover 模式,避免硬导入 dsh-tools) //
// --------------------------------------------------------------------------- //

interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  /** 只读工具声明并发安全(未声明 → exclusive,fail-closed)。 */
  concurrencySafe?: boolean
  execute: (args: Record<string, unknown>, exec?: { signal?: AbortSignal }) => Promise<unknown> | unknown
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
    isConcurrencySafe: def.concurrencySafe ? () => true : undefined,
    execute: (args: Record<string, unknown>, exec: { signal?: AbortSignal }) => def.execute(args, exec),
  })
}

const PROJECT_PARAM = {
  type: 'string',
  description: 'Project name (main agent only; resolved under the agents root). Omit when pinned to a project.',
}

// --------------------------------------------------------------------------- //
// apply                                                                        //
// --------------------------------------------------------------------------- //

export function apply(ctx: Context, config: Config): void {
  const role = resolveRole(config)
  const visible = new Set(toolsFor(role))

  const fg = (project?: string | null) => new FactGraph(resolveProject(config, project))
  const gm = (project?: string | null) => new GlobalMemory(resolveProject(config, project))

  const defs: ToolDef[] = [
    {
      name: 'gm_add',
      description:
        'Publish a finding to the shared global memory (claim + evidence). Verifiable kinds ' +
        '(conclusion/example/counterexample/proof_attempt) REQUIRE explicit evidence; judgments ' +
        '(plan/direction/obstacle/master_guidance/elaboration) do not. Global memory is shared ' +
        'awareness, never a correctness source.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'One of the 11 GLOBAL_KINDS.' },
          claim: { type: 'string' },
          evidence: { type: 'string' },
          verifiable: { type: 'boolean' },
          glossary: { type: 'object', additionalProperties: true },
          links: { type: 'object', additionalProperties: true },
          project: PROJECT_PARAM,
        },
        required: ['kind', 'claim'],
      },
      execute: (args) => {
        const id = gm(args.project as string | undefined).append(
          String(args.kind), String(args.claim), String(args.evidence ?? ''), resolveAuthor(config),
          {
            verifiable: (args.verifiable as boolean | undefined) ?? null,
            glossary: (args.glossary as Record<string, unknown>) ?? null,
            links: (args.links as Record<string, unknown>) ?? null,
          },
        )
        return { id, kind: String(args.kind) }
      },
    },
    {
      name: 'gm_search',
      description:
        'BM25-search the shared global-memory findings. Use to reuse others\' results, avoid ' +
        'duplicate work, and learn which paths are dead.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          kinds: { type: 'array', items: { type: 'string' } },
          limit_per_kind: { type: 'number' },
          project: PROJECT_PARAM,
        },
        required: ['query'],
      },
      execute: (args) =>
        gm(args.project as string | undefined).search(
          String(args.query),
          (args.kinds as string[] | undefined) ?? null,
          typeof args.limit_per_kind === 'number' ? args.limit_per_kind : 10,
        ),
      concurrencySafe: true,
    },
    {
      name: 'fact_submit',
      description:
        'Submit a statement+proof to the verifier — the ONLY write path into the fact graph. ' +
        'On accept the fact enters the graph with its predecessors as edges; on reject you get ' +
        'repair_hints and nothing is written. The verdict is always traced to global memory.',
      parameters: {
        type: 'object',
        properties: {
          statement: { type: 'string' },
          proof: { type: 'string' },
          predecessors: { type: 'array', items: { type: 'string' }, description: 'fact_ids this proof builds on' },
          glossary_introduces: { type: 'object', additionalProperties: true },
          intuition: { type: 'string' },
          source_id: { type: 'string', description: 'global-memory finding id being promoted' },
          external_refs: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
        required: ['statement', 'proof'],
      },
      execute: async (args, exec) => factSubmit(ctx, config, args, exec?.signal),
    },
    {
      name: 'fact_search',
      description:
        'BM25 over the verified fact graph (statement + proof + glossary). Check before proving ' +
        'whether a similar fact already exists; find fact_ids to cite as predecessors.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
          project: PROJECT_PARAM,
        },
        required: ['query'],
      },
      execute: (args) => ({
        query: String(args.query),
        results: fg(args.project as string | undefined).search(
          String(args.query),
          typeof args.limit === 'number' ? args.limit : 10,
        ),
      }),
      concurrencySafe: true,
    },
    {
      name: 'fact_revoke',
      description:
        'Cascade-revoke a wrong fact and everything depending on it. Destructive; operator/main-agent only.',
      parameters: {
        type: 'object',
        properties: {
          fact_id: { type: 'string' },
          reason: { type: 'string' },
          project: PROJECT_PARAM,
        },
        required: ['fact_id', 'reason'],
      },
      execute: (args) => ({
        revoked: fg(args.project as string | undefined).revoke(String(args.fact_id), String(args.reason)),
      }),
    },
    {
      name: 'search_arxiv_theorems',
      description:
        'Semantic search over arXiv theorem statements (Matlas). Returns verbatim, as-published ' +
        'theorem/lemma/definition statements. Prefer full mathematical statements as the query.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          num_results: { type: 'number' },
        },
        required: ['query'],
      },
      execute: (args) =>
        searchArxivTheorems(
          String(args.query),
          typeof args.num_results === 'number' ? args.num_results : 10,
        ),
      concurrencySafe: true,
    },
  ]

  for (const def of defs) {
    if (visible.has(def.name)) registerTool(ctx, def)
  }
}

// --------------------------------------------------------------------------- //
// fact_submit —— 写门(原版 §2.3 逐行语义)                                     //
// --------------------------------------------------------------------------- //

async function factSubmit(ctx: Context, config: Config, args: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const statement = String(args.statement ?? '')
  const proof = String(args.proof ?? '')
  const predecessors = (args.predecessors as string[] | undefined) ?? []
  const glossaryIntroduces = (args.glossary_introduces as Record<string, string> | undefined) ?? undefined
  const intuition = String(args.intuition ?? '')
  const sourceId = (args.source_id as string | undefined) ?? null
  const externalRefs = args.external_refs as unknown

  const projectDir = resolveProject(config, null)
  const fg = new FactGraph(projectDir)
  const gm = new GlobalMemory(projectDir)
  const problemId = config.problemId ?? (envStr('DANUS_PROBLEM_ID') || basename(projectDir))
  const author = resolveAuthor(config)

  // 0) glossary 覆盖率 —— 纯建议性,绝不因启发式 bug 阻塞提交
  let undefinedSyms: string[] = []
  try {
    undefinedSyms = fg.undefinedSymbols({
      statement, proof, intuition,
      predecessors, glossary_introduces: glossaryIntroduces ?? null,
    })
  } catch {
    undefinedSyms = []
  }

  // 1) Verify。服务未接线/失败 → 干净错误信封,什么都不存(worker 重试)。
  const verify = ctx.get('danusVerify') as DanusVerify | undefined
  if (!verify) {
    return {
      accepted: false, verdict: 'error',
      error: 'danusVerify service is not mounted (verify service not wired yet)',
      undefined_symbols: undefinedSyms,
    }
  }
  let result: Record<string, unknown>
  try {
    result = await verify.verify(statement, proof, signal)
  } catch (e) {
    return { accepted: false, verdict: 'error', error: String((e as Error).message ?? e), undefined_symbols: undefinedSyms }
  }

  const verdict = result.verdict as string | undefined
  const accepted = verdict === 'correct'

  // 2) 仅当接受才写 fact;写失败(如前驱被撤销)不跳过后面的 trace。
  let factId: string | null = null
  let writeError: string | null = null
  if (accepted) {
    try {
      factId = fg.add({
        problem_id: problemId, author, statement, proof,
        predecessors, glossary_introduces: glossaryIntroduces ?? null,
        intuition, external_refs: externalRefs,
      })
    } catch (e) {
      writeError = String((e as Error).message ?? e)
    }
  }

  // 3) 一旦有 verdict,总是记入 global memory(kind=verification)
  gm.append(
    'verification',
    statement,
    accepted ? 'verdict: correct' : String(result.repair_hints ?? '') || 'verdict: wrong',
    author,
    {
      verifiable: false,
      links: { source_id: sourceId, predecessors: predecessors ?? [] },
      extra: {
        verdict,
        fact_id: factId,
        write_error: writeError,
        verification_report: result.verification_report,
      },
    },
  )

  // 4) 返回信封(四种,字段与原版一致)
  if (!accepted) {
    return {
      accepted: false, verdict,
      repair_hints: result.repair_hints,
      verification_report: result.verification_report,
      undefined_symbols: undefinedSyms,
    }
  }
  if (writeError) {
    return { accepted: true, fact_id: null, write_error: writeError, undefined_symbols: undefinedSyms }
  }
  return { accepted: true, fact_id: factId, undefined_symbols: undefinedSyms }
}

function basename(p: string): string {
  const norm = p.replace(/[\\/]+$/, '')
  const i = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'))
  return i < 0 ? norm : norm.slice(i + 1)
}
