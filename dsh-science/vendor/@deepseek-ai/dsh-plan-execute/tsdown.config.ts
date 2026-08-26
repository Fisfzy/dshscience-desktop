import { clientBundle } from '../../client/tsdown.client.ts'

/**
 * Dual-face package: host library (plan/execute routing) + browser client
 * bundle (settings row). Same layout as directory-picker-browse — both
 * halves emit on the client build face after package tsc.
 */
export default clientBundle(
  '@deepseek-ai/dsh-plan-execute',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
