/**
 * Browser half of `@deepseek-ai/dsh-plan-execute` (dual-face). Registers the
 * General-section preference row that edits this package's `plan-execute`
 * settings namespace: planner and executor model routing, applied through the
 * settings wire. The host half stays the single fact source — the row
 * re-renders from the next describe, pushed or refetched.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { type PlanExecuteKey } from './locales.ts';
export type { PlanExecuteRowInjected, PlanExecuteRowComponentProps } from './PlanExecuteRow.tsx';
export type { PhaseDraft, PlanExecuteDraft, PlanExecuteRowState, PlanExecuteSettingsController, } from './settings-store.ts';
export type { PlanExecuteKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** The plan/execute model settings row copy. */
        'settings.plan-execute': keyof PlanExecuteKey;
    }
}
/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings-general's General entry, whose activation order relative to
 * this one is NOT constrained; registration depends on it through
 * `slots.inject()`.
 */
export declare const inject: string[];
/**
 * Register the plan/execute settings row once the `settings.general.item`
 * declaration is on the ledger and wire its store to the connection. The row
 * loads lazily — a closed row never fetches; pushed invalidations refresh it
 * only after its first load.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map