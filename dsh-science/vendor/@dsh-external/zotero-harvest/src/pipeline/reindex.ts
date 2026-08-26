/**
 * lit-harvest — trigger the zotero-wave-rag reindex.
 *
 * Runs `<zotero-wave-rag>/scripts/ingest.mjs` via a subprocess (isolated
 * from the plugin process; the ingest script is plain-ESM lib code that
 * runs under node directly). The incremental cache only re-embeds papers
 * whose text changed, so after a lit-harvest save the new papers join the
 * library with a cheap rebuild, and `zotero_search` sees them immediately.
 */

import { spawn } from 'node:child_process'
import { zoteroWaveRagDir } from '../config.ts'

export interface ReindexResult {
  triggered: boolean
  ok: boolean
  message: string
  stdout?: string
}

export function triggerReindex(
  dataDir: string,
  opts: { timeoutMs?: number } = {},
): Promise<ReindexResult> {
  const pluginDir = zoteroWaveRagDir()
  if (!pluginDir) {
    return Promise.resolve({
      triggered: false,
      ok: false,
      message: 'zotero-wave-rag plugin not found next to lit-harvest',
    })
  }
  const script = `${pluginDir}/scripts/ingest.mjs`
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd: pluginDir,
      env: {
        ...process.env,
        ZWR_DATA_DIR: dataDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => err.push(d))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({
        triggered: true,
        ok: false,
        message: 'reindex timed out (killed)',
        stdout: Buffer.concat(out).toString().slice(-2000),
      })
    }, opts.timeoutMs ?? 300_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      const stdout = Buffer.concat(out).toString()
      const stderr = Buffer.concat(err).toString()
      resolve({
        triggered: true,
        ok: code === 0,
        message: code === 0 ? 'index rebuilt' : `reindex failed (exit ${code}): ${stderr.slice(-300)}`,
        stdout: stdout.slice(-2000),
      })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ triggered: false, ok: false, message: `spawn failed: ${e.message}` })
    })
  })
}
