/**
 * util.ts — 原子写、归一化、Python 兼容 JSON 序列化、append-only JSONL、UTC 时间戳。
 * 移植自 danus/core/_util.py 与 schema.py 的哈希路径。
 *
 * 关键 parity 约束:canonical/JSONL 文本必须与 CPython
 * `json.dumps(..., ensure_ascii=False)`(默认分隔符 ', ' / ': ')逐字节一致,
 * 否则 fact_id 与原版不互通。
 */

import { createHash } from 'node:crypto'
import {
  appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync,
  readFileSync, renameSync, writeSync,
} from 'node:fs'
import { dirname } from 'node:path'

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** schema.py `_normalize`: `\s+` → 单个空格,去首尾。不折叠大小写、不做 Unicode 归一化。 */
export function normalizeText(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/** 码点比较(Python str 排序语义;JS 默认 UTF-16 码元序对 astral 字符不同)。 */
export function codePointCompare(a: string, b: string): number {
  const ai = Array.from(a)
  const bi = Array.from(b)
  const n = Math.min(ai.length, bi.length)
  for (let i = 0; i < n; i++) {
    const ac = ai[i]!.codePointAt(0)!
    const bc = bi[i]!.codePointAt(0)!
    if (ac !== bc) return ac - bc
  }
  return ai.length - bi.length
}

/** Python sorted(list[str]) 等价(码点序)。 */
export function pySortedStrings(xs: Iterable<string>): string[] {
  return [...xs].sort(codePointCompare)
}

function escapeString(s: string): string {
  // JSON.stringify 的字符串转义与 Python ensure_ascii=False 一致:
  // C0 控制字符 → \u00xx(小写 hex)或短转义;非 ASCII 不转义。
  return JSON.stringify(s)
}

/**
 * Python `json.dumps(v, ensure_ascii=False, sort_keys=?, indent=?)` 等价序列化。
 * - 默认(indent=null):分隔符 ', ' / ': '(CPython 默认,非紧凑)。
 * - indent=2:换行 + 2 空格缩进,键分隔符 ': ',项分隔符 ',' + 换行(CPython 行为);
 *   空对象/数组输出 '{}' / '[]'(CPython 在 indent 模式下同样紧凑空容器)。
 * - sortKeys:对象键按码点排序;否则保持插入序。
 * 数字:经 JSON.stringify(int/float 的 .0 差异在此数据模型中不出现)。
 */
export function pyDumps(v: unknown, opts: { sortKeys?: boolean; indent?: number | null } = {}): string {
  const { sortKeys = false, indent = null } = opts
  const pad = indent === null ? '' : '  '
  const ser = (val: unknown, level: number): string => {
    if (val === null || val === undefined) return 'null'
    if (typeof val === 'boolean') return val ? 'true' : 'false'
    if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'null'
    if (typeof val === 'string') return escapeString(val)
    if (Array.isArray(val)) {
      if (val.length === 0) return '[]'
      if (indent === null) return '[' + val.map((x) => ser(x, level)).join(', ') + ']'
      const inner = val.map((x) => pad.repeat(level + 1) + ser(x, level + 1)).join(',\n')
      return '[\n' + inner + '\n' + pad.repeat(level) + ']'
    }
    if (typeof val === 'object') {
      const obj = val as Record<string, unknown>
      let keys = Object.keys(obj)
      if (sortKeys) keys = keys.sort(codePointCompare)
      if (keys.length === 0) return '{}'
      if (indent === null) {
        return '{' + keys.map((k) => escapeString(k) + ': ' + ser(obj[k], level)).join(', ') + '}'
      }
      const inner = keys
        .map((k) => pad.repeat(level + 1) + escapeString(k) + ': ' + ser(obj[k], level + 1))
        .join(',\n')
      return '{\n' + inner + '\n' + pad.repeat(level) + '}'
    }
    return 'null'
  }
  return ser(v, 0)
}

/** canonical JSON(sort_keys) —— compute_fact_id 的哈希输入。 */
export function canonJson(v: unknown): string {
  return pyDumps(v, { sortKeys: true })
}

/** SHA-256(UTF-8)hex 前 16 位 —— Danus 内容 id 方案。 */
export function contentId16(canon: string): string {
  return createHash('sha256').update(canon, 'utf8').digest('hex').slice(0, 16)
}

/**
 * 原子写:临时文件 → fsync → rename(改进点:原版 write_text 非原子;
 * 字节内容一致,读方永不看到半写文件)。
 */
export function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = path + '.tmp'
  const fd = openSync(tmp, 'w')
  try {
    writeSync(fd, content, undefined, 'utf8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, path)
}

/** _util.utc_now():ISO-8601 带 +00:00 偏移(Python 形态;微秒位由毫秒补齐)。 */
export function utcNow(): string {
  const d = new Date()
  const iso = d.toISOString() // 2024-01-01T12:34:56.123Z
  const ms = iso.slice(20, 23)
  return iso.slice(0, 19) + '.' + ms + '000+00:00'
}

/** _util.append_jsonl:父目录 mkdir -p;追加 pyDumps(payload) + '\n'(ensure_ascii=False)。 */
export function appendJsonl(path: string, payload: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, pyDumps(payload) + '\n', 'utf8')
}

/** _util.iter_jsonl:缺失即空;空行/坏 JSON/非 dict 行跳过。 */
export function* iterJsonl(path: string): Generator<Record<string, unknown>> {
  if (!existsSync(path)) return
  const text = readFileSync(path, 'utf8')
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let payload: unknown
    try {
      payload = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
      yield payload as Record<string, unknown>
    }
  }
}

export function readJsonl(path: string): Record<string, unknown>[] {
  return [...iterJsonl(path)]
}
