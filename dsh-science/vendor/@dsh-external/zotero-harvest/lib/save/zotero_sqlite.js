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
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
function columnsOf(db, table) {
    const out = new Map();
    for (const c of db.prepare(`PRAGMA table_info(${table})`).all()) {
        out.set(c.name, c);
    }
    return out;
}
/** Fallbacks for NOT NULL columns without a default, per table. */
const NOT_NULL_FALLBACK = {
    items: {
        version: 0,
        synced: 0,
        libraryID: 1,
        clientDateModified: '',
        serverDateModified: '',
    },
    itemData: { valueID: 0 },
    itemCreators: { creatorTypeID: 1, orderIndex: 0 },
    itemAttachments: { linkMode: 0, contentType: 'application/pdf', syncState: 0 },
    itemTags: { type: 0 },
};
function insertRow(db, table, values) {
    const cols = columnsOf(db, table);
    const fallback = NOT_NULL_FALLBACK[table] ?? {};
    const pkCols = [...cols.values()].filter((c) => c.pk > 0);
    // Only auto-assign the pk when the caller did not provide it AND the pk is
    // a single INTEGER rowid alias (e.g. items.itemID). Composite-pk tables
    // (itemData, itemCreators, …) and tables whose pk must mirror another
    // table's id (itemAttachments.itemID) use the caller-supplied value.
    const autoRowidPk = pkCols.length === 1 && pkCols[0].pk === 1 && /INTEGER/i.test(pkCols[0].type);
    const row = {};
    for (const [name, info] of cols) {
        if (name in values) {
            row[name] = values[name] ?? null;
        }
        else if (autoRowidPk && info.pk === 1) {
            continue; // caller did not supply the rowid alias — let SQLite assign
        }
        else if (info.notnull === 1 && info.dflt_value === null) {
            row[name] = fallback[name] ?? '';
        }
    }
    const names = Object.keys(row);
    if (names.length === 0) {
        const r = db.prepare(`INSERT INTO ${table} DEFAULT VALUES`).run();
        return { lastID: Number(r.lastInsertRowid) };
    }
    const placeholders = names.map(() => '?').join(',');
    const r = db
        .prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${placeholders})`)
        .run(...names.map((n) => row[n]));
    return { lastID: Number(r.lastInsertRowid) };
}
function fieldId(db, name) {
    const row = db.prepare('SELECT fieldID FROM fields WHERE fieldName = ?').get(name);
    if (row)
        return row.fieldID;
    const r = db.prepare('INSERT INTO fields (fieldName) VALUES (?)').run(name);
    return Number(r.lastInsertRowid);
}
function itemTypeId(db, name) {
    const row = db.prepare('SELECT itemTypeID FROM itemTypes WHERE typeName = ?').get(name);
    if (row)
        return row.itemTypeID;
    const r = db.prepare('INSERT INTO itemTypes (typeName) VALUES (?)').run(name);
    return Number(r.lastInsertRowid);
}
function valueId(db, text) {
    const row = db
        .prepare('SELECT valueID FROM itemDataValues WHERE value = ?')
        .get(text);
    if (row)
        return row.valueID;
    const r = db.prepare('INSERT INTO itemDataValues (value) VALUES (?)').run(text);
    return Number(r.lastInsertRowid);
}
function setField(db, itemID, field, value) {
    if (!value || value.trim() === '')
        return;
    insertRow(db, 'itemData', { itemID, fieldID: fieldId(db, field), valueID: valueId(db, value) });
}
function addCreators(db, itemID, authors) {
    authors.forEach((name, i) => {
        const clean = name.trim();
        if (!clean)
            return;
        const idx = clean.lastIndexOf(' ');
        const firstName = idx > 0 ? clean.slice(0, idx) : '';
        const lastName = idx > 0 ? clean.slice(idx + 1) : clean;
        const fieldMode = idx > 0 ? 0 : 1;
        // dedupe by the exact form we are about to insert (single-name is
        // fieldMode=1; multi-word names are firstName+lastName, fieldMode=0) —
        // querying the wrong form hits the creators UNIQUE constraint.
        const row = db
            .prepare('SELECT creatorID FROM creators WHERE firstName = ? AND lastName = ? AND fieldMode = ?')
            .get(firstName, lastName, fieldMode);
        const creatorID = row?.creatorID ?? (() => {
            const r = db
                .prepare('INSERT INTO creators (firstName, lastName, fieldMode) VALUES (?,?,?)')
                .run(firstName, lastName, fieldMode);
            return Number(r.lastInsertRowid);
        })();
        insertRow(db, 'itemCreators', { itemID, creatorID, orderIndex: i });
    });
}
function addTags(db, itemID, tags) {
    for (const tag of tags) {
        if (!tag.trim())
            continue;
        const row = db.prepare('SELECT tagID FROM tags WHERE name = ?').get(tag.trim());
        const tagID = row?.tagID ?? (() => {
            const r = db.prepare('INSERT INTO tags (name) VALUES (?)').run(tag.trim());
            return Number(r.lastInsertRowid);
        })();
        insertRow(db, 'itemTags', { itemID, tagID, type: 0 });
    }
}
function addToCollection(db, itemID, collectionName) {
    if (!collectionName)
        return;
    const row = db
        .prepare('SELECT collectionID FROM collections WHERE collectionName = ?')
        .get(collectionName);
    const collectionID = row?.collectionID ?? (() => {
        const r = insertRow(db, 'collections', {
            collectionName,
            libraryID: 1,
            key: randomKey(),
        });
        return r.lastID;
    })();
    insertRow(db, 'collectionItems', { collectionID, itemID });
}
/** Dedupe: existing paper with the same DOI (or title) in the library. */
function findExisting(db, p) {
    if (p.doi) {
        const row = db
            .prepare(`SELECT i.itemID AS itemID, i.key AS key
         FROM items i
         JOIN itemData d ON d.itemID = i.itemID
         JOIN itemDataValues v ON v.valueID = d.valueID
         JOIN fields f ON f.fieldID = d.fieldID
         WHERE f.fieldName = 'DOI' AND lower(v.value) = lower(?)`)
            .get(p.doi);
        if (row)
            return row;
    }
    return db
        .prepare(`SELECT i.itemID AS itemID, i.key AS key
       FROM items i
       JOIN itemData d ON d.itemID = i.itemID
       JOIN itemDataValues v ON v.valueID = d.valueID
       JOIN fields f ON f.fieldID = d.fieldID
       WHERE f.fieldName = 'title' AND lower(v.value) = lower(?)`)
        .get(p.title);
}
import { randomInt } from 'node:crypto';
const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function randomKey() {
    let out = '';
    for (let i = 0; i < 8; i++) {
        out += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)];
    }
    return out;
}
function nowIso() {
    return new Date().toISOString().replace('T', ' ').replace('Z', '');
}
/**
 * Write one paper into the library. Returns ok=false with skippedReason when
 * the paper already exists or the DB is not writable.
 */
export function addPaperToSqlite(dbPath, storageDir, p, collection, pdfBytes) {
    if (!existsSync(dbPath)) {
        return { ok: false, message: `zotero.sqlite not found at ${dbPath}` };
    }
    const db = new DatabaseSync(dbPath);
    try {
        db.exec('PRAGMA busy_timeout=5000');
        const existing = findExisting(db, p);
        if (existing) {
            // The item is already in the library. If we have a PDF and the item
            // has no PDF attachment yet, attach it (imported_file) so the
            // manually downloaded file is preserved for future use.
            if (pdfBytes && pdfBytes.length > 0 && storageDir) {
                const hasPdf = db
                    .prepare("SELECT 1 FROM itemAttachments WHERE parentItemID = ? AND contentType = 'application/pdf' LIMIT 1")
                    .get(existing.itemID);
                if (!hasPdf) {
                    db.exec('BEGIN IMMEDIATE');
                    const attKey = randomKey();
                    const filename = `${slug(p.title)}.pdf`;
                    const attID = insertRow(db, 'items', {
                        itemTypeID: itemTypeId(db, 'attachment'),
                        key: attKey,
                        dateAdded: nowIso(),
                        dateModified: nowIso(),
                        libraryID: 1,
                    }).lastID;
                    insertRow(db, 'itemAttachments', {
                        itemID: attID,
                        parentItemID: existing.itemID,
                        linkMode: 0,
                        contentType: 'application/pdf',
                        path: `storage:${filename}`,
                    });
                    const dir = join(storageDir, attKey);
                    mkdirSync(dir, { recursive: true });
                    writeFileSync(join(dir, filename), pdfBytes);
                    db.exec('COMMIT');
                    return { ok: true, itemID: existing.itemID, key: existing.key, message: `attached PDF to existing item: ${p.title}` };
                }
            }
            return { ok: false, skippedReason: 'already in library', itemID: existing.itemID, key: existing.key, message: `dup: ${p.title}` };
        }
        // IMMEDIATE acquires the write lock up front: if the Zotero desktop is
        // running (or any writer holds the DB) this fails fast with a clear
        // message instead of corrupting/mid-transaction errors.
        try {
            db.exec('BEGIN IMMEDIATE');
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (/locked|busy/i.test(msg)) {
                return { ok: false, message: 'zotero.sqlite is locked — is the Zotero desktop running? Close it and retry.' };
            }
            return { ok: false, message: `cannot begin transaction: ${msg}` };
        }
        const itemID = insertRow(db, 'items', {
            itemTypeID: itemTypeId(db, 'journalArticle'),
            key: randomKey(),
            dateAdded: nowIso(),
            dateModified: nowIso(),
            libraryID: 1,
        }).lastID;
        setField(db, itemID, 'title', p.title);
        setField(db, itemID, 'abstractNote', p.abstract);
        if (p.year)
            setField(db, itemID, 'date', String(p.year));
        setField(db, itemID, 'url', p.url);
        setField(db, itemID, 'DOI', p.doi);
        addCreators(db, itemID, p.authors);
        addTags(db, itemID, [...(p.keywords ?? []), 'lit-harvest']);
        if (collection)
            addToCollection(db, itemID, collection);
        // PDF attachment (Zotero 7 layout: storage/<attKey>/<file>)
        if (pdfBytes && pdfBytes.length > 0 && storageDir) {
            const attKey = randomKey();
            const filename = `${slug(p.title)}.pdf`;
            const attID = insertRow(db, 'items', {
                itemTypeID: itemTypeId(db, 'attachment'),
                key: attKey,
                dateAdded: nowIso(),
                dateModified: nowIso(),
                libraryID: 1,
            }).lastID;
            insertRow(db, 'itemAttachments', {
                itemID: attID,
                parentItemID: itemID,
                linkMode: 0,
                contentType: 'application/pdf',
                path: `storage:${filename}`,
            });
            const dir = join(storageDir, attKey);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, filename), pdfBytes);
        }
        db.exec('COMMIT');
        return { ok: true, itemID, key: findKey(db, itemID), message: `inserted ${p.title}` };
    }
    catch (err) {
        try {
            db.exec('ROLLBACK');
        }
        catch {
            // ignore
        }
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    finally {
        db.close();
    }
}
function findKey(db, itemID) {
    const row = db.prepare('SELECT key FROM items WHERE itemID = ?').get(itemID);
    return row?.key ?? '';
}
function slug(title) {
    return (title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'paper');
}
