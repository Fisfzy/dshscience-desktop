/**
 * Dense (vector) recall — the naive-RAG baseline.
 *
 * Query → embed → cosine over chunk embeddings → aggregate to paper scores →
 * top-k papers. This is deliberately simple: it is the baseline the wave
 * engine (M3) is measured against in the ablation harness (M4).
 */
import type { LibraryIndex } from '../core/types.ts';
import type { Embedder } from '../ingest/embedder.ts';
export interface DenseHit {
    paperKey: string;
    title: string;
    /** Aggregated paper-level cosine (max over its chunks). */
    score: number;
    /** Best chunk text supporting the hit. */
    snippet: string;
}
export interface DenseResult {
    hits: DenseHit[];
    latencyMs: number;
}
/** Naive dense recall over the library index. */
export declare function denseSearch(index: LibraryIndex, embedder: Embedder, query: string, topK: number, queryVec?: number[]): Promise<DenseResult>;
