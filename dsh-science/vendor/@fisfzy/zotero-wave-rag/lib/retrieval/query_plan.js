/**
 * Query planning (P0-2).
 *
 * Rule-based path (always available):
 *   effectiveQueries = [domain-expanded query (+resolved citation titles)]
 *   references       = citation mentions ("Smith et al., 2020") resolved to
 *                      library papers — their titles are appended to the
 *                      effective query, so the anchor channel and BM25 see
 *                      the exact title terms without touching wave.ts.
 *
 * Optional LLM path (only when an LLM provider is configured; any failure
 * falls back to the rule path, so behavior without a key is unchanged):
 *   generates ≤6 query variants, each fed to BM25; wave uses the primary
 *   semantic query (embedded once).
 */
import { expandQuery } from "./expand.js";
const CITATION_RE = /(?:^|[\(（]|\s)([A-Z][A-Za-z\-]+)(?:\s+(?:et al\.?|等(?:人)?))?(?:\s+and\s+[A-Z][A-Za-z\-]+)?(?:,|\s)[\(（]?(\d{4})[\)）]?/g;
/** Resolve "(Smith et al., 2020)"-style mentions to library paper titles. */
export function parseCitations(query, index) {
    const found = [];
    const seen = new Set();
    CITATION_RE.lastIndex = 0;
    let m;
    while ((m = CITATION_RE.exec(query)) !== null) {
        const name = m[1].toLowerCase();
        const year = Number(m[2]);
        // author-first resolution: prefer the exact-year paper, fall back to any
        // paper by that author (library years are often missing or approximate).
        const candidates = index.papers.filter((p) => !seen.has(p.key) && p.creators.some((c) => c.lastName.toLowerCase().startsWith(name)));
        const pick = candidates.find((p) => p.year === year) ?? candidates[0];
        if (pick) {
            seen.add(pick.key);
            found.push(pick.title);
            if (found.length >= 5)
                return found;
        }
    }
    return found;
}
/** Rule-based plan: domain expansion + citation-title merging. */
export function buildQueryPlan(query, index) {
    const references = parseCitations(query, index);
    let effective = expandQuery(query);
    if (references.length > 0) {
        effective = `${effective} ${references.join(' ')}`;
    }
    return { effectiveQueries: [effective], semanticQuery: effective, references };
}
/**
 * Optional LLM variant generation (≤6 variants, temperature 0). Returns
 * undefined on any failure so callers fall back to the rule path.
 */
export async function generateQueryPlanWithModel(query, index, llm) {
    const base = buildQueryPlan(query, index);
    try {
        const url = `${llm.baseURL.replace(/\/+$/, '')}/chat/completions`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` },
            body: JSON.stringify({
                model: llm.model,
                messages: [
                    {
                        role: 'system',
                        content: 'Rewrite the user research query into up to 6 distinct search variants that could find the same literature in different wording (synonyms, abbreviations, English/Chinese). Return ONLY JSON: {"variants":["..."]}.',
                    },
                    { role: 'user', content: query },
                ],
                temperature: 0,
                response_format: { type: 'json_object' },
            }),
        });
        if (!res.ok)
            return undefined;
        const data = (await res.json());
        const content = data.choices[0]?.message?.content ?? '';
        const parsed = JSON.parse(content);
        const variants = Array.isArray(parsed.variants)
            ? parsed.variants.filter((v) => typeof v === 'string' && v.trim().length > 0).slice(0, 6)
            : [];
        const effectiveQueries = [...new Set([base.effectiveQueries[0], ...variants.map((v) => expandQuery(v))])];
        return { effectiveQueries, semanticQuery: base.semanticQuery, references: base.references };
    }
    catch {
        return undefined;
    }
}
