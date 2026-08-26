/**
 * Validate a directory as a real Zotero library and print what the adapter
 * would ingest.
 *
 * Usage:
 *   node scripts/check-zotero-dir.mjs /path/to/zotero
 *
 * The directory must contain `zotero.sqlite` (and ideally `storage/`).
 * Copy it from your Zotero data dir (exit Zotero first!) before running.
 */

import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node scripts/check-zotero-dir.mjs /path/to/zotero')
  process.exit(1)
}
if (!existsSync(dir)) {
  console.error(`✗ directory not found: ${dir}`)
  process.exit(1)
}
const dbPath = join(dir, 'zotero.sqlite')
if (!existsSync(dbPath)) {
  console.error(`✗ ${dbPath} not found — is this a Zotero data directory?`)
  console.error('  expected: zotero.sqlite (and optionally storage/ with PDFs)')
  process.exit(1)
}
const storageDir = join(dir, 'storage')
console.log(`✓ zotero.sqlite found (${(statSync(dbPath).size / 1024 / 1024).toFixed(1)} MB)`)
console.log(`✓ storage dir ${existsSync(storageDir) ? 'found' : 'MISSING (PDF fallback disabled; fulltext index still used)'}`)

// Try a read-only open + a couple of schema probes.
import('node:sqlite').then(async ({ DatabaseSync }) => {
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
    const required = ['items', 'itemData', 'itemDataValues', 'fields', 'creators', 'itemCreators', 'tags', 'itemTags', 'collections', 'collectionItems', 'itemAttachments']
    const missing = required.filter((t) => !tables.includes(t))
    if (missing.length > 0) {
      console.error(`✗ schema probe: missing tables ${missing.join(', ')} — not a Zotero 6/7 database?`)
      process.exit(1)
    }
    const itemCount = db.prepare('SELECT COUNT(*) AS n FROM items').get().n
    const ftCount = db.prepare('SELECT COUNT(*) AS n FROM fulltextItems').get().n
    const tagCount = db.prepare('SELECT COUNT(*) AS n FROM tags').get().n
    const annCount = db.prepare(
      "SELECT COUNT(*) AS n FROM items i JOIN itemTypes t ON i.itemTypeID = t.itemTypeID WHERE t.typeName='annotation'",
    ).get().n
    console.log(`✓ schema OK — items:${itemCount} tags:${tagCount} fulltext-entries:${ftCount} annotations:${annCount}`)
    db.close()
    console.log('\nnext:  ZWR_DATA_DIR=<dir> node scripts/ingest.mjs')
  } catch (e) {
    console.error(`✗ cannot read database: ${e.message}`)
    console.error('  (is Zotero still running? exit it, or copy a clean snapshot)')
    process.exit(1)
  }
})
