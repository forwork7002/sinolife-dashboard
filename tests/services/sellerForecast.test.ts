import { beforeEach, describe, expect, it } from 'vitest'

import { previousEquivalent, resolvePeriod } from '@/server/domain/period/period'
import type {
  ConfirmationSellerRatingRow,
  InsightsRepository,
} from '@/server/repositories/insightsRepository'
import type { ReferenceRepository } from '@/server/repositories/referenceRepository'
import type { SellerBoardRepository } from '@/server/repositories/sellerBoardRepository'
import type { AnalyticsContext } from '@/server/services/analyticsService'
import { SellerBoardService, resetSellerBoardCache } from '@/server/services/sellerBoardService'

/**
 * PROGNOZ — the run-rate at every level Savdo dinamikasi reports.
 *
 * Added 2026-09-16 on the client's ask for FAKT 1 and FAKT 2 projections for
 * the company, each ROP team and each seller. What existed before was one
 * projection, of FAKT 2, for the company.
 *
 * FOUR THINGS HERE ARE PLAUSIBLE WHEN WRONG, which is why each has a case:
 *
 *  1. The elapsed fraction taken against the REPORT window rather than the
 *     calendar unit. A to-date preset is by construction nearly spent, so the
 *     projection comes back a few percent above the total and reads as a
 *     forecast. `performance.ts` records the same bug costing four months on
 *     the KPI screen.
 *  2. A team's projection summed from its sellers' projections rather than
 *     made from the team's own money. Identical under a straight line, and
 *     silently different the first time the rule stops being one.
 *  3. The chart's dashed continuation starting inside today's bucket, which
 *     already carries measured money — one date drawn twice, both plausible.
 *  4. The continuation taking a different stride from the trend it continues,
 *     because `enumerateBuckets` defaults its granularity from whichever
 *     window it is handed.
 */

// Every case builds a board for one window; without this they share one memo
// entry and each case after the first asserts against the first's fixtures.
beforeEach(resetSellerBoardCache)

const TZ = 'Asia/Tashkent'
/** The 9th of a 30-day September, 09:00 on the floor — 27.9% of the month. */
const NOW = new Date('2026-09-09T09:00:00+05:00')

const mln = (n: number) => BigInt(n) * 1_000_000n * 100n

const ZERO_STATES = {
  CONFIRM_NEW: 0,
  NO_ANSWER: 0,
  CONFIRMED: 0,
  REJECTED: 0,
  UNCONFIRMED_SHIPPED: 0,
} as const
const ZERO_STATES_MINOR = {
  CONFIRM_NEW: 0n,
  NO_ANSWER: 0n,
  CONFIRMED: 0n,
  REJECTED: 0n,
  UNCONFIRMED_SHIPPED: 0n,
} as const

function rating(
  over: Partial<ConfirmationSellerRatingRow> &
    Pick<ConfirmationSellerRatingRow, 'employeeId' | 'rop'>,
): ConfirmationSellerRatingRow {
  return {
    fullName: over.employeeId,
    cohortOrders: 1,
    confirmedOrders: 1,
    confirmedMinor: 0n,
    deliveredOrders: 0,
    deliveredMinor: 0n,
    inTransitOrders: 0,
    inTransitMinor: 0n,
    lostAfterConfirmOrders: 0,
    lostAfterConfirmMinor: 0n,
    rejectedOrders: 0,
    byOutcome: ZERO_STATES,
    byOutcomeMinor: ZERO_STATES_MINOR,
    ...over,
  }
}

type Preset = 'today' | 'this_month' | 'previous_month' | 'this_year'

function contextFor(preset: Preset, now: Date): AnalyticsContext {
  const period = resolvePeriod(preset, { timeZone: TZ, now })
  return {
    period,
    comparison: previousEquivalent(period),
    currency: 'UZS',
    filters: {},
    now,
  } as unknown as AnalyticsContext
}

function serviceOver(rows: readonly ConfirmationSellerRatingRow[]) {
  const insights = {
    confirmationSellerRating: async () => [...rows],
    // The trend arm reads this one; an empty calendar still enumerates every
    // bucket, which is all the granularity cases need from it.
    confirmationFaktDays: async () => [],
  } as unknown as InsightsRepository
  const reference = { findKpisForPeriod: async () => [] } as unknown as ReferenceRepository
  return new SellerBoardService({} as SellerBoardRepository, insights, reference)
}

