import './env.mjs'
/**
 * Hyper-parameter grid search over the wave engine.
 * Maximizes NDCG@5 on the hand-labeled eval set; results guide the shipped
 * defaults in `src/core/config.ts`.
 *
 * Usage: node scripts/sweep.mjs [--quick]
 */

import { resolveConfig } from '../lib/core/config.js'
import { buildIndex } from '../lib/ingest/indexer.js'
import { createEmbedder } from '../lib/ingest/embedder.js'
import { waveSearch } from '../lib/retrieval/wave.js'
import { EVAL_CASES } from '../lib/eval/dataset.js'
import { evaluate, setTagMap } from '../lib/eval/metrics.js'

const quick = process.argv.includes('--quick')
const objectiveRaw = (process.argv.find((a) => a.startsWith('--objective=')) ?? '').split('=')[1] ?? 'ndcg'
const objective = { ndcg: 'ndcgAt5', recall: 'recallAt5', mrr: 'mrr', diversity: 'diversity' }[objectiveRaw] ?? 'ndcgAt5'
const index = await buildIndex(resolveConfig(), {})
const embedder = createEmbedder(resolveConfig().embedder, resolveConfig().embedderApi)
setTagMap(new Map(index.papers.map((p) => [p.key, p.tags])))
const TOPK = 5

const channelCombos = quick
  ? [[0.5, 0.35, 0.15], [0.6, 0.25, 0.15], [0.4, 0.45, 0.15]]
  : [[0.5, 0.35, 0.15], [0.6, 0.25, 0.15], [0.4, 0.45, 0.15], [0.5, 0.3, 0.2]]
const dampings = quick ? [0.5, 0.7] : [0.4, 0.5, 0.7]
const hops = [1, 2]
const bells = quick ? [0.25, 0.35, 0.5] : [0.2, 0.25, 0.35, 0.5]

// Embed each query once; reuse across every hyper-parameter combination.
const queryVecs = new Map()
for (const c of EVAL_CASES) {
  const [v] = await embedder.embed([c.query])
  queryVecs.set(c.id, v)
}

const results = []
for (const [alpha, beta, gamma] of channelCombos) {
  for (const damping of dampings) {
    for (const propagationHops of hops) {
      for (const bellDamping of bells) {
        const params = { propagationHops, damping, wormholeTopK: 8, alpha, beta, gamma, bellDamping, topK: TOPK }
        const cases = []
        for (const c of EVAL_CASES) {
          const r = await waveSearch(index, embedder, params, c.query, { topK: TOPK, queryVec: queryVecs.get(c.id) })
          cases.push({ id: c.id, query: c.query, type: c.type, ranked: r.hits.map((h) => h.paperKey), relevant: c.relevant })
        }
        const m = evaluate(cases, TOPK)
        results.push({ params: { ...params }, ...m })
      }
    }
  }
}

results.sort((a, b) => b[objective] - a[objective] || b.ndcgAt5 - a.ndcgAt5)
console.log(`swept ${results.length} combinations (quick=${quick})\n`)
console.log(`top 10 by ${objective.toUpperCase()}:`)
for (const r of results.slice(0, 10)) {
  console.log(
    `  hops=${r.params.propagationHops} damp=${r.params.damping} αβγ=${r.params.alpha}/${r.params.beta}/${r.params.gamma} bell=${r.params.bellDamping}  ` +
    `NDCG@5=${r.ndcgAt5.toFixed(3)} MRR=${r.mrr.toFixed(3)} Rec@5=${r.recallAt5.toFixed(3)} Div=${r.diversity.toFixed(3)}`,
  )
}
await import('node:fs/promises').then(({ writeFile }) =>
  writeFile('sweep-results.json', JSON.stringify(results.slice(0, 25), null, 2)),
)
console.log('\n(top-25 -> sweep-results.json)')
