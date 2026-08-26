/**
 * dsh-model-inherit
 *
 * Make the model switch actually propagate.
 *
 * Root cause (traced in DSH 0.1.1-rc.2 source):
 *   - The UI `session.selectModel` only updates the live in-memory selection
 *     (`selectionFor(agent).current = selected`). It NEVER rewrites the agent's
 *     creation-time `AgentOptions`.
 *   - Two reads key off that STALE `agent.options`:
 *       1. The `{{model}}` / `{{provider}}` system-prompt variables
 *          (`dsh-agent-loop` registers `variables(model -> context.agent?.options.model)`).
 *       2. Subagent inheritance: `dsh-subagent`'s `resolveChildAgentOptions`
 *          copies `parent.options.provider/model` when the subagent tool doesn't
 *          pass explicit `agentOptions`. So children inherit the OLD model.
 *
 * This plugin closes the gap at the narrow seam that is authoritative: it hooks
 * the scoped `agent/request` waterfall, reads the FINAL effective provider/model
 * (i.e. what the model request actually resolved to after all selectors,
 * including the live model-selection override), and mirrors it back onto
 * `agent.options`. Every later lazy reader `{{model}}` / subagent inheritance
 * then sees the live model, matching what the agent actually used.
 *
 * This is strictly a mirror: it never chooses a model itself and never overrides
 * a resolved config; it only reflects the already-resolved value so the two
 * stale surfaces stop lying about the current agent.
 *
 * All registrations go through ctx -> auto-disposed on plugin unload.
 */

export const name = 'dsh-model-inherit'

const NONEMPTY = (v) => typeof v === 'string' && v.length > 0

export function apply(ctx) {
  // waterfall: signature (payload, next). next() returns the resolved config.
  ctx.on('agent/request', async (payload, next) => {
    const resolved = await next()
    const agent = payload?.agent
    if (agent === undefined || agent === null) return resolved
    if (typeof agent.options !== 'object' || agent.options === null) return resolved
    const provider = resolved?.provider
    const model = resolved?.model
    // Mirror the EFFECTIVE route only when it is concrete. Never write empties.
    if (!NONEMPTY(provider) && !NONEMPTY(model)) return resolved
    try {
      const nextOptions = { ...agent.options }
      if (NONEMPTY(provider)) nextOptions.provider = provider
      if (NONEMPTY(model)) nextOptions.model = model
      agent.options = nextOptions
      ctx.logger?.debug?.(`[dsh-model-inherit] synced agent.options -> ${provider}/${model}`)
    } catch {
      // A mirror must never break a request.
    }
    return resolved
  })
}
