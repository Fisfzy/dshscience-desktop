/**
 * plugins/observability.ts — 严格只读 dashboar(projects fact graph + global memory)。
 * 移植自 danus/observability/app.py(DSH 内嵌 webServer 路由,免独立进程)。
 *
 * 数据源:<project>/fact_graph/facts/*.md、<project>/global_memory/<kind>.jsonl(11 类)。
 * 严格只读,不 import 任何 core runtime(TODO-PARITY:数据源用 FactGraph/global-memory
 * 的磁盘格式,但观察层自解析以容忍坏数据)。
 *
 * 无 webServer 时不挂路由,只 provide 数据函数;有则挂 /api/overview /api/factgraph
 * /api/channels /api/channel/<kind> + GET /(内嵌 HTML,含 "Danus")。
 */

import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Context } from 'cordis'
import Schema from 'schemastery'

export const name = 'danus-observability'
export const inject = ['webServer'] as const

export interface Config {
  projectDir?: string
}

export const Config: Schema<Config> = Schema.object({
  projectDir: Schema.string(),
})

// --------------------------------------------------------------------------- //
// channels — global-memory kinds, display order, semantic role tag            //
// --------------------------------------------------------------------------- //

export const CHANNELS: [string, string][] = [
  ['conclusion', 'result'], ['example', 'result'], ['counterexample', 'result'],
  ['proof_attempt', 'result'], ['plan', 'judgment'], ['direction', 'judgment'],
  ['obstacle', 'deadend'], ['dead_end', 'deadend'], ['verification', 'verify'],
  ['elaboration', 'strategy'], ['master_guidance', 'strategy'],
]

const CHANNEL_KINDS = new Set(CHANNELS.map(([k]) => k))

// --------------------------------------------------------------------------- //
// config / layout                                                             //
// --------------------------------------------------------------------------- //

export function projectDir(): string {
  const p = process.env.DANUS_DASHBOARD_PROJECT || process.env.DANUS_PROJECT_DIR
  if (!p) throw new Error('no project dir — set --project / DANUS_PROJECT_DIR')
  return p
}

function factsDir(project: string): string {
  return join(project, 'fact_graph', 'facts')
}
function channelFile(project: string, kind: string): string {
  return join(project, 'global_memory', `${kind}.jsonl`)
}

// --------------------------------------------------------------------------- //
// parsing                                                                     //
// --------------------------------------------------------------------------- //

const FM_RE = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/

function parseFact(text: string): Record<string, unknown> {
  const m = text.match(FM_RE)
  const fm: Record<string, unknown> = {}
  let body = text
  if (m) {
    body = m[2]!
    for (const line of m[1]!.split(/\r?\n/)) {
      if (!line.includes(':')) continue
      const idx = line.indexOf(':')
      const k = line.slice(0, idx).trim()
      const v = line.slice(idx + 1).trim()
      if (v.startsWith('[') && v.endsWith(']')) {
        const inner = v.slice(1, -1).trim()
        fm[k] = inner ? inner.split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : []
      } else {
        fm[k] = v
      }
    }
  }
  const secs: Record<string, string> = { statement: '', proof: '', intuition: '' }
  let cur: string | null = null
  for (const line of body.split(/\r?\n/)) {
    const h = line.match(/^##\s+(\w+)/)
    if (h && h[1]!.toLowerCase() in secs) {
      cur = h[1]!.toLowerCase()
      continue
    }
    if (cur) secs[cur] += line + '\n'
  }
  return {
    fact_id: String(fm['fact_id'] ?? ''),
    problem_id: String(fm['problem_id'] ?? ''),
    author: String(fm['author'] ?? ''),
    predecessors: (fm['predecessors'] as unknown[] | string[]) ?? [],
    statement: (secs['statement'] ?? '').trim(),
    proof: (secs['proof'] ?? '').trim(),
    intuition: (secs['intuition'] ?? '').trim(),
  }
}

function loadFacts(project: string): Record<string, unknown>[] {
  const d = factsDir(project)
  if (!existsSync(d)) return []
  const out: Record<string, unknown>[] = []
  for (const f of readdirSync(d).filter((n) => n.endsWith('.md')).sort()) {
    try {
      const fact = parseFact(readFileSync(join(d, f), 'utf8'))
      if (!fact['fact_id']) fact['fact_id'] = f.slice(0, -3)
      out.push(fact)
    } catch {
      continue
    }
  }
  return out
}

function loadJsonl(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return []
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const out: Record<string, unknown>[] = []
  for (const line of text.split(/\r?\n/)) {
    const ln = line.trim()
    if (!ln) continue
    try {
      const obj = JSON.parse(ln)
      if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) out.push(obj)
    } catch {
      continue
    }
  }
  return out
}

