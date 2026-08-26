/**
 * services/swarm.ts — worker swarm 生命周期库(原 danus.execution.scaffold +
 * danus.orchestration.cli 的 DSH 原生合并)。磁盘布局/文件名与原版一致。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FactGraph } from '../core/factgraph.ts'
import { atomicWrite } from '../core/util.ts'
import { envFirst } from '../shared/env.ts'
import {
  WorkerLayout, listProjects, listWorkers, parseRoles, projectDir, targetWorkerDirs,
  workerMd, workerSkillsDir, resolveTarget,
} from '../shared/layout.ts'
import {
  isDefaultPaper, terminalFacts, validatePaperId, writeTargetFactIds,
} from '../shared/target.ts'
import { alive, readPid, startOne, stopOne } from '../swarm/spawn.ts'
import { envInt } from '../shared/env.ts'

const TASK_PLACEHOLDER =
  '# Task\n\n' +
  '(unassigned — the main agent writes your assignment here via `danus assign`; ' +
  'you read this file at the start of every round)\n'

export const DEFAULT_MODEL = 'gpt-5.6-sol'

/** worker 默认模型:DANUS_WORKER_MODEL → DANUS_MAIN_MODEL(别名 DANUS_CODEX_MODEL)→ 默认。 */
export function defaultWorkerModel(): string {
  return envFirst(['DANUS_WORKER_MODEL', 'DANUS_MAIN_MODEL', 'DANUS_CODEX_MODEL'], DEFAULT_MODEL)
}

export class DanusSwarm {
  /** spawnFn 可注入(测试);默认 spawnLoop(detached 子进程跑外循环)。 */
  readonly spawnFn?: (wdir: string) => number
  /** agentsRoot 覆盖(console-api 按组合配置寻址;缺省走 layout 的 env/默认根)。 */
  readonly root?: string
  constructor(spawnFn?: (wdir: string) => number, root?: string) {
    this.spawnFn = spawnFn
    this.root = root
  }

