/**
 * «Oyliklar» — what each seller is owed for a payroll period: a month, half a
 * month, or (since 2026-10-03) a week. The three are one computation over a
 * different window and a different table; see `domain/payroll/sellerPayroll`.
 *
 * ONE MEASUREMENT AND ONE RULE, kept apart. The measurement is FAKT 2 per
 * seller BY THE DAY IT WAS DELIVERED (`deliveredSellerRows`) — the client,
 * 2026-10-05: pay is the money delivered in the period. Until then it was the
 * board's query (`confirmationSellerRating`), which dates FAKT 2 by the queue
 * arrival: the running week read low, a closed month kept growing, and a
 * parcel delivered this week was paid into last. So this figure and the same
 * person's Успешно on «Sotuvchilar reytingi» now differ BY THE DATE ONLY —
 * same orders, same seller (the team label follows the newest delivery). The rule is
 * `domain/payroll/sellerPayroll`, which is the client's own table transcribed
 * and knows nothing about databases.
 *
 * WHY IT DOES NOT GO THROUGH `SellerBoardService`. That service is the
 * protected board's own path — window from an `AnalyticsContext`, its own
 * memo, its own ranking basis switch — and payroll asks a narrower question on
 * a different clock. Reading the repository directly costs one call and keeps
 * this screen from being a reason to edit a file «Sotuvchilar reytingi»
 * depends on.
 *
 * THE RANK IS DECIDED HERE, OVER THESE ROWS, and it is the board's own rule:
 * FAKT 2, then FAKT 1, then the employee id, with competition ranking. It is
 * mirrored rather than imported because the board's version is welded to its
 * DTO — and the screen says out loud which period the rank is over, because a
 * payroll fortnight's leader is not necessarily the month's.
 */

import { type DeltaDto, growth, toDeltaDto } from '@/server/domain/analytics/metrics'
import { mergeSellerTeamSlices } from '@/server/domain/analytics/sellerTeams'
import { type MoneyDto, money, toMoneyDto } from '@/server/domain/money/money'
import type { Period } from '@/server/domain/period/period'
import type { PayrollHalfValue } from '@/server/domain/period/period'
import {
  type PayrollSchemeValue,
  sellerPayroll,
} from '@/server/domain/payroll/sellerPayroll'
import type {
  ConfirmationSellerRatingRow,
  InsightsRepository,
} from '@/server/repositories/insightsRepository'
import { LIVE_CACHE, keyPart, ttlCache } from './ttlCache'

// ---------------------------------------------------------------------------
// DTOs — mirrored in src/lib/api.ts, which the client imports instead.
// ---------------------------------------------------------------------------

export interface PayrollSellerDto {
  /** Competition rank on FAKT 2 within this payroll period. 1 is the leader. */
  readonly rank: number
  readonly employeeId: string
  readonly fullName: string
  /** The ROP team, or null for a seller in no (ROP) department. */
  readonly rop: string | null
  /** FAKT 2 — delivered money, and the only basis this screen pays on. */
  readonly fakt2: MoneyDto
  readonly fakt2Orders: number
  /**
   * The rate this row was paid at, in per cent: always 8 for a month or a
   * half, 0 / 5 / 8 / 10 / 12 for a week, where the rate is the tier.
   */
  readonly percentRate: number
  /** `percentRate` of FAKT 2. */
  readonly percent: MoneyDto
  /** The tier's fixed part. Zero below the first floor, never null. */
  readonly fixed: MoneyDto
  /** percent + fixed. The soʻm the person is paid. */
  readonly total: MoneyDto
  /** The floor this row was paid at, so the screen can name the tier. */
  readonly tierFloor: MoneyDto | null
  /** The next floor up, null once the top tier is cleared. */
  readonly nextFloor: MoneyDto | null
  /** How much more FAKT 2 the next tier needs. Null with `nextFloor`. */
  readonly toNext: MoneyDto | null
  /**
   * The same person in the comparison window, paid by the same table. Null
   * when they delivered nothing then — new, or back — which the screen says
   * in words rather than as a percentage off zero.
   */
  readonly previous: { readonly fakt2: MoneyDto; readonly total: MoneyDto } | null
  readonly fakt2Delta: DeltaDto
  readonly totalDelta: DeltaDto
}

