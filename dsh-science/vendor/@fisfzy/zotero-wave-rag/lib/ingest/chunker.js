/**
 * Section-aware chunker. Turns a paper's full text into chunks with a
 * section heading, character offsets (`sourceStart/sourceEnd`) and
 * best-effort page numbers (`pageStart/pageEnd`, from pdftotext's \f page
 * markers); falls back to the abstract when no full text exists.
 *
 * Chunk TEXT is byte-identical to the pre-metadata version (the token stream
 * is unchanged — only spans/pages are recorded), so cached embeddings and
 * eval baselines stay valid.
 */
/** Target chunk size in whitespace tokens. */
export const CHUNK_MAX_TOKENS = 512;
/** Chunk overlap in tokens, to keep section boundaries from slicing meaning. */
export const CHUNK_OVERLAP_TOKENS = 64;
const CJK_RE = /[\u4e00-\u9fff\u3040-\u30ff]/;
/** Same grouping as `splitIntoTokens`: space after every 4th CJK char in a run. */
const CJK4_RE = /([\u4e00-\u9fff\u3040-\u30ff]{4})(?=[\u4e00-\u9fff\u3040-\u30ff])/g;
/**
 * Tokenize for chunk sizing. Whitespace splits western text; CJK has no
 * spaces, so adjacent CJK runs get artificial boundaries every 4 characters
 * (~1 char per token would explode chunk counts for Chinese papers).
 * Shared with the BM25 sparse index (src/retrieval/bm25.ts).
 */
export function splitIntoTokens(text) {
    const spaced = text.replace(CJK4_RE, '$1 ');
    return spaced.split(/\s+/).filter((t) => t.length > 0);
}
/**
 * CJK-space `text` exactly like `splitIntoTokens` while recording each
 * output char's original offset. `base` is added to every offset.
 */
function cjkSpacedWithOffsets(text, base, page) {
    let spaced = '';
    const map = []; // spaced position -> original offset (relative to text)
    let last = 0;
    let m;
    CJK4_RE.lastIndex = 0;
    while ((m = CJK4_RE.exec(text)) !== null) {
        spaced += text.slice(last, m.index) + m[0];
        for (let i = last; i < m.index + m[0].length; i++)
            map.push(i);
        spaced += ' ';
        map.push(m.index + m[0].length - 1);
        last = m.index + m[0].length;
    }
    spaced += text.slice(last);
    for (let i = last; i < text.length; i++)
        map.push(i);
    const spans = [];
    let cur = '';
    let curStartPos = -1;
    for (let i = 0; i < spaced.length; i++) {
        const ch = spaced[i];
        if (/\s/.test(ch)) {
            if (cur) {
                spans.push({ token: cur, start: base + map[curStartPos], end: base + map[i - 1], page });
                cur = '';
            }
        }
        else {
            if (!cur)
                curStartPos = i;
            cur += ch;
        }
    }
    if (cur)
        spans.push({ token: cur, start: base + map[curStartPos], end: base + map[map.length - 1], page });
    return spans;
}
/** Best-effort section headings, "1. Introduction"-style or bare headings. */
function detectSection(line) {
    const trimmed = line.trim().replace(/\s+/g, ' ');
    if (/^(\d+(\.\d+)*\.?)\s+[A-Z]/.test(trimmed))
        return trimmed;
    if (/^[A-Z][A-Za-z ]{2,40}$/.test(trimmed) && trimmed.length <= 60)
        return trimmed;
    return undefined;
}
/** Slice token spans into windows; text = tokens joined with ' ' (unchanged). */
function chunkSpans(spans, max, overlap) {
    if (spans.length <= max)
        return [spans];
    const out = [];
    for (let i = 0; i < spans.length; i += max - overlap) {
        out.push(spans.slice(i, i + max));
        if (i + max >= spans.length)
            break;
    }
    return out;
}
/** Chunk one paper. Always returns at least one chunk. */
export function chunkPaper(paper) {
    const text = paper.fullText?.trim();
    if (!text) {
        const abstract = paper.abstract?.trim();
        if (!abstract)
            return [];
        return [{ paperKey: paper.key, section: 'abstract', text: abstract }];
    }
    // Split into pages at form-feed markers (pdftotext output); offsets are
    // relative to the trimmed text.
    const pages = [];
    {
        let pgStart = 0;
        for (const part of text.split('\f')) {
            pages.push({ start: pgStart, content: part });
            pgStart += part.length + 1;
        }
    }
    const hasPages = pages.length > 1;
    // Tokenize line by line, carrying spans + pages. Token stream is identical
    // to tokenizing the whitespace-joined body (single spaces, CJK runs broken
    // at line joins exactly as before).
    const lineSpans = [];
    for (const [pi, page] of pages.entries()) {
        let lineStart = 0;
        for (const raw of page.content.split('\n')) {
            const lead = raw.length - raw.trimStart().length;
            const line = raw.trim();
            if (line.length > 0) {
                lineSpans.push(cjkSpacedWithOffsets(line, page.start + lineStart + lead, hasPages ? pi : undefined));
            }
            lineStart += raw.length + 1;
        }
    }
    // Group lines into sections, preserving headings (same logic as before).
    const sections = [];
    let current = { spans: [] };
    for (const spans of lineSpans) {
        const lineText = spans.map((s) => s.token).join(' ');
        const heading = detectSection(lineText);
        if (heading !== undefined && current.spans.length > 0) {
            sections.push(current);
            current = { heading, spans: [] };
        }
        else if (heading !== undefined) {
            current = { heading, spans: [] };
        }
        else {
            current.spans.push(...spans);
        }
    }
    if (current.spans.length > 0)
        sections.push(current);
    const chunks = [];
    for (const section of sections) {
        for (const w of chunkSpans(section.spans, CHUNK_MAX_TOKENS, CHUNK_OVERLAP_TOKENS)) {
            const first = w[0];
            const last = w[w.length - 1];
            chunks.push({
                paperKey: paper.key,
                section: section.heading,
                text: w.map((s) => s.token).join(' '),
                sourceStart: first.start,
                sourceEnd: last.end + 1,
                pageStart: first.page,
                pageEnd: last.page,
            });
        }
    }
    return chunks;
}
