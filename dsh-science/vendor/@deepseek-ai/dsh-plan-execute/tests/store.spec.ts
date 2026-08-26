/**
 * Plan/execute settings row store over a scripted wire face: describe
 * adoption, blank-field patch building, save/reset commit and refusal
 * paths.
 */
import { describe, expect, it, vi } from 'vitest'
import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-client-connection/client'
import {
  PLAN_EXECUTE_SETTINGS_NS,
  PlanExecuteSettingsController,
  patchOf,
} from '../src/client/settings-store.ts'
import type { PlanExecuteDraft } from '../src/client/settings-store.ts'

let nextRpc = 0
function ok<T>(value: T) {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: true, value } }
}
function fail(message: string) {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: false, error: { message } } }
}

function view(overrides: Partial<SettingsNamespaceView> & { user?: Record<string, unknown> | undefined } = {}): SettingsNamespaceView {
  return {
    ns: PLAN_EXECUTE_SETTINGS_NS,
    schema: {},
    value: {
      planner: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
      executor: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'off' },
    },
    base: {},
    user: {},
    applies: 'live',
    secrets: [],
    revision: 3,
    ...overrides,
  }
}

interface SettingsWireMocks {
  describe: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  replace: ReturnType<typeof vi.fn>
}

function api(overrides: Partial<SettingsWireMocks> = {}): {
  settings: SettingsWireMocks
  llm: { models: ReturnType<typeof vi.fn> }
} {
  return {
    settings: {
      describe: vi.fn(() => Promise.resolve(ok({ writable: true, hasDocument: true, namespaces: [view()] }))),
      update: vi.fn(() => Promise.resolve(ok(view({ revision: 4 })))),
      replace: vi.fn(() => Promise.resolve(ok(view({ revision: 4 })))),
      ...overrides,
    },
    llm: {
      models: vi.fn(() => Promise.resolve(ok({
        groups: [{
          id: 'deepseek-official',
          name: 'DeepSeek',
          models: [{ id: 'deepseek-v4-pro', name: 'Pro' }],
        }],
        failures: [],
      }))),
    },
  }
}

describe('patchOf', () => {
  it('omits blank fields and trims kept ones', () => {
    const draft: PlanExecuteDraft = {
      planner: { provider: ' mock ', model: '', reasoningEffort: 'high' },
      executor: { provider: '', model: '', reasoningEffort: '' },
    }
    expect(patchOf(draft)).toEqual({ planner: { provider: 'mock', reasoningEffort: 'high' } })
  })

  it('produces an empty patch for a fully blank draft', () => {
    expect(patchOf({ planner: { provider: '', model: '', reasoningEffort: '' }, executor: { provider: '', model: '', reasoningEffort: '' } }))
      .toEqual({})
  })
})

