/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-plan-execute`.
 * @module @deepseek-ai/dsh-plan-execute/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-plan-execute';
/** Cordis companion plugin name. */
export const name = 'plan-execute-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: the plugin owns no durable state or event stream — it
 * only rewrites `agent/request` proposals against the logged `plan/mode`
 * state, and the correctness of that rewrite (which phase resolves to which
 * model) depends on the deployment config this companion cannot see.
 * Request/header integrity is already guarded by the `dsh-agent-loop`
 * companion; the `plan/mode` shape by `dsh-plan-mode`'s.
 */
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
/* jscpd:ignore-end */
//# sourceMappingURL=invariant.js.map