/**
 * zotero-wave-rag — DSH external plugin entry.
 *
 * Registers four model-facing tools over the wave-semantics RAG engine:
 *   - zotero_status        config + library/index status
 *   - zotero_search        wave retrieval over the paper library
 *   - zotero_paper_detail  structured "paper detail card" for one paper
 *   - zotero_compare       side-by-side detail cards for several papers
 */
export declare const name = "zotero-wave-rag";
export declare const inject: string[];
/** Register the four tools on the host tool registry. */
export declare function apply(ctx: {
    tools: {
        register(tool: unknown): void;
    };
}): void;
