/**
 * Query planning (P0-2).
 *
 * Rule-based path (always available):
 *   effectiveQueries = [domain-expanded query (+resolved citation titles)]
 *   references       = citation mentions ("Smith et al., 2020") resolved to
 *                      library papers — their titles are appended to the
 *                      effective query, so the anchor channel and BM25 see
 *                      the exact title terms without touching wave.ts.
 *
 * Optional LLM path (only when an LLM provider is configured; any failure
 * falls back to the rule path, so behavior without a key is unchanged):
 *   generates ≤6 query variants, each fed to BM25; wave uses the primary
 *   semantic query (embedded once).
 */
import type { ApiProvider } from '../core/config.ts';
import type { LibraryIndex } from '../core/types.ts';
export interface QueryPlan {
    /** Variants to run through BM25 (≥1; rule path returns exactly one). */
    effectiveQueries: string[];
    /** Primary query for the wave/dense channel (embedded once). */
    semanticQuery: string;
    /** Resolved citation titles (already merged into effectiveQueries). */
    references: string[];
}
/** Resolve "(Smith et al., 2020)"-style mentions to library paper titles. */
export declare function parseCitations(query: string, index: LibraryIndex): string[];
/** Rule-based plan: domain expansion + citation-title merging. */
export declare function buildQueryPlan(query: string, index: LibraryIndex): QueryPlan;
/**
 * Optional LLM variant generation (≤6 variants, temperature 0). Returns
 * undefined on any failure so callers fall back to the rule path.
 */
export declare function generateQueryPlanWithModel(query: string, index: LibraryIndex, llm: ApiProvider): Promise<QueryPlan | undefined>;
