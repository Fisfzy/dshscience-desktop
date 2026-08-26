/**
 * Built-in sample library — lets the whole pipeline run with zero local
 * Zotero. The schema mirrors what `db.ts` produces from a real `zotero.sqlite`
 * (same `Paper` type), so the ingest/retrieval core is identical either way.
 *
 * The papers intentionally span several research areas (RAG, dense retrieval,
 * graph methods, vector DBs, LLM agents, evaluation, embeddings) with
 * overlapping tags, so the wave graph has real "rivers" to propagate along
 * and a couple of cross-domain "wormhole" opportunities.
 */
import type { Paper } from '../core/types.ts';
export declare const SAMPLE_PAPERS: Paper[];
