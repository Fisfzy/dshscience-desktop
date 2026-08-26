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
import type { Context } from 'cordis';
import z from 'schemastery';
import type { LlmCallConfig, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { Session } from '@deepseek-ai/dsh-session';
/** Cordis function-plugin name. */
export declare const name = "plan-execute";
/** Settings namespace of the dual-model routing. */
export declare const SETTINGS_NS: import("@deepseek-ai/dsh-settings").SettingsNamespace;
/** One phase's model routing as written in configuration. */
export interface PhaseModelConfig {
    /** Provider route this phase resolves to. */
    provider?: string;
    /** Model id this phase resolves to. */
    model?: string;
    /** Adapter-owned reasoning-effort id this phase resolves to, as written. */
    reasoningEffort?: string;
}
/** Dual-model routing: planner while plan mode is active, executor otherwise. */
export interface Config {
    /** The planning model, used while plan mode is active. */
    planner?: PhaseModelConfig;
    /** The execution model, used while plan mode is inactive. */
    executor?: PhaseModelConfig;
}
/** One phase's resolved routing, with the reasoning effort branded. */
export interface PhaseModel {
    provider?: string;
    model?: string;
    reasoningEffort?: ReasoningEffortId;
}
/** Resolved dual-model routing with every phase complete. */
export interface ResolvedConfig {
    planner: PhaseModel;
    executor: PhaseModel;
}
/** Default planner routing: the official reasoning model with thinking enabled. */
export declare const DEFAULT_PLANNER: Readonly<PhaseModel>;
/** Default executor routing: the official fast model with thinking disabled. */
export declare const DEFAULT_EXECUTOR: Readonly<PhaseModel>;
/** Runtime schema for {@link Config}. */
export declare const Config: z<Config>;
/**
 * Validate and complete the deployment routing. Unknown keys fail at load
 * rather than silently shaping nothing.
 *
 * @param config Raw plugin config.
 * @returns The complete routing: defaults merged under configured fields.
 */
export declare function resolveConfig(config: Config): ResolvedConfig;
/**
 * Apply one phase's routing onto a request configuration. Only fields the
 * phase sets are replaced; everything else (the agent's route, sampling)
 * passes through.
 *
 * @param config The request configuration the loop would otherwise use.
 * @param phase The resolved routing of the active phase.
 * @returns A replacement configuration for the `agent/request` waterfall.
 */
export declare function proposePhaseModel(config: LlmCallConfig, phase: PhaseModel): LlmCallConfig;
/**
 * Select the phase routing for one session: planner while plan mode is
 * active, executor otherwise.
 *
 * @param session The session making the request.
 * @param routing The resolved deployment routing.
 * @returns The routing of the session's current phase.
 */
export declare function phaseFor(session: Session, routing: ResolvedConfig): PhaseModel;
/**
 * Mount the phase-routed request rewriting. The routing source is the
 * composition entry config; when a settings service is composed, the user
 * document's `plan-execute` section layers over it (entry stays the `base`)
 * and a committed change hot-swaps the routing before the next request.
 * @param ctx - the plugin context owning the listener.
 * @param config - the deployment routing; defaults complete both phases.
 */
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map