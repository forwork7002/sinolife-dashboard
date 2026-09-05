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
 * The bonus tiers are THEIRS, transcribed in `domain/analytics/sellerBonus`
 * together with the band their `idInRange()` gates the ladder on — see that
 * module for both, and for why the gate is worth carrying.
 *
 * THE PLAN IS WIRED, AND IS EMPTY. Their page carries `plan` and `plandone`,
 * and this application's only honest source for a target is the `kpi` table,
 * which nothing writes to today — no sync handler, no seed, no admin screen.
 * So the column is real, reads the same rows `/kpi` reads, obeys the same
 * containment rule, and renders an em dash until somebody puts targets in.
 * It is deliberately NOT a zero: a zero in a plan column reads as "missed the
 * target", which is a different and much louder claim than "no target set".
 */

import {
  SHARE_DECIMALS,
  growth,
  ratePercent,
  roundPercent,
  toDeltaDto,
} from '@/server/domain/analytics/metrics'
import { type KpiDefinition, periodElapsedFraction } from '@/server/domain/analytics/performance'
import { BONUS_TIERS, bonusEligible } from '@/server/domain/analytics/sellerBonus'
import { type MoneyDto, money, toMoneyDto } from '@/server/domain/money/money'
import { scopedPeriod } from '@/server/domain/employees/branches'
import type { Period } from '@/server/domain/period/period'
import type { DeltaDto } from '@/lib/api'
import type { InsightsRepository } from '@/server/repositories/insightsRepository'
import type { ReferenceRepository } from '@/server/repositories/referenceRepository'
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

// Re-exported so the ladder keeps one import path for callers that already
// reach for it here; the rule itself lives in domain/analytics/sellerBonus.
export { BONUS_TIERS } from '@/server/domain/analytics/sellerBonus'

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
  /**
   * Whether the client's ladder pays this operator at all.
   *
   * False leaves every field above at its empty value, so a caller that
   * ignores this flag still cannot print a bonus for somebody outside the
   * band — see `bonusEligible` for the band and why it is carried.
   */
  readonly eligible: boolean
}

/**
 * «Plan bajarish» — and WHICH question it is answering.
 *
 * The client's own board answers two, and switches between them silently:
 * where a target exists it prints FAKT 2 against the target, and where none
 * does it prints FAKT 2 against FAKT 1 — the share of confirmed orders that
 * actually got delivered. Verified against their published July board on
 * 2026-09-04: 86 of 93 rows are FAKT 2 / FAKT 1 to the percent (Marjona
 * Shahtiyarovna 197 reads 84% on 199 318 000 of 237 118 000), and all seven
 * exceptions are rows their own generator left at zero.
 *
 * We carry the same two readings and, unlike them, say which one is on the
 * row. A column that means one thing here and another there is only
 * defensible if the screen admits it.
 */
