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
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
const FIELD_CACHE = new Map();
const TYPE_CACHE = new Map();
function fieldId(db, name) {
    const cached = FIELD_CACHE.get(name);
    if (cached !== undefined)
        return cached;
    const row = db
        .prepare('SELECT fieldID FROM fields WHERE fieldName = ?')
        .get(name);
    if (row === undefined)
        return undefined;
    FIELD_CACHE.set(name, row.fieldID);
    return row.fieldID;
}
function itemTypeId(db, name) {
    const cached = TYPE_CACHE.get(name);
    if (cached !== undefined)
        return cached;
    const row = db
        .prepare('SELECT itemTypeID FROM itemTypes WHERE typeName = ?')
        .get(name);
    if (row === undefined)
        return undefined;
    TYPE_CACHE.set(name, row.itemTypeID);
    return row.itemTypeID;
}
function itemValue(db, itemID, field) {
    const fid = fieldId(db, field);
    if (fid === undefined)
        return undefined;
    const row = db
        .prepare(`SELECT v.value AS value
       FROM itemData d JOIN itemDataValues v ON d.valueID = v.valueID
       WHERE d.itemID = ? AND d.fieldID = ?`)
        .get(itemID, fid);
    return row?.value;
}
function extractYear(date) {
    if (!date)
        return undefined;
    const m = /(1[89]\d{2}|20\d{2})/.exec(date);
    return m ? Number(m[1]) : undefined;
}
function paperCreators(db, itemID) {
    const rows = db
        .prepare(`SELECT c.firstName, c.lastName, c.fieldMode
       FROM itemCreators ic
       JOIN creators c ON ic.creatorID = c.creatorID
       WHERE ic.itemID = ? ORDER BY ic.orderIndex`)
        .all(itemID);
    return rows.map((r) => r.fieldMode === 1
        ? { lastName: r.lastName }
        : { firstName: r.firstName ?? '', lastName: r.lastName });
}
function paperTags(db, itemID) {
    const rows = db
        .prepare(`SELECT t.name AS name
       FROM itemTags it JOIN tags t ON it.tagID = t.tagID
       WHERE it.itemID = ? AND it.type = 0 ORDER BY t.name`)
        .all(itemID);
    return rows.map((r) => r.name);
}
function paperCollections(db, itemID) {
    const rows = db
        .prepare(`SELECT c.collectionName AS name
       FROM collectionItems ci JOIN collections c ON ci.collectionID = c.collectionID
       WHERE ci.itemID = ? ORDER BY c.collectionName`)
        .all(itemID);
    return rows.map((r) => r.name);
}
/** Resolve a child item (attachment/note/annotation) up to its paper item. */
function parentPaperItemID(db, childItemID) {
    // attachment → paper (annotations and PDFs both live in itemAttachments)
    const att = db
        .prepare('SELECT parentItemID FROM itemAttachments WHERE itemID = ?')
        .get(childItemID);
    if (att?.parentItemID !== null && att?.parentItemID !== undefined) {
        // if the direct parent is itself an attachment, walk one more hop
        const grand = db
            .prepare('SELECT parentItemID FROM itemAttachments WHERE itemID = ?')
            .get(att.parentItemID);
        if (grand?.parentItemID !== null && grand?.parentItemID !== undefined) {
            return grand.parentItemID;
        }
        return att.parentItemID;
    }
    const note = db
        .prepare('SELECT parentItemID FROM itemNotes WHERE itemID = ?')
        .get(childItemID);
    return note?.parentItemID ?? undefined;
}
/**
 * Map of paper itemID -> full text, via Zotero's own fulltext index
 * (Zotero 6 only: `fulltextItems.indexableText`). Zotero 7 dropped the raw
 * text column (word index only, no positions), so PDF extraction takes over
 * there — `indexableText` is simply absent and this returns an empty map.
 */
function fulltextByPaper(db) {
    const out = new Map();
    const hasColumn = db.prepare('PRAGMA table_info(fulltextItems)').all().some((c) => c.name === 'indexableText');
    if (!hasColumn)
        return out; // Zotero 7
    const rows = db
        .prepare(`SELECT ft.itemID AS itemID, ft.indexableText AS text
       FROM fulltextItems ft
       WHERE ft.indexableText IS NOT NULL AND length(ft.indexableText) > 0`)
        .all();
    for (const r of rows) {
        const paperID = parentPaperItemID(db, r.itemID);
        if (paperID === undefined)
            continue;
        const existing = out.get(paperID);
        out.set(paperID, existing ? `${existing}\n\n${r.text}` : r.text);
    }
    return out;
}
function annotationsFor(db, paperItemID, annotationTypeID) {
    // All annotation items whose (possibly chained) parent is this paper.
    const rows = db
        .prepare(`SELECT i.itemID AS itemID
       FROM items i
       JOIN itemAttachments ia ON ia.itemID = i.itemID
       WHERE i.itemTypeID = ?`)
        .all(annotationTypeID);
    const out = [];
    for (const r of rows) {
        if (parentPaperItemID(db, r.itemID) !== paperItemID)
            continue;
        const quote = itemValue(db, r.itemID, 'annotationText');
        const comment = itemValue(db, r.itemID, 'annotationComment');
        const pageLabel = itemValue(db, r.itemID, 'annotationPageLabel');
        if (!quote && !comment)
            continue;
        out.push({
            quote,
            note: comment,
            page: pageLabel ? Number.parseInt(pageLabel, 10) || undefined : undefined,
        });
    }
    return out;
}
/**
 * Resolve a `storage:…` attachment path to an absolute file.
 *  - Zotero 6: `storage:<KEY>/<file.pdf>` (subdir = storage key)
 *  - Zotero 7: `storage:<file.pdf>` (subdir = attachment item key)
 */
