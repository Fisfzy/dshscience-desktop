/**
 * Helpers over the host-scoped `llm.models` catalog for the plan/execute
 * settings row: route encoding, lookup, and labels for inherit options.
 */
import type { ModelCatalogModel, ModelProviderGroup } from '@deepseek-ai/dsh-client-connection/client';
import type { PhaseDraft } from './settings-store.ts';
/**
 * Encode a provider/model pair for a `<select>` option value.
 * JSON so HTML option attributes never drop opaque separators (NUL is stripped).
 * @param provider - provider route id.
 * @param model - model id.
 * @returns opaque option value.
 */
export declare function encodeRoute(provider: string, model: string): string;
/**
 * Decode a route option value.
 * @param value - option value from the model select.
 * @returns provider and model, or undefined when the value is the inherit option.
 */
export declare function decodeRoute(value: string): {
    provider: string;
    model: string;
} | undefined;
/**
 * Find one model entry in the catalog.
 * @param groups - catalog groups from `llm.models`.
 * @param provider - provider route id.
 * @param model - model id.
 * @returns the catalog model, or undefined when absent.
 */
export declare function findCatalogModel(groups: readonly ModelProviderGroup[], provider: string, model: string): ModelCatalogModel | undefined;
/**
 * Build the select value for a phase draft: inherit when either id is blank.
 * @param draft - the phase draft.
 * @returns the option value.
 */
export declare function routeValueOf(draft: PhaseDraft): string;
/**
 * Human label for one catalog model option.
 * @param groupName - provider display name.
 * @param model - catalog model.
 * @returns option label.
 */
export declare function modelOptionLabel(groupName: string, model: ModelCatalogModel): string;
/**
 * Label for the inherit-default option, carrying the resolved (effective) route.
 * @param resolved - effective phase after defaults merge.
 * @param inheritLabel - localized "inherit defaults" stem.
 * @returns option label.
 */
export declare function inheritRouteLabel(resolved: PhaseDraft, inheritLabel: string): string;
/**
 * Label for the inherit-effort option when a model is chosen.
 * @param model - catalog model for the active route.
 * @param inheritLabel - localized stem.
 * @returns option label.
 */
export declare function inheritEffortLabel(model: ModelCatalogModel | undefined, inheritLabel: string): string;
//# sourceMappingURL=catalog.d.ts.map