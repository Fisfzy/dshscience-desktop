import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import Loader from '@cordisjs/plugin-loader'
import Include from '@cordisjs/plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import InvariantService from '@deepseek-ai/dsh-invariants'
import LlmService, {
  CallId,
  LlmAdapter,
  ReasoningEffortId,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import UserInteractionService from '@deepseek-ai/dsh-user-interaction'
import PlanModeService from '@deepseek-ai/dsh-plan-mode'
import * as planExecute from '../src/index.ts'
import * as planExecuteInvariant from '../src/invariant.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Scripted adapter that records every request and advertises the official effort levels. */
class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: StreamChunk[][]) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('off'), name: 'Off' },
          { id: ReasoningEffortId('high'), name: 'High' },
        ],
        defaultEffort: ReasoningEffortId('off'),
      },
    })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const chunks = this.script.shift()
    if (chunks === undefined) throw new Error('RecordingAdapter: script exhausted')
    for (const chunk of chunks) yield chunk
  }
}

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolCallResponse(rawCallId: string, name: string, args: object): StreamChunk[] {
  const id = CallId(rawCallId)
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsJson.slice(0, 5) },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsJson.slice(5) },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

async function loadYaml(lines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-plan-execute-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...lines, ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-invariants', InvariantService],
    ['@deepseek-ai/dsh-llm', LlmService],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRegistry],
    ['@deepseek-ai/dsh-user-interaction', UserInteractionService],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-plan-mode', PlanModeService],
    ['@deepseek-ai/dsh-plan-execute', planExecute],
    ['@deepseek-ai/dsh-plan-execute/invariant', planExecuteInvariant],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

const PLAN_SECTION = 'You are in plan mode. Explore and design before presenting the complete plan through exit_plan_mode.'

const BASE_PLUGINS = [
  "- name: '@deepseek-ai/dsh-invariants'",
  "- name: '@deepseek-ai/dsh-llm'",
  "- name: '@deepseek-ai/dsh-session'",
  "- name: '@deepseek-ai/dsh-system-prompt'",
  "- name: '@deepseek-ai/dsh-tools'",
  "- name: '@deepseek-ai/dsh-user-interaction'",
  "- name: '@deepseek-ai/dsh-agent'",
  "- name: '@deepseek-ai/dsh-agent-loop'",
  "- name: '@deepseek-ai/dsh-plan-mode'",
  '  config:',
  '    section: |',
  `      ${PLAN_SECTION}`,
]

describe('real Loader composition', () => {
  // Real-Loader composition resolves workspace packages through tsx at test
  // time; first resolution after the host/client program split is slow enough
  // to trip the default 5s budget on cold caches.
  it('switches from the default executor to the default planner and back after plan approval', { timeout: 60_000 }, async () => {
    const loaded = await loadYaml([
      ...BASE_PLUGINS,
      "- name: '@deepseek-ai/dsh-plan-execute'",
      "- name: '@deepseek-ai/dsh-plan-execute/invariant'",
    ])
    const adapter = new RecordingAdapter([
      textResponse('ok'),
      toolCallResponse('c1', 'exit_plan_mode', { plan: '# The plan\n\nStep one' }),
      textResponse('done'),
    ])
    loaded.llm.registerAdapter(['deepseek-official'], adapter)
    loaded.userInteraction.registerProvider({
      ask: async () => ({ answers: [{ id: 'plan-review', selected: ['Approve'] }] }),
    })

    const agent = loaded.agentLoop.create(SessionId('default-routing'), {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    // The first request has no plan mode: the default executor.
    expect(adapter.requests[0]?.model).toBe('deepseek-v4-flash')
    expect(adapter.requests[0]?.reasoningEffort).toBe(ReasoningEffortId('off'))

    loaded.planMode.set(agent, true)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'plan this' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    // While plan mode is active, the default planner plans...
    expect(adapter.requests[1]?.model).toBe('deepseek-v4-pro')
    expect(adapter.requests[1]?.reasoningEffort).toBe(ReasoningEffortId('high'))
    // ...and its exit_plan_mode call went through a user-approved review that
    // left plan mode, so the follow-up request runs on the executor again.
    expect(adapter.requests[2]?.model).toBe('deepseek-v4-flash')
    expect(adapter.requests[2]?.reasoningEffort).toBe(ReasoningEffortId('off'))
    expect(agent.session.events.filter(event => event.type === 'plan/mode').at(-1)).toMatchObject({
      data: { active: false },
    })
    expect(agent.session.deriveMessages().at(-1)).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
    })
  })

  it('routes both phases through configured models on another provider', { timeout: 60_000 }, async () => {
    const loaded = await loadYaml([
      ...BASE_PLUGINS,
      "- name: '@deepseek-ai/dsh-plan-execute'",
      '  config:',
      '    planner:',
      '      provider: mock',
      '      model: planner-model',
      '      reasoningEffort: high',
      '    executor:',
      '      provider: mock',
      '      model: executor-model',
      '      reasoningEffort: off',
    ])
    const adapter = new RecordingAdapter([
      textResponse('ok'),
      textResponse('planned'),
      textResponse('done'),
    ])
    loaded.llm.registerAdapter(['mock'], adapter)

    const agent = loaded.agentLoop.create(SessionId('configured-routing'), {
      provider: 'mock',
      model: 'executor-model',
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(adapter.requests[0]?.model).toBe('executor-model')

    loaded.planMode.set(agent, true)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'plan this' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(adapter.requests[1]?.model).toBe('planner-model')
    expect(adapter.requests[1]?.reasoningEffort).toBe(ReasoningEffortId('high'))

    loaded.planMode.set(agent, false)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'execute' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(adapter.requests[2]?.model).toBe('executor-model')
    expect(adapter.requests[2]?.reasoningEffort).toBe(ReasoningEffortId('off'))
  })
})