export interface SellerPlanDto {
  /** The target from `kpi`, when one is set. Null on the delivery reading. */
  readonly amount: MoneyDto | null
  /** 0-100+, uncapped — a seller at 112% reads 112%. */
  readonly percent: number | null
  /**
   * 'target'   — FAKT 2 against a target somebody set.
   * 'delivery' — FAKT 2 against FAKT 1, the client's fallback and ours.
   * null       — nothing to divide by: no target and no confirmed money.
   */
  readonly basis: 'target' | 'delivery' | null
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
  /** Refused in the queue PLUS confirmed-then-cancelled. Both are resolved. */
  readonly lostOrders: number
  /**
   * Of `lostOrders`, the ones the operator had already CONFIRMED before the
   * order died — «Отказ предварительно» and its kind. A different fact from a
   * refusal at the door, and July hid 102 of them inside «yoʻlda».
   */
  readonly lostAfterConfirmOrders: number
  /**
   * EVERY order of theirs in the window, whatever became of it — the count the
   * Тасдиқлаш navbati page shows. Bigger than `orders`, which counts only the
   * confirmed ones: August is 3 228 against 2 874, and until the screen prints
   * both, two pages state two true numbers 354 apart with no explanation.
   */
  readonly cohortOrders: number
  /** wonOrders / (orders resolved so far), 0-100. Null when nothing resolved. */
  readonly conversionPercent: number | null
  /** This seller's share of the board's total won intake, 0-100. */
  readonly sharePercent: number | null
  /** Their `plan` and `plandone`. Empty until somebody sets targets. */
  readonly plan: SellerPlanDto
  /**
   * Their `leads` — the Lid column, ALWAYS NULL and deliberately present.
   *
   * There is no lead anywhere in this database: no `Lead` model in the
   * schema, no LEADS entity in the sync engine, nothing in `CrmProvider` that
   * fetches one. Their board fills this from a source outside Bitrix24 (and
   * fills it for one month of the three it publishes).
   *
   * The field is carried rather than dropped because the column is on the
   * screen the client reads every morning, and a column that says "no source
   * connected" is a question somebody can answer. A zero would be an answer,
   * and the wrong one.
   */
  readonly leads: number | null
  /**
   * Their `conv` — orders over LEADS, which is not the conversion beside it.
   *
   * `conversionPercent` above asks "of the orders that were decided, how many
   * were won"; this asks "of the leads handed to this operator, how many
   * became an order". Two different questions with two different
   * denominators, and the client's board shows the second one. Both are
   * carried so neither screen has to pretend the other's number is its own.
   *
   * Null while `leads` is null — a rate with no denominator is null, not 0.
   */
  readonly leadConversionPercent: number | null
  /**
   * Their `fot` — payroll for the period. ALWAYS NULL.
   *
   * Nothing in this database holds pay: no salary column on `employee`, no
   * payroll table, no CRM field that carries one. It is not derivable from
   * anything here, so unlike `leads` — which at least has candidate sources —
   * this one needs a source that does not exist yet.
   */
  readonly fot: MoneyDto | null
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
  /** The team's targets summed, and the team's won intake against them. */
  readonly plan: SellerPlanDto
  /** See `SellerBoardRowDto.leads`. Always null, for the same reason. */
  readonly leads: number | null
  /** See `SellerBoardRowDto.leadConversionPercent`. Null with `leads`. */
  readonly leadConversionPercent: number | null
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
  /** Every order in the cohort — what the confirmation queue counts. */
  readonly cohortOrders: number
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
  /**
   * Sellers the client's ladder pays at all — the 107–147 band.
   *
   * On the screen beside `sellers`, so a reader can see that a board of 128
   * people has 41 the bonus column can ever light up for, rather than
   * wondering why the top three carry no rung.
   */
  readonly sellersEligibleForBonus: number
  /** Every target on the board summed, and won intake against them. */
  readonly plan: SellerPlanDto
  /** How many sellers on the board actually have a target set. */
  readonly sellersWithPlan: number
  /** See `SellerBoardRowDto.leads`. Always null, for the same reason. */
  readonly leads: number | null
  /** See `SellerBoardRowDto.leadConversionPercent`. Null with `leads`. */
  readonly leadConversionPercent: number | null
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
   *   `ordered` is FAKT 1 — Тасдиқланди AND Тасдиқланмай чиқди, everything
   *   that left the queue as an order — `won` is Доставланди (C6:WON), and
   *   everything is dated by the order's OWN arrival in C4:NEW. See
   *   `InsightsRepository.FAKT1_OUTCOMES` and `confirmationSellerRating`.
   * 'created_in_period' — the original reading, dated by the day the ORDER
   *   WAS TAKEN (`createdAtSource`) — see `SellerBoardRepository`.
   */
  readonly basis: 'confirmation_queue' | 'created_in_period'
  /**
   * True when these rows are a SUBSET of the company.
   *
   * Mirrored in `src/lib/api.ts` — see the note there for why the screen has
   * to be told rather than left to infer it from the row count.
   */
  readonly scoped: boolean
  /**
   * THE PLAN'S OWN SPAN, when the board found any targets at all.
   *
   * A target is a contract for a stated period — 300 mln in September — not
   * a rate to be sliced to whatever window the reader picked. `/kpi` learned
   * this the expensive way (see `KpiDefinition.periodStart`), so the span
   * travels with the board and the screen prints it: reading «Bugun» against
   * a monthly target is a legitimate thing to do, but only if the screen says
   * that is what it is doing.
   *
   * Null when no target covers the window, which is every window today.
   */
  readonly planWindow: { readonly start: string; readonly end: string } | null
}

export interface SellerDayDto {
  readonly date: string
  readonly orders: number
  readonly ordered: MoneyDto
  readonly won: MoneyDto
  /** See `SellerBoardRowDto.leads`. Always null, for the same reason. */
  readonly leads: number | null
}

// ---------------------------------------------------------------------------

export class SellerBoardService {
  constructor(
    private readonly repo: SellerBoardRepository,
    private readonly insights: InsightsRepository,
    private readonly reference: ReferenceRepository,
  ) {}

