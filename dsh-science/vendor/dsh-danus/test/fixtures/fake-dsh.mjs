/**
 * test/fixtures/fake-dsh.mjs — 冷启动 judge 桩(等价原版 verify/tests/fake_codex.py)。
 *
 * 判定规则:task 含 [[FAKE:wrong]] → verdict wrong(注入一个 critical_error);
 * 否则 correct(空 errors/gaps)。task 里找不到输出路径 → exit 3;无 task → exit 2。
 * 支持 FAKE_SLEEP_MS 环境变量(超时测试)与 FAKE_NO_OUTPUT / FAKE_BAD_JSON /
 * FAKE_NON_DICT / FAKE_EXIT7 模式(错误路径测试)。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const task = process.argv[process.argv.length - 1]
if (!task || task.startsWith('--') || task.endsWith('.mjs')) {
  process.exit(2)
}

const sleepMs = Number(process.env.FAKE_SLEEP_MS ?? '0')
if (sleepMs > 0) {
  await new Promise((r) => setTimeout(r, sleepMs))
}

const m = task.match(/Write the verification JSON to this exact path: (.+?)\.?\s*$/)
if (!m) {
  process.exit(3)
}
const outPath = m[1].endsWith('.json') ? m[1] : m[1] + '.json'

if (process.env.FAKE_EXIT7 === '1') {
  process.exit(7)
}
if (process.env.FAKE_NO_OUTPUT === '1') {
  process.exit(0)
}

mkdirSync(dirname(outPath), { recursive: true })
if (process.env.FAKE_BAD_JSON === '1') {
  writeFileSync(outPath, '{not json', 'utf8')
  process.exit(0)
}
if (process.env.FAKE_NON_DICT === '1') {
  writeFileSync(outPath, '["not", "a", "dict"]', 'utf8')
  process.exit(0)
}

const wrong = task.includes('[[FAKE:wrong]]')
const payload = wrong
  ? {
      verification_report: {
        summary: 'found an error',
        critical_errors: [{ location: 'step 2', issue: 'unjustified inference' }],
        gaps: [],
      },
      verdict: 'wrong',
      repair_hints: 'fix the gap in step 2',
    }
  : {
      verification_report: { summary: 'all good', critical_errors: [], gaps: [] },
      verdict: 'correct',
      repair_hints: '',
    }
writeFileSync(outPath, JSON.stringify(payload), 'utf8')
process.exit(0)
