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
 * WHAT THE FAKT SPINE ON SAVDO DINAMIKASI IS BUILT FROM.
 *
 * The client asked on 2026-09-09 for that page's essential data to be built on
 * FAKT 1 and FAKT 2. Two things this payload carried were not fit to build on,
 * and both were invisible because nothing rendered them:
 *
 *  1. `forecast` measured its elapsed fraction against the REPORT window, which
 *     for every to-date preset is almost entirely elapsed. Live on 9 September
 *     it answered 94.4% — a «month-end forecast» of tonight.
 *  2. The money behind «confirmed, then cancelled» was measured in SQL and
 *     dropped at the service boundary, so the only way to print it was
 *     `ordered − won − open` — an arithmetic that is WRONG here, because
 *     FAKT 2 is not a subset of FAKT 1.
 *
 * Both are now facts on the payload, and this file is what keeps them true.
 */

// Every case builds a board for one window; without this they share one memo
// entry and each case after the first asserts against the first's fixtures.
beforeEach(resetSellerBoardCache)

const TZ = 'Asia/Tashkent'
/** The 9th of a 30-day month, 09:00 on the floor. */
const NOW = new Date('2026-09-09T09:00:00+05:00')

const mln = (n: number) => BigInt(n) * 1_000_000n * 100n

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

async function boardOver(
  rows: readonly ConfirmationSellerRatingRow[],
  preset: 'today' | 'this_month' | 'previous_month' = 'this_month',
) {
  const insights = {
    confirmationSellerRating: async () => [...rows],
  } as unknown as InsightsRepository
  const reference = { findKpisForPeriod: async () => [] } as unknown as ReferenceRepository
  const service = new SellerBoardService({} as SellerBoardRepository, insights, reference)
  // Built by hand rather than through `AnalyticsService.context`, whose module
  // reads `env` at import and would make this a test of the environment.
  const period = resolvePeriod(preset, { timeZone: TZ, now: NOW })
  const ctx = {
    period,
    comparison: previousEquivalent(period),
    currency: 'UZS',
    filters: {},
    now: NOW,
  } as unknown as AnalyticsContext
  return service.board(ctx, 'queue')
}

describe('the FAKT 2 run-rate measures the month, not the window', () => {
  it('reads the fraction of the CALENDAR unit that has elapsed', async () => {
    const board = await boardOver([rating({ employeeId: 'a', rop: 'Lola', deliveredMinor: mln(100) })])

    /*
      27.9% — 8 days and 9 hours of a 30-day September.

      The figure this replaces was 93.1%: `this_month` resolves to
      [1-sen, 10-sen) and a to-date window is by construction nearly spent, so
      the old reading projected a month's delivery forward by seven percent and
      called it «oy yakuni». `performance.ts` records the identical bug from
      the KPI screen — "The number was wrong every day of every month".
    */
    expect(board.forecast.elapsedPercent).toBeCloseTo(27.9, 1)
    expect(board.forecast.elapsedPercent).toBeLessThan(40)
  })

  it('projects the month from that fraction, not from the window', async () => {
    const board = await boardOver([rating({ employeeId: 'a', rop: 'Lola', deliveredMinor: mln(100) })])

    // 100 mln in 27.9% of the month → ~358 mln by month end. The old reading
    // projected ~107 mln, which is barely a forecast at all.
    const projected = board.forecast.fakt2
    expect(projected).not.toBeNull()
    expect(projected!.amount / 1_000_000).toBeCloseTo(358, 0)
  })

  it('projects nothing for a period that is already over', async () => {
    // A finished total is not a forecast. `fullUnitWindow` passes completed
    // presets through unchanged, so the elapsed fraction is 1 and the guard
    // in `forecastOf` returns null rather than restating the total.
    const board = await boardOver(
      [rating({ employeeId: 'a', rop: 'Lola', deliveredMinor: mln(100) })],
      'previous_month',
    )

    expect(board.forecast.elapsedPercent).toBe(100)
    expect(board.forecast.fakt2).toBeNull()
  })
})

