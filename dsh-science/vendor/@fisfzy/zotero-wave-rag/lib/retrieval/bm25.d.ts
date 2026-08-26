/**
 * BM25 sparse retrieval over FULL-TEXT papers — the lexical channel that
 * complements the wave engine (abstract-level vectors + graph).
 *
 * Key property: BM25 needs no embeddings, so the entire corpus body
 * (15,885 chunks' worth of text) is indexable at zero API cost. It excels
 * exactly where the offline hash embedder is weak: precise domain terms,
 * method names, abbreviations, formulas appearing only in the body.
 *
 * Whole-paper documents: doc text = title + abstract + tags + full text.
 * Standard BM25 (k1=1.5, b=0.75) with an inverted index; serialized inside
 * the LibraryIndex cache (version bump invalidates old caches).
 */
import type { LibraryIndex } from '../core/types.ts';
export interface Bm25Index {
    /** Terms -> posting list (docIndex -> term frequency). */
    postings: Map<string, Map<number, number>>;
    docLengths: number[];
    avgDocLength: number;
    n: number;
}
export interface Bm25Hit {
    paperKey: string;
    title: string;
    /** Raw BM25 score (positive = some match). */
    score: number;
}
export interface Bm25Result {
    hits: Bm25Hit[];
    latencyMs: number;
}
/** Normalized terms for one text (lowercase; CJK grouped in 4-char runs). */
export declare function terms(text: string): string[];
/** Build the BM25 index from the library (whole-paper documents). */
export declare function buildBm25Index(index: LibraryIndex): Bm25Index;
/** BM25 retrieval over the index (whole-paper scoring). */
export declare function bm25Search(index: LibraryIndex, query: string, topK: number): Bm25Result;
/**
 * Two-stage evidence snippets: for each hit paper, chunk its full text (the
 * same on-the-fly chunking detail cards use) and score each chunk with the
 * global BM25 term statistics; return the best chunk per paper, prefixed
 * with [section] and [p.N] when available.
 */
export declare function selectSnippets(index: LibraryIndex, query: string, paperKeys: string[], maxChars?: number): Map<string, string>;
/**
 * Fuse wave + BM25 ranked lists into final RetrievalHits (RRF), keeping the
 * wave channel breakdown and attaching the raw BM25 score. Display score is
 * rank-normalized within the fused list.
 */
export declare function fuseHits(wave: {
    paperKey: string;
    title: string;
    reasons?: string[];
    semantic?: number;
    propagation?: number;
    anchor?: number;
}[], bm: Bm25Hit[], papers: {
    key: string;
    title: string;
}[], topK: number): {
    paperKey: string;
    title: string;
    score: number;
    reasons: string[];
    semantic?: number;
    propagation?: number;
    anchor?: number;
    bm25?: number;
}[];
/** Reciprocal-rank fusion of two ranked lists (k=60, standard). */
export declare function rrfFuse(a: {
    paperKey: string;
}[], b: {
    paperKey: string;
}[], topK: number, k?: number): string[];
