import { beforeEach, describe, expect, it } from 'vitest'

import { previousEquivalent, resolvePeriod } from '@/server/domain/period/period'
import type {
  ConfirmationSourceRatingRow,
  InsightsRepository,
} from '@/server/repositories/insightsRepository'
import type { ReferenceRepository } from '@/server/repositories/referenceRepository'
import type { SellerBoardRepository } from '@/server/repositories/sellerBoardRepository'
import type { AnalyticsContext } from '@/server/services/analyticsService'
import { SellerBoardService, resetSellerSourcesCache } from '@/server/services/sellerBoardService'

/**
 * «Manbalar boʻyicha» — the ranking and the arithmetic on each row.
 *
 * Ranked by the teams table's rule (FAKT 2, then FAKT 1, then the name, with
 * competition ranking over both figures), because the two tables sit one above
 * the other under one hero and must mean the same thing by «1-oʻrin».
 */

// Module-level memo — see `resetSellerBoardCache`.
beforeEach(resetSellerSourcesCache)

const TZ = 'Asia/Tashkent'
const NOW = new Date('2026-09-09T09:00:00+05:00')
const mln = (n: number) => BigInt(n) * 1_000_000n * 100n

function source(
  over: Partial<ConfirmationSourceRatingRow> & Pick<ConfirmationSourceRatingRow, 'sourceId'>,
): ConfirmationSourceRatingRow {
  return {
    sourceName: over.sourceId,
    sellers: 1,
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
    ...over,
  }
}

function sourcesOver(rows: readonly ConfirmationSourceRatingRow[], preset = 'this_month') {
  const period = resolvePeriod(preset as 'this_month', { timeZone: TZ, now: NOW })
  const ctx = {
    period,
    comparison: previousEquivalent(period),
    currency: 'UZS',
    filters: {},
    now: NOW,
  } as unknown as AnalyticsContext
  const insights = {
    confirmationSourceRating: async () => [...rows],
  } as unknown as InsightsRepository
  return new SellerBoardService(
    {} as SellerBoardRepository,
    insights,
    {} as ReferenceRepository,
  ).sources(ctx)
}

describe('the sources are ranked the way the teams are', () => {
  it('orders by FAKT 2 first, then FAKT 1', async () => {
    const rows = await sourcesOver([
      source({ sourceId: 'instagram', confirmedMinor: mln(90), deliveredMinor: mln(10) }),
      source({ sourceId: 'telegram', confirmedMinor: mln(20), deliveredMinor: mln(15) }),
      source({ sourceId: 'crm', confirmedMinor: mln(50), deliveredMinor: mln(10) }),
    ])

    expect(rows.map((r) => [r.rank, r.sourceId])).toEqual([
      [1, 'telegram'],
      [2, 'instagram'],
      [3, 'crm'],
    ])
  })

  it('does not let the name order the table on a morning with no FAKT 2', async () => {
    const rows = await sourcesOver([
      source({ sourceId: 'a-small', confirmedMinor: mln(2) }),
      source({ sourceId: 'z-big', confirmedMinor: mln(40) }),
    ])

    expect(rows.map((r) => r.sourceId)).toEqual(['z-big', 'a-small'])
  })

  it('shares a rank only when BOTH figures tie, and skips after it', async () => {
    const rows = await sourcesOver([
      source({ sourceId: 'b', confirmedMinor: mln(10), deliveredMinor: mln(5) }),
      source({ sourceId: 'a', confirmedMinor: mln(10), deliveredMinor: mln(5) }),
      source({ sourceId: 'c', confirmedMinor: mln(1) }),
    ])

    expect(rows.map((r) => [r.rank, r.sourceId])).toEqual([
      [1, 'a'],
      [1, 'b'],
      [3, 'c'],
    ])
  })

  it('keeps the deals with no source as a row, ranked on its money', async () => {
    const rows = await sourcesOver([
      source({ sourceId: 'named', confirmedMinor: mln(5) }),
      source({ sourceId: null, sourceName: null, confirmedMinor: mln(30) }),
    ])

    expect(rows[0]).toMatchObject({ rank: 1, sourceId: null, name: null })
    expect(rows).toHaveLength(2)
  })
})

describe('each row carries its full figures', () => {
  it('prints shares of the whole cohort that add up to a hundred', async () => {
    const rows = await sourcesOver([
      source({ sourceId: 'a', confirmedMinor: mln(75), deliveredMinor: mln(30) }),
      source({ sourceId: 'b', confirmedMinor: mln(25), deliveredMinor: mln(10) }),
    ])

    expect(rows.map((r) => r.fakt1SharePercent)).toEqual([75, 25])
    expect(rows.map((r) => r.sharePercent)).toEqual([75, 25])
  })

  it('divides conversion by the resolved orders — both kinds of loss, no open ones', async () => {
    const [row] = await sourcesOver([
      source({
        sourceId: 'a',
        deliveredOrders: 6,
        deliveredMinor: mln(6),
        rejectedOrders: 3,
        lostAfterConfirmOrders: 1,
        inTransitOrders: 50,
      }),
    ])

    expect(row!.conversionPercent).toBe(60)
    expect(row!.rejectedOrders).toBe(3)
  })

  it('has no conversion and no share over nothing, rather than a zero', async () => {
    const [row] = await sourcesOver([source({ sourceId: 'a', deliveredOrders: 0 })])

    expect(row!.conversionPercent).toBeNull()
    expect(row!.sharePercent).toBeNull()
  })

  it('projects its own money on the board’s elapsed clock', async () => {
    const [row] = await sourcesOver([
      source({ sourceId: 'a', confirmedMinor: mln(100), deliveredMinor: mln(40) }),
    ])

    // 27.9% of September has elapsed at 09:00 on the 9th — see sellerForecast.test.ts.
    expect(row!.forecast.fakt1!.amount).toBeGreaterThan(350_000_000)
    expect(row!.forecast.fakt1!.amount).toBeLessThan(365_000_000)
    expect(row!.forecast.fakt2!.amount).toBeGreaterThan(140_000_000)
  })

  it('projects nothing for a finished period', async () => {
    const [row] = await sourcesOver(
      [source({ sourceId: 'a', confirmedMinor: mln(100), deliveredMinor: mln(40) })],
      'previous_month',
    )

    expect(row!.forecast).toEqual({ fakt1: null, fakt2: null })
  })
})