/**
 * One ROP team: its sellers' rows summed, now and in the comparison window.
 *
 * NOW is the sellers this payroll prints under that ROP — each person once,
 * under the team of their newest order (`mergeSellerTeamSlices`), so the cards
 * add up to the fund to the soʻm. THEN is the comparison window's sellers
 * under the label THEY wore then: a team's growth is what the team did, and a
 * seller who joined it this month did not make last month's figure smaller.
 */
export interface PayrollTeamDto {
  /** The ROP's team name, or null for sellers in no (ROP) department. */
  readonly rop: string | null
  readonly sellers: number
  readonly fakt2: MoneyDto
  readonly percent: MoneyDto
  readonly fixed: MoneyDto
  readonly total: MoneyDto
  /** Null when nobody was paid under this name in the comparison window. */
  readonly previous: {
    readonly sellers: number
    readonly fakt2: MoneyDto
    readonly total: MoneyDto
  } | null
  readonly fakt2Delta: DeltaDto
  readonly totalDelta: DeltaDto
}

export interface PayrollDto {
  /** Which of the client's tables was applied. */
  readonly scheme: PayrollSchemeValue
  /**
   * Whether the period is still running.
   *
   * The window is never clipped to now (see `payrollPeriod`), so a half that
   * has not finished reports what has been delivered so far. The screen has to
   * be able to say that out loud, or a mid-period total reads as a final one.
   */
  readonly open: boolean
  /** Every seller with money delivered in the period, best FAKT 2 first. */
  readonly sellers: readonly PayrollSellerDto[]
  readonly totals: {
    readonly sellers: number
    readonly fakt2: MoneyDto
    readonly percent: MoneyDto
    readonly fixed: MoneyDto
    /** The payroll fund for the period — what the office pays out in soʻm. */
    readonly total: MoneyDto
  }
  /** Per ROP, the biggest fund first and «ROP yoʻq» last. Σ = `totals`. */
  readonly teams: readonly PayrollTeamDto[]
  /** The comparison window's totals, by the same table. */
  readonly previous: {
    readonly sellers: number
    /**
     * Sellers who delivered money then and have no row now — the biggest
     * possible fall, which no row and no mover list can show, so it is counted.
     */
    readonly gone: number
    readonly fakt2: MoneyDto
    readonly percent: MoneyDto
    readonly fixed: MoneyDto
    readonly total: MoneyDto
  }
  readonly deltas: {
    readonly fakt2: DeltaDto
    readonly percent: DeltaDto
    readonly fixed: DeltaDto
    readonly total: DeltaDto
  }
}

/**
 * Two minutes, the same as every other live memo here and the sync worker's tick.
 *
 * Keyed on the whole question — scheme, window and currency. There is no scope in
 * the key because there is no scope in the answer: the endpoint asks for
 * `analytics:read:all`, so a narrowed account is refused rather than served a
 * narrowed payroll. If this screen is ever opened to a ROP, the scope goes in
 * this key in the same commit or the memo goes.
 */
const payrollCache = ttlCache<PayrollDto>(120_000, LIVE_CACHE)

/**
 * ONE WINDOW'S DELIVERED ROWS, memoised on the window alone — 2026-10-06.
 *
 * The memo above is keyed on the comparison window too, and while a period
 * runs that window's end moves with the clock (`comparablePayrollPeriod`), so
 * a poll of the running week or month regularly meets a key it has never seen
 * and rebuilds. Until this memo, that rebuild ran BOTH `deliveredSellerRows`
 * scans in front of the reader — the current period's included, although its
 * window had not moved. Memoised here on start|end with stale-while-revalidate,
 * the current period's rows are served on every poll and refreshed behind
 * the reader; only the comparison's scan is ever waited for. The window is the
 * whole question: the rows are the same delivered FAKT 2 whichever table pays
 * them and in whatever currency, so neither is in the key.
 */
