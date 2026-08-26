/**
 * shared/target.ts — finalize 的 TARGET.md 读写(移植自 danus/write_paper/assemble.py
 * 中被编排层复用的部分):_terminal_facts / write_target_fact_ids / target_fact_ids /
 * _is_default_paper / _validate_paper_id。
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { atomicWrite } from '../core/util.ts'
import type { FactGraph } from '../core/factgraph.ts'

export const DEFAULT_PAPER_ID = 'main'
export const PROJECT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const TARGET_ID_RE = /fact_[A-Za-z0-9_]+|\b[0-9a-f]{8,}\b/g

export function isDefaultPaper(paperId: string | null | undefined): boolean {
  return !paperId || paperId === DEFAULT_PAPER_ID
}

export function validatePaperId(paperId: string): void {
  if (!PROJECT_NAME_RE.test(paperId)) {
    throw new Error(`invalid paper_id: ${JSON.stringify(paperId)} (single safe path segment)`)
  }
}

/** 终端事实:不是任何其他事实的前驱(DAG 里的候选目标)。 */
export function terminalFacts(fg: FactGraph): string[] {
  const allIds = fg.list()
  const isPredecessor = new Set<string>()
  for (const fid of allIds) {
    for (const p of fg.predecessors(fid)) isPredecessor.add(p)
  }
  return allIds.filter((fid) => !isPredecessor.has(fid))
}

/** TARGET.md 路径:默认 paper = <project>/TARGET.md;否则 papers/<id>/TARGET.md。 */
export function targetPath(projectDir: string, paperId?: string | null): string {
  if (isDefaultPaper(paperId)) return join(projectDir, 'TARGET.md')
  return join(projectDir, 'papers', paperId!, 'TARGET.md')
}

const TARGET_HEADER = [
  '# TARGET — the finalized target theorem(s) for this project',
  '#',
  '# Written by `danus finalize <project> <fact_id> ...`; read by write-paper',
  '# (assemble.resolve_headline). One fact id per line.',
  '#',
]

/** 写 TARGET.md(不校验 id 存在性——由调用方先校验)。返回路径。 */
export function writeTargetFactIds(projectDir: string, factIds: string[], paperId?: string | null): string {
  const path = targetPath(projectDir, paperId)
  mkdirSync(dirname(path), { recursive: true })
  atomicWrite(path, [...TARGET_HEADER, ...factIds, ''].join('\n'))
  return path
}

/** 读 TARGET.md:跳过空行/# 行;去 target: 前缀;取 id token 去重保序。 */
export function targetFactIds(projectDir: string, paperId?: string | null): string[] {
  const path = targetPath(projectDir, paperId)
  if (!existsSync(path)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    let line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    line = line.replace(/^\s*target(_fact_ids)?\s*:\s*/i, '')
    for (const m of line.matchAll(TARGET_ID_RE)) {
      const tok = m[0]
      if (!seen.has(tok)) {
        seen.add(tok)
        out.push(tok)
      }
    }
  }
  return out
}
