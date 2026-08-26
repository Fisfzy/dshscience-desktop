import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
/** The wire namespace id owned by `@deepseek-ai/dsh-plan-execute`. */
export const PLAN_EXECUTE_SETTINGS_NS = 'plan-execute';
const EMPTY_PHASE = { provider: '', model: '', reasoningEffort: '' };
function emptyDraft() {
    return { planner: { ...EMPTY_PHASE }, executor: { ...EMPTY_PHASE } };
}
function draftOf(value) {
    const section = (value ?? {});
    return {
        planner: {
            provider: section.planner?.provider ?? '',
            model: section.planner?.model ?? '',
            reasoningEffort: section.planner?.reasoningEffort ?? '',
        },
        executor: {
            provider: section.executor?.provider ?? '',
            model: section.executor?.model ?? '',
            reasoningEffort: section.executor?.reasoningEffort ?? '',
        },
    };
}
/**
 * Build the deep-merge patch for one draft: blank fields are omitted so the
 * stored section keeps whatever it had (the row's Reset clears the whole
 * section), and each kept field is trimmed.
 * @param draft - the draft the user is applying.
 * @returns the settings.update patch.
 */
export function patchOf(draft) {
    const patch = {};
    for (const phase of ['planner', 'executor']) {
        const fields = {};
        const entry = draft[phase];
        if (entry.provider.trim() !== '')
            fields.provider = entry.provider.trim();
        if (entry.model.trim() !== '')
            fields.model = entry.model.trim();
        if (entry.reasoningEffort.trim() !== '')
            fields.reasoningEffort = entry.reasoningEffort.trim();
        if (Object.keys(fields).length > 0)
            patch[phase] = fields;
    }
    return patch;
}
/**
 * One row controller: load/apply/reset over the settings wire, with the
 * latest load winning (an older response never overwrites a newer one).
 */
export class PlanExecuteSettingsController {
    api;
    store;
    generation = 0;
    /**
     * @param api - the wire face (settings + llm catalog).
     */
    constructor(api) {
        this.api = api;
        this.store = createSnapshotStore({
            status: 'idle',
            error: null,
            writable: false,
            revision: 0,
            draft: emptyDraft(),
            resolved: emptyDraft(),
            groups: [],
            saving: false,
            saveError: null,
            saved: false,
        });
    }
    /** Adopt one namespace view into the snapshot; missing view = not composed. */
    applyView(view, writable, groups) {
        if (view === undefined) {
            this.store.update((s) => {
                s.status = 'ready';
                s.error = null;
                s.writable = false;
                s.revision = 0;
                s.draft = emptyDraft();
                s.resolved = emptyDraft();
                s.groups = groups;
            });
            return;
        }
        this.store.update((s) => {
            s.status = 'ready';
            s.error = null;
            s.writable = writable;
            s.revision = view.revision;
            // The draft is the USER layer alone: only user-overridden fields are
            // edited and written back, so untouched defaults never materialize in
            // the stored section.
            s.draft = draftOf(view.user);
            s.resolved = draftOf(view.value);
            s.groups = groups;
        });
    }
    /**
     * Load the plan-execute settings section and the host model catalog in
     * parallel. Catalog failure leaves an empty groups list so the row still
     * opens on the settings fact (with inherit options only).
     * @returns nothing; the snapshot carries the outcome.
     */
    async load() {
        const generation = ++this.generation;
        this.store.update((s) => { s.status = 'loading'; });
        let view;
        let writable = false;
        let groups = [];
        try {
            const [settingsResponse, modelsResponse] = await Promise.all([
                this.api.settings.describe({}),
                this.api.llm.models({}).catch(() => undefined),
            ]);
            if (!settingsResponse.result.ok)
                throw new Error(settingsResponse.result.error.message);
            writable = settingsResponse.result.value.writable;
            view = settingsResponse.result.value.namespaces.find(ns => ns.ns === PLAN_EXECUTE_SETTINGS_NS);
            if (modelsResponse !== undefined && modelsResponse.result.ok) {
                groups = modelsResponse.result.value.groups;
            }
        }
        catch (error) {
            if (generation !== this.generation)
                return;
            this.store.update((s) => {
                s.status = 'error';
                s.error = error instanceof Error ? error.message : String(error);
            });
            return;
        }
        if (generation !== this.generation)
            return;
        this.applyView(view, writable, groups);
    }
    /**
     * Apply one draft through settings.update and adopt the returned view.
     * A refused write keeps the previous snapshot and reports the failure.
     * @param draft - the draft to persist.
     * @returns whether the write committed.
     */
    async save(draft) {
        const generation = ++this.generation;
        this.store.update((s) => { s.saving = true; s.saveError = null; s.saved = false; });
        const patch = patchOf(draft);
        let view;
        try {
            const response = await this.api.settings.update({
                ns: PLAN_EXECUTE_SETTINGS_NS,
                patch,
                expectedRevision: this.store.getSnapshot().revision,
            });
            if (!response.result.ok)
                throw new Error(response.result.error.message);
            view = response.result.value;
        }
        catch (error) {
            if (generation !== this.generation)
                return false;
            this.store.update((s) => {
                s.saving = false;
                s.saveError = error instanceof Error ? error.message : String(error);
            });
            return false;
        }
        if (generation !== this.generation)
            return false;
        const snap = this.store.getSnapshot();
        this.applyView(view, snap.writable, snap.groups);
        this.store.update((s) => { s.saving = false; s.saved = true; });
        return true;
    }
    /**
     * Clear the user section (restoring composition defaults) through
     * settings.replace.
     * @returns whether the write committed.
     */
    async reset() {
        const generation = ++this.generation;
        this.store.update((s) => { s.saving = true; s.saveError = null; s.saved = false; });
        let view;
        try {
            const response = await this.api.settings.replace({
                ns: PLAN_EXECUTE_SETTINGS_NS,
                section: {},
                expectedRevision: this.store.getSnapshot().revision,
            });
            if (!response.result.ok)
                throw new Error(response.result.error.message);
            view = response.result.value;
        }
        catch (error) {
            if (generation !== this.generation)
                return false;
            this.store.update((s) => {
                s.saving = false;
                s.saveError = error instanceof Error ? error.message : String(error);
            });
            return false;
        }
        if (generation !== this.generation)
            return false;
        const snap = this.store.getSnapshot();
        this.applyView(view, snap.writable, snap.groups);
        this.store.update((s) => { s.saving = false; s.saved = true; });
        return true;
    }
}
//# sourceMappingURL=settings-store.js.map