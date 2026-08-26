/**
 * plugins/console-api.ts — Danus Console 的操作路由(host half,纯薄转发)。
 *
 * 只读:GET /danus/api/workers · /danus/api/worker-log · /danus/api/export
 * 动作:POST /danus/api/assign · /danus/api/worker/start · /danus/api/worker/stop
 *       POST /danus/api/gm/add · /danus/api/gm/status · /danus/api/fact/revoke
 *
 * 路由不实现任何业务逻辑——全部转发 DanusSwarm / FactGraph / GlobalMemory。
 * 项目经 ?project= 按名寻址(agentsRoot,单段名防逃逸)。
 */

import type { Context } from 'cordis'
import Schema from 'schemastery'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { FactGraph } from '../core/factgraph.ts'
import { GlobalMemory } from '../core/global-memory.ts'
import { parseFrontmatter } from '../core/factgraph.ts'
import { envStr } from '../shared/env.ts'
import { PROJECT_NAME_RE } from '../shared/target.ts'
import { DanusSwarm } from '../services/swarm.ts'

export const name = 'danus-console-api'
export const inject = ['webServer'] as const

export interface Config {
  agentsRoot?: string
}

export const Config: Schema<Config> = Schema.object({
  agentsRoot: Schema.string(),
})

interface Route {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: unknown, res: unknown) => void | Promise<void>
}
interface WebServerLike {
  register(route: Route): unknown
}

function agentsRoot(config: Config): string {
  return resolve(config.agentsRoot ?? (envStr('DANUS_AGENTS_ROOT') || join(process.cwd(), 'runtime', 'projects')))
}

function projectDirOf(config: Config, url: URL): string {
  const name = url.searchParams.get('project') ?? ''
  if (!PROJECT_NAME_RE.test(name)) throw new Error(`invalid project name: ${JSON.stringify(name)}`)
  const dir = join(agentsRoot(config), name)
  if (!existsSync(dir)) throw new Error(`no such project: ${name}`)
  return dir
}

// ---------------------------------------------------------------- req/res 辅助
function url(req: unknown): URL {
  return new URL((req as { url?: string }).url ?? '/', 'http://danus.internal')
}
function json(res: unknown, payload: unknown): void {
  const r = res as { setHeader?(k: string, v: string): void; end?(v?: string): void }
  r.setHeader?.('Content-Type', 'application/json; charset=utf-8')
  r.end?.(JSON.stringify(payload))
}
function fail(res: unknown, msg: string, code = 400): void {
  const r = res as { setHeader?(k: string, v: string): void; end?(v?: string): void; statusCode?: number }
  r.statusCode = code
  r.setHeader?.('Content-Type', 'application/json; charset=utf-8')
  r.end?.(JSON.stringify({ detail: msg }))
}
async function body(req: unknown): Promise<Record<string, unknown>> {
  const r = req as AsyncIterable<Buffer | string>
  let text = ''
  for await (const chunk of r) text += chunk
  return text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {}
}
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

