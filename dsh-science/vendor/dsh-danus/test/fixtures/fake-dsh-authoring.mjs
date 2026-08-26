/**
 * test/fixtures/fake-dsh-authoring.mjs — 作者侧渲染器桩(等价原版 authoring/tests/fake_codex.py)。
 *
 * 规则:task(即 prompt,runOnce 把它作为最后一个位置参数传入)控制行为。
 *   - [[FAKE:exit=N]]    → stderr 写 "forced nonzero exit",进程退出码 N。
 *   - [[FAKE:empty]]     → 空 stdout,退出码 0。
 *   - [[FAKE:missing]]   → 不写任何 stdout,退出码 3。
 *   - [[FAKE:leak16]]    → stdout 含一个 16-hex fact_id(泄漏门测试)。
 *   - 否则 → 按内容 echo 一个产物(默认 'fake artifact from dsh')。
 * 支持 FAKE_SLEEP_MS(超时测试)与 FAKE_CWD_OUT(把 cwd 写到指定文件,供隔离 cwd 断言)。
 */

import { writeFileSync } from 'node:fs'

const task = process.argv[process.argv.length - 1]
if (!task || task.startsWith('--') || task.endsWith('.mjs')) {
  process.exit(2)
}

const sleepMs = Number(process.env.FAKE_SLEEP_MS ?? '0')
if (sleepMs > 0) {
  await new Promise((r) => setTimeout(r, sleepMs))
}

if (process.env.FAKE_CWD_OUT) {
  try {
    writeFileSync(process.env.FAKE_CWD_OUT, process.cwd(), 'utf8')
  } catch {
    /* ignore */
  }
}

const exitM = task.match(/\[\[FAKE:exit=(\d+)\]\]/)
if (exitM) {
  process.stderr.write('forced nonzero exit\n')
  process.exit(Number(exitM[1]))
}
if (task.includes('[[FAKE:empty]]')) process.exit(0)
if (task.includes('[[FAKE:missing]]')) process.exit(3)

let out = 'fake artifact from dsh\n'
if (task.includes('[[FAKE:documentclass]]')) {
  out = '\\documentclass{amsart}\n\\begin{document}\nhello\n\\end{document}\n'
} else if (task.includes('[[FAKE:leak16]]')) {
  out = '\\documentclass{amsart}\n\\begin{document}\n1a131721f439cade\n\\end{document}\n'
} else if (task.includes('[[FAKE:report]]')) {
  out = 'The report prose body.\n'
} else if (task.includes('[[FAKE:noop]]')) {
  out = ''
}
process.stdout.write(out)
process.exit(0)
