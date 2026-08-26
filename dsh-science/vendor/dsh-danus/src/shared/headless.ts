/**
 * shared/headless.ts — dsh headless 进程 spawn 共享层。
 * 替代原版 danus/codex.py:每个需要"一个全新隔离 agent 会话"的地方
 * (worker 轮、冷启动 verifier、authoring 渲染器)都经这里解析 bin/env/命令,
 * 保证处处一致。
 *
 * 命令形态:dsh --profile <profile> "<task>"(cwd 决定 workspace 根)。
 * 改进点:Windows 下自动解析 dsh.cmd;超长 task 落临时文件防 argv 长度上限。
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { createWriteStream } from 'node:fs'
import { envStr } from './env.ts'

/** Windows CreateProcess argv 上限 32767;留余量。 */
const ARGV_SAFE_LEN = 30000

/** 在 PATH 上找可执行名(Windows 自动试 .cmd/.exe/.bat)。 */
export function findOnPath(bin: string): string | null {
  if (isAbsolute(bin)) return existsSync(bin) ? bin : null
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : ['']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const p = join(dir, bin + ext)
      if (existsSync(p)) return p
    }
  }
  return null
}

/**
 * dsh 二进制解析(优先级,对齐原版 resolve_bin):
 * 1. DSH_BIN env(绝对路径原样;.js/.mjs 脚本自动走 node;否则 PATH 查找,找不到回裸名);
 * 2. PATH 上的 dsh;3. 裸 'dsh'(spawn 时抛清晰 ENOENT)。
 */
export function resolveDshBin(): string {
  const override = envStr('DSH_BIN')
  if (override) {
    if (isAbsolute(override)) return override
    return findOnPath(override) ?? override
  }
  return findOnPath('dsh') ?? 'dsh'
}

/** 若 bin 是 JS 脚本,用当前 node 解释器运行(返回 [execPath, argv])。 */
export function binToSpawn(bin: string, args: string[]): { cmd: string; argv: string[] } {
  if (/\.m?js$/i.test(bin)) return { cmd: process.execPath, argv: [bin, ...args] }
  // Windows .cmd/.bat shim 不能脱离 cmd.exe spawn(EINVAL);解析 shim 里的
  // node + 目标 .js(npm 标准 shim 形态),直接 node 运行,完全绕过 cmd。
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
    const js = extractShimTarget(bin)
    if (js) return { cmd: process.execPath, argv: [js, ...args] }
    const comspec = process.env.ComSpec ?? 'cmd.exe'
    return { cmd: comspec, argv: ['/d', '/s', '/c', bin, ...args.map(cmdQuote)] }
  }
  return { cmd: bin, argv: args }
}

/** 从 npm .cmd shim 提取目标 .js 绝对路径(找不到 → null)。 */
function extractShimTarget(shimPath: string): string | null {
  try {
    const text = readFileSync(shimPath, 'utf8')
    const m = text.match(/"([^"]+\.js)"\s+%\*/) ?? text.match(/node[^\n]*?"([^"]+\.js)"/)
    if (!m) return null
    const shimDir = dirname(shimPath)
    return resolve(shimDir, m[1]!.replace(/%~dp0|%dp0%/g, shimDir + '\\'))
  } catch {
    return null
  }
}

