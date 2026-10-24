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

/**
 * «ROP yoʻq» as a filter value. A team label is the portal's prose and can be
 * anything, so the no-team bucket is spelled in parentheses like
 * `(Region yoʻq)` on the confirmation board — a name no «(ROP)» unit strips to.
 */
export const PAYROLL_NO_ROP_PICK = '(ROP yoʻq)'

/**
 * Which teams a payroll is narrowed to — the toolbar's «Boʻlim» and «ROP»
 * (the client, 2026-10-24: «rop lar boʻyicha filtr … eng kerakli filtrlar
 * tepa panelga»). Empty or absent is everybody; both given is both at once.
 */
export interface PayrollPick {
  readonly rops?: readonly string[]
  readonly blocks?: readonly PayrollBranch[]
}

/** Whether a pick narrows anything. */
export function isPayrollPicked(pick: PayrollPick): boolean {
  return (pick.rops?.length ?? 0) > 0 || (pick.blocks?.length ?? 0) > 0
}

/**
 * The pick as a test on a TEAM LABEL — the label a row, a slice or a previous
 * row wears — so a team is kept or dropped whole and its ROP's basis with it.
 * The block is the label's own (`payrollBranchOf`), the one the sheet prints
 * it under.
 */
export function payrollPickTest(
  pick: PayrollPick,
  ancestors: ReadonlyMap<string, readonly string[]>,
): (rop: string | null) => boolean {
  const rops = pick.rops?.length ? new Set(pick.rops) : null
  const blocks = pick.blocks?.length ? new Set<PayrollBranch>(pick.blocks) : null
  return (rop) =>
    (rops === null || rops.has(rop ?? PAYROLL_NO_ROP_PICK)) &&
    (blocks === null || blocks.has(payrollBranchOf(rop, ancestors)))
}

/** The pick as a memo key part: order-free, so `a,b` and `b,a` are one answer. */
export function payrollPickKey(pick: PayrollPick): string {
  const part = (values: readonly string[] | undefined) => [...new Set(values ?? [])].sort().join(',')
  return `r:${part(pick.rops)}|b:${part(pick.blocks)}`
}
