/**
 * Pluggable embedder.
 *
 *   - `hash`: offline character-n-gram hashing into a fixed-dim sparse-ish
 *     vector. No API key, deterministic, works everywhere — used for dev and
 *     as the default until the author plugs in a real embedding API.
 *   - `api`: OpenAI-compatible `/embeddings` endpoint (DeepSeek / OpenAI /
 *     any compatible gateway). Configured via `ZWR_EMBEDDER_*` env or config.
 */
import type { ApiProvider, EmbedderKind } from '../core/config.ts';
export interface Embedder {
    readonly kind: EmbedderKind;
    readonly dim: number;
    /** Embed a batch of texts. Vectors are L2-normalized. */
    embed(texts: string[]): Promise<number[][]>;
}
/** Cosine similarity between two vectors (assumes equal length). */
export declare function cosine(a: number[], b: number[]): number;
/** Character 4-gram hashing embedder (offline default). */
export declare class HashEmbedder implements Embedder {
    readonly kind: EmbedderKind;
    readonly dim: number;
    private readonly n;
    constructor(dim?: number);
    private hashToVector;
    private bucket;
    embed(texts: string[]): Promise<number[][]>;
}
/**
 * OpenAI-compatible embeddings API client. The embedding dimension is
 * derived from the first response (providers/models differ), so no
 * hard-coded dim is assumed.
 */
export declare class ApiEmbedder implements Embedder {
    readonly kind: EmbedderKind;
    private _dim;
    private readonly provider;
    constructor(provider: ApiProvider, dim?: number);
    /** Actual embedding dimension; 0 until the first successful call. */
    get dim(): number;
    embed(texts: string[]): Promise<number[][]>;
}
/** Build the configured embedder.
 * NOTE: the API embedder's dim must stay 0 until the first response — passing
 * the hash default (4096) would preset `_dim` and mask the real dimension
 * (bge-m3 returns 1024), corrupting cache sizing with NaN padding. */
export declare function createEmbedder(kind: EmbedderKind, provider?: ApiProvider, dim?: number): Embedder;
