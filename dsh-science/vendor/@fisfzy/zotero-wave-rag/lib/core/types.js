/**
 * Domain model for the Zotero wave-RAG library.
 *
 * Everything downstream (ingest, retrieval, generation, eval) speaks in these
 * types, so the data adapter (real zotero.sqlite vs built-in sample data) is
 * swappable without touching the retrieval core.
 */
export {};
