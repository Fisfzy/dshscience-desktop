/**
 * Engine facade the DSH tools call.
 *   - M1: data adapter + index (done)
 *   - M2: naive dense baseline retrieval + detail-card generation (done here)
 *   - M3: wave core (propagation / wormhole / bell damper / Ω re-rank)
 */
import { type PluginConfig } from './config.ts';
import type { DetailCard, LibraryIndex, RetrievalResult } from './types.ts';
export interface StatusReport {
    ok: boolean;
    version: string;
    dataSource: 'sample' | 'zotero';
    dataDir: string;
    index: {
        built: boolean;
        papers: number;
        chunks: number;
        edges: number;
    };
    embedder: PluginConfig['embedder'];
    embedderModel?: string;
    /** True when real (API) semantic embeddings are in use. */
    semanticEnabled: boolean;
    semanticReason?: string;
    /** Set when the API embedder failed and hash took over for this index. */
    degraded?: {
        from: string;
        to: string;
        reason: string;
    };
    llm: PluginConfig['llm'];
    wave: PluginConfig['wave'];
    notes: string[];
}
export interface CompareResult {
    keys: string[];
    cards: (DetailCard | {
        key: string;
        error: string;
    })[];
    sharedTags: string[];
    sharedCreators: string[];
    error?: string;
}
export declare class Engine {
    config: PluginConfig;
    private indexPromise;
    private embedderPromise;
    constructor(overrides?: Partial<PluginConfig>);
    /** Plugin version reported to the model. */
    readonly version = "0.7.2";
    /**
     * Re-resolve config from the runtime file / env on every call, so a config
     * change (dataDir, indexLevel, embedder) takes effect without a host
     * restart. Invalidates the cached index/embedder when key fields change.
     */
    private refresh;
    /** Build (once) and cache the library index. */
    getIndex(): Promise<LibraryIndex>;
    /** Force a rebuild (used after config/data changes). */
    rebuildIndex(): Promise<LibraryIndex>;
    private getEmbedder;
    status(): Promise<StatusReport>;
    /** Wave retrieval; `engine: 'naive'` selects the dense baseline (ablation);
     * `type` filters hits by research method (experimental/numerical/…). */
    search(query: string, topK?: number, engineKind?: 'wave' | 'naive', type?: string): Promise<RetrievalResult>;
    /** Resolve a paper by Zotero key, falling back to a title substring match. */
    findPaper(index: LibraryIndex, key: string): import("./types.ts").Paper | undefined;
    paperDetail(key: string): Promise<DetailCard | {
        error: string;
    }>;
    compare(keys: string[]): Promise<CompareResult>;
    /** Current embedder preset id (or `custom:<model>`). */
    currentEmbedderId(): string;
    /** List available embedder presets with configuration state. */
    listEmbedders(): {
        current: string;
        presets: {
            id: string;
            label: string;
            kind: import("./config.ts").EmbedderKind;
            needsKey: boolean;
            configured: boolean;
            note: string;
        }[];
    };
    /**
     * Switch the embedder (persisted to the runtime config file). Invalidates
     * the cached index/embedder; the next index build uses the new model and a
     * separate cache key, so vectors from different embedders never mix.
     */
    setEmbedder(id: string): {
        ok: boolean;
        current: string;
        message: string;
    };
}
/** Shared engine instance for all tool executions. */
export declare const engine: Engine;
