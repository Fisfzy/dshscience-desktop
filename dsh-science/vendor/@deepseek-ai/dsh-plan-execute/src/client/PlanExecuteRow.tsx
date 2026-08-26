/**
 * Plan/execute model settings row: the General-section preference row
 * editing the `plan-execute` routing. Each phase picks a route from the
 * host `llm.models` catalog (provider + model) and an effort from that
 * model's advertised levels; blank inherits composition defaults.
 */
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelProviderGroup } from '@deepseek-ai/dsh-client-connection/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import {
  decodeRoute,
  encodeRoute,
  findCatalogModel,
  inheritEffortLabel,
  inheritRouteLabel,
  modelOptionLabel,
  routeValueOf,
} from './catalog.ts'
import type {
  PhaseDraft,
  PlanExecuteDraft,
  PlanExecuteSettingsController,
} from './settings-store.ts'
import css from './PlanExecuteRow.module.css'

/** Injected business face: the row controller and its bound snapshot hook. */
export interface PlanExecuteRowInjected {
  controller: PlanExecuteSettingsController
  useSnapshot: SnapshotSelectorHook<ReturnType<PlanExecuteSettingsController['store']['getSnapshot']>>
}

/** Full component props: runtime share + locale seat + injected face. */
export type PlanExecuteRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings.plan-execute'> & PlanExecuteRowInjected

/**
 * Apply a model-route pick onto a phase draft: inherit clears the phase;
 * a catalog pick sets provider/model and the model's default effort when known.
 */
function draftFromRoute(
  groups: readonly ModelProviderGroup[],
  value: string,
  previous: PhaseDraft,
): PhaseDraft {
  const route = decodeRoute(value)
  if (route === undefined) return { provider: '', model: '', reasoningEffort: '' }
  const entry = findCatalogModel(groups, route.provider, route.model)
  const defaultEffort = entry?.reasoning?.defaultEffort ?? ''
  // Keep a prior effort only when it is still advertised for the new model.
  const keepEffort = previous.reasoningEffort !== ''
    && entry?.reasoning?.efforts.some(level => level.id === previous.reasoningEffort) === true
  return {
    provider: route.provider,
    model: route.model,
    reasoningEffort: keepEffort ? previous.reasoningEffort : defaultEffort,
  }
}