describe('PlanExecuteSettingsController', () => {
  it('adopts the plan-execute namespace from describe and loads the model catalog', async () => {
    const wire = api()
    const controller = new PlanExecuteSettingsController(wire as unknown as Pick<IApiClient, 'settings' | 'llm'>)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.revision).toBe(3)
    expect(state.writable).toBe(true)
    expect(state.groups).toHaveLength(1)
    expect(wire.llm.models).toHaveBeenCalledTimes(1)
    // The draft is the USER layer (empty here); the resolved values surface
    // as placeholders.
    expect(state.draft.planner.model).toBe('')
    expect(state.resolved.planner.model).toBe('deepseek-v4-pro')
    expect(state.resolved.executor.reasoningEffort).toBe('off')
  })

  it('seeds the draft from the user layer only', async () => {
    const controller = new PlanExecuteSettingsController(api({
      describe: vi.fn(() => Promise.resolve(ok({
        writable: true,
        hasDocument: true,
        namespaces: [view({ user: { planner: { model: 'planner-from-user' } } })],
      }))),
    }) as unknown as Pick<IApiClient, 'settings' | 'llm'>)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.draft.planner.model).toBe('planner-from-user')
    expect(state.draft.planner.provider).toBe('')
    expect(state.resolved.planner.provider).toBe('deepseek-official')
  })

  it('treats an absent user layer as an empty draft', async () => {
    const controller = new PlanExecuteSettingsController(api({
      describe: vi.fn(() => Promise.resolve(ok({
        writable: true,
        hasDocument: true,
        namespaces: [view({ user: undefined })],
      }))),
    }) as unknown as Pick<IApiClient, 'settings' | 'llm'>)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.draft.planner.provider).toBe('')
    expect(state.resolved.planner.provider).toBe('deepseek-official')
  })

  it('reports a missing namespace as not composed', async () => {
    const controller = new PlanExecuteSettingsController(api({
      describe: vi.fn(() => Promise.resolve(ok({ writable: true, hasDocument: true, namespaces: [] }))),
    }) as unknown as Pick<IApiClient, 'settings' | 'llm'>)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.writable).toBe(false)
    expect(state.draft.planner.model).toBe('')
  })

  it('keeps the last good snapshot and reports describe failures', async () => {
    const controller = new PlanExecuteSettingsController(api({
      describe: vi.fn(() => Promise.resolve(fail('transport down'))),
    }) as unknown as Pick<IApiClient, 'settings' | 'llm'>)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toContain('transport down')
  })

  it('commits a save through settings.update with the held revision and adopts the reply', async () => {
    const wire = api()
    const controller = new PlanExecuteSettingsController(wire as unknown as Pick<IApiClient, 'settings' | 'llm'>)
    await controller.load()
    const committed = await controller.save({
      planner: { provider: 'mock', model: 'planner-model', reasoningEffort: 'high' },
      executor: { provider: '', model: '', reasoningEffort: '' },
    })
    expect(committed).toBe(true)
    const { update } = wire.settings
    expect(update).toHaveBeenCalledWith({
      ns: PLAN_EXECUTE_SETTINGS_NS,
      patch: { planner: { provider: 'mock', model: 'planner-model', reasoningEffort: 'high' } },
      expectedRevision: 3,
    })
    expect(controller.store.getSnapshot().revision).toBe(4)
    expect(controller.store.getSnapshot().saved).toBe(true)
  })

  it('keeps the previous snapshot and reports a refused save', async () => {
    const wire = api({
      update: vi.fn(() => Promise.resolve(fail('blank model field'))),
    })
    const controller = new PlanExecuteSettingsController(wire as unknown as Pick<IApiClient, 'settings' | 'llm'>)
    await controller.load()
    const committed = await controller.save({
      planner: { provider: '', model: 'planner-model', reasoningEffort: '' },
      executor: { provider: '', model: '', reasoningEffort: '' },
    })
    expect(committed).toBe(false)
    const state = controller.store.getSnapshot()
    expect(state.revision).toBe(3)
    expect(state.saveError).toContain('blank model field')
    expect(state.saved).toBe(false)
  })

  it('reports a non-Error load failure verbatim', async () => {
    const controller = new PlanExecuteSettingsController(api({
      describe: vi.fn(() => Promise.reject(new Error('boom'))),
    }) as unknown as Pick<IApiClient, 'settings' | 'llm'>)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('boom')
  })

  it('drops a stale load failure and a stale load success', async () => {
    const resolveLoads: Array<(value: unknown) => void> = []
    const wire = api({
      describe: vi.fn(() => new Promise((resolve) => { resolveLoads.push(resolve) })),
    })
    const controller = new PlanExecuteSettingsController(wire as unknown as Pick<IApiClient, 'settings' | 'llm'>)
    const staleLoad = controller.load()
    const freshLoad = controller.load()
    // The fresh load settles first and wins...
    resolveLoads[1]!(ok({ writable: true, hasDocument: true, namespaces: [view({ revision: 9 })] }))
    await freshLoad
    // ...then the stale failure and the stale success both land and are dropped.
    resolveLoads[0]!(Promise.reject(new Error('stale failure')))
    await staleLoad
    expect(controller.store.getSnapshot().revision).toBe(9)
    expect(controller.store.getSnapshot().status).toBe('ready')
    const staleSuccess = controller.load()
    const newestLoad = controller.load()
    resolveLoads[3]!(ok({ writable: true, hasDocument: true, namespaces: [view({ revision: 13 })] }))
    await newestLoad
    resolveLoads[2]!(ok({ writable: true, hasDocument: true, namespaces: [view({ revision: 12 })] }))
    await staleSuccess
    expect(controller.store.getSnapshot().revision).toBe(13)
  })

  it('drops a stale save failure and a stale reset failure', async () => {
    let rejectSave: ((value: unknown) => void) | undefined
    let rejectReset: ((value: unknown) => void) | undefined
    const resolveLoads: Array<(value: unknown) => void> = []
    const wire = api({
      describe: vi.fn(() => new Promise((resolve) => { resolveLoads.push(resolve) })),
      update: vi.fn(() => new Promise((_resolve, reject) => { rejectSave = reject })),
      replace: vi.fn(() => new Promise((_resolve, reject) => { rejectReset = reject })),
    })
    const controller = new PlanExecuteSettingsController(wire as unknown as Pick<IApiClient, 'settings' | 'llm'>)
    const firstLoad = controller.load()
    resolveLoads[0]!(ok({ writable: true, hasDocument: true, namespaces: [view()] }))
    await firstLoad
    const save = controller.save({
      planner: { provider: 'mock', model: '', reasoningEffort: '' },
      executor: { provider: '', model: '', reasoningEffort: '' },
    })
    const loadAfterSave = controller.load()
    resolveLoads[1]!(ok({ writable: true, hasDocument: true, namespaces: [view({ revision: 9 })] }))
    await loadAfterSave
    rejectSave!(new Error('stale save failure'))
    await expect(save).resolves.toBe(false)
    expect(controller.store.getSnapshot().revision).toBe(9)

    const reset = controller.reset()
    const loadAfterReset = controller.load()
    resolveLoads[2]!(ok({ writable: true, hasDocument: true, namespaces: [view({ revision: 11 })] }))
    await loadAfterReset
    rejectReset!(new Error('stale reset failure'))
    await expect(reset).resolves.toBe(false)
    expect(controller.store.getSnapshot().revision).toBe(11)
  })

  it('reports a non-Error reset failure verbatim', async () => {
    const wire = api({
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the test asserts a non-Error rejection is reported verbatim
      replace: vi.fn(() => new Promise((_resolve, reject) => { reject('plain string') })),
    })
    const controller = new PlanExecuteSettingsController(wire as unknown as Pick<IApiClient, 'settings' | 'llm'>)
    await controller.load()
    const committed = await controller.reset()
    expect(committed).toBe(false)
    expect(controller.store.getSnapshot().saveError).toBe('plain string')
  })

  it('resolves missing phase sections to empty drafts', async () => {
    const controller = new PlanExecuteSettingsController(api({
      describe: vi.fn(() => Promise.resolve(ok({
        writable: true,
        hasDocument: true,
        namespaces: [view({ value: {} })],
      }))),
    }) as unknown as Pick<IApiClient, 'settings' | 'llm'>)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.draft.planner.provider).toBe('')
    expect(state.resolved.executor.reasoningEffort).toBe('')
  })

  it('drops a stale save when a newer load supersedes it', async () => {
    let resolveSave: ((value: unknown) => void) | undefined
    const resolveLoads: Array<(value: unknown) => void> = []
    const wire = api({
      describe: vi.fn(() => new Promise((resolve) => { resolveLoads.push(resolve) })),
      update: vi.fn(() => new Promise((resolve) => { resolveSave = resolve })),
    })
    const controller = new PlanExecuteSettingsController(wire as unknown as Pick<IApiClient, 'settings' | 'llm'>)
    const firstLoad = controller.load()
    resolveLoads[0]!(ok({ writable: true, hasDocument: true, namespaces: [view()] }))
    await firstLoad
    const save = controller.save({
      planner: { provider: 'mock', model: 'planner-model', reasoningEffort: '' },
      executor: { provider: '', model: '', reasoningEffort: '' },
    })
    const secondLoad = controller.load()
    resolveLoads[1]!(ok({ writable: true, hasDocument: true, namespaces: [view({ revision: 9 })] }))
    await secondLoad
    expect(controller.store.getSnapshot().revision).toBe(9)
    resolveSave!(ok(view({ revision: 10 })))
    await expect(save).resolves.toBe(false)
    // The stale save never overwrote the newer snapshot.
    expect(controller.store.getSnapshot().revision).toBe(9)
  })

  it('drops a stale reset when a newer load supersedes it', async () => {
    let resolveReset: ((value: unknown) => void) | undefined
    const resolveLoads: Array<(value: unknown) => void> = []
    const wire = api({
      describe: vi.fn(() => new Promise((resolve) => { resolveLoads.push(resolve) })),
      replace: vi.fn(() => new Promise((resolve) => { resolveReset = resolve })),
    })
    const controller = new PlanExecuteSettingsController(wire as unknown as Pick<IApiClient, 'settings' | 'llm'>)
    const firstLoad = controller.load()
    resolveLoads[0]!(ok({ writable: true, hasDocument: true, namespaces: [view()] }))
    await firstLoad
    const reset = controller.reset()
    const secondLoad = controller.load()
    resolveLoads[1]!(ok({ writable: true, hasDocument: true, namespaces: [view({ revision: 9 })] }))
    await secondLoad
    resolveReset!(ok(view({ revision: 10 })))
    await expect(reset).resolves.toBe(false)
    expect(controller.store.getSnapshot().revision).toBe(9)
  })

  it('reports a non-Error save failure verbatim', async () => {
    const wire = api({
      update: vi.fn(() => Promise.reject(new Error('boom'))),
    })
    const controller = new PlanExecuteSettingsController(wire as unknown as Pick<IApiClient, 'settings' | 'llm'>)
    await controller.load()
    const committed = await controller.save({
      planner: { provider: 'mock', model: '', reasoningEffort: '' },
      executor: { provider: '', model: '', reasoningEffort: '' },
    })
    expect(committed).toBe(false)
    expect(controller.store.getSnapshot().saveError).toBe('boom')
    // A non-Error rejection is still reported verbatim.
    const stringWire = api({
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the test asserts a non-Error rejection is reported verbatim
      update: vi.fn(() => new Promise((_resolve, reject) => { reject('plain string') })),
    })
    const stringController = new PlanExecuteSettingsController(stringWire as unknown as Pick<IApiClient, 'settings' | 'llm'>)
    await stringController.load()
    await stringController.save({
      planner: { provider: 'mock', model: '', reasoningEffort: '' },
      executor: { provider: '', model: '', reasoningEffort: '' },
    })
    expect(stringController.store.getSnapshot().saveError).toBe('plain string')
  })

  it('clears the user section through settings.replace on reset', async () => {
    const wire = api()
    const controller = new PlanExecuteSettingsController(wire as unknown as Pick<IApiClient, 'settings' | 'llm'>)
    await controller.load()
    const committed = await controller.reset()
    expect(committed).toBe(true)
    const { replace } = wire.settings
    expect(replace).toHaveBeenCalledWith({
      ns: PLAN_EXECUTE_SETTINGS_NS,
      section: {},
      expectedRevision: 3,
    })
  })
})
