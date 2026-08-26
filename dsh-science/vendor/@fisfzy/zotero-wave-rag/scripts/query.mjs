import './env.mjs'
/**
 * Interactive query CLI — demo entry point.
 *
 * Usage:
 *   node scripts/query.mjs "retrieval augmented generation survey"
 *   node scripts/query.mjs "graph rag" --naive        # compare with baseline
 *   node scripts/query.mjs "colbert" --detail         # also print detail cards
 */

import { Engine } from '../lib/core/engine.js'

const argv = process.argv.slice(2)
const naive = argv.includes('--naive')
const detail = argv.includes('--detail')
const query = argv.find((a) => !a.startsWith('--')) ?? 'retrieval augmented generation survey'

const engine = new Engine()
const res = await engine.search(query, 5, naive ? 'naive' : 'wave')
console.log(`\nquery: "${query}"  (engine: ${res.engine}, ${res.latencyMs}ms)\n`)
for (const h of res.hits) {
  const ch = h.semantic !== undefined ? ` [sem=${h.semantic.toFixed(2)} prop=${(h.propagation ?? 0).toFixed(2)} anc=${(h.anchor ?? 0).toFixed(2)}]` : ''
  console.log(`  ${h.score.toFixed(3)}${ch}  ${h.paperKey} — ${h.title}`)
  if (h.reasons?.length) console.log(`       ↳ ${h.reasons.join('; ')}`)
}
if (detail) {
  console.log('\ndetail cards:')
  for (const h of res.hits.slice(0, 3)) {
    const card = await engine.paperDetail(h.paperKey)
    if ('error' in card) continue
    console.log(`\n  ${card.paperKey} — ${card.title}`)
    console.log(`    method: ${(card.method ?? '').slice(0, 140)}`)
    console.log(`    related: ${card.relatedPapers.slice(0, 3).join(' | ')}`)
    console.log(`    evidence[0]: ${(card.evidence[0] ?? '').slice(0, 100)}`)
  }
}
