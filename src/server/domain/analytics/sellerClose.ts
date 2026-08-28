/**
 * The SELLER-CLOSE basis: "how much did this seller sell", answered honestly.
 *
 * WHY A SECOND BASIS HAD TO EXIST
 * Every money figure in this codebase is DELIVERED revenue — `countsAsRevenue`,
 * `status = WON`, bucketed by `closedAt`. That is money that actually landed,
 * and it is the right number for the company. It is NOT the seller's own act,
 * and the August 2026 portal says so out loud:
 *
 *   2 798 deals entered the seller's won stage in the month.
 *   3 729 deals entered Доставка's won stage in the same month.
 *   1 152 of them are the same deal.
 *
 * So 1 646 deals a seller closed had not been delivered by month end — the
 * seller does not appear to have sold them — and 2 577 delivered deals never
 * passed a seller's stage at all: База repeat orders, AI triage, deals typed
 * straight into Доставка. On a delivered-revenue board those 2 577 are credited
 * to whoever is assigned, and the seller who closed the other 1 646 is credited
 * with nothing.
 *
 * Both bases are legitimate. They answer different questions:
 *
 *   revenue / deals_won   -> what was DELIVERED and paid for in this window
 *   closed_value / closed_deals -> what the SELLER CLOSED in this window
 *
 * They must never be blended, averaged, or quietly substituted for each other.
 * Each is exposed as its own metric, and the row carries both so a reader can
 * see the gap rather than be handed whichever one flatters the page.
 *
 * WHAT AN EVENT IS
 * One `DealStageHistory` row whose stage is the WON stage of a SELLER pipeline,
 * with `enteredAt` inside the period. The stage holds ZERO deals at rest — a
 * robot moves the deal (the same deal id, not a copy) into Доставка within
 * seconds — so the history row is the ONLY surviving trace of the sale. Reading
 * `Deal.stageId` for this would return zero every time and look plausible.
 *
 * HOW THE STAGE IS RESOLVED — NEVER 'C12:WON'
 * `SELLER_PIPELINE_ROLES` below names a `PipelineRole`, and the repository asks
 * Postgres for the stages whose `category = 'WON'` inside the pipelines
 * carrying that role. A hardcoded external id is the thing most likely to break
 * silently when the portal is reconfigured: the id would simply stop matching,
 * every seller would score zero, and zero is a number a dashboard prints
 * without complaint. A role that resolves to no stage at all is reported as
 * UNRESOLVED (null figures, `resolved: false` in the response meta), which is a
 * state the page can refuse to render.
 *
 * WHY THE ASSIGNED EMPLOYEE IS THE SELLER
 * The robot moves the deal but does NOT reassign it: 11 of 11 sampled Доставка
 * deals were still assigned to a seller on a (ROP) team, none to logistics. So
 * crediting `Deal.employeeId` credits the person who closed it. The seller
 * roster, the branch scope and the SALES authorisation restriction all narrow
 * the same column, so this basis inherits every one of them unchanged.
 *
 * WHY EACH DEAL COUNTS ONCE
 * A deal can be pushed back into the funnel and re-won, writing a second
 * history row in the same month. That is one sale, not two. `tallySellerCloses`
 * keeps the EARLIEST event per deal id inside the window and drops the rest.
 *
 * THE LIMITATION, STATED RATHER THAN HIDDEN
 * `deal_stage_history` carries no amount. `closedValue` therefore sums the
 * deal's CURRENT `amountMinor`, not the amount it carried at the moment the
 * seller closed it. If an operator edits the sum afterwards — a discount, a
 * corrected quantity — this basis follows the edit and the figure moves. There
 * is no column that would let it do otherwise; the honest response is to say
 * so, which `SellerCloseBasisDto.amountBasis` does on every response.
 */

import { type Money, money, sumMoney, zeroMoney } from '@/server/domain/money/money'
import { type Period, containsInstant } from '@/server/domain/period/period'
import type { PipelineRoleValue } from '@/server/domain/types'
import {
  LEADERBOARD_METRICS,
  type LeaderboardEntry,
  type LeaderboardMetric,
  buildLeaderboard,
} from './performance'