function boardOver(
  rows: readonly ConfirmationSellerRatingRow[],
  preset: Preset = 'this_month',
  now: Date = NOW,
) {
  return serviceOver(rows).board(contextFor(preset, now), 'queue')
}

/** 100 mln confirmed, 40 mln of it delivered, on one seller under one ROP. */
const ONE_SELLER = [
  rating({
    employeeId: 'a',
    rop: 'Lola',
    confirmedMinor: mln(100),
    deliveredMinor: mln(40),
    deliveredOrders: 1,
  }),
]

describe('the company projection carries BOTH facts', () => {
  it('projects FAKT 1 as well as FAKT 2, off the same elapsed fraction', async () => {
    const { forecast } = await boardOver(ONE_SELLER)

    /*
      27.9% of September elapsed at 09:00 on the 9th, so 100 mln of FAKT 1 is
      on course for ~358 mln and 40 mln of FAKT 2 for ~143 mln.

      FAKT 1 WAS THE MISSING HALF AND IT IS THE HALF THAT MOVES FIRST. Delivery
      lags the arrival it is projected from by about two days, so a board whose
      only projection was FAKT 2 told a floor that had confirmed a third of its
      month that it was behind — every morning, correctly, and uselessly.
    */
    expect(forecast.elapsedPercent).toBeCloseTo(27.9, 1)
    expect(forecast.fakt1!.amount / 1_000_000).toBeCloseTo(358, 0)
    expect(forecast.fakt2!.amount / 1_000_000).toBeCloseTo(143, 0)
  })

  it('names the horizon it projects to, half-open like every other bound', async () => {
    const { forecast } = await boardOver(ONE_SELLER)

    // The first instant NOT projected — 1 October in Tashkent, not 30
    // September. «Oyning 28% qismi oʻtdi» does not say WHICH month, and on
    // «Shu hafta» it is not a month at all.
    expect(forecast.windowEnd).toBe(new Date('2026-10-01T00:00:00+05:00').toISOString())
  })

  it('projects nothing once the period is over, and says 100% rather than a total', async () => {
    const { forecast } = await boardOver(ONE_SELLER, 'previous_month')

    expect(forecast.elapsedPercent).toBe(100)
    expect(forecast.fakt1).toBeNull()
    expect(forecast.fakt2).toBeNull()
    expect(forecast.buckets).toEqual([])
  })
})

describe('every row and every team is projected on the SAME clock', () => {
  it('gives each seller their own projection off the board-wide fraction', async () => {
    const { rows } = await boardOver([
      rating({ employeeId: 'a', rop: 'Lola', confirmedMinor: mln(60), deliveredMinor: mln(30) }),
      rating({ employeeId: 'b', rop: 'Lola', confirmedMinor: mln(40), deliveredMinor: mln(10) }),
    ])

    const a = rows.find((r) => r.employeeId === 'a')!
    const b = rows.find((r) => r.employeeId === 'b')!

    expect(a.forecast.fakt1!.amount / 1_000_000).toBeCloseTo(215, 0)
    expect(a.forecast.fakt2!.amount / 1_000_000).toBeCloseTo(107, 0)
    expect(b.forecast.fakt1!.amount / 1_000_000).toBeCloseTo(143, 0)

    /*
      ONE FRACTION, NOT ONE PER ROW. Two sellers' projections divided by their
      own money must be the same number — the ratio IS the elapsed fraction,
      and a row that resolved its own would be reading a different moment from
      the headline above it.
    */
    const ratio = (r: typeof a) => r.forecast.fakt1!.amount / r.ordered.amount
    expect(ratio(a)).toBeCloseTo(ratio(b), 6)
  })

  it('projects a team from the TEAM’s own money, not from its sellers’ projections', async () => {
    const { teams, rows } = await boardOver([
      rating({ employeeId: 'a', rop: 'Lola', confirmedMinor: mln(60), deliveredMinor: mln(30) }),
      rating({ employeeId: 'b', rop: 'Lola', confirmedMinor: mln(40), deliveredMinor: mln(10) }),
      rating({ employeeId: 'c', rop: 'Aziz', confirmedMinor: mln(20), deliveredMinor: mln(5) }),
    ])

    const lola = teams.find((t) => t.rop === 'Lola')!
    const members = rows.filter((r) => r.rop === 'Lola')

    // Under a straight line the two readings agree to the soʻm, which is what
    // makes the table checkable against the rows above it. They would stop
    // agreeing the moment the rule grew a floor, a cap or a per-seller
    // horizon — and the team's own money is the reading that stays true to
    // what the column is asked.
    expect(lola.forecast.fakt1!.amount / 1_000_000).toBeCloseTo(358, 0)
    expect(lola.forecast.fakt1!.amount).toBeCloseTo(
      members.reduce((a, r) => a + r.forecast.fakt1!.amount, 0),
      0,
    )
  })

  it('leaves a seller with nothing yet at NULL, never at zero', async () => {
    const { rows } = await boardOver([
      rating({ employeeId: 'a', rop: 'Lola', confirmedMinor: mln(100), deliveredMinor: mln(40) }),
      rating({ employeeId: 'quiet', rop: 'Lola', confirmedMinor: 0n, deliveredMinor: 0n }),
    ])

    const quiet = rows.find((r) => r.employeeId === 'quiet')!

    /*
      `projectRevenueMinor` projects 0 as 0, and a table printing «0 soʻm» in a
      column headed «prognoz» tells a seller who has taken an order this
      morning that their month ends at nothing. Zero money is not zero
      evidence, and the screen prints an em dash for it.
    */
    expect(quiet.forecast.fakt1?.amount ?? 0).toBe(0)
    expect(quiet.ordered.amount).toBe(0)
  })
})

