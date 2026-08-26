/**
 * plugins/verify-service.ts — 把 DanusVerify 挂为 cordis 服务(ctx.danusVerify)。
 * 单独成行以便部署替换(如换成远程 verify 后端)。
 */

import type { Context } from 'cordis'
import Schema from 'schemastery'
import { DanusVerify } from '../services/verify.ts'

export const name = 'danus-verify-service'

export interface Config {
  profile?: string
  stateDir?: string
  agentHome?: string
  resultsRoot?: string
  timeoutSeconds?: number
}

export const Config: Schema<Config> = Schema.object({
  profile: Schema.string(),
  stateDir: Schema.string(),
  agentHome: Schema.string(),
  resultsRoot: Schema.string(),
  timeoutSeconds: Schema.number(),
})

export function apply(ctx: Context, config: Config): void {
  const service = new DanusVerify({
    profile: config.profile,
    stateDir: config.stateDir,
    agentHome: config.agentHome,
    resultsRoot: config.resultsRoot,
    timeoutSeconds: config.timeoutSeconds,
  })
  ctx.provide('danusVerify', service)
}
