/**
 * zotero-wave-rag — DSH external plugin entry.
 *
 * Registers four model-facing tools over the wave-semantics RAG engine:
 *   - zotero_status        config + library/index status
 *   - zotero_search        wave retrieval over the paper library
 *   - zotero_paper_detail  structured "paper detail card" for one paper
 *   - zotero_compare       side-by-side detail cards for several papers
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { engine } from "./core/engine.js";
export const name = 'zotero-wave-rag';
export const inject = ['tools'];
/** Register the four tools on the host tool registry. */
export function apply(ctx) {
    ctx.tools.register(defineTool({
        name: 'zotero_status',
        description: 'Report zotero-wave-rag status: data source, index build state, embedder/LLM providers, and wave-retrieval hyper-parameters.',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    ok: { type: 'boolean', required: true },
                    version: { type: 'string', required: true },
                    dataSource: { type: 'string', required: true },
                    dataDir: { type: 'string', required: true },
                    index: {
                        type: 'object',
                        required: true,
                        properties: {
                            built: { type: 'boolean', required: true },
                            papers: { type: 'integer', required: true },
                            chunks: { type: 'integer', required: true },
                            edges: { type: 'integer', required: true },
                        },
                        additionalProperties: false,
                    },
                    embedder: { type: 'string', required: true },
                    embedderModel: { type: 'string' },
                    semanticEnabled: { type: 'boolean', required: true },
                    semanticReason: { type: 'string' },
                    degraded: {
                        type: 'object',
                        properties: {
                            from: { type: 'string', required: true },
                            to: { type: 'string', required: true },
                            reason: { type: 'string', required: true },
                        },
                        additionalProperties: false,
                    },
                    llm: { type: 'string', required: true },
                    wave: {
                        type: 'object',
                        required: true,
                        properties: {
                            propagationHops: { type: 'integer', required: true },
                            damping: { type: 'number', required: true },
                            wormholeTopK: { type: 'integer', required: true },
                            alpha: { type: 'number', required: true },
                            beta: { type: 'number', required: true },
                            gamma: { type: 'number', required: true },
                            bellDamping: { type: 'number', required: true },
                            topK: { type: 'integer', required: true },
                        },
                        additionalProperties: false,
                    },
                    notes: { type: 'array', required: true, items: { type: 'string' } },
                },
            },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        execute: async () => engine.status(),
        presentCall: () => ({ card: 'generic', title: 'zotero status', kind: 'other', rawInput: null }),
    }));
    ctx.tools.register(defineTool({
        name: 'zotero_search',
        description: 'Search the Zotero paper library with wave-semantics retrieval (tag-river graph propagation, wormhole jumps, bell-damper diversity, Ω re-rank) and return ranked paper hits with channel scores.',
        parameters: {
            query: {
                type: 'string',
                required: true,
                description: 'Natural-language query about the library, e.g. "which papers apply retrieval augmentation to recommendation?"',
            },
            topK: {
                type: 'integer',
                description: 'Max hits to return (defaults to the configured wave.topK).',
            },
            type: {
                type: 'string',
                enum: ['experimental', 'numerical', 'analytical', 'review', 'mixed'],
                description: 'Filter hits by research method (e.g. "试验" queries → experimental).',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    query: { type: 'string', required: true },
                    hits: {
                        type: 'array',
                        required: true,
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                paperKey: { type: 'string', required: true },
                                title: { type: 'string', required: true },
                                score: { type: 'number', required: true },
                                reasons: { type: 'array', required: true, items: { type: 'string' } },
                                semantic: { type: 'number' },
                                propagation: { type: 'number' },
                                anchor: { type: 'number' },
                                bm25: { type: 'number' },
                                snippet: { type: 'string' },
                                methodType: { type: 'string' },
                            },
                        },
                    },
                    engine: { type: 'string', required: true },
                    latencyMs: { type: 'integer', required: true },
                },
            },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        execute: async (args) => {
            const query = String(args.query ?? '');
            const topK = typeof args.topK === 'number' ? args.topK : undefined;
            const type = typeof args.type === 'string' && args.type.length > 0 ? args.type : undefined;
            return engine.search(query, topK, 'wave', type);
        },
        presentCall: (args) => ({
            card: 'generic',
            title: `zotero_search: ${String(args.query ?? '')}`,
            kind: 'other',
            rawInput: args,
        }),
    }));
    ctx.tools.register(defineTool({
        name: 'zotero_paper_detail',
        description: 'Return a structured paper detail card (metadata, method, contribution, experiments, related papers, evidence) for one library paper by its Zotero key.',
        parameters: {
            key: {
                type: 'string',
                required: true,
                description: 'Zotero item key, e.g. the paperKey returned by zotero_search.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    paperKey: { type: 'string', required: true },
                    title: { type: 'string', required: true },
                    metadata: {
                        type: 'object',
                        required: true,
                        additionalProperties: false,
                        properties: {
                            creators: { type: 'array', required: true },
                            year: { type: 'integer' },
                            tags: { type: 'array', required: true },
                            collections: { type: 'array', required: true },
                            url: { type: 'string' },
                            doi: { type: 'string' },
                            methodType: { type: 'string' },
                        },
                    },
                    method: { type: 'string' },
                    contribution: { type: 'string' },
                    experiments: { type: 'string' },
                    relatedPapers: { type: 'array', required: true },
                    evidence: { type: 'array', required: true },
                    error: { type: 'string' },
                },
            },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        execute: async (args) => engine.paperDetail(String(args.key ?? '')),
        presentCall: (args) => ({
            card: 'generic',
            title: `zotero_paper_detail: ${String(args.key ?? '')}`,
            kind: 'other',
            rawInput: args,
        }),
    }));
    ctx.tools.register(defineTool({
        name: 'zotero_embedder',
        description: 'List or switch the embedding model used by zotero-wave-rag. Presets: hash (free offline), bge-m3, qwen3-embed-8b, qwen3-vl-embed-8b. Switching persists and the next index build uses the new model (index caches are keyed per embedder, so vectors never mix).',
        parameters: {
            action: {
                type: 'string',
                required: true,
                enum: ['list', 'set'],
                description: 'list = show presets and the current embedder; set = switch to a preset id.',
            },
            name: {
                type: 'string',
                description: 'Preset id to switch to (required when action=set).',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    action: { type: 'string', required: true },
                    current: { type: 'string', required: true },
                    ok: { type: 'boolean' },
                    message: { type: 'string' },
                    presets: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                id: { type: 'string', required: true },
                                label: { type: 'string', required: true },
                                kind: { type: 'string', required: true },
                                needsKey: { type: 'boolean', required: true },
                                configured: { type: 'boolean', required: true },
                                note: { type: 'string', required: true },
                            },
                        },
                    },
                },
            },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        execute: async (args) => {
            const action = String(args.action ?? 'list');
            if (action === 'list') {
                return { action, ...engine.listEmbedders() };
            }
            const name = String(args.name ?? '');
            if (!name) {
                return { action, current: engine.currentEmbedderId(), ok: false, message: 'action=set 需要 name 参数（预设 id）' };
            }
            const result = engine.setEmbedder(name);
            return { action, ...result };
        },
        presentCall: (args) => ({
            card: 'generic',
            title: `zotero_embedder: ${String(args.action ?? '')}`,
            kind: 'other',
            rawInput: args,
        }),
    }));
    ctx.tools.register(defineTool({
        name: 'zotero_compare',
        description: 'Return side-by-side detail cards for two or more library papers, highlighting shared and differing tags/creators plus wave-graph relations.',
        parameters: {
            keys: {
                type: 'array',
                required: true,
                description: 'Zotero item keys of the papers to compare (2+).',
                items: { type: 'string' },
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    keys: { type: 'array', required: true, items: { type: 'string' } },
                    cards: { type: 'array', required: true },
                    sharedTags: { type: 'array', required: true },
                    sharedCreators: { type: 'array', required: true },
                    error: { type: 'string' },
                },
            },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        execute: async (args) => {
            const keys = Array.isArray(args.keys)
                ? args.keys.map((k) => String(k))
                : [];
            return engine.compare(keys);
        },
        presentCall: (args) => ({
            card: 'generic',
            title: `zotero_compare: ${String(args.keys?.join?.(' ,') ?? '')}`,
            kind: 'other',
            rawInput: args,
        }),
    }));
}
