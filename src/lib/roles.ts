/**
 * Client-side role vocabulary.
 *
 * Mirrors `@/server/domain/types` — client code may not import from
 * `@/server/*`, so the union is restated here. It is small and stable, and the
 * server enum-parity assertion covers the database side.
 *
 * These labels drive presentation only. Authorisation is decided server-side.
 */

export const ROLE_VALUES = ['ADMIN', 'MANAGER', 'SALES'] as const
export type RoleValue = (typeof ROLE_VALUES)[number]

export const ROLE_LABELS: Readonly<Record<RoleValue, string>> = {
  ADMIN: 'Administrator',
  MANAGER: 'Menejer',
  SALES: 'Savdo xodimi',
}

/**
 * Which nav destinations a role should see.
 *
 * A convenience for the UI, not a security boundary — the server rejects any
 * request the role is not entitled to regardless of what is rendered.
 */
export const ROLE_NAV: Readonly<Record<RoleValue, readonly string[]>> = {
  ADMIN: ['/', '/analytics/sales', '/products', '/finance', '/employees', '/leaderboard', '/deals', '/kpi'],
  MANAGER: ['/', '/analytics/sales', '/products', '/finance', '/employees', '/leaderboard', '/deals', '/kpi'],
  // A salesperson gets their own numbers and the standings; no finance.
  SALES: ['/', '/analytics/sales', '/products', '/leaderboard', '/deals', '/kpi'],
}

export function canSee(role: RoleValue, href: string): boolean {
  return ROLE_NAV[role].includes(href)
}
