/**
 * Browser half of `@deepseek-ai/dsh-plan-execute` (dual-face). Registers the
 * General-section preference row that edits this package's `plan-execute`
 * settings namespace: planner and executor model routing, applied through the
 * settings wire. The host half stays the single fact source — the row
 * re-renders from the next describe, pushed or refetched.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
// Type-only: pulls the locale plugin's Context merge and the
// 'settings.general.item' slot declaration (locale owns that type home).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { PlanExecuteRow } from './PlanExecuteRow.tsx'
import type { PlanExecuteRowInjected } from './PlanExecuteRow.tsx'
import { PlanExecuteSettingsController } from './settings-store.ts'
import { en, zh, type PlanExecuteKey } from './locales.ts'

export type { PlanExecuteRowInjected, PlanExecuteRowComponentProps } from './PlanExecuteRow.tsx'
export type {
  PhaseDraft,
  PlanExecuteDraft,
  PlanExecuteRowState,
  PlanExecuteSettingsController,
} from './settings-store.ts'
export type { PlanExecuteKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The plan/execute model settings row copy. */
    'settings.plan-execute': keyof PlanExecuteKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.plan-execute'

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings-general's General entry, whose activation order relative to
 * this one is NOT constrained; registration depends on it through
 * `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection']

/**
 * Register the plan/execute settings row once the `settings.general.item`
 * declaration is on the ledger and wire its store to the connection. The row
 * loads lazily — a closed row never fetches; pushed invalidations refresh it
 * only after its first load.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-plan-execute: copy dictionaries')
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const controller = new PlanExecuteSettingsController(connection.api)
  const useSnapshot = bindSnapshotSelector(controller.store)
  const injected = (): PlanExecuteRowInjected => ({ controller, useSnapshot })

  // Pushed invalidations converge an opened row without polling: any settings
  // change or connection reset refetches once the row loaded.
  ctx.effect(() => {
    const refresh = (): (void) => {
      if (controller.store.getSnapshot().status !== 'idle') void controller.load()
    }
    const disposers = [
      ctx.on('settings/changed', refresh),
      ctx.on('connection/reset', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-plan-execute: pushed invalidations')

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'plan-execute-models',
    order: 25,
    locale: NS,
    inject: injected,
  }, PlanExecuteRow))
}
