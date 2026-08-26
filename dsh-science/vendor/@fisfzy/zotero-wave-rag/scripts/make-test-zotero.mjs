/**
 * Generate a minimal Zotero-schema SQLite database for adapter testing.
 *
 * Creates a fake `zotero.sqlite` with the exact tables/queries `db.ts` uses,
 * seeds 3 papers (metadata, tags, collections, full text, one annotation),
 * then exercises `readZoteroLibrary` against it and prints what it read.
 *
 * Usage: node scripts/make-test-zotero.mjs [out.sqlite]
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, rmSync } from 'node:fs'

const outPath = process.argv[2] ?? '/tmp/test-zotero/zotero.sqlite'
mkdirSync(outPath.slice(0, outPath.lastIndexOf('/')), { recursive: true })
rmSync(outPath, { force: true })

const db = new DatabaseSync(outPath)

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

const ins = (sql, ...p) => db.prepare(sql).run(...p)

// item types & fields
for (const [id, name] of [[1, 'journalArticle'], [2, 'conferencePaper'], [3, 'annotation'], [4, 'attachment']]) {
  ins('INSERT INTO itemTypes VALUES (?,?)', id, name)
}
for (const [id, name] of [
  [1, 'title'], [2, 'abstractNote'], [3, 'date'], [4, 'url'], [5, 'DOI'],
  [6, 'annotationText'], [7, 'annotationComment'], [8, 'annotationPageLabel'],
]) {
  ins('INSERT INTO fields VALUES (?,?)', id, name)
}
ins("INSERT INTO creatorTypes VALUES (1, 'author')")

const val = (() => {
  let next = 1
  const map = new Map()
  return (text) => {
    if (map.has(text)) return map.get(text)
    ins('INSERT INTO itemDataValues VALUES (?,?)', next, text)
    map.set(text, next)
    return next++
  }
})()

let nextItem = 1
const paper = (key, title, date, abstract, authors, tagsArr, coll) => {
  const itemID = nextItem++
  ins('INSERT INTO items VALUES (?,1,?,?,?,1,1)', itemID, '2024-01-01', '2024-01-01', key)
  ins('INSERT INTO itemData VALUES (?,1,?)', itemID, val(title))
  ins('INSERT INTO itemData VALUES (?,2,?)', itemID, val(abstract))
  ins('INSERT INTO itemData VALUES (?,3,?)', itemID, val(date))
  authors.forEach(([first, last], i) => {
    const creatorID = nextItem * 100 + i
    ins('INSERT INTO creators VALUES (?,?,?,0)', creatorID, first, last)
    ins('INSERT INTO itemCreators VALUES (?,?,1,?)', itemID, creatorID, i)
  })
  tagsArr.forEach((tag, i) => {
    const tagID = nextItem * 1000 + i
    ins('INSERT INTO tags VALUES (?,?)', tagID, tag)
    ins('INSERT INTO itemTags VALUES (?,?,0)', itemID, tagID)
  })
  const collID = nextItem * 10000 + 1
  ins('INSERT INTO collections VALUES (?,?,NULL)', collID, coll)
  ins('INSERT INTO collectionItems VALUES (?,?)', collID, itemID)
  return itemID
}

// 3 papers
const p1 = paper('t-paper-1', 'Test RAG Paper One', '2023-05-01', 'Abstract about retrieval augmented generation.', [['Ann', 'Author'], ['Bob', 'Writer']], ['rag', 'retrieval'], 'Test Collection')
const p2 = paper('t-paper-2', 'Test Vector DB Paper Two', '2022-11-15', 'Abstract about vector databases and ANN search.', [['Carol', 'Researcher']], ['vector-db', 'retrieval'], 'Test Collection')
const p3 = paper('t-paper-3', 'Test Graph Paper Three', '2024-02-20', 'Abstract about knowledge graphs.', [['Dan', 'Scientist']], ['knowledge-graph'], 'Other Collection')

// full text on attachment of paper 1
const attID = nextItem++
ins('INSERT INTO items VALUES (?,4,?,?,?,1,1)', attID, '2024-01-01', '2024-01-01', 'att-1')
ins('INSERT INTO itemAttachments VALUES (?,?,0,?,?)', attID, p1, 'application/pdf', 'storage:att-1/test.pdf')
ins(
  'INSERT INTO fulltextItems VALUES (?,1,1,2,2,?)',
  attID,
  '1. Introduction\nThis is the extracted full text of the test RAG paper. It describes retrieval augmented generation in detail.\n\n2. Method\nThe method section explains the retrieval pipeline.',
)

// annotation on paper 2
const annID = nextItem++
ins('INSERT INTO items VALUES (?,3,?,?,?,1,1)', annID, '2024-01-01', '2024-01-01', 'ann-1')
ins('INSERT INTO itemAttachments VALUES (?,?,0,?,NULL)', annID, p2, 'text/plain')
ins('INSERT INTO itemData VALUES (?,6,?)', annID, val('vector databases support ANN search'))
ins('INSERT INTO itemData VALUES (?,7,?)', annID, val('my annotation comment'))
ins('INSERT INTO itemData VALUES (?,8,?)', annID, val('3'))

db.close()
console.log(`wrote ${outPath}`)

// ---- now exercise the adapter ----
const { readZoteroLibrary } = await import('../lib/zotero/db.js')
const papers = readZoteroLibrary({ dbPath: outPath })
console.log('\nreadZoteroLibrary returned:')
for (const p of papers) {
  console.log(`  ${p.key}: "${p.title}" (${p.year}) tags=[${p.tags.join(', ')}] coll=[${p.collections.join(', ')}] creators=${p.creators.map((c) => `${c.firstName ?? ''} ${c.lastName}`).join('|')}`)
  console.log(`    fullText: ${p.fullText ? p.fullText.slice(0, 80).replace(/\n/g, ' ') + '…' : '(none)'}`)
  console.log(`    annotations: ${p.annotations.length}`)
  for (const a of p.annotations) console.log(`      - "${(a.quote ?? '').slice(0, 50)}" note="${a.note}" page=${a.page}`)
}
if (papers.length !== 3) throw new Error(`expected 3 papers, got ${papers.length}`)
const t1 = papers.find((p) => p.key === 't-paper-1')
if (!t1?.fullText?.includes('retrieval pipeline')) throw new Error('full text not attached to paper 1')
const t2 = papers.find((p) => p.key === 't-paper-2')
if (t2?.annotations.length !== 1) throw new Error('annotation not attached to paper 2')
if (t2?.annotations[0]?.quote !== 'vector databases support ANN search') throw new Error('annotation quote mismatch')
console.log('\nADAPTER TEST OK: zotero.sqlite → Paper[] round-trip verified.')
