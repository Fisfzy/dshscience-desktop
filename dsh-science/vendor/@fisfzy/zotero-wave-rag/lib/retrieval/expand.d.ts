/**
 * Domain query expansion — zero-cost, local.
 *
 * Two jobs:
 *   1. abbreviations → full forms  (PD → peridynamics, CZM → cohesive zone model)
 *   2. zh ↔ en bridges             (近场动力学 → peridynamics, 分层 → delamination)
 *
 * Expansion appends canonical terms to the ORIGINAL query (never replaces),
 * so the lexical channel (BM25) and the anchor channel both get more hits,
 * and a Chinese query can find English papers in the same library.
 */
/** variant -> canonical terms to append */
export declare const DOMAIN_EXPANSIONS: [string, string[]][];
/**
 * Expand a query: original text + canonical terms for every matched
 * variant/abbreviation. Returns the expanded query string.
 */
export declare function expandQuery(query: string): string;
