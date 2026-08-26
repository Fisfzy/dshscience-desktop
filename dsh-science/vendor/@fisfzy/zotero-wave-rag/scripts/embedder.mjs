/**
 * Embedder selection CLI — the "choose your embedding model" entry point.
 *
 * Usage:
 *   node scripts/embedder.mjs list              # show presets + current
 *   node scripts/embedder.mjs set <preset-id>   # switch (persisted)
 *   node scripts/embedder.mjs status            # current + effective config
 */

import './env.mjs'
import { engine } from '../lib/core/engine.js'
import { EMBEDDER_PRESETS } from '../lib/core/embedder_registry.js'

const [cmd, arg] = process.argv.slice(2)

if (cmd === 'list' || cmd === undefined) {
  const info = engine.listEmbedders()
  console.log(`当前嵌入模型: ${info.current}\n`)
  for (const p of info.presets) {
    console.log(`  ${p.id.padEnd(18)} ${p.label}  [${p.configured ? '已就绪' : p.kind === 'api' ? '缺 API key' : ''}]`)
    if (p.note) console.log(`  ${''.padEnd(18)} ↳ ${p.note}`)
  }
  console.log('\n切换: node scripts/embedder.mjs set <id>')
} else if (cmd === 'set') {
  if (!arg) {
    console.error('用法: node scripts/embedder.mjs set <id>')
    process.exit(1)
  }
  const r = engine.setEmbedder(arg)
  console.log(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`)
  process.exit(r.ok ? 0 : 1)
} else if (cmd === 'status') {
  const cfg = engine.config
  console.log('当前预设:', engine.currentEmbedderId())
  if (cfg.embedder === 'api') {
    console.log('embedder :', `api (${cfg.embedderApi?.model} @ ${cfg.embedderApi?.baseURL})`)
    console.log('api key  :', cfg.embedderApi?.apiKey ? '已配置' : '未配置')
  } else {
    console.log('embedder :', 'hash（离线，零成本）')
  }
  console.log('indexLevel:', cfg.indexLevel)
  console.log('dataDir  :', cfg.dataDir || '(示例库)')
  console.log('wave     :', JSON.stringify(cfg.wave))
} else {
  console.error(`未知命令 "${cmd}"（可用: list | set <id> | status）`)
  process.exit(1)
}
void EMBEDDER_PRESETS
