/**
 * plugins/swarm-service.ts — 把 DanusSwarm 挂为 cordis 服务(ctx.danusSwarm)。
 */

import type { Context } from 'cordis'
import Schema from 'schemastery'
import { DanusSwarm } from '../services/swarm.ts'

export const name = 'danus-swarm-service'

export interface Config {}

export const Config: Schema<Config> = Schema.object({})

export function apply(ctx: Context): void {
  ctx.provide('danusSwarm', new DanusSwarm())
}
