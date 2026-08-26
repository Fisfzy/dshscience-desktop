/**
 * Tiny local-env loader: reads .env.local (gitignored secrets) and exports
 * ZWR_* into process.env unless already set by the caller's environment.
 * Import FIRST in every CLI script:  `import './env.mjs'`
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const candidates = [join(here, '..', '.env.local'), join(here, '.env.local'), '/root/.zotero-wave-rag.env']
for (const file of candidates) {
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (!m || line.trim().startsWith('#')) continue
    const key = m[1]
    if (process.env[key] === undefined) process.env[key] = m[2].trim()
  }
}