  async board(ctx: AnalyticsContext, basis: SellerBoardBasisValue = 'queue'): Promise<SellerBoardDto> {
    const filters = boardFilters(ctx)

    /*
      All three reads at once. The comparison exists only to give the total a
      delta, and the targets only to give the plan column a denominator; a
      second round trip for either could straddle a sync and score one
      window's money against another's cohort.
    */
    const [rows, previous, kpis] = await Promise.all([
      this.rowsFor(ctx.period, basis, filters),
      this.rowsFor(ctx.comparison, basis, filters),
      this.reference.findKpisForPeriod(ctx.period),
    ])

    const plans = revenueTargets(kpis)

    const totalWonMinor = sum(rows, (r) => r.wonMinor)
    const previousWonMinor = sum(previous, (r) => r.wonMinor)

    /*
      FAKT 2 FIRST, THEN FAKT 1 — the client's own rule, stated 2026-09-04:
      «kimda koʻp fakt 1 va fakt 2 boʻlsa u yuqori oʻrinda turadi».

      Delivered money leads, because that is what the floor is paid on. But
      ranking on it ALONE leaves the board blank for most of a working day:
      delivery takes days, so on «Bugun» and «Kecha» every row holds zero
      FAKT 2, the whole ranking collapses to a tie and the deciding factor
      becomes an internal employee id — 55 sellers, 148 mln soʻm confirmed
      between them, and not one of them ranked. Confirmed money is the honest
      second key: it is the work they have actually done today, and it orders
      exactly the people FAKT 2 cannot separate yet.

      The employee id remains the last resort, so two sellers level on both
      figures do not swap places between two refreshes of one screen — and a
      name sort would reorder them on a rename.
    */
    const ordered = [...rows].sort(
      (a, b) =>
        (b.wonMinor > a.wonMinor ? 1 : b.wonMinor < a.wonMinor ? -1 : 0) ||
        (b.orderedMinor > a.orderedMinor ? 1 : b.orderedMinor < a.orderedMinor ? -1 : 0) ||
        a.employeeId.localeCompare(b.employeeId),
    )

    /*
      COMPETITION RANKING: equal money, equal rank, and the next rank skips.

      Equal on BOTH figures, now that both decide the order — otherwise two
      sellers level on FAKT 2 but far apart on FAKT 1 would share a rank the
      sort had already separated them by, and the board would print 1, 1, 3
      over rows that visibly differ.

      `/analytics/leaderboard` ranks the same floor 1, 2, 2, 4 and two boards
      disagreeing about who is second is the kind of thing a bonus argument
      starts over. The id still decides DISPLAY order among true ties, so the
      table does not reshuffle between two refreshes of one screen.
    */
    const rankOf = ordered.map((row, index) => {
      const previous = index > 0 ? ordered[index - 1] : undefined
      return previous &&
        previous.wonMinor === row.wonMinor &&
        previous.orderedMinor === row.orderedMinor
        ? -1
        : index + 1
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
      lostAfterConfirmOrders: row.lostAfterConfirmOrders,
      cohortOrders: row.cohortOrders,
      /*
        Resolved, not taken: an order still open has not failed, so counting
        it against the seller would make a busy week look like a bad one. The
        denominator is what has actually been decided.
      */
      conversionPercent: roundOrNull(ratePercent(row.wonOrders, row.wonOrders + row.lostOrders)),
      sharePercent: roundOrNull(ratePercent(row.wonMinor, totalWonMinor)),
      plan: planFor(
        plans.byEmployee.get(row.employeeId) ?? null,
        row.wonMinor,
        row.orderedMinor,
        ctx.currency,
      ),
      // No source in this database — see each field's own comment.
      leads: null,
      leadConversionPercent: null,
      fot: null,
      bonus: bonusFor(row.wonMinor, row.fullName, ctx.currency),
    }))

    const plannedMinor = sum(
      rows.filter((r) => plans.byEmployee.has(r.employeeId)),
      (r) => plans.byEmployee.get(r.employeeId)!,
    )

    return {
      rows: boardRows,
      /*
        Said on the payload, not inferred from the row count. Twelve rows is a
        small company and also one ROP's floor, and the difference decides
        whether «1-oʻrin» means anything.
      */
      scoped: (ctx.filters.restrictToEmployeeIds ?? null) !== null,
      teams: teamRows(rows, totalWonMinor, plans.byEmployee, ctx.currency),
      totals: {
        sellers: rows.length,
        teams: new Set(rows.map((r) => r.rop).filter((r): r is string => r !== null)).size,
        teamlessSellers: rows.filter((r) => r.rop === null).length,
        orders: rows.reduce((a, r) => a + r.orders, 0),
        cohortOrders: rows.reduce((a, r) => a + r.cohortOrders, 0),
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
        sellersEligibleForBonus: boardRows.filter((r) => r.bonus.eligible).length,
        plan: planFor(
          plans.byEmployee.size > 0 ? plannedMinor : null,
          totalWonMinor,
          sum(rows, (r) => r.orderedMinor),
          ctx.currency,
        ),
        sellersWithPlan: rows.filter((r) => plans.byEmployee.has(r.employeeId)).length,
        leads: null,
        leadConversionPercent: null,
      },
      forecast: forecastOf(totalWonMinor, ctx),
      basis: basis === 'queue' ? 'confirmation_queue' : 'created_in_period',
      planWindow: plans.window,
    }
  }

  async sellerDays(
    ctx: AnalyticsContext,
    employeeId: string,
    basis: SellerBoardBasisValue = 'queue',
  ): Promise<readonly SellerDayDto[]> {
    if (basis === 'queue') {
      /*
        The scope rides the window here too, and it is what refuses a seller
        the caller may not read: the prelude has already dropped every operator
        outside the scope, so the series comes back empty rather than showing
        another floor's days to whoever guessed an employee id.
      */
      const days = await this.insights.confirmationSellerRatingDays(
        scopedPeriod(ctx.period, ctx.filters),
        employeeId,
      )
      return days.map((d) => ({
        date: d.date,
        orders: d.orders,
        ordered: toMoneyDto(money(d.confirmedMinor, ctx.currency)),
        won: toMoneyDto(money(d.deliveredMinor, ctx.currency)),
        leads: null,
      }))
    }

    const days = await this.repo.sellerDays(ctx.period, employeeId, boardFilters(ctx))
    return days.map((d) => ({
      date: d.date,
      orders: d.orders,
      ordered: toMoneyDto(money(d.orderedMinor, ctx.currency)),
      won: toMoneyDto(money(d.wonMinor, ctx.currency)),
      leads: null,
    }))
  }

  /** One row per operator, on whichever clock `basis` names. */
  private async rowsFor(
    period: Period,
    basis: SellerBoardBasisValue,
    filters: SellerBoardFilters,
  ): Promise<SellerBoardRow[]> {
    if (basis === 'intake') return this.repo.board(period, filters)

    /*
      THE SAME RESTRICTION, TWICE, BECAUSE THE TWO BASES SCOPE ON TWO PEOPLE.

      `intake` groups by the deal's assignee and takes the scope through
      `filterSql`. The queue basis groups by the OPERATOR — the portal's own
      snapshot of who sold it, resolved in the confirmation cohort — so its
      restriction has to travel on the window and be applied in the prelude
      against that person. Filtering the queue basis by the assignee would put
      the 556-orders-on-the-head-of-Операцион class of deal on the wrong side
      of a team boundary, which is the same drift the operator column exists
      to fix.
    */
    const rows = await this.insights.confirmationSellerRating(
      scopedPeriod(period, filters),
      filters,
    )
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
        /*
          BOTH KINDS OF LOSS, because the conversion rate divides by them.

          A refusal in the queue and an order confirmed then cancelled before
          dispatch are different events, but they are both resolved and both
          belong in the denominator. Counting only the first flattered July's
          board by 3.4 points — 84.1% where the truth is 80.7%.
        */
        lostOrders: r.rejectedOrders + r.lostAfterConfirmOrders,
        lostAfterConfirmOrders: r.lostAfterConfirmOrders,
        cohortOrders: r.cohortOrders,
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
    restrictToEmployeeIds: ctx.filters.restrictToEmployeeIds,
  }
}

/**
 * The REVENUE targets covering this window, keyed by the person they belong
 * to — plus the span they were set for.
 *
 * Only REVENUE: the client's `plandone` is money against money. A
 * DEALS_WON target in the same window is a different contract and would make
 * the plan column compare a count with soʻm.
 *
 * COMPANY-WIDE TARGETS ARE DROPPED. A `kpi` row with a null `employeeId` is
 * a target for the whole floor; charging it to one seller's row would read as
 * that seller missing the company's plan single-handed. `kpiService` refuses
 * them for the same reason.
 *
 * The window is reported only when every target on the board shares one. A
 * monthly plan beside a quarterly one has no single span to print, and
 * printing the widest would tell the reader the monthly plan covers three
 * months.
 */