function resolveStorageFile(storageDir, attachmentKey, pathValue) {
    if (!storageDir || !pathValue)
        return undefined;
    const m = /^storage:(.+)$/.exec(pathValue);
    if (!m)
        return undefined;
    const rel = m[1];
    const slash = rel.indexOf('/');
    if (slash > 0) {
        // Zotero 6 form: storage:KEY/file.pdf (or storage:KEY/sub/file.pdf)
        return join(storageDir, rel);
    }
    if (!attachmentKey)
        return undefined;
    // Zotero 7 form: storage:file.pdf -> storage/<attachmentKey>/file.pdf
    return join(storageDir, attachmentKey, rel);
}
/** Look up the storage path for a paper's PDF attachment, if present. */
function attachmentStoragePath(db, paperItemID, storageDir) {
    const row = db
        .prepare(`SELECT ia.path AS path, i.key AS attKey
       FROM itemAttachments ia JOIN items i ON i.itemID = ia.itemID
       WHERE ia.parentItemID = ? AND ia.contentType = 'application/pdf'
       ORDER BY ia.itemID LIMIT 1`)
        .get(paperItemID);
    if (!row || !storageDir)
        return undefined;
    return resolveStorageFile(storageDir, row.attKey, row.path);
}
/**
 * Read a Zotero library into `Paper[]`. Non-paper items (notes, standalone
 * attachments, annotations) are attached to their parent papers and never
 * surface as top-level entries.
 */
export function readZoteroLibrary(paths) {
    const db = new DatabaseSync(paths.dbPath, { readOnly: true });
    try {
        const paperTypeIDs = [
            'journalArticle',
            'conferencePaper',
            'book',
            'bookSection',
            'preprint',
            'thesis',
            'report',
            'magazineArticle',
            'newspaperArticle',
            'encyclopediaArticle',
            'dictionaryEntry',
            'patent',
            'manuscript',
            'letter',
            'interview',
            'film',
            'artwork',
            'webpage',
            'presentation',
            'computerProgram',
            'dataset',
            'standard',
            'document',
            'audioRecording',
            'videoRecording',
            'blogPost',
            'forumPost',
            'email',
            'instantMessage',
        ];
        const ids = paperTypeIDs
            .map((t) => itemTypeId(db, t))
            .filter((x) => x !== undefined);
        const placeholders = ids.map(() => '?').join(',');
        const rows = db
            .prepare(`SELECT itemID, key FROM items WHERE itemTypeID IN (${placeholders}) AND itemID NOT IN (SELECT itemID FROM deletedItems)`)
            .all(...ids);
        const fulltext = fulltextByPaper(db);
        const annotationTypeID = itemTypeId(db, 'annotation');
        const papers = [];
        for (const { itemID, key } of rows) {
            const title = itemValue(db, itemID, 'title');
            if (!title)
                continue; // items without a title are usually empty shells
            papers.push({
                key,
                title,
                creators: paperCreators(db, itemID),
                year: extractYear(itemValue(db, itemID, 'date')),
                abstract: itemValue(db, itemID, 'abstractNote'),
                tags: paperTags(db, itemID),
                collections: paperCollections(db, itemID),
                url: itemValue(db, itemID, 'url'),
                doi: itemValue(db, itemID, 'DOI'),
                fullText: fulltext.get(itemID),
                annotations: annotationTypeID === undefined ? [] : annotationsFor(db, itemID, annotationTypeID),
            });
            // note: attachmentStoragePath is computed lazily by the caller when a
            // PDF fallback is wanted; keeping it out of the hot loop here.
        }
        void attachmentStoragePath;
        return papers;
    }
    finally {
        db.close();
    }
}
/**
 * Map every paper key to its storage PDF path (single DB open; used by the
 * ingest step that extracts Zotero-7 full text from PDFs).
 */
export function mapPdfPaths(dbPath, storageDir) {
    const out = new Map();
    if (!storageDir)
        return out;
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
        const rows = db
            .prepare(`SELECT i.key AS paperKey, ia.path AS path, a.key AS attKey
         FROM itemAttachments ia
         JOIN items i ON i.itemID = ia.parentItemID
         JOIN items a ON a.itemID = ia.itemID
         WHERE ia.contentType = 'application/pdf'`)
            .all();
        for (const r of rows) {
            const file = resolveStorageFile(storageDir, r.attKey, r.path);
            if (file && existsSync(file))
                out.set(r.paperKey, file);
        }
    }
    finally {
        db.close();
    }
    return out;
}
/** Convenience: resolve a storage PDF path for one paper item (lazy). */
export function resolvePdfPath(dbPath, storageDir, paperKey) {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
        const row = db
            .prepare('SELECT itemID FROM items WHERE key = ?')
            .get(paperKey);
        if (row === undefined)
            return undefined;
        return attachmentStoragePath(db, row.itemID, storageDir);
    }
    finally {
        db.close();
    }
}
