/**
 * swarm/spawn.ts — 跨平台进程监督。替代原版的 fcntl/killpg//proc(POSIX-only)。
 *
 * - alive:process.kill(pid, 0);POSIX 加 /proc zombie 检测(原版语义);
 *   Windows 无 zombie 概念,直接信任 kill(pid,0)。
 * - spawnLoop:detached 子进程跑 loop-main;日志 logs/loop.log;unref。
 * - stop --force:POSIX killpg(进程组);Windows taskkill /T(进程树)。
 * - start 幂等锁:.pid.lock 用 O_EXCL 创建当跨平台文件锁(替代 fcntl)。
 */

import {
  closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WorkerLayout } from '../shared/layout.ts'

// --------------------------------------------------------------------------- //
// 存活检测(zombie-aware,跨平台)                                              //
// --------------------------------------------------------------------------- //

export function readPid(wl: WorkerLayout): number | null {
  if (!existsSync(wl.pid)) return null
  try {
    const n = Number.parseInt(readFileSync(wl.pid, 'utf8').trim(), 10)
    return Number.isNaN(n) ? null : n
  } catch {
    return null
  }
}

export function alive(pid: number | null | undefined): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return false
    if (code === 'EPERM') return true // 存在但不属我们
    return false
  }
  if (process.platform !== 'win32') {
    // zombie(killed 未被父进程 reaped)实为已死。Linux /proc 告知进程状态。
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      const state = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[0]
      return state !== 'Z'
    } catch {
      return true // /proc 读失败 → 保守为活(原版语义)
    }
  }
  return true
}

// --------------------------------------------------------------------------- //
// start 幂等锁(O_EXCL 文件锁,跨平台;持锁极短)                               //
// --------------------------------------------------------------------------- //

function withLock<T>(lockPath: string, fn: () => T): T | 'locked' {
  let fd: number
  try {
    fd = openSync(lockPath, 'wx') // 排他创建;已存在 → EEXIST
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return 'locked'
    throw e
  }
  try {
    return fn()
  } finally {
    closeSync(fd)
    rmSync(lockPath, { force: true })
  }
}

// --------------------------------------------------------------------------- //
// spawn / stop                                                                //
// --------------------------------------------------------------------------- //

function loopMainPath(): string {
  // <pkg>/src/swarm/spawn.ts → <pkg>/src/swarm/loop-main.ts
  return join(dirname(fileURLToPath(import.meta.url)), 'loop-main.ts')
}

/** tsx ESM loader 说明符(由 loop 子进程以包根为 cwd 解析)。 */
function tsxLoaderArg(): string {
  return 'tsx/esm'
}

/**
 * 分离式启动 worker 外循环(对齐原版 spawn_loop:start_new_session=True)。
 * 返回子进程 pid。
 */
export function spawnLoop(wdir: string): number {
  const wl = new WorkerLayout(wdir)
  const logPath = join(wl.logs, 'loop.log')
  const logFd = openSync(logPath, 'a')
  try {
    const child = spawn(
      process.execPath,
      ['--import', tsxLoaderArg(), loopMainPath(), wdir],
      {
        detached: true, // 新进程组(POSIX)/ 新进程(Windows)
        stdio: ['ignore', logFd, logFd],
        cwd: dirname(dirname(dirname(loopMainPath()))), // 包根:tsx 解析锚点
        env: process.env,
        windowsHide: true,
      },
    )
    child.unref() // detach:web 进程退出不带走 worker
    if (child.pid === undefined) throw new Error('spawn failed: no pid')
    return child.pid
  } finally {
    closeSync(logFd)
  }
}

/** _start_one 等价:锁内幂等 start。返回 'started' | 'already-running' | 'locked'。 */
export function startOne(wl: WorkerLayout, spawnFn: (wdir: string) => number = spawnLoop): string {
  const r = withLock(wl.lock, () => {
    const pid = readPid(wl)
    if (alive(pid)) return 'already-running'
    rmSync(wl.stop, { force: true }) // 清残留 stop 旗标
    const newPid = spawnFn(wl.dir)
    writeFileSync(wl.pid, String(newPid), 'utf8')
    return 'started'
  })
  return r
}

/**
 * _stop_one 等价。force=false:.touch .stop(优雅,轮边界退出);
 * force=true:POSIX killpg / Windows taskkill 进程树,至多等 ~5s 后升级强杀。
 */
export async function stopOne(wl: WorkerLayout, force: boolean): Promise<string> {
  const pid = readPid(wl)
  if (!force) {
    if (!alive(pid)) return 'not-running'
    writeFileSync(wl.stop, '', 'utf8') // touch
    return 'stopping (graceful)'
  }
  if (!alive(pid)) {
    rmSync(wl.pid, { force: true })
    return 'not-running'
  }
  killTree(pid!, false)
  for (let i = 0; i < 50; i++) {
    if (!alive(pid)) break
    await new Promise((r) => setTimeout(r, 100))
  }
  if (alive(pid)) killTree(pid!, true)
  rmSync(wl.pid, { force: true })
  return 'killed'
}

/** POSIX:killpg(detached 子进程自成进程组);Windows:taskkill /T [/F]。 */
function killTree(pid: number, force: boolean): void {
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(pid), '/T', ...(force ? ['/F'] : [])], {
        stdio: 'ignore',
        windowsHide: true,
      })
    } catch { /* 进程可能已退 */ }
  } else {
    try {
      process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM') // 负 pid = 进程组
    } catch { /* ESRCH/EPERM 静默(原版语义) */ }
  }
}
