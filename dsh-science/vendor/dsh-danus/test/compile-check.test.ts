/**
 * compile-check.test.ts — 原生 LaTeX 编译门(真实 MiKTeX/pdflatex)。
 * 语义对照 compile_verify.sh:两遍编译、严格失败(undefined refs 也算失败)。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileCheck, resolveEngine } from '../src/services/compile-check.ts'

const VALID = String.raw`\documentclass{amsart}
\title{Odd sums}
\newtheorem{theorem}{Theorem}
\begin{document}
\maketitle
\begin{theorem}\label{thm:odd}
For every positive integer $n$, $1+3+\cdots+(2n-1)=n^2$.
\end{theorem}
\begin{proof}
Induction on $n$; see Theorem~\ref{thm:odd} itself.
\end{proof}
\end{document}
`

const UNDEFINED_CITE = String.raw`\documentclass{amsart}
\begin{document}
By \cite{nonexistent-key} and Theorem~\ref{thm:ghost}, done.
\end{document}
`

const hasEngine = resolveEngine() !== null

test('引擎探测:本机解析到 pdflatex(MiKTeX)', { skip: !hasEngine }, () => {
  const e = resolveEngine()
  assert.ok(e, 'expected a LaTeX engine on this machine')
  assert.match(e.bin, /pdflatex|tectonic/i)
})

test('合法文档:COMPILE OK + PDF 落回 tex 旁边', { skip: !hasEngine }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'danus-tex-'))
  const tex = join(dir, 'main.tex')
  writeFileSync(tex, VALID, 'utf8')
  const r = compileCheck(tex)
  assert.equal(r.ok, true, r.log)
  assert.equal(r.engine_available, true)
  assert.match(r.log, /COMPILE OK/)
  assert.ok(existsSync(join(dir, 'main.pdf')), 'PDF 应回写到 tex 同目录')
})

test('未定义引用:严格失败(第二遍后仍 undefined)', { skip: !hasEngine }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'danus-tex-'))
  const tex = join(dir, 'main.tex')
  writeFileSync(tex, UNDEFINED_CITE, 'utf8')
  const r = compileCheck(tex)
  assert.equal(r.ok, false)
  assert.equal(r.engine_available, true)
  assert.match(r.log, /undefined citations\/references/)
  assert.match(r.log, /COMPILE FAILED/)
})

test('缺失 tex 文件:响亮失败但不崩', () => {
  const r = compileCheck(join(tmpdir(), 'definitely-missing.tex'))
  assert.equal(r.ok, false)
  assert.match(r.log, /no such \.tex/)
})
