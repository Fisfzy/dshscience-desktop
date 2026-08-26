/**
 * BM25 sparse retrieval over FULL-TEXT papers — the lexical channel that
 * complements the wave engine (abstract-level vectors + graph).
 *
 * Key property: BM25 needs no embeddings, so the entire corpus body
 * (15,885 chunks' worth of text) is indexable at zero API cost. It excels
 * exactly where the offline hash embedder is weak: precise domain terms,
 * method names, abbreviations, formulas appearing only in the body.
 *
 * Whole-paper documents: doc text = title + abstract + tags + full text.
 * Standard BM25 (k1=1.5, b=0.75) with an inverted index; serialized inside
 * the LibraryIndex cache (version bump invalidates old caches).
 */

import type { LibraryIndex } from '../core/types.ts'
import { chunkPaper, splitIntoTokens } from '../ingest/chunker.ts'

export interface Bm25Index {
  /** Terms -> posting list (docIndex -> term frequency). */
  postings: Map<string, Map<number, number>>
  docLengths: number[]
  avgDocLength: number
  n: number
}

export interface Bm25Hit {
  paperKey: string
  title: string
  /** Raw BM25 score (positive = some match). */
  score: number
}

export interface Bm25Result {
  hits: Bm25Hit[]
  latencyMs: number
}

const K1 = 1.5
const B = 0.75

function idf(n: number, df: number): number {
  return Math.log(1 + (n - df + 0.5) / (df + 0.5))
}

/** Stopword-ish tokens that carry no retrieval signal. */
const STOP = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'for', 'on', 'with', 'as', 'by',
  'is', 'are', 'was', 'were', 'be', 'been', 'this', 'that', 'these', 'those', 'it',
  'from', 'at', 'its', 'their', 'his', 'her', 'we', 'they', 'using', 'based', 'via',
  'pdf', 'doi', 'https', 'http', 'www', 'com', 'org', 'cn', 'fig', 'table', 'ref',
  'vol', 'no', 'pp', 'et', 'al',
])

/** Normalized terms for one text (lowercase; CJK grouped in 4-char runs). */
export function terms(text: string): string[] {
  return splitIntoTokens(text.toLowerCase())
    .map((t) => t.replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff]+/g, ''))
    .filter((t) => t.length >= 2 && !STOP.has(t))
}

/** Build the BM25 index from the library (whole-paper documents). */
export function buildBm25Index(index: LibraryIndex): Bm25Index {
  const postings = new Map<string, Map<number, number>>()
  const docLengths: number[] = []
  index.papers.forEach((p, docIdx) => {
    const text = [p.title, p.abstract ?? '', p.fullText ?? '', ...p.tags].join(' ')
    const toks = terms(text)
    docLengths.push(toks.length)
    const tf = new Map<string, number>()
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1)
    for (const [t, f] of tf) {
      let list = postings.get(t)
      if (!list) {
        list = new Map()
        postings.set(t, list)
      }
      list.set(docIdx, f)
    }
  })
  const n = index.papers.length
  return {
    postings,
    docLengths,
    avgDocLength: n > 0 ? docLengths.reduce((a, b) => a + b, 0) / n : 1,
    n,
  }
}

/** BM25 retrieval over the index (whole-paper scoring). */
export function bm25Search(index: LibraryIndex, query: string, topK: number): Bm25Result {
  const t0 = Date.now()
  const bm = index.bm25
  if (!bm || bm.n === 0) return { hits: [], latencyMs: Date.now() - t0 }

  const queryTerms = [...new Set(terms(query))]
  const scores = new Map<number, number>()
  for (const t of queryTerms) {
    const list = bm.postings.get(t)
    if (!list) continue
    const idfT = idf(bm.n, list.size)
    for (const [docIdx, tf] of list) {
      const dl = bm.docLengths[docIdx]!
      const denom = tf + K1 * (1 - B + (B * dl) / bm.avgDocLength)
      const s = (idfT * (tf * (K1 + 1))) / denom
      scores.set(docIdx, (scores.get(docIdx) ?? 0) + s)
    }
  }

  const hits: Bm25Hit[] = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([docIdx, score]) => {
      const p = index.papers[docIdx]!
      return { paperKey: p.key, title: p.title, score }
    })
  return { hits, latencyMs: Date.now() - t0 }
}

