import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react';
import { PlanExecuteRow } from "./PlanExecuteRow.js";
import { PlanExecuteSettingsController } from "./settings-store.js";
import { en, zh } from "./locales.js";
/** Dictionary namespace owned by this plugin. */
const NS = 'settings.plan-execute';
/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings-general's General entry, whose activation order relative to
 * this one is NOT constrained; registration depends on it through
 * `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection'];
/**
 * Register the plan/execute settings row once the `settings.general.item`
 * declaration is on the ledger and wire its store to the connection. The row
 * loads lazily — a closed row never fetches; pushed invalidations refresh it
 * only after its first load.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-plan-execute: copy dictionaries');
    const connection = ctx.get('connection');
    const controller = new PlanExecuteSettingsController(connection.api);
    const useSnapshot = bindSnapshotSelector(controller.store);
    const injected = () => ({ controller, useSnapshot });
    // Pushed invalidations converge an opened row without polling: any settings
    // change or connection reset refetches once the row loaded.
    ctx.effect(() => {
        const refresh = () => {
            if (controller.store.getSnapshot().status !== 'idle')
                void controller.load();
        };
        const disposers = [
            ctx.on('settings/changed', refresh),
            ctx.on('connection/reset', refresh),
        ];
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'ui-plan-execute: pushed invalidations');
    ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'plan-execute-models',
        order: 25,
        locale: NS,
        inject: injected,
    }, PlanExecuteRow));
}
//# sourceMappingURL=index.js.map