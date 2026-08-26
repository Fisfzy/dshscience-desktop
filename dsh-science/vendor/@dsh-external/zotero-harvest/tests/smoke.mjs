/**
 * Smoke test — mounts the plugin exactly like the DSH host and executes
 * every tool with representative args against live APIs (small budgets).
 *
 * Run: LIT_INBOX_DIR=/tmp/lit-smoke-inbox node tests/smoke.mjs
 */

import { name, inject, apply } from '../lib/index.js'
import { rmSync, mkdirSync } from 'node:fs'

const inbox = process.env.LIT_INBOX_DIR ?? '/tmp/lit-smoke-inbox'
rmSync(inbox, { recursive: true, force: true })
mkdirSync(inbox, { recursive: true })
process.env.LIT_INBOX_DIR = inbox

const registered = []
apply({
  tools: { register: (t) => registered.push(t) },
  logger: { info: () => {} },
})

console.log(`plugin: ${name} (inject: ${inject.join(', ')}) — ${registered.length} tools`)
if (registered.length !== 6) {
  console.error(`expected 6 tools, got ${registered.length}`)
  process.exit(1)
}

let failed = 0
const results = {}
const tool = (n) => registered.find((t) => t.name === n)

// 1. lit_fetch — live multi-source query with OA link resolution
results.fetch = await tool('lit_fetch').execute(
  { query: 'graph neural networks', max: 6 },
  {},
)
console.log(`lit_fetch: ${results.fetch.papers.length} papers, bySource=${JSON.stringify(results.fetch.bySource)}`)
if (!Array.isArray(results.fetch.papers) || results.fetch.papers.length === 0) failed++
const withLink = results.fetch.papers.filter((p) => p.primaryDownloadUrl)
console.log(`  papers with direct download link: ${withLink.length}/${results.fetch.papers.length}`)

// 1b. exact DOI fetch
results.exact = await tool('lit_fetch').execute(
  { query: '10.1038/nature14539', max: 2 },
  {},
)
console.log(`lit_fetch exact DOI: ${results.exact.papers.length} paper(s) — "${results.exact.papers[0]?.title?.slice(0, 60) ?? '?'}" links=${results.exact.papers[0]?.downloadLinks?.length ?? 0}`)
if (results.exact.papers.length < 1 || results.exact.papers[0].doi !== '10.1038/nature14539') failed++

// 1c. optional 'scholar' source — must degrade gracefully when unreachable
results.scholar = await tool('lit_fetch').execute(
  { query: 'graph neural networks', sources: ['openalex', 'scholar'], max: 4, resolve_downloads: false },
  {},
)
console.log(`lit_fetch with scholar source: bySource=${JSON.stringify(results.scholar.bySource)} total=${results.scholar.total}`)
if (results.scholar.papers.length < 1) failed++ // openalex must still deliver

// 2. lit_sufficiency_check — deterministic audit
results.suff = await tool('lit_sufficiency_check').execute(
  {
    topic: 'graph neural networks',
    subtopics: ['graph neural networks', 'temporal graph'],
    collected: results.fetch.papers,
    min_core: 1,
    min_total: 1,
  },
  {},
)
console.log(`lit_sufficiency_check: sufficient=${results.suff.sufficient} gaps=${results.suff.gaps.join(';') || 'none'}`)
if (typeof results.suff.sufficient !== 'boolean') failed++

// 3. lit_save — inbox mode
results.save = await tool('lit_save').execute(
  { papers: results.fetch.papers.slice(0, 3), mode: 'inbox' },
  {},
)
console.log(`lit_save: saved=${results.save.saved} mode=${results.save.resolvedMode}`)
if (results.save.saved < 1) failed++

// 4. lit_paper_detail — arXiv PDF → evidence card
results.detail = await tool('lit_paper_detail').execute(
  {
    title: 'Attention Is All You Need',
    source: 'arxiv',
    id: '1706.03762',
    pdf_url: 'https://arxiv.org/pdf/1706.03762',
    year: 2017,
    authors: ['Ashish Vaswani', 'Noam Shazeer'],
  },
  {},
)
console.log(`lit_paper_detail: fullTextChars=${results.detail.fullTextChars} method=${results.detail.methodType ?? 'none'}`)
if (results.detail.fullTextChars < 1000) failed++

// 5. lit_download_links — resolve OA links for papers lacking pdfUrl
results.dl = await tool('lit_download_links').execute(
  {
    papers: [
      { title: 'Computational pathology: a survey', doi: '10.1371/journal.pone.0185809', source: 'openalex', id: 'x', authors: [] },
      { title: 'Attention Is All You Need', source: 'arxiv', id: '1706.03762', pdf_url: 'https://arxiv.org/pdf/1706.03762', authors: [] },
    ],
  },
  {})
console.log(`lit_download_links: resolved=${results.dl.resolved} noLink=${JSON.stringify(results.dl.noLink)}`)
const dl0 = results.dl.papers[0]
console.log(`  pone.0185809 primary=${dl0.primaryDownloadUrl ? 'YES' : 'NO'} links=${dl0.downloadLinks.length}`)
if (results.dl.resolved < 2 || !dl0.primaryDownloadUrl) failed++

// 6. lit_review_run — one tiny round
results.review = await tool('lit_review_run').execute(
  {
    topic: 'retrieval augmented generation',
    max_rounds: 1,
    per_round: 3,
    min_core: 1,
    min_total: 1,
    save_mode: 'inbox',
    run_reindex: false,
  },
  {},
)
console.log(
  `lit_review_run: rounds=${results.review.rounds.length} collected=${results.review.collected.length} sufficient=${results.review.sufficiency.sufficient} saved=${results.review.save?.saved}`,
)
if (results.review.collected.length < 1 || !results.review.report.includes('# Literature review')) failed++

console.log(failed === 0 ? '\nSMOKE OK' : `\nSMOKE FAILED: ${failed} check(s)`)
process.exit(failed === 0 ? 0 : 1)
