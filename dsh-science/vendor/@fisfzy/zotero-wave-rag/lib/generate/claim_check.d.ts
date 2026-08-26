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
export interface ClaimCheckResult {
    /** Whether the claim is supported by at least one evidence chunk. */
    supported: boolean;
    /** Best lexical overlap (precision of claim terms in evidence). */
    overlap: number;
    /** Index of the best-supporting evidence chunk. */
    bestEvidenceIndex: number | undefined;
}
export declare const CLAIM_SUPPORT_THRESHOLD = 0.3;
/** Split a generated field into claim sentences (zh/en punctuation). */
export declare function splitClaims(text: string): string[];
/** Check one claim against the evidence list.
 * The claim (and evidence) go through the domain query expansion first, so
 * zh<->en bridges (层间→interlaminar, 近场动力学→peridynamics) contribute
 * high-precision canonical terms instead of dead-zero lexical overlap. */
export declare function checkClaim(claim: string, evidence: string[]): ClaimCheckResult;
/**
 * Guard a generated field: mark sentences that the evidence does not
 * support with an explicit warning (never silently drop).
 */
export declare function guardField(text: string | undefined, evidence: string[]): string | undefined;
