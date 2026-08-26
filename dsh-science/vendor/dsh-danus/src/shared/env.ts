/** shared/env.ts — 调用时读取的环境变量辅助(parity:原版 call-time env 契约)。 */

export function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isNaN(n) ? fallback : n
}

export function envStr(name: string, fallback = ''): string {
  const v = process.env[name]
  return v === undefined ? fallback : v
}

/** 取第一个非空 env(按顺序)。 */
export function envFirst(names: string[], fallback = ''): string {
  for (const n of names) {
    const v = process.env[n]
    if (v) return v
  }
  return fallback
}
