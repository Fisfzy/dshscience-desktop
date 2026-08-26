/**
 * Retrieval metrics for the ablation harness.
 *
 *   - Recall@k   : fraction of relevant papers found in top-k
 *   - MRR        : mean reciprocal rank of the first relevant hit
 *   - NDCG@k     : normalized discounted cumulative gain (binary relevance)
 *   - Diversity  : 1 − mean pairwise tag-Jaccard inside top-k (higher =
 *                  more diverse results; the bell damper should improve it)
 */
function dcg(ranks) {
    return ranks.reduce((sum, hit, i) => sum + (hit ? 1 / Math.log2(i + 2) : 0), 0);
}
function jaccard(a, b) {
    let inter = 0;
    for (const x of a)
        if (b.has(x))
            inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
}
export function evaluate(cases, topK = 5) {
    let recallSum = 0;
    let mrrSum = 0;
    let ndcgSum = 0;
    let diversitySum = 0;
    for (const c of cases) {
        const top = c.ranked.slice(0, topK);
        const relevant = new Set(c.relevant);
        const hits = top.map((k) => relevant.has(k));
        const hitCount = hits.filter(Boolean).length;
        recallSum += relevant.size === 0 ? 0 : hitCount / relevant.size;
        mrrSum += hits.indexOf(true) >= 0 ? 1 / (hits.indexOf(true) + 1) : 0;
        ndcgSum += dcg(hits) / (dcg([...relevant].map(() => true)) || 1);
        // diversity: mean pairwise tag overlap inside top-k (assume tags come
        // along; caller attaches them via the `tagsByKey` option below)
        diversitySum += 1 - pairwiseOverlap(c, top);
    }
    const n = cases.length || 1;
    return {
        recallAt5: recallSum / n,
        mrr: mrrSum / n,
        ndcgAt5: ndcgSum / n,
        diversity: diversitySum / n,
    };
}
/** Caller-supplied tag map for diversity (set in the eval CLI). */
let tagsByKey = new Map();
export function setTagMap(map) {
    tagsByKey = map;
}
function pairwiseOverlap(c, top) {
    const sets = top.map((k) => new Set(tagsByKey.get(k) ?? []));
    let sum = 0;
    let pairs = 0;
    for (let i = 0; i < sets.length; i++) {
        for (let j = i + 1; j < sets.length; j++) {
            sum += jaccard(sets[i], sets[j]);
            pairs++;
        }
    }
    return pairs === 0 ? 0 : sum / pairs;
}