/**
 * Two-stage evidence snippets: for each hit paper, chunk its full text (the
 * same on-the-fly chunking detail cards use) and score each chunk with the
 * global BM25 term statistics; return the best chunk per paper, prefixed
 * with [section] and [p.N] when available.
 */
export function selectSnippets(
  index: LibraryIndex,
  query: string,
  paperKeys: string[],
  maxChars = 300,
): Map<string, string> {
  const bm = index.bm25
  const out = new Map<string, string>()
  if (!bm || bm.n === 0) return out
  const qTerms = [...new Set(terms(query))]
  if (qTerms.length === 0) return out
  for (const key of paperKeys) {
    const paper = index.papers.find((p) => p.key === key)
    if (!paper) continue
    const chunks = paper.fullText
      ? chunkPaper(paper)
      : index.chunks.filter((c) => c.paperKey === key)
    let best: { score: number; chunk: typeof chunks[number] } | undefined
    for (const chunk of chunks) {
      const toks = terms(chunk.text)
      if (toks.length === 0) continue
      const tf = new Map<string, number>()
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1)
      let score = 0
      for (const t of qTerms) {
        const f = tf.get(t)
        if (!f) continue
        const list = bm.postings.get(t)
        if (!list) continue
        const idfT = idf(bm.n, list.size)
        const dl = toks.length
        score += (idfT * (f * (K1 + 1))) / (f + K1 * (1 - B + (B * dl) / bm.avgDocLength))
      }
      if (!best || score > best.score) best = { score, chunk }
    }
    if (best && best.score > 0) {
      const c = best.chunk
      const page = c.pageStart !== undefined ? `[p.${c.pageStart}] ` : ''
      const section = c.section ? `[${c.section}] ` : ''
      out.set(key, `${page}${section}${c.text.slice(0, maxChars)}`)
    }
  }
  return out
}

/**
 * Fuse wave + BM25 ranked lists into final RetrievalHits (RRF), keeping the
 * wave channel breakdown and attaching the raw BM25 score. Display score is
 * rank-normalized within the fused list.
 */
export function fuseHits(
  wave: { paperKey: string; title: string; reasons?: string[]; semantic?: number; propagation?: number; anchor?: number }[],
  bm: Bm25Hit[],
  papers: { key: string; title: string }[],
  topK: number,
): {
  paperKey: string
  title: string
  score: number
  reasons: string[]
  semantic?: number
  propagation?: number
  anchor?: number
  bm25?: number
}[] {
  const fusedKeys = rrfFuse(wave, bm, topK)
  const waveByKey = new Map(wave.map((h) => [h.paperKey, h]))
  const bmByKey = new Map(bm.map((h) => [h.paperKey, h]))
  const titleByKey = new Map(papers.map((p) => [p.key, p.title]))
  return fusedKeys.map((key, i) => {
    const w = waveByKey.get(key)
    const b = bmByKey.get(key)
    const reasons = [...(w?.reasons ?? [])]
    if (b) reasons.push(`bm25 ${b.score.toFixed(2)}`)
    if (reasons.length === 0) reasons.push('rrf fusion')
    return {
      paperKey: key,
      title: w?.title ?? titleByKey.get(key) ?? key,
      score: 1 - i / (topK * 2 + 1),
      reasons,
      semantic: w?.semantic,
      propagation: w?.propagation,
      anchor: w?.anchor,
      bm25: b?.score,
    }
  })
}

/** Reciprocal-rank fusion of two ranked lists (k=60, standard). */
export function rrfFuse(
  a: { paperKey: string }[],
  b: { paperKey: string }[],
  topK: number,
  k = 60,
): string[] {
  const score = new Map<string, number>()
  a.forEach((hit, i) => score.set(hit.paperKey, (score.get(hit.paperKey) ?? 0) + 1 / (k + i + 1)))
  b.forEach((hit, i) => score.set(hit.paperKey, (score.get(hit.paperKey) ?? 0) + 1 / (k + i + 1)))
  return [...score.entries()].sort((x, y) => y[1] - x[1]).slice(0, topK).map(([key]) => key)
}
