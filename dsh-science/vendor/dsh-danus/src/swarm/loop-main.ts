/**
 * swarm/loop-main.ts — 被 spawn 的 worker 外循环进程入口。
 * 等价于原版 `python -m danus.execution <wdir>`。
 * 用法:node --import tsx/esm loop-main.ts <worker_dir>
 */

import { existsSync, mkdirSync } from 'node:fs'
import { runHeadless } from '../shared/headless.ts'
import { WorkerLayout } from '../shared/layout.ts'
import { runLoop } from './loop.ts'

async function main(): Promise<number> {
  const wdir = process.argv[2]
  if (!wdir) {
    console.error('usage: loop-main <worker_dir>')
    return 2
  }
  const wl = new WorkerLayout(wdir)
  if (!existsSync(wl.dir)) {
    console.error(`worker dir not found: ${wl.dir}`)
    return 2
  }
  mkdirSync(wl.logs, { recursive: true })

  // 在飞的 headless 子进程引用(SIGTERM 时 terminate —— 对齐原版 _Child.proc)。
  let currentChild: { kill: () => void } | null = null

  const rc = await runLoop(wl, {
    runRound: async (_round, logPath, hardTimeoutSec) => {
      const { kickoff } = await import('./loop.ts')
      const prompt = kickoff(wl.project, wl.name)
      const result = await runHeadless({
        profile: process.env.DANUS_WORKER_PROFILE ?? 'danus-worker',
        task: prompt,
        cwd: wl.dir,
        timeoutMs: hardTimeoutSec > 0 ? hardTimeoutSec * 1000 : 0,
        logPath,
        onSpawn: (child) => {
          currentChild = child
        },
        envExtra: {
          DANUS_PROJECT_DIR: wl.projectDir,
          DANUS_AUTHOR: wl.name,
          DANUS_ROLE: 'worker',
          DANUS_PROBLEM_ID: wl.project,
        },
      })
      if (result.spawnError) return 127 // dsh 二进制缺失,不空转
      if (result.timedOut) return 124
      return result.exitCode ?? 1
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    terminateChild: () => currentChild?.kill(),
  })
  return rc
}

main().then(
  (rc) => process.exit(rc),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
