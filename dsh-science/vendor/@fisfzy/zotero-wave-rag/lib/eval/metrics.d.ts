/**
 * Retrieval metrics for the ablation harness.
 *
 *   - Recall@k   : fraction of relevant papers found in top-k
 *   - MRR        : mean reciprocal rank of the first relevant hit
 *   - NDCG@k     : normalized discounted cumulative gain (binary relevance)
 *   - Diversity  : 1 − mean pairwise tag-Jaccard inside top-k (higher =
 *                  more diverse results; the bell damper should improve it)
 */
export interface Metrics {
    recallAt5: number;
    mrr: number;
    ndcgAt5: number;
    /** Mean diversity of top-5 over all queries (0..1). */
    diversity: number;
}
export interface RankedCase {
    id: string;
    query: string;
    type: string;
    ranked: string[];
    relevant: string[];
}
export declare function evaluate(cases: RankedCase[], topK?: number): Metrics;
export declare function setTagMap(map: Map<string, string[]>): void;
