/**
 * The sellers' board — ranking, teams, bonus tiers and the month's run-rate.
 *
 * It composes what `SellerBoardRepository` reads and adds the three judgements
 * the client's own dashboard makes, each kept explicitly separate from the
 * measurement it is applied to:
 *
 *   1. RANK, by money won from the period's own intake.
 *   2. TEAM, by the ROP the seller's department names.
 *   3. BONUS, by the client's published tiers.
 *
 * The bonus tiers are THEIRS, transcribed from the `bonusInfo()` function on
 * their page and not invented here: 45 mln so'm earns 1 mln, 60 mln earns
 * 1.5 mln, 70 mln earns 2 mln, measured against `fact2` (won intake). A tier
 * table this consequential does not get re-derived from a screenshot — it is
 * quoted, and the source is named on screen so anyone can check it.
 *
 * WHAT IS DELIBERATELY ABSENT: the PLAN, and with it plan-completion. Their
 * page carries a `plan` column and this database cannot: the `kpi` and
 * `kpi_result` tables hold zero rows, so every plan figure would be an em
 * dash or, worse, a zero that reads as "missed the target". The board says so
 * rather than showing a column of nothing.
 */

import {
  SHARE_DECIMALS,
  growth,
  ratePercent,
  roundPercent,
  toDeltaDto,
} from '@/server/domain/analytics/metrics'
import { periodElapsedFraction } from '@/server/domain/analytics/performance'
import { type MoneyDto, money, toMoneyDto } from '@/server/domain/money/money'
import type { Period } from '@/server/domain/period/period'
import type { DeltaDto } from '@/lib/api'
import type { InsightsRepository } from '@/server/repositories/insightsRepository'
import type {
  SellerBoardFilters,
  SellerBoardRepository,
  SellerBoardRow,
} from '@/server/repositories/sellerBoardRepository'
import type { AnalyticsContext } from './analyticsService'

/**
 * Which clock the board reads. See `SellerBoardDto.basis` for what each
 * value means to the reader; this is the API-level switch that picks it.
 */
export const SELLER_BOARD_BASES = ['queue', 'intake'] as const
export type SellerBoardBasisValue = (typeof SELLER_BOARD_BASES)[number]

// ---------------------------------------------------------------------------
// The client's bonus ladder, quoted
// ---------------------------------------------------------------------------

/**
 * From `bonusInfo()` on the client's published sellers dashboard.
 *
 * Descending, because the reading is "the highest tier whose floor you have
 * cleared" — evaluating ascending would award the first match and pay 1 mln
 * to a seller who earned 2.
 */
export const BONUS_TIERS: readonly { readonly floorMinor: bigint; readonly bonusMinor: bigint }[] =
  Object.freeze([
    { floorMinor: 7_000_000_000n, bonusMinor: 200_000_000n },
    { floorMinor: 6_000_000_000n, bonusMinor: 150_000_000n },
    { floorMinor: 4_500_000_000n, bonusMinor: 100_000_000n },
  ])

// ---------------------------------------------------------------------------
// DTOs — mirrored in src/lib/api.ts, which the client imports instead.
// ---------------------------------------------------------------------------

export interface SellerBonusDto {
  /** So'm earned at the tier already cleared. Zero below the first floor. */
  readonly earned: MoneyDto
  /** The next floor up, or null when the top tier is already cleared. */
  readonly nextFloor: MoneyDto | null
  /** What the next tier would pay. Null with nextFloor. */
  readonly nextBonus: MoneyDto | null
  /** How much more won intake the next tier needs. Null with nextFloor. */
  readonly toNext: MoneyDto | null
  /** Progress toward the next floor, 0-100. Null when the top tier is cleared. */
  readonly toNextPercent: number | null
}

export interface SellerBoardRowDto {
  readonly rank: number
  readonly employeeId: string
  readonly fullName: string
  readonly rop: string | null
  /** Orders taken in the period, cancellations excluded — their `trans`. */
  readonly orders: number
  /** Their value — their `fact1`. */
  readonly ordered: MoneyDto
  /** Of those, the ones won — their `fact2`. This is what rank and bonus read. */
  readonly won: MoneyDto
  readonly wonOrders: number
  /** Still open, already inside `ordered`: live work the seller is carrying. */
  readonly open: MoneyDto
  readonly openOrders: number
  readonly lostOrders: number
  /** wonOrders / (orders resolved so far), 0-100. Null when nothing resolved. */
  readonly conversionPercent: number | null
  /** This seller's share of the board's total won intake, 0-100. */
  readonly sharePercent: number | null
  readonly bonus: SellerBonusDto
}

