/**
 * Indexer — orchestrates the offline pipeline:
 *   library (sample | zotero.sqlite) → chunk → embed → graph → LibraryIndex.
 *
 * Cache v3 (P0-3): per-paper `textHash` in the meta JSON. A rebuild re-embeds
 * ONLY papers whose embedded text changed (byte-identical reuse for the rest),
 * so editing one paper never triggers a whole-library re-embed. The fast path
 * (nothing changed) loads straight from cache without any embedding calls.
 *
 * P1-1: API-embedding failures (e.g. 402 insufficient balance) auto-degrade
 * to the offline hash embedder for that build, recorded in `index.degraded`
 * and surfaced by `zotero_status`; degraded builds are NOT written to the
 * cache, so the next build retries the configured embedder.
 */
import type { PluginConfig } from '../core/config.ts';
import type { LibraryIndex, Paper } from '../core/types.ts';
export interface LoadedLibrary {
    papers: Paper[];
    source: 'sample' | 'zotero';
    label: string;
}
/** Load papers from the configured data source. */
export declare function loadLibrary(config: PluginConfig): LoadedLibrary;
export interface BuildIndexOptions {
    /** Log progress lines (CLI). */
    verbose?: boolean;
    /** Set false to skip tag bootstrapping. */
    autoTags?: boolean;
}
export declare function buildIndex(config: PluginConfig, opts?: BuildIndexOptions): Promise<LibraryIndex>;
