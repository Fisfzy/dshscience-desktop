/**
 * services/verify.ts — 冷启动验证器服务(唯一数学正确性写门)。
 * 移植自 danus/verify/{service,launcher,prechecks}.py:
 *   prechecks(纯函数)→ run_id 分配 → agent home 预备 → 冷启动 headless judge
 *   → verification.json 解析 → verdict payload。
 *
 * 与原版的架构差异:去掉 HTTP 中间层(8091),gateway 进程内直调;
 * judge 由 `dsh --profile danus-verifier` 替代 `codex exec`。
 * 错误语义对齐原版 HTTPException:status(400/500/504)+ detail 消息。
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPrechecks } from '../core/prechecks.ts'
import { envInt, envStr } from '../shared/env.ts'
import { runHeadless } from '../shared/headless.ts'

/** 输出文件名;第二个是原版刻意保留的拼写错误(parity)。 */
export const VERIFICATION_FILENAMES = ['verification.json', 'verificationt.json']

export class VerifyError extends Error {
  readonly status: number
  readonly detail: string
  constructor(status: number, detail: string) {
    super(detail)
    this.name = 'VerifyError'
    this.status = status
    this.detail = detail
  }
}

export interface VerifyConfig {
  /** dsh profile(judge 会话用)。默认 danus-verifier。 */
  profile?: string
  /** verifier agent home(合同 + skills)。默认 <stateDir>/agent。 */
  agentHome?: string
  /** 运行结果根。默认 <stateDir>/runs。 */
  resultsRoot?: string
  /** 状态根(以上两者的默认锚)。默认 <cwd>/runtime/danus/verify。 */
  stateDir?: string
  /** judge 超时秒;0 = 无超时(原版库默认;入口默认 900)。 */
  timeoutSeconds?: number
  /** verifier 合同 canonical 源(默认本包 contracts/verifier.md)。 */
  contractPath?: string
  /** verifier skills canonical 源(默认本包 skills/verify)。 */
  skillsDir?: string
}

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
}

export class DanusVerify {
  readonly config: VerifyConfig
  constructor(config: VerifyConfig = {}) {
    this.config = config
  }

  private get stateDir(): string {
    return resolve(this.config.stateDir ?? envStr('DANUS_VERIFY_STATE_DIR', join(process.cwd(), 'runtime', 'danus', 'verify')))
  }
  get agentHome(): string {
    return resolve(this.config.agentHome ?? (envStr('VERIFY_AGENT_HOME') || join(this.stateDir, 'agent')))
  }
  get resultsRoot(): string {
    // 默认落在 agent home 内:headless judge 的 workspace = agent home,
    // workspace-write 策略下只有 home 内可写(原版在 home 外,POSIX 无此约束)。
    return resolve(this.config.resultsRoot ?? (envStr('VERIFIER_RESULTS_DIR') || join(this.agentHome, 'runs')))
  }
  private get timeoutSeconds(): number {
    // 库默认无超时(0);DANUS 入口习惯 900 由组合层给。
    return this.config.timeoutSeconds ?? envInt('CODEX_TIMEOUT_SECONDS', 0)
  }
  private get profile(): string {
    return this.config.profile ?? envStr('DANUS_VERIFIER_PROFILE', 'danus-verifier')
  }

  // ------------------------------------------------------------- run id 分配
  private utcTimestamp(): string {
    // %Y%m%dT%H%M%SZ
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  }

  generateRunId(statement: string): string {
    const digest = createHash('sha256').update(statement, 'utf8').digest('hex').slice(0, 12)
    return `${this.utcTimestamp()}_${digest}`
  }

  /** 分配唯一 run_id:冲突加 _N 后缀,最多 10000 次(并发共享绝不互覆)。 */
  allocateRunId(statement: string): string {
    const root = this.resultsRoot
    mkdirSync(root, { recursive: true })
    const base = this.generateRunId(statement)
    let runId = base
    let suffix = 0
    for (let i = 0; i < 10000; i++) {
      try {
        mkdirSync(join(root, runId))
        return runId
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
        suffix += 1
        runId = `${base}_${suffix}`
      }
    }
    throw new VerifyError(500, `could not allocate a unique run_id under ${root} for base=${base}`)
  }

  private resultsDir(runId: string): string {
    return join(this.resultsRoot, runId)
  }

  /** 按 VERIFICATION_FILENAMES 顺序找第一个存在的输出文件;找不到 → null。 */
  verificationPath(runId: string): string | null {
    for (const name of VERIFICATION_FILENAMES) {
      const p = join(this.resultsDir(runId), name)
      if (existsSync(p)) return p
    }
    return null
  }

