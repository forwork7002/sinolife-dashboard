import { beforeEach, describe, expect, it } from 'vitest'

import { previousEquivalent, resolvePeriod } from '@/server/domain/period/period'
import type { ConfirmationMonthlyRecordRow, InsightsRepository } from '@/server/repositories/insightsRepository'
import type { ReferenceRepository } from '@/server/repositories/referenceRepository'
import type { SellerBoardRepository } from '@/server/repositories/sellerBoardRepository'
import type { AnalyticsContext } from '@/server/services/analyticsService'
import { SellerBoardService, resetSellerRecordsCache } from '@/server/services/sellerBoardService'

/**
 * The record wall's one real decision: WHICH FIGURE IS THE RECORD.
 *
 * The client's rule, already spelled out on the podium: FAKT 2 decides, and
 * FAKT 1 decides only when nobody has delivered. On this floor that is not an
 * edge case — delivery lags confirmation by about two days, so every month
 * still in progress is ranked on FAKT 1 while every closed month is ranked on
 * FAKT 2. The two are different sizes, which means a strip that printed one
 * number without saying which it was would show a running month beating a
 * closed one and read as a record being broken. `basis` is what stops that,
 * and this file is what keeps `basis` honest about the figure beside it.
 */

const TZ = 'Asia/Tashkent'
const NOW = new Date('2026-09-08T09:00:00+05:00')

beforeEach(resetSellerRecordsCache)

function row(over: Partial<ConfirmationMonthlyRecordRow> & Pick<ConfirmationMonthlyRecordRow, 'month'>): ConfirmationMonthlyRecordRow {
  return {
    employeeId: 'e1',
    fullName: 'Seller One',
    rop: 'Asliddin',
    confirmedOrders: 0,
    confirmedMinor: 0n,
    deliveredOrders: 0,
    deliveredMinor: 0n,
    ...over,
  }
}

const mln = (n: number) => BigInt(n) * 1_000_000n * 100n

function serviceOver(rows: readonly ConfirmationMonthlyRecordRow[]) {
  const insights = {
    confirmationSellerRecords: async () => [...rows],
  } as unknown as InsightsRepository
  const reference = { findKpisForPeriod: async () => [] } as unknown as ReferenceRepository
  const service = new SellerBoardService({} as SellerBoardRepository, insights, reference)

  // Built by hand rather than through `AnalyticsService.context`, whose module
  // reads `env` at import and would make this a test of the environment.
  return (restrictToEmployeeIds: readonly string[] | null = null) => {
    const period = resolvePeriod('today', { timeZone: TZ, now: NOW })
    const ctx = {
      period,
      comparison: previousEquivalent(period),
      currency: 'UZS',
      filters: { restrictToEmployeeIds },
      now: NOW,
    } as unknown as AnalyticsContext
    return service.records(ctx)
  }
}

describe('which figure the wall calls the record', () => {
  it('prints delivered money, and says so, when the month has any', () => {
    const records = serviceOver([
      row({ month: '2026-08-01', confirmedMinor: mln(160), confirmedOrders: 90, deliveredMinor: mln(128), deliveredOrders: 74 }),
    ])

    return records().then((r) => {
      const august = r.months[0]!
      expect(august.basis).toBe('delivered')
      expect(august.amount.amount).toBe(128_000_000)
      expect(august.orders).toBe(74)
      // Both figures travel regardless, so the strip can show the other one.
      expect(august.confirmed.amount).toBe(160_000_000)
      expect(august.confirmedOrders).toBe(90)
    })
  })

  it('falls back to confirmed money, and says so, when nothing is delivered yet', async () => {
    const records = serviceOver([
      row({ month: '2026-09-01', confirmedMinor: mln(44), confirmedOrders: 21, deliveredMinor: 0n, deliveredOrders: 0 }),
    ])

    const september = (await records()).months[0]!
    expect(september.basis).toBe('confirmed')
    expect(september.amount.amount).toBe(44_000_000)
    expect(september.orders).toBe(21)
    // And the empty half is still reported rather than omitted.
    expect(september.delivered.amount).toBe(0)
    expect(september.deliveredOrders).toBe(0)
  })

  it('marks the month in progress, because a lead is not yet a record', async () => {
    const records = serviceOver([
      row({ month: '2026-09-01', confirmedMinor: mln(44) }),
      row({ month: '2026-08-01', deliveredMinor: mln(128), deliveredOrders: 74 }),
    ])

    const months = (await records()).months
    // NOW is 8 September in Tashkent.
    expect(months.map((m) => [m.month, m.running])).toEqual([
      ['2026-09-01', true],
      ['2026-08-01', false],
    ])
  })

  it('reads the running month in the reporting zone, not the server’s', async () => {
    /*
      A server in UTC is five hours behind Tashkent, so for the first five
      hours of every Tashkent month the two disagree about which month is
      running — and the wall would print the new month's leader as a settled
      record. `monthKey` asks in APP_TIMEZONE for exactly that reason.
    */
    const justPastMidnight = new Date('2026-10-01T01:00:00+05:00') // 30 Sep 20:00 UTC
    const insights = {
      confirmationSellerRecords: async () => [row({ month: '2026-10-01', confirmedMinor: mln(1) })],
    } as unknown as InsightsRepository
    const service = new SellerBoardService(
      {} as SellerBoardRepository,
      insights,
      { findKpisForPeriod: async () => [] } as unknown as ReferenceRepository,
    )
    const period = resolvePeriod('today', { timeZone: TZ, now: justPastMidnight })
    const ctx = {
      period,
      comparison: previousEquivalent(period),
      currency: 'UZS',
      filters: { restrictToEmployeeIds: null },
      now: justPastMidnight,
    } as unknown as AnalyticsContext

    const october = (await service.records(ctx)).months[0]!
    expect(october.running).toBe(true)
  })
})

describe('what the wall says about whose records these are', () => {
  it('is unscoped for an account that reads the whole company', async () => {
    const records = serviceOver([row({ month: '2026-08-01', deliveredMinor: mln(128) })])
    expect((await records(null)).scoped).toBe(false)
  })

  it('is scoped for a ROP, so «rekord» cannot be read as the company’s', async () => {
    // Same meaning and same reason as `SellerBoardDto.scoped`: a record inside
    // one team is not the firm's record, and the screen has to be able to say
    // which it is showing.
    const records = serviceOver([row({ month: '2026-08-01', deliveredMinor: mln(128) })])
    expect((await records(['e1', 'e2'])).scoped).toBe(true)
  })

  it('reports the first instant it covers, so the wall can disclose its own floor', async () => {
    const records = serviceOver([])
    // 2026-08 in Tashkent — the month the operator snapshot began. See
    // RECORDS_FROM for the measured reason it is not «all time».
    expect((await records()).from).toBe('2026-07-31T19:00:00.000Z')
    expect((await records()).months).toEqual([])
  })
})
