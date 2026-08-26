/**
 * Domain model for the Zotero wave-RAG library.
 *
 * Everything downstream (ingest, retrieval, generation, eval) speaks in these
 * types, so the data adapter (real zotero.sqlite vs built-in sample data) is
 * swappable without touching the retrieval core.
 */
export interface Creator {
    firstName?: string;
    lastName: string;
}
export interface Annotation {
    /** Highlighted quote from the PDF, when Zotero has one. */
    quote?: string;
    /** User note attached to the highlight. */
    note?: string;
    page?: number;
}
export interface Paper {
    /** Zotero item key (unique within a library). */
    key: string;
    title: string;
    creators: Creator[];
    year?: number;
    abstract?: string;
    /** Normalized tags — the "rivers" of the wave semantic terrain. */
    tags: string[];
    /**
     * Machine-derived topic tags (tag bootstrapping). Never written into
     * `tags` — user tags stay authoritative; autoTags feed the graph/BM25.
     */
    autoTags?: string[];
    /** Research-method classification (experimental/numerical/analytical/…). */
    methodType?: import('../ingest/autotags.ts').MethodType;
    collections: string[];
    url?: string;
    doi?: string;
    /** Extracted full text (Zotero fulltextItems or PDF fallback). */
    fullText?: string;
    annotations: Annotation[];
}
export interface Chunk {
    paperKey: string;
    /** Section heading the chunk came from, when detectable. */
    section?: string;
    text: string;
    /** Dense embedding; absent when the offline hash embedder is used. */
    embedding?: number[];
    /** Character offsets into the paper's full text (evidence trace-back). */
    sourceStart?: number;
    sourceEnd?: number;
    /** Page numbers when the PDF extractor produced page markers (\f). */
    pageStart?: number;
    pageEnd?: number;
}
export type EdgeKind = 'tag' | 'author' | 'collection' | 'citation' | 'knn' | 'wormhole';
export interface GraphEdge {
    a: string;
    b: string;
    kind: EdgeKind;
    weight: number;
}
export interface LibraryStats {
    papers: number;
    chunks: number;
    edges: number;
    tags: number;
}
export interface LibraryIndex {
    papers: Paper[];
    chunks: Chunk[];
    edges: GraphEdge[];
    /** Full-text BM25 sparse index (built once; zero embedding cost). */
    bm25?: import('../retrieval/bm25.ts').Bm25Index;
    /** Set when the configured API embedder failed and hash took over. */
    degraded?: {
        from: string;
        to: string;
        reason: string;
    };
    builtAt: string;
    stats: LibraryStats;
}
export interface RetrievalHit {
    paperKey: string;
    title: string;
    /** Final score in [0, 1] (Ω score for wave-only, RRF-normalized when fused). */
    score: number;
    /** Human-readable reasons, e.g. "propagated 2 hops from 'rag-survey' via tag 'retrieval'". */
    reasons: string[];
    /** Best evidence snippet (with [section] / [p.N] prefixes when known). */
    snippet?: string;
    /** Research-method classification of the hit paper. */
    methodType?: string;
    /** Channel breakdown, available for ablation/debug. */
    semantic?: number;
    propagation?: number;
    anchor?: number;
    /** Raw BM25 score when the sparse channel contributed (RRF fusion). */
    bm25?: number;
}
export interface RetrievalResult {
    query: string;
    hits: RetrievalHit[];
    engine: 'wave' | 'naive' | 'bm25';
    latencyMs: number;
}
export interface DetailCard {
    paperKey: string;
    title: string;
    metadata: {
        creators: Creator[];
        year?: number;
        tags: string[];
        collections: string[];
        url?: string;
        doi?: string;
        methodType?: string;
    };
    /** Method / approach summary (LLM-synthesized when a provider is configured). */
    method?: string;
    contribution?: string;
    experiments?: string;
    /** Other library papers connected through the wave graph. */
    relatedPapers: string[];
    /** Supporting evidence quotes. */
    evidence: string[];
}
