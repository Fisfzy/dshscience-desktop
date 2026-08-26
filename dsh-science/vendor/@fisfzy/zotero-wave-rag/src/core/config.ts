/**
 * Plugin configuration: paths, providers, and wave-retrieval hyper-parameters.
 *
 * Everything is configurable so the resume story can show thoughtful
 * engineering: the embedding model and LLM are pluggable (the author adds API
 * keys later), the data source is swappable (real zotero.sqlite vs the
 * built-in sample library), and every wave term has an exposed knob that the
 * ablation harness (M4) sweeps.
 *
 * Embedder selection precedence (highest wins):
 *   1. runtime config file (`~/.config/zotero-wave-rag/config.json`,
 *      written by the `zotero_embedder` tool / CLI) — the user's explicit
 *      interactive choice;
 *   2. env (`ZWR_EMBEDDER`, `ZWR_EMBEDDER_MODEL`, …);
 *   3. built-in defaults.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { embedderPreset, presetToEmbedder } from './embedder_registry.ts'

/**
 * Local secrets fallback: the DSH server process does not source `.env.local`,
 * so the plugin reads it from its own root (dev repo or the installed copy —
 * dshx copies it verbatim). process.env always wins over the file.
 */
function loadLocalEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const root = fileURLToPath(new URL('../..', import.meta.url)) // <root>/lib/core -> <root>
    const file = join(root, '.env.local')
    if (!existsSync(file)) return out
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
      if (!m || line.trim().startsWith('#')) continue
      out[m[1]!] = m[2]!.trim()
    }
  } catch {
    // never fatal
  }
  return out
}

/** Runtime config file holding the user's embedder choice. */
export function runtimeConfigPath(): string {
  return join(process.env.ZWR_CONFIG_DIR ?? join(homedir(), '.config', 'zotero-wave-rag'), 'config.json')
}

/** Runtime config file shape (user's interactive choices, persisted). */
export interface RuntimeConfig {
  embedderId?: string
  dataDir?: string
  indexLevel?: 'abstract' | 'fulltext'
}

function readRuntimeConfig(): RuntimeConfig {
  try {
    return JSON.parse(readFileSync(runtimeConfigPath(), 'utf8')) as RuntimeConfig
  } catch {
    return {}
  }
}

function readRuntimeEmbedderId(): string | undefined {
  const id = readRuntimeConfig().embedderId
  return id && embedderPreset(id) ? id : undefined
}

/** Persist a runtime-config update, preserving unrelated fields. */
export function updateRuntimeConfig(patch: RuntimeConfig): RuntimeConfig {
  const file = runtimeConfigPath()
  mkdirSync(join(file, '..'), { recursive: true })
  const merged: RuntimeConfig = { ...readRuntimeConfig(), ...patch }
  writeFileSync(file, JSON.stringify(merged, null, 2))
  return merged
}

/** Persist the user's embedder choice (used by the tool/CLI). */
export function setRuntimeEmbedder(id: string): void {
  if (!embedderPreset(id)) throw new Error(`unknown embedder preset "${id}"`)
  updateRuntimeConfig({ embedderId: id })
}

export type EmbedderKind = 'hash' | 'api'
export type LlmKind = 'none' | 'api'
/**
 * Index granularity — the two-tier cost switch.
 *  - 'abstract' : embed only title+abstract (+tags) — ~1/50 of full-text cost;
 *                 retrieval runs over this tier; detail cards use the already
 *                 extracted full text directly (no embedding needed).
 *  - 'fulltext' : embed every full-text chunk (large corpus = expensive).
 */
export type IndexLevel = 'abstract' | 'fulltext'

export interface ApiProvider {
  baseURL: string
  apiKey: string
  model: string
}

export interface WaveHyperParams {
  /** Personalized-PageRank-style propagation hops from the seed set. */
  propagationHops: number
  /** Wave decay per hop (damping factor, 0..1). */
  damping: number
  /** Number of precomputed wormhole bridge edges to keep. */
  wormholeTopK: number
  /** Ω channels: semantic baseline, topology innovation, direct anchor. */
  alpha: number
  beta: number
  gamma: number
  /** Bell damper strength: overlap penalty coefficient in greedy selection. */
  bellDamping: number
  /** Final hit count returned to callers. */
  topK: number
}

export interface PluginConfig {
  /**
   * Directory holding `zotero.sqlite` + `storage/`. Empty string selects the
   * built-in sample library (no local Zotero required).
   */
  dataDir: string
  zoteroDbPath?: string
  storageDir?: string
  embedder: EmbedderKind
  embedderApi?: ApiProvider
  llm: LlmKind
  llmApi?: ApiProvider
  /** Embedding granularity (cost switch), see IndexLevel. */
  indexLevel: IndexLevel
  /**
   * Semantic (dense/wave) channel switch (P1-3). When false the engine
   * serves BM25-only results (expansion + sparse). Default true.
   */
  enableSemantic: boolean
  wave: WaveHyperParams
}

