/**
 * Engine facade the DSH tools call.
 *   - M1: data adapter + index (done)
 *   - M2: naive dense baseline retrieval + detail-card generation (done here)
 *   - M3: wave core (propagation / wormhole / bell damper / Ω re-rank)
 */
import { resolveConfig, setRuntimeEmbedder } from "./config.js";
import { EMBEDDER_PRESETS, embedderPreset } from "./embedder_registry.js";
import { buildIndex, loadLibrary } from "../ingest/indexer.js";
import { createEmbedder } from "../ingest/embedder.js";
import { denseSearch } from "../retrieval/dense.js";
import { waveSearch } from "../retrieval/wave.js";
import { bm25Search, fuseHits, selectSnippets } from "../retrieval/bm25.js";
import { expandQuery } from "../retrieval/expand.js";
import { buildQueryPlan, generateQueryPlanWithModel } from "../retrieval/query_plan.js";
import { generateDetailCard } from "../generate/detail_card.js";
/** Recursively strip `undefined` so tool outputs always pass the host's
 * lossless-JSON validation (undefined/NaN/Infinity/function are rejected). */
function lossless(value) {
    if (Array.isArray(value))
        return value.map((v) => lossless(v));
    if (value !== null && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (v === undefined)
                continue;
            out[k] = lossless(v);
        }
        return out;
    }
    return value;
}
export class Engine {
    config;
    indexPromise;
    embedderPromise;
    constructor(overrides = {}) {
        this.config = resolveConfig(overrides);
    }
    /** Plugin version reported to the model. */
    version = '0.7.2';
    /**
     * Re-resolve config from the runtime file / env on every call, so a config
     * change (dataDir, indexLevel, embedder) takes effect without a host
     * restart. Invalidates the cached index/embedder when key fields change.
     */
    refresh() {
        const fresh = resolveConfig();
        const cur = this.config;
        const changed = fresh.dataDir !== cur.dataDir ||
            fresh.indexLevel !== cur.indexLevel ||
            fresh.embedder !== cur.embedder ||
            fresh.embedderApi?.model !== cur.embedderApi?.model;
        if (changed) {
            this.config = fresh;
            this.indexPromise = undefined;
            this.embedderPromise = undefined;
        }
    }
    /** Build (once) and cache the library index. */
    getIndex() {
        if (!this.indexPromise) {
            this.indexPromise = buildIndex(this.config);
        }
        return this.indexPromise;
    }
    /** Force a rebuild (used after config/data changes). */
    rebuildIndex() {
        this.indexPromise = undefined;
        return this.getIndex();
    }
    getEmbedder() {
        if (!this.embedderPromise) {
            this.embedderPromise = createEmbedder(this.config.embedder, this.config.embedderApi);
        }
        return this.embedderPromise;
    }
    async status() {
        this.refresh();
        const cfg = this.config;
        const notes = [];
        let ok = true;
        let index = { built: false, papers: 0, chunks: 0, edges: 0 };
        let degraded;
        try {
            const idx = await this.getIndex();
            index = { built: true, papers: idx.stats.papers, chunks: idx.stats.chunks, edges: idx.stats.edges };
            degraded = idx.degraded;
            notes.push(`data source: ${loadLibrary(cfg).label}`);
        }
        catch (error) {
            ok = false;
            notes.push(`index build failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        const semanticEnabled = cfg.enableSemantic && cfg.embedder === 'api';
        let semanticReason;
        if (!cfg.enableSemantic)
            semanticReason = '语义通道已通过 ZWR_SEMANTIC=0 关闭（当前为 BM25-only）';
        else if (cfg.embedder === 'hash')
            semanticReason = 'hash 为词法近似嵌入，非真语义；可切换 API 嵌入（zotero_embedder）';
        if (degraded)
            notes.push(`⚠ 嵌入降级: ${degraded.from} → ${degraded.to}（${degraded.reason}）；本次索引未写缓存，下次构建将重试 ${degraded.from}`);
        notes.push('v0.7: BM25 全文通道 + RRF、领域查询扩展、标签自举、增量嵌入缓存、snippet 证据。');
        const report = {
            ok,
            version: this.version,
            dataSource: cfg.dataDir ? 'zotero' : 'sample',
            dataDir: cfg.dataDir || '(built-in sample library)',
            index,
            embedder: cfg.embedder,
            semanticEnabled,
            llm: cfg.llm,
            wave: cfg.wave,
            notes,
        };
        if (cfg.embedderApi?.model)
            report.embedderModel = cfg.embedderApi.model;
        if (semanticReason)
            report.semanticReason = semanticReason;
        if (degraded)
            report.degraded = degraded;
        return lossless(report);
    }
    /** Wave retrieval; `engine: 'naive'` selects the dense baseline (ablation);
     * `type` filters hits by research method (experimental/numerical/…). */
    async search(query, topK, engineKind = 'wave', type) {
        this.refresh();
        const index = await this.getIndex();
        const k = topK ?? this.config.wave.topK;
        const t0 = Date.now();
        // P1-3: semantic channel off → BM25-only (expansion still applies).
        if (!this.config.enableSemantic && engineKind === 'wave') {
            const eq = expandQuery(query);
            const bm = bm25Search(index, eq, k);
            const hits = bm.hits.map((h) => ({
                paperKey: h.paperKey,
                title: h.title,
                score: h.score > 0 ? Math.min(1, h.score / 40) : 0,
                reasons: [`bm25 ${h.score.toFixed(2)}`],
                bm25: h.score,
            }));
            const snippets = selectSnippets(index, eq, hits.map((h) => h.paperKey));
            for (const h of hits) {
                const snip = snippets.get(h.paperKey);
                if (snip)
                    h.snippet = snip;
            }
            return lossless({ query, hits, engine: 'bm25', latencyMs: Date.now() - t0 });
        }
        if (engineKind === 'naive') {
            const dense = await denseSearch(index, this.getEmbedder(), query, k);
            const hits = dense.hits.map((h) => ({
                paperKey: h.paperKey,
                title: h.title,
                score: h.score,
                reasons: [`dense similarity ${h.score.toFixed(3)}`],
                semantic: h.score,
                snippet: h.snippet ? h.snippet.slice(0, 300) : undefined,
            }));
            return lossless({ query, hits, engine: 'naive', latencyMs: Date.now() - t0 });
        }
        // P0-2: query plan — rule-based expansion + citation-title merging;
        // optional LLM variants only when a provider is configured (failure
        // falls back to the rule path, so no-key behavior is unchanged).
        let plan = buildQueryPlan(query, index);
        if (this.config.llm === 'api' && this.config.llmApi) {
            plan = (await generateQueryPlanWithModel(query, index, this.config.llmApi)) ?? plan;
        }
        const semantic = plan.semanticQuery;
        const [wave, ...bmLists] = await Promise.all([
            waveSearch(index, this.getEmbedder(), this.config.wave, semantic, { topK: Math.max(k * 3, 10) }),
            ...plan.effectiveQueries.map((eq) => bm25Search(index, eq, Math.max(k * 3, 10))),
        ]);
        // merge BM25 variants: sum scores per paper (dedupe by key)
        const bmByKey = new Map();
        for (const bl of bmLists) {
            for (const h of bl.hits) {
                const cur = bmByKey.get(h.paperKey);
                bmByKey.set(h.paperKey, { title: h.title, score: (cur?.score ?? 0) + h.score });
            }
        }
        const bm = { hits: [...bmByKey.entries()].map(([paperKey, v]) => ({ paperKey, title: v.title, score: v.score })).sort((a, b) => b.score - a.score), latencyMs: 0 };
        const fused = fuseHits(wave.hits, bm.hits, index.papers, k);
        const hits = fused.map((h) => ({
            paperKey: h.paperKey,
            title: h.title,
            score: h.score,
            reasons: h.reasons,
            semantic: h.semantic,
            propagation: h.propagation,
            anchor: h.anchor,
            bm25: h.bm25,
        }));
        // P0-1: two-stage evidence snippets for the top hits.
        const snippets = selectSnippets(index, semantic, hits.map((h) => h.paperKey));
        const typeByKey = new Map(index.papers.map((p) => [p.key, p.methodType]));
        const filtered = [];
        for (const h of hits) {
            const snip = snippets.get(h.paperKey);
            if (snip)
                h.snippet = snip;
            const mt = typeByKey.get(h.paperKey);
            if (mt)
                h.methodType = mt;
            if (type && mt !== type)
                continue;
            filtered.push(h);
        }
        return lossless({ query, hits: filtered, engine: 'wave', latencyMs: Date.now() - t0 });
    }
    /** Resolve a paper by Zotero key, falling back to a title substring match. */
    findPaper(index, key) {
        const exact = index.papers.find((p) => p.key === key);
        if (exact)
            return exact;
        const norm = key.trim().toLowerCase();
        return index.papers.find((p) => p.title.toLowerCase().includes(norm) || norm.includes(p.title.toLowerCase()));
    }
    async paperDetail(key) {
        this.refresh();
        const index = await this.getIndex();
        const paper = this.findPaper(index, key);
        if (!paper) {
            return { error: `no paper matching key "${key}"` };
        }
        return lossless(await generateDetailCard(paper, index, { llm: this.config.llmApi }));
    }
    async compare(keys) {
        this.refresh();
        const index = await this.getIndex();
        const cards = [];
        const tagSets = [];
        const creatorSets = [];
        for (const key of keys) {
            const paper = this.findPaper(index, key);
            if (!paper) {
                cards.push({ key, error: `no paper matching key "${key}"` });
                continue;
            }
            const card = await generateDetailCard(paper, index, { llm: this.config.llmApi });
            cards.push(card);
            tagSets.push(paper.tags);
            creatorSets.push(paper.creators.map((c) => `${c.firstName ?? ''} ${c.lastName}`.trim()));
        }
        const sharedTags = tagSets.length > 0
            ? [...new Set(tagSets[0].filter((t) => tagSets.every((s) => s.includes(t))))]
            : [];
        const sharedCreators = creatorSets.length > 0
            ? [...new Set(creatorSets[0].filter((c) => creatorSets.every((s) => s.includes(c))))]
            : [];
        return lossless({ keys, cards, sharedTags, sharedCreators });
    }
    /** Current embedder preset id (or `custom:<model>`). */
    currentEmbedderId() {
        const cfg = this.config;
        if (cfg.embedder === 'hash')
            return 'hash';
        const model = cfg.embedderApi?.model;
        const match = EMBEDDER_PRESETS.find((p) => p.kind === 'api' && p.model === model);
        return match ? match.id : `custom:${model ?? '?'}`;
    }
    /** List available embedder presets with configuration state. */
    listEmbedders() {
        this.refresh();
        const apiKeyConfigured = Boolean(this.config.embedderApi?.apiKey);
        return lossless({
            current: this.currentEmbedderId(),
            presets: EMBEDDER_PRESETS.map((p) => ({
                id: p.id,
                label: p.label,
                kind: p.kind,
                needsKey: p.needsKey,
                configured: !p.needsKey || apiKeyConfigured,
                note: p.note,
            })),
        });
    }
    /**
     * Switch the embedder (persisted to the runtime config file). Invalidates
     * the cached index/embedder; the next index build uses the new model and a
     * separate cache key, so vectors from different embedders never mix.
     */
    setEmbedder(id) {
        const preset = embedderPreset(id);
        if (!preset) {
            return lossless({ ok: false, current: this.currentEmbedderId(), message: `未知嵌入模型预设: "${id}"（可用: ${EMBEDDER_PRESETS.map((p) => p.id).join(', ')}）` });
        }
        try {
            setRuntimeEmbedder(id);
        }
        catch (error) {
            return lossless({ ok: false, current: this.currentEmbedderId(), message: `保存配置失败: ${error instanceof Error ? error.message : String(error)}` });
        }
        this.config = resolveConfig();
        this.indexPromise = undefined;
        this.embedderPromise = undefined;
        const keyMissing = preset.needsKey && !this.config.embedderApi?.apiKey;
        return lossless({
            ok: true,
            current: id,
            message: `已切换嵌入模型为「${preset.label}」` +
                (keyMissing
                    ? '；尚未配置 ZWR_EMBEDDER_API_KEY，配置后下次建索引自动生效'
                    : '；索引缓存已按模型隔离，下次建索引自动重建'),
        });
    }
}
/** Shared engine instance for all tool executions. */
export const engine = new Engine();
