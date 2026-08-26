/**
 * core.test.ts — 移植 Danus tests/test_core.py 的全部断言 + golden 向量逐字节对照。
 * golden.json 由原版 Python 实现生成(见 test/fixtures/)。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { computeFactId, cleanExternalRefs } from '../src/core/schema.js'
import {
  FactGraph, parseFrontmatter, serializeFact, statementOf,
} from '../src/core/factgraph.js'
import { GlobalMemory } from '../src/core/global-memory.js'
import { LocalMemory } from '../src/core/local-memory.js'
import { tokenize, bm25Scores } from '../src/core/bm25.js'
import { flattenGlossary, globalGlossary, globalTerms, undefinedSymbols } from '../src/core/glossary.js'
import { readJsonl } from '../src/core/util.js'

const golden = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'golden.json'), 'utf8'),
)

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'danus-core-'))
}

// ---------------------------------------------------------------- golden 向量
test('golden: compute_fact_id 与原版逐字节一致', () => {
  assert.equal(
    computeFactId({
      problem_id: 'proj',
      predecessors: ['b'.repeat(16), 'a'.repeat(16)],
      glossary_introduces: { X: 'a manifold', A: 'first' },
      statement: 'Let  X\n be   nice',
      proof: 'by\tY',
    }),
    golden.fact_id_basic,
  )
  assert.equal(
    computeFactId({ problem_id: 'p', predecessors: [], glossary_introduces: {}, statement: '', proof: '' }),
    golden.fact_id_empty,
  )
  assert.equal(
    computeFactId({
      problem_id: 'p', predecessors: [],
      glossary_introduces: { epsilon: '实数' },
      statement: 'forall epsilon in R+', proof: '取 delta 使得…',
    }),
    golden.fact_id_unicode,
  )
  assert.equal(
    computeFactId({ problem_id: 'p', predecessors: [], glossary_introduces: {}, statement: 'alpha beta', proof: 'gamma' }),
    golden.fact_id_greek,
  )
})

test('golden: clean_external_refs 键序', () => {
  assert.deepEqual(
    cleanExternalRefs([{ note: 'z', title: 'T', key: 'K', aardvark: 1 }]),
    golden.clean_refs,
  )
  assert.deepEqual(cleanExternalRefs(null), [])
  assert.deepEqual(cleanExternalRefs([]), [])
  assert.deepEqual(cleanExternalRefs([{ title: 'T', key: 'K' }, 'junk', 7]), [{ key: 'K', title: 'T' }])
})

test('golden: serialize_fact 逐字节一致', () => {
  const text = serializeFact({
    fact_id: 'x'.repeat(16),
    problem_id: 'p',
    author: 'w1',
    predecessors: ['a'.repeat(16), 'b'.repeat(16)],
    statement: '  S holds\nover lines  ',
    proof: '  do\nthis ',
    glossary_introduces: { X: 'a manifold' },
    intuition: '',
    external_refs: cleanExternalRefs([{ note: 'z', title: 'T', key: 'K', aardvark: 1 }]),
  })
  assert.equal(text, golden.serialize_fact)
})

test('golden: parse_frontmatter 往返', () => {
  const parsed = parseFrontmatter(golden.serialize_fact)
  assert.deepEqual(parsed.predecessors, golden.roundtrip_preds)
  assert.deepEqual(parsed.glossary_introduces, golden.roundtrip_gloss)
  assert.deepEqual(parsed.external_refs, golden.roundtrip_refs)
})

// ------------------------------------------------------------------ local mem
test('local memory: record 必须 dict;新通道注册;breadcrumb;默认排除 events', () => {
  const lm = new LocalMemory(tmp())
  assert.throws(() => lm.append('notes', 'not a dict' as never), /JSON object/)
  assert.ok(!lm.channels.includes('scratch'))
  lm.append('scratch', { x: 1 })
  assert.ok(lm.channels.includes('scratch'))
  assert.deepEqual(lm.read('scratch')[0]!.record, { x: 1 })

  lm.append('notes', { text: 'Beatty decomposition works for q >= 2' })
  lm.append('events', { note: 'explicit' })
  assert.ok(lm.read('events').length >= 2) // 显式 event + 自动 breadcrumb

  const res = lm.search('Beatty decomposition')
  assert.equal(res.results_by_channel['notes']!.count, 1)
  assert.ok(!('events' in res.results_by_channel)) // 默认排除
})

// ----------------------------------------------------------------- global mem
test('global memory: 种类/状态校验、evidence 必需、折叠、分桶搜索', () => {
  const gm = new GlobalMemory(tmp())
  assert.throws(() => gm.append('bogus_kind', 'c', 'e', 'w'), /unknown kind/)
  assert.throws(() => gm.setStatus('someid', 'not-a-status'), /invalid status/)
  assert.throws(() => gm.append('conclusion', 'c', '', 'w'), /requires explicit evidence/)

  // judgment 条目允许空 evidence,初始 open
  const jid = gm.append('plan', 'reduce to q>=2 case', '', 'w1')
  assert.equal(gm.read('plan')[0]!.status, 'open')

  // 搜索折叠:3 条 plan,第一条 set supported
  const first = gm.append('plan', 'reduce to q>=3 case', '', 'w1')
  gm.append('plan', 'reduce to q>=4 case', '', 'w1')
  gm.setStatus(first, 'supported')
  const res = gm.search('reduce', ['plan'], 2)
  assert.equal(res.results_by_kind['plan']!.count, 2)
  const firstEntry = res.results_by_kind['plan']!.results.map((r) => r.entry).find((e) => e.id === first)
  assert.equal(firstEntry!.status, 'supported')

  // 零分剔除
  assert.equal(gm.search('zzzquarkxyz', ['plan']).results_by_kind['plan']!.count, 0)

  // verifiable 生命周期
  const gid = gm.append('counterexample', 'c', 'construction', 'w1')
  assert.equal(gm.read('counterexample')[0]!.status, 'unverified')
  gm.setStatus(gid, 'verified', 'abc123')
  const after = gm.read('counterexample')[0]!
  assert.equal(after.status, 'verified')
  assert.equal(after.fact_id, 'abc123')

  // extra 字段扁平合并(verification 轨迹)
  gm.append('verification', 'claim', 'verdict: correct', 'w1', {
    verifiable: false,
    extra: { verdict: 'correct', fact_id: 'abc123' },
  })
  const ventry = gm.read('verification')[0]!
  assert.equal(ventry['verdict'], 'correct')
  assert.equal(ventry.fact_id, 'abc123')
  void jid
})

// --------------------------------------------------------------------- _util
test('read_jsonl:缺失/垃圾/空行/非 dict', () => {
  const dir = tmp()
  assert.deepEqual(readJsonl(join(dir, 'missing.jsonl')), [])
  const p = join(dir, 'x.jsonl')
  writeFileSync(p, '{"ok":1}\n\nnot json\n[1,2,3]\n{"ok":2}\n', 'utf8')
  assert.deepEqual(readJsonl(p), [{ ok: 1 }, { ok: 2 }])
})

// ------------------------------------------------------------------- glossary
test('glossary: flatten / undefined_symbols / global 资源', () => {
  assert.deepEqual(flattenGlossary(null), {})
  assert.deepEqual(flattenGlossary({}), {})
  const fl = flattenGlossary({ version: 1, terms: { S_M: { definition: 'a set', aliases: ['SM'] } } })
  assert.equal(fl['S_M'], 'a set')
  assert.equal(fl['SM'], 'a set') // alias 继承定义
  assert.deepEqual(flattenGlossary({ K_F: 'canonical' }), { K_F: 'canonical' })

  assert.deepEqual(undefinedSymbols({ statement: 'S_M(x) applied', proof: '', defined: ['S_M'] }), [])
  assert.deepEqual(undefinedSymbols({ statement: 'S_M(x) applied', proof: '', defined: [] }), ['S_M(x)'])

  assert.ok(Object.keys(globalGlossary()).length > 0) // 真实资源非空
  assert.ok(globalTerms().size > 0)
})

// ------------------------------------------------------------------ factgraph
test('factgraph: add/序列化/intuition/glossary 合并/覆盖检查', () => {
  const fg = new FactGraph(tmp())
  const base = fg.add({
    problem_id: 'p', author: 'w1',
    statement: 'A holds', proof: 'by definition',
    glossary_introduces: { X: 'a complex manifold' },
    intuition: 'the key idea is X',
  })
  const raw = fg.getRaw(base)!
  assert.ok(raw.includes('## statement'))
  assert.ok(raw.includes('## proof'))
  assert.ok(raw.includes('## intuition'))
  assert.ok(raw.includes('the key idea is X'))
  assert.ok(raw.includes('X: a complex manifold'))
  assert.equal(fg.glossary()['X'], 'a complex manifold')
  assert.deepEqual(parseFrontmatter(raw).glossary_introduces, { X: 'a complex manifold' })

  // 覆盖检查:前驱 glossary 参与
  assert.deepEqual(
    fg.undefinedSymbols({ statement: 'K_F equals zero', proof: 'by X', predecessors: [base] }),
    ['K_F'],
  )
  assert.deepEqual(
    fg.undefinedSymbols({ statement: 'X is nice', proof: 'X is a manifold', predecessors: [base] }),
    [],
  )
  // 全局 glossary:universal notation 视为已定义
  assert.deepEqual(
    fg.undefinedSymbols({ statement: 'let epsilon in R+', proof: 'Z+ is nonempty' }),
    [],
  )
})

test('factgraph: 内容寻址/依赖链/派生索引/级联撤销/撤销前驱拒绝', () => {
  const fg = new FactGraph(tmp())
  const base = fg.add({ problem_id: 'p', author: 'w', statement: 'A', proof: 'pa' })
  const child = fg.add({ problem_id: 'p', author: 'w', statement: 'B from A', proof: 'pb', predecessors: [base] })
  const grand = fg.add({ problem_id: 'p', author: 'w', statement: 'C from B', proof: 'pc', predecessors: [child] })

  assert.equal(
    base,
    computeFactId({ problem_id: 'p', predecessors: [], glossary_introduces: {}, statement: 'A', proof: 'pa' }),
  )
  assert.deepEqual(fg.predecessors(child), [base])
  assert.deepEqual(new Set(fg.descendants(base)), new Set([child, grand]))

  const hits = fg.search('B from A')
  assert.equal(hits[0]!.fact_id, child)
  assert.equal(hits[0]!.statement, 'B from A')
  assert.ok(hits.every((h) => h.score > 0))
  assert.deepEqual(fg.search('nonexistent symplectic quark'), [])

  // limit 生效
  fg.add({ problem_id: 'p', author: 'w', statement: 'B one', proof: 'x' })
  fg.add({ problem_id: 'p', author: 'w', statement: 'B two', proof: 'y' })
  assert.equal(fg.search('B', 2).length, 2)

  // 级联撤销
  const revoked = fg.revoke(base, 'wrong')
  assert.deepEqual(new Set(revoked), new Set([base, child, grand]))
  for (const fid of [base, child, grand]) assert.ok(!fg.exists(fid))

  // 撤销前驱拒绝
  assert.throws(
    () => fg.add({ problem_id: 'p', author: 'w', statement: 's', proof: 'p2', predecessors: [base] }),
    /predecessor_revoked/,
  )
  // 未知 id 撤销
  assert.throws(() => fg.revoke('deadbeefdeadbeef', 'x'), /unknown fact_id/)
})

test('factgraph: glossary.json 坏 JSON 不抛', () => {
  const fg = new FactGraph(tmp())
  fg.add({ problem_id: 'p', author: 'w', statement: 's', proof: 'p', glossary_introduces: { X: 'd' } })
  writeFileSync(fg.glossaryPath, '{not json', 'utf8')
  assert.deepEqual(fg.glossary(), {})
})

test('factgraph: external_refs 不参与 fact_id;set_external_refs 各路径', () => {
  const fg = new FactGraph(tmp())
  const refs = [{ key: 'K', title: 'T' }]
  const withRefs = fg.add({ problem_id: 'p', author: 'w', statement: 'S', proof: 'P', external_refs: refs })
  const bare = computeFactId({ problem_id: 'p', predecessors: [], glossary_introduces: {}, statement: 'S', proof: 'P' })
  assert.equal(withRefs, bare) // refs 不进哈希
  // 幂等:无 refs 同内容再 add → 同 id
  const again = fg.add({ problem_id: 'p', author: 'w', statement: 'S', proof: 'P' })
  assert.equal(again, withRefs)
  // 原版语义:无 refs 的同内容再 add 覆写文件 → 读回 [](spec §11「无 refs 的 fact 读回 []」)
  assert.deepEqual(fg.externalRefs(withRefs), [])

  assert.throws(() => fg.setExternalRefs('deadbeefdeadbeef', []), /unknown fact_id/)

  const written = fg.setExternalRefs(withRefs, [{ title: 'T2', key: 'K2' }])
  assert.deepEqual(written, [{ key: 'K2', title: 'T2' }])
  assert.deepEqual(fg.externalRefs(withRefs), [{ key: 'K2', title: 'T2' }])
  const body = fg.getRaw(withRefs)!.split('## statement')[1]
  assert.ok(body!.includes('S'))

  // 旧格式(无 external_refs 行)→ 插入
  const old = fg.add({ problem_id: 'p', author: 'w', statement: 'old', proof: 'old p' })
  const rawOld = fg.getRaw(old)!
  const noRefsLine = rawOld.split('\n').filter((l) => !l.startsWith('external_refs:')).join('\n')
  writeFileSync(join(fg.factsDir, `${old}.md`), noRefsLine, 'utf8')
  assert.deepEqual(fg.externalRefs(old), [])
  fg.setExternalRefs(old, refs)
  assert.deepEqual(fg.externalRefs(old), cleanExternalRefs(refs))
  assert.ok(fg.getRaw(old)!.includes('external_refs:'))

  // 畸形 frontmatter(无闭合 ---)
  const bad = 'f'.repeat(16)
  writeFileSync(join(fg.factsDir, `${bad}.md`), '---\nfact_id: x\n', 'utf8')
  assert.throws(() => fg.setExternalRefs(bad, []), /malformed/)

  // 坏 external_refs JSON → []
  const badJson = 'e'.repeat(16)
  writeFileSync(
    join(fg.factsDir, `${badJson}.md`),
    '---\npredecessors: []\nexternal_refs: {not valid json\n---\n\n## statement\ns\n\n## proof\np\n',
    'utf8',
  )
  assert.deepEqual(fg.externalRefs(badJson), [])

  // glossary 块被非 glossary 行终止
  const parsed = parseFrontmatter(
    '---\nglossary_introduces:\n  X: a manifold\nsome_other_field: value\nexternal_refs: []\n---\n',
  )
  assert.deepEqual(parsed.glossary_introduces, { X: 'a manifold' })
  assert.deepEqual(parsed.external_refs, [])
})

test('statement_of / tokenize', () => {
  assert.equal(statementOf('## statement\nA holds\nand more\n\n## proof\nirrelevant\n'), 'A holds and more')
  assert.equal(statementOf(golden.serialize_fact), 'S holds over lines')
  assert.deepEqual(tokenize('S_M(x)'), ['s_m', 'x'])
  assert.ok(bm25Scores('', [['a']])[0] === 0)
})
