/**
 * Helpers over the host-scoped `llm.models` catalog for the plan/execute
 * settings row: route encoding, lookup, and labels for inherit options.
 */
import type { ModelCatalogModel, ModelProviderGroup } from '@deepseek-ai/dsh-client-connection/client'
import type { PhaseDraft } from './settings-store.ts'

/**
 * Encode a provider/model pair for a `<select>` option value.
 * JSON so HTML option attributes never drop opaque separators (NUL is stripped).
 * @param provider - provider route id.
 * @param model - model id.
 * @returns opaque option value.
 */
export function encodeRoute(provider: string, model: string): string {
  return JSON.stringify([provider, model])
}

/**
 * Decode a route option value.
 * @param value - option value from the model select.
 * @returns provider and model, or undefined when the value is the inherit option.
 */
export function decodeRoute(value: string): { provider: string; model: string } | undefined {
  if (value === '') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (
      Array.isArray(parsed)
      && parsed.length === 2
      && typeof parsed[0] === 'string'
      && typeof parsed[1] === 'string'
      && parsed[0] !== ''
      && parsed[1] !== ''
    ) {
      return { provider: parsed[0], model: parsed[1] }
    }
  } catch {
    // Not a catalog route value.
  }
  return undefined
}

/**
 * Find one model entry in the catalog.
 * @param groups - catalog groups from `llm.models`.
 * @param provider - provider route id.
 * @param model - model id.
 * @returns the catalog model, or undefined when absent.
 */
export function findCatalogModel(
  groups: readonly ModelProviderGroup[],
  provider: string,
  model: string,
): ModelCatalogModel | undefined {
  const group = groups.find(g => g.id === provider)
  return group?.models.find(m => m.id === model)
}

/**
 * Build the select value for a phase draft: inherit when either id is blank.
 * @param draft - the phase draft.
 * @returns the option value.
 */
export function routeValueOf(draft: PhaseDraft): string {
  if (draft.provider.trim() === '' || draft.model.trim() === '') return ''
  return encodeRoute(draft.provider.trim(), draft.model.trim())
}

/**
 * Human label for one catalog model option.
 * @param groupName - provider display name.
 * @param model - catalog model.
 * @returns option label.
 */
export function modelOptionLabel(groupName: string, model: ModelCatalogModel): string {
  return model.name === model.id ? `${groupName} / ${model.id}` : `${groupName} / ${model.name} (${model.id})`
}

/**
 * Label for the inherit-default option, carrying the resolved (effective) route.
 * @param resolved - effective phase after defaults merge.
 * @param inheritLabel - localized "inherit defaults" stem.
 * @returns option label.
 */
export function inheritRouteLabel(resolved: PhaseDraft, inheritLabel: string): string {
  const parts = [resolved.provider, resolved.model, resolved.reasoningEffort].filter(p => p.trim() !== '')
  return parts.length === 0 ? inheritLabel : `${inheritLabel}（${parts.join(' · ')}）`
}

/**
 * Label for the inherit-effort option when a model is chosen.
 * @param model - catalog model for the active route.
 * @param inheritLabel - localized stem.
 * @returns option label.
 */
export function inheritEffortLabel(model: ModelCatalogModel | undefined, inheritLabel: string): string {
  const def = model?.reasoning?.defaultEffort
  return def === undefined || def === '' ? inheritLabel : `${inheritLabel}（${def}）`
}
