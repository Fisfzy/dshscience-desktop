/**
 * Claim–evidence validator — the faithfulness guard for generated content.
 *
 * The generation layer may overreach beyond the retrieved evidence (the
 * UJUTGR83 failure: a coupling→free-edge causal chain was inferred with no
 * supporting text). This validator reuses the engine's own lexical machinery
 * (the BM25 term pipeline) to check, per claim sentence, how much of the
 * claim's meaningful vocabulary actually appears in the evidence chunks:
 *
 *   support = |terms(claim) ∩ terms(bestEvidence)| / |terms(claim)|
 *
 * Sentences below `threshold` are flagged "unsupported" so callers can mark
 * (or drop) them. This is a lightweight, zero-dependency attributable-source
 * check — the same idea as AttributedQA/AIS, implemented on top of the
 * plugin's existing tokenizer.
 */
import { terms } from "../retrieval/bm25.js";
import { expandQuery } from "../retrieval/expand.js";
export const CLAIM_SUPPORT_THRESHOLD = 0.3;
/** Split a generated field into claim sentences (zh/en punctuation). */
export function splitClaims(text) {
    return text
        .split(/(?<=[。！？；!?;])\s*|\n+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 4);
}
/** Check one claim against the evidence list.
 * The claim (and evidence) go through the domain query expansion first, so
 * zh<->en bridges (层间→interlaminar, 近场动力学→peridynamics) contribute
 * high-precision canonical terms instead of dead-zero lexical overlap. */
export function checkClaim(claim, evidence) {
    const baseSet = new Set(terms(claim));
    const expSet = new Set(terms(expandQuery(claim)));
    // Canonical terms ADDED by the zh<->en expansion are high-precision
    // signals (e.g. 层间→interlaminar): their containment in the evidence is
    // scored separately so CJK 4-char grouping noise cannot dilute them.
    const canonical = new Set();
    for (const t of expSet)
        if (!baseSet.has(t))
            canonical.add(t);
    let best = 0;
    let bestIdx;
    for (let i = 0; i < evidence.length; i++) {
        const evSet = new Set(terms(expandQuery(evidence[i])));
        let baseHit = 0;
        for (const t of baseSet)
            if (evSet.has(t))
                baseHit++;
        const baseOverlap = baseSet.size > 0 ? baseHit / baseSet.size : 0;
        let canonicalOverlap = 0;
        if (canonical.size > 0) {
            let cHit = 0;
            for (const t of canonical)
                if (evSet.has(t))
                    cHit++;
            canonicalOverlap = cHit / canonical.size;
        }
        const overlap = Math.max(baseOverlap, canonicalOverlap);
        if (overlap > best) {
            best = overlap;
            bestIdx = i;
        }
    }
    return { supported: best >= CLAIM_SUPPORT_THRESHOLD, overlap: best, bestEvidenceIndex: bestIdx };
}
/**
 * Guard a generated field: mark sentences that the evidence does not
 * support with an explicit warning (never silently drop).
 */
export function guardField(text, evidence) {
    if (!text || evidence.length === 0)
        return text;
    const out = [];
    for (const sentence of splitClaims(text)) {
        const r = checkClaim(sentence, evidence);
        out.push(r.supported ? sentence : `${sentence}（⚠ 此句未在证据中找到直接支持，已标注）`);
    }
    return out.join(' ');
}
