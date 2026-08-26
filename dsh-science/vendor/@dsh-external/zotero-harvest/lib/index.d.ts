/**
 * lit-harvest — DSH external plugin entry.
 *
 * Registers five deterministic tools over the literature-harvesting
 * pipeline: multi-source fetch, paper detail, save into the local Zotero
 * library, sufficiency audit, and the budgeted review loop. No LLM calls —
 * all judgment is quota + coverage auditing. When papers are saved into a
 * Zotero data dir, a reindex of zotero-wave-rag is triggered so the new
 * literature becomes searchable through `zotero_search` immediately.
 */
import type { CtxLike } from './types.ts';
export declare const name = "zotero-harvest";
export declare const inject: string[];
export declare function apply(ctx: CtxLike): void;
