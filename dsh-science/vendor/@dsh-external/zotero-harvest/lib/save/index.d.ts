/**
 * lit-harvest — save orchestrator.
 *
 * `lit_save` mode resolution:
 *   auto → probe Zotero local API (desktop running?)
 *          ├─ reachable → 'zotero-api' (metadata item + best-effort PDF attach)
 *          └─ unreachable → zotero.sqlite writable in dataDir?
 *                           ├─ yes → 'sqlite' (offline import)
 *                           └─ no  → 'inbox'
 *   explicit modes force their path ('sqlite' errors if DB missing/locked).
 *
 * PDF download is best-effort: when a pdfUrl is present we fetch it once;
 * a failure never aborts the metadata save.
 */
import type { Paper, SaveMode, SaveResult } from '../types.ts';
import type { LitConfig } from '../config.ts';
export interface SavePapersOptions {
    papers: Paper[];
    mode?: SaveMode;
    collection?: string;
    cfg: LitConfig;
}
export declare function savePapers(opts: SavePapersOptions): Promise<SaveResult>;
