/**
 * Tag bootstrapping — machine-derived topic tags.
 *
 * The real library is almost untagged (311 papers, 1 tagged), which starves
 * the wave engine's "tag river" channel. `deriveAutoTags` extracts lexicon
 * terms that appear in the title/abstract and returns them as `autoTags`
 * (separate from user `tags` — user tags stay authoritative; autoTags only
 * feed the graph and BM25, never the detail card).
 */
import type { Paper } from '../core/types.ts';
/** Curated domain lexicon (mechanics / composites / peridynamics / AI). */
export declare const AUTO_TAG_LEXICON: string[];
export type MethodType = 'experimental' | 'numerical' | 'analytical' | 'review' | 'mixed' | 'unknown';
/**
 * Classify a paper by research method (P0-1 lesson: "试验" queries must not
 * surface pure model papers). Scoring on title+abstract; highest score wins,
 * ties -> mixed.
 */
export declare function deriveMethodType(paper: Paper): MethodType;
/**
 * Derive auto tags for one paper: lexicon terms found verbatim in the
 * title/abstract (case-insensitive for latin). Cap at 6, longest first.
 */
export declare function deriveAutoTags(paper: Paper, lexicon?: string[]): string[];
