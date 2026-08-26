/**
 * lit-harvest — trigger the zotero-wave-rag reindex.
 *
 * Runs `<zotero-wave-rag>/scripts/ingest.mjs` via a subprocess (isolated
 * from the plugin process; the ingest script is plain-ESM lib code that
 * runs under node directly). The incremental cache only re-embeds papers
 * whose text changed, so after a lit-harvest save the new papers join the
 * library with a cheap rebuild, and `zotero_search` sees them immediately.
 */
export interface ReindexResult {
    triggered: boolean;
    ok: boolean;
    message: string;
    stdout?: string;
}
export declare function triggerReindex(dataDir: string, opts?: {
    timeoutMs?: number;
}): Promise<ReindexResult>;
