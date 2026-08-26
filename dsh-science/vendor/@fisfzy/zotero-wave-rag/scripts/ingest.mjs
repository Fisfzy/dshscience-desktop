import './env.mjs'
/**
 * CLI: build the library index and print stats.
 *
 * Usage:
 *   node scripts/ingest.mjs                          # sample library
 *   ZWR_DATA_DIR=/path/to/zotero node scripts/ingest.mjs   # real Zotero
 *   node scripts/ingest.mjs --out index.json         # dump index to file
 */

import { resolveConfig } from '../lib/core/config.js'
import { buildIndex } from '../lib/ingest/indexer.js'

const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const outPath = outIdx >= 0 ? args[outIdx + 1] : undefined

const config = resolveConfig()
const t0 = Date.now()
try {
  const index = await buildIndex(config, { verbose: true })
  console.log(`\n[ingest] done in ${Date.now() - t0}ms`)
  console.log(`  papers:    ${index.stats.papers}`)
  console.log(`  chunks:    ${index.stats.chunks}`)
  console.log(`  edges:     ${index.stats.edges}`)
  console.log(`  tags:      ${index.stats.tags}`)

  // Quick edge-kind breakdown — useful to sanity-check the graph.
  const byKind = new Map()
  for (const e of index.edges) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1)
  console.log('  edge kinds:', Object.fromEntries(byKind))

  if (outPath) {
    // Strip the (potentially hundreds of MB of) chunk embeddings from the dump.
    await import('node:fs/promises').then(async ({ writeFile }) => {
      const slim = {
        ...index,
        chunks: index.chunks.map(({ paperKey, section, text }) => ({ paperKey, section, text })),
        stats: index.stats,
      }
      await writeFile(outPath, JSON.stringify(slim, null, 2))
      console.log(`  index summary written to ${outPath} (embeddings stripped)`)
    })
  }
} catch (error) {
  console.error('[ingest] FAILED:', error instanceof Error ? error.message : error)
  process.exit(1)
}
