/**
 * services/compile-check.ts — LaTeX 编译门的原生 TS 实现。
 * 逐语义移植 assets/write-paper/driver/compile_verify.sh(原版 bash):
 *   引擎选择(TEX_ENGINE 覆盖;否则 pdflatex → tectonic 自动探测)→
 *   隔离临时 build 目录 → pdflatex 跑两遍(\ref/\cite 第二遍解析)→
 *   严格失败:rc≠0 / 无 PDF / log 有 '^!' 行 / 有 undefined citation·reference。
 * 超越原版:去掉 bash 依赖,Windows 原生直调 MiKTeX/TeX Live/Tectonic。
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { findOnPath } from '../shared/headless.ts'
import { envStr } from '../shared/env.ts'

export interface CompileCheckResult {
  ok: boolean
  log: string
  engine_available: boolean
}

type Engine = 'pdflatex' | 'xelatex' | 'lualatex' | 'tectonic'

const UNDEF_RE = /Citation .* undefined|Reference .* undefined|There were undefined references/
const ERR_LINE_RE = /^!/m

/** 引擎解析:TEX_ENGINE 覆盖 → pdflatex → tectonic → null(未安装)。 */
export function resolveEngine(): { engine: Engine; bin: string } | null {
  const override = envStr('TEX_ENGINE')
  if (override) {
    if (!['pdflatex', 'xelatex', 'lualatex', 'tectonic'].includes(override)) {
      return null
    }
    const bin = findOnPath(override)
    return bin ? { engine: override as Engine, bin } : null
  }
  const pdf = findOnPath('pdflatex')
  if (pdf) return { engine: 'pdflatex', bin: pdf }
  const tec = findOnPath('tectonic')
  if (tec) return { engine: 'tectonic', bin: tec }
  return null
}

function grepLines(text: string, re: RegExp, head = 40): string {
  return text.split('\n').filter((l) => re.test(l)).slice(0, head).join('\n')
}

/**
 * 编译门:对 texPath 执行严格编译检查。绝不抛错——
 * 引擎缺失 → engine_available=false;失败 → ok:false + 冒犯日志行。
 */
export function compileCheck(texPath: string): CompileCheckResult {
  if (!texPath || !existsSync(texPath)) {
    return { ok: false, log: `compile_verify: no such .tex: '${texPath}'`, engine_available: true }
  }
  const resolved = resolveEngine()
  if (!resolved) {
    return {
      ok: false,
      log: 'compile_verify: no LaTeX engine installed — install TeX Live/MiKTeX or Tectonic',
      engine_available: false,
    }
  }
  const { engine, bin } = resolved
  const texAbs = resolve(texPath)
  const stem = basename(texAbs).replace(/\.tex$/i, '')
  const build = join(tmpdir(), `wp_compile_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(build, { recursive: true })
  try {
    const buildTex = join(build, `${stem}.tex`)
    copyFileSync(texAbs, buildTex)

    let rc: number | null
    let consoleOut = ''
    if (engine === 'tectonic') {
      const cp = spawnSync(bin, ['--keep-logs', '--chatter', 'minimal', '--outdir', build, `${stem}.tex`], {
        cwd: build, timeout: 300_000, encoding: 'utf8', windowsHide: true,
      })
      rc = cp.status
      consoleOut = String(cp.stdout ?? '') + String(cp.stderr ?? '')
    } else {
      // 两遍:第一遍可有未解析引用,第二遍解析它们
      let last: ReturnType<typeof spawnSync> | null = null
      for (let pass = 0; pass < 2; pass++) {
        last = spawnSync(bin, ['-interaction=nonstopmode', '-halt-on-error', `${stem}.tex`], {
          cwd: build, timeout: 300_000, encoding: 'utf8', windowsHide: true,
        })
      }
      rc = last!.status
      consoleOut = String(last!.stdout ?? '') + String(last!.stderr ?? '')
    }

    const logPath = join(build, `${stem}.log`)
    const pdfPath = join(build, `${stem}.pdf`)
    const logText = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
    const problems: string[] = []

    if (rc !== 0 || !existsSync(pdfPath)) {
      problems.push(`${engine} exited ${rc} / no PDF produced`)
    }
    if (engine === 'tectonic' && /(^|\s)error:/i.test(consoleOut)) {
      problems.push('LaTeX errors present')
    }
    if (ERR_LINE_RE.test(logText)) {
      problems.push('LaTeX errors present')
    }
    if (UNDEF_RE.test(logText)) {
      problems.push('undefined citations/references')
    }

    if (problems.length > 0) {
      const offending = grepLines(
        logText,
        /^!|^l\.[0-9]+|Undefined control sequence|Citation .* undefined|Reference .* undefined|undefined references|Runaway argument|Emergency stop/,
      )
      return {
        ok: false,
        log: `COMPILE FAILED: ${problems.join('; ')}\n--- offending log lines ---\n${offending}`,
        engine_available: true,
      }
    }

    const outPdf = join(dirname(texAbs), `${stem}.pdf`)
    copyFileSync(pdfPath, outPdf)
    const size = (() => { try { return statSync(outPdf).size } catch { return '?' } })()
    return {
      ok: true,
      log: `COMPILE OK: ${outPdf} (${size} bytes), no errors, no undefined citations [${engine}]`,
      engine_available: true,
    }
  } finally {
    rmSync(build, { recursive: true, force: true })
  }
}
