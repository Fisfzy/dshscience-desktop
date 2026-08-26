/**
 * Wave retrieval core — the project's centerpiece.
 *
 * Implements the four "wave semantics" ideas (porting the public ideas behind
 * VCPToolBox's TagMemo/RiverMemo into a clean, self-contained engine):
 *
 *   1. Tag-river graph propagation — the query seeds a set of papers (dense
 *      recall + direct anchors); wave energy diffuses along the graph's
 *      rivers (tag/author/collection/knn edges) for `propagationHops` hops
 *      (personalized-PageRank-style).
 *
 *   2. Wormhole jumps — precomputed bridge edges (structurally connected but
 *      semantically distant) act as teleport channels, letting energy cross
 *      into distant domains. Toggleable for ablation.
 *
 *   3. Bell damper — during greedy selection, candidates whose tags/profile
 *      overlap an already-picked paper are penalized, suppressing "synonym
 *      echo" and enforcing diversity.
 *
 *   4. Ω re-rank — final score = Π[0,1]( α·semantic + β·topology-innovation
 *      + γ·direct-anchor ), where the innovation channel only rewards a
 *      candidate whose propagation score exceeds the *expected* score of its
 *      tag class (mirroring RiverMemo V3's conditional-innovation term), and
 *      the anchor channel protects hop-0 factual matches (query names a
 *      title/author/tag verbatim).
 */
import { cosine } from "../ingest/embedder.js";
import { denseSearch } from "./dense.js";
const EPS = 1e-9;
function clamp01(x) {
    return Math.min(1, Math.max(0, x));
}
/** Min-max normalize a numeric map to [0,1]. */
function normalizeMap(map) {
    let min = Infinity;
    let max = -Infinity;
    for (const v of map.values()) {
        if (v < min)
            min = v;
        if (v > max)
            max = v;
    }
    const out = new Map();
    const span = max - min;
    for (const [k, v] of map)
        out.set(k, span < EPS ? 0.5 : (v - min) / span);
    return out;
}
/** Tokenize a string to lowercase alphanumeric tokens. */
function tokens(text) {
    return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}