const rowsCache = ttlCache<ConfirmationSellerRatingRow[]>(120_000, LIVE_CACHE)

export class PayrollService {
  constructor(private readonly insights: InsightsRepository) {}

  /**
   * The monthly payroll: the whole month, or one half of it.
   *
   * `previous` is the comparison window, built by the route with
   * `comparablePayrollPeriod` — the like period before, cut to the same
   * elapsed time while this one runs.
   */
  async sellers(
    period: Period,
    previous: Period,
    half: PayrollHalfValue,
    currency: string,
    now: Date,
  ): Promise<PayrollDto> {
    return this.cached(half === 'full' ? 'month' : 'half', period, previous, currency, now)
  }

  /** The weekly income, Monday to Sunday — «HAFTALIK DAROMAD». */
  async weekly(period: Period, previous: Period, currency: string, now: Date): Promise<PayrollDto> {
    return this.cached('week', period, previous, currency, now)
  }

  private cached(
    scheme: PayrollSchemeValue,
    period: Period,
    previous: Period,
    currency: string,
    now: Date,
  ): Promise<PayrollDto> {
    /*
      The window's start alone does not name the period — a month, its first
      half and the week that opens on the 1st can share it — so the scheme and
      the end are in the key as well. The comparison window moves with the
      clock while the period runs (in ten-minute steps), so its end is in it
      too.
    */
    const key = [
      scheme,
      period.start.toISOString(),
      period.end.toISOString(),
      previous.start.toISOString(),
      previous.end.toISOString(),
      keyPart(currency),
    ].join('|')
    return payrollCache.get(key, () => this.build(scheme, period, previous, currency, now))
  }

  /*
    COMPANY-WIDE, EXPLICITLY. `deliveredSellerRows` takes no scope at all —
    the one screen in this product that states salaries reads everybody's
    rows, and the route refuses a narrowed account (see the header).

    FOLDED TO ONE ROW PER PERSON. The rating hands back a slice per seller
    and team since the team became the deal's own snapshot (2026-09-26),
    and pay is a person's: two slices would split one FAKT 2 across the
    tiers and rank one seller twice. See `mergeSellerTeamSlices`.
  */
  private rows(period: Period): Promise<ConfirmationSellerRatingRow[]> {
    return rowsCache.get(`${period.start.toISOString()}|${period.end.toISOString()}`, async () =>
      mergeSellerTeamSlices(await this.insights.deliveredSellerRows(period)),
    )
  }