// ---------------------------------------------------------------------------
// Resolving the stage
// ---------------------------------------------------------------------------

/**
 * Which pipelines are the SELLERS' own funnel.
 *
 * QUALIFICATION is Первичный отдел (#12) — see `PipelineRole` in
 * prisma/schema.prisma and the mapping table in
 * `integrations/crm/bitrix24/mapping.ts`, where the role is assigned from the
 * portal's category id ONCE, at import. Reading the role here means the seller
 * funnel can be reclassified with one `UPDATE pipeline SET role = …` instead of
 * a redeploy, and means this module never spells out an external id.
 *
 * A list rather than a single value because the portal has split a sales
 * department into two funnels before; QUALIFICATION is the only member today.
 *
 * A NOTE ON THE ROLE'S OWN COMMENT: the mapping file describes #12 as having
 * "zero won deals, ever". That is true of deals AT REST and false of the
 * history — it is precisely the observation this module exists to correct.
 */
export const SELLER_PIPELINE_ROLES: readonly PipelineRoleValue[] = Object.freeze([
  'QUALIFICATION',
])

/** One resolved seller-won stage, as the response meta names it. */
export interface SellerWonStage {
  readonly id: string
  readonly name: string
  /** The portal's own id (e.g. "C12:WON"). Reported, never matched on. */
  readonly externalId: string | null
  readonly pipelineName: string | null
}

// ---------------------------------------------------------------------------
// Events and totals
// ---------------------------------------------------------------------------

/**
 * One entry into a seller-won stage.
 *
 * `amountMinor` and `currency` are read from the DEAL, because the history row
 * has neither — see the limitation in the file header.
 */
export interface SellerCloseEvent {
  readonly dealId: string
  /** The deal's assigned employee: the seller. */
  readonly employeeId: string
  readonly enteredAt: Date
  readonly amountMinor: bigint
  readonly currency: string
}

export interface SellerCloseTotals {
  /** Distinct deals this employee closed in the window. */
  readonly closedCount: number
  readonly closedValue: Money
}

/** A seller who closed nothing. A real zero, not a missing measurement. */
export function emptySellerCloseTotals(currency: string): SellerCloseTotals {
  return { closedCount: 0, closedValue: zeroMoney(currency) }
}

/**
 * Tally events into per-employee totals, counting each deal ONCE.
 *
 * Dedup is per WINDOW, not global: a deal re-won in September is a September
 * close as well as an August one, and each month is asked its own question. The
 * earliest event inside the window wins; when two share an instant the first
 * encountered is kept, which changes nothing, because employee, amount and
 * currency all come from the one deal both rows point at.
 *
 * Events outside the period are filtered here rather than in SQL so the caller
 * can load the current and comparison windows in one query, exactly as
 * `findForAnalysis` does for deals.
 */
