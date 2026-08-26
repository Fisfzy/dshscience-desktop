/** live-dependent-fact.ts — 依赖闭包 E2E:基于既有事实证新定理,验证 DAG 累积。 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DanusSwarm } from '../src/services/swarm.ts'
import { runLoop } from '../src/swarm/loop.ts'
import { runHeadless } from '../src/shared/headless.ts'
import { WorkerLayout } from '../src/shared/layout.ts'

const ROOT = 'D:/AIWORK/DSH PLUGIN DEV/CAM ZHB/runtime/projects'
process.env.DANUS_AGENTS_ROOT = ROOT

const BASE_FACT = 'cefabd883755ac88' // 第一轮已验证:前 n 个奇数之和 = n^2

const swarm = new DanusSwarm()
swarm.assign('e2e/high', [
  `The fact graph already contains fact ${BASE_FACT}: for every positive integer n, the sum of`,
  'the first n odd positive integers equals n^2 (verified). Building on THAT fact (cite it as a',
  'predecessor), prove and submit via fact_submit: for every positive integer n, the sum of the',
  'first n even positive integers 2 + 4 + ... + 2n equals n(n+1). Hint: the k-th even number is',
  'one more than the k-th odd number, so the even sum exceeds the odd sum by n. Call fact_submit',
  `with predecessors=["${BASE_FACT}"].`,
].join(' '))

const wl = new WorkerLayout(join(ROOT, 'e2e', 'workers', 'high'))
let currentChild: { kill: () => void } | null = null
const rc = await runLoop(wl, {
  runRound: async (_r, logPath, hardTimeoutSec) => {
    const { kickoff } = await import('../src/swarm/loop.ts')
    const res = await runHeadless({
      profile: 'danus-worker',
      task: kickoff(wl.project, wl.name),
      cwd: wl.dir,
      timeoutMs: hardTimeoutSec > 0 ? hardTimeoutSec * 1000 : 0,
      logPath,
      onSpawn: (c) => { currentChild = c },
      envExtra: {
        DANUS_PROJECT_DIR: wl.projectDir,
        DANUS_AUTHOR: wl.name,
        DANUS_ROLE: 'worker',
        DANUS_PROBLEM_ID: wl.project,
        DANUS_VERIFY_STATE_DIR: 'D:/AIWORK/DSH PLUGIN DEV/CAM ZHB/runtime/danus/verify',
      },
    })
    return res.spawnError ? 127 : res.timedOut ? 124 : res.exitCode ?? 1
  },
  sleep: async () => {},
  terminateChild: () => currentChild?.kill(),
})
console.log('loop rc:', rc)

const factsDir = join(ROOT, 'e2e', 'fact_graph', 'facts')
const facts = existsSync(factsDir) ? readdirSync(factsDir).sort() : []
console.log('facts in graph:', facts)
for (const f of facts) {
  const text = readFileSync(join(factsDir, f), 'utf8')
  const preds = text.match(/^predecessors: \[([^\]]*)\]/m)?.[1]
  console.log(`- ${f}: predecessors=[${preds}]`)
}