export interface SellerTeamRowDto {
  readonly rank: number
  readonly rop: string
  readonly sellers: number
  readonly orders: number
  readonly ordered: MoneyDto
  readonly won: MoneyDto
  readonly wonOrders: number
  readonly open: MoneyDto
  readonly conversionPercent: number | null
  readonly sharePercent: number | null
}

export interface SellerBoardTotalsDto {
  readonly sellers: number
  readonly teams: number
  /**
   * Sellers with no ROP, and so on no team row.
   *
   * The teams tab divides by the WHOLE board, so without this the reader has
   * no way to see that the shares do not add to a hundred — six sellers and
   * 40.9 mln of intake were sitting outside every row on the screen.
   */
  readonly teamlessSellers: number
  readonly orders: number
  readonly ordered: MoneyDto
  readonly won: MoneyDto
  readonly wonOrders: number
  readonly open: MoneyDto
  readonly conversionPercent: number | null
  /** Won intake vs the comparison window's, on the same clock. */
  readonly wonDelta: DeltaDto
  /** Total bonus the tiers would pay on today's standings. */
  readonly bonusPayable: MoneyDto
  readonly sellersInBonus: number
}

export interface SellerBoardForecastDto {
  /** How much of the period has elapsed, 0-100. */
  readonly elapsedPercent: number
  /** Straight-line projection of won intake to the period's end. */
  readonly projected: MoneyDto | null
}

export interface SellerBoardDto {
  readonly rows: readonly SellerBoardRowDto[]
  readonly teams: readonly SellerTeamRowDto[]
  readonly totals: SellerBoardTotalsDto
  readonly forecast: SellerBoardForecastDto
  /**
   * The basis, stated in the payload so the screen cannot forget to print it.
   *
   * 'confirmation_queue' — FAKT 1 / FAKT 2, the floor's own vocabulary.
   *   `ordered` is Тасдиқланди (confirmed into Доставка), `won` is
   *   Доставланди (C6:WON), and everything is dated by the order's OWN
   *   arrival in C4:NEW — see `InsightsRepository.confirmationSellerRating`.
   * 'created_in_period' — the original reading, dated by the day the ORDER
   *   WAS TAKEN (`createdAtSource`) — see `SellerBoardRepository`.
   */
  readonly basis: 'confirmation_queue' | 'created_in_period'
}

export interface SellerDayDto {
  readonly date: string
  readonly orders: number
  readonly ordered: MoneyDto
  readonly won: MoneyDto
}

// ---------------------------------------------------------------------------

export class SellerBoardService {
  constructor(
    private readonly repo: SellerBoardRepository,
    private readonly insights: InsightsRepository,
  ) {}

