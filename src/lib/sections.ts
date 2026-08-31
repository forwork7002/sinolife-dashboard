/**
 * The dashboard's sections, as a per-account permission.
 *
 * A role says what KIND of user someone is; this says which screens they were
 * actually given. The two are deliberately separate: the client asked for
 * "everyone's access different", which a fixed three-role ladder cannot
 * express — one manager reads Tasdiqlash and Logistika, another reads Moliya,
 * and neither is a new role.
 *
 * HOW THE TWO COMBINE. An account with no explicit sections falls back to its
 * role's default set, so every account that existed before this feature keeps
 * exactly the access it had. Ticking any section switches that account to the
 * explicit list. Clearing the list returns it to the role default rather than
 * locking the person out of everything — an empty list is "not configured",
 * never "denied everything".
 *
 * SECTIONS ARE THE REACH BOUNDARY, end to end. The page guard redirects and
 * `getHandler` refuses, so a screen that was never ticked cannot be opened by
 * typing its URL or reached by calling its endpoint. What a granted screen
 * then SHOWS is the account's `dataScope`: the whole company, or one linked
 * salesperson's records. A screen that only exists company-wide is named in
 * COMPANY_WIDE below and refuses an OWN-scoped account rather than drawing
 * itself blank.
 *
 * Client-safe: no server imports. `src/server/auth/sections.ts` re-exports
 * these for the enforcement side so the two lists cannot drift.
 */

import { ROLE_NAV, type RoleValue } from './roles'

export interface SectionSpec {
  readonly id: SectionValue
  /** The page it unlocks. Also the key the nav filter matches on. */
  readonly route: string
  readonly label: string
  /** The nav group it sits in, so the admin screen reads like the sidebar. */
  readonly group: string
}

export const SECTIONS = [
  /*
    The command centre. Not one of the director's nine — it is the screen ABOVE
    them: the summary that answers "what is happening" and hands off to the
    module that answers "why". First, because it is where `/` lands and the
    first thing every role that holds it should see.
  */
  { id: 'overview', route: '/', label: 'Boshqaruv markazi', group: 'Asosiy' },
  { id: 'cohort', route: '/analytics/cohort', label: 'Mijoz qaytishi', group: 'Tahlil' },
  { id: 'sales', route: '/analytics/sales', label: 'Savdo dinamikasi', group: 'Tahlil' },
  { id: 'margin', route: '/margin', label: 'Yalpi marja', group: 'Tahlil' },
  { id: 'confirmation', route: '/confirmation', label: 'Tasdiqlash navbati', group: 'Bajarish' },
  { id: 'logistics', route: '/logistics', label: 'Logistika natijasi', group: 'Bajarish' },
  { id: 'warehouse', route: '/warehouse', label: 'Joʻnatish nuqtalari', group: 'Bajarish' },
  { id: 'kpi', route: '/kpi', label: 'KPI rejalari', group: 'Jamoa' },
  { id: 'structure', route: '/structure', label: 'Kadrlar tuzilmasi', group: 'Jamoa' },
  { id: 'sellers', route: '/sellers', label: 'Sotuvchilar reytingi', group: 'Jamoa' },
  { id: 'marketing', route: '/marketing', label: 'Reklama samarasi', group: 'Marketing' },
] as const satisfies readonly {
  id: string
  route: string
  label: string
  group: string
}[]

export type SectionValue = (typeof SECTIONS)[number]['id']

export const SECTION_IDS: readonly SectionValue[] = SECTIONS.map((s) => s.id)

const BY_ROUTE = new Map<string, SectionValue>(SECTIONS.map((s) => [s.route, s.id]))
const BY_ID = new Map<string, SectionSpec>(SECTIONS.map((s) => [s.id, s]))

/**
 * The screens that only exist company-wide.
 *
 * Their endpoints aggregate across everyone — a confirmation queue, a
 * logistics funnel, a margin ladder — and take no employee filter, so there is
 * no honest answer to give an account scoped to one salesperson: the company's
 * figures would leak, and a blank page would lie. Those endpoints ask for
 * `analytics:read:all`, which an OWN-scoped account does not hold, and refuse.
 *
 * PRESENTATION ONLY, and a mirror rather than the rule — the refusal happens
 * at the endpoint. Naming them here is what lets the admin screen say so
 * BEFORE the account is saved, instead of the administrator hearing it from a
 * colleague who cannot open a page they were told they had.
 */
const COMPANY_WIDE: ReadonlySet<string> = new Set<SectionValue>([
  'overview',
  'cohort',
  'margin',
  'confirmation',
  'logistics',
  'warehouse',
])

export function sectionForRoute(route: string): SectionValue | undefined {
  return BY_ROUTE.get(route)
}

export function sectionSpec(id: SectionValue): SectionSpec | undefined {
  return BY_ID.get(id)
}

/** The sections an OWN-scoped account cannot be served. */
export function companyWideSections(ids: readonly string[]): readonly SectionSpec[] {
  return SECTIONS.filter((spec) => COMPANY_WIDE.has(spec.id) && ids.includes(spec.id))
}

/**
 * What a role sees when nothing has been ticked for the account.
 *
 * Derived from ROLE_NAV rather than restated, so the pre-existing role policy
 * remains the single definition of it. `/marketing` is absent from ROLE_NAV
 * today and therefore absent here too — this file does not quietly widen
 * anyone's access; an admin who wants it grants it per account.
 */
export function defaultSectionsFor(role: RoleValue): readonly SectionValue[] {
  return ROLE_NAV[role]
    .map((route) => BY_ROUTE.get(route))
    .filter((id): id is SectionValue => id !== undefined)
}

/**
 * The sections an account may actually open.
 *
 * Empty explicit list means "not configured" and falls back to the role.
 * Unknown ids are dropped rather than trusted: a section removed from the
 * product must not keep granting anything because a stale row still names it.
 */
export function effectiveSections(
  role: RoleValue,
  explicit: readonly string[] | null | undefined,
): readonly SectionValue[] {
  const chosen = (explicit ?? []).filter((id): id is SectionValue => BY_ID.has(id))
  return chosen.length > 0 ? chosen : defaultSectionsFor(role)
}
