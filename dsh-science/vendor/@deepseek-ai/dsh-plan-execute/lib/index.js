import z from "@deepseek-ai/schemastery";
import { ReasoningEffortId } from "@deepseek-ai/dsh-llm";
import { foldPlanMode } from "@deepseek-ai/dsh-plan-mode";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
//#region lib/types/index.js
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
/** Cordis function-plugin name. */
const name = "plan-execute";
/** Settings namespace of the dual-model routing. */
const SETTINGS_NS = settingsNamespace("plan-execute");
/** Default planner routing: the official reasoning model with thinking enabled. */
const DEFAULT_PLANNER = Object.freeze({
	provider: "deepseek-official",
	model: "deepseek-v4-pro",
	reasoningEffort: ReasoningEffortId("high")
});
/** Default executor routing: the official fast model with thinking disabled. */
const DEFAULT_EXECUTOR = Object.freeze({
	provider: "deepseek-official",
	model: "deepseek-v4-flash",
	reasoningEffort: ReasoningEffortId("off")
});
const phaseSchema = z.object({
	provider: z.string().required(false),
	model: z.string().required(false),
	reasoningEffort: z.string().required(false)
});
/** Runtime schema for {@link Config}. */
const Config = z.object({
	planner: phaseSchema.required(false),
	executor: phaseSchema.required(false)
});
/** Reject a configured phase field that is present but blank. */
function checkPhaseField(key, value) {
	if (value !== void 0 && value.trim() === "") throw new Error(`plan-execute: phase field "${key}" must be a non-empty string`);
}
/** Merge one configured phase over its default. */
function resolvePhase(base, override) {
	const phase = { ...base };
	if (override === void 0) return phase;
	checkPhaseField("provider", override.provider);
	checkPhaseField("model", override.model);
	checkPhaseField("reasoningEffort", override.reasoningEffort);
	if (override.provider !== void 0) phase.provider = override.provider;
	if (override.model !== void 0) phase.model = override.model;
	if (override.reasoningEffort !== void 0) phase.reasoningEffort = ReasoningEffortId(override.reasoningEffort);
	return phase;
}
/**
* Validate and complete the deployment routing. Unknown keys fail at load
* rather than silently shaping nothing.
*
* @param config Raw plugin config.
* @returns The complete routing: defaults merged under configured fields.
*/
function resolveConfig(config) {
	const unknown = Object.keys(config).filter((key) => key !== "planner" && key !== "executor");
	if (unknown.length > 0) throw new Error(`PlanExecuteConfig has unknown key(s) ${unknown.join(", ")} — config is { planner?, executor? }`);
	return {
		planner: resolvePhase(DEFAULT_PLANNER, config.planner),
		executor: resolvePhase(DEFAULT_EXECUTOR, config.executor)
	};
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
function proposePhaseModel(config, phase) {
	const proposal = { ...config };
	if (phase.provider !== void 0) proposal.provider = phase.provider;
	if (phase.model !== void 0) proposal.model = phase.model;
	if (phase.reasoningEffort !== void 0) proposal.reasoningEffort = phase.reasoningEffort;
	return proposal;
}
/**
* Select the phase routing for one session: planner while plan mode is
* active, executor otherwise.
*
* @param session The session making the request.
* @param routing The resolved deployment routing.
* @returns The routing of the session's current phase.
*/
function phaseFor(session, routing) {
	return foldPlanMode(session.events) ? routing.planner : routing.executor;
}
/**
* Mount the phase-routed request rewriting. The routing source is the
* composition entry config; when a settings service is composed, the user
* document's `plan-execute` section layers over it (entry stays the `base`)
* and a committed change hot-swaps the routing before the next request.
* @param ctx - the plugin context owning the listener.
* @param config - the deployment routing; defaults complete both phases.
*/
function apply(ctx, config = {}) {
	let current = () => config;
	let routing = resolveConfig(config);
	const rederive = () => {
		try {
			routing = resolveConfig(current());
		} catch (error) {
			ctx.logger.error("plan-execute: keeping the previous routing after a refused settings update");
			ctx.logger.error(error);
		}
	};
	installSettingsSection(ctx, SETTINGS_NS, Config, config, {
		validate: (value) => {
			resolveConfig(value);
		},
		setSource: (source) => {
			current = source;
		},
		onChange: rederive
	});
	ctx.on("agent/request", async ({ agent }, next) => {
		return proposePhaseModel(await next(), phaseFor(agent.session, routing));
	});
}
//#endregion
export { Config, DEFAULT_EXECUTOR, DEFAULT_PLANNER, SETTINGS_NS, apply, name, phaseFor, proposePhaseModel, resolveConfig };
