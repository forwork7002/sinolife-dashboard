/**
 * Permission sets used by route handlers.
 *
 * Named here so the same combination is never spelled out twice across routes
 * and cannot drift between two endpoints that ought to share a rule.
 */

import type { Permission } from '@/server/auth/rbac'

/** Any analytics surface: access for both roles, data narrowed by scope. */
export const ANALYTICS_READ: readonly Permission[] = [
  'analytics:read:all',
  'analytics:read:own',
]

export const DEALS_READ: readonly Permission[] = ['deals:read:all', 'deals:read:own']

export const KPI_READ: readonly Permission[] = ['kpi:read:all', 'kpi:read:own']