function revenueTargets(kpis: readonly KpiDefinition[]): {
  byEmployee: Map<string, bigint>
  window: { start: string; end: string } | null
} {
  const byEmployee = new Map<string, bigint>()
  const spans = new Set<string>()
  let span: { start: string; end: string } | null = null

  for (const kpi of kpis) {
    if (kpi.metric !== 'REVENUE' || kpi.employeeId === null) continue
    // One target per person per metric per window is a database constraint
    // (`@@unique([employeeId, metric, periodStart, periodEnd])`), but two
    // windows can still both contain `asOf` if somebody sets a month and a
    // quarter. Summing them would double-charge the seller, so the first
    // one wins and the mixed span below is what tells the reader.
    if (!byEmployee.has(kpi.employeeId)) byEmployee.set(kpi.employeeId, kpi.targetValue)
    const key = `${kpi.periodStart.toISOString()}|${kpi.periodEnd.toISOString()}`
    spans.add(key)
    span = { start: kpi.periodStart.toISOString(), end: kpi.periodEnd.toISOString() }
  }

  return { byEmployee, window: spans.size === 1 ? span : null }
}

/**
 * The target when there is one, the delivery share when there is not.
 *
 * A TARGET WINS. Somebody setting 300 mln for September is a contract, and
 * scoring against it is a different and stronger statement than "84% of what
 * you confirmed arrived". The `kpi` table is empty today, so in practice every
 * row reads the delivery share — which is exactly what the client's own board
 * prints, and it is a real measurement rather than the em dash this column
 * used to be.
 *
 * Still never a zero out of nothing: a seller with no target AND no confirmed
 * money divides by nothing, and that is null, not 0%.
 */
function planFor(
  targetMinor: bigint | null,
  wonMinor: bigint,
  orderedMinor: bigint,
  currency: string,
): SellerPlanDto {
  if (targetMinor !== null && targetMinor > 0n) {
    return {
      amount: toMoneyDto(money(targetMinor, currency)),
      // Deliberately uncapped: their bar clamps the WIDTH at 100%, but the
      // number beside it keeps counting, and a seller at 112% reads 112%.
      percent: roundPercent(ratePercent(wonMinor, targetMinor) ?? 0),
      basis: 'target',
    }
  }
  if (orderedMinor > 0n) {
    return {
      amount: null,
      percent: roundPercent(ratePercent(wonMinor, orderedMinor) ?? 0),
      basis: 'delivery',
    }
  }
  return { amount: null, percent: null, basis: null }
}

/**
 * The tier already cleared, and the distance to the next one.
 *
 * Both halves matter to the person reading it: the first is what they have
 * earned, the second is the only actionable number on the row.
 *
 * GATED ON THE BAND FIRST. Outside 107–147 the client's ladder pays nothing,
 * so every field comes back empty rather than describing a rung this person
 * will never be paid for — see `bonusEligible`.
 */
function bonusFor(wonMinor: bigint, fullName: string, currency: string): SellerBonusDto {
  if (!bonusEligible(fullName)) {
    return {
      earned: toMoneyDto(money(0n, currency)),
      nextFloor: null,
      nextBonus: null,
      toNext: null,
      toNextPercent: null,
      eligible: false,
    }
  }

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
    eligible: true,
  }
}

/** Sellers folded into their ROP's team, ranked the same way rows are. */
function teamRows(
  rows: readonly SellerBoardRow[],
  totalWonMinor: bigint,
  planByEmployee: ReadonlyMap<string, bigint>,
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
        /*
          A team's plan is its members' plans summed — but only the members
          who HAVE one. A team of ten where three carry targets has a real
          target of those three; treating the other seven as zero-target
          members would leave the team permanently over plan.

          Null when nobody on the team has one at all, so the column says
          "no target" rather than "0 soʻm, and you have beaten it".
        */
        plan: planFor(
          team.members.some((m) => planByEmployee.has(m.employeeId))
            ? sum(
                team.members.filter((m) => planByEmployee.has(m.employeeId)),
                (m) => planByEmployee.get(m.employeeId)!,
              )
            : null,
          team.wonMinor,
          sum(team.members, (m) => m.orderedMinor),
          currency,
        ),
        leads: null,
        leadConversionPercent: null,
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
