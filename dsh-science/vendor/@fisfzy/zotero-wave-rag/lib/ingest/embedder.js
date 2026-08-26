/**
 * Pluggable embedder.
 *
 *   - `hash`: offline character-n-gram hashing into a fixed-dim sparse-ish
 *     vector. No API key, deterministic, works everywhere — used for dev and
 *     as the default until the author plugs in a real embedding API.
 *   - `api`: OpenAI-compatible `/embeddings` endpoint (DeepSeek / OpenAI /
 *     any compatible gateway). Configured via `ZWR_EMBEDDER_*` env or config.
 */
/** Cosine similarity between two vectors (assumes equal length). */
export function cosine(a, b) {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0)
        return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
/** Character 4-gram hashing embedder (offline default). */
export class HashEmbedder {
    kind = 'hash';
    dim;
    n = 4;
    constructor(dim = 4096) {
        this.dim = dim;
    }
    hashToVector(text) {
        const v = new Float64Array(this.dim);
        const norm = text.toLowerCase().replace(/\s+/g, ' ');
        if (norm.length < this.n) {
            // very short input: hash whole string plus a pad marker
            v[this.bucket(`<pad>${norm}`)] += 1;
        }
        for (let i = 0; i + this.n <= norm.length; i++) {
            const gram = norm.slice(i, i + this.n);
            v[this.bucket(gram)] += 1;
        }
        // L2 normalize
        let sum = 0;
        for (let i = 0; i < this.dim; i++)
            sum += v[i] * v[i];
        if (sum === 0)
            return Array.from(v);
        const inv = 1 / Math.sqrt(sum);
        return Array.from(v, (x) => x * inv);
    }
    bucket(gram) {
        let h = 2166136261;
        for (let i = 0; i < gram.length; i++) {
            h ^= gram.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return Math.abs(h) % this.dim;
    }
    embed(texts) {
        return Promise.resolve(texts.map((t) => this.hashToVector(t)));
    }
}
/**
 * OpenAI-compatible embeddings API client. The embedding dimension is
 * derived from the first response (providers/models differ), so no
 * hard-coded dim is assumed.
 */
export class ApiEmbedder {
    kind = 'api';
    _dim = 0;
    provider;
    constructor(provider, dim) {
        this.provider = provider;
        if (dim)
            this._dim = dim;
    }
    /** Actual embedding dimension; 0 until the first successful call. */
    get dim() {
        return this._dim;
    }
    async embed(texts) {
        // baseURL already includes the API prefix (e.g. .../v1); append the path verbatim.
        const url = `${this.provider.baseURL.replace(/\/+$/, '')}/embeddings`;
        let lastError;
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${this.provider.apiKey}`,
                    },
                    body: JSON.stringify({ model: this.provider.model, input: texts }),
                });
                if (!res.ok) {
                    // 429 / 5xx are transient: back off (honoring Retry-After) and retry.
                    if (res.status === 429 || res.status >= 500) {
                        const retryAfter = Number(res.headers.get('retry-after') ?? '0');
                        await new Promise((r) => setTimeout(r, (retryAfter || 2 ** attempt) * 1000));
                        continue;
                    }
                    const body = await res.text().catch(() => '');
                    throw new Error(`embedding API ${res.status}: ${body.slice(0, 300)}`);
                }
                const data = (await res.json());
                const vecs = data.data.map((d) => d.embedding);
                if (vecs.length > 0 && this._dim === 0) {
                    this._dim = vecs[0].length;
                }
                return vecs;
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                // Fatal (non-transient) API errors must surface, not retry.
                if (error instanceof Error && /embedding API/.test(error.message))
                    throw error;
                await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
            }
        }
        throw lastError ?? new Error('embedding API failed after retries');
    }
}
/** Build the configured embedder.
 * NOTE: the API embedder's dim must stay 0 until the first response — passing
 * the hash default (4096) would preset `_dim` and mask the real dimension
 * (bge-m3 returns 1024), corrupting cache sizing with NaN padding. */
export function createEmbedder(kind, provider, dim = 4096) {
    if (kind === 'api') {
        if (!provider)
            throw new Error('embedder=api requires an API provider (ZWR_EMBEDDER_*)');
        return new ApiEmbedder(provider); // dim auto-derived from the first response
    }
    return new HashEmbedder(dim);
}