describe('the totals carry the loss the page prints', () => {
  const ROWS = [
    rating({
      employeeId: 'a',
      rop: 'Lola',
      cohortOrders: 10,
      confirmedOrders: 8,
      confirmedMinor: mln(80),
      deliveredOrders: 5,
      deliveredMinor: mln(50),
      inTransitOrders: 2,
      inTransitMinor: mln(20),
      lostAfterConfirmOrders: 1,
      lostAfterConfirmMinor: mln(10),
      rejectedOrders: 2,
    }),
    rating({
      employeeId: 'b',
      rop: 'Sevinch',
      cohortOrders: 6,
      confirmedOrders: 4,
      confirmedMinor: mln(40),
      deliveredOrders: 3,
      deliveredMinor: mln(36),
      inTransitOrders: 1,
      inTransitMinor: mln(3),
      lostAfterConfirmOrders: 0,
      lostAfterConfirmMinor: 0n,
      rejectedOrders: 2,
    }),
  ]

  it('sums the three counts the page used to reduce from rows by hand', async () => {
    const { totals } = await boardOver(ROWS)

    expect(totals.openOrders).toBe(3)
    // Refusals at the door PLUS the ones confirmed before they died — the
    // conversion rate's own denominator, which the page was reducing itself.
    expect(totals.lostOrders).toBe(5)
    expect(totals.lostAfterConfirmOrders).toBe(1)
  })

  it('carries the money of «confirmed, then cancelled» rather than leaving it to subtraction', async () => {
    const { totals } = await boardOver(ROWS)

    expect(totals.lostAfterConfirm.amountMinor).toBe(mln(10).toString())

    /*
      AND IT IS NOT `ordered − won − open`, which is the arithmetic a page
      without this field is forced into.

      Seller b delivered 36 mln against 40 mln confirmed with 3 mln still on
      the road, so the subtraction leaves 1 mln of «lost after confirm» for
      somebody who lost nothing — it is really the money of an order that was
      delivered without ever being confirmed. FAKT 2 is not a subset of FAKT 1,
      so the three columns do not close, and only the measured column is true.
    */
    const subtraction =
      BigInt(totals.ordered.amountMinor) -
      BigInt(totals.won.amountMinor) -
      BigInt(totals.open.amountMinor)
    expect(subtraction).not.toBe(BigInt(totals.lostAfterConfirm.amountMinor))
  })

  it('keeps the per-seller money beside the count', async () => {
    const { rows } = await boardOver(ROWS)
    const a = rows.find((r) => r.employeeId === 'a')!

    expect(a.lostAfterConfirmOrders).toBe(1)
    expect(a.lostAfterConfirm.amountMinor).toBe(mln(10).toString())
    expect(a.lostAfterConfirm.currency).toBe('UZS')
  })
})

