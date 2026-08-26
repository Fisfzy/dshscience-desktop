import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react';
import type { PlanExecuteSettingsController } from './settings-store.ts';
/** Injected business face: the row controller and its bound snapshot hook. */
export interface PlanExecuteRowInjected {
    controller: PlanExecuteSettingsController;
    useSnapshot: SnapshotSelectorHook<ReturnType<PlanExecuteSettingsController['store']['getSnapshot']>>;
}
/** Full component props: runtime share + locale seat + injected face. */
export type PlanExecuteRowComponentProps = PropsRuntime<'settings.general.item'> & PropsLocale<'settings.plan-execute'> & PlanExecuteRowInjected;
/**
 * Render the plan/execute model settings row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export declare function PlanExecuteRow({ t, controller, useSnapshot }: PlanExecuteRowComponentProps): import("react").JSX.Element;
//# sourceMappingURL=PlanExecuteRow.d.ts.map