/**
 * prechecks.ts — verify 的确定性预检(先于任何 judge 调用)。移植自 danus/verify/prechecks.py。
 *
 * 两层,均为纯 ADDITIVE(只能拒绝更多,绝不接受更多),每层 env 可开关:
 *   1. 空洞检查 —— 拒绝近空/单字("QED"、"obvious")输入;
 *   2. 硬禁令 P1/P3/P5 —— 特定坏证明形状的正则拒绝。
 *
 * 改进点:原版在 import 时读 env;本版在调用时读(与 gateway 哲学一致,便于测试)。
 */

import { envInt } from '../shared/env.ts'

// --------------------------------------------------------------------------- //
// 阈值(env 可调,调用时读取)                                                  //
// --------------------------------------------------------------------------- //

export function minStatementChars(): number {
  return envInt('VERIFY_MIN_STATEMENT_CHARS', 10)
}
export function minProofChars(): number {
  return envInt('VERIFY_MIN_PROOF_CHARS', 30)
}
export function minProofWords(): number {
  return envInt('VERIFY_MIN_PROOF_WORDS', 5)
}

const VACUOUS_PROOF_MARKERS = [
  'todo', 'fixme', 'tbd', 'to be done', 'see above', 'see below', 'obvious',
  'obviously true', 'trivial', 'trivially true', 'left as exercise',
  'left to the reader', 'exercise for the reader', 'by inspection',
  'by definition', 'clear', 'clearly', 'qed',
]

// --------------------------------------------------------------------------- //
// 硬禁令开关(默认 ON;"0" 关闭)                                              //
// --------------------------------------------------------------------------- //

export function rejectProblemMdCitations(): boolean {
  return (process.env.VERIFY_REJECT_PROBLEM_MD_CITATIONS ?? '1') === '1'
}
export function rejectUnprovenConditionals(): boolean {
  return (process.env.VERIFY_REJECT_UNPROVEN_CONDITIONALS ?? '1') === '1'
}
export function rejectVagueGestures(): boolean {
  return (process.env.VERIFY_REJECT_VAGUE_GESTURES ?? '1') === '1'
}

