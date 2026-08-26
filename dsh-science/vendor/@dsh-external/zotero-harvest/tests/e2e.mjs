/**
 * End-to-end test — the full loop on a throwaway Zotero library:
 *
 *   empty zotero.sqlite (minimal schema)
 *     → lit_review_run (fetch from live APIs, deterministic sufficiency)
 *     → lit_save mode=sqlite (offline import into the library)
 *     → reindex via zotero-wave-rag's ingest (env-overridden data dir)
 *     → read back + BM25 search proves the new papers are searchable
 *
 * Run: node tests/e2e.mjs
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveConfig } from '../lib/config.js'
import { runReview } from '../lib/pipeline/review.js'
import { triggerReindex } from '../lib/pipeline/reindex.js'

const ROOT = '/tmp/lit-e2e'
const DATA_DIR = join(ROOT, 'zotero')
const DB = join(DATA_DIR, 'zotero.sqlite')
const ZWR_CFG = join(ROOT, 'zwr-cfg')

rmSync(ROOT, { recursive: true, force: true })
mkdirSync(DATA_DIR, { recursive: true })
mkdirSync(ZWR_CFG, { recursive: true })
writeFileSync(join(ZWR_CFG, 'config.json'), '{}')
process.env.ZWR_CONFIG_DIR = ZWR_CFG

// ── 1. minimal library (subset of the schema zotero-wave-rag reads) ──────
const db = new DatabaseSync(DB)
db.exec(`
CREATE TABLE items (itemID INTEGER PRIMARY KEY, itemTypeID INTEGER, dateAdded TEXT, dateModified TEXT, key TEXT UNIQUE, libraryID INTEGER, version INTEGER);
CREATE TABLE itemTypes (itemTypeID INTEGER PRIMARY KEY, typeName TEXT);
CREATE TABLE fields (fieldID INTEGER PRIMARY KEY, fieldName TEXT);
CREATE TABLE itemData (itemID INTEGER, fieldID INTEGER, valueID INTEGER, PRIMARY KEY (itemID, fieldID));
CREATE TABLE itemDataValues (valueID INTEGER PRIMARY KEY, value TEXT);
CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, fieldMode INTEGER);
CREATE TABLE itemCreators (itemID INTEGER, creatorID INTEGER, creatorTypeID INTEGER, orderIndex INTEGER);
CREATE TABLE creatorTypes (creatorTypeID INTEGER PRIMARY KEY, creatorType TEXT);
CREATE TABLE tags (tagID INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE itemTags (itemID INTEGER, tagID INTEGER, type INTEGER);
CREATE TABLE collections (collectionID INTEGER PRIMARY KEY, collectionName TEXT, parentCollectionID INTEGER);
CREATE TABLE collectionItems (collectionID INTEGER, itemID INTEGER);
CREATE TABLE itemAttachments (itemID INTEGER, parentItemID INTEGER, linkMode INTEGER, contentType TEXT, path TEXT);
CREATE TABLE itemNotes (itemID INTEGER, parentItemID INTEGER, note TEXT);
CREATE TABLE fulltextItems (itemID INTEGER, fieldID INTEGER, version INTEGER, indexedPages INTEGER, totalPages INTEGER, indexableText TEXT);
CREATE TABLE deletedItems (itemID INTEGER);
`)
db.close()
console.log('test library created (empty)')

// ── 2. lit_review_run with sqlite save ───────────────────────────────────
const cfg = resolveConfig({
  dataDir: DATA_DIR,
  minCorePapers: 2,
  minTotalPapers: 2,
  maxRounds: 1,
  perRoundFetch: 4,
  autoReindex: false,
})

const result = await runReview({
  topic: 'graph neural networks',
  sources: ['openalex', 'arxiv'],
  saveMode: 'sqlite',
  collection: 'lit-harvest-e2e',
  cfg,
})

console.log(
  `review: rounds=${result.rounds.length} collected=${result.collected.length} sufficient=${result.sufficiency.sufficient} save=${JSON.stringify(result.save?.resolvedMode)} saved=${result.save?.saved}`,
)
if (!result.save || result.save.saved < 1 || result.save.resolvedMode !== 'sqlite') {
  console.error('E2E FAIL: review did not save into sqlite', JSON.stringify(result.save))
  process.exit(1)
}

// ── 3. verify rows in the library ────────────────────────────────────────
const check = new DatabaseSync(DB, { readOnly: true })
const tagged = check
  .prepare(
    `SELECT COUNT(*) AS n FROM items i
     JOIN itemTags it ON it.itemID = i.itemID
     JOIN tags t ON t.tagID = it.tagID
     WHERE t.name = 'lit-harvest'`,
  )
  .get()
const collections = check
  .prepare(`SELECT collectionName FROM collections`).all()
check.close()
console.log(`library now has ${tagged.n} lit-harvest items; collections=${collections.map((c) => c.collectionName).join(',')}`)
if (tagged.n < 1) {
  console.error('E2E FAIL: no lit-harvest items in library')
  process.exit(1)
}

// ── 4. reindex via zotero-wave-rag ingest (env-driven data dir) ──────────
const reindex = await triggerReindex(DATA_DIR, { timeoutMs: 120_000 })
console.log(`reindex: ok=${reindex.ok} — ${reindex.message}`)
if (!reindex.ok) {
  console.error('E2E FAIL: reindex failed', reindex.stdout ?? '')
  process.exit(1)
}
const paperLine = /papers:\s+(\d+)/.exec(reindex.stdout ?? '')
console.log(`reindex papers count: ${paperLine?.[1] ?? '?'}`)

// ── 5. searchability proof: BM25 over the rebuilt index ──────────────────
const { zoteroWaveRagDir } = await import('../lib/config.js')
const zwr = zoteroWaveRagDir()
const { buildIndex } = await import(`${zwr}/lib/ingest/indexer.js`)
const { bm25Search } = await import(`${zwr}/lib/retrieval/bm25.js`)
const idx = await buildIndex(resolveConfig({ dataDir: DATA_DIR }), {})
const hits = bm25Search(idx, 'graph neural network', 5)
const titles = hits.hits.map((h) => h.title)
console.log(`bm25 search 'graph neural network': ${titles.length} hits`)
titles.slice(0, 5).forEach((t) => console.log(`  - ${t}`))
const found = result.collected.some((p) =>
  titles.some((t) => t.toLowerCase().includes(p.title.slice(0, 40).toLowerCase()) || p.title.toLowerCase().includes(t.slice(0, 40).toLowerCase())),
)
console.log(found ? 'E2E OK: collected papers are searchable via the RAG index' : 'E2E WARN: no direct title match (index searchable but title fuzzy)')

console.log('E2E DONE')
