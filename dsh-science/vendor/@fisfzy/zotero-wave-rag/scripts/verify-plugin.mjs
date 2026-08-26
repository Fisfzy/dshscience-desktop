/**
 * M0 verification harness: mounts the built plugin exactly as the DSH host
 * would (tsx loader, `apply(ctx)` with a recording registry), then exercises
 * every registered tool end-to-end through its `execute`.
 *
 * Run: pnpm run verify   (or: node --import <tsx> scripts/verify-plugin.mjs)
 */

import { name, inject, apply } from '../lib/index.js'

const registered = []
const ctx = {
  tools: {
    register(tool) {
      registered.push(tool)
    },
  },
  logger: { info: () => {} },
}

apply(ctx)

console.log(`plugin: ${name}`)
console.log(`inject: ${inject.join(', ')}`)
console.log(`registered ${registered.length} tools: ${registered.map((t) => t.name).join(', ')}`)

if (name !== 'zotero-wave-rag') throw new Error('plugin name mismatch')
if (registered.length < 5) throw new Error('expected at least 5 tools')

const failures = []

async function run(toolName, args) {
  const tool = registered.find((t) => t.name === toolName)
  if (!tool) throw new Error(`tool ${toolName} not registered`)
  const value = await tool.execute(args, {})
  console.log(`\n--- ${toolName} ${JSON.stringify(args)} ---`)
  console.log(JSON.stringify(value, null, 2).slice(0, 1200))
  return value
}

const status = await run('zotero_status', {})
if (status.ok !== true) failures.push('status.ok not true')
if (status.index.built !== true) failures.push('status.index.built should be true after M1')
if (status.index.papers !== 31) failures.push(`expected 31 sample papers, got ${status.index.papers}`)
if (status.index.edges <= 0) failures.push('expected graph edges > 0')
if (status.wave.bellDamping !== 0.25) failures.push('tuned wave defaults not applied')

const search = await run('zotero_search', { query: 'retrieval augmented generation for question answering' })
if (!Array.isArray(search.hits)) failures.push('search.hits not an array')
if (search.hits.length === 0) failures.push('search.hits empty — expected hits after M3')
if (search.engine !== 'wave') failures.push(`search.engine should be wave, got ${search.engine}`)
if (!search.hits.every((h) => typeof h.paperKey === 'string' && typeof h.title === 'string')) {
  failures.push('hit shape wrong')
}
const waveHit = search.hits[0]
if (typeof waveHit?.semantic !== 'number' || typeof waveHit?.propagation !== 'number' || typeof waveHit?.anchor !== 'number') {
  failures.push('wave channel scores missing on hits')
}

const detail = await run('zotero_paper_detail', { key: 'rag-survey' })
if (detail.error) failures.push(`detail should succeed for rag-survey: ${detail.error}`)
if (detail.title !== 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks') {
  failures.push(`detail title mismatch: ${detail.title}`)
}
if (!Array.isArray(detail.evidence) || detail.evidence.length === 0) failures.push('detail.evidence empty')

const missing = await run('zotero_paper_detail', { key: 'no-such-key' })
if (!missing.error) failures.push('unknown paper key should report an error')

const compare = await run('zotero_compare', { keys: ['rag-survey', 'graphrag'] })
if (compare.cards.length !== 2) failures.push('compare should return 2 cards')
if (!Array.isArray(compare.sharedTags)) failures.push('compare.sharedTags not an array')

const emb = await run('zotero_embedder', { action: 'list' })
if (emb.current !== 'hash') failures.push(`expected current embedder hash, got ${emb.current}`)
if (!Array.isArray(emb.presets) || emb.presets.length < 3) failures.push('embedder presets missing')
const embSet = await run('zotero_embedder', { action: 'set', name: 'hash' })
if (embSet.ok !== true) failures.push(`set embedder hash failed: ${embSet.message}`)

// Host-side schema validation must reject invalid args before execute.
const tool = registered.find((t) => t.name === 'zotero_search')
let rejected = false
try {
  await tool.execute({}, {})
} catch (e) {
  rejected = true
  if (!String(e?.message).includes('missing required property')) {
    failures.push(`unexpected validation error: ${e?.message}`)
  }
}
if (!rejected) failures.push('missing-required-arg search should be rejected by schema validation')
console.log('\nhost-side schema validation rejects missing query: OK')

if (failures.length > 0) {
  console.error('\nVERIFY FAILURES:')
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('\nVERIFY OK: plugin mounts, 5 tools register and execute per contract.')
