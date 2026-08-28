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
const ALL_ROUTES = [
  '/',
  '/analytics/sales',
  '/analytics/channels',
  '/analytics/cohort',
  '/products',
  '/margin',
  '/logistics',
  '/confirmation',
  '/warehouse',
  '/leaderboard',
  '/employees',
  '/structure',
  '/calls',
  '/kpi',
  '/deals',
  '/finance',
] as const

export const ROLE_NAV: Readonly<Record<RoleValue, readonly string[]>> = {
  ADMIN: ALL_ROUTES,
  MANAGER: ALL_ROUTES,
  /**
   * A salesperson gets their own numbers and the standings.
   *
   * Withheld: finance, margin and the org chart — cost prices and other
   * people's headcount are not theirs to read. The deals and analytics they do
   * see are scoped to their own records in SQL, so the narrowing is real and
   * not just a hidden link.
   */
  SALES: [
    '/',
    '/analytics/sales',
    '/products',
    '/leaderboard',
    '/deals',
    '/kpi',
    '/calls',
    '/logistics',
    '/confirmation',
  ],
}

export function canSee(role: RoleValue, href: string): boolean {
  return ROLE_NAV[role].includes(href)
}

/**
 * Whether a nav destination should render for this viewer.
 *
 * Prefers the account's granted sections and falls back to the role while the
 * viewer payload is still loading, so the sidebar does not flash a set of
 * links and then take half of them away. Presentation only: `requireSection`
 * on the page is what actually refuses entry.
 */
export function canSeeHref(
  role: RoleValue,
  grantedRoutes: readonly string[] | undefined,
  href: string,
): boolean {
  return grantedRoutes ? grantedRoutes.includes(href) : canSee(role, href)
}
