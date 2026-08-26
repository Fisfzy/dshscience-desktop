/**
 * Pre-flight: mounts the plugin exactly like the DSH host, executes every
 * tool with representative args, and validates the outputs against each
 * tool's OWN declared output schema — mirroring the host's validation
 * (lossless JSON + additionalProperties:false + required keys).
 *
 * Run: node --import <tsx> scripts/preflight.mjs
 */

import { name, inject, apply } from '../lib/index.js'

const registered = []
apply({
  tools: { register: (t) => registered.push(t) },
  logger: { info: () => {} },
})

const ARGS = {
  zotero_status: {},
  zotero_search: { query: '拉弯耦合 层间效应 复合材料层合板', topK: 3 },
  zotero_paper_detail: { key: 'FMIYFFM8' },
  zotero_compare: { keys: ['FMIYFFM8', 'NDVA4Y7H'] },
  zotero_embedder: { action: 'list' },
}

function findUndefined(value, path) {
  if (value === undefined) return path
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findUndefined(value[i], `${path}[${i}]`)
      if (hit) return hit
    }
    return undefined
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const hit = findUndefined(v, `${path}.${k}`)
      if (hit) return hit
    }
  }
  return undefined
}

let failed = 0
for (const tool of registered) {
  const args = ARGS[tool.name] ?? {}
  const label = `${tool.name}(${JSON.stringify(args)})`
  try {
    const value = await tool.execute(args, {})
    const issues = []

    // 1. lossless
    const undef = findUndefined(value, '$')
    if (undef) issues.push(`undefined at ${undef}`)

    // 2. top-level keys must all be declared (additionalProperties:false)
    const props = tool.output?.schema?.properties
    if (props && typeof props === 'object') {
      for (const k of Object.keys(value)) {
        if (!(k in props)) issues.push(`undeclared key "${k}" (declared: ${Object.keys(props).join(', ')})`)
      }
      // 3. required keys present
      for (const [k, spec] of Object.entries(props)) {
        if (spec.required === true && !(k in value)) issues.push(`missing required key "${k}"`)
      }
    }

    if (issues.length === 0) {
      console.log(`✅ ${label}`)
    } else {
      failed++
      console.log(`❌ ${label}\n   ${issues.join('\n   ')}`)
    }
  } catch (error) {
    failed++
    console.log(`❌ ${label} THREW: ${error?.message ?? error}`)
  }
}

console.log(`\nplugin: ${name} (inject: ${inject.join(', ')}) — ${registered.length} tools`)
if (failed > 0) {
  console.error(`PREFLIGHT FAILED: ${failed} tool(s) have schema/lossless issues`)
  process.exit(1)
}
console.log('PREFLIGHT OK: every tool output matches its declared schema and is lossless JSON.')
