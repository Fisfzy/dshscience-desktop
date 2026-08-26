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
import { probeZoteroApi, addItemViaApi, attachPdfViaApi } from "./zotero_api.js";
import { addPaperToSqlite } from "./zotero_sqlite.js";
import { writeInbox } from "./inbox.js";
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
async function downloadPdf(p, timeoutMs) {
    const url = p.primaryDownloadUrl ?? p.pdfUrl;
    if (!url)
        return undefined;
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok)
            return undefined;
        const buf = new Uint8Array(await res.arrayBuffer());
        return buf.length > 0 ? buf : undefined;
    }
    catch {
        return undefined;
    }
}
export async function savePapers(opts) {
    const cfg = opts.cfg;
    const requested = opts.mode ?? 'auto';
    const saved = [];
    const skipped = [];
    let resolvedMode = 'auto';
    const apiUp = await probeZoteroApi(cfg.zoteroApiBase);
    const dbPath = cfg.dataDir ? join(cfg.dataDir, 'zotero.sqlite') : '';
    const storageDir = cfg.dataDir ? join(cfg.dataDir, 'storage') : undefined;
    const sqliteUsable = dbPath !== '' && existsSync(dbPath);
    let mode;
    if (requested === 'zotero-api')
        mode = 'zotero-api';
    else if (requested === 'sqlite')
        mode = sqliteUsable ? 'sqlite' : 'inbox';
    else if (requested === 'inbox')
        mode = 'inbox';
    else
        mode = apiUp ? 'zotero-api' : sqliteUsable ? 'sqlite' : 'inbox';
    resolvedMode = mode;
    for (const p of opts.papers) {
        const pdf = await downloadPdf(p, cfg.httpTimeoutMs);
        if (mode === 'zotero-api') {
            const created = await addItemViaApi(cfg.zoteroApiBase, p);
            if (!created.ok || !created.key) {
                skipped.push(`${p.title}: ${created.message}`);
                continue;
            }
            let tmp = null;
            if (pdf) {
                tmp = tempPdf(cfg, p, pdf);
                await attachPdfViaApi(cfg.zoteroApiBase, created.key, tmp);
            }
            if (tmp)
                rmSync(tmp, { force: true });
            saved.push({ key: created.key, doi: p.doi, title: p.title });
        }
        else if (mode === 'sqlite') {
            const r = addPaperToSqlite(dbPath, storageDir, p, opts.collection, pdf);
            if (!r.ok) {
                skipped.push(`${p.title}: ${r.message}`);
                continue;
            }
            saved.push({ key: r.key, itemID: r.itemID, doi: p.doi, title: p.title });
        }
        else {
            writeInbox(cfg.inboxDir, p, pdf);
            saved.push({ doi: p.doi, title: p.title });
        }
    }
    return {
        saved: saved.length,
        mode: requested,
        resolvedMode,
        collection: opts.collection,
        inboxDir: mode === 'inbox' ? cfg.inboxDir : undefined,
        zoteroItems: saved,
        skipped,
    };
}
function tempPdf(cfg, p, bytes) {
    const dir = join(cfg.inboxDir, 'tmp-attach');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${Date.now()}-${p.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)}.pdf`);
    writeFileSync(path, bytes);
    return path;
}
