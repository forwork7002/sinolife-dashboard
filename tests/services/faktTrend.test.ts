import { describe, expect, it } from 'vitest'

import { previousEquivalent, resolvePeriod } from '@/server/domain/period/period'
import type { InsightsRepository } from '@/server/repositories/insightsRepository'
import type { ReferenceRepository } from '@/server/repositories/referenceRepository'
import type { SellerBoardRepository } from '@/server/repositories/sellerBoardRepository'
import type { AnalyticsContext } from '@/server/services/analyticsService'
import { SellerBoardService } from '@/server/services/sellerBoardService'

/**
 * The FAKT 1 / FAKT 2 lines drawn over the revenue area on Savdo dinamikasi.
 *
 * ONE X AXIS, TWO CLOCKS. The area under them is revenue on the CLOSE date and
 * these two are the confirmation queue's own arrivals — the client asked for
 * the comparison on one chart on 2026-09-09 and the screen names both bases.
 * What this file guards is the half that is not a matter of wording: the
 * points have to land on the SAME buckets `revenueTrend` produces, or the two
 * series are drawn against different x positions and the chart quietly
 * compares September the 3rd with September the 5th.
 *
 * That is why the buckets come from `enumerateBuckets(ctx.period)` — the same
 * call, with the same default granularity — and why every bucket is emitted
 * even when the queue was empty: a series that skips its quiet days is shorter
 * than the one beside it, and Recharts would index them against each other.
 */

const TZ = 'Asia/Tashkent'
const NOW = new Date('2026-09-08T09:00:00+05:00')

type FaktDayRow = { date: string; confirmedMinor: bigint; deliveredMinor: bigint; orders: number }

const mln = (n: number) => BigInt(n) * 1_000_000n * 100n

function serviceOver(rows: readonly FaktDayRow[]) {
  const calls: unknown[][] = []
  const insights = {
    confirmationFaktDays: async (...args: unknown[]) => {
      calls.push(args)
      return [...rows]
    },
  } as unknown as InsightsRepository
  const reference = { findKpisForPeriod: async () => [] } as unknown as ReferenceRepository
  const service = new SellerBoardService({} as SellerBoardRepository, insights, reference)

  // Built by hand rather than through `AnalyticsService.context`, whose module
  // reads `env` at import and would make this a test of the environment.
  const run = (
    preset: 'today' | 'this_month' | 'custom',
    filters: Record<string, unknown> = {},
    custom?: { customStart: Date; customEnd: Date },
  ) => {
    const period = resolvePeriod(preset, { timeZone: TZ, now: NOW, ...custom })
    const ctx = {
      period,
      comparison: previousEquivalent(period),
      currency: 'UZS',
      filters: { restrictToEmployeeIds: null, ...filters },
      now: NOW,
    } as unknown as AnalyticsContext
    return service.faktTrend(ctx)
  }

  return { run, calls }
}

describe('the FAKT trend lands on the revenue chart’s own buckets', () => {
  it('emits one point per bucket, in order, keyed by the bucket start', async () => {
    const { run } = serviceOver([
      { date: '2026-09-02', confirmedMinor: mln(120), deliveredMinor: mln(80), orders: 70 },
    ])

    const points = await run('this_month')

    // 1–8 September: `this_month` is to-date, so eight daily buckets.
    expect(points).toHaveLength(8)
    expect(points.map((p) => p.date.slice(0, 10))).toEqual([
      '2026-08-31', // 1 Sep 00:00 in Tashkent is 31 Aug 19:00 UTC
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
    ])
  })

  it('zero-fills the quiet days rather than skipping them', async () => {
    const { run } = serviceOver([
      { date: '2026-09-02', confirmedMinor: mln(120), deliveredMinor: mln(80), orders: 70 },
    ])

    const points = await run('this_month')

    // The second of September is the third bucket.
    expect(points[1]).toMatchObject({ fakt1: 120_000_000, fakt2: 80_000_000, orders: 70 })
    expect(points[0]).toMatchObject({ fakt1: 0, fakt2: 0, orders: 0 })
    expect(points[7]).toMatchObject({ fakt1: 0, fakt2: 0, orders: 0 })
  })

  it('keeps a day that delivered without confirming anything', async () => {
    // FAKT 2 is not a subset of FAKT 1 — an order refused in the queue and
    // revived afterwards delivers on a day that confirmed nothing, and that is
    // exactly where the two lines cross.
    const { run } = serviceOver([
      { date: '2026-09-05', confirmedMinor: 0n, deliveredMinor: mln(58), orders: 0 },
    ])

    const points = await run('this_month')

    expect(points[4]).toMatchObject({ fakt1: 0, fakt2: 58_000_000, orders: 0 })
  })

  it('sums the days into the wider bucket when the window widens', async () => {
    // Over 62 days the chart goes weekly, so two days in one week are one
    // point — the same widening `revenueTrend` does, or the FAKT line would
    // carry more points than the area under it.
    const { run } = serviceOver([
      { date: '2026-03-03', confirmedMinor: mln(10), deliveredMinor: mln(4), orders: 5 },
      { date: '2026-03-05', confirmedMinor: mln(20), deliveredMinor: mln(6), orders: 9 },
    ])

    const points = await run('custom', {}, {
      customStart: new Date('2026-01-01T00:00:00+05:00'),
      customEnd: new Date('2026-06-30T00:00:00+05:00'),
    })

    const march = points.filter((p) => p.fakt1 > 0)
    expect(march).toHaveLength(1)
    expect(march[0]).toMatchObject({ fakt1: 30_000_000, fakt2: 10_000_000, orders: 14 })
  })

  it('asks the repository for the board’s filters, and never for a scope', async () => {
    // Same rule as the board it is drawn beside: `/analytics/sellers` is
    // company-wide on purpose, and `boardFilters` is what drops
    // `restrictToEmployeeIds` a second time so a scope cannot reach the SQL.
    const { run, calls } = serviceOver([])

    await run('today', {
      employeeIds: ['e1'],
      departmentIds: ['d1'],
      sourceIds: ['s1'],
      restrictToEmployeeIds: ['nobody'],
    })

    const filters = calls[0]?.[1] as Record<string, unknown>
    expect(filters).toMatchObject({
      employeeIds: ['e1'],
      departmentIds: ['d1'],
      sourceIds: ['s1'],
    })
    expect(filters.restrictToEmployeeIds).toBeUndefined()

    const window = calls[0]?.[0] as { restrictToEmployeeIds: readonly string[] | null }
    expect(window.restrictToEmployeeIds).toBeNull()
  })

  it('drops a day the window does not cover rather than folding it into an edge', async () => {
    // The repository is bound to the same window, so this cannot happen from
    // SQL — but a day that fell outside would silently be added to the first
    // or last bucket by a `>=`-only match, and that is a wrong number rather
    // than a missing one.
    const { run } = serviceOver([
      { date: '2026-08-20', confirmedMinor: mln(999), deliveredMinor: mln(999), orders: 999 },
    ])

    const points = await run('this_month')

    expect(points.every((p) => p.fakt1 === 0 && p.fakt2 === 0 && p.orders === 0)).toBe(true)
  })
})
