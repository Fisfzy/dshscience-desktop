/**
 * Detail-card generation.
 *
 * Two modes:
 *   - extractive (default, no API key): metadata + evidence + related papers
 *     + excerpt-based method/contribution fields. Honest and dependency-free.
 *   - LLM (`config.llm === 'api'`): evidence chunks + abstract are sent to a
 *     chat model which synthesizes method / contribution / experiments as a
 *     grounded detail card.
 *
 * The card's `evidence` field always lists the concrete quotes/paragraphs the
 * summary is grounded in — the "show your work" surface the eval harness uses
 * for faithfulness checks.
 */
import type { ApiProvider } from '../core/config.ts';
import type { DetailCard, LibraryIndex, Paper } from '../core/types.ts';
export interface DetailCardOptions {
    /** Top-N related papers via graph edges. */
    relatedTopN?: number;
    /** Max evidence items to include. */
    maxEvidence?: number;
    /** Chunk snippet length in chars. */
    snippetChars?: number;
}
export declare function generateDetailCard(paper: Paper, index: LibraryIndex, opts?: DetailCardOptions & {
    llm?: ApiProvider;
}): Promise<DetailCard>;