  // ------------------------------------------------------------ agent home
  /**
   * 预备 verifier agent home(幂等):AGENTS.md + .agents/skills 指向 canonical 源。
   * Windows 改进:目录用 junction(免管理员),文件失败时复制。
   */
  ensureAgentHome(): string {
    const home = this.agentHome
    const agentsMd = join(home, 'AGENTS.md')
    const skillsLink = join(home, '.agents', 'skills')
    if (existsSync(agentsMd) && existsSync(skillsLink)) return home // 幂等 no-op

    const contract = this.config.contractPath ?? join(packageRoot(), 'contracts', 'verifier.md')
    const skills = this.config.skillsDir ?? join(packageRoot(), 'skills', 'verify')
    if (!existsSync(contract) || !existsSync(skills)) return home // 源缺失不建断链(原版语义)

    mkdirSync(join(home, '.agents'), { recursive: true })
    linkOrCopy(contract, agentsMd, 'file')
    linkOrCopy(skills, skillsLink, 'junction')
    return home
  }

  // --------------------------------------------------------------- prompt
  buildPrompt(runId: string, statement: string, proof: string): string {
    const outputPath = join(this.resultsDir(runId), VERIFICATION_FILENAMES[0]!)
    return (
      `Run_id: ${runId}. ` +
      `Statement: ${statement}. ` +
      `Proof:\n${proof}\n\n` +
      'Use AGENTS.md to verify the above proof for the statement. ' +
      `Write the verification JSON to this exact path: ${outputPath}.`
    )
  }

  // ---------------------------------------------------------------- 主入口
  /**
   * 验证 (statement, proof)。返回 judge 写的 verdict payload(dict)。
   * 抛出 VerifyError(status, detail):400 预检拒绝;500 judge 失败/输出问题;504 超时。
   */
  async verify(statement: string, proof: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (!statement || !proof) {
      throw new VerifyError(422, 'statement and proof must be non-empty strings')
    }
    const rejected = runPrechecks(statement, proof)
    if (rejected) throw new VerifyError(rejected.status, rejected.detail)

    const runId = this.allocateRunId(statement)
    return await this.runJudge(runId, statement, proof, signal)
  }

  /** run_codex_verification 等价:跑冷启动 judge,读回 verification.json。 */
  async runJudge(runId: string, statement: string, proof: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const resultsDir = this.resultsDir(runId)
    mkdirSync(resultsDir, { recursive: true })
    const logPath = join(resultsDir, 'log.md')
    const home = this.ensureAgentHome()
    const startedAt = new Date().toISOString()
    writeFileSync(logPath, `started_at_utc: ${startedAt}\nprofile: ${this.profile}\n\n`, 'utf8')

    const result = await runHeadless({
      profile: this.profile,
      task: this.buildPrompt(runId, statement, proof),
      cwd: home,
      timeoutMs: this.timeoutSeconds > 0 ? this.timeoutSeconds * 1000 : 0,
      logPath,
      signal,
      envExtra: { DANUS_ROLE: 'verifier' },
    })

    if (result.spawnError) {
      throw new VerifyError(500, `dsh headless failed to start: ${result.spawnError}. See log at ${logPath}`)
    }
    if (result.timedOut) {
      throw new VerifyError(504, `dsh headless timed out after ${this.timeoutSeconds}s. See log at ${logPath}`)
    }
    if (result.exitCode !== 0) {
      throw new VerifyError(500, `dsh headless failed with exit code ${result.exitCode}. See log at ${logPath}`)
    }

    const vpath = this.verificationPath(runId)
    if (vpath === null) {
      const expected = join(resultsDir, VERIFICATION_FILENAMES[0]!)
      throw new VerifyError(500, `verification output was not found at ${expected}. See log at ${logPath}`)
    }
    let payload: unknown
    try {
      payload = JSON.parse(readFileSync(vpath, 'utf8'))
    } catch {
      throw new VerifyError(500, `verification output at ${vpath} is not valid JSON`)
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new VerifyError(500, `verification output at ${vpath} must be a JSON object`)
    }
    return payload as Record<string, unknown>
  }
}

/** symlink 优先;失败回退复制(文件)/ junction(目录,Windows 免管理员)。 */
function linkOrCopy(target: string, link: string, type: 'file' | 'junction'): void {
  if (existsSync(link)) return
  try {
    symlinkSync(target, link, type)
  } catch {
    try {
      copyFileSync(target, link)
    } catch { /* 原版语义:symlink 不支持时静默,worker 不坏 */ }
  }
}
