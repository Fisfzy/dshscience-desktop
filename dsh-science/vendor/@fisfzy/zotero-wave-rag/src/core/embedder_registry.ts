/**
 * Embedder presets — the user-facing "choose your embedding model" registry.
 *
 * Entry points:
 *   - DSH tool `zotero_embedder` (list / set <preset-id>)
 *   - CLI: `node scripts/embedder.mjs list|set <id>|status`
 *
 * Presets describe *kind + model*; API keys stay in env
 * (`ZWR_EMBEDDER_API_KEY`, from `.env.local`), never in the registry.
 */

import type { ApiProvider, EmbedderKind } from './config.ts'

export interface EmbedderPreset {
  /** Stable id used by the tool/CLI. */
  id: string
  /** Human-readable label. */
  label: string
  kind: EmbedderKind
  /** OpenAI-compatible base URL (API presets); defaults to SiliconFlow. */
  baseURL?: string
  /** Model id on that endpoint. */
  model?: string
  /** Whether this preset requires an API key to function. */
  needsKey: boolean
  /** One-line note shown in `list`. */
  note: string
}

export const EMBEDDER_PRESETS: EmbedderPreset[] = [
  {
    id: 'hash',
    label: '离线哈希嵌入（免费）',
    kind: 'hash',
    needsKey: false,
    note: '无 API 依赖、可复现；当前默认，中文/英文均可',
  },
  {
    id: 'bge-m3',
    label: 'BAAI/bge-m3（文本专用，推荐）',
    kind: 'api',
    baseURL: 'https://api.siliconflow.cn/v1',
    model: 'BAAI/bge-m3',
    needsKey: true,
    note: '文本检索质量好、单价低（评测 Recall@5 0.917）',
  },
  {
    id: 'qwen3-embed-8b',
    label: 'Qwen/Qwen3-Embedding-8B（文本专用）',
    kind: 'api',
    baseURL: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen3-Embedding-8B',
    needsKey: true,
    note: 'Qwen 系文本嵌入，8B 参数量',
  },
  {
    id: 'qwen3-vl-embed-8b',
    label: 'Qwen/Qwen3-VL-Embedding-8B（多模态，较贵）',
    kind: 'api',
    baseURL: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen3-VL-Embedding-8B',
    needsKey: true,
    note: '视觉-语言嵌入；纯文本任务不划算（评测 Recall@5 0.705）',
  },
]

export function embedderPreset(id: string): EmbedderPreset | undefined {
  return EMBEDDER_PRESETS.find((p) => p.id === id)
}

/** Resolve a preset into a concrete embedder config, given env secrets. */
export function presetToEmbedder(
  preset: EmbedderPreset,
  envKey?: string,
  envBaseURL?: string,
): { embedder: EmbedderKind; embedderApi?: ApiProvider } {
  if (preset.kind === 'hash') return { embedder: 'hash' }
  if (!preset.model) return { embedder: 'api' }
  if (!envKey) {
    // The preset needs a key but none is configured — still switch the
    // *intent* so the next run after key config picks it up.
    return {
      embedder: 'api',
      embedderApi: { baseURL: envBaseURL ?? preset.baseURL ?? 'https://api.siliconflow.cn/v1', apiKey: '', model: preset.model },
    }
  }
  return {
    embedder: 'api',
    embedderApi: {
      baseURL: envBaseURL ?? preset.baseURL ?? 'https://api.siliconflow.cn/v1',
      apiKey: envKey,
      model: preset.model,
    },
  }
}

/** Short stable id used in the index-cache key (embedder identity). */
export function embedderCacheId(embedder: EmbedderKind, model?: string): string {
  return embedder === 'hash' ? 'hash' : `api-${(model ?? 'custom').replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 40)}`
}