  private pdir(project: string): string {
    return this.root ? join(this.root, project) : projectDir(project)
  }
  private workerNames(project: string): string[] {
    if (!this.root) return listWorkers(project)
    const wd = join(this.root, project, 'workers')
    if (!existsSync(wd)) return []
    return readdirSync(wd, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
  }
  private targetDirs(target: string): string[] {
    if (!this.root) return targetWorkerDirs(target)
    const root = this.root
    const { project, worker } = resolveTarget(target)
    if (worker) {
      const d = join(root, project, 'workers', worker)
      return existsSync(d) ? [d] : []
    }
    return this.workerNames(project).map((w) => join(root, project, 'workers', w))
  }
  // ------------------------------------------------------------- new
  /** do_new:脚手架项目 + worker 目录;拒绝覆盖已有项目。 */
  newProject(project: string, roles = 'high:3,xhigh:4', model?: string | null): {
    project_dir: string
    workers: string[]
  } {
    const pdir = this.pdir(project)
    if (existsSync(pdir)) {
      throw new Error(`project already exists: ${pdir} (pick another name or remove it)`)
    }
    const resolvedModel = model ?? defaultWorkerModel()
    const pairs = parseRoles(roles)

    mkdirSync(join(pdir, 'workers'), { recursive: true })
    mkdirSync(join(pdir, 'global_memory'), { recursive: true })
    mkdirSync(join(pdir, 'fact_graph'), { recursive: true })

    const created: string[] = []
    for (const [worker, base] of pairs) {
      const wl = new WorkerLayout(join(pdir, 'workers', worker))
      mkdirSync(wl.localMemory, { recursive: true })
      mkdirSync(wl.logs, { recursive: true })
      linkOrCopy(workerMd(), join(wl.dir, 'AGENTS.md'), 'file')
      mkdirSync(join(wl.dir, '.agents'), { recursive: true })
      linkOrCopy(workerSkillsDir(), join(wl.dir, '.agents', 'skills'), 'junction')
      atomicWrite(wl.task, TASK_PLACEHOLDER)
      atomicWrite(wl.role, `MODEL=${resolvedModel}\nREASONING_EFFORT=${base}\nROLE=${base}\nDANUS_AUTHOR=${worker}\n`)
      atomicWrite(wl.status, JSON.stringify({ worker, state: 'created', round: 0 }, null, 2))
      created.push(worker)
    }

    atomicWrite(
      join(pdir, 'project.json'),
      JSON.stringify({ name: project, model: resolvedModel, roles, workers: created }, null, 2),
    )
    return { project_dir: pdir, workers: created }
  }

  // ---------------------------------------------------------- assign
  /** do_assign:覆盖写(非追加)worker 的 TASK.md,确保结尾换行。 */
  assign(target: string, task: string): { worker: string; task_file: string } {
    const { project, worker } = resolveTarget(target)
    if (!worker) throw new Error('assign needs a specific worker: <project>/<worker>')
    const wl = new WorkerLayout(join(this.pdir(project), 'workers', worker))
    if (!existsSync(wl.dir)) throw new Error(`no such worker: ${project}/${worker}`)
    if (!task.trim()) throw new Error('refusing to assign an empty task')
    atomicWrite(wl.task, task.endsWith('\n') ? task : task + '\n')
    return { worker: `${project}/${worker}`, task_file: wl.task }
  }

  // --------------------------------------------------------- finalize
  /** do_finalize:校验每个 fact_id 真实存在,写入该 paper 的 TARGET.md。 */
  finalize(project: string, factIds: string[], paperId: string | null = null): Record<string, unknown> {
    const pdir = this.pdir(project)
    if (!existsSync(pdir)) throw new Error(`no such project: ${project}`)
    const fg = new FactGraph(pdir)

    if (factIds.length === 0) {
      // 建议模式:列候选终端事实,不写任何文件
      return { project, paper_id: paperId, suggested: terminalFacts(fg) }
    }
    const unknown = factIds.filter((fid) => !fg.exists(fid))
    if (unknown.length > 0) {
      throw new Error(
        `cannot finalize: unknown fact id(s) in ${project}: ${unknown.join(', ')} ` +
        "(a target must be a verified fact in the project's graph)",
      )
    }
    if (!isDefaultPaper(paperId)) validatePaperId(paperId!)
    // 去重保序
    const seen = new Set<string>()
    const ids: string[] = []
    for (const fid of factIds) {
      if (!seen.has(fid)) {
        seen.add(fid)
        ids.push(fid)
      }
    }
    const path = writeTargetFactIds(pdir, ids, paperId)
    return { project, paper_id: paperId, target_file: path, target_fact_ids: ids }
  }

  // ------------------------------------------------------------ start
  start(target: string, staggerMs = 200): { worker: string; result: string }[] {
    const dirs = this.targetDirs(target)
    if (dirs.length === 0) throw new Error(`no workers for target ${JSON.stringify(target)}`)
    const out: { worker: string; result: string }[] = []
    for (let i = 0; i < dirs.length; i++) {
      if (i && staggerMs) sleepSync(staggerMs)
      const wl = new WorkerLayout(dirs[i]!)
      mkdirSync(wl.dir, { recursive: true })
      mkdirSync(wl.logs, { recursive: true })
      out.push({ worker: wl.name, result: startOne(wl, this.spawnFn) })
    }
    return out
  }

  // ----------------------------------------------------------- status
  workerStatus(wl: WorkerLayout): Record<string, unknown> {
    const pid = readPid(wl)
    const isAlive = alive(pid)
    const st = readStatus(wl)
    const state = (st.state as string) ?? '—'
    const now = Date.now() / 1000
    const last = (st.last_round_at ?? st.round_started_at ?? st.updated_at) as number | undefined
    const age = typeof last === 'number' ? now - last : null

    let label: string
    if (isAlive) {
      const rs = st.round_started_at as number | undefined
      const hard = envInt('DANUS_ROUND_HARD_TIMEOUT', 14400)
      if (state === 'running' && typeof rs === 'number' && now - rs > hard * 1.5) {
        label = 'stuck?'
      } else {
        label = 'working'
      }
    } else {
      label = ['stopped', 'deadline', 'max_rounds', 'error', 'terminated', 'created'].includes(state)
        ? state
        : 'dead'
    }
    return {
      worker: wl.name,
      pid,
      alive: isAlive,
      state,
      round: (st.round as number) ?? 0,
      age_s: age !== null ? Math.round(age * 10) / 10 : null,
      last_fact_id: st.last_fact_id ?? null,
      label,
    }
  }

  status(target: string): Record<string, unknown>[] {
    const dirs = this.targetDirs(target)
    if (dirs.length === 0) throw new Error(`no workers for target ${JSON.stringify(target)}`)
    return dirs.map((d) => this.workerStatus(new WorkerLayout(d)))
  }

  // ------------------------------------------------------------- stop
  async stop(target: string, force = false): Promise<{ worker: string; result: string }[]> {
    const dirs = this.targetDirs(target)
    if (dirs.length === 0) throw new Error(`no workers for target ${JSON.stringify(target)}`)
    const out: { worker: string; result: string }[] = []
    for (const d of dirs) {
      const wl = new WorkerLayout(d)
      out.push({ worker: wl.name, result: await stopOne(wl, force) })
    }
    return out
  }

  // ------------------------------------------------------------- list
  list(): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = []
    const projects = this.root
      ? (existsSync(this.root)
          ? readdirSync(this.root, { withFileTypes: true })
              .filter((d) => d.isDirectory() && existsSync(join(this.root!, d.name, 'workers')))
              .map((d) => d.name)
              .sort()
          : [])
      : listProjects()
    for (const project of projects) {
      let meta: Record<string, unknown> = {}
      const mp = join(this.pdir(project), 'project.json')
      if (existsSync(mp)) {
        try {
          meta = JSON.parse(readFileSync(mp, 'utf8'))
        } catch {
          meta = {}
        }
      }
      const workers = this.workerNames(project)
      const live = workers.filter((w) => alive(readPid(new WorkerLayout(join(this.pdir(project), 'workers', w))))).length
      out.push({ project, workers: workers.length, live, model: meta.model ?? '—' })
    }
    return out
  }
}

// --------------------------------------------------------------------------- //
// helpers                                                                      //
// --------------------------------------------------------------------------- //

function readStatus(wl: WorkerLayout): Record<string, unknown> {
  if (!existsSync(wl.status)) return {}
  try {
    return JSON.parse(readFileSync(wl.status, 'utf8'))
  } catch {
    return {}
  }
}

/** symlink 优先;失败回退复制(文件)/ 依赖 junction(目录)。 */
function linkOrCopy(target: string, link: string, type: 'file' | 'junction'): void {
  if (existsSync(link)) return
  try {
    symlinkSync(target, link, type)
  } catch {
    try {
      copyFileSync(target, link)
    } catch { /* 原版语义:symlink 不支持时静默 */ }
  }
}

/** start 的 stagger 间隔(同步短睡,对齐原版 time.sleep(0.2))。 */
function sleepSync(ms: number): void {
  const end = Date.now() + ms
  while (Date.now() < end) { /* busy wait,≤200ms,与原版一致 */ }
}
