/**
 * glossary.ts — 项目/全局术语表与"未定义符号"检查,移植自 danus/core/glossary.py。
 * 全局术语资源 glossary_global.json 与原版同一文件(逐字节复制)。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codePointCompare } from './util.ts'
import globalGlossaryJson from './glossary_global.json' with { type: 'json' }

// --------------------------------------------------------------------------- //
// flatten                                                                     //
// --------------------------------------------------------------------------- //

type GlossaryEntry = string | { definition?: unknown; aliases?: unknown }

/**
 * flatten(glossary_obj):接受全局形状 {version, terms:{term:{definition, aliases}}}
 * 或扁平形状 {term: definition};alias 继承同一 definition。falsy → {}。
 */
export function flattenGlossary(obj: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out
  const rec = obj as Record<string, unknown>
  const terms =
    'terms' in rec && typeof rec.terms === 'object' && rec.terms !== null && !Array.isArray(rec.terms)
      ? (rec.terms as Record<string, GlossaryEntry>)
      : (rec as Record<string, GlossaryEntry>)
  for (const [term, entry] of Object.entries(terms ?? {})) {
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
      const defn = String(entry.definition ?? '')
      out[String(term)] = defn
      const aliases = Array.isArray(entry.aliases) ? entry.aliases : []
      for (const alias of aliases) out[String(alias)] = defn
    } else {
      out[String(term)] = String(entry)
    }
  }
  return out
}

// --------------------------------------------------------------------------- //
// global glossary(包资源,lru_cache(maxsize=1) 等价:模块级一次性加载)      //
// --------------------------------------------------------------------------- //

function loadGlobalText(): string | null {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    return readFileSync(join(here, 'glossary_global.json'), 'utf8')
  } catch {
    return null
  }
}

let _globalCache: Record<string, string> | null = null

/** 全局(universal notation)术语表;资源缺失/坏 JSON → {}。 */
export function globalGlossary(): Record<string, string> {
  if (_globalCache === null) {
    let parsed: unknown = null
    // 优先走 import 属性加载的打包资源;失败回退到文件读取。
    try {
      parsed = globalGlossaryJson ?? JSON.parse(loadGlobalText() ?? 'null')
    } catch {
      parsed = null
    }
    try {
      _globalCache = flattenGlossary(parsed)
    } catch {
      _globalCache = {}
    }
  }
  return _globalCache
}

/** term + alias 都算已定义。 */
export function globalTerms(): Set<string> {
  return new Set(Object.keys(globalGlossary()))
}

// --------------------------------------------------------------------------- //
// undefined_symbols                                                           //
// --------------------------------------------------------------------------- //

const _GREEK =
  'alpha beta gamma delta epsilon eta theta iota kappa lambda mu nu xi pi rho sigma tau phi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega'.split(
    ' ',
  )

const GREEK_SORTED = [..._GREEK].sort((a, b) => b.length - a.length)

// _INTERESTING:挑"有趣的数学记号"。逐支与原版对应:
//   [A-Za-z][A-Za-z]?(?:_\{[^}]+\}|_[A-Za-z0-9+]+)+(?:\([^)\s]{0,30}\))?
//   [A-Z][A-Z]?(?:\([^)\s]{0,30}\)|\+|>=\d+|<=\d+)
//   greek 词(长按降序)
//   \{[a-zA-Z]\} | \[[a-z],\s*[a-z]\] | \([a-z],\s*[a-z]\)
const INTERESTING = new RegExp(
  '\\b(' +
    '[A-Za-z][A-Za-z]?(?:_\\{[^}]+\\}|_[A-Za-z0-9+]+)+(?:\\([^)\\s]{0,30}\\))?' +
    '|[A-Z][A-Z]?(?:\\([^)\\s]{0,30}\\)|\\+|>=\\d+|<=\\d+)' +
    '|' +
    GREEK_SORTED.join('|') +
    '|\\{[a-zA-Z]\\}|\\[[a-z],\\s*[a-z]\\]|\\([a-z],\\s*[a-z]\\)' +
    ')',
  'g',
)

const STOPLIST = new Set([
  'I', 'II', 'III', 'IV', 'V', 'VI', 'OR', 'AND', 'NOT', 'IF', 'THEN',
  'QED', 'PROOF', 'LEMMA', 'THEOREM', 'CLAIM',
])

const TRAILING_ARGS = /\([^)]*\)$/

/**
 * undefined_symbols:出现在正文但未在 defined 并集中定义的记号。
 * base form(去掉尾部 (...) 参数列表)已定义的也跳过;返回码点序去重列表。
 */
export function undefinedSymbols(input: {
  statement: string
  proof: string
  intuition?: string
  defined: Iterable<string>
}): string[] {
  const defined = new Set(input.defined)
  const found = new Set<string>()
  for (const text of [input.statement, input.proof, input.intuition ?? '']) {
    INTERESTING.lastIndex = 0
    for (const m of (text ?? '').matchAll(INTERESTING)) {
      const tok = m[1]!
      if (STOPLIST.has(tok) || defined.has(tok)) continue
      const stripped = tok.replace(TRAILING_ARGS, '')
      if (stripped && defined.has(stripped)) continue
      found.add(tok)
    }
  }
  return [...found].sort(codePointCompare)
}
