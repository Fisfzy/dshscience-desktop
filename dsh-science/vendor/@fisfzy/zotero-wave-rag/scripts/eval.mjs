import './env.mjs'
/**
 * Ablation harness: naive dense baseline vs wave engine with each wave term
 * disabled in turn. Prints a markdown table and writes eval-results.json.
 *
 * Usage: node scripts/eval.mjs [--out results.json]
 */

import { resolveConfig } from '../lib/core/config.js'
import { buildIndex } from '../lib/ingest/indexer.js'
import { createEmbedder } from '../lib/ingest/embedder.js'
import { denseSearch } from '../lib/retrieval/dense.js'
import { waveSearch } from '../lib/retrieval/wave.js'
import { bm25Search, fuseHits } from '../lib/retrieval/bm25.js'
import { expandQuery } from '../lib/retrieval/expand.js'
import { EVAL_CASES } from '../lib/eval/dataset.js'
import { evaluate, setTagMap } from '../lib/eval/metrics.js'

const outPath = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'eval-results.json'

const config = resolveConfig()
if (config.dataDir) {
  console.warn('⚠ 注意：当前数据集（src/eval/dataset.ts）的真值是为示例库标注的；')
  console.warn('  在真实库上运行的指标无意义，请先用示例库（不设 ZWR_DATA_DIR）或重标真值。')
}
const index = await buildIndex(config, { verbose: true })
const embedder = createEmbedder(config.embedder, config.embedderApi)
setTagMap(new Map(index.papers.map((p) => [p.key, p.tags])))

const TOPK = 5

// Embed each query once; reuse the vector across all configs (saves API calls).
// naive baseline uses the raw query; wave/bm25 configs use the EXPANDED query.
const queryVecs = new Map()
const expandedVecs = new Map()
for (const c of EVAL_CASES) {
  const [v] = await embedder.embed([c.query])
  queryVecs.set(c.id, v)
  const [ev] = await embedder.embed([expandQuery(c.query)])
  expandedVecs.set(c.id, ev)
}
// Production behaviour: domain-expanded queries (expandQuery) feed the wave
// configs; the naive baseline stays raw (historical baseline).
const expanded = (q) => expandQuery(q)
const wave = (opts) => (q, id) => waveSearch(index, embedder, config.wave, expanded(q), { topK: TOPK, queryVec: expandedVecs.get(id), ...opts }).then((r) => r.hits.map((h) => h.paperKey))
const configs = [
  { id: 'naive', label: 'Naive dense (baseline)', run: (q, id) => denseSearch(index, embedder, q, TOPK, queryVecs.get(id)).then((r) => r.hits.map((h) => h.paperKey)) },
  { id: 'wave-full', label: 'Wave (full)', run: wave({}) },
  { id: 'wave-nowormhole', label: 'Wave − wormhole', run: wave({ useWormhole: false }) },
  { id: 'wave-nodamper', label: 'Wave − bell damper', run: wave({ useDamper: false }) },
  { id: 'wave-noinnovation', label: 'Wave − Ω innovation', run: wave({ useInnovation: false }) },
  { id: 'wave-noanchor', label: 'Wave − direct anchor', run: wave({ useAnchor: false }) },
  { id: 'wave-bm25', label: 'Wave + BM25 (RRF)', run: (q, id) => {
      const eq = expanded(q)
      return Promise.all([
        waveSearch(index, embedder, config.wave, eq, { topK: TOPK * 3, queryVec: expandedVecs.get(id) }),
        Promise.resolve(bm25Search(index, eq, TOPK * 3)),
      ]).then(([w, b]) => fuseHits(w.hits, b.hits, index.papers, TOPK).map((h) => h.paperKey))
    } },
]

const results = {}
const table = []
for (const cfg of configs) {
  const rankedCases = []
  for (const c of EVAL_CASES) {
    const ranked = await cfg.run(c.query, c.id)
    rankedCases.push({ id: c.id, query: c.query, type: c.type, ranked, relevant: c.relevant })
  }
  const m = evaluate(rankedCases, TOPK)
  results[cfg.id] = { metrics: m, cases: rankedCases }
  table.push({ label: cfg.label, ...m })
}

// markdown table
console.log(`\n## Ablation on ${EVAL_CASES.length} eval queries (top-${TOPK}, sample library)\n`)
console.log('| config | Recall@5 | MRR | NDCG@5 | Diversity |')
console.log('|---|---|---|---|---|')
for (const r of table) {
  console.log(`| ${r.label} | ${r.recallAt5.toFixed(3)} | ${r.mrr.toFixed(3)} | ${r.ndcgAt5.toFixed(3)} | ${r.diversity.toFixed(3)} |`)
}

// per-type breakdown for wave-full and naive
const byType = (cfgId) => {
  const agg = {}
  for (const c of results[cfgId].cases) {
    const top = c.ranked.slice(0, TOPK)
    const relevant = new Set(c.relevant)
    const hits = top.filter((k) => relevant.has(k)).length
    agg[c.type] = agg[c.type] ?? { n: 0, recall: 0 }
    agg[c.type].n++
    agg[c.type].recall += relevant.size ? hits / relevant.size : 0
  }
  return Object.entries(agg).map(([t, v]) => `${t}:${(v.recall / v.n).toFixed(3)}`).join('  ')
}
console.log('\nRecall@5 by query type:')
console.log('  naive :', byType('naive'))
console.log('  wave  :', byType('wave-full'))

await import('node:fs/promises').then(({ writeFile }) => writeFile(outPath, JSON.stringify(results, null, 2)))
console.log(`\nfull per-query results -> ${outPath}`)
