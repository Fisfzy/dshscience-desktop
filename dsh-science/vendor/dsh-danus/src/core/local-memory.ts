/**
 * local-memory.ts — worker 私有的松散记忆。移植自 danus/core/local_memory.py。
 *
 * 布局:<worker_dir>/local_memory/<channel>.jsonl。
 * 默认通道 notes(自由想法)+ events(动作日志);对非 events 通道的 append
 * 自动写一条 breadcrumb 到 events。搜索默认排除 events。
 */

import { join } from 'node:path'
import { bm25Scores, tokenize } from './bm25.ts'
import { appendJsonl, pyDumps, readJsonl, utcNow } from './util.ts'

const DEFAULT_CHANNELS = ['notes', 'events']

export interface LmEntry {
  timestamp_utc: string
  channel: string
  record: Record<string, unknown>
}

export class LocalMemory {
  readonly dir: string
  readonly channels: string[]

  constructor(root: string, channels?: string[] | null) {
    this.dir = join(root, 'local_memory')
    this.channels = channels ? [...channels] : [...DEFAULT_CHANNELS]
  }

  private path(channel: string): string {
    return join(this.dir, `${channel}.jsonl`)
  }

  /** record 必须是 JSON object;新通道临时注册;非 events 通道写 breadcrumb。 */
  append(
    channel: string,
    record: Record<string, unknown>,
  ): { status: string; channel: string; path: string; entry: LmEntry } {
    if (typeof record !== 'object' || record === null || Array.isArray(record)) {
      throw new Error('record must be a JSON object')
    }
    if (!this.channels.includes(channel)) this.channels.push(channel)
    const entry: LmEntry = { timestamp_utc: utcNow(), channel, record }
    appendJsonl(this.path(channel), entry as unknown as Record<string, unknown>)
    if (channel !== 'events') {
      appendJsonl(this.path('events'), {
        timestamp_utc: utcNow(),
        event_type: 'local_append',
        channel,
      })
    }
    return { status: 'ok', channel, path: this.path(channel), entry }
  }

  read(channel: string): LmEntry[] {
    return readJsonl(this.path(channel)) as unknown as LmEntry[]
  }

  /** 分桶 BM25;默认通道排除 events;每桶降序、剔零分、截 limitPerChannel。 */
  search(
    query: string,
    channels: string[] | null = null,
    limitPerChannel = 10,
  ): {
    query: string
    channels: string[]
    results_by_channel: Record<string, { count: number; results: { score: number; item: LmEntry }[] }>
  } {
    const searchChannels = channels ?? this.channels.filter((c) => c !== 'events')
    const out: Record<string, { count: number; results: { score: number; item: LmEntry }[] }> = {}
    for (const channel of searchChannels) {
      const items = this.read(channel)
      const docs = items.map((it) => tokenize(pyDumps(it)))
      const scores = bm25Scores(query, docs)
      const order = items.map((_, i) => i).sort((a, b) => scores[b]! - scores[a]!)
      const ranked: { score: number; item: LmEntry }[] = []
      for (const i of order) {
        const s = scores[i]!
        if (s <= 0) break
        ranked.push({ score: s, item: items[i]! })
        if (ranked.length >= limitPerChannel) break
      }
      out[channel] = { count: ranked.length, results: ranked }
    }
    return { query, channels: searchChannels, results_by_channel: out }
  }
}
