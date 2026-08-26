/**
 * lit-harvest — Zotero local HTTP API client (desktop running).
 *
 * Zotero 7's local API on http://127.0.0.1:23119 trusts loopback by default
 * (no API key). We create the metadata item, then attach the PDF file
 * (multipart). Best-effort: when the desktop is not running this module is
 * skipped and the sqlite/inbox paths take over.
 */
import type { Paper } from '../types.ts';
export interface ZoteroApiAddResult {
    key?: string;
    ok: boolean;
    message: string;
}
export declare function probeZoteroApi(base: string, timeoutMs?: number): Promise<boolean>;
/** Create the metadata item via the local API. */
export declare function addItemViaApi(base: string, p: Paper): Promise<ZoteroApiAddResult>;
/** Attach a PDF file to an existing item (multipart). */
export declare function attachPdfViaApi(base: string, itemKey: string, pdfPath: string): Promise<ZoteroApiAddResult>;
