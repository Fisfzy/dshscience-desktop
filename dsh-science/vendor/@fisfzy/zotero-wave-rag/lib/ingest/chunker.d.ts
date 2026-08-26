/**
 * Section-aware chunker. Turns a paper's full text into chunks with a
 * section heading, character offsets (`sourceStart/sourceEnd`) and
 * best-effort page numbers (`pageStart/pageEnd`, from pdftotext's \f page
 * markers); falls back to the abstract when no full text exists.
 *
 * Chunk TEXT is byte-identical to the pre-metadata version (the token stream
 * is unchanged — only spans/pages are recorded), so cached embeddings and
 * eval baselines stay valid.
 */
import type { Chunk, Paper } from '../core/types.ts';
/** Target chunk size in whitespace tokens. */
export declare const CHUNK_MAX_TOKENS = 512;
/** Chunk overlap in tokens, to keep section boundaries from slicing meaning. */
export declare const CHUNK_OVERLAP_TOKENS = 64;
/**
 * Tokenize for chunk sizing. Whitespace splits western text; CJK has no
 * spaces, so adjacent CJK runs get artificial boundaries every 4 characters
 * (~1 char per token would explode chunk counts for Chinese papers).
 * Shared with the BM25 sparse index (src/retrieval/bm25.ts).
 */
export declare function splitIntoTokens(text: string): string[];
/** A token with its original-text span (and page, when known). */
export interface TokenSpan {
    token: string;
    /** Offset of the first char in the (trimmed) source text. */
    start: number;
    /** Offset of the last char (inclusive). */
    end: number;
    page?: number;
}
/** Chunk one paper. Always returns at least one chunk. */
export declare function chunkPaper(paper: Paper): Chunk[];
