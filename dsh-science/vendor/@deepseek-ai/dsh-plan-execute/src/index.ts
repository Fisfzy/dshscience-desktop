/**
 * Phase-routed dual-model selection for the plan workflow (host half of this
 * dual-face package). While plan mode is active, every agent request is
 * proposed against the configured planner model; otherwise against the
 * executor model. The switch happens per request inside the same session —
 * the `agent/request` waterfall — so a user-approved plan is carried out by
 * the executor model from the very next request: no sub-agent, no state
 * migration, no loop change.
 *
 * The phase signal is the logged `plan/mode` state owned by
 * `@deepseek-ai/dsh-plan-mode` (folded with its `foldPlanMode`), so resume,
 * fork, and compaction recover routing from the log alone. This package adds
 * no session events: the loop already records the effective config as
 * `request/header` (reason `change`) whenever a proposal differs, keeping
 * every model-visible routing decision reconstructable.
 *
 * The browser half (`exports["./client"]`, package.json `dsh.client`) registers
 * the Settings → General "Plan/Execute models" row that edits the same
 * `plan-execute` settings namespace; mounting this package once composes both.
 *
 * @module @deepseek-ai/dsh-plan-execute
 */

import type { Context } from 'cordis'
import z from 'schemastery'
import type { LlmCallConfig, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId as brandReasoningEffort } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { foldPlanMode } from '@deepseek-ai/dsh-plan-mode'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Cordis function-plugin name. */
export const name = 'plan-execute'

/** Settings namespace of the dual-model routing. */
export const SETTINGS_NS = settingsNamespace('plan-execute')

/** One phase's model routing as written in configuration. */
export interface PhaseModelConfig {
  /** Provider route this phase resolves to. */
  provider?: string
  /** Model id this phase resolves to. */
  model?: string
  /** Adapter-owned reasoning-effort id this phase resolves to, as written. */
  reasoningEffort?: string
}

/** Dual-model routing: planner while plan mode is active, executor otherwise. */
export interface Config {
  /** The planning model, used while plan mode is active. */
  planner?: PhaseModelConfig
  /** The execution model, used while plan mode is inactive. */
  executor?: PhaseModelConfig
}

/** One phase's resolved routing, with the reasoning effort branded. */
export interface PhaseModel {
  provider?: string
  model?: string
  reasoningEffort?: ReasoningEffortId
}

/** Resolved dual-model routing with every phase complete. */
export interface ResolvedConfig {
  planner: PhaseModel
  executor: PhaseModel
}

/** Default planner routing: the official reasoning model with thinking enabled. */
export const DEFAULT_PLANNER: Readonly<PhaseModel> = Object.freeze({
  provider: 'deepseek-official',
  model: 'deepseek-v4-pro',
  reasoningEffort: brandReasoningEffort('high'),
})

/** Default executor routing: the official fast model with thinking disabled. */
export const DEFAULT_EXECUTOR: Readonly<PhaseModel> = Object.freeze({
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  reasoningEffort: brandReasoningEffort('off'),
})

const phaseSchema = z.object({
  provider: z.string().required(false),
  model: z.string().required(false),
  reasoningEffort: z.string().required(false),
})

/** Runtime schema for {@link Config}. */
export const Config = z.object({
  planner: phaseSchema.required(false),
  executor: phaseSchema.required(false),
}) as unknown as z<Config>

/** Reject a configured phase field that is present but blank. */
function checkPhaseField(key: string, value: string | undefined): void {
  if (value !== undefined && value.trim() === '') {
    throw new Error(`plan-execute: phase field "${key}" must be a non-empty string`)
  }
}

/** Merge one configured phase over its default. */
function resolvePhase(base: PhaseModel, override: PhaseModelConfig | undefined): PhaseModel {
  const phase: PhaseModel = { ...base }
  if (override === undefined) return phase
  checkPhaseField('provider', override.provider)
  checkPhaseField('model', override.model)
  checkPhaseField('reasoningEffort', override.reasoningEffort)
  if (override.provider !== undefined) phase.provider = override.provider
  if (override.model !== undefined) phase.model = override.model
  if (override.reasoningEffort !== undefined) phase.reasoningEffort = brandReasoningEffort(override.reasoningEffort)
  return phase
}

/**
 * Validate and complete the deployment routing. Unknown keys fail at load
 * rather than silently shaping nothing.
 *
 * @param config Raw plugin config.
 * @returns The complete routing: defaults merged under configured fields.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const unknown = Object.keys(config).filter(key => key !== 'planner' && key !== 'executor')
  if (unknown.length > 0) {
    throw new Error(`PlanExecuteConfig has unknown key(s) ${unknown.join(', ')} — config is { planner?, executor? }`)
  }
  return {
    planner: resolvePhase(DEFAULT_PLANNER, config.planner),
    executor: resolvePhase(DEFAULT_EXECUTOR, config.executor),
  }
}

/**
 * Apply one phase's routing onto a request configuration. Only fields the
 * phase sets are replaced; everything else (the agent's route, sampling)
 * passes through.
 *
 * @param config The request configuration the loop would otherwise use.
 * @param phase The resolved routing of the active phase.
 * @returns A replacement configuration for the `agent/request` waterfall.
 */
export function proposePhaseModel(config: LlmCallConfig, phase: PhaseModel): LlmCallConfig {
  const proposal = { ...config }
  if (phase.provider !== undefined) proposal.provider = phase.provider
  if (phase.model !== undefined) proposal.model = phase.model
  if (phase.reasoningEffort !== undefined) proposal.reasoningEffort = phase.reasoningEffort
  return proposal
}

/**
 * Select the phase routing for one session: planner while plan mode is
 * active, executor otherwise.
 *
 * @param session The session making the request.
 * @param routing The resolved deployment routing.
 * @returns The routing of the session's current phase.
 */
export function phaseFor(session: Session, routing: ResolvedConfig): PhaseModel {
  return foldPlanMode(session.events) ? routing.planner : routing.executor
}

/**
 * Mount the phase-routed request rewriting. The routing source is the
 * composition entry config; when a settings service is composed, the user
 * document's `plan-execute` section layers over it (entry stays the `base`)
 * and a committed change hot-swaps the routing before the next request.
 * @param ctx - the plugin context owning the listener.
 * @param config - the deployment routing; defaults complete both phases.
 */
export function apply(ctx: Context, config: Config = {}): void {
  let current: () => Config = () => config
  let routing = resolveConfig(config)
  const rederive = (): void => {
    try {
      routing = resolveConfig(current())
    } catch (error) {
      // A stored section the routing cannot serve (blank field, unknown key)
      // keeps the previous routing serving instead of taking requests down.
      ctx.logger.error('plan-execute: keeping the previous routing after a refused settings update')
      ctx.logger.error(error)
    }
  }
  installSettingsSection(ctx, SETTINGS_NS, Config, config, {
    // Refuse a section the routing cannot resolve where it is written.
    validate: (value) => { resolveConfig(value) },
    setSource: (source) => { current = source },
    onChange: rederive,
  })
  ctx.on('agent/request', async ({ agent }, next) => {
    const currentRequest = await next()
    return proposePhaseModel(currentRequest, phaseFor(agent.session, routing))
  })
}
