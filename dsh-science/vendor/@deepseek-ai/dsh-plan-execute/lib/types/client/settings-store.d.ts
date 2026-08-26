/**
 * Plan/execute settings row store: one snapshot of the `plan-execute`
 * settings namespace plus the host model catalog used by the pickers. The
 * host stays the single fact source — every mutation writes through the
 * settings wire and the row re-renders from the next describe, pushed or
 * refetched.
 */
import type { IApiClient, ModelProviderGroup } from '@deepseek-ai/dsh-client-connection/client';
import { type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
/** The wire namespace id owned by `@deepseek-ai/dsh-plan-execute`. */
export declare const PLAN_EXECUTE_SETTINGS_NS = "plan-execute";
/** One phase's editable routing fields; empty means "inherit the default". */
export interface PhaseDraft {
    provider: string;
    model: string;
    reasoningEffort: string;
}
/** Editable routing of both phases. */
export interface PlanExecuteDraft {
    planner: PhaseDraft;
    executor: PhaseDraft;
}
/** Row snapshot. */
export interface PlanExecuteRowState {
    /** `idle` before the first load; `error` keeps the last good draft. */
    status: 'idle' | 'loading' | 'ready' | 'error';
    error: string | null;
    /** Whether the provider accepts writes (a read-only document disables the row). */
    writable: boolean;
    /** The namespace revision carried into the next write. */
    revision: number;
    /** Editable draft: the USER layer only — blank means "inherit the default". */
    draft: PlanExecuteDraft;
    /** The resolved values (defaults merged) shown on inherit options. */
    resolved: PlanExecuteDraft;
    /** Host-scoped model catalog for the pickers (empty when listing failed). */
    groups: readonly ModelProviderGroup[];
    saving: boolean;
    saveError: string | null;
    saved: boolean;
}
/**
 * Build the deep-merge patch for one draft: blank fields are omitted so the
 * stored section keeps whatever it had (the row's Reset clears the whole
 * section), and each kept field is trimmed.
 * @param draft - the draft the user is applying.
 * @returns the settings.update patch.
 */
export declare function patchOf(draft: PlanExecuteDraft): Record<string, unknown>;
/**
 * One row controller: load/apply/reset over the settings wire, with the
 * latest load winning (an older response never overwrites a newer one).
 */
export declare class PlanExecuteSettingsController {
    private readonly api;
    readonly store: SnapshotStore<PlanExecuteRowState>;
    private generation;
    /**
     * @param api - the wire face (settings + llm catalog).
     */
    constructor(api: Pick<IApiClient, 'settings' | 'llm'>);
    /** Adopt one namespace view into the snapshot; missing view = not composed. */
    private applyView;
    /**
     * Load the plan-execute settings section and the host model catalog in
     * parallel. Catalog failure leaves an empty groups list so the row still
     * opens on the settings fact (with inherit options only).
     * @returns nothing; the snapshot carries the outcome.
     */
    load(): Promise<void>;
    /**
     * Apply one draft through settings.update and adopt the returned view.
     * A refused write keeps the previous snapshot and reports the failure.
     * @param draft - the draft to persist.
     * @returns whether the write committed.
     */
    save(draft: PlanExecuteDraft): Promise<boolean>;
    /**
     * Clear the user section (restoring composition defaults) through
     * settings.replace.
     * @returns whether the write committed.
     */
    reset(): Promise<boolean>;
}
//# sourceMappingURL=settings-store.d.ts.map