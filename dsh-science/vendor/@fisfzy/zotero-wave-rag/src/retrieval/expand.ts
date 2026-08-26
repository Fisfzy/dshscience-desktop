/**
 * Domain query expansion — zero-cost, local.
 *
 * Two jobs:
 *   1. abbreviations → full forms  (PD → peridynamics, CZM → cohesive zone model)
 *   2. zh ↔ en bridges             (近场动力学 → peridynamics, 分层 → delamination)
 *
 * Expansion appends canonical terms to the ORIGINAL query (never replaces),
 * so the lexical channel (BM25) and the anchor channel both get more hits,
 * and a Chinese query can find English papers in the same library.
 */

/** variant -> canonical terms to append */
export const DOMAIN_EXPANSIONS: [string, string[]][] = [
  // abbreviations
  [' pd ', ['peridynamics']],
  ['pddo', ['peridynamic differential operator']],
  ['czm', ['cohesive zone model']],
  ['dcb', ['double cantilever beam']],
  ['enf', ['end notched flexure']],
  ['mmb', ['mixed mode bending']],
  ['dic', ['digital image correlation']],
  ['fem', ['finite element method']],
  ['xfem', ['extended finite element']],
  ['sif', ['stress intensity factor']],
  ['err', ['energy release rate']],
  ['vcct', ['virtual crack closure technique']],
  ['nmm', ['numerical manifold method']],
  ['lbm', ['lattice boltzmann']],
  ['ann', ['artificial neural network', 'approximate nearest neighbor']],
  ['gnn', ['graph neural network']],
  ['rnn', ['recurrent neural network']],
  ['dl', ['deep learning']],
  ['ml', ['machine learning']],
  ['ga', ['genetic algorithm']],
  // zh -> en
  ['近场动力学', ['peridynamics']],
  ['分子动力学', ['molecular dynamics']],
  ['有限元', ['finite element']],
  ['拉弯耦合', ['tension bending coupling', 'extension bending coupling']],
  ['弯扭耦合', ['bending torsion coupling']],
  ['层间', ['interlaminar']],
  ['层内', ['intralaminar']],
  ['分层', ['delamination']],
  ['层合板', ['laminate', 'laminated plate']],
  ['复合材料', ['composite']],
  ['后屈曲', ['postbuckling']],
  ['屈曲', ['buckling']],
  ['裂纹', ['crack']],
  ['断裂', ['fracture']],
  ['损伤', ['damage']],
  ['疲劳', ['fatigue']],
  ['冲击', ['impact']],
  ['热', ['thermal']],
  ['湿度', ['moisture']],
  ['残余应力', ['residual stress']],
  ['应力强度因子', ['stress intensity factor']],
  ['能量释放率', ['energy release rate']],
  ['数值模拟', ['numerical simulation']],
  ['试验', ['experimental']],
  ['优化', ['optimization']],
  ['神经网络', ['neural network']],
  ['机器学习', ['machine learning']],
  ['深度学习', ['deep learning']],
  ['本构', ['constitutive']],
  ['粘聚力', ['cohesive']],
  ['界面', ['interface']],
  ['铺层', ['ply', 'laminate layup']],
  ['各向异性', ['anisotropic']],
  ['非局部', ['nonlocal']],
  ['近场域', ['peridynamic horizon']],
  ['静态', ['static']],
  ['动态', ['dynamic']],
]

/**
 * Expand a query: original text + canonical terms for every matched
 * variant/abbreviation. Returns the expanded query string.
 */
export function expandQuery(query: string): string {
  const q = ` ${query.toLowerCase()} `
  const additions: string[] = []
  for (const [variant, targets] of DOMAIN_EXPANSIONS) {
    if (q.includes(variant.toLowerCase())) {
      additions.push(...targets)
    }
  }
  if (additions.length === 0) return query
  return `${query} ${additions.join(' ')}`
}
