/**
 * lit-harvest — Zotero local HTTP API client (desktop running).
 *
 * Zotero 7's local API on http://127.0.0.1:23119 trusts loopback by default
 * (no API key). We create the metadata item, then attach the PDF file
 * (multipart). Best-effort: when the desktop is not running this module is
 * skipped and the sqlite/inbox paths take over.
 */

import type { Paper } from '../types.ts'

export interface ZoteroApiAddResult {
  key?: string
  ok: boolean
  message: string
}

export async function probeZoteroApi(base: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(`${base}/api/users/0/collections`, { signal: ctrl.signal })
    clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

function creatorsFor(p: Paper): unknown[] {
  return p.authors.map((name) => {
    const idx = name.lastIndexOf(' ')
    if (idx > 0) {
      return { creatorType: 'author', firstName: name.slice(0, idx), lastName: name.slice(idx + 1) }
    }
    return { creatorType: 'author', name }
  })
}

function zoteroItemJson(p: Paper): unknown {
  return {
    itemType: 'journalArticle',
    title: p.title,
    creators: creatorsFor(p),
    date: p.year ? String(p.year) : undefined,
    publicationTitle: p.venue,
    DOI: p.doi,
    url: p.url,
    abstractNote: p.abstract,
    tags: (p.keywords ?? []).map((k) => ({ tag: k })),
  }
}

/** Create the metadata item via the local API. */
export async function addItemViaApi(base: string, p: Paper): Promise<ZoteroApiAddResult> {
  try {
    const res = await fetch(`${base}/api/users/0/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [zoteroItemJson(p)] }),
    })
    const body = (await res.json()) as { successful?: Record<string, { key?: string }>; failed?: Record<string, unknown> }
    if (!res.ok || !body.successful) {
      return { ok: false, message: `Zotero API ${res.status}: ${JSON.stringify(body).slice(0, 200)}` }
    }
    const key = Object.values(body.successful)[0]?.key
    return { ok: true, key, message: `item created (key=${key})` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/** Attach a PDF file to an existing item (multipart). */
export async function attachPdfViaApi(base: string, itemKey: string, pdfPath: string): Promise<ZoteroApiAddResult> {
  try {
    const file = await import('node:fs/promises').then(({ readFile }) => readFile(pdfPath))
    const form = new FormData()
    form.append('file', new Blob([file]), pdfPath.split('/').pop() ?? 'paper.pdf')
    const res = await fetch(`${base}/api/users/0/items/${itemKey}/file`, {
      method: 'POST',
      body: form,
    })
    return res.ok
      ? { ok: true, message: `attachment uploaded for ${itemKey}` }
      : { ok: false, message: `attach failed HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
