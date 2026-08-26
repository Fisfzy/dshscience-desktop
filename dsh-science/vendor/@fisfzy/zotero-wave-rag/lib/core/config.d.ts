/**
 * Plugin configuration: paths, providers, and wave-retrieval hyper-parameters.
 *
 * Everything is configurable so the resume story can show thoughtful
 * engineering: the embedding model and LLM are pluggable (the author adds API
 * keys later), the data source is swappable (real zotero.sqlite vs the
 * built-in sample library), and every wave term has an exposed knob that the
 * ablation harness (M4) sweeps.
 *
 * Embedder selection precedence (highest wins):
 *   1. runtime config file (`~/.config/zotero-wave-rag/config.json`,
 *      written by the `zotero_embedder` tool / CLI) — the user's explicit
 *      interactive choice;
 *   2. env (`ZWR_EMBEDDER`, `ZWR_EMBEDDER_MODEL`, …);
 *   3. built-in defaults.
 */
/** Runtime config file holding the user's embedder choice. */
export declare function runtimeConfigPath(): string;
/** Runtime config file shape (user's interactive choices, persisted). */
export interface RuntimeConfig {
    embedderId?: string;
    dataDir?: string;
    indexLevel?: 'abstract' | 'fulltext';
}
/** Persist a runtime-config update, preserving unrelated fields. */
export declare function updateRuntimeConfig(patch: RuntimeConfig): RuntimeConfig;
/** Persist the user's embedder choice (used by the tool/CLI). */
export declare function setRuntimeEmbedder(id: string): void;
export type EmbedderKind = 'hash' | 'api';
export type LlmKind = 'none' | 'api';
/**
 * Index granularity — the two-tier cost switch.
 *  - 'abstract' : embed only title+abstract (+tags) — ~1/50 of full-text cost;
 *                 retrieval runs over this tier; detail cards use the already
 *                 extracted full text directly (no embedding needed).
 *  - 'fulltext' : embed every full-text chunk (large corpus = expensive).
 */
export type IndexLevel = 'abstract' | 'fulltext';
export interface ApiProvider {
    baseURL: string;
    apiKey: string;
    model: string;
}
export interface WaveHyperParams {
    /** Personalized-PageRank-style propagation hops from the seed set. */
    propagationHops: number;
    /** Wave decay per hop (damping factor, 0..1). */
    damping: number;
    /** Number of precomputed wormhole bridge edges to keep. */
    wormholeTopK: number;
    /** Ω channels: semantic baseline, topology innovation, direct anchor. */
    alpha: number;
    beta: number;
    gamma: number;
    /** Bell damper strength: overlap penalty coefficient in greedy selection. */
    bellDamping: number;
    /** Final hit count returned to callers. */
    topK: number;
}
export interface PluginConfig {
    /**
     * Directory holding `zotero.sqlite` + `storage/`. Empty string selects the
     * built-in sample library (no local Zotero required).
     */
    dataDir: string;
    zoteroDbPath?: string;
    storageDir?: string;
    embedder: EmbedderKind;
    embedderApi?: ApiProvider;
    llm: LlmKind;
    llmApi?: ApiProvider;
    /** Embedding granularity (cost switch), see IndexLevel. */
    indexLevel: IndexLevel;
    /**
     * Semantic (dense/wave) channel switch (P1-3). When false the engine
     * serves BM25-only results (expansion + sparse). Default true.
     */
    enableSemantic: boolean;
    wave: WaveHyperParams;
}
export declare const DEFAULT_CONFIG: PluginConfig;
/**
 * Resolve effective config from env overrides (`ZWR_*`). Values are read at
 * tool-execution time so config edits apply without a plugin reload.
 */
export declare function resolveConfig(overrides?: Partial<PluginConfig>): PluginConfig;