  private async build(
    scheme: PayrollSchemeValue,
    period: Period,
    previousPeriod: Period,
    currency: string,
    now: Date,
  ): Promise<PayrollDto> {
    /*
      Both windows at once, through the same query. An empty comparison
      window (a period that has not started) is not asked for at all.
    */
    const [rows, previousRows] = await Promise.all([
      this.rows(period),
      previousPeriod.end.getTime() > previousPeriod.start.getTime()
        ? this.rows(previousPeriod)
        : Promise.resolve([] as ConfirmationSellerRatingRow[]),
    ])

    /*
      THE COMPARISON WINDOW IS PAID BY THE SAME TABLE. A half against a half,
      a week against a week — so «oʻtgan davr JAMI» is what the same person
      would have been paid then, not a figure from a different rule.
    */
    const previousPay = previousRows.map((row) => ({
      employeeId: row.employeeId,
      rop: row.rop,
      fakt2: row.deliveredMinor,
      pay: sellerPayroll({ basisMinor: row.deliveredMinor, scheme }),
    }))
    /*
      «HAD A PREVIOUS» MEANS DELIVERED MONEY THEN. Every row carries a
      delivery since the basis became the delivery day, but an order booked at
      0 soʻm still makes a FAKT 2 of 0; counting that as a baseline would
      print «baza yoʻq · oldin 0» where the screen means «yangi», and rank
      them top of the risers with their whole FAKT 2.
    */
    const previousById = new Map(
      previousPay.filter((row) => row.fakt2 > 0n).map((row) => [row.employeeId, row]),
    )

    /*
      FAKT 2 FIRST, THEN THE ID. Delivered money is what the pay is computed
      from; the id is the last resort so two people level on it do not swap
      places between refreshes. (FAKT 1 was the middle leg while the rows came
      off the queue's rating; the delivery rows carry none, so it reads 0 on
      every row and two equal FAKT 2s now share a rank.)
    */
    const ordered = [...rows].sort(
      (a, b) =>
        (b.deliveredMinor > a.deliveredMinor ? 1 : b.deliveredMinor < a.deliveredMinor ? -1 : 0) ||
        (b.confirmedMinor > a.confirmedMinor ? 1 : b.confirmedMinor < a.confirmedMinor ? -1 : 0) ||
        a.employeeId.localeCompare(b.employeeId),
    )

    /* Equal on BOTH figures, equal rank, and the next rank skips. */
    const rankOf = ordered.map((row, index) => {
      const above = index > 0 ? ordered[index - 1] : undefined
      return above &&
        above.deliveredMinor === row.deliveredMinor &&
        above.confirmedMinor === row.confirmedMinor
        ? -1
        : index + 1
    })
    for (let i = 1; i < rankOf.length; i++) {
      if (rankOf[i] === -1) rankOf[i] = rankOf[i - 1]!
    }

    const cash = (minor: bigint) => toMoneyDto(money(minor, currency))
    /*
      IN SOʻM, NOT TIYIN. The ratio is the same either way, but a «baza kichik»
      delta carries both sides to the screen, which prints them as they come —
      in minor units they read a hundred times too large.
    */
    const delta = (current: bigint, previous: bigint | null) =>
      toDeltaDto(growth(cash(current).amount, previous === null ? 0 : cash(previous).amount))

    const sellers = ordered.map<PayrollSellerDto>((row, index) => {
      const rank = rankOf[index]!
      const pay = sellerPayroll({ basisMinor: row.deliveredMinor, scheme })
      const before = previousById.get(row.employeeId)

      return {
        rank,
        employeeId: row.employeeId,
        fullName: row.fullName,
        rop: row.rop,
        fakt2: cash(row.deliveredMinor),
        fakt2Orders: row.deliveredOrders,
        percentRate: Number(pay.percentBp) / 100,
        percent: cash(pay.percentMinor),
        fixed: cash(pay.fixedMinor),
        total: cash(pay.totalMinor),
        tierFloor: pay.tierFloorMinor === null ? null : cash(pay.tierFloorMinor),
        nextFloor: pay.nextFloorMinor === null ? null : cash(pay.nextFloorMinor),
        toNext: pay.toNextMinor === null ? null : cash(pay.toNextMinor),
        previous: before
          ? { fakt2: cash(before.fakt2), total: cash(before.pay.totalMinor) }
          : null,
        fakt2Delta: delta(row.deliveredMinor, before?.fakt2 ?? null),
        totalDelta: delta(pay.totalMinor, before?.pay.totalMinor ?? null),
      }
    })

    /*
      THE FUND IS SUMMED FROM THE ROWS THE SCREEN PRINTS, in minor units, and
      never recomputed from the total FAKT 2: 8% of the sum is not the sum of
      each person's rounded 8%, and the tiers are per person by definition.
      A footer that disagreed with its own column by a few soʻm is exactly the
      kind of thing that costs an afternoon to explain.
    */
    const minor = (value: MoneyDto) => BigInt(value.amountMinor)
    const sum = (pick: (row: PayrollSellerDto) => MoneyDto) =>
      sellers.reduce((acc, row) => acc + minor(pick(row)), 0n)

    const then = {
      fakt2: previousPay.reduce((acc, row) => acc + row.fakt2, 0n),
      percent: previousPay.reduce((acc, row) => acc + row.pay.percentMinor, 0n),
      fixed: previousPay.reduce((acc, row) => acc + row.pay.fixedMinor, 0n),
      total: previousPay.reduce((acc, row) => acc + row.pay.totalMinor, 0n),
    }
    const current = {
      fakt2: sum((row) => row.fakt2),
      percent: sum((row) => row.percent),
      fixed: sum((row) => row.fixed),
      total: sum((row) => row.total),
    }

    const printed = new Set(rows.map((row) => row.employeeId))

    return {
      scheme,
      open: period.end.getTime() > now.getTime(),
      sellers,
      totals: {
        sellers: sellers.length,
        fakt2: cash(current.fakt2),
        percent: cash(current.percent),
        fixed: cash(current.fixed),
        total: cash(current.total),
      },
      teams: teamsOf(sellers, previousPay, cash, delta),
      previous: {
        sellers: previousPay.length,
        gone: [...previousById.keys()].filter((id) => !printed.has(id)).length,
        fakt2: cash(then.fakt2),
        percent: cash(then.percent),
        fixed: cash(then.fixed),
        total: cash(then.total),
      },
      deltas: {
        fakt2: delta(current.fakt2, then.fakt2),
        percent: delta(current.percent, then.percent),
        fixed: delta(current.fixed, then.fixed),
        total: delta(current.total, then.total),
      },
    }
  }
}

