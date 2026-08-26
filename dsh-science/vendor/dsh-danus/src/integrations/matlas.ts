/**
 * matlas.ts — arXiv 定理语义检索(Matlas)。移植自 danus/integrations/matlas.py。
 *
 * 逐字返回 as-published 的 theorem/lemma/definition 语句。**永不抛错**:
 * 任何失败返回同一 envelope + error 字段 + 空 results(检索宕机不能砸掉
 * worker/verifier 的一轮)。改进点:URL 在调用时读 env(原版 import 时)。
 */

import { envInt, envStr } from '../shared/env.ts'

const DEFAULT_URL = 'https://leansearch.net/thm/search'

/** 端点条件化的检索任务描述(固定字符串,原版逐字)。 */
const TASK =
  'Given a math statement, retrieve useful references, such as theorems, ' +
  'lemmas, and definitions, that are useful for solving the given problem.'

export const RESULT_FIELDS = ['title', 'theorem', 'arxiv_id', 'theorem_id'] as const

export interface MatlasResult {
  title: string
  theorem: string
  arxiv_id: string
  theorem_id: string
}

export interface MatlasEnvelope {
  query: string
  count: number
  results: MatlasResult[]
  endpoint: string
  error?: string
}

export async function searchArxivTheorems(query: string, numResults = 10, timeout?: number): Promise<MatlasEnvelope> {
  const url = envStr('MATLAS_URL', DEFAULT_URL)
  const timeoutSec = timeout ?? envInt('MATLAS_TIMEOUT', 30)
  const q = (query ?? '').trim()
  if (!q) {
    return { query, count: 0, results: [], endpoint: url, error: 'empty query' }
  }
  const n = numResults && Math.trunc(numResults) > 0 ? Math.trunc(numResults) : 10
  const payload = JSON.stringify({ query: q, task: TASK, num_results: n })

  let data: unknown
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutSec * 1000)
    let resp: Response
    try {
      resp = await fetch(url, {
        method: 'POST',
        body: payload,
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          // 端点在 Cloudflare 后,裸请求被 403;显式 UA + Accept 才能过。
          'User-Agent': 'danus/1.0 (+https://frenzymath.com)',
        },
      })
    } finally {
      clearTimeout(timer)
    }
    if (!resp.ok) {
      return { query: q, count: 0, results: [], endpoint: url, error: `http ${resp.status}: ${resp.statusText}` }
    }
    data = await resp.json()
  } catch (e) {
    const err = e as Error
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      return { query: q, count: 0, results: [], endpoint: url, error: `TimeoutError: request timed out` }
    }
    return { query: q, count: 0, results: [], endpoint: url, error: `network: ${err.message}` }
  }

  if (!Array.isArray(data)) {
    const t = data === null ? 'null' : typeof data === 'object' ? 'dict' : typeof data
    return { query: q, count: 0, results: [], endpoint: url, error: `theorem endpoint must return a JSON list, got ${t}` }
  }

  const results: MatlasResult[] = []
  for (const item of data) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const rec = item as Record<string, unknown>
    results.push({
      title: String(rec.title ?? ''),
      theorem: String(rec.theorem ?? ''),
      arxiv_id: String(rec.arxiv_id ?? ''),
      theorem_id: String(rec.theorem_id ?? ''),
    })
  }
  return { query: q, count: results.length, results, endpoint: url }
}
