/**
 * Tag-river graph builder.
 *
 * Nodes are papers; edges are the "rivers" of the wave semantic terrain:
 *   - tag edges: papers sharing a tag; weight = 1 / log(1 + tag frequency),
 *     so rare tags carry far stronger water than ubiquitous ones;
 *   - author edges: shared author, weight 1;
 *   - collection edges: same Zotero collection, weight 0.5;
 *   - knn edges: dense-cosine neighbors (paper profile = mean of chunk
 *     embeddings), weight = similarity;
 *   - wormhole edges: cross-domain "jump" edges — structurally bridged
 *     (shared author/collection) yet no shared tag and low cosine. The wave
 *     core (M3) selects among these candidates.
 */
import type { GraphEdge, Paper } from '../core/types.ts';
export interface GraphInput {
    papers: Paper[];
    /** Paper key -> chunk embeddings (already normalized). */
    embeddingsByPaper: Map<string, number[][]>;
}
export declare function buildGraph(input: GraphInput): GraphEdge[];