/** One phase's model + effort pickers. */
function PhaseEditor({ label, draft, resolved, groups, disabled, onDraftChange, t }: {
  label: string
  draft: PhaseDraft
  resolved: PhaseDraft
  groups: readonly ModelProviderGroup[]
  disabled: boolean
  onDraftChange: (draft: PhaseDraft) => void
  t: PropsLocale<'settings.plan-execute'>['t']
}) {
  const routeValue = routeValueOf(draft)
  const activeProvider = draft.provider.trim() !== '' ? draft.provider.trim() : resolved.provider.trim()
  const activeModel = draft.model.trim() !== '' ? draft.model.trim() : resolved.model.trim()
  const catalogModel = activeProvider !== '' && activeModel !== ''
    ? findCatalogModel(groups, activeProvider, activeModel)
    : undefined
  const efforts = catalogModel?.reasoning?.efforts ?? []
  const effortDisabled = disabled || routeValue === ''

  // A stored route missing from the live catalog still needs a selectable option.
  const orphanRoute = routeValue !== ''
    && findCatalogModel(groups, draft.provider.trim(), draft.model.trim()) === undefined

  const modelOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [
      { value: '', label: inheritRouteLabel(resolved, t('plan-execute.inheritDefault')) },
    ]
    for (const group of groups) {
      for (const model of group.models) {
        options.push({
          value: encodeRoute(group.id, model.id),
          label: modelOptionLabel(group.name, model),
        })
      }
    }
    if (orphanRoute) {
      options.push({
        value: routeValue,
        label: t('plan-execute.currentRoute')
          .replace('{provider}', draft.provider)
          .replace('{model}', draft.model),
      })
    }
    return options
  }, [groups, resolved, orphanRoute, routeValue, draft.provider, draft.model, t])

  return (
    <fieldset className={css.phase} disabled={disabled}>
      <legend className={css.phaseLabel}>{label}</legend>
      <div className={css.fields}>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('plan-execute.model')}</span>
          <select
            className={css.select}
            aria-label={t('plan-execute.model')}
            value={routeValue}
            disabled={disabled}
            onChange={(event) => {
              onDraftChange(draftFromRoute(groups, event.target.value, draft))
            }}
          >
            {modelOptions.map(option => (
              <option key={option.value === '' ? '__inherit__' : option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('plan-execute.reasoningEffort')}</span>
          <select
            className={css.select}
            aria-label={t('plan-execute.reasoningEffort')}
            value={draft.reasoningEffort}
            disabled={effortDisabled}
            onChange={(event) => {
              onDraftChange({ ...draft, reasoningEffort: event.target.value })
            }}
          >
            <option value="">
              {inheritEffortLabel(catalogModel, t('plan-execute.inheritEffort'))}
            </option>
            {efforts.map(level => (
              <option key={level.id} value={level.id}>
                {level.name === level.id ? level.id : `${level.name} (${level.id})`}
              </option>
            ))}
            {/* Keep a stored effort visible when the catalog no longer lists it. */}
            {draft.reasoningEffort !== ''
              && !efforts.some(level => level.id === draft.reasoningEffort)
              && (
                <option value={draft.reasoningEffort}>
                  {t('plan-execute.currentEffort').replace('{effort}', draft.reasoningEffort)}
                </option>
              )}
          </select>
        </label>
      </div>
    </fieldset>
  )
}

/**
 * Render the plan/execute model settings row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function PlanExecuteRow({ t, controller, useSnapshot }: PlanExecuteRowComponentProps) {
  const state = useSnapshot(s => s)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<PlanExecuteDraft>(state.draft)
  const [syncedRevision, setSyncedRevision] = useState(state.revision)
  const editable = state.status === 'ready' && state.writable && !state.saving

  // Lazy load: a closed row never fetches; the first open pulls the snapshot.
  useEffect(() => {
    if (open && state.status === 'idle') void controller.load()
  }, [open, state.status, controller])

  // Sync the edit draft from the store only when the committed snapshot moved
  // (a revision change); transient flags (saving, saved) never reset edits.
  useEffect(() => {
    if (!open || state.status !== 'ready' || state.revision === syncedRevision) return
    setDraft(state.draft)
    setSyncedRevision(state.revision)
  }, [open, state.status, state.revision, state.draft, syncedRevision])

  const applyDraft = async (): Promise<void> => {
    const committed = await controller.save(draft)
    if (committed) setOpen(false)
  }
  const reset = async (): Promise<void> => {
    const committed = await controller.reset()
    if (committed) setOpen(false)
  }

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('plan-execute.title')}</div>
        {open && (
          <div className={css.panel}>
            {state.status === 'error' && (
              <div className={css.error}>{t('plan-execute.loadFailed')}：{state.error}</div>
            )}
            {state.status === 'ready' && !state.writable && (
              <div className={css.error}>{t('plan-execute.unavailable')}</div>
            )}
            <PhaseEditor
              label={t('plan-execute.planner')}
              draft={draft.planner}
              resolved={state.resolved.planner}
              groups={state.groups}
              disabled={!editable}
              onDraftChange={(planner) => { setDraft(s => ({ ...s, planner })) }}
              t={t}
            />
            <PhaseEditor
              label={t('plan-execute.executor')}
              draft={draft.executor}
              resolved={state.resolved.executor}
              groups={state.groups}
              disabled={!editable}
              onDraftChange={(executor) => { setDraft(s => ({ ...s, executor })) }}
              t={t}
            />
            <div className={css.hint}>{t('plan-execute.pickerHint')}</div>
            <div className={css.actions}>
              <Button variant="primary" size="sm" disabled={!editable} onClick={() => { void applyDraft() }}>
                {t('plan-execute.apply')}
              </Button>
              <Button size="sm" disabled={!editable} onClick={() => { void reset() }}>
                {t('plan-execute.reset')}
              </Button>
              {state.saved && <span className={css.saved}>{t('plan-execute.saved')}</span>}
              {state.saveError !== null && (
                <span className={css.error}>{t('plan-execute.saveFailed')}</span>
              )}
            </div>
          </div>
        )}
      </div>
      <button
        type="button"
        className={css.expander}
        aria-expanded={open}
        aria-label={t('plan-execute.title')}
        onClick={() => { setOpen(v => !v) }}
      >
        <svg className={css.chevron} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M4 5.5 7 8.5 10 5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}
