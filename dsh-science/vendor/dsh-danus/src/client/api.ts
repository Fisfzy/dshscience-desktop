/**
 * client/api.ts — Danus Console 的同源 API 封装与 wire 类型。
 *
 * 全部端点由 host half 提供(src/plugins/observability.ts 只读统计 +
 * src/plugins/console-api.ts 操作路由),浏览器端经同源 fetch 访问。
 * 注意:overview / factgraph / channels / channel 由 observability 提供,
 * 项目固定在 host 侧(忽略 ?project=);workers / worker-log / export /
 * gm / fact 路由按 ?project= 寻址。
 */

const BASE = '/danus/api'

// --------------------------------------------------------------------------- //
// wire 类型(与 host half 响应对齐)                                              //
// --------------------------------------------------------------------------- //

export interface Overview {
  project: string
  facts: number
  facts_with_predecessors: number
  facts_by_author: Record<string, number>
  channel_counts: Record<string, number>
  verdicts: Record<string, number>
  updated_at: number
}

export interface FactNode {
  id: string
  author: string
  problem_id: string
  statement: string
  proof: string
  intuition: string
  predecessors: string[]
  depth: number
}

export interface FactGraphData {
  nodes: FactNode[]
  edges: { source: string; target: string }[]
  max_depth: number
}

export interface ChannelInfo {
  kind: string
  role: string
  count: number
}

export interface ChannelEntry {
  id?: string
  timestamp_utc?: string
  author?: string
  kind?: string
  claim?: string
  evidence?: string
  verifiable?: boolean | null
  status?: string
  fact_id?: string
  verdict?: string
  links?: Record<string, unknown>
  glossary?: Record<string, unknown>
  [key: string]: unknown
}

export interface ChannelData {
  kind: string
  count: number
  entries: ChannelEntry[]
}

export interface ProjectInfo {
  project: string
  workers: number
  live: number
  model: string
}

export interface WorkerInfo {
  worker: string
  pid: number | null
  alive: boolean
  state: string
  round: number | null
  age_s: number | null
  last_fact_id: string | null
  label: string
}

export interface WorkerLog {
  worker: string
  round: string | null
  lines: string[]
}

/** 11 种 global-memory 频道(与 host CHANNELS 对齐,含语义角色)。 */
export const CHANNEL_KINDS: ReadonlyArray<readonly [string, string]> = [
  ['conclusion', 'result'], ['example', 'result'], ['counterexample', 'result'],
  ['proof_attempt', 'result'], ['plan', 'judgment'], ['direction', 'judgment'],
  ['obstacle', 'deadend'], ['dead_end', 'deadend'], ['verification', 'verify'],
  ['elaboration', 'strategy'], ['master_guidance', 'strategy'],
]

export function channelRole(kind: string): string {
  return CHANNEL_KINDS.find(([k]) => k === kind)?.[1] ?? 'result'
}

// --------------------------------------------------------------------------- //
// fetch 封装                                                                    //
// --------------------------------------------------------------------------- //

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { accept: 'application/json' },
    ...init,
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // 非 JSON 响应(理论上 API 都是 JSON);按原样忽略。
  }
  if (!res.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail
    throw new ApiError(typeof detail === 'string' ? detail : `HTTP ${res.status}`, res.status)
  }
  return data as T
}

function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
}

const enc = encodeURIComponent

export const api = {
  // ---------- 只读(observability,项目固定于 host 侧)
  overview: () => request<Overview>('/overview'),
  factgraph: () => request<FactGraphData>('/factgraph'),
  channels: () => request<{ channels: ChannelInfo[] }>('/channels'),
  channel: (kind: string) => request<ChannelData>(`/channel/${enc(kind)}`),

  // ---------- 只读(console-api,按项目寻址)
  projects: () => request<{ projects: ProjectInfo[] }>('/workers'),
  workers: (project: string) =>
    request<{ project: string; workers: WorkerInfo[] }>(`/workers?project=${enc(project)}`),
  workerLog: (project: string, worker: string, tail = 200) =>
    request<WorkerLog>(`/worker-log?project=${enc(project)}&worker=${enc(worker)}&tail=${tail}`),
  exportUrl: (project: string, format: 'json' | 'md') =>
    `${BASE}/export?project=${enc(project)}&format=${format}`,

  // ---------- 动作(console-api)
  assign: (project: string, worker: string, task: string) =>
    post<{ ok: boolean }>('/assign', { project, worker, task }),
  startWorker: (target: string) =>
    post<{ ok: boolean; results?: unknown }>('/worker/start', { target }),
  stopWorker: (target: string, force: boolean) =>
    post<{ ok: boolean; results?: unknown }>('/worker/stop', { target, force }),
  gmAdd: (project: string, body: { kind: string; claim: string; evidence: string; verifiable?: boolean }) =>
    post<{ ok: boolean; id: string }>(`/gm/add?project=${enc(project)}`, body),
  gmStatus: (project: string, id: string, status: string, factId?: string) =>
    post<{ ok: boolean }>(`/gm/status?project=${enc(project)}`, factId
      ? { id, status, fact_id: factId }
      : { id, status }),
  revokeFact: (project: string, factId: string, reason: string) =>
    post<{ ok: boolean; revoked: string[] }>(`/fact/revoke?project=${enc(project)}`, {
      fact_id: factId,
      reason,
    }),
}