/**
 * The ROP cards, summed from the rows the screen prints — never re-read from
 * the database by team — so the cards add up to the fund exactly.
 */
function teamsOf(
  sellers: readonly PayrollSellerDto[],
  previousPay: readonly {
    readonly rop: string | null
    readonly fakt2: bigint
    readonly pay: { readonly totalMinor: bigint }
  }[],
  cash: (minor: bigint) => MoneyDto,
  delta: (current: bigint, previous: bigint | null) => DeltaDto,
): PayrollTeamDto[] {
  const minor = (value: MoneyDto) => BigInt(value.amountMinor)

  const now = new Map<string | null, { sellers: number; fakt2: bigint; percent: bigint; fixed: bigint; total: bigint }>()
  for (const row of sellers) {
    const held = now.get(row.rop) ?? { sellers: 0, fakt2: 0n, percent: 0n, fixed: 0n, total: 0n }
    now.set(row.rop, {
      sellers: held.sellers + 1,
      fakt2: held.fakt2 + minor(row.fakt2),
      percent: held.percent + minor(row.percent),
      fixed: held.fixed + minor(row.fixed),
      total: held.total + minor(row.total),
    })
  }

  /* A team's baseline, like a seller's, is money delivered then. */
  const then = new Map<string | null, { sellers: number; fakt2: bigint; total: bigint }>()
  for (const row of previousPay) {
    if (row.fakt2 <= 0n) continue
    const held = then.get(row.rop) ?? { sellers: 0, fakt2: 0n, total: 0n }
    then.set(row.rop, {
      sellers: held.sellers + 1,
      fakt2: held.fakt2 + row.fakt2,
      total: held.total + row.pay.totalMinor,
    })
  }

  /*
    A TEAM PAID THEN AND EMPTY NOW STAYS, at zero. Dropped, its fall would be
    the one change the bars could not show, and Σ previous over the teams
    would stop being the previous fund. It has no sellers, so no card draws.
  */
  for (const rop of then.keys()) {
    if (!now.has(rop)) now.set(rop, { sellers: 0, fakt2: 0n, percent: 0n, fixed: 0n, total: 0n })
  }

  return [...now.entries()]
    .map(([rop, team]): PayrollTeamDto => {
      const before = then.get(rop) ?? null
      return {
        rop,
        sellers: team.sellers,
        fakt2: cash(team.fakt2),
        percent: cash(team.percent),
        fixed: cash(team.fixed),
        total: cash(team.total),
        previous: before
          ? { sellers: before.sellers, fakt2: cash(before.fakt2), total: cash(before.total) }
          : null,
        fakt2Delta: delta(team.fakt2, before?.fakt2 ?? null),
        totalDelta: delta(team.total, before?.total ?? null),
      }
    })
    .sort(
      (a, b) =>
        Number(a.rop === null) - Number(b.rop === null) ||
        (minor(b.total) > minor(a.total) ? 1 : minor(b.total) < minor(a.total) ? -1 : 0) ||
        (a.rop ?? '').localeCompare(b.rop ?? '', 'ru'),
    )
}