// P1: problem.md / data/<NAME>.md 被当作实质数学来源引用。
const PROBLEM_MD_CITATION_PATTERNS = [
  /\bas\s+declared\s+in[\s`'"]+(?:problem|data\/[A-Za-z0-9_]+)\.md\b/i,
  /\bfrom[\s`'"]+(?:problem|data\/[A-Za-z0-9_]+)\.md[\s`'"]+(?:item|section|building\s+block|reduction)\b/i,
  /\bby\s+the\s+master\s+reduction\s+package\s+declared\s+in[\s`'"]+(?:problem|data\/[A-Za-z0-9_]+)\.md\b/i,
  /\bby\s+the\s+master\s+reduction\s+package\s+declared\s+in\s+the\s+problem\s+statement\b/i,
  /\bas\s+known\s+from\s+(?:the\s+problem\s+(?:prompt|statement)|problem\.md|data\/[A-Za-z0-9_]+\.md)\b/i,
  /\bby\s+the\s+verified\s+(?:reductions?|building\s+blocks?)\s+listed\s+in[\s`'"]+(?:problem|data\/[A-Za-z0-9_]+)\.md\b/i,
  /\bas\s+stated\s+in[\s`'"]+(?:problem|data\/[A-Za-z0-9_]+)\.md\b/i,
  /\bthe\s+(?:master\s+)?reduction\s+package\s+(?:declared|stated)\s+in[\s`'"]+(?:problem|data\/[A-Za-z0-9_]+)\.md\b/i,
  /\b(?:this|that|it)\s+is\s+the\s+(?:master\s+)?reduction\s+package\s+declared\s+in[\s`'"]+(?:problem|data\/[A-Za-z0-9_]+)\.md\b/i,
]

// P3: 未证明的条件前提 —— 除非同段落有 16-hex fact_id 背书。
const CONDITIONAL_PREMISE_PATTERNS = [
  /\bassume\s+(?:that\s+)?the\s+verified\s+[^.]{0,100}?\breductions?\s+have\s+(?:reduced|narrowed|placed|brought|moved|driven)/i,
  /\bassume\s+(?:that\s+)?the\s+verified\s+post-W_q\b/i,
  /\bassume\s+(?:that\s+)?the\s+post-W_q[^.]{0,100}?\breductions?\s+have\s+/i,
  /\bsuppose\s+(?:that\s+)?the\s+(?:no-hit\s+)?(?:putative\s+)?(?:residual|survivor|cell|data)\s+has\s+been\s+(?:reduced|narrowed|placed|moved|brought|driven)/i,
]

const FACT_ID_PATTERN = /\b[0-9a-f]{16}\b/

// P5: 对 "well-known"/classical 结果的模糊手势,无具体引用。
const VAGUE_GESTURE_PATTERNS = [
  /\bby\s+some\s+(?:Beatty|Dirichlet|Diophantine|Vinogradov|Weyl|Erd[oö]s[‐‑–—-]Tur[aá]n|classical|well-known)\s+(?:argument|theorem|inequality|estimate)\b/i,
  /\b(?:as|it)\s+is\s+well\s+known\s+(?:that|in\s+the\s+literature)\b/i,
  /\bby\s+(?:an?\s+)?(?:obvious|elementary|straightforward|standard)\s+(?:density|Diophantine|integer|approximation|estimation|counting|equidistribution)\s+(?:argument|theorem|principle)\b/i,
]

/** 去掉 code fence / inline code / 引用 / hr / 标题标记,合并空白。 */
export function stripMarkdownNoise(text: string): string {
  const noFences = text.replace(/```[\s\S]*?```/g, '')
  const noInlineCode = noFences.replace(/`[^`\n]*`/g, '')
  const noQuotes = noInlineCode.replace(/^\s*>\s?/gm, '')
  const noHr = noQuotes.replace(/^\s*[-*_]{3,}\s*$/gm, '')
  const noHeaders = noHr.replace(/^\s*#+\s*/gm, '')
  return noHeaders.replace(/\s+/g, ' ').trim()
}

/** (isVacuous, reason)。保守:只标"短且化简后只剩一个空洞 marker"的。 */
export function isVacuousProof(proof: string): [boolean, string] {
  const minChars = minProofChars()
  const minWords = minProofWords()
  const cleaned = stripMarkdownNoise(proof)
  if (cleaned.length < minChars) {
    return [true,
      `proof has only ${cleaned.length} substantive characters after stripping ` +
      `markdown noise (minimum ${minChars}). A vacuous or near-empty ` +
      'proof cannot be passed by the verifier.']
  }
  const wordCount = (cleaned.match(/\b\w+\b/g) ?? []).length
  if (wordCount < minWords) {
    return [true, `proof has only ${wordCount} substantive words (minimum ${minWords}).`]
  }
  const strippedLowered = cleaned.toLowerCase().replace(/[^\w\s]/g, '').trim()
  for (const marker of VACUOUS_PROOF_MARKERS) {
    if (strippedLowered === marker) {
      return [true,
        `proof body reduces to the vacuous marker "${marker}" after ` +
        'stripping punctuation and markdown noise.']
    }
  }
  return [false, '']
}

/** (isVacuous, reason)。只拒绝短到不可能为真的 statement。 */
export function isVacuousStatement(statement: string): [boolean, string] {
  const minChars = minStatementChars()
  const cleaned = stripMarkdownNoise(statement)
  if (cleaned.length < minChars) {
    return [true,
      `statement has only ${cleaned.length} substantive characters after ` +
      `stripping markdown noise (minimum ${minChars}). Refusing to ` +
      'verify against an essentially empty statement.']
  }
  return [false, '']
}

/** Python repr() 的字符串形态(单引号优先,含单引号且无双引号时用双引号)。 */
function pyRepr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'"
  const esc = s
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r')
    .split('')
    .map((c) => {
      const code = c.codePointAt(0)!
      if (code < 0x20 || code === 0x7f) return '\\x' + code.toString(16).padStart(2, '0')
      return c
    })
    .join('')
    .replace(new RegExp(quote, 'g'), '\\' + quote)
  return quote + esc + quote
}

/** P1:拒绝把 problem.md / data/<NAME>.md 当数学来源的证明。 */
export function checkProblemMdCitation(proof: unknown): string | null {
  if (!rejectProblemMdCitations() || typeof proof !== 'string' || !proof) return null
  for (const pat of PROBLEM_MD_CITATION_PATTERNS) {
    const m = proof.match(pat)
    if (m) {
      return (
        'Hard Prohibition P1: the proof cites problem.md / data/<NAME>.md as a ' +
        `substantive math source. Matched phrase: ${pyRepr(m[0])}. Replace with a ` +
        'specific verified fact_id from the fact graph; problem.md is the target ' +
        'description, not a source of premises. Override: set ' +
        'VERIFY_REJECT_PROBLEM_MD_CITATIONS=0.'
      )
    }
  }
  return null
}

/** P3:拒绝无同段 fact_id 背书的条件前提。 */
export function checkUnprovenConditionalPremises(proof: unknown): string | null {
  if (!rejectUnprovenConditionals() || typeof proof !== 'string' || !proof) return null
  for (const pat of CONDITIONAL_PREMISE_PATTERNS) {
    const g = new RegExp(pat.source, pat.flags.includes('g') ? pat.flags : pat.flags + 'g')
    for (const m of proof.matchAll(g)) {
      const start = m.index!
      const end = start + m[0].length
      let paraStart = proof.lastIndexOf('\n\n', start - 1)
      if (paraStart < 0) paraStart = 0
      let paraEnd = proof.indexOf('\n\n', end)
      if (paraEnd < 0) paraEnd = proof.length
      if (FACT_ID_PATTERN.test(proof.slice(paraStart, paraEnd))) continue
      return (
        'Hard Prohibition P3: the proof contains a conditional-premise phrase ' +
        `(${pyRepr(m[0])}) but no specific verified fact_id is cited in the same ` +
        'paragraph proving the assumed narrowing. Either replace the assumption ' +
        'with a specific citation or cite a backing fact_id in the same paragraph. ' +
        'Override: set VERIFY_REJECT_UNPROVEN_CONDITIONALS=0.'
      )
    }
  }
  return null
}

/** P5:拒绝无具体引用的"众所周知"手势。 */
export function checkVagueGestures(proof: unknown): string | null {
  if (!rejectVagueGestures() || typeof proof !== 'string' || !proof) return null
  for (const pat of VAGUE_GESTURE_PATTERNS) {
    const m = proof.match(pat)
    if (m) {
      return (
        "Hard Prohibition P5: the proof gestures at a 'well-known'/classical " +
        `result without a specific citation. Matched phrase: ${pyRepr(m[0])}. ` +
        'Replace with a specific verified fact_id or an external paper citation ' +
        '(paper_id / theorem_id / arXiv id). Override: set ' +
        'VERIFY_REJECT_VAGUE_GESTURES=0.'
      )
    }
  }
  return null
}

/**
 * 跑全部预检;首个拒绝返回 {status, detail},全通过返回 null。
 * P1/P3/P5 同时跑在 proof 和 statement 上;任何 check 异常视为 no-match(绝不 500)。
 */
export function runPrechecks(statement: string, proof: string): { status: number; detail: string } | null {
  const [vacS, reasonS] = isVacuousStatement(statement)
  if (vacS) return { status: 400, detail: `vacuous statement: ${reasonS}` }
  const [vacP, reasonP] = isVacuousProof(proof)
  if (vacP) return { status: 400, detail: `vacuous proof: ${reasonP}` }

  const checks: [typeof checkProblemMdCitation, string][] = [
    [checkProblemMdCitation, 'P1'],
    [checkUnprovenConditionalPremises, 'P3'],
    [checkVagueGestures, 'P5'],
  ]
  for (const [checkFn, name] of checks) {
    for (const [sourceLabel, sourceText] of [['proof', proof], ['statement', statement]] as const) {
      let reason: string | null
      try {
        reason = checkFn(sourceText)
      } catch {
        reason = null // defensive:check 绝不能变成 500
      }
      if (reason) return { status: 400, detail: `[${name} on ${sourceLabel}] ${reason}` }
    }
  }
  return null
}
