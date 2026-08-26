/**
 * authoring/common.ts — 产物渲染通用纯原语。移植自 danus/authoring/common.py。
 *
 * 所有函数纯函数、无网络、无 codex,可直接测试:
 *   - resolveProject            —— DANUS_AGENTS_ROOT / DANUS_PROJECT_DIR 解析(路径逃逸校验)
 *   - section                   —— BEGIN/END prompt 段落包装
 *   - readFixed / readProject   —— 逐字、响亮失败的文件读取
 *   - bodySections              —— frontmatter 擦洗(fact body)
 *   - classifyOutcome           —— 对 headless 运行结果做诚实分类
 *   - leakFindings              —— 通用泄漏扫描器(调用方提供自己的 pattern 集)
 *
 * env 在调用时读取(非 import 时)。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const PROJECT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export const _STDERR_TAIL_CHARS = 2000

/** read_fixed / read_project 缺文件时抛出的错误(消息逐字对齐原版)。 */
export class FileNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileNotFoundError'
  }
}

// --------------------------------------------------------------------------- //
// project 解析(env 在调用时读)                                               //
// --------------------------------------------------------------------------- //

/** 解析要操作的项目目录。`project`(main agent 的每次调用选择器)按名寻址
 * `<agents_root>/<project>`;名字校验为单个路径段,永不逃逸 agents root。
 * 不给 project 时回退 DANUS_PROJECT_DIR。返回目录根字符串。 */
export function resolveProject(project?: string | null): string {
  const agentsRoot = process.env.DANUS_AGENTS_ROOT ?? ''
  const projectDir = process.env.DANUS_PROJECT_DIR ?? ''
  if (project) {
    if (!agentsRoot) {
      throw new Error('DANUS_AGENTS_ROOT is not set; cannot resolve a project by name')
    }
    if (!PROJECT_NAME_RE.test(project)) {
      throw new Error(`invalid project name: ${JSON.stringify(project)}`)
    }
    const pdir = join(agentsRoot, project)
    if (!existsSync(pdir)) {
      throw new Error(`no such project: ${JSON.stringify(project)} (under ${agentsRoot})`)
    }
    return pdir
  }
  if (!projectDir) {
    throw new Error('DANUS_PROJECT_DIR is not set and no project was given')
  }
  return projectDir
}

// --------------------------------------------------------------------------- //
// prompt section helpers                                                      //
// --------------------------------------------------------------------------- //

/** 用显式 BEGIN/END 分隔符包 body,使测试可以断言段落有无、codex 可导航。 */
export function section(name: string, body: string): string {
  return `\n\n===== BEGIN ${name} =====\n${body}\n===== END ${name} =====\n`
}

/** 逐字、整段读取 fixed skill 文件;缺文件响亮失败 —— 绝不静默丢必需文件。 */
export function readFixed(skillDir: string, rel: string): string {
  const path = join(skillDir, rel)
  if (!existsSync(path)) {
    throw new FileNotFoundError(
      `required fixed file is missing: ${path} (skill_dir=${skillDir})`,
    )
  }
  return readFileSync(path, 'utf8')
}

/** 逐字、整段读取项目内必需文件;缺文件响亮失败 —— 绝不静默丢必需文件。 */
export function readProject(projectDir: string, rel: string): string {
  const path = join(projectDir, rel)
  if (!existsSync(path)) {
    throw new FileNotFoundError(`required project file is missing: ${path}`)
  }
  return readFileSync(path, 'utf8')
}

// --------------------------------------------------------------------------- //
// fact-body scrub                                                             //
// --------------------------------------------------------------------------- //

/**
 * fact 正文 —— 从第一个 `## ` 标题起的全部内容(即 `## statement` / `## proof` /
 * `## intuition` 段),YAML frontmatter 被剥掉。这是擦洗:fact_id / author /
 * problem_id / predecessors / glossary_introduces / external_refs 不进 codex ——
 * 渲染器从数学出发,而非管线 id。正文逐字保留,绝不总结证明。
 */
