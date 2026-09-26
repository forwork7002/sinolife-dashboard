/**
 * One seller, several teams — folding the queue cohort's per-team slices back
 * into one row per person.
 *
 * WHY THERE ARE SLICES AT ALL. Since 2026-09-26 the queue cohort names an
 * order's team from the deal's own «Организация сотрудника (не удалять)» —
 * the team the portal stamped at the moment of sale — and only falls back to
 * the seller's department when that field is empty. It used to be the
 * department alone, and a seller who moved team dragged their whole month
 * across with them: on 01–25.09.2026, 22 orders and 53.9 mln of FAKT 1 sold
 * under Sevinchxon(ROP) were printed under Sadriddin. With the team on the
 * deal, one seller can hold orders under two names in one window, so the
 * rating statement groups by (seller, team) and hands back a slice for each.
 *
 * TWO READINGS OF THE SAME SLICES, and they must not be confused:
 *
 *   the team table sums the slices AS THEY ARE — each order counts for the
 *   team on its own deal card, which is the whole point of the change;
 *
 *   everything that prints a SELLER once (the board's rows, the payroll, the
 *   ranks) folds them here first. Two rows for one person would rank them
 *   twice, split their FAKT 2 across the payroll tiers and put one face on the
 *   podium twice.
 *
 * Pure: no framework, no database, no clock.
 */

/** The fields a slice must carry to be folded. `ConfirmationSellerRatingRow` has them all. */
export interface SellerTeamSlice {
  readonly employeeId: string
  readonly rop: string | null
  /** The slice's newest arrival in the queue. Absent reads as the oldest. */
  readonly lastQueuedAt?: Date | null
  readonly cohortOrders: number
  readonly confirmedOrders: number
  readonly confirmedMinor: bigint
  readonly deliveredOrders: number
  readonly deliveredMinor: bigint
  readonly inTransitOrders: number
  readonly inTransitMinor: bigint
  readonly lostAfterConfirmOrders: number
  readonly lostAfterConfirmMinor: bigint
  readonly rejectedOrders: number
  readonly byOutcome: Readonly<Record<string, number>>
  readonly byOutcomeMinor: Readonly<Record<string, bigint>>
}

/**
 * One row per seller, every figure summed across their slices.
 *
 * THE LABEL IS THE TEAM OF THEIR NEWEST ORDER THAT NAMES ONE. A seller who
 * moved from Sevinchxon to Sadriddin on the 20th is Sadriddin's now, and that
 * is the badge the floor expects beside their name; the money they made for
 * Sevinchxon stays with Sevinchxon in the team table regardless. A null team
 * never wins over a named one — a seller whose latest order carried no field
 * and whose department is not a ROP is still somebody's seller.
 *
 * Order is preserved by first appearance, so a caller that sorts afterwards
 * (every caller does) sees no difference, and a seller with one slice comes
 * back as that very object.
 */
export function mergeSellerTeamSlices<T extends SellerTeamSlice>(slices: readonly T[]): T[] {
  const byEmployee = new Map<string, T[]>()
  for (const slice of slices) {
    const group = byEmployee.get(slice.employeeId)
    if (group) group.push(slice)
    else byEmployee.set(slice.employeeId, [slice])
  }

  return [...byEmployee.values()].map((group) => (group.length === 1 ? group[0]! : fold(group)))
}

function fold<T extends SellerTeamSlice>(group: readonly T[]): T {
  const label = currentTeam(group)
  const sum = (pick: (s: T) => number) => group.reduce((a, s) => a + pick(s), 0)
  const sumMinor = (pick: (s: T) => bigint) => group.reduce((a, s) => a + pick(s), 0n)

  const byOutcome: Record<string, number> = {}
  const byOutcomeMinor: Record<string, bigint> = {}
  for (const slice of group) {
    for (const [state, count] of Object.entries(slice.byOutcome)) {
      byOutcome[state] = (byOutcome[state] ?? 0) + count
    }
    for (const [state, amount] of Object.entries(slice.byOutcomeMinor)) {
      byOutcomeMinor[state] = (byOutcomeMinor[state] ?? 0n) + amount
    }
  }

  return {
    ...label,
    cohortOrders: sum((s) => s.cohortOrders),
    confirmedOrders: sum((s) => s.confirmedOrders),
    confirmedMinor: sumMinor((s) => s.confirmedMinor),
    deliveredOrders: sum((s) => s.deliveredOrders),
    deliveredMinor: sumMinor((s) => s.deliveredMinor),
    inTransitOrders: sum((s) => s.inTransitOrders),
    inTransitMinor: sumMinor((s) => s.inTransitMinor),
    lostAfterConfirmOrders: sum((s) => s.lostAfterConfirmOrders),
    lostAfterConfirmMinor: sumMinor((s) => s.lostAfterConfirmMinor),
    rejectedOrders: sum((s) => s.rejectedOrders),
    byOutcome,
    byOutcomeMinor,
  }
}

/**
 * The slice whose team the folded row wears: named teams before null, then
 * the newest arrival, then the most orders, then the name — so the answer
 * does not depend on the order the database happened to return the slices in.
 */
function currentTeam<T extends SellerTeamSlice>(group: readonly T[]): T {
  const time = (s: T) => s.lastQueuedAt?.getTime() ?? Number.NEGATIVE_INFINITY
  return [...group].sort(
    (a, b) =>
      Number(a.rop === null) - Number(b.rop === null) ||
      time(b) - time(a) ||
      b.cohortOrders - a.cohortOrders ||
      (a.rop ?? '').localeCompare(b.rop ?? ''),
  )[0]!
}