function loadChannel(project: string, kind: string): Record<string, unknown>[] {
  return loadJsonl(channelFile(project, kind))
}

function depthsOf(deps: Map<string, string[]>): Map<string, number> {
  const depth = new Map<string, number>()
  const get = (fid: string, stack: Set<string>): number => {
    const cached = depth.get(fid)
    if (cached !== undefined) return cached
    if (stack.has(fid)) return 0 // cycle guard
    const ps = deps.get(fid) ?? []
    let d = 0
    if (ps.length > 0) d = 1 + Math.max(...ps.map((p) => get(p, new Set(stack).add(fid))))
    depth.set(fid, d)
    return d
  }
  for (const fid of deps.keys()) get(fid, new Set<string>())
  return depth
}

// --------------------------------------------------------------------------- //
// route implementations (pure — testable offline without a client)            //
// --------------------------------------------------------------------------- //

export function buildOverview(project?: string): Record<string, unknown> {
  const p = project ?? projectDir()
  const facts = loadFacts(p)
  const counts: Record<string, number> = {}
  for (const [k] of CHANNELS) counts[k] = loadChannel(p, k).length
  const verdicts: Record<string, number> = {}
  for (const e of loadChannel(p, 'verification')) {
    const v = String(e['verdict'] ?? '?')
    verdicts[v] = (verdicts[v] ?? 0) + 1
  }
  const byAuthor: Record<string, number> = {}
  for (const f of facts) {
    const a = String(f['author'])
    byAuthor[a] = (byAuthor[a] ?? 0) + 1
  }
  const leaves = facts.filter((f) => (f['predecessors'] as unknown[]).length === 0).length
  return {
    project: baseName(p),
    facts: facts.length,
    facts_with_predecessors: facts.length - leaves,
    facts_by_author: byAuthor,
    channel_counts: counts,
    verdicts,
    updated_at: Date.now() / 1000,
  }
}

export function buildFactgraph(project?: string): Record<string, unknown> {
  const p = project ?? projectDir()
  const facts = loadFacts(p)
  const ids = new Set(facts.map((f) => String(f['fact_id'])))
  const deps = new Map<string, string[]>()
  for (const f of facts) {
    deps.set(String(f['fact_id']), (f['predecessors'] as string[] ?? []).filter((x) => ids.has(x)))
  }
  const depth = depthsOf(deps)
  const nodes = facts.map((f) => ({
    id: String(f['fact_id']), author: String(f['author']), problem_id: String(f['problem_id']),
    statement: String(f['statement'] ?? ''), proof: String(f['proof'] ?? ''), intuition: String(f['intuition'] ?? ''),
    predecessors: deps.get(String(f['fact_id'])) ?? [],
    depth: depth.get(String(f['fact_id'])) ?? 0,
  }))
  const edges: { source: string; target: string }[] = []
  for (const f of facts) {
    for (const src of deps.get(String(f['fact_id'])) ?? []) edges.push({ source: src, target: String(f['fact_id']) })
  }
  let maxDepth = 0
  for (const v of depth.values()) if (v > maxDepth) maxDepth = v
  return { nodes, edges, max_depth: maxDepth }
}

export function buildChannels(project?: string): Record<string, unknown> {
  const p = project ?? projectDir()
  return { channels: CHANNELS.map(([k, role]) => ({ kind: k, role, count: loadChannel(p, k).length })) }
}

export function buildChannel(kind: string, project?: string): Record<string, unknown> {
  if (!CHANNEL_KINDS.has(kind)) throw new Error(`unknown channel ${kind}`)
  const p = project ?? projectDir()
  const entries = loadChannel(p, kind)
  entries.sort((a, b) => String(b['timestamp_utc'] ?? '').localeCompare(String(a['timestamp_utc'] ?? '')))
  return { kind, count: entries.length, entries }
}

// --------------------------------------------------------------------------- //
// webServer routes + index page                                                //
// --------------------------------------------------------------------------- //

interface RegisteredRoute {
  /** DSH webServer 契约:kind: 'exact' | 'prefix'(exact 全表优先,再最长前缀)。 */
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: unknown, res: unknown) => void | Promise<void>
}
interface WebServerLike {
  register(route: RegisteredRoute): unknown
}