export function bodySections(raw: string): string {
  const lines = raw.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trimStart().startsWith('## ')) {
      return lines.slice(i).join('\n').replace(/\s+$/, '') + '\n'
    }
  }
  // 无正文标题(畸形 fact)—— 返回闭 fence 之后的内容,而非泄漏 frontmatter。
  if (lines.length > 0 && lines[0]!.trim() === '---') {
    let close = -1
    for (let j = 1; j < lines.length; j++) {
      if (lines[j]!.trim() === '---') {
        close = j
        break
      }
    }
    if (close !== -1) {
      return lines.slice(close + 1).join('\n').trimEnd() + '\n'
    }
  }
  return raw.trimEnd() + '\n'
}

// --------------------------------------------------------------------------- //
// codex-outcome 诚实分类器                                                     //
// --------------------------------------------------------------------------- //

export interface ClassifyInput {
  /** 进程退出码;null = 未启动/被信号杀死等。 */
  exitCode: number | null
  timedOut: boolean
  spawnError?: string
  stdout?: string
  stderr?: string
  /** 超时秒(用于 timeout 错误消息;原版 cp.timeout)。 */
  timeoutSeconds?: number
}

export interface ClassifiedOutcome {
  status: string
  returncode: number | null
  stdout: string
  stderr_tail: string
  error?: string
}

/**
 * 对一次 headless codex 运行做诚实分类。`status='ok'` 需要零退出码且非空 stdout ——
 * 非零退出、超时、缺二进制、空 stdout 绝不报告为成功。`artifactNoun` 命名
 * 期待之物("artifact" / "report"),用于空 stdout 消息。
 */
export function classifyOutcome(
  cp: ClassifyInput,
  opts: { artifactNoun?: string } = {},
): ClassifiedOutcome {
  const artifactNoun = opts.artifactNoun ?? 'artifact'
  if (cp.timedOut) {
    const t = cp.timeoutSeconds ?? 0
    return {
      status: 'timeout',
      returncode: null,
      stdout: '',
      stderr_tail: '',
      error: `codex timed out after ${t}s`,
    }
  }
  if (cp.spawnError) {
    return {
      status: 'error',
      returncode: null,
      stdout: '',
      stderr_tail: '',
      error: `codex binary not found: ${cp.spawnError}`,
    }
  }
  const stdout = cp.stdout ?? ''
  const stderrTail = (cp.stderr ?? '').slice(-_STDERR_TAIL_CHARS)
  if (cp.exitCode !== 0 && cp.exitCode !== null) {
    return {
      status: 'error',
      returncode: cp.exitCode,
      stdout,
      stderr_tail: stderrTail,
      error: `codex exited with nonzero code ${cp.exitCode}`,
    }
  }
  if (!stdout.trim()) {
    return {
      status: 'error',
      returncode: cp.exitCode,
      stdout: '',
      stderr_tail: stderrTail,
      error: `codex produced empty stdout (no ${artifactNoun})`,
    }
  }
  return { status: 'ok', returncode: cp.exitCode, stdout, stderr_tail: stderrTail }
}

// --------------------------------------------------------------------------- //
// 通用泄漏扫描器                                                              //
// --------------------------------------------------------------------------- //

/** `text` 中每个泄漏 pattern 命中(人类可读)。每个 pattern 项是 `(regex, label)`;
 * 调用方提供适合其产物各自的 pattern 集。空列表 ⇒ 该文本对所有提供的 pattern 干净。 */
export function leakFindings(text: string, patterns: [RegExp, string][]): string[] {
  const hits: string[] = []
  for (const [regex, label] of patterns) {
    const m = text.match(regex)
    if (m) hits.push(`${label}: matched ${JSON.stringify(m[0])}`)
  }
  return hits
}
