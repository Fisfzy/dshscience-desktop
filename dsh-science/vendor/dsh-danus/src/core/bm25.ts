/**
 * bm25.ts — BM25 排名,移植自 danus/core/bm25.py。
 * 逐调用重建索引(无持久索引);参数 k1=1.5, b=0.75 与原版一致。
 */

const TOKEN_RE = /[A-Za-z0-9_]+/g

/** 分词:仅 [A-Za-z0-9_],小写化;非 ASCII(希腊字母/中文/数学符号)全部丢弃。 */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(TOKEN_RE) ?? []
}

function counter(xs: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1)
  return m
}

/** 每篇(已分词)文档一个 BM25 分数。 */
export function bm25Scores(query: string, documents: string[][], k1 = 1.5, b = 0.75): number[] {
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0 || documents.length === 0) {
    return documents.map(() => 0.0)
  }

  const queryTermCounts = counter(queryTokens)
  const documentFrequencies = new Map<string, number>()
  const documentTermCounts = documents.map(counter)
  const documentLengths = documents.map((d) => d.length)
  const avgDocLength = documentLengths.length
    ? documentLengths.reduce((a, x) => a + x, 0) / documentLengths.length
    : 0.0
  const totalDocuments = documents.length

  for (const doc of documents) {
    for (const token of new Set(doc)) {
      documentFrequencies.set(token, (documentFrequencies.get(token) ?? 0) + 1)
    }
  }

  const scores: number[] = []
  for (let i = 0; i < documents.length; i++) {
    const docCounts = documentTermCounts[i]!
    const docLength = documentLengths[i]!
    let score = 0.0
    const norm = avgDocLength > 0 ? k1 * (1.0 - b + (b * docLength) / avgDocLength) : k1
    for (const [token, queryTf] of queryTermCounts) {
      const tf = docCounts.get(token) ?? 0
      if (tf <= 0) continue
      const df = documentFrequencies.get(token) ?? 0
      const idf = Math.log(1.0 + (totalDocuments - df + 0.5) / (df + 0.5))
      score += (queryTf * idf * (tf * (k1 + 1.0))) / (tf + norm)
    }
    scores.push(score)
  }
  return scores
}