export function indexPageHtml(): string {
  return `<!doctype html>
<html><head><title>Danus — observability</title></head>
<body>
  <h1>Danus</h1>
  <p>Read-only fact-graph + global-memory dashboard.</p>
  <ul>
    <li><a href="/danus/api/overview">/danus/api/overview</a></li>
    <li><a href="/danus/api/factgraph">/danus/api/factgraph</a></li>
    <li><a href="/danus/api/channels">/danus/api/channels</a></li>
  </ul>
</body></html>`
}

/**
 * 把 JSON 端点注册到 webServer(call-time 取 project dir)。
 * DSH webServer 契约(以 dsh-host-webserver 为准):register({kind, path, handler}),
 * 每行一条;无 :param 模式 —— /api/channel/<kind> 用 prefix 路由 + req.url 提取。
 * 路径带 /danus 前缀,避免与 SPA fallback 或其他插件的 / 冲突。
 */
export function registerRoutes(
  webServer: WebServerLike,
  projectOverride?: string,
  effect?: (fn: () => unknown) => unknown,
): void {
  const proj = (): string => projectOverride ?? projectDir()
  // 生命周期:注册挂 fiber effect,卸载/HMR 自动撤销(防僵尸路由);测试不传则直挂。
  const eff = effect ?? ((fn: () => unknown) => fn())
  const reg = (r: RegisteredRoute) => eff(() => webServer.register(r))
  reg({ kind: 'exact', path: '/danus/api/overview', handler: (_req, res) => json(res, buildOverview(proj())) })
  reg({ kind: 'exact', path: '/danus/api/factgraph', handler: (_req, res) => json(res, buildFactgraph(proj())) })
  reg({ kind: 'exact', path: '/danus/api/channels', handler: (_req, res) => json(res, buildChannels(proj())) })
  reg({
    kind: 'prefix',
    path: '/danus/api/channel/',
    handler: (req, res) => {
      const url = (req as { url?: string }).url ?? ''
      const kind = decodeURIComponent(url.split('/danus/api/channel/')[1]?.split('?')[0] ?? '')
      try {
        return json(res, buildChannel(kind, proj()))
      } catch {
        return notFound(res, `unknown channel ${kind}`)
      }
    },
  })
  reg({ kind: 'exact', path: '/danus', handler: (_req, res) => html(res, indexPageHtml()) })
}

function json(res: unknown, payload: unknown): void {
  const r = res as { setHeader?(k: string, v: string): void; json?(v: unknown): void; end?(v?: string): void; writeHead?(code: number, h: Record<string, string>): void }
  r.setHeader?.('Content-Type', 'application/json; charset=utf-8')
  r.end?.(JSON.stringify(payload))
}
function html(res: unknown, page: string): void {
  const r = res as { setHeader?(k: string, v: string): void; end?(v?: string): void; writeHead?(code: number, h: Record<string, string>): void }
  r.setHeader?.('Content-Type', 'text/html; charset=utf-8')
  r.end?.(page)
}
function notFound(res: unknown, msg: string): void {
  const r = res as { setHeader?(k: string, v: string): void; end?(v?: string): void; writeHead?(code: number, h: Record<string, string>): void }
  r.setHeader?.('Content-Type', 'application/json; charset=utf-8')
  r.end?.(JSON.stringify({ detail: msg }))
  // 尽力写 404 状态(webserver 具体机制可能不同 —— TODO-PARITY)。
  const rr = res as { statusCode?: number }
  rr.statusCode = 404
}

// --------------------------------------------------------------------------- //
// apply                                                                       //
// --------------------------------------------------------------------------- //

export function apply(ctx: Context, config: Config): void {
  const dataFns = {
    buildOverview: (project?: string) => buildOverview(project ?? config.projectDir),
    buildFactgraph: (project?: string) => buildFactgraph(project ?? config.projectDir),
    buildChannels: (project?: string) => buildChannels(project ?? config.projectDir),
    buildChannel: (kind: string, project?: string) => buildChannel(kind, project ?? config.projectDir),
  }
  // 提供数据函数(即使无 webServer,调用方也可直读)。
  ctx.provide('danusDashboard', dataFns)

  const webServer = (ctx as unknown as { webServer: WebServerLike }).webServer
  if (webServer) {
    // 直接注册(不经 ctx.effect,避免 web 宿主下 apply 抛错)。
    registerRoutes(webServer, config.projectDir)
  }
}

function baseName(p: string): string {
  const norm = p.replace(/[\\/]+$/, '')
  const i = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'))
  return i < 0 ? norm : norm.slice(i + 1)
}
