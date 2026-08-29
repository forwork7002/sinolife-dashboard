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
 * THE ROLE STILL BINDS. Sections can only ever NARROW what a role allows: a
 * SALES account granted the Moliya section still cannot read finance, because
 * the role has no `finance:read` permission and the endpoint checks that
 * first. Sections are the second gate, not a way around the first.
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
  { id: 'cohort', route: '/analytics/cohort', label: 'Kogorta tahlili', group: 'Tahlil' },
  { id: 'sales', route: '/analytics/sales', label: 'Summa — vizual', group: 'Tahlil' },
  { id: 'margin', route: '/margin', label: 'Yalpi marja', group: 'Tahlil' },
  { id: 'confirmation', route: '/confirmation', label: 'Tasdiqlash hisobotlari', group: 'Bajarish' },
  { id: 'logistics', route: '/logistics', label: 'Logistika %', group: 'Bajarish' },
  { id: 'warehouse', route: '/warehouse', label: 'Sklad qoldiqlari', group: 'Bajarish' },
  { id: 'kpi', route: '/kpi', label: 'Yanovskiy tizimi bahosi', group: 'Jamoa' },
  { id: 'structure', route: '/structure', label: 'Struktura — kim bor, kim yoʻq', group: 'Jamoa' },
  { id: 'marketing', route: '/marketing', label: 'Roistat analitikasi', group: 'Marketing' },
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

export function sectionForRoute(route: string): SectionValue | undefined {
  return BY_ROUTE.get(route)
}

export function sectionSpec(id: SectionValue): SectionSpec | undefined {
  return BY_ID.get(id)
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
