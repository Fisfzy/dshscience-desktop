import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Plan/execute model settings row: the General-section preference row
 * editing the `plan-execute` routing. Each phase picks a route from the
 * host `llm.models` catalog (provider + model) and an effort from that
 * model's advertised levels; blank inherits composition defaults.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { decodeRoute, encodeRoute, findCatalogModel, inheritEffortLabel, inheritRouteLabel, modelOptionLabel, routeValueOf, } from "./catalog.js";
import css from './PlanExecuteRow.module.css';
/**
 * Apply a model-route pick onto a phase draft: inherit clears the phase;
 * a catalog pick sets provider/model and the model's default effort when known.
 */
function draftFromRoute(groups, value, previous) {
    const route = decodeRoute(value);
    if (route === undefined)
        return { provider: '', model: '', reasoningEffort: '' };
    const entry = findCatalogModel(groups, route.provider, route.model);
    const defaultEffort = entry?.reasoning?.defaultEffort ?? '';
    // Keep a prior effort only when it is still advertised for the new model.
    const keepEffort = previous.reasoningEffort !== ''
        && entry?.reasoning?.efforts.some(level => level.id === previous.reasoningEffort) === true;
    return {
        provider: route.provider,
        model: route.model,
        reasoningEffort: keepEffort ? previous.reasoningEffort : defaultEffort,
    };
}
/** One phase's model + effort pickers. */
function PhaseEditor({ label, draft, resolved, groups, disabled, onDraftChange, t }) {
    const routeValue = routeValueOf(draft);
    const activeProvider = draft.provider.trim() !== '' ? draft.provider.trim() : resolved.provider.trim();
    const activeModel = draft.model.trim() !== '' ? draft.model.trim() : resolved.model.trim();
    const catalogModel = activeProvider !== '' && activeModel !== ''
        ? findCatalogModel(groups, activeProvider, activeModel)
        : undefined;
    const efforts = catalogModel?.reasoning?.efforts ?? [];
    const effortDisabled = disabled || routeValue === '';
    // A stored route missing from the live catalog still needs a selectable option.
    const orphanRoute = routeValue !== ''
        && findCatalogModel(groups, draft.provider.trim(), draft.model.trim()) === undefined;
    const modelOptions = useMemo(() => {
        const options = [
            { value: '', label: inheritRouteLabel(resolved, t('plan-execute.inheritDefault')) },
        ];
        for (const group of groups) {
            for (const model of group.models) {
                options.push({
                    value: encodeRoute(group.id, model.id),
                    label: modelOptionLabel(group.name, model),
                });
            }
        }
        if (orphanRoute) {
            options.push({
                value: routeValue,
                label: t('plan-execute.currentRoute')
                    .replace('{provider}', draft.provider)
                    .replace('{model}', draft.model),
            });
        }
        return options;
    }, [groups, resolved, orphanRoute, routeValue, draft.provider, draft.model, t]);
    return (_jsxs("fieldset", { className: css.phase, disabled: disabled, children: [_jsx("legend", { className: css.phaseLabel, children: label }), _jsxs("div", { className: css.fields, children: [_jsxs("label", { className: css.field, children: [_jsx("span", { className: css.fieldLabel, children: t('plan-execute.model') }), _jsx("select", { className: css.select, "aria-label": t('plan-execute.model'), value: routeValue, disabled: disabled, onChange: (event) => {
                                    onDraftChange(draftFromRoute(groups, event.target.value, draft));
                                }, children: modelOptions.map(option => (_jsx("option", { value: option.value, children: option.label }, option.value === '' ? '__inherit__' : option.value))) })] }), _jsxs("label", { className: css.field, children: [_jsx("span", { className: css.fieldLabel, children: t('plan-execute.reasoningEffort') }), _jsxs("select", { className: css.select, "aria-label": t('plan-execute.reasoningEffort'), value: draft.reasoningEffort, disabled: effortDisabled, onChange: (event) => {
                                    onDraftChange({ ...draft, reasoningEffort: event.target.value });
                                }, children: [_jsx("option", { value: "", children: inheritEffortLabel(catalogModel, t('plan-execute.inheritEffort')) }), efforts.map(level => (_jsx("option", { value: level.id, children: level.name === level.id ? level.id : `${level.name} (${level.id})` }, level.id))), draft.reasoningEffort !== ''
                                        && !efforts.some(level => level.id === draft.reasoningEffort)
                                        && (_jsx("option", { value: draft.reasoningEffort, children: t('plan-execute.currentEffort').replace('{effort}', draft.reasoningEffort) }))] })] })] })] }));
}
/**
 * Render the plan/execute model settings row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function PlanExecuteRow({ t, controller, useSnapshot }) {
    const state = useSnapshot(s => s);
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(state.draft);
    const [syncedRevision, setSyncedRevision] = useState(state.revision);
    const editable = state.status === 'ready' && state.writable && !state.saving;
    // Lazy load: a closed row never fetches; the first open pulls the snapshot.
    useEffect(() => {
        if (open && state.status === 'idle')
            void controller.load();
    }, [open, state.status, controller]);
    // Sync the edit draft from the store only when the committed snapshot moved
    // (a revision change); transient flags (saving, saved) never reset edits.
    useEffect(() => {
        if (!open || state.status !== 'ready' || state.revision === syncedRevision)
            return;
        setDraft(state.draft);
        setSyncedRevision(state.revision);
    }, [open, state.status, state.revision, state.draft, syncedRevision]);
    const applyDraft = async () => {
        const committed = await controller.save(draft);
        if (committed)
            setOpen(false);
    };
    const reset = async () => {
        const committed = await controller.reset();
        if (committed)
            setOpen(false);
    };
    return (_jsxs("div", { className: css.row, children: [_jsxs("div", { className: css.rowText, children: [_jsx("div", { className: css.title, children: t('plan-execute.title') }), open && (_jsxs("div", { className: css.panel, children: [state.status === 'error' && (_jsxs("div", { className: css.error, children: [t('plan-execute.loadFailed'), "\uFF1A", state.error] })), state.status === 'ready' && !state.writable && (_jsx("div", { className: css.error, children: t('plan-execute.unavailable') })), _jsx(PhaseEditor, { label: t('plan-execute.planner'), draft: draft.planner, resolved: state.resolved.planner, groups: state.groups, disabled: !editable, onDraftChange: (planner) => { setDraft(s => ({ ...s, planner })); }, t: t }), _jsx(PhaseEditor, { label: t('plan-execute.executor'), draft: draft.executor, resolved: state.resolved.executor, groups: state.groups, disabled: !editable, onDraftChange: (executor) => { setDraft(s => ({ ...s, executor })); }, t: t }), _jsx("div", { className: css.hint, children: t('plan-execute.pickerHint') }), _jsxs("div", { className: css.actions, children: [_jsx(Button, { variant: "primary", size: "sm", disabled: !editable, onClick: () => { void applyDraft(); }, children: t('plan-execute.apply') }), _jsx(Button, { size: "sm", disabled: !editable, onClick: () => { void reset(); }, children: t('plan-execute.reset') }), state.saved && _jsx("span", { className: css.saved, children: t('plan-execute.saved') }), state.saveError !== null && (_jsx("span", { className: css.error, children: t('plan-execute.saveFailed') }))] })] }))] }), _jsx("button", { type: "button", className: css.expander, "aria-expanded": open, "aria-label": t('plan-execute.title'), onClick: () => { setOpen(v => !v); }, children: _jsx("svg", { className: css.chevron, width: "14", height: "14", viewBox: "0 0 14 14", "aria-hidden": "true", children: _jsx("path", { d: "M4 5.5 7 8.5 10 5.5", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" }) }) })] }));
}
//# sourceMappingURL=PlanExecuteRow.js.map