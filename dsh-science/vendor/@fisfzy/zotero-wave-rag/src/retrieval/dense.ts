/**
 * Dense (vector) recall — the naive-RAG baseline.
 *
 * Query → embed → cosine over chunk embeddings → aggregate to paper scores →
 * top-k papers. This is deliberately simple: it is the baseline the wave
 * engine (M3) is measured against in the ablation harness (M4).
 */

import type { LibraryIndex } from '../core/types.ts'
import type { Embedder } from '../ingest/embedder.ts'
import { cosine } from '../ingest/embedder.ts'

export interface DenseHit {
  paperKey: string
  title: string
  /** Aggregated paper-level cosine (max over its chunks). */
  score: number
  /** Best chunk text supporting the hit. */
  snippet: string
}

export interface DenseResult {
  hits: DenseHit[]
  latencyMs: number
}

/** Aggregate a paper's chunk scores into a paper score (max + mean blend). */
function aggregate(scores: number[]): number {
  if (scores.length === 0) return 0
  const max = Math.max(...scores)
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  return 0.7 * max + 0.3 * mean
}

/** Naive dense recall over the library index. */
export async function denseSearch(
  index: LibraryIndex,
  embedder: Embedder,
  query: string,
  topK: number,
  queryVec?: number[],
): Promise<DenseResult> {
  const t0 = Date.now()
  const [qv] = queryVec ? [queryVec] : await embedder.embed([query])
  const q = qv!
  const paperScores = new Map<string, { scores: number[]; snippet: string }>()
  for (const chunk of index.chunks) {
    if (!chunk.embedding) continue
    const sim = cosine(q, chunk.embedding)
    const entry = paperScores.get(chunk.paperKey) ?? { scores: [], snippet: '' }
    entry.scores.push(sim)
    if (sim > 0 && entry.snippet.length < 200) {
      entry.snippet = chunk.text.slice(0, 260)
    }
    paperScores.set(chunk.paperKey, entry)
  }
  const hits: DenseHit[] = []
  for (const p of index.papers) {
    const entry = paperScores.get(p.key)
    if (!entry || entry.scores.length === 0) continue
    hits.push({
      paperKey: p.key,
      title: p.title,
      score: aggregate(entry.scores),
      snippet: entry.snippet || p.abstract?.slice(0, 260) || '',
    })
  }
  hits.sort((a, b) => b.score - a.score)
  return { hits: hits.slice(0, topK), latencyMs: Date.now() - t0 }
}
