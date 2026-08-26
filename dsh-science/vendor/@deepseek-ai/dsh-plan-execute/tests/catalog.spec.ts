/**
 * Catalog helpers for the plan/execute model pickers.
 */
import { describe, expect, it } from 'vitest'
import type { ModelProviderGroup } from '@deepseek-ai/dsh-client-connection/client'
import {
  decodeRoute,
  encodeRoute,
  findCatalogModel,
  inheritEffortLabel,
  inheritRouteLabel,
  routeValueOf,
} from '../src/client/catalog.ts'

const groups: ModelProviderGroup[] = [
  {
    id: 'deepseek-official',
    name: 'DeepSeek',
    models: [
      {
        id: 'deepseek-v4-pro',
        name: 'Pro',
        reasoning: { defaultEffort: 'high', efforts: [{ id: 'high', name: 'High' }] },
      },
    ],
  },
]

describe('catalog helpers', () => {
  it('round-trips route encoding', () => {
    const value = encodeRoute('deepseek-official', 'deepseek-v4-pro')
    expect(decodeRoute(value)).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    expect(decodeRoute('')).toBeUndefined()
  })

  it('finds catalog models and builds inherit labels', () => {
    expect(findCatalogModel(groups, 'deepseek-official', 'deepseek-v4-pro')?.name).toBe('Pro')
    expect(findCatalogModel(groups, 'missing', 'x')).toBeUndefined()
    expect(routeValueOf({ provider: '', model: 'x', reasoningEffort: '' })).toBe('')
    expect(routeValueOf({ provider: 'p', model: 'm', reasoningEffort: '' }))
      .toBe(encodeRoute('p', 'm'))
    expect(inheritRouteLabel(
      { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
      'Use defaults',
    )).toContain('deepseek-v4-pro')
    expect(inheritEffortLabel(
      findCatalogModel(groups, 'deepseek-official', 'deepseek-v4-pro'),
      'Model default',
    )).toContain('high')
  })
})
