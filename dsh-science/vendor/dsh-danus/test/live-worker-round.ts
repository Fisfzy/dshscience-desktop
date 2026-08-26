/** live-worker-round.ts — 有界真实 worker 轮 E2E:scaffold → assign → 一轮 → 检查入图。 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DanusSwarm } from '../src/services/swarm.ts'
import { runLoop } from '../src/swarm/loop.ts'
import { runHeadless } from '../src/shared/headless.ts'
import { WorkerLayout } from '../src/shared/layout.ts'

const ROOT = 'D:/AIWORK/DSH PLUGIN DEV/CAM ZHB/runtime/projects'
process.env.DANUS_AGENTS_ROOT = ROOT

const swarm = new DanusSwarm()
if (!existsSync(join(ROOT, 'e2e'))) {
  const out = swarm.newProject('e2e', 'high:1')
  console.log('scaffolded:', out.workers)
}
swarm.assign('e2e/high', [
  'Prove and submit via fact_submit: for every positive integer n, the sum of the first n odd',
  'positive integers 1 + 3 + ... + (2n-1) equals n^2. Use induction on n. Keep the proof',
  'self-contained and rigorous, then call fact_submit with the statement and proof.',
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
console.log('status:', readFileSync(wl.status, 'utf8'))

const factsDir = join(ROOT, 'e2e', 'fact_graph', 'facts')
const facts = existsSync(factsDir) ? readdirSync(factsDir) : []
console.log('facts in graph:', facts)
if (facts.length) {
  console.log('--- fact head ---')
  console.log(readFileSync(join(factsDir, facts[0]!), 'utf8').slice(0, 400))
}
