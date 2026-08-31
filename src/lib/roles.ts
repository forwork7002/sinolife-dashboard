/**
 * Client-side role vocabulary.
 *
 * Mirrors `@/server/domain/types` — client code may not import from
 * `@/server/*`, so the union is restated here. It is small and stable, and the
 * server enum-parity assertion covers the database side.
 *
 * WHAT A ROLE IS, since it used to be more: what this account may CHANGE.
 * Which screens it opens is `sections`; how much of each it reads is
 * `dataScope`. See `src/server/auth/rbac.ts`.
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

/** What each role may change, in the words the admin screen needs. */
export const ROLE_HINTS: Readonly<Record<RoleValue, string>> = {
  ADMIN:
    'Hisoblarni ochadi va oʻchiradi, sinxronizatsiyani boshlaydi, KPI rejalarini tahrirlaydi.',
  MANAGER: 'KPI rejalarini tahrirlaydi va xodim kartochkasini ochadi. Hisoblarni boshqara olmaydi.',
  SALES: 'Faqat oʻqiydi — hech narsani oʻzgartira olmaydi.',
}

/**
 * Which nav destinations a role should see when NOTHING has been ticked.
 *
 * A starting point for an unconfigured account, not a security boundary — the
 * account's granted sections are what the server actually enforces, on the
 * page and at the endpoint alike.
 */
const ALL_ROUTES = [
  '/',
  '/analytics/cohort',
  '/logistics',
  '/analytics/sales',
  '/confirmation',
  '/warehouse',
  '/kpi',
  '/structure',
  '/sellers',
  '/margin',
  '/marketing',
] as const

export const ROLE_NAV: Readonly<Record<RoleValue, readonly string[]>> = {
  ADMIN: ALL_ROUTES,
  MANAGER: ALL_ROUTES,
  /**
   * A salesperson's starting set, until an administrator ticks otherwise.
   *
   * Withheld by default: finance, margin and the org chart — cost prices and
   * other people's headcount are not something to hand out without deciding
   * to. An administrator who wants any of them grants it per account, and the
   * account's data scope then decides whether it reads the company's figures
   * or only its own.
   */
  SALES: [
    '/',
    '/confirmation',
    '/logistics',
    '/kpi',
    // The standings, deliberately. A board a salesperson cannot see is a
    // board that cannot motivate one, and it exposes only aggregate
    // per-seller figures — no deals, no costs, no headcount.
    '/sellers',
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
