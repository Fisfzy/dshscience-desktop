/**
 * Zotero SQLite adapter — reads a real Zotero library (`zotero.sqlite`,
 * optionally plus `storage/`) into the plugin's `Paper` model.
 *
 * Schema facts relied on (stable across Zotero 6/7):
 *   - `items(key, itemTypeID, ...)`, `itemTypes(typeName)`,
 *     `fields(fieldName)`, `itemData(itemID, fieldID, valueID)`,
 *     `itemDataValues(valueID, value)`
 *   - `creators`, `itemCreators(creatorTypeID, orderIndex)`,
 *     `creatorTypes(creatorType)`
 *   - `tags`, `itemTags`, `collections`, `collectionItems`
 *   - `itemAttachments(itemID, parentItemID, linkMode, path)` — PDFs are
 *     attachments whose `parentItemID` is the paper; `path` may be
 *     `storage:<key>/file.pdf`
 *   - `itemNotes(itemID, parentItemID, note)` — notes/annotations link to
 *     their parent item
 *   - `fulltextItems(itemID, indexableText)` — Zotero's own extracted
 *     full text, keyed on the attachment itemID
 *
 * Annotations (type 'annotation') carry `annotationText` (quote) and
 * `annotationComment` (comment) fields; parent linkage is resolved
 * defensively through both `itemAttachments` and `itemNotes`.
 */
import type { Paper } from '../core/types.ts';
export interface ZoteroPaths {
    dbPath: string;
    storageDir?: string;
}
/**
 * Read a Zotero library into `Paper[]`. Non-paper items (notes, standalone
 * attachments, annotations) are attached to their parent papers and never
 * surface as top-level entries.
 */
export declare function readZoteroLibrary(paths: ZoteroPaths): Paper[];
/**
 * Map every paper key to its storage PDF path (single DB open; used by the
 * ingest step that extracts Zotero-7 full text from PDFs).
 */
export declare function mapPdfPaths(dbPath: string, storageDir: string | undefined): Map<string, string>;
/** Convenience: resolve a storage PDF path for one paper item (lazy). */
export declare function resolvePdfPath(dbPath: string, storageDir: string, paperKey: string): string | undefined;