describe('the chart continuation is drawn on the trend’s own calendar', () => {
  it('starts AFTER the report window, so today is never drawn twice', async () => {
    const { forecast } = await boardOver(ONE_SELLER)
    const windowEnd = resolvePeriod('this_month', { timeZone: TZ, now: NOW }).end.getTime()

    // Today's bucket is half-elapsed and already carries measured money in
    // `faktTrend`; a projection into it would put a solid point and a dashed
    // point on one date, both plausible and one of them a fiction.
    expect(forecast.buckets.length).toBe(21) // 10 September through the 30th
    for (const bucket of forecast.buckets) {
      expect(Date.parse(bucket.date)).toBeGreaterThanOrEqual(windowEnd)
    }
  })

  it('spreads exactly the money still to come, and nothing more', async () => {
    const { forecast, totals } = await boardOver(ONE_SELLER)

    const drawn = (pick: (b: (typeof forecast.buckets)[number]) => number) =>
      forecast.buckets.reduce((a, b) => a + pick(b), 0)

    // The dashed area IS the gap between the tile and the total beside it. A
    // truncating split loses a minor unit per bucket and lands short by an
    // amount too small to notice and too persistent to explain.
    expect(drawn((b) => b.fakt1)).toBeCloseTo(forecast.fakt1!.amount - totals.ordered.amount, 2)
    expect(drawn((b) => b.fakt2)).toBeCloseTo(forecast.fakt2!.amount - totals.won.amount, 2)
  })

  it('takes the stride from the WINDOW, matching the trend it continues', async () => {
    /*
      `enumerateBuckets` defaults its granularity from whichever period it is
      handed, and the forecast is handed the FULL unit while the trend is
      handed the to-date window. On «Shu yil» in February those are 46 days and
      365 — one either side of the 62-day threshold — so the default would
      continue a line of forty-six daily points with six weekly ones.
    */
    const february = new Date('2026-02-15T09:00:00+05:00')
    const service = serviceOver(ONE_SELLER)
    const ctx = contextFor('this_year', february)

    const [{ forecast }, trend] = await Promise.all([
      service.board(ctx, 'queue'),
      service.faktTrend(ctx),
    ])

    const stride = (points: readonly { date: string }[]) =>
      Date.parse(points[1]!.date) - Date.parse(points[0]!.date)

    expect(stride(trend)).toBe(86_400_000)
    expect(stride(forecast.buckets)).toBe(stride(trend))
  })

  it('draws no continuation when the window has no whole bucket left', async () => {
    // «Bugun» is already its own full unit, so there IS a projection — the day
    // is only a third gone — and there is no bucket after it to draw into.
    const { forecast } = await boardOver(ONE_SELLER, 'today')

    expect(forecast.fakt1).not.toBeNull()
    expect(forecast.buckets).toEqual([])
  })
})