  async board(ctx: AnalyticsContext, basis: SellerBoardBasisValue = 'queue'): Promise<SellerBoardDto> {
    const filters = boardFilters(ctx)

    // Both windows in parallel: the comparison exists only to give the total
    // a delta, and a second round trip could straddle a sync.
    const [rows, previous] = await Promise.all([
      this.rowsFor(ctx.period, basis, filters),
      this.rowsFor(ctx.comparison, basis, filters),
    ])

    const totalWonMinor = sum(rows, (r) => r.wonMinor)
    const previousWonMinor = sum(previous, (r) => r.wonMinor)

    /*
      Rank on won intake, descending, with the employee id as the tiebreak.
      The id rather than the name: two sellers on identical money must not
      swap places between two refreshes of the same screen, and a name sort
      would reorder on a rename.
    */
    const ordered = [...rows].sort(
      (a, b) =>
        (b.wonMinor > a.wonMinor ? 1 : b.wonMinor < a.wonMinor ? -1 : 0) ||
        a.employeeId.localeCompare(b.employeeId),
    )

    /*
      COMPETITION RANKING: equal money, equal rank, and the next rank skips.

      Position in the sorted list was the rank, so two sellers who had won the
      same amount — common at the start of a window, universal when nobody has
      won anything yet — were told one outranked the other, and the deciding
      factor was an internal id. `/analytics/leaderboard` already ranks the
      same people 1, 2, 2, 4; two boards of the same floor disagreeing about
      who is second is the kind of thing a bonus argument starts over.

      The id still decides DISPLAY order, so the table does not reshuffle
      between two refreshes of the same screen.
    */
    const rankOf = ordered.map((row, index) => {
      const previous = index > 0 ? ordered[index - 1] : undefined
      return previous && previous.wonMinor === row.wonMinor ? -1 : index + 1
    })
    for (let i = 1; i < rankOf.length; i++) {
      if (rankOf[i] === -1) rankOf[i] = rankOf[i - 1]!
    }

    const boardRows = ordered.map<SellerBoardRowDto>((row, index) => ({
      rank: rankOf[index]!,
      employeeId: row.employeeId,
      fullName: row.fullName,
      rop: row.rop,
      orders: row.orders,
      ordered: toMoneyDto(money(row.orderedMinor, ctx.currency)),
      won: toMoneyDto(money(row.wonMinor, ctx.currency)),
      wonOrders: row.wonOrders,
      open: toMoneyDto(money(row.openMinor, ctx.currency)),
      openOrders: row.openOrders,
      lostOrders: row.lostOrders,
      /*
        Resolved, not taken: an order still open has not failed, so counting
        it against the seller would make a busy week look like a bad one. The
        denominator is what has actually been decided.
      */
      conversionPercent: roundOrNull(ratePercent(row.wonOrders, row.wonOrders + row.lostOrders)),
      sharePercent: roundOrNull(ratePercent(row.wonMinor, totalWonMinor)),
      bonus: bonusFor(row.wonMinor, ctx.currency),
    }))

    return {
      rows: boardRows,
      teams: teamRows(rows, totalWonMinor, ctx.currency),
      totals: {
        sellers: rows.length,
        teams: new Set(rows.map((r) => r.rop).filter((r): r is string => r !== null)).size,
        teamlessSellers: rows.filter((r) => r.rop === null).length,
        orders: rows.reduce((a, r) => a + r.orders, 0),
        ordered: toMoneyDto(money(sum(rows, (r) => r.orderedMinor), ctx.currency)),
        won: toMoneyDto(money(totalWonMinor, ctx.currency)),
        wonOrders: rows.reduce((a, r) => a + r.wonOrders, 0),
        open: toMoneyDto(money(sum(rows, (r) => r.openMinor), ctx.currency)),
        conversionPercent: roundOrNull(
          ratePercent(
            rows.reduce((a, r) => a + r.wonOrders, 0),
            rows.reduce((a, r) => a + r.wonOrders + r.lostOrders, 0),
          ),
        ),
        wonDelta: toDeltaDto(growth(Number(totalWonMinor), Number(previousWonMinor))),
        bonusPayable: toMoneyDto(
          money(
            boardRows.reduce((a, r) => a + BigInt(r.bonus.earned.amountMinor), 0n),
            ctx.currency,
          ),
        ),
        sellersInBonus: boardRows.filter((r) => r.bonus.earned.amount > 0).length,
      },
      forecast: forecastOf(totalWonMinor, ctx),
      basis: basis === 'queue' ? 'confirmation_queue' : 'created_in_period',
    }
  }

  async sellerDays(
    ctx: AnalyticsContext,
    employeeId: string,
    basis: SellerBoardBasisValue = 'queue',
  ): Promise<readonly SellerDayDto[]> {
    if (basis === 'queue') {
      const days = await this.insights.confirmationSellerRatingDays(ctx.period, employeeId)
      return days.map((d) => ({
        date: d.date,
        orders: d.orders,
        ordered: toMoneyDto(money(d.confirmedMinor, ctx.currency)),
        won: toMoneyDto(money(d.deliveredMinor, ctx.currency)),
      }))
    }

    const days = await this.repo.sellerDays(ctx.period, employeeId, boardFilters(ctx))
    return days.map((d) => ({
      date: d.date,
      orders: d.orders,
      ordered: toMoneyDto(money(d.orderedMinor, ctx.currency)),
      won: toMoneyDto(money(d.wonMinor, ctx.currency)),
    }))
  }

  /** One row per operator, on whichever clock `basis` names. */
  private async rowsFor(
    period: Period,
    basis: SellerBoardBasisValue,
    filters: SellerBoardFilters,
  ): Promise<SellerBoardRow[]> {
    if (basis === 'intake') return this.repo.board(period, filters)

    const rows = await this.insights.confirmationSellerRating(period, filters)
    return rows.map(
      (r): SellerBoardRow => ({
        employeeId: r.employeeId,
        fullName: r.fullName,
        rop: r.rop,
        // Not carried: the confirmation-queue cohort already resolves `rop`
        // from the department name, and nothing downstream reads this field.
        departmentName: null,
        orders: r.confirmedOrders,
        orderedMinor: r.confirmedMinor,
        wonOrders: r.deliveredOrders,
        wonMinor: r.deliveredMinor,
        openOrders: r.inTransitOrders,
        openMinor: r.inTransitMinor,
        lostOrders: r.rejectedOrders,
      }),
    )
  }
}

// ---------------------------------------------------------------------------

/** Keep only the filters this board's SQL can honestly honour. */
function boardFilters(ctx: AnalyticsContext): SellerBoardFilters {
  return {
    employeeIds: ctx.filters.employeeIds,
    departmentIds: ctx.filters.departmentIds,
    sourceIds: ctx.filters.sourceIds,
    restrictToEmployeeId: ctx.filters.restrictToEmployeeId,
  }
}

