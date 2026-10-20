/**
 * The payroll's blocks — the client, 2026-10-20: «baza roplarga alohida
 * bo'lim, Toshkentga, Navoiyga alohida bo'lim», one table «huddi RNP jadvali
 * kabi». A ROP team belongs to the block its portal unit sits under.
 *
 * БАЗА FIRST, BY THE TEAM. «Baza(ROP)» is filed under «Навоий» on the portal
 * and «Malika(ROP)» (the Zextra base) under «Зехтра отдел продаж», yet both
 * are the Baza block — `isBaseTeam`, the same two teams /rnp and Roistat call
 * БАЗА. Every other team goes by the nearest ancestor unit that names a
 * branch: «Тошкент», «Навоий», «Зехтра отдел продаж». A label the tree does
 * not know (an old snapshot name, the no-team bucket) is «Boshqa» — printed,
 * never dropped.
 *
 * Pure: the ancestor names come in from the repository.
 */

import { TEAM_ALIASES, isBaseTeam } from '@/server/domain/rnp/rnpSheet'

/** The blocks, in the order the table prints them. */
export const PAYROLL_BRANCHES = ['toshkent', 'navoiy', 'baza', 'zextra', 'other'] as const
export type PayrollBranch = (typeof PAYROLL_BRANCHES)[number]

export const PAYROLL_BRANCH_LABEL: Readonly<Record<PayrollBranch, string>> = Object.freeze({
  toshkent: 'Toshkent',
  navoiy: 'Navoiy',
  baza: 'Baza',
  zextra: 'Zextra',
  other: 'Boshqa',
})

/** A unit name that names a branch. Cyrillic as the portal writes it, Latin in case it is renamed. */
const BRANCH_NAMES: readonly (readonly [RegExp, PayrollBranch])[] = [
  [/тошкент|ташкент|toshkent|tashkent/iu, 'toshkent'],
  [/навои|navoi/iu, 'navoiy'],
  [/зехтра|zextra/iu, 'zextra'],
]

/**
 * The block a ROP team is printed in. `ancestors` maps a team label (as
 * `ropNameSql` prints it) to its unit's ancestors' names, nearest first.
 */
export function payrollBranchOf(
  rop: string | null,
  ancestors: ReadonlyMap<string, readonly string[]>,
): PayrollBranch {
  if (rop === null) return 'other'
  if (isBaseTeam(rop)) return 'baza'
  const names = ancestors.get(rop) ?? ancestors.get(TEAM_ALIASES[rop] ?? rop) ?? []
  for (const name of names) {
    for (const [pattern, branch] of BRANCH_NAMES) if (pattern.test(name)) return branch
  }
  return 'other'
}
