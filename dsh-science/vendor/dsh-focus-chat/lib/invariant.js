//#region src/invariant.ts
const PACKAGE_NAME = "dsh-focus-chat";
/** Cordis companion plugin name. */
const name = "dsh-focus-chat-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: a pure-consumer view plugin — it emits no cordis
* events and owns no mutable cross-plugin state; its view-tab registration
* is a plain effect whose disposal the slot ledger's own specs and this
* package's behavior specs observe directly.
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