/** cmd /c 的最小参数引号化。 */
function cmdQuote(a: string): string {
  return /[\s"]/.test(a) ? '"' + a.replace(/"/g, '\\"') + '"' : a
}

export interface HeadlessRunOptions {
  /** dsh profile 名(如 danus-worker / danus-verifier)。 */
  profile: string
  /** 任务文本(headless 的位置参数)。 */
  task: string
  /** 工作目录 = 该会话的 workspace 根。 */
  cwd: string
  /** 超时毫秒;<=0 或 undefined = 无超时(对齐原版 timeout=None)。 */
  timeoutMs?: number
  /** stdout/stderr 追加写入的日志文件路径。 */
  logPath?: string
  /** 额外环境(合并在 process.env 之上)。 */
  envExtra?: Record<string, string>
  /** 超长 task 落盘目录(默认 os.tmpdir())。 */
  spillDir?: string
  /** spawn 成功即回调(供调用方在 SIGTERM 时 terminate 在飞子进程)。 */
  onSpawn?: (child: { kill: (signal?: string) => void }) => void
  /** 捕获 stdout 进返回值(authoring 驱动:stdout 即产物)。 */
  captureStdout?: boolean
  /** 外部取消信号(exec.signal 透传):abort → 终止子进程。 */
  signal?: AbortSignal
}

export interface HeadlessRunResult {
  exitCode: number | null
  timedOut: boolean
  /** 实际作为 argv 传入的 task(超长时被落盘路径替换)。 */
  effectiveTask: string
  /** spawn 失败(如 ENOENT)时的错误。 */
  spawnError?: string
  /** captureStdout 时收集到的 stdout。 */
  stdout?: string
  /** captureStdout 时收集到的 stderr。 */
  stderr?: string
}

/**
 * 跑一次 headless 会话。stdin 关闭(对齐原版 DEVNULL);
 * stdout+stderr 进 logPath(若给)。绝不抛 spawn 之外的错误。
 */
export async function runHeadless(opts: HeadlessRunOptions): Promise<HeadlessRunResult> {
  const bin = resolveDshBin()
  let task = opts.task
  if (task.length > ARGV_SAFE_LEN) {
    // 改进点:防 Windows argv 上限;agent 用 fs 工具读任务文件,语义等价。
    const dir = opts.spillDir ?? tmpdir()
    mkdirSync(dir, { recursive: true })
    const taskFile = join(dir, `danus-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`)
    writeFileSync(taskFile, task, 'utf8')
    task = `Your task is written in the file at ${taskFile} — read it with your file tools and follow it exactly.`
  }

  const args = ['--profile', opts.profile, task]
  const env = { ...process.env, ...(opts.envExtra ?? {}) }
  const { cmd, argv } = binToSpawn(bin, args)

  return await new Promise<HeadlessRunResult>((resolve) => {
    let child
    try {
      child = spawn(cmd, argv, {
        cwd: opts.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (e) {
      resolve({ exitCode: null, timedOut: false, effectiveTask: task, spawnError: String(e) })
      return
    }
    opts.onSpawn?.({ kill: (signal?: string) => child.kill(signal as NodeJS.Signals) })
    // exec.signal 透传:abort → 终止子进程(走 close 路径正常结算)。
    if (opts.signal) {
      if (opts.signal.aborted) child.kill()
      else opts.signal.addEventListener('abort', () => child.kill(), { once: true })
    }

    const log = opts.logPath ? createWriteStream(opts.logPath, { flags: 'a' }) : null
    let stdoutBuf = ''
    let stderrBuf = ''
    child.stdout?.on('data', (d) => {
      if (opts.captureStdout) stdoutBuf += d
      log?.write(d)
    })
    child.stderr?.on('data', (d) => {
      if (opts.captureStdout) stderrBuf += d
      log?.write(d)
    })

    let timedOut = false
    const timer =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            child.kill('SIGTERM')
            // 10s 后升级 SIGKILL(对齐原版 terminate → wait 10s → kill)。
            setTimeout(() => child.kill('SIGKILL'), 10_000).unref()
          }, opts.timeoutMs)
        : null
    timer?.unref()

    child.on('error', (e) => {
      if (timer) clearTimeout(timer)
      log?.end()
      resolve({ exitCode: null, timedOut, effectiveTask: task, spawnError: String(e), stdout: stdoutBuf, stderr: stderrBuf })
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      log?.end()
      resolve({ exitCode: code, timedOut, effectiveTask: task, stdout: stdoutBuf, stderr: stderrBuf })
    })
  })
}
