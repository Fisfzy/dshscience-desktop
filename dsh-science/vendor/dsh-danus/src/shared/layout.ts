/**
 * shared/layout.ts — 磁盘布局、项目/worker 解析、roles 解析的唯一真源。
 * 移植自 danus/execution/layout.py + scaffold.py 的 parse_roles;
 * swarm 服务与编排工具共享此模块,两半永不漂移。
 *
 * 所有 env 在调用时读取(非 import 时)。
 */

import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { envStr } from './env.ts'

// --------------------------------------------------------------------------- //
// per-worker 控制文件名(单一出处)                                            //
// --------------------------------------------------------------------------- //

export const TASK_FILE = 'TASK.md'
export const ROLE_FILE = '.role'
export const PID_FILE = '.pid'
export const LOCK_FILE = '.pid.lock'
export const STOP_FILE = '.stop'
export const STATUS_FILE = '.status.json'
export const LOGS_DIR = 'logs'
export const DEADLINE_FILE = '.run_deadline'

// --------------------------------------------------------------------------- //
// 根目录(调用时读 env)                                                       //
// --------------------------------------------------------------------------- //

/** 本包根(contracts/ 与 skills/ 的 canonical 源所在)。 */
export function packageRoot(): string {
  // <pkg>/src/shared/layout.ts → 上溯两级 = <pkg>
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
}

/** 项目根。DANUS_AGENTS_ROOT 可覆盖;默认 <cwd>/runtime/projects。 */
export function agentsRoot(): string {
  const env = envStr('DANUS_AGENTS_ROOT')
  if (env) return resolve(env)
  return resolve(process.cwd(), 'runtime', 'projects')
}

/** worker 合同(worker.md)路径;DANUS_WORKER_CONTRACT 可覆盖。 */
export function workerMd(): string {
  const env = envStr('DANUS_WORKER_CONTRACT')
  if (env) return resolve(env)
  return join(packageRoot(), 'contracts', 'worker.md')
}

/** worker skills 目录;DANUS_WORKER_SKILLS 可覆盖。 */
export function workerSkillsDir(): string {
  const env = envStr('DANUS_WORKER_SKILLS')
  if (env) return resolve(env)
  return join(packageRoot(), 'skills', 'worker')
}

// --------------------------------------------------------------------------- //
// 项目 / worker 目录                                                          //
// --------------------------------------------------------------------------- //

export function projectDir(project: string): string {
  return join(agentsRoot(), project)
}
export function workersDir(project: string): string {
  return join(projectDir(project), 'workers')
}
export function workerDir(project: string, worker: string): string {
  return join(workersDir(project), worker)
}

export function listWorkers(project: string): string[] {
  const wd = workersDir(project)
  if (!existsSync(wd)) return []
  return readdirSync(wd, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
}

export function listProjects(): string[] {
  const root = agentsRoot()
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, 'workers')))
    .map((d) => d.name)
    .sort()
}

// --------------------------------------------------------------------------- //
// 目标解析("proj" | "proj/worker")                                          //
// --------------------------------------------------------------------------- //

export function resolveTarget(target: string): { project: string; worker: string | null } {
  const cleaned = target.replace(/^\/+|\/+$/g, '')
  const [project, worker] = cleaned.split('/', 2)
  return { project: project!, worker: worker || null }
}

export function targetWorkerDirs(target: string): string[] {
  const { project, worker } = resolveTarget(target)
  if (worker) {
    const d = workerDir(project, worker)
    return existsSync(d) ? [d] : []
  }
  return listWorkers(project).map((w) => workerDir(project, w))
}

// --------------------------------------------------------------------------- //
// WorkerLayout —— worker 家目录的便捷视图                                      //
// --------------------------------------------------------------------------- //

export class WorkerLayout {
  readonly dir: string
  constructor(dir: string) {
    this.dir = dir
  }

  get name(): string {
    return basenameOf(this.dir)
  }
  get projectDir(): string {
    return dirname(dirname(this.dir))
  }
  get project(): string {
    return basenameOf(this.projectDir)
  }
  get task(): string {
    return join(this.dir, TASK_FILE)
  }
  get role(): string {
    return join(this.dir, ROLE_FILE)
  }
  get pid(): string {
    return join(this.dir, PID_FILE)
  }
  get lock(): string {
    return join(this.dir, LOCK_FILE)
  }
  get stop(): string {
    return join(this.dir, STOP_FILE)
  }
  get status(): string {
    return join(this.dir, STATUS_FILE)
  }
  get logs(): string {
    return join(this.dir, LOGS_DIR)
  }
  get localMemory(): string {
    return join(this.dir, 'local_memory')
  }
}

function basenameOf(p: string): string {
  const norm = p.replace(/[\\/]+$/, '')
  const i = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'))
  return i < 0 ? norm : norm.slice(i + 1)
}

// --------------------------------------------------------------------------- //
// roles 解析("high:3,xhigh:4")                                              //
// --------------------------------------------------------------------------- //

const ROLE_RE = /^([A-Za-z][A-Za-z0-9_]*?):(\d+)$/

/** parse_roles:返回 [workerName, baseRole] 对列表(有序)。 */
export function parseRoles(spec: string): [string, string][] {
  if (!spec || !spec.trim()) throw new Error('empty role spec')
  const out: [string, string][] = []
  for (const raw of spec.split(',')) {
    const part = raw.trim()
    if (!part) continue
    const m = part.match(ROLE_RE)
    if (!m) throw new Error(`invalid role spec part: ${JSON.stringify(part)}`)
    const base = m[1]!
    const count = Number.parseInt(m[2]!, 10)
    if (count < 1) throw new Error(`invalid role count in: ${part}`)
    for (let i = 1; i <= count; i++) {
      out.push([i === 1 ? base : `${base}${i}`, base])
    }
  }
  if (out.length === 0) throw new Error('empty role spec')
  return out
}
