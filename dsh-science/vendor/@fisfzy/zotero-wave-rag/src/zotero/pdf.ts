/**
 * PDF full-text extraction (Zotero 7 path).
 *
 * Zotero 6 stored raw full text in `fulltextItems.indexableText`; Zotero 7
 * replaced it with a position-less word index (bag of words), so the raw
 * text must come from the PDF itself. This module shells out to poppler's
 * `pdftotext` (available on this box) with a persistent disk cache so a
 * library is only parsed once.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

/** Cache dir: ZWR_CACHE_DIR, else <dataDir>/.zwr-cache, else tmpdir. */
export function cacheDir(dataDir?: string): string {
  if (process.env.ZWR_CACHE_DIR) return process.env.ZWR_CACHE_DIR
  if (dataDir) return join(dataDir, '.zwr-cache')
  return join(tmpdir(), 'zotero-wave-rag-cache')
}

function cachePath(cache: string, paperKey: string): string {
  return join(cache, `${createHash('sha1').update(paperKey).digest('hex').slice(0, 16)}.txt`)
}

/** Extract text from one PDF via `pdftotext <pdf> -`. */
export async function extractPdfText(pdfPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('pdftotext', ['-layout', pdfPath, '-'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')))
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')))
    child.on('error', (e) => reject(e))
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`pdftotext exited ${code}: ${err.slice(0, 120)}`))
        return
      }
      resolve(out)
    })
  })
}

/**
 * Extract (with cache) the text for one paper's PDF.
 * Returns undefined when extraction fails or yields no text.
 */
export async function fullTextForPdf(
  paperKey: string,
  pdfPath: string,
  dataDir?: string,
): Promise<string | undefined> {
  const cache = cacheDir(dataDir)
  const file = cachePath(cache, paperKey)
  if (existsSync(file)) {
    const cached = readFileSync(file, 'utf8')
    return cached.length > 0 ? cached : undefined
  }
  try {
    mkdirSync(cache, { recursive: true })
    const text = await extractPdfText(pdfPath)
    const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
    if (normalized.length > 0) {
      writeFileSync(file, normalized, 'utf8')
      return normalized
    }
  } catch {
    // fall through
  }
  return undefined
}

/** Whether `pdftotext` is available (checked once). */
let _checked: boolean | undefined
export function hasPdfTextTool(): boolean {
  if (_checked !== undefined) return _checked
  try {
    const r = spawnSync('pdftotext', ['-v'], { stdio: 'ignore' })
    _checked = r.error === undefined
  } catch {
    _checked = false
  }
  return _checked
}
