/**
 * Tag-river graph builder.
 *
 * Nodes are papers; edges are the "rivers" of the wave semantic terrain:
 *   - tag edges: papers sharing a tag; weight = 1 / log(1 + tag frequency),
 *     so rare tags carry far stronger water than ubiquitous ones;
 *   - author edges: shared author, weight 1;
 *   - collection edges: same Zotero collection, weight 0.5;
 *   - knn edges: dense-cosine neighbors (paper profile = mean of chunk
 *     embeddings), weight = similarity;
 *   - wormhole edges: cross-domain "jump" edges — structurally bridged
 *     (shared author/collection) yet no shared tag and low cosine. The wave
 *     core (M3) selects among these candidates.
 */

import type { Chunk, GraphEdge, Paper } from '../core/types.ts'
import { cosine } from './embedder.ts'

const TAG_WEIGHT = (tagFreq: number) => 1 / Math.log(2 + tagFreq)
const AUTHOR_WEIGHT = 1
const COLLECTION_WEIGHT = 0.5
const KNN_TOP = 3
/** Threshold tuned to the offline hash embedder's cosine distribution. */
const KNN_MIN_SIM = 0.32
/** Wormhole edges require cosine below this (semantically distant). */
const WORMHOLE_MAX_SIM = 0.45

export interface GraphInput {
  papers: Paper[]
  /** Paper key -> chunk embeddings (already normalized). */
  embeddingsByPaper: Map<string, number[][]>
}

export function buildGraph(input: GraphInput): GraphEdge[] {
  const { papers, embeddingsByPaper } = input
  const edges: GraphEdge[] = []
  const seen = new Set<string>()
  const add = (a: string, b: string, kind: GraphEdge['kind'], weight: number) => {
    if (a === b) return
    const [x, y] = a < b ? [a, b] : [b, a]
    const id = `${kind}:${x}:${y}`
    if (seen.has(id)) return
    seen.add(id)
    edges.push({ a: x, b: y, kind, weight })
  }

  // Tag frequency across the library.
  const tagFreq = new Map<string, number>()
  for (const p of papers) {
    for (const t of new Set(p.tags)) tagFreq.set(t, (tagFreq.get(t) ?? 0) + 1)
  }

  // Tag edges. Machine autoTags join the river network but never replace
  // user tags (wave.ts reads only `tags`, so the anchor/Ω channels stay
  // anchored to authoritative user tags).
  const allTags = (p: Paper) => [...new Set([...p.tags, ...(p.autoTags ?? [])])]
  for (const p of papers) {
    for (const t of allTags(p)) {
      const freq = tagFreq.get(t) ?? 1
      const w = TAG_WEIGHT(freq)
      for (const q of papers) {
        if (q.key <= p.key) continue
        if (allTags(q).includes(t)) add(p.key, q.key, 'tag', w)
      }
    }
  }

  // Author edges.
  for (const p of papers) {
    const myAuthors = p.creators.map((c) => `${c.firstName ?? ''} ${c.lastName}`.trim())
    for (const q of papers) {
      if (q.key <= p.key) continue
      const qAuthors = q.creators.map((c) => `${c.firstName ?? ''} ${c.lastName}`.trim())
      if (qAuthors.some((name) => myAuthors.includes(name))) {
        add(p.key, q.key, 'author', AUTHOR_WEIGHT)
      }
    }
  }

  // Collection edges.
  for (const p of papers) {
    for (const q of papers) {
      if (q.key <= p.key) continue
      if (p.collections.some((c) => q.collections.includes(c))) {
        add(p.key, q.key, 'collection', COLLECTION_WEIGHT)
      }
    }
  }

  // k-NN edges from paper-profile embeddings.
  for (const p of papers) {
    const profile = meanEmbedding(embeddingsByPaper.get(p.key))
    if (!profile) continue
    const scored: { key: string; sim: number }[] = []
    for (const q of papers) {
      if (q.key === p.key) continue
      const qProfile = meanEmbedding(embeddingsByPaper.get(q.key))
      if (!qProfile) continue
      const sim = cosine(profile, qProfile)
      if (sim >= KNN_MIN_SIM) scored.push({ key: q.key, sim })
    }
    scored.sort((x, y) => y.sim - x.sim)
    for (const s of scored.slice(0, KNN_TOP)) {
      add(p.key, s.key, 'knn', s.sim)
    }
  }

  // Wormhole *candidate* edges — cross-domain "jump" edges the wave core
  // selects among. A candidate pairs papers that are structurally bridged
  // (shared author and/or collection) yet have NO shared tag and LOW vector
  // similarity — i.e. semantically distant but really related. This is what
  // plain dense retrieval misses.
  for (const p of papers) {
    const profile = meanEmbedding(embeddingsByPaper.get(p.key))
    for (const q of papers) {
      if (q.key <= p.key) continue
      const sharesTag = p.tags.some((t) => q.tags.includes(t))
      if (sharesTag) continue
      const sharesAuthor = p.creators.some((c) =>
        q.creators.some((d) => `${c.firstName ?? ''} ${d.lastName}`.trim() === `${d.firstName ?? ''} ${d.lastName}`.trim()),
      )
      const sharesCollection = p.collections.some((c) => q.collections.includes(c))
      if (!sharesAuthor && !sharesCollection) continue
      // Skip pairs already linked by k-NN (those are close in vector space).
      if (seen.has(`knn:${p.key}:${q.key}`) || seen.has(`knn:${q.key}:${p.key}`)) continue
      const qProfile = meanEmbedding(embeddingsByPaper.get(q.key))
      if (profile && qProfile && cosine(profile, qProfile) >= WORMHOLE_MAX_SIM) continue
      add(p.key, q.key, 'wormhole', (sharesAuthor ? 2 : 0) + (sharesCollection ? 1 : 0))
    }
  }

  void tagFreq
  return edges
}

function meanEmbedding(vecs: number[][] | undefined): number[] | undefined {
  if (!vecs || vecs.length === 0) return undefined
  const dim = vecs[0]!.length
  const mean = new Array(dim).fill(0)
  for (const v of vecs) for (let i = 0; i < dim; i++) mean[i]! += v[i]!
  return mean.map((x) => x / vecs.length)
}
