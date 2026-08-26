/**
 * ui-plan-execute browser half on a real SlotsService: the plugin registers
 * the General-section plan/execute model settings row once the
 * `settings.general.item` declaration is on the ledger, wires its controller
 * to the connection's settings wire, and removes the row on teardown
 * (HMR safety).
 */
import { Context } from 'cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotsService } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleService } from '@deepseek-ai/dsh-client-locale/client'
import { PlanExecuteRow } from '../src/client/PlanExecuteRow.tsx'
import type { PlanExecuteRowInjected } from '../src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotsService).await()
  const slots = ctx.get('slots') as SlotsService
  slots.register({
    name: 'root',
    children: { 'settings.general.item': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  ctx.provide('connection', {
    api: {
      settings: {
        describe: vi.fn(() => Promise.resolve({ rpcId: 'r', result: { ok: true, value: { writable: true, hasDocument: true, namespaces: [] } } })),
        update: vi.fn(),
        replace: vi.fn(),
      },
      llm: {
        models: vi.fn(() => Promise.resolve({ rpcId: 'r', result: { ok: true, value: { groups: [], failures: [] } } })),
      },
    },
  })
  ctx.provide('locale', new LocaleService(ctx))
  return { ctx, slots }
}

describe('ui-plan-execute browser apply', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('registers the settings row once the General item slot is declared', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('settings.general.item')[0]!
    expect(entry.component).toBe(PlanExecuteRow)
    expect(entry.options.id).toBe('plan-execute-models')
    const injected = (entry.inject as unknown as () => PlanExecuteRowInjected)()
    expect(injected.controller.store.getSnapshot().status).toBe('idle')
  })

  it('refreshes an opened row on pushed settings invalidations', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const injected = (b.slots.entries('settings.general.item')[0]!.inject as unknown as () => PlanExecuteRowInjected)()
    await injected.controller.load()
    expect(injected.controller.store.getSnapshot().status).toBe('ready')
    const describe = (b.ctx.get('connection') as unknown as { api: { settings: { describe: ReturnType<typeof vi.fn> } } }).api.settings.describe
    expect(describe).toHaveBeenCalledTimes(1)
    ;(b.ctx.events as unknown as { emit: (...args: unknown[]) => void })
      .emit('settings/changed', 'any-ns', {}, {}, 'provider')
    await vi.waitFor(() => { expect(describe).toHaveBeenCalledTimes(2) })
  })

  it('does not refresh a row that never loaded', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const describe = (b.ctx.get('connection') as unknown as { api: { settings: { describe: ReturnType<typeof vi.fn> } } }).api.settings.describe
    ;(b.ctx.events as unknown as { emit: (...args: unknown[]) => void })
      .emit('settings/changed', 'any-ns', {}, {}, 'provider')
    await Promise.resolve()
    expect(describe).not.toHaveBeenCalled()
  })

  it('removes the row when the plugin fiber is disposed', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.general.item')).toHaveLength(1)
    await fiber.dispose()
    expect(b.slots.entries('settings.general.item')).toHaveLength(0)
  })
})
