/**
 * lit-harvest — save orchestrator.
 *
 * `lit_save` mode resolution:
 *   auto → probe Zotero local API (desktop running?)
 *          ├─ reachable → 'zotero-api' (metadata item + best-effort PDF attach)
 *          └─ unreachable → zotero.sqlite writable in dataDir?
 *                           ├─ yes → 'sqlite' (offline import)
 *                           └─ no  → 'inbox'
 *   explicit modes force their path ('sqlite' errors if DB missing/locked).
 *
 * PDF download is best-effort: when a pdfUrl is present we fetch it once;
 * a failure never aborts the metadata save.
 */

import type { Paper, SaveMode, SaveResult } from '../types.ts'
import type { LitConfig } from '../config.ts'
import { probeZoteroApi, addItemViaApi, attachPdfViaApi } from './zotero_api.ts'
import { addPaperToSqlite } from './zotero_sqlite.ts'
import { writeInbox } from './inbox.ts'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

async function downloadPdf(p: Paper, timeoutMs: number): Promise<Uint8Array | undefined> {
  const url = p.primaryDownloadUrl ?? p.pdfUrl
  if (!url) return undefined
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return undefined
    const buf = new Uint8Array(await res.arrayBuffer())
    return buf.length > 0 ? buf : undefined
  } catch {
    return undefined
  }
}

export interface SavePapersOptions {
  papers: Paper[]
  mode?: SaveMode
  collection?: string
  cfg: LitConfig
}

export async function savePapers(opts: SavePapersOptions): Promise<SaveResult> {
  const cfg = opts.cfg
  const requested = opts.mode ?? 'auto'
  const saved: SaveResult['zoteroItems'] = []
  const skipped: string[] = []
  let resolvedMode = 'auto'

  const apiUp = await probeZoteroApi(cfg.zoteroApiBase)
  const dbPath = cfg.dataDir ? join(cfg.dataDir, 'zotero.sqlite') : ''
  const storageDir = cfg.dataDir ? join(cfg.dataDir, 'storage') : undefined
  const sqliteUsable = dbPath !== '' && existsSync(dbPath)

  let mode: 'zotero-api' | 'sqlite' | 'inbox'
  if (requested === 'zotero-api') mode = 'zotero-api'
  else if (requested === 'sqlite') mode = sqliteUsable ? 'sqlite' : 'inbox'
  else if (requested === 'inbox') mode = 'inbox'
  else mode = apiUp ? 'zotero-api' : sqliteUsable ? 'sqlite' : 'inbox'
  resolvedMode = mode

  for (const p of opts.papers) {
    const pdf = await downloadPdf(p, cfg.httpTimeoutMs)
    if (mode === 'zotero-api') {
      const created = await addItemViaApi(cfg.zoteroApiBase, p)
      if (!created.ok || !created.key) {
        skipped.push(`${p.title}: ${created.message}`)
        continue
      }
      let tmp: string | null = null
      if (pdf) {
        tmp = tempPdf(cfg, p, pdf)
        await attachPdfViaApi(cfg.zoteroApiBase, created.key, tmp)
      }
      if (tmp) rmSync(tmp, { force: true })
      saved.push({ key: created.key, doi: p.doi, title: p.title })
    } else if (mode === 'sqlite') {
      const r = addPaperToSqlite(dbPath, storageDir, p, opts.collection, pdf)
      if (!r.ok) {
        skipped.push(`${p.title}: ${r.message}`)
        continue
      }
      saved.push({ key: r.key, itemID: r.itemID, doi: p.doi, title: p.title })
    } else {
      writeInbox(cfg.inboxDir, p, pdf)
      saved.push({ doi: p.doi, title: p.title })
    }
  }

  return {
    saved: saved.length,
    mode: requested,
    resolvedMode,
    collection: opts.collection,
    inboxDir: mode === 'inbox' ? cfg.inboxDir : undefined,
    zoteroItems: saved,
    skipped,
  }
}

function tempPdf(cfg: LitConfig, p: Paper, bytes: Uint8Array): string {
  const dir = join(cfg.inboxDir, 'tmp-attach')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${Date.now()}-${p.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)}.pdf`)
  writeFileSync(path, bytes)
  return path
}
