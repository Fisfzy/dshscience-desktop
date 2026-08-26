/**
 * lit-harvest — configuration.
 *
 * Resolution precedence (highest wins), mirroring zotero-wave-rag's pattern:
 *   1. runtime config file `~/.config/lit-harvest/config.json`
 *   2. env `LIT_*` (and `ZWR_DATA_DIR` / zotero-wave-rag runtime config for
 *      the shared Zotero data dir)
 *   3. built-in defaults
 *
 * The Zotero data dir is deliberately shared with zotero-wave-rag so that
 * papers saved by lit-harvest are picked up by the same reindex path.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export const DEFAULT_SOURCES = ['openalex', 'arxiv', 'crossref', 'semantic-scholar'];
const DEFAULTS = {
    dataDir: '',
    inboxDir: join(homedir(), '.local', 'share', 'lit-harvest', 'inbox'),
    zoteroApiBase: 'http://127.0.0.1:23119',
    minCorePapers: 5,
    minTotalPapers: 10,
    maxRounds: 3,
    perRoundFetch: 10,
    httpTimeoutMs: 25_000,
    s2ApiKey: '',
    unpaywallEmail: 'lit-harvest@users.noreply.github.com',
    resolveDownloads: true,
    scholarProxy: '',
    sources: DEFAULT_SOURCES,
    autoReindex: true,
};
/** ~/.config/lit-harvest/config.json — persisted user choices. */
function runtimeConfigPath() {
    return join(process.env.LIT_CONFIG_DIR ?? join(homedir(), '.config', 'lit-harvest'), 'config.json');
}
function readRuntimeConfig() {
    try {
        return JSON.parse(readFileSync(runtimeConfigPath(), 'utf8'));
    }
    catch {
        return {};
    }
}
/** Resolve the shared Zotero data dir exactly like zotero-wave-rag does. */
export function resolveZoteroDataDir() {
    if (process.env.ZWR_DATA_DIR !== undefined && process.env.ZWR_DATA_DIR !== '') {
        return process.env.ZWR_DATA_DIR;
    }
    try {
        const zwr = join(homedir(), '.config', 'zotero-wave-rag', 'config.json');
        if (existsSync(zwr)) {
            const cfg = JSON.parse(readFileSync(zwr, 'utf8'));
            if (cfg.dataDir)
                return cfg.dataDir;
        }
    }
    catch {
        // ignore
    }
    return '';
}
const num = (v, fallback) => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
/** Effective config for one tool call. */
export function resolveConfig(overrides = {}) {
    const env = process.env;
    const runtime = readRuntimeConfig();
    const cfg = {
        ...DEFAULTS,
        ...overrides,
    };
    if (env.LIT_DATA_DIR !== undefined && env.LIT_DATA_DIR !== '')
        cfg.dataDir = env.LIT_DATA_DIR;
    if (env.LIT_INBOX_DIR !== undefined)
        cfg.inboxDir = env.LIT_INBOX_DIR;
    if (env.LIT_MIN_CORE !== undefined)
        cfg.minCorePapers = Number(env.LIT_MIN_CORE) || cfg.minCorePapers;
    if (env.LIT_MIN_TOTAL !== undefined)
        cfg.minTotalPapers = Number(env.LIT_MIN_TOTAL) || cfg.minTotalPapers;
    if (env.LIT_MAX_ROUNDS !== undefined)
        cfg.maxRounds = Number(env.LIT_MAX_ROUNDS) || cfg.maxRounds;
    if (env.LIT_AUTO_REINDEX === '0' || env.LIT_AUTO_REINDEX === 'false')
        cfg.autoReindex = false;
    if (env.LIT_S2_API_KEY !== undefined)
        cfg.s2ApiKey = env.LIT_S2_API_KEY;
    if (env.LIT_UNPAYWALL_EMAIL !== undefined && env.LIT_UNPAYWALL_EMAIL !== '') {
        cfg.unpaywallEmail = env.LIT_UNPAYWALL_EMAIL;
    }
    if (env.LIT_RESOLVE_DOWNLOADS === '0' || env.LIT_RESOLVE_DOWNLOADS === 'false')
        cfg.resolveDownloads = false;
    if (env.LIT_SCHOLAR_PROXY !== undefined)
        cfg.scholarProxy = env.LIT_SCHOLAR_PROXY;
    // runtime file wins over env (explicit user choice), like zotero-wave-rag
    if (runtime.dataDir !== undefined)
        cfg.dataDir = runtime.dataDir;
    if (runtime.inboxDir !== undefined)
        cfg.inboxDir = runtime.inboxDir;
    if (runtime.zoteroApiBase !== undefined)
        cfg.zoteroApiBase = runtime.zoteroApiBase;
    if (runtime.minCorePapers !== undefined)
        cfg.minCorePapers = num(runtime.minCorePapers, cfg.minCorePapers);
    if (runtime.minTotalPapers !== undefined)
        cfg.minTotalPapers = num(runtime.minTotalPapers, cfg.minTotalPapers);
    if (runtime.maxRounds !== undefined)
        cfg.maxRounds = num(runtime.maxRounds, cfg.maxRounds);
    if (runtime.autoReindex !== undefined)
        cfg.autoReindex = runtime.autoReindex;
    if (cfg.dataDir === '')
        cfg.dataDir = resolveZoteroDataDir();
    return cfg;
}
/**
 * Locate the installed zotero-wave-rag plugin directory.
 * When installed: `<checkout>/.external-plugins/lit-harvest/lib/...` so the
 * checkout is two levels up and the sibling plugin is next to us. In a dev
 * checkout (this repo outside the harness) fall back to the harness's own
 * external-plugins dir or the LIT_ZWR_DIR override.
 */
export function zoteroWaveRagDir() {
    const here = dirname(fileURLToPath(import.meta.url)); // .../lit-harvest/lib
    const pluginRoot = resolve(here, '..'); // .../lit-harvest
    const external = resolve(pluginRoot, '..'); // .../.external-plugins
    const candidates = [
        process.env.LIT_ZWR_DIR ?? '',
        join(external, 'zotero-wave-rag'),
        join(resolve(external, '..'), '.external-plugins', 'zotero-wave-rag'),
        join(homedir(), '.dsh', 'source', 'current', '.external-plugins', 'zotero-wave-rag'),
        join(homedir(), '.dsh', 'source', 'master', '.external-plugins', 'zotero-wave-rag'),
    ];
    for (const c of candidates) {
        if (c && existsSync(join(c, 'scripts', 'ingest.mjs')))
            return c;
    }
    return '';
}
/** Ensure the inbox directory exists. */
export function ensureDir(p) {
    mkdirSync(p, { recursive: true });
}