export function tallySellerCloses(
  events: readonly SellerCloseEvent[],
  period: Period,
  currency: string,
): Map<string, SellerCloseTotals> {
  const firstByDeal = new Map<string, SellerCloseEvent>()

  for (const event of events) {
    if (!containsInstant(period, event.enteredAt)) continue

    const seen = firstByDeal.get(event.dealId)
    if (seen === undefined || event.enteredAt.getTime() < seen.enteredAt.getTime()) {
      firstByDeal.set(event.dealId, event)
    }
  }

  const amountsByEmployee = new Map<string, Money[]>()
  for (const event of firstByDeal.values()) {
    const amounts = amountsByEmployee.get(event.employeeId) ?? []
    amounts.push(money(event.amountMinor, event.currency))
    amountsByEmployee.set(event.employeeId, amounts)
  }

  const totals = new Map<string, SellerCloseTotals>()
  for (const [employeeId, amounts] of amountsByEmployee) {
    totals.set(employeeId, {
      closedCount: amounts.length,
      // sumMoney throws on mixed currencies rather than adding tiyin to cents.
      closedValue: sumMoney(amounts, currency),
    })
  }

  return totals
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/** The two metrics this basis adds to the board. */
export const SELLER_CLOSE_METRICS = ['closed_deals', 'closed_value'] as const

export type SellerCloseMetric = (typeof SELLER_CLOSE_METRICS)[number]

/**
 * Every metric `?metric=` accepts, the four delivered-revenue ones first.
 *
 * Composed from `LEADERBOARD_METRICS` rather than re-listed, so the existing
 * four cannot drift out of the enum the route validates against.
 */
export const LEADERBOARD_METRICS_ALL = [
  ...LEADERBOARD_METRICS,
  ...SELLER_CLOSE_METRICS,
] as const

export type AnyLeaderboardMetric = LeaderboardMetric | SellerCloseMetric

export function isSellerCloseMetric(
  metric: AnyLeaderboardMetric,
): metric is SellerCloseMetric {
  return (SELLER_CLOSE_METRICS as readonly string[]).includes(metric)
}

/**
 * The slice of a row this basis ranks by.
 *
 * Both fields are NULLABLE and the two nulls mean the same thing: the seller
 * pipeline's won stage could not be resolved, so nothing was measured. That is
 * not zero, and a row must never claim a zero it did not count.
 */
export interface SellerCloseRankableRow {
  readonly employeeId: string
  readonly closedCount: number | null
  readonly closedValue: { readonly amountMinor: bigint | string } | null
}

function basisValue(row: SellerCloseRankableRow, metric: SellerCloseMetric): number | null {
  if (metric === 'closed_deals') return row.closedCount
  // Minor units as a Number, exactly as the `revenue` metric does. Lossless
  // below 2^53; a month of UZS closes is around 5·10^10 minor units.
  return row.closedValue === null ? null : Number(row.closedValue.amountMinor)
}

/**
 * Rank by the seller-close basis.
 *
 * WHY THIS PROJECTS INSTEAD OF SORTING AGAIN
 * `buildLeaderboard` owns the ranking semantics of this product: nulls last
 * because "no data" is not an achievement, equal values sharing a rank in
 * competition style, and a stable id tie-break so the order never shuffles
 * between loads. A second sort here would be a second copy of those rules, and
 * the day the two diverge the same board shows ties on one metric and not on
 * another. So the basis value is projected into the one `number | null` slot
 * `buildLeaderboard` reads — `current.conversionRatePercent`, a CARRIER here
 * and not a conversion rate — and the ranking runs once, where it is tested.
 *
 * `display` is then restored to the money object for `closed_value`, so the
 * entries handed back describe themselves truthfully even though the service
 * currently reads only `value`.
 *
 * WHEN NOTHING WAS MEASURED
 * An unresolved basis makes EVERY value null, and `buildLeaderboard` then puts
 * the whole board in id order with ranks 1..n. That order means nothing, and
 * nothing in `LeaderboardEntry` can say so — which is why the null `value` on
 * every row and `sellerCloseBasis.resolved = false` in the response meta are
 * the contract: a page must read the flag before it presents the standings.
 *
 * THE ONE-LINE VERSION OF THIS FUNCTION lives in `performance.ts` the moment
 * that file can take two more `LEADERBOARD_METRICS` entries, two more
 * `RankableRow` fields and two more `switch` cases; see the report accompanying
 * this change. Everything here is the adapter, not the rule.
 */
export function rankBySellerClose(
  rows: readonly SellerCloseRankableRow[],
  metric: SellerCloseMetric,
): LeaderboardEntry[] {
  const projected = rows.map((row) => ({
    employeeId: row.employeeId,
    current: {
      // Both required by RankableRow and both unread on the 'conversion' path.
      revenue: { amountMinor: 0n },
      dealsWon: 0,
      conversionRatePercent: basisValue(row, metric),
    },
  }))

  const byEmployee = new Map(rows.map((row) => [row.employeeId, row]))

  return buildLeaderboard(projected, 'conversion').map((entry) => ({
    ...entry,
    display:
      metric === 'closed_value'
        ? (byEmployee.get(entry.employeeId)?.closedValue ?? null)
        : entry.value,
  }))
}
