// @vitest-environment jsdom
/**
 * PlanExecuteRow over a scripted wire face: the row stays closed without
 * fetching, opens to load settings + catalog, picks models from the catalog,
 * commits through the controller, and reports refused saves.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ModelProviderGroup, SettingsNamespaceView } from '@deepseek-ai/dsh-client-connection/client'
import { encodeRoute } from '../src/client/catalog.ts'
import { PlanExecuteRow } from '../src/client/PlanExecuteRow.tsx'
import type { PlanExecuteRowComponentProps, PlanExecuteRowInjected } from '../src/client/PlanExecuteRow.tsx'
import { PLAN_EXECUTE_SETTINGS_NS, PlanExecuteSettingsController } from '../src/client/settings-store.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: PlanExecuteRowComponentProps['t'] = makeTranslate(zh as unknown as Record<string, string>, commonZh)

const CATALOG: ModelProviderGroup[] = [
  {
    id: 'deepseek-official',
    name: 'DeepSeek',
    models: [
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek-V4-Pro',
        reasoning: {
          defaultEffort: 'high',
          efforts: [
            { id: 'high', name: 'High' },
            { id: 'max', name: 'Max' },
          ],
        },
      },
      {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek-V4-Flash',
        reasoning: {
          defaultEffort: 'off',
          efforts: [
            { id: 'off', name: 'Off' },
            { id: 'high', name: 'High' },
          ],
        },
      },
    ],
  },
]

function view(overrides: Partial<SettingsNamespaceView> & { user?: Record<string, unknown> } = {}): SettingsNamespaceView {
  return {
    ns: PLAN_EXECUTE_SETTINGS_NS,
    schema: {},
    value: {
      planner: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
      executor: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'off' },
    },
    base: {},
    user: overrides.user ?? {},
    applies: 'live',
    secrets: [],
    revision: 1,
    ...overrides,
  }
}

function ok<T>(value: T) {
  return { rpcId: 'r' as never, result: { ok: true, value } }
}
function fail(message: string) {
  return { rpcId: 'r' as never, result: { ok: false, error: { message } } }
}

async function setup(overrides: {
  describe?: ReturnType<typeof vi.fn>
  update?: ReturnType<typeof vi.fn>
  replace?: ReturnType<typeof vi.fn>
  models?: ReturnType<typeof vi.fn>
} = {}) {
  const describe = overrides.describe ?? vi.fn(() => Promise.resolve(ok({
    writable: true,
    hasDocument: true,
    namespaces: [view()],
  })))
  const update = overrides.update ?? vi.fn(() => Promise.resolve(ok(view({ revision: 2 }))))
  const replace = overrides.replace ?? vi.fn(() => Promise.resolve(ok(view({ revision: 2 }))))
  const models = overrides.models ?? vi.fn(() => Promise.resolve(ok({ groups: CATALOG, failures: [] })))
  const controller = new PlanExecuteSettingsController({
    settings: { describe, update, replace },
    llm: { models },
  } as never)
  const useSnapshot = bindSnapshotSelector(controller.store)
  const injected: PlanExecuteRowInjected = { controller, useSnapshot }
  const props = { t, ...injected } as unknown as PlanExecuteRowComponentProps
  render(<PlanExecuteRow {...props} />)
  return { controller, describe, update, replace, models }
}

const expander = () => screen.getByRole('button', { name: '规划/执行模型' })
const modelSelects = () => screen.getAllByLabelText<HTMLSelectElement>('模型')
const effortSelects = () => screen.getAllByLabelText<HTMLSelectElement>('思考档位')

describe('PlanExecuteRow', () => {
  it('stays closed without fetching and opens to load settings and catalog', async () => {
    const { describe, models } = await setup()
    expect(describe).not.toHaveBeenCalled()
    expect(models).not.toHaveBeenCalled()
    fireEvent.click(expander())
    await waitFor(() => { expect(describe).toHaveBeenCalledTimes(1) })
    expect(models).toHaveBeenCalledTimes(1)
    // User layer empty: selects stay on inherit; resolved defaults appear in the option label.
    expect(modelSelects()[0]?.value).toBe('')
    const plannerInherit = within(modelSelects()[0]!).getByRole('option', { name: /使用默认配置/ })
    const executorInherit = within(modelSelects()[1]!).getByRole('option', { name: /使用默认配置/ })
    expect(plannerInherit.textContent).toContain('deepseek-v4-pro')
    expect(executorInherit.textContent).toContain('deepseek-v4-flash')
  })

  it('lists catalog models and fills provider/model/default effort on pick', async () => {
    const { update } = await setup()
    fireEvent.click(expander())
    await waitFor(() => { expect(modelSelects()).toHaveLength(2) })
    fireEvent.change(modelSelects()[0]!, {
      target: { value: encodeRoute('deepseek-official', 'deepseek-v4-pro') },
    })
    expect(modelSelects()[0]?.value).toBe(encodeRoute('deepseek-official', 'deepseek-v4-pro'))
    // Default effort from catalog lands automatically.
    expect(effortSelects()[0]?.value).toBe('high')
    // Effort options follow the chosen model.
    expect(within(effortSelects()[0]!).getByRole('option', { name: /Max/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await waitFor(() => { expect(update).toHaveBeenCalledTimes(1) })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      ns: PLAN_EXECUTE_SETTINGS_NS,
      patch: {
        planner: {
          provider: 'deepseek-official',
          model: 'deepseek-v4-pro',
          reasoningEffort: 'high',
        },
      },
      expectedRevision: 1,
    }))
  })

  it('pre-fills the draft from the user layer when fields are overridden', async () => {
    await setup({
      describe: vi.fn(() => Promise.resolve(ok({
        writable: true,
        hasDocument: true,
        namespaces: [view({
          user: {
            planner: {
              provider: 'deepseek-official',
              model: 'deepseek-v4-flash',
              reasoningEffort: 'off',
            },
          },
        })],
      }))),
    })
    fireEvent.click(expander())
    await waitFor(() => {
      expect(modelSelects()[0]?.value).toBe(encodeRoute('deepseek-official', 'deepseek-v4-flash'))
    })
    expect(effortSelects()[0]?.value).toBe('off')
  })

  it('closes the panel after a committed save', async () => {
    await setup()
    fireEvent.click(expander())
    await waitFor(() => { expect(modelSelects()).toHaveLength(2) })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await waitFor(() => { expect(screen.queryByLabelText('模型')).toBeNull() })
  })

  it('keeps the panel open and shows the failure on a refused save', async () => {
    const update = vi.fn(() => Promise.resolve(fail('blank model field')))
    await setup({ update })
    fireEvent.click(expander())
    await waitFor(() => { expect(modelSelects()).toHaveLength(2) })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await waitFor(() => { expect(screen.getByText('保存失败，已保留原配置')).toBeTruthy() })
    expect(modelSelects()[0]).toBeTruthy()
  })

  it('keeps the panel open and shows the failure on a refused reset', async () => {
    const replace = vi.fn(() => Promise.resolve(fail('read-only document')))
    await setup({ replace })
    fireEvent.click(expander())
    await waitFor(() => { expect(modelSelects()).toHaveLength(2) })
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }))
    await waitFor(() => { expect(screen.getByText('保存失败，已保留原配置')).toBeTruthy() })
    expect(modelSelects()[0]).toBeTruthy()
  })

  it('shows the load failure inside the opened panel', async () => {
    await setup({
      describe: vi.fn(() => Promise.resolve(fail('transport down'))),
    })
    fireEvent.click(expander())
    await waitFor(() => { expect(screen.getByText(/设置加载失败/)).toBeTruthy() })
    expect(screen.getByRole('button', { name: '应用' }).hasAttribute('disabled')).toBe(true)
  })

  it('clears the user section through settings.replace on reset', async () => {
    const { replace } = await setup()
    fireEvent.click(expander())
    await waitFor(() => { expect(modelSelects()).toHaveLength(2) })
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }))
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(expect.objectContaining({
        ns: PLAN_EXECUTE_SETTINGS_NS,
        section: {},
      }))
    })
  })

  it('renders the unavailable state when the namespace is missing', async () => {
    await setup({
      describe: vi.fn(() => Promise.resolve(ok({ writable: true, hasDocument: true, namespaces: [] }))),
    })
    fireEvent.click(expander())
    await screen.findByText('未装配 dsh-plan-execute')
    expect(screen.getByRole('button', { name: '应用' }).hasAttribute('disabled')).toBe(true)
  })
})