/**
 * The tier already cleared, and the distance to the next one.
 *
 * Both halves matter to the person reading it: the first is what they have
 * earned, the second is the only actionable number on the row.
 */
function bonusFor(wonMinor: bigint, currency: string): SellerBonusDto {
  const cleared = BONUS_TIERS.find((tier) => wonMinor >= tier.floorMinor) ?? null
  const clearedIndex = cleared ? BONUS_TIERS.indexOf(cleared) : BONUS_TIERS.length
  // The tiers are descending, so the NEXT tier up is the entry before this one.
  const next = clearedIndex > 0 ? BONUS_TIERS[clearedIndex - 1]! : null

  return {
    earned: toMoneyDto(money(cleared?.bonusMinor ?? 0n, currency)),
    nextFloor: next ? toMoneyDto(money(next.floorMinor, currency)) : null,
    nextBonus: next ? toMoneyDto(money(next.bonusMinor, currency)) : null,
    toNext: next
      ? toMoneyDto(money(next.floorMinor > wonMinor ? next.floorMinor - wonMinor : 0n, currency))
      : null,
    toNextPercent: next ? roundOrNull(ratePercent(wonMinor, next.floorMinor)) : null,
  }
}

/** Sellers folded into their ROP's team, ranked the same way rows are. */
function teamRows(
  rows: readonly SellerBoardRow[],
  totalWonMinor: bigint,
  currency: string,
): readonly SellerTeamRowDto[] {
  const byRop = new Map<string, SellerBoardRow[]>()
  for (const row of rows) {
    // A seller off every ROP team is left out rather than bucketed into an
    // "Other" team: this table is about teams, and a bucket of people who
    // share only the absence of a manager is not one.
    if (row.rop === null) continue
    const group = byRop.get(row.rop)
    if (group) group.push(row)
    else byRop.set(row.rop, [row])
  }

  return [...byRop.entries()]
    .map(([rop, members]) => ({
      rop,
      members,
      wonMinor: sum(members, (m) => m.wonMinor),
    }))
    .sort(
      (a, b) =>
        (b.wonMinor > a.wonMinor ? 1 : b.wonMinor < a.wonMinor ? -1 : 0) ||
        a.rop.localeCompare(b.rop),
    )
    .map<SellerTeamRowDto>((team, index) => {
      const wonOrders = team.members.reduce((a, m) => a + m.wonOrders, 0)
      const lostOrders = team.members.reduce((a, m) => a + m.lostOrders, 0)
      return {
        rank: index + 1,
        rop: team.rop,
        sellers: team.members.length,
        orders: team.members.reduce((a, m) => a + m.orders, 0),
        ordered: toMoneyDto(money(sum(team.members, (m) => m.orderedMinor), currency)),
        won: toMoneyDto(money(team.wonMinor, currency)),
        wonOrders,
        open: toMoneyDto(money(sum(team.members, (m) => m.openMinor), currency)),
        conversionPercent: roundOrNull(ratePercent(wonOrders, wonOrders + lostOrders)),
        sharePercent: roundOrNull(ratePercent(team.wonMinor, totalWonMinor)),
      }
    })
}

/**
 * Straight-line run-rate for the period's won intake.
 *
 * Null once the period is over — a finished total is not a forecast — and
 * null below a 2% elapsed floor, where dividing by a sliver of a month
 * multiplies one early order into a fantasy.
 */
function forecastOf(wonMinor: bigint, ctx: AnalyticsContext): SellerBoardForecastDto {
  const elapsed = periodElapsedFraction(ctx.period, ctx.now)
  const usable = Number.isFinite(elapsed) && elapsed >= 0.02 && elapsed < 1
  return {
    elapsedPercent: roundPercent(Math.min(1, Math.max(0, elapsed)) * 100),
    projected: usable
      ? toMoneyDto(
          money(
            (wonMinor * BigInt(Math.round(1_000_000 / elapsed))) / 1_000_000n,
            ctx.currency,
          ),
        )
      : null,
  }
}

function sum<T>(rows: readonly T[], pick: (row: T) => bigint): bigint {
  return rows.reduce((total, row) => total + pick(row), 0n)
}

/**
 * A share of the board, kept precise enough to say it is not zero.
 *
 * Six sellers who had genuinely won money read "0.0%" beside the eight who had
 * won none — see SHARE_DECIMALS.
 */
function roundOrNull(value: number | null): number | null {
  return value === null ? null : roundPercent(value, SHARE_DECIMALS)
}
