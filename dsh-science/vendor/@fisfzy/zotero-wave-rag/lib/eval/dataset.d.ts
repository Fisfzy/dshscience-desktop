/**
 * Evaluation dataset for the sample library.
 *
 * Each query lists the papers a good retrieval system should surface
 * (hand-labeled ground truth against the 14 built-in papers). Query types
 * deliberately mix:
 *   - direct  — query paraphrases a title (tests hop-0 anchor)
 *   - topic   — query names a research area (tests tag-river recall)
 *   - graph   — answer lives 1-2 hops away in the relation graph
 *   - cross   — spans distant domains (tests wormhole jumps)
 */
export interface EvalCase {
    id: string;
    query: string;
    type: 'direct' | 'topic' | 'graph' | 'cross';
    relevant: string[];
}
export declare const EVAL_CASES: EvalCase[];