/** Direct anchor strength: overlap of query tokens with title/authors/tags. */
function anchorScore(query, titles, authors, tags) {
    const q = tokens(query);
    if (q.size === 0)
        return 0;
    const target = tokens([...titles, ...authors, ...tags].join(' '));
    if (target.size === 0)
        return 0;
    let hit = 0;
    for (const t of q)
        if (target.has(t))
            hit++;
    // Prefer exact title / author matches: a query containing the full title is
    // a hop-0 anchor by construction.
    for (const title of titles) {
        if (query.trim().toLowerCase() === title.toLowerCase())
            return 1;
    }
    return clamp01(hit / Math.sqrt(q.size * target.size));
}
/** Tag-set overlap (Jaccard) plus profile cosine — used by the bell damper. */
function pairSim(aTags, bTags, aProfile, bProfile) {
    const setA = new Set(aTags);
    let inter = 0;
    let union = setA.size;
    for (const t of bTags) {
        if (setA.has(t))
            inter++;
        else
            union++;
    }
    const jac = union === 0 ? 0 : inter / union;
    const cos = aProfile && bProfile ? cosine(aProfile, bProfile) : 0;
    return 0.6 * jac + 0.4 * cos;
}
function paperProfile(index, key) {
    const vecs = index.chunks.filter((c) => c.paperKey === key).map((c) => c.embedding).filter((v) => !!v);
    if (vecs.length === 0)
        return undefined;
    const dim = vecs[0].length;
    const mean = new Array(dim).fill(0);
    for (const v of vecs)
        for (let i = 0; i < dim; i++)
            mean[i] += v[i];
    return mean.map((x) => x / vecs.length);
}
/** Build the row-stochastic transition matrix over papers (optionally without wormholes). */
function buildTransition(index, useWormhole) {
    const byKey = new Map(index.papers.map((p, i) => [p.key, i]));
    const M = new Map();
    const accum = new Map(); // row sums
    for (const e of index.edges) {
        if (e.kind === 'wormhole' && !useWormhole)
            continue;
        const i = byKey.get(e.a);
        const j = byKey.get(e.b);
        if (i === undefined || j === undefined)
            continue;
        for (const [from, to] of [[i, j], [j, i]]) {
            let row = M.get(from);
            if (!row) {
                row = new Map();
                M.set(from, row);
            }
            row.set(to, Math.max(row.get(to) ?? 0, e.weight));
            accum.set(from, (accum.get(from) ?? 0) + Math.max(row.get(to) ?? 0, e.weight));
        }
    }
    // Normalize rows.
    for (const [from, row] of M) {
        const sum = accum.get(from) ?? 0;
        if (sum > 0)
            for (const [to, w] of row)
                row.set(to, w / sum);
    }
    return { M, byKey };
}
export async function waveSearch(index, embedder, params, query, options = {}) {
    const t0 = Date.now();
    const opts = {
        topK: params.topK,
        seedPool: 0,
        useWormhole: true,
        useDamper: true,
        useInnovation: true,
        useAnchor: true,
        ...options,
    };
    // seedPool must derive from the *effective* topK (after option merge) —
    // otherwise callers passing a config with topK != requested topK silently
    // seed from a different-size pool.
    opts.seedPool = Math.max(opts.topK * 3, 5);
    // 1. seeds from dense recall
    const dense = await denseSearch(index, embedder, query, opts.seedPool, opts.queryVec);
    const seedScores = new Map();
    for (const h of dense.hits)
        seedScores.set(h.paperKey, h.score);
    let seedSum = 0;
    for (const v of seedScores.values())
        seedSum += v;
    for (const k of seedScores.keys())
        seedScores.set(k, (seedScores.get(k) ?? 0) / (seedSum || 1));
    // 2. propagate
    const { M, byKey } = buildTransition(index, opts.useWormhole);
    const n = index.papers.length;
    const s = new Array(n).fill(0);
    for (const [key, sc] of seedScores) {
        const i = byKey.get(key);
        if (i !== undefined)
            s[i] = sc;
    }
    let v = [...s];
    for (let hop = 0; hop < params.propagationHops; hop++) {
        const next = new Array(n).fill(0);
        for (const [from, row] of M) {
            const cur = v[from];
            if (cur === 0)
                continue;
            for (const [to, w] of row)
                next[to] = (next[to] ?? 0) + cur * w;
        }
        const damp = params.damping;
        v = next.map((x, i) => (1 - damp) * s[i] + damp * x);
    }
    // 3. candidate pool + channel scores
    const candidates = new Map();
    for (let i = 0; i < n; i++) {
        const p = index.papers[i];
        if (v[i] < EPS && (seedScores.get(p.key) ?? 0) < EPS)
            continue;
        candidates.set(p.key, {
            semantic: seedScores.get(p.key) ?? 0,
            propagation: v[i],
            anchor: opts.useAnchor
                ? anchorScore(query, [p.title], p.creators.map((c) => c.lastName), p.tags)
                : 0,
        });
    }
    if (candidates.size === 0) {
        return { hits: [], latencyMs: Date.now() - t0 };
    }
    // Ω re-rank channels (all min-max normalized to [0,1])
    const sem = normalizeMap(new Map([...candidates].map(([k, c]) => [k, c.semantic])));
    const prop = normalizeMap(new Map([...candidates].map(([k, c]) => [k, c.propagation])));
    const anch = normalizeMap(new Map([...candidates].map(([k, c]) => [k, c.anchor])));
    // topology-innovation: positive deviation of propagation from tag-class mean
    const tagMembers = new Map();
    for (const p of index.papers)
        for (const t of p.tags) {
            const list = tagMembers.get(t) ?? [];
            list.push(p.key);
            tagMembers.set(t, list);
        }
    const expected = new Map();
    for (const key of candidates.keys()) {
        const paper = index.papers.find((p) => p.key === key);
        if (!paper || paper.tags.length === 0) {
            expected.set(key, 0);
            continue;
        }
        let sum = 0;
        let cnt = 0;
        for (const t of paper.tags) {
            for (const m of tagMembers.get(t) ?? []) {
                sum += prop.get(m) ?? 0;
                cnt++;
            }
        }
        expected.set(key, cnt > 0 ? sum / cnt : 0);
    }
    const innovation = new Map();
    let innovMax = 0;
    for (const key of candidates.keys()) {
        const dev = Math.max(0, (prop.get(key) ?? 0) - (expected.get(key) ?? 0));
        innovation.set(key, dev);
        if (dev > innovMax)
            innovMax = dev;
    }
    const { alpha, beta, gamma } = params;
    const rawScores = new Map();
    for (const key of candidates.keys()) {
        let sScore = sem.get(key) ?? 0;
        let iScore = opts.useInnovation ? (innovMax > EPS ? (innovation.get(key) ?? 0) / innovMax : 0) : 0;
        let aScore = anch.get(key) ?? 0;
        const total = alpha + beta + gamma;
        rawScores.set(key, clamp01((alpha * sScore + beta * iScore + gamma * aScore) / (total || 1)));
    }
    // 4. bell damper: greedy selection with overlap penalty
    const keys = [...candidates.keys()].sort((a, b) => (rawScores.get(b) ?? 0) - (rawScores.get(a) ?? 0));
    const selected = [];
    const profiles = new Map();
    for (const k of keys)
        profiles.set(k, paperProfile(index, k));
    const reasons = new Map();
    for (const key of keys) {
        const r = [];
        if ((sem.get(key) ?? 0) > 0.5)
            r.push(`dense seed ${(seedScores.get(key) ?? 0).toFixed(3)}`);
        if ((prop.get(key) ?? 0) > 0.5)
            r.push(`propagated ${(prop.get(key) ?? 0).toFixed(3)}`);
        if ((innovation.get(key) ?? 0) > 0)
            r.push(`Ω innovation +${(innovation.get(key) ?? 0).toFixed(3)}`);
        if ((anch.get(key) ?? 0) > 0.5)
            r.push(`anchor ${(anch.get(key) ?? 0).toFixed(3)}`);
        reasons.set(key, r.length > 0 ? r : ['wave score']);
    }
    const tagsByKey = new Map(index.papers.map((p) => [p.key, p.tags]));
    if (!opts.useDamper) {
        selected.push(...keys.slice(0, opts.topK));
    }
    else {
        while (selected.length < opts.topK && keys.length > 0) {
            let bestIdx = 0;
            let bestVal = -Infinity;
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                const base = rawScores.get(key) ?? 0;
                let overlap = 0;
                const kTags = tagsByKey.get(key) ?? [];
                const kProfile = profiles.get(key);
                for (const picked of selected) {
                    const pTags = tagsByKey.get(picked) ?? [];
                    const pProfile = profiles.get(picked);
                    overlap = Math.max(overlap, pairSim(kTags, pTags, kProfile, pProfile));
                }
                const val = base - params.bellDamping * overlap;
                if (val > bestVal) {
                    bestVal = val;
                    bestIdx = i;
                }
            }
            selected.push(keys.splice(bestIdx, 1)[0]);
        }
    }
    const hits = selected.map((key) => {
        const paper = index.papers.find((p) => p.key === key);
        return {
            paperKey: key,
            title: paper.title,
            score: rawScores.get(key) ?? 0,
            semantic: sem.get(key) ?? 0,
            propagation: prop.get(key) ?? 0,
            anchor: anch.get(key) ?? 0,
            reasons: reasons.get(key) ?? [],
        };
    });
    return { hits, latencyMs: Date.now() - t0 };
}
