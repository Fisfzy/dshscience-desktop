/**
 * authoring/driver.ts — 一次性隔离 headless dsh 驱动。替代原版 danus/authoring/driver.py
 * (它包装 codex exec;本版本包装 dsh headless 会话)。
 *
 * write_paper 与 human_summary 都把重生成(整份 .tex / 报告 / auditor 报告)委托给
 * 一个本地 headless dsh,任务文本(完整 prompt)作为位置参数传入 —— 因为 prompt 大,
 * 走 argv 的最后一个(DSH 无 stdin 语义);headless stdout 即产物(driver 捕获)。
 *
 * 隔离:headless 以 cwd = 全新空临时目录 `danus-authoring-*` 运行,所以它没有本地可读
 * 文件;prompt 已经内嵌每个角色所需的一切(含 AGENTS.md)。两种 exec 尾部共用一个 driver:
 *   - 默认 offline((networked=False)):普通 profile(只读 sandbox,无 MCP/web)。
 *   - networked 变体(reference verifier):带 web 权限的 profile(搜索 + 只读 gateway)。
 *
 * TODO-PARITY:原版 prompt 走 stdin(codex `exec ... -`);DSH headless 无 stdin 语义,
 * 任务文本作为最后位置参数传入(等价 headless 的 <task>)。这使 prompt 出现在 argv 中
 * —— 对模型产物无影响,但 argv 会含 prompt 文本(原版刻意避免)。隔离仍成立:prompt
 * 不涉及项目密钥(密钥只存在于 config/*.env,从不进 prompt)。
 *
 * Config(env,调用时读):
 *   DANUS_AUTHORING_PROFILE         offline profile(默认 danus-authoring)
 *   DANUS_AUTHORING_NETWORK_PROFILE networked profile(默认 danus-authoring-networked)
 *   DANUS_AUTHORING_TIMEOUT         超时秒(默认 7200;0 = 无超时)
 *   (model/effort 保留为参数 & envExtra,profile 负责实际绑定)
 */

import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { envInt, envStr } from '../shared/env.ts'
import { runHeadless, type HeadlessRunResult } from '../shared/headless.ts'
import { classifyOutcome, type ClassifiedOutcome, type ClassifyInput } from './common.ts'

export const DEFAULT_TIMEOUT = 7200

export interface RunOnceOptions {
  /** 模型(profile 实际绑定;仅记录/透传为 envExtra)。 */
  model?: string
  /** 推理量(profile 实际绑定;仅记录/透传为 envExtra)。 */
  effort?: string
  /** 超时秒;0/负 = 无超时。 */
  timeout?: number
  /** 是否走带 web 权限的 profile。 */
  networked?: boolean
  /** 显式 profile(覆盖 network/offline 默认)。 */
  profile?: string
}

/**
 * 驱动一次 headless dsh 会话:prompt 作为任务文本(位置参数),stdout 即产物。
 * cwd = 全新空临时目录(隔离)。返回原始 HeadlessRunResult —— 调用方决定诚实性
 * (非零 exit / 空 stdout / 超时不是成功)。超时/缺二进制由 runHeadless 编码为
 * timedOut / spawnError,classifyOutcome 转成诚实非 ok。
 */
export async function runOnce(
  prompt: string,
  opts: RunOnceOptions = {},
): Promise<HeadlessRunResult> {
  const timeout = opts.timeout ?? envInt('DANUS_AUTHORING_TIMEOUT', DEFAULT_TIMEOUT)
  const profile = resolveProfile(opts)
  const cwd = makeEmptyCwd()

  const envExtra: Record<string, string> = {}
  if (opts.model) envExtra['DANUS_AUTHORING_MODEL'] = opts.model
  if (opts.effort) envExtra['DANUS_AUTHORING_EFFORT'] = opts.effort

  try {
    return await runHeadless({
      profile,
      task: prompt,
      cwd,
      timeoutMs: timeout && timeout > 0 ? timeout * 1000 : 0,
      captureStdout: true,
      envExtra,
    })
  } finally {
    // 隔离:cwd 是全新临时目录,用完清掉(原版 tempfile.TemporaryDirectory 语义)。
    try {
      rmSync(cwd, { recursive: true, force: true })
    } catch {
      /* 清理失败不影响主功能 */
    }
  }
}

function resolveProfile(opts: RunOnceOptions): string {
  if (opts.profile) return opts.profile
  if (opts.networked) {
    return envStr('DANUS_AUTHORING_NETWORK_PROFILE', 'danus-authoring-networked')
  }
  return envStr('DANUS_AUTHORING_PROFILE', 'danus-authoring')
}

function makeEmptyCwd(): string {
  const dir = join(tmpdir(), `danus-authoring-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  // runHeadless 不会创建 cwd;spawn 需要它已存在。
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * runOnce + classifyOutcome 的便捷包装:返回诚实分类结果,并附上 stderr_full + cmd
 * (供 run log 记录;classifyOutcome 只保留 stderr_tail)。
 */
export async function driveOnce(
  prompt: string,
  opts: RunOnceOptions & { artifactNoun?: string } = {},
): Promise<ClassifiedOutcome & { stderr_full: string; cmd: string[] }> {
  const res = await runOnce(prompt, opts)
  const classified = classifyRes(res, { artifactNoun: opts.artifactNoun, timeoutSeconds: opts.timeout ?? envInt('DANUS_AUTHORING_TIMEOUT', DEFAULT_TIMEOUT) })
  return {
    ...classified,
    stderr_full: res.stderr ?? '',
    cmd: ['dsh', '--profile', resolveProfile(opts)],
  }
}

/** 把 runHeadless 运行结果转成 classifyOutcome 的输入形状。 */
export function classifyRes(
  res: HeadlessRunResult,
  opts: { artifactNoun?: string; timeoutSeconds?: number } = {},
): ClassifiedOutcome {
  const input: ClassifyInput = {
    exitCode: res.exitCode,
    timedOut: res.timedOut,
    spawnError: res.spawnError,
    stdout: res.stdout,
    stderr: res.stderr,
    timeoutSeconds: opts.timeoutSeconds,
  }
  return classifyOutcome(input, { artifactNoun: opts.artifactNoun })
}
