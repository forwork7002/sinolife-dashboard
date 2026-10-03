/**
 * «Oyliklar» — what each seller is owed for a payroll period: a month, half a
 * month, or (since 2026-10-03) a week. The three are one computation over a
 * different window and a different table; see `domain/payroll/sellerPayroll`.
 *
 * ONE MEASUREMENT AND ONE RULE, kept apart. The measurement is FAKT 2 per
 * seller over the payroll window, read from the SAME query the sellers board
 * and the confirmation queue read (`confirmationSellerRating`), so a figure
 * printed here and the same person's Успешно on «Sotuvchilar reytingi» cannot
 * disagree. The rule is `domain/payroll/sellerPayroll`, which is the client's
 * own table transcribed and knows nothing about databases.
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

import { mergeSellerTeamSlices } from '@/server/domain/analytics/sellerTeams'
import { type MoneyDto, money, toMoneyDto } from '@/server/domain/money/money'
import type { Period } from '@/server/domain/period/period'
import type { PayrollHalfValue } from '@/server/domain/period/period'
import {
  type PayrollSchemeValue,
  sellerPayroll,
} from '@/server/domain/payroll/sellerPayroll'
import type { InsightsRepository } from '@/server/repositories/insightsRepository'
import { keyPart, ttlCache } from './ttlCache'

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
  /** Every seller with at least one order in the cohort, best FAKT 2 first. */
  readonly sellers: readonly PayrollSellerDto[]
  readonly totals: {
    readonly sellers: number
    readonly fakt2: MoneyDto
    readonly percent: MoneyDto
    readonly fixed: MoneyDto
    /** The payroll fund for the period — what the office pays out in soʻm. */
    readonly total: MoneyDto
  }
}

/**
 * Sixty seconds, the same as every other memo here and the sync worker's tick.
 *
 * Keyed on the whole question — scheme, window and currency. There is no scope in
 * the key because there is no scope in the answer: the endpoint asks for
 * `analytics:read:all`, so a narrowed account is refused rather than served a
 * narrowed payroll. If this screen is ever opened to a ROP, the scope goes in
 * this key in the same commit or the memo goes.
 */
const payrollCache = ttlCache<PayrollDto>(60_000)

export class PayrollService {
  constructor(private readonly insights: InsightsRepository) {}

  /** The monthly payroll: the whole month, or one half of it. */
  async sellers(
    period: Period,
    half: PayrollHalfValue,
    currency: string,
    now: Date,
  ): Promise<PayrollDto> {
    return this.cached(half === 'full' ? 'month' : 'half', period, currency, now)
  }

  /** The weekly income, Monday to Sunday — «HAFTALIK DAROMAD». */
  async weekly(period: Period, currency: string, now: Date): Promise<PayrollDto> {
    return this.cached('week', period, currency, now)
  }

  private cached(
    scheme: PayrollSchemeValue,
    period: Period,
    currency: string,
    now: Date,
  ): Promise<PayrollDto> {
    /*
      The window's start alone does not name the period — a month, its first
      half and the week that opens on the 1st can share it — so the scheme and
      the end are in the key as well.
    */
    const key = [
      scheme,
      period.start.toISOString(),
      period.end.toISOString(),
      keyPart(currency),
    ].join('|')
    return payrollCache.get(key, () => this.build(scheme, period, currency, now))
  }

  private async build(
    scheme: PayrollSchemeValue,
    period: Period,
    currency: string,
    now: Date,
  ): Promise<PayrollDto> {
    /*
      COMPANY-WIDE, EXPLICITLY. `restrictToEmployeeIds: null` is the value the
      repository reads as "everybody", and it is written here rather than left
      to a default so the one screen in this product that states salaries says
      whose rows it is asking for in its own source.
    */
    /*
      FOLDED TO ONE ROW PER PERSON. The rating hands back a slice per seller
      and team since the team became the deal's own snapshot (2026-09-26),
      and pay is a person's: two slices would split one FAKT 2 across the
      tiers and rank one seller twice. See `mergeSellerTeamSlices`.
    */
    const rows = mergeSellerTeamSlices(
      await this.insights.confirmationSellerRating({
        ...period,
        restrictToEmployeeIds: null,
      }),
    )

    /*
      FAKT 2 FIRST, THEN FAKT 1, THEN THE ID — the sellers board's rule,
      mirrored. Delivered money leads because it is what the pay is computed
      from; FAKT 1 separates the people FAKT 2 cannot yet (a fortnight that has
      only just opened has almost no delivered money in it); the id is the last
      resort so two people level on both do not swap places between refreshes.
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

    const sellers = ordered.map<PayrollSellerDto>((row, index) => {
      const rank = rankOf[index]!
      const pay = sellerPayroll({ basisMinor: row.deliveredMinor, scheme })

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
      }
    })

    /*
      THE FUND IS SUMMED FROM THE ROWS THE SCREEN PRINTS, in minor units, and
      never recomputed from the total FAKT 2: 8% of the sum is not the sum of
      each person's rounded 8%, and the tiers are per person by definition.
      A footer that disagreed with its own column by a few soʻm is exactly the
      kind of thing that costs an afternoon to explain.
    */
    const sum = (pick: (row: PayrollSellerDto) => MoneyDto) =>
      sellers.reduce((acc, row) => acc + BigInt(pick(row).amountMinor), 0n)

    return {
      scheme,
      open: period.end.getTime() > now.getTime(),
      sellers,
      totals: {
        sellers: sellers.length,
        fakt2: cash(sum((row) => row.fakt2)),
        percent: cash(sum((row) => row.percent)),
        fixed: cash(sum((row) => row.fixed)),
        total: cash(sum((row) => row.total)),
      },
    }
  }
}