describe('the totals keep the five queue states apart', () => {
  /*
    2026-09-15, the client: «tasdiqlanganlar, tasdiqlanmay chiqdilar bilan
    tasdiqlanmaganlar nisbati». FAKT 1 folds Тасдиқланди and Тасдиқланмай
    чиқди into one count on purpose; Savdo dinamikasi now prints the fold
    undone, and what this file guards is the arithmetic: the five parts are
    summed the way `cohortOrders` is, so they add up to it, and the rate is
    the Тасдиқлаш board's own — Тасдиқланди over everything that entered.
  */
  const ROWS = [
    rating({
      employeeId: 'a',
      rop: 'Lola',
      cohortOrders: 10,
      confirmedOrders: 8,
      confirmedMinor: mln(80),
      rejectedOrders: 2,
      byOutcome: { CONFIRM_NEW: 0, NO_ANSWER: 0, CONFIRMED: 7, REJECTED: 2, UNCONFIRMED_SHIPPED: 1 },
      byOutcomeMinor: {
        CONFIRM_NEW: 0n,
        NO_ANSWER: 0n,
        CONFIRMED: mln(70),
        REJECTED: mln(20),
        UNCONFIRMED_SHIPPED: mln(10),
      },
    }),
    rating({
      employeeId: 'b',
      rop: 'Sevinch',
      cohortOrders: 6,
      confirmedOrders: 4,
      confirmedMinor: mln(40),
      rejectedOrders: 1,
      byOutcome: { CONFIRM_NEW: 1, NO_ANSWER: 0, CONFIRMED: 3, REJECTED: 1, UNCONFIRMED_SHIPPED: 1 },
      byOutcomeMinor: {
        CONFIRM_NEW: mln(5),
        NO_ANSWER: 0n,
        CONFIRMED: mln(30),
        REJECTED: mln(9),
        UNCONFIRMED_SHIPPED: mln(10),
      },
    }),
  ]

  it('sums each state over the rows, count and money', async () => {
    const { totals } = await boardOver(ROWS)

    expect(totals.outcomes).not.toBeNull()
    expect(totals.outcomes!.CONFIRMED.orders).toBe(10)
    expect(totals.outcomes!.UNCONFIRMED_SHIPPED.orders).toBe(2)
    expect(totals.outcomes!.REJECTED.orders).toBe(3)
    expect(totals.outcomes!.CONFIRM_NEW.orders).toBe(1)
    expect(totals.outcomes!.NO_ANSWER.orders).toBe(0)

    expect(totals.outcomes!.CONFIRMED.amount.amountMinor).toBe(mln(100).toString())
    expect(totals.outcomes!.UNCONFIRMED_SHIPPED.amount.amountMinor).toBe(mln(20).toString())
    expect(totals.outcomes!.REJECTED.amount.amountMinor).toBe(mln(29).toString())
    expect(totals.outcomes!.NO_ANSWER.amount.amount).toBe(0)
  })

  it('partitions the cohort — the five counts add up to cohortOrders', async () => {
    const { totals } = await boardOver(ROWS)

    const parts = Object.values(totals.outcomes!).reduce((sum, state) => sum + state.orders, 0)
    expect(parts).toBe(totals.cohortOrders)
    expect(parts).toBe(16)
    // And FAKT 1's count is the two shipped states, nothing else.
    expect(totals.outcomes!.CONFIRMED.orders + totals.outcomes!.UNCONFIRMED_SHIPPED.orders).toBe(
      totals.orders,
    )
  })

  it('states the confirmation rate over everything that entered the queue', async () => {
    const { totals } = await boardOver(ROWS)

    // 10 of 16 — Тасдиқланди alone, not FAKT 1: an order shipped without
    // reaching the customer is not a confirmation, whatever it earns.
    expect(totals.confirmedRate).toBe(62.5)
  })

  it('has no rate over an empty queue, and zero states rather than none', async () => {
    const { totals } = await boardOver([])

    expect(totals.confirmedRate).toBeNull()
    expect(totals.outcomes).not.toBeNull()
    expect(totals.outcomes!.CONFIRMED.orders).toBe(0)
  })

  it('carries no states on the intake basis, which has no queue to split', async () => {
    const repo = {
      board: async () => [
        {
          employeeId: 'a',
          fullName: 'a',
          rop: 'Lola',
          departmentName: 'Lola(ROP)',
          orders: 3,
          orderedMinor: mln(30),
          wonOrders: 1,
          wonMinor: mln(10),
          openOrders: 2,
          openMinor: mln(20),
          lostOrders: 0,
          lostAfterConfirmOrders: 0,
          lostAfterConfirmMinor: 0n,
          cohortOrders: 3,
          byOutcome: null,
          byOutcomeMinor: null,
        },
      ],
    } as unknown as SellerBoardRepository
    const reference = { findKpisForPeriod: async () => [] } as unknown as ReferenceRepository
    const service = new SellerBoardService(repo, {} as InsightsRepository, reference)
    const period = resolvePeriod('this_month', { timeZone: TZ, now: NOW })
    const ctx = {
      period,
      comparison: previousEquivalent(period),
      currency: 'UZS',
      filters: {},
      now: NOW,
    } as unknown as AnalyticsContext

    const { totals, basis } = await service.board(ctx, 'intake')

    expect(basis).toBe('created_in_period')
    expect(totals.outcomes).toBeNull()
    expect(totals.confirmedRate).toBeNull()
  })
})