/** Offline hash embedder operating point (grid-searched, 96 combos). */
const HASH_TUNED: WaveHyperParams = {
  propagationHops: 1,
  damping: 0.7,
  wormholeTopK: 8,
  alpha: 0.5,
  beta: 0.35,
  gamma: 0.15,
  bellDamping: 0.25,
  topK: 10,
}

/**
 * Per-embedding-model operating points, each grid-searched on the hand-labeled
 * 22-query eval set (maximize NDCG@5, then MRR). The wave terms' optimal
 * balance depends on the embedding space, so the defaults follow the model.
 */
const API_TUNED: Record<string, WaveHyperParams> = {
  'BAAI/bge-m3': {
    propagationHops: 1,
    damping: 0.5,
    wormholeTopK: 8,
    alpha: 0.6,
    beta: 0.25,
    gamma: 0.15,
    bellDamping: 0.2,
    topK: 10,
  },
  'Qwen/Qwen3-VL-Embedding-8B': {
    propagationHops: 2,
    damping: 0.4,
    wormholeTopK: 8,
    alpha: 0.6,
    beta: 0.25,
    gamma: 0.15,
    bellDamping: 0.25,
    topK: 10,
  },
}

/** Generic API-embedder fallback operating point. */
const API_TUNED_FALLBACK: WaveHyperParams = {
  propagationHops: 1,
  damping: 0.5,
  wormholeTopK: 8,
  alpha: 0.6,
  beta: 0.25,
  gamma: 0.15,
  bellDamping: 0.2,
  topK: 10,
}

export const DEFAULT_CONFIG: PluginConfig = {
  dataDir: '',
  embedder: 'hash',
  llm: 'none',
  // Default granularity is fulltext (sample library is tiny); set
  // ZWR_INDEX_LEVEL=abstract for large real libraries to cut embedding cost.
  indexLevel: 'fulltext',
  enableSemantic: true,
  wave: HASH_TUNED,
}

/**
 * Resolve effective config from env overrides (`ZWR_*`). Values are read at
 * tool-execution time so config edits apply without a plugin reload.
 */
export function resolveConfig(overrides: Partial<PluginConfig> = {}): PluginConfig {
  const env = { ...loadLocalEnv(), ...process.env }
  const cfg: PluginConfig = {
    ...DEFAULT_CONFIG,
    ...overrides,
    wave: { ...DEFAULT_CONFIG.wave, ...(overrides.wave ?? {}) },
  }
  if (env.ZWR_DATA_DIR !== undefined) cfg.dataDir = env.ZWR_DATA_DIR
  if (env.ZWR_EMBEDDER === 'api') cfg.embedder = 'api'
  if (env.ZWR_SEMANTIC === '0' || env.ZWR_SEMANTIC === 'false') cfg.enableSemantic = false
  if (env.ZWR_INDEX_LEVEL === 'abstract' || env.ZWR_INDEX_LEVEL === 'fulltext') {
    cfg.indexLevel = env.ZWR_INDEX_LEVEL
  }
  if (env.ZWR_LLM_BASE_URL !== undefined && env.ZWR_LLM_API_KEY !== undefined) {
    cfg.llmApi = {
      baseURL: env.ZWR_LLM_BASE_URL,
      apiKey: env.ZWR_LLM_API_KEY,
      model: env.ZWR_LLM_MODEL ?? 'deepseek-chat',
    }
  }
  // 1. runtime config file — the user's explicit choices win over env
  //    (data source, index level, and embedder all live here so the running
  //    server needs no special startup environment).
  const runtime = readRuntimeConfig()
  if (runtime.dataDir) cfg.dataDir = runtime.dataDir
  if (runtime.indexLevel === 'abstract' || runtime.indexLevel === 'fulltext') {
    cfg.indexLevel = runtime.indexLevel
  }
  const runtimeId = readRuntimeEmbedderId()
  if (runtimeId) {
    const preset = embedderPreset(runtimeId)!
    const resolved = presetToEmbedder(preset, env.ZWR_EMBEDDER_API_KEY, env.ZWR_EMBEDDER_BASE_URL)
    cfg.embedder = resolved.embedder
    if (resolved.embedderApi) cfg.embedderApi = resolved.embedderApi
  }

  // Embedder-aware wave defaults (grid-searched per model); explicit
  // `overrides.wave` or per-key env still wins.
  if (cfg.embedder === 'api' && cfg.embedderApi) {
    const tuned = API_TUNED[cfg.embedderApi.model] ?? API_TUNED_FALLBACK
    cfg.wave = { ...tuned, ...(overrides.wave ?? {}) }
  }
  return cfg
}