// ---------------------------------------------------------------- 路由实现
export function registerConsoleRoutes(ctx: Context, webServer: WebServerLike, config: Config): void {
  // 独立实例:按本插件的组合配置寻址 agentsRoot(不依赖共享实例的 env 根)。
  let _swarm: DanusSwarm | null = null
  const swarm = (): DanusSwarm => (_swarm ??= new DanusSwarm(undefined, agentsRoot(config)))
  // 生命周期:路由注册挂在 fiber effect 上,卸载/HMR 时自动撤销(防僵尸路由)。
  const route = (r: Route) => void webServer.register(r)

  // ---------- 只读:worker 状态(全部项目或指定项目)
  route({
    kind: 'exact',
    path: '/danus/api/workers',
    handler: (req, res) => {
      try {
        const u = url(req)
        const project = u.searchParams.get('project')
        if (!project) {
          // 全项目总览
          json(res, { projects: swarm().list() })
          return
        }
        json(res, { project, workers: swarm().status(project) })
      } catch (e) {
        fail(res, String((e as Error).message ?? e))
      }
    },
  })

  // ---------- 只读:worker 最新轮日志 tail
  route({
    kind: 'exact',
    path: '/danus/api/worker-log',
    handler: (req, res) => {
      try {
        const u = url(req)
        const pdir = projectDirOf(config, u)
        const worker = u.searchParams.get('worker') ?? ''
        if (!PROJECT_NAME_RE.test(worker)) throw new Error(`invalid worker name: ${JSON.stringify(worker)}`)
        const tail = Math.min(Number(u.searchParams.get('tail') ?? 200) || 200, 2000)
        const logsDir = join(pdir, 'workers', worker, 'logs')
        const rounds = existsSync(logsDir)
          ? readdirSync(logsDir).filter((f) => /^round_\d+\.log$/.test(f)).sort((a, b) => {
              return Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0])
            })
          : []
        const latest = rounds.at(-1)
        if (!latest) {
          json(res, { worker, round: null, lines: [] })
          return
        }
        const text = readFileSync(join(logsDir, latest), 'utf8')
        const all = text.split('\n')
        if (all.length > 0 && all[all.length - 1] === '') all.pop()
        const lines = all.slice(-tail)
        json(res, { worker, round: latest, lines })
      } catch (e) {
        fail(res, String((e as Error).message ?? e))
      }
    },
  })

  // ---------- 只读:导出 fact graph(json bundle / markdown 合集)
  route({
    kind: 'exact',
    path: '/danus/api/export',
    handler: (req, res) => {
      try {
        const u = url(req)
        const pdir = projectDirOf(config, u)
        const format = u.searchParams.get('format') ?? 'json'
        const fg = new FactGraph(pdir)
        const ids = fg.list()
        if (format === 'md') {
          const parts = ids.map((fid) => `<!-- fact ${fid} -->\n\n${fg.getRaw(fid) ?? ''}`)
          const r = res as { setHeader?(k: string, v: string): void; end?(v?: string): void }
          r.setHeader?.('Content-Type', 'text/markdown; charset=utf-8')
          r.setHeader?.('Content-Disposition', `attachment; filename="${u.searchParams.get('project')}-facts.md"`)
          r.end?.(parts.join('\n\n---\n\n'))
          return
        }
        const facts = ids.map((fid) => ({
          fact_id: fid,
          raw: fg.getRaw(fid),
          ...parseFrontmatter(fg.getRaw(fid) ?? ''),
        }))
        json(res, { project: u.searchParams.get('project'), count: ids.length, facts })
      } catch (e) {
        fail(res, String((e as Error).message ?? e))
      }
    },
  })

  // ---------- 动作:assign
  route({
    kind: 'exact',
    path: '/danus/api/assign',
    handler: async (req, res) => {
      try {
        const b = await body(req)
        const out = swarm().assign(`${str(b.project)}/${str(b.worker)}`, str(b.task))
        json(res, { ok: true, ...out })
      } catch (e) {
        fail(res, String((e as Error).message ?? e))
      }
    },
  })

  // ---------- 动作:start / stop
  route({
    kind: 'exact',
    path: '/danus/api/worker/start',
    handler: async (req, res) => {
      try {
        const b = await body(req)
        json(res, { ok: true, results: swarm().start(str(b.target), 0) })
      } catch (e) {
        fail(res, String((e as Error).message ?? e))
      }
    },
  })
  route({
    kind: 'exact',
    path: '/danus/api/worker/stop',
    handler: async (req, res) => {
      try {
        const b = await body(req)
        json(res, { ok: true, results: await swarm().stop(str(b.target), b.force === true) })
      } catch (e) {
        fail(res, String((e as Error).message ?? e))
      }
    },
  })

  // ---------- 动作:gm_add(假设管理)
  route({
    kind: 'exact',
    path: '/danus/api/gm/add',
    handler: async (req, res) => {
      try {
        const b = await body(req)
        const u = url(req)
        const pdir = projectDirOf(config, u)
        const id = new GlobalMemory(pdir).append(str(b.kind), str(b.claim), str(b.evidence), 'operator-console', {
          verifiable: typeof b.verifiable === 'boolean' ? b.verifiable : null,
          links: (b.links as Record<string, unknown>) ?? null,
          glossary: (b.glossary as Record<string, unknown>) ?? null,
        })
        json(res, { ok: true, id })
      } catch (e) {
        fail(res, String((e as Error).message ?? e))
      }
    },
  })

  // ---------- 动作:gm set_status
  route({
    kind: 'exact',
    path: '/danus/api/gm/status',
    handler: async (req, res) => {
      try {
        const b = await body(req)
        const pdir = projectDirOf(config, url(req))
        new GlobalMemory(pdir).setStatus(str(b.id), str(b.status), str(b.fact_id) || null)
        json(res, { ok: true })
      } catch (e) {
        fail(res, String((e as Error).message ?? e))
      }
    },
  })

  // ---------- 动作:fact revoke
  route({
    kind: 'exact',
    path: '/danus/api/fact/revoke',
    handler: async (req, res) => {
      try {
        const b = await body(req)
        const pdir = projectDirOf(config, url(req))
        const revoked = new FactGraph(pdir).revoke(str(b.fact_id), str(b.reason, 'operator console revoke'))
        json(res, { ok: true, revoked })
      } catch (e) {
        fail(res, String((e as Error).message ?? e))
      }
    },
  })
}

export function apply(ctx: Context, config: Config): void {
  const webServer = (ctx as unknown as { webServer?: unknown }).webServer as WebServerLike | undefined
  if (webServer) registerConsoleRoutes(ctx, webServer, config)
}
