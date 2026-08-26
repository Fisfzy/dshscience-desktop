import { describe, expect, it } from 'vitest'
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
import {
  DEFAULT_EXECUTOR,
  DEFAULT_PLANNER,
  Config as ConfigSchema,
  apply,
  phaseFor,
  proposePhaseModel,
  resolveConfig,
  type Config,
  type ResolvedConfig,
} from '../src/index.ts'

/** The default seed a loop would propose before any listener rewrites it. */
const SEED: LlmCallConfig = { provider: 'agent-route', model: 'agent-model' }

describe('resolveConfig', () => {
  it('completes both phases from the defaults when nothing is configured', () => {
    const routing = resolveConfig({})
    expect(routing.planner).toEqual(DEFAULT_PLANNER)
    expect(routing.executor).toEqual(DEFAULT_EXECUTOR)
  })

  it('merges configured fields over the defaults', () => {
    const routing = resolveConfig({
      planner: { model: 'planner-model' },
      executor: { provider: 'mock', reasoningEffort: 'low' },
    })
    expect(routing.planner).toEqual({ ...DEFAULT_PLANNER, model: 'planner-model' })
    expect(routing.executor).toEqual({
      provider: 'mock',
      model: 'deepseek-v4-flash',
      reasoningEffort: ReasoningEffortId('low'),
    })
  })

  it('brands the configured reasoning effort', () => {
    const routing = resolveConfig({ planner: { reasoningEffort: 'max' } })
    expect(routing.planner.reasoningEffort).toBe(ReasoningEffortId('max'))
  })

  it('rejects unknown keys', () => {
    expect(() => resolveConfig({ planner: {}, executor: {}, extra: {} } as Config)).toThrow(
      /unknown key\(s\) extra/,
    )
  })

  it('rejects blank configured fields', () => {
    expect(() => resolveConfig({ planner: { model: '  ' } })).toThrow(/non-empty string/)
    expect(() => resolveConfig({ executor: { reasoningEffort: '' } })).toThrow(/non-empty string/)
  })
})

describe('proposePhaseModel', () => {
  it('replaces only the fields the phase sets', () => {
    const phase = { provider: 'mock', model: 'planner-model', reasoningEffort: ReasoningEffortId('high') }
    const proposal = proposePhaseModel({ ...SEED, temperature: 0.5 }, phase)
    expect(proposal).toEqual({ ...SEED, temperature: 0.5, ...phase })
  })

  it('leaves the request untouched when the phase sets nothing', () => {
    const proposal = proposePhaseModel({ ...SEED, maxTokens: 100 }, {})
    expect(proposal).toEqual({ ...SEED, maxTokens: 100 })
  })
})

describe('phaseFor', () => {
  it('selects the planner while plan mode is active and the executor otherwise', () => {
    const routing: ResolvedConfig = {
      planner: { model: 'planner-model' },
      executor: { model: 'executor-model' },
    }
    const session = Session.create(SessionId('phase-test'))
    expect(phaseFor(session, routing)).toEqual(routing.executor)
    session.append('plan/mode', { active: true })
    expect(phaseFor(session, routing)).toEqual(routing.planner)
    session.append('plan/mode', { active: false })
    expect(phaseFor(session, routing)).toEqual(routing.executor)
  })
})

/**
 * Mount the REAL plugin beside real `SystemPrompt`, `ToolRegistry`, and
 * `PlanModeService`, with a fake Agent carrying a real `Session` and a real
 * scoped `agent.ctx` minted through `createScope`. Requests are dispatched
 * through the real `agent/request` waterfall, exactly as the loop does.
 */
async function setupWithPlugin(config: Config = {}): Promise<{
  ctx: Context
  agent: Agent & { session: Session }
  dispose: () => Promise<void>
}> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(PlanModeService, { section: 'Test plan mode instructions.' })
  const fiber = await ctx.plugin({ name: apply.name, apply, Config: ConfigSchema } as Plugin<Config>, config)
  const session = Session.create(SessionId('routing-test'))
  const agent = {
    id: SessionId('routing-test'),
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
  return { ctx, agent, dispose: () => fiber.dispose() }
}

/** Dispatch one `agent/request` waterfall, as the loop does for one step. */
async function requestConfig(ctx: Context, agent: Agent & { session: Session }): Promise<LlmCallConfig> {
  const events = agentEvents(ctx, agent)
  return events.waterfall(
    'agent/request',
    { turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve(SEED),
  )
}

describe('apply', () => {
  it('routes requests to the executor by default and the planner in plan mode', async () => {
    const { ctx, agent } = await setupWithPlugin()
    expect(await requestConfig(ctx, agent)).toEqual({ ...SEED, ...DEFAULT_EXECUTOR })
    agent.session.append('plan/mode', { active: true })
    expect(await requestConfig(ctx, agent)).toEqual({ ...SEED, ...DEFAULT_PLANNER })
  })

  it('routes through the configured phase models', async () => {
    const config: Config = {
      planner: { provider: 'mock', model: 'planner-model', reasoningEffort: 'high' },
      executor: { provider: 'mock', model: 'executor-model' },
    }
    const { ctx, agent } = await setupWithPlugin(config)
    agent.session.append('plan/mode', { active: true })
    expect(await requestConfig(ctx, agent)).toEqual({
      ...SEED,
      provider: 'mock',
      model: 'planner-model',
      reasoningEffort: ReasoningEffortId('high'),
    })
    agent.session.append('plan/mode', { active: false })
    expect(await requestConfig(ctx, agent)).toEqual({
      ...SEED,
      provider: 'mock',
      model: 'executor-model',
      reasoningEffort: ReasoningEffortId('off'),
    })
  })

  it('removes the routing listener when the plugin fiber is disposed', async () => {
    const { ctx, agent, dispose } = await setupWithPlugin()
    agent.session.append('plan/mode', { active: true })
    expect(await requestConfig(ctx, agent)).toEqual({ ...SEED, ...DEFAULT_PLANNER })
    await dispose()
    expect(await requestConfig(ctx, agent)).toEqual(SEED)
  })
})
