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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chunkPaper } from "./chunker.js";
import { createEmbedder } from "./embedder.js";
import { embedderCacheId } from "../core/embedder_registry.js";
import { buildGraph } from "./graph.js";
import { buildBm25Index } from "../retrieval/bm25.js";
import { AUTO_TAG_LEXICON, deriveAutoTags, deriveMethodType } from "./autotags.js";
import { SAMPLE_PAPERS } from "../zotero/sample.js";
import { readZoteroLibrary, mapPdfPaths } from "../zotero/db.js";
import { fullTextForPdf, hasPdfTextTool } from "../zotero/pdf.js";
const CACHE_VERSION = 'v3'; // v3: per-paper incremental (textHash) cache
function cacheFiles(config) {
    const dir = join(config.dataDir, '.zwr-cache');
    const level = config.indexLevel;
    // Embedder identity is part of the cache key: vectors from different
    // embedders live in incompatible spaces and must never mix.
    const embId = embedderCacheId(config.embedder, config.embedderApi?.model);
    return {
        meta: join(dir, `index-${level}-${embId}-${CACHE_VERSION}.json`),
        emb: join(dir, `index-${level}-${embId}-${CACHE_VERSION}.emb`),
    };
}
/** FNV-1a 32-bit hex — content fingerprint for incremental embedding. */
function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
}
/** Hash of exactly what gets embedded for this paper at this index level. */
function paperTextHash(paper, level) {
    const full = level === 'fulltext' ? paper.fullText ?? '' : '';
    return fnv1a(`${paper.title}\u0000${paper.abstract ?? ''}\u0000${full}`);
}
function readCacheMeta(config) {
    if (!config.dataDir)
        return undefined;
    const { meta, emb } = cacheFiles(config);
    if (!existsSync(meta) || !existsSync(emb))
        return undefined;
    try {
        const head = JSON.parse(readFileSync(meta, 'utf8'));
        if (!Array.isArray(head.perPaper) || head.perPaper.length === 0)
            return undefined;
        return head;
    }
    catch {
        return undefined;
    }
}
/** Fast path: nothing changed → hydrate the full index from cache (no API). */
function hydrateFromCache(config, meta, papers) {
    if (papers.length !== meta.perPaper.length)
        return undefined;
    for (let i = 0; i < papers.length; i++) {
        if (meta.perPaper[i].key !== papers[i].key)
            return undefined;
        if (meta.perPaper[i].textHash !== paperTextHash(papers[i], config.indexLevel))
            return undefined;
    }
    try {
        const { emb } = cacheFiles(config);
        const dim = meta.embDim;
        const buf = new Float32Array(readFileSync(emb).buffer);
        const chunks = [];
        let offset = 0;
        for (const entry of meta.perPaper) {
            for (const c of entry.chunks) {
                const start = offset * dim;
                chunks.push({
                    paperKey: entry.key,
                    section: c.section,
                    text: c.text,
                    sourceStart: c.sourceStart,
                    sourceEnd: c.sourceEnd,
                    pageStart: c.pageStart,
                    pageEnd: c.pageEnd,
                    embedding: dim > 0 ? Array.from(buf.slice(start, start + dim)) : undefined,
                });
                offset++;
            }
        }
        const bm25Meta = meta.bm25;
        const bm25 = bm25Meta
            ? {
                postings: new Map(bm25Meta.terms.map(([t, list]) => [t, new Map(list)])),
                docLengths: bm25Meta.docLengths,
                avgDocLength: bm25Meta.avgDocLength,
                n: bm25Meta.n,
            }
            : undefined;
        return { papers, chunks, edges: meta.edges, bm25, builtAt: meta.builtAt, stats: meta.stats };
    }
    catch {
        return undefined;
    }
}
/** Load papers from the configured data source. */
export function loadLibrary(config) {
    if (config.dataDir) {
        const dbPath = config.zoteroDbPath ?? `${config.dataDir}/zotero.sqlite`;
        const papers = readZoteroLibrary({
            dbPath,
            storageDir: config.storageDir ?? `${config.dataDir}/storage`,
        });
        return { papers, source: 'zotero', label: dbPath };
    }
    return { papers: SAMPLE_PAPERS, source: 'sample', label: '(built-in sample library)' };
}
export async function buildIndex(config, opts = {}) {
    const verbose = opts.verbose ?? false;
    const log = verbose ? (msg) => console.log(msg) : () => { };
    // 0. load library (+ PDF fulltext for Zotero 7)
    const { papers, source, label } = loadLibrary(config);
    log(`[ingest] library: ${label} (${source}, ${papers.length} papers)`);
    if (source === 'zotero' && config.dataDir && hasPdfTextTool()) {
        const pdfs = mapPdfPaths(config.zoteroDbPath ?? `${config.dataDir}/zotero.sqlite`, config.storageDir ?? `${config.dataDir}/storage`);
        const missing = papers.filter((p) => !p.fullText && pdfs.has(p.key));
        if (missing.length > 0) {
            log(`[ingest] extracting fulltext from ${missing.length} PDFs (pdftotext, cached)…`);
            const concurrency = 4;
            let cursor = 0;
            await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, async () => {
                while (cursor < missing.length) {
                    const p = missing[cursor++];
                    const text = await fullTextForPdf(p.key, pdfs.get(p.key), config.dataDir);
                    if (text)
                        p.fullText = text;
                }
            }));
        }
    }
    // 0.5 tag bootstrapping + method-type classification (deterministic;
    // not part of the embedding hash, recomputed on both build paths)
    for (const p of papers) {
        p.methodType = deriveMethodType(p);
        if (opts.autoTags !== false) {
            const auto = deriveAutoTags(p, AUTO_TAG_LEXICON);
            if (auto.length > 0)
                p.autoTags = auto;
        }
    }
    // 1. fast path: unchanged library → hydrate from cache, zero embedding calls
    const oldMeta = readCacheMeta(config);
    if (oldMeta) {
        const hydrated = hydrateFromCache(config, oldMeta, papers);
        if (hydrated) {
            log(`[ingest] cache hit: ${hydrated.stats.papers} papers, ${hydrated.chunks.length} chunks (no embedding calls)`);
            return hydrated;
        }
    }
    // 2. incremental: chunk & embed only papers whose textHash changed
    const changed = [];
    const reused = [];
    for (const p of papers) {
        const hash = paperTextHash(p, config.indexLevel);
        const oldEntry = oldMeta?.perPaper.find((e) => e.key === p.key && e.textHash === hash);
        if (oldEntry && oldMeta) {
            reused.push({ paper: p, oldEntry });
        }
        else {
            // 'abstract' level embeds title+abstract only; papers keep fullText
            // for on-demand detail cards and the BM25 index.
            const chunkSource = config.indexLevel === 'abstract' ? { ...p, fullText: undefined } : p;
            changed.push({ paper: p, chunks: chunkPaper(chunkSource) });
        }
    }
    log(`[ingest] incremental: ${reused.length} unchanged (reuse embeddings), ${changed.length} changed (embed ${changed.reduce((s, c) => s + c.chunks.length, 0)} chunks)`);
    // embedder with P1-1 auto-degradation
    let embedder = createEmbedder(config.embedder, config.embedderApi);
    let degraded;
    const batchSize = embedder.kind === 'api' ? 16 : 64; // P1-1: API batches capped at 16
    const changedWithVecs = [];
    for (const item of changed) {
        const vecs = [];
        for (let i = 0; i < item.chunks.length; i += batchSize) {
            const batch = item.chunks.slice(i, i + batchSize);
            try {
                vecs.push(...(await embedder.embed(batch.map((c) => c.text))));
            }
            catch (error) {
                if (embedder.kind === 'api' && !degraded) {
                    degraded = {
                        from: 'api',
                        to: 'hash',
                        reason: error instanceof Error ? error.message : String(error),
                    };
                    log(`[ingest] ⚠ API embedder failed (${degraded.reason}); degrading to offline hash for this build`);
                    embedder = createEmbedder('hash');
                    // re-embed this whole batch with hash (never mix spaces mid-index)
                    vecs.length = 0;
                    vecs.push(...(await embedder.embed(batch.map((c) => c.text))));
                }
                else {
                    throw error;
                }
            }
        }
        item.chunks.forEach((c, j) => {
            c.embedding = vecs[j];
        });
        changedWithVecs.push({ ...item, vecs });
    }
    if (degraded)
        log(`[ingest] build finished DEGRADED (hash); index not written to cache`);
    log(`[ingest] embedded with ${embedder.kind} (dim=${embedder.dim})`);
    // 3. assemble chunks in paper order + embeddingsByPaper for the graph
    const chunks = [];
    const embeddingsByPaper = new Map();
    const oldEmb = oldMeta && !degraded ? new Float32Array(readFileSync(cacheFiles(config).emb).buffer) : undefined;
    const dim = embedder.dim;
    const newFlat = new Float32Array((reused.reduce((s, r) => s + (r.oldEntry?.chunks.length ?? 0), 0) +
        changedWithVecs.reduce((s, c) => s + c.chunks.length, 0)) * (dim || 0));
    let newOffset = 0;
    const pushChunk = (chunk, vec) => {
        chunks.push(chunk);
        const list = embeddingsByPaper.get(chunk.paperKey) ?? [];
        if (vec)
            list.push(vec);
        embeddingsByPaper.set(chunk.paperKey, list);
        if (vec && dim > 0) {
            for (let d = 0; d < dim; d++)
                newFlat[newOffset * dim + d] = vec[d];
        }
        newOffset++;
    };
    // Old-layout block offsets per key (skips blocks of papers removed since).
    const oldStartByKey = new Map();
    if (oldMeta) {
        let off = 0;
        for (const e of oldMeta.perPaper) {
            oldStartByKey.set(e.key, off);
            off += e.chunks.length;
        }
    }
    for (const { paper, oldEntry } of reused) {
        if (oldEntry && oldEmb) {
            const start = (oldStartByKey.get(paper.key) ?? 0) * dim;
            oldEntry.chunks.forEach((cm, i) => {
                const vec = dim > 0 ? Array.from(oldEmb.slice(start + i * dim, start + (i + 1) * dim)) : undefined;
                pushChunk({
                    paperKey: paper.key,
                    section: cm.section,
                    text: cm.text,
                    sourceStart: cm.sourceStart,
                    sourceEnd: cm.sourceEnd,
                    pageStart: cm.pageStart,
                    pageEnd: cm.pageEnd,
                    embedding: vec,
                }, vec);
            });
        }
    }
    for (const item of changedWithVecs) {
        item.chunks.forEach((c, j) => pushChunk(c, item.vecs[j]));
    }
    // 4. graph + BM25
    const edges = buildGraph({ papers, embeddingsByPaper });
    log(`[ingest] graph edges: ${edges.length}`);
    const bm25 = buildBm25Index({ papers, chunks, edges, builtAt: '', stats: { papers: 0, chunks: 0, edges: 0, tags: 0 } });
    log(`[ingest] bm25 index: ${bm25.postings.size} terms, ${bm25.n} docs`);
    const index = {
        papers,
        chunks,
        edges,
        bm25,
        degraded,
        builtAt: new Date().toISOString(),
        stats: {
            papers: papers.length,
            chunks: chunks.length,
            edges: edges.length,
            tags: new Set(papers.flatMap((p) => p.tags)).size,
        },
    };
    // 5. persist cache (skipped when degraded so the next build retries API)
    if (!degraded && config.dataDir && dim > 0) {
        try {
            const { meta, emb } = cacheFiles(config);
            mkdirSync(join(config.dataDir, '.zwr-cache'), { recursive: true });
            writeFileSync(emb, Buffer.from(newFlat.buffer));
            const perPaper = papers.map((p) => {
                const entryChunks = chunks.filter((c) => c.paperKey === p.key).map((c) => ({
                    section: c.section,
                    text: c.text,
                    sourceStart: c.sourceStart,
                    sourceEnd: c.sourceEnd,
                    pageStart: c.pageStart,
                    pageEnd: c.pageEnd,
                }));
                return { key: p.key, textHash: paperTextHash(p, config.indexLevel), chunks: entryChunks };
            });
            const slim = {
                papers,
                edges,
                builtAt: index.builtAt,
                stats: index.stats,
                embDim: dim,
                bm25: {
                    terms: [...bm25.postings.entries()].map(([t, list]) => [t, [...list.entries()]]),
                    docLengths: bm25.docLengths,
                    avgDocLength: bm25.avgDocLength,
                    n: bm25.n,
                },
                perPaper,
            };
            writeFileSync(meta, JSON.stringify(slim));
        }
        catch {
            // cache is a convenience, never fatal
        }
    }
    return index;
}
