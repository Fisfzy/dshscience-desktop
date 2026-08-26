/**
 * prechecks.test.ts — 移植 Danus verify/tests/test_prechecks.py 的全部断言。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkProblemMdCitation, checkUnprovenConditionalPremises, checkVagueGestures,
  isVacuousProof, isVacuousStatement, runPrechecks, stripMarkdownNoise,
} from '../src/core/prechecks.js'

const GOOD_STATEMENT = 'For every positive integer n, the sum of the first n odd positive integers equals n^2.'
const GOOD_PROOF =
  'We proceed by induction on n. The base case n = 1 is immediate since the sum is 1 = 1^2. ' +
  'For the induction step, assume the claim holds for n; adding the next odd number 2n + 1 to ' +
  'both sides yields n^2 + 2n + 1 = (n + 1)^2, which completes the induction and the proof.'

function withEnv(vars: Record<string, string>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {}
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k]
    process.env[k] = vars[k]
  }
  try {
    fn()
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
}

test('vacuous proof: QED / 长连词 / marker / 好证明', () => {
  {
    const [vac, reason] = isVacuousProof('QED')
    assert.ok(vac)
    assert.match(reason, /substantive characters/)
  }
  {
    // 2 词 40 字符:字符够但词数不足
    const [vac, reason] = isVacuousProof('antidisestablishmentarianism-floccinaucinihilipilification x')
    assert.ok(vac)
    assert.match(reason, /substantive words/)
  }
  withEnv({ VERIFY_MIN_PROOF_CHARS: '1', VERIFY_MIN_PROOF_WORDS: '1' }, () => {
    const [vac, reason] = isVacuousProof('Obviously true.')
    assert.ok(vac)
    assert.match(reason, /vacuous marker/)
    assert.match(reason, /obviously true/)
  })
  {
    const [vac] = isVacuousProof(GOOD_PROOF)
    assert.ok(!vac)
  }
})

test('vacuous statement', () => {
  const [vac, reason] = isVacuousStatement('x')
  assert.ok(vac)
  assert.match(reason, /substantive characters/)
  assert.ok(!isVacuousStatement(GOOD_STATEMENT)[0])
})

test('P1: 九种触发形态 + 开关 + 空输入 + 干净通过', () => {
  const triggers = [
    'as declared in problem.md',
    'from problem.md section',
    'by the master reduction package declared in problem.md',
    'by the master reduction package declared in the problem statement',
    'as known from the problem statement',
    'by the verified reductions listed in problem.md',
    'as stated in problem.md',
    'the reduction package declared in problem.md',
    'this is the reduction package declared in problem.md',
  ]
  for (const t of triggers) {
    const r = checkProblemMdCitation(`We proceed ${t}.`)
    assert.ok(r, `pattern should fire: ${t}`)
    assert.match(r!, /Hard Prohibition P1/)
  }
  withEnv({ VERIFY_REJECT_PROBLEM_MD_CITATIONS: '0' }, () => {
    assert.equal(checkProblemMdCitation('as declared in problem.md'), null)
  })
  assert.equal(checkProblemMdCitation(''), null)
  assert.equal(checkProblemMdCitation(null), null)
  assert.equal(checkProblemMdCitation(GOOD_PROOF), null)
})

test('P3: 条件前提需同段 fact_id 背书', () => {
  const trigger = 'Assume that the verified reductions have narrowed the search space considerably.'
  // 无 fact_id → 拒绝
  assert.ok(checkUnprovenConditionalPremises(trigger))
  // 同段 fact_id → 放行
  assert.equal(checkUnprovenConditionalPremises(`${trigger} See fact deadbeefdeadbeef.`), null)
  // 异段 fact_id → 仍拒绝
  assert.ok(checkUnprovenConditionalPremises(`${trigger}\n\nSee fact deadbeefdeadbeef.`))
  // post-W_q 变体
  assert.ok(checkUnprovenConditionalPremises('Assume the verified post-W_q reductions hold.'))
  assert.ok(checkUnprovenConditionalPremises('Assume that the post-W_q reductions have narrowed it.'))
  assert.ok(
    checkUnprovenConditionalPremises('Suppose the residual has been reduced to a finite set.'),
  )
  withEnv({ VERIFY_REJECT_UNPROVEN_CONDITIONALS: '0' }, () => {
    assert.equal(checkUnprovenConditionalPremises(trigger), null)
  })
  assert.equal(checkUnprovenConditionalPremises(''), null)
  assert.equal(checkUnprovenConditionalPremises(GOOD_PROOF), null)
})

test('P5: 模糊手势', () => {
  const triggers = [
    'by some classical argument',
    'by some Beatty theorem',
    'it is well known that',
    'as is well known in the literature',
    'by an obvious counting argument',
  ]
  for (const t of triggers) {
    const r = checkVagueGestures(`This follows ${t}.`)
    assert.ok(r, `pattern should fire: ${t}`)
    assert.match(r!, /Hard Prohibition P5/)
  }
  withEnv({ VERIFY_REJECT_VAGUE_GESTURES: '0' }, () => {
    assert.equal(checkVagueGestures('by some classical argument'), null)
  })
  assert.equal(checkVagueGestures(''), null)
  assert.equal(checkVagueGestures(GOOD_PROOF), null)
})

test('run_prechecks: 顺序、标签、防御', () => {
  assert.equal(runPrechecks(GOOD_STATEMENT, GOOD_PROOF), null)

  const vacS = runPrechecks('x', GOOD_PROOF)!
  assert.equal(vacS.status, 400)
  assert.match(vacS.detail, /^vacuous statement:/)

  const vacP = runPrechecks(GOOD_STATEMENT, 'QED')!
  assert.equal(vacP.status, 400)
  assert.match(vacP.detail, /^vacuous proof:/)

  const p1 = runPrechecks(GOOD_STATEMENT, `${GOOD_PROOF} As stated in problem.md, done.`)!
  assert.match(p1.detail, /^\[P1 on proof\]/)

  // 坏 pattern 藏进 statement
  const p5 = runPrechecks(`${GOOD_STATEMENT} This is it is well known that true.`, GOOD_PROOF)!
  assert.match(p5.detail, /^\[P5 on statement\]/)

  const p3 = runPrechecks(
    GOOD_STATEMENT,
    `${GOOD_PROOF}\n\nAssume that the verified reductions have narrowed the space.`,
  )!
  assert.match(p3.detail, /^\[P3 on proof\]/)
})

test('strip_markdown_noise: 去 fence/inline code/引用/hr/标题', () => {
  // fence 删除、`x` 删除、'> ' 前缀删除、--- 行删除、'# ' 前缀删除、空白合并
  assert.equal(stripMarkdownNoise('```\ncode\n```\n`x` > quote\n---\n# h\ntext  here'), 'quote h text here')
})
