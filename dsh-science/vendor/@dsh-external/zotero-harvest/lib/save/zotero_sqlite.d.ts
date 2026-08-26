/**
 * lit-harvest — offline Zotero SQLite writer.
 *
 * Writes harvested papers directly into `zotero.sqlite` while the Zotero
 * desktop is NOT running (local API unreachable → no writer lock).
 *
 * Safety rules:
 *   - introspection-driven inserts: every table's columns are read via
 *     PRAGMA table_info and only existing columns are written; NOT NULL
 *     columns without defaults get a per-table fallback value;
 *   - dedupe before insert by DOI (then by title) — never double-insert;
 *   - never deletes or updates existing rows;
 *   - runs inside a single transaction with `PRAGMA busy_timeout`.
 *
 * The minimal schema produced by zotero-wave-rag's make-test-zotero.mjs is
 * a strict subset of the real Zotero 6/7 schema, so the same writer works
 * for both test and real libraries.
 */
import type { Paper } from '../types.ts';
export interface SqliteAddResult {
    ok: boolean;
    itemID?: number;
    key?: string;
    skippedReason?: string;
    message: string;
}
/**
 * Write one paper into the library. Returns ok=false with skippedReason when
 * the paper already exists or the DB is not writable.
 */
export declare function addPaperToSqlite(dbPath: string, storageDir: string | undefined, p: Paper, collection?: string, pdfBytes?: Uint8Array): SqliteAddResult;
