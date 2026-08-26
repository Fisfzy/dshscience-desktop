/**
 * PDF full-text extraction (Zotero 7 path).
 *
 * Zotero 6 stored raw full text in `fulltextItems.indexableText`; Zotero 7
 * replaced it with a position-less word index (bag of words), so the raw
 * text must come from the PDF itself. This module shells out to poppler's
 * `pdftotext` (available on this box) with a persistent disk cache so a
 * library is only parsed once.
 */
/** Cache dir: ZWR_CACHE_DIR, else <dataDir>/.zwr-cache, else tmpdir. */
export declare function cacheDir(dataDir?: string): string;
/** Extract text from one PDF via `pdftotext <pdf> -`. */
export declare function extractPdfText(pdfPath: string): Promise<string>;
/**
 * Extract (with cache) the text for one paper's PDF.
 * Returns undefined when extraction fails or yields no text.
 */
export declare function fullTextForPdf(paperKey: string, pdfPath: string, dataDir?: string): Promise<string | undefined>;
export declare function hasPdfTextTool(): boolean;
