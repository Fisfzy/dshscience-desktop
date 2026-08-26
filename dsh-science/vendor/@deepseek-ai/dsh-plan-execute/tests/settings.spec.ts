import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import type { Plugin } from 'cordis'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import PlanModeService from '@deepseek-ai/dsh-plan-mode'
import { SettingsLocal } from '@deepseek-ai/dsh-settings-local'
import { apply, SETTINGS_NS } from '../src/index.ts'
import type { Config } from '../src/index.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function home(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'dsh-plan-execute-settings-'))
  return root
}

const SEED: LlmCallConfig = { provider: 'agent-route', model: 'agent-model' }

/** Boot the REAL plugin beside a real file-backed settings provider. */
async function setupWithSettings(config: Config = {}): Promise<{
  ctx: Context
  agent: Agent & { session: Session }
  requestConfig: () => Promise<LlmCallConfig>
}> {
  const dir = await home()
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(PlanModeService, { section: 'Test plan mode instructions.' })
  await ctx.plugin(SettingsLocal, { path: join(dir, 'settings.yaml'), watch: false })
  await ctx.plugin({ name: apply.name, apply } as Plugin<Config>, config)
  const session = Session.create(SessionId('settings-routing'))
  const agent = {
    id: SessionId('settings-routing'),
    session,
    options: {},
    inject(message: ReturnType<typeof createUserMessage>) {
      session.append('user/message', message, { surfaceOp: 'append' })
    },
  } as unknown as Agent & { session: Session }
  let scoped!: Context
  await ctx.plugin(Object.assign((inner: Context) => { scoped = createScope(inner, agent).ctx }, {
    inject: ['tools'],
  }))
  ;(agent as { ctx?: Context }).ctx = scoped
  ctx.emit('agent/created', { agent })
  const events = agentEvents(ctx, agent)
  const requestConfig = (): Promise<LlmCallConfig> => events.waterfall(
    'agent/request',
    { turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve(SEED),
  )
  return { ctx, agent, requestConfig }
}

describe('settings-driven routing', () => {
  it('starts from the composition entry and hot-swaps on a committed settings update', async () => {
    const { ctx, agent, requestConfig } = await setupWithSettings()
    // No user document: the executor default routes the first request.
    expect(await requestConfig()).toMatchObject({ model: 'deepseek-v4-flash' })

    await ctx.settings.update(SETTINGS_NS, {
      planner: { provider: 'mock', model: 'planner-from-settings' },
    })
    agent.session.append('plan/mode', { active: true })
    // The committed update re-resolves the routing before this request.
    expect(await requestConfig()).toEqual({
      ...SEED,
      provider: 'mock',
      model: 'planner-from-settings',
      reasoningEffort: ReasoningEffortId('high'),
    })

    // The executor phase still serves the untouched default.
    agent.session.append('plan/mode', { active: false })
    expect(await requestConfig()).toMatchObject({ model: 'deepseek-v4-flash' })
  })

  it('rejects a section the routing cannot serve and keeps the previous routing', async () => {
    const { ctx, agent, requestConfig } = await setupWithSettings({
      planner: { provider: 'mock', model: 'entry-planner' },
    })
    agent.session.append('plan/mode', { active: true })
    expect(await requestConfig()).toMatchObject({ model: 'entry-planner' })

    await expect(ctx.settings.update(SETTINGS_NS, {
      planner: { model: '   ' },
    })).rejects.toThrow(/non-empty string/)
    // The refused write left the routing on the composition entry.
    expect(await requestConfig()).toMatchObject({ model: 'entry-planner' })
  })
})
