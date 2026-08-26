/**
 * Wave retrieval core — the project's centerpiece.
 *
 * Implements the four "wave semantics" ideas (porting the public ideas behind
 * VCPToolBox's TagMemo/RiverMemo into a clean, self-contained engine):
 *
 *   1. Tag-river graph propagation — the query seeds a set of papers (dense
 *      recall + direct anchors); wave energy diffuses along the graph's
 *      rivers (tag/author/collection/knn edges) for `propagationHops` hops
 *      (personalized-PageRank-style).
 *
 *   2. Wormhole jumps — precomputed bridge edges (structurally connected but
 *      semantically distant) act as teleport channels, letting energy cross
 *      into distant domains. Toggleable for ablation.
 *
 *   3. Bell damper — during greedy selection, candidates whose tags/profile
 *      overlap an already-picked paper are penalized, suppressing "synonym
 *      echo" and enforcing diversity.
 *
 *   4. Ω re-rank — final score = Π[0,1]( α·semantic + β·topology-innovation
 *      + γ·direct-anchor ), where the innovation channel only rewards a
 *      candidate whose propagation score exceeds the *expected* score of its
 *      tag class (mirroring RiverMemo V3's conditional-innovation term), and
 *      the anchor channel protects hop-0 factual matches (query names a
 *      title/author/tag verbatim).
 */
import type { LibraryIndex } from '../core/types.ts';
import type { WaveHyperParams } from '../core/config.ts';
import type { Embedder } from '../ingest/embedder.ts';
export interface WaveHits {
    paperKey: string;
    title: string;
    score: number;
    semantic: number;
    propagation: number;
    anchor: number;
    reasons: string[];
}
export interface WaveResult {
    hits: WaveHits[];
    latencyMs: number;
}
export interface WaveOptions {
    topK: number;
    /** Dense seeds to draw from (before propagation). */
    seedPool: number;
    useWormhole: boolean;
    useDamper: boolean;
    useInnovation: boolean;
    useAnchor: boolean;
    /** Precomputed query embedding (reused across sweep/eval runs). */
    queryVec?: number[];
}
export declare function waveSearch(index: LibraryIndex, embedder: Embedder, params: WaveHyperParams, query: string, options?: Partial<WaveOptions>): Promise<WaveResult>;
