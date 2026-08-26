/**
 * Embedder presets — the user-facing "choose your embedding model" registry.
 *
 * Entry points:
 *   - DSH tool `zotero_embedder` (list / set <preset-id>)
 *   - CLI: `node scripts/embedder.mjs list|set <id>|status`
 *
 * Presets describe *kind + model*; API keys stay in env
 * (`ZWR_EMBEDDER_API_KEY`, from `.env.local`), never in the registry.
 */
import type { ApiProvider, EmbedderKind } from './config.ts';
export interface EmbedderPreset {
    /** Stable id used by the tool/CLI. */
    id: string;
    /** Human-readable label. */
    label: string;
    kind: EmbedderKind;
    /** OpenAI-compatible base URL (API presets); defaults to SiliconFlow. */
    baseURL?: string;
    /** Model id on that endpoint. */
    model?: string;
    /** Whether this preset requires an API key to function. */
    needsKey: boolean;
    /** One-line note shown in `list`. */
    note: string;
}
export declare const EMBEDDER_PRESETS: EmbedderPreset[];
export declare function embedderPreset(id: string): EmbedderPreset | undefined;
/** Resolve a preset into a concrete embedder config, given env secrets. */
export declare function presetToEmbedder(preset: EmbedderPreset, envKey?: string, envBaseURL?: string): {
    embedder: EmbedderKind;
    embedderApi?: ApiProvider;
};
/** Short stable id used in the index-cache key (embedder identity). */
export declare function embedderCacheId(embedder: EmbedderKind, model?: string): string;
