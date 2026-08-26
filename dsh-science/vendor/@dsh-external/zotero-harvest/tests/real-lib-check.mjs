import { addPaperToSqlite } from '../lib/save/zotero_sqlite.js'
import { zoteroWaveRagDir } from '../lib/config.js'
// zwr lib path is resolved from the installed plugin tree (override via ZWR_LIB_DIR)
const zwrDir = process.env.ZWR_LIB_DIR ?? zoteroWaveRagDir()
if (!zwrDir) { console.error('zotero-wave-rag not found; set ZWR_LIB_DIR'); process.exit(1) }
const { readZoteroLibrary } = await import(`${zwrDir}/lib/zotero/db.js`)

const DB = '/tmp/lit-real-test/zotero/zotero.sqlite'
const STORAGE = '/tmp/lit-real-test/zotero/storage'

const paper = {
  source: 'arxiv', id: '1706.03762',
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar', 'Jakob Uszkoreit'],
  year: 2017, venue: 'NeurIPS',
  abstract: 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.',
  doi: '10.48550/arXiv.1706.03762',
  url: 'https://arxiv.org/abs/1706.03762',
  pdfUrl: 'https://arxiv.org/pdf/1706.03762',
  keywords: ['transformer', 'attention'],
}

const res = await fetch(paper.pdfUrl)
const pdf = new Uint8Array(await res.arrayBuffer())
console.log('pdf bytes:', pdf.length)

const r1 = addPaperToSqlite(DB, STORAGE, paper, 'lit-harvest-test', pdf)
console.log('insert 1:', JSON.stringify(r1))
const r2 = addPaperToSqlite(DB, STORAGE, paper, 'lit-harvest-test', pdf)
console.log('insert 2 (should be dup):', JSON.stringify(r2))

const papers = readZoteroLibrary({ dbPath: DB, storageDir: STORAGE })
const found = papers.find((p) => p.title === paper.title)
console.log('readZoteroLibrary sees it:', found ? `key=${found.key} doi=${found.doi} tags=${found.tags.join(',')} collections=${found.collections.join(',')}` : 'NOT FOUND')
console.log(found && r1.ok && !r2.ok ? 'REAL-LIB TEST OK' : 'REAL-LIB TEST FAILED')
process.exit(found && r1.ok && !r2.ok ? 0 : 1)
