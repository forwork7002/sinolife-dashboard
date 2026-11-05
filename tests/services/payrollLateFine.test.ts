import { beforeEach, describe, expect, it } from 'vitest'

import type { LateDay } from '@/server/domain/payroll/lateFine'
import { type Period, resolvePeriod } from '@/server/domain/period/period'
import type { ConfirmationSellerRatingRow, InsightsRepository } from '@/server/repositories/insightsRepository'
import type { LateRead } from '@/server/repositories/timepayRepository'
import { type PayrollLateSource, PayrollService, resetPayrollCache } from '@/server/services/payrollService'

/**
 * «Sotuvchilar oyligi»'s lateness fine — the owner, 2026-11-05: «har bir
 * kechikkan minutiga 1 somdan jarima». TimePay's late minutes on workdays come
 * off the seller's JAMI; the tier stays FAKT 2's.
 */

beforeEach(resetPayrollCache)

const TZ = 'Asia/Tashkent'
const NOW = new Date('2026-10-20T06:00:00Z')
const mln = (n: number) => BigInt(Math.round(n * 1_000_000)) * 100n
const som = (n: number) => BigInt(n) * 100n
const EMPTY = { CONFIRM_NEW: 0, NO_ANSWER: 0, CONFIRMED: 0, REJECTED: 0, UNCONFIRMED_SHIPPED: 0 }
const EMPTY_MINOR = { CONFIRM_NEW: 0n, NO_ANSWER: 0n, CONFIRMED: 0n, REJECTED: 0n, UNCONFIRMED_SHIPPED: 0n }

function days(from: string, to: string): Period {
  return resolvePeriod('custom', {
    timeZone: TZ,
    now: new Date('2030-01-01T00:00:00Z'),
    customStart: new Date(`${from}T12:00:00Z`),
    customEnd: new Date(`${to}T12:00:00Z`),
  })
}

const SEPTEMBER = days('2026-09-01', '2026-09-30')
const AUGUST = days('2026-08-01', '2026-08-31')

function row(employeeId: string, rop: string | null, fakt2Mln: number): ConfirmationSellerRatingRow {
  return {
    employeeId,
    fullName: employeeId,
    rop,
    lastQueuedAt: new Date(Date.UTC(2026, 8, 10)),
    cohortOrders: 10,
    confirmedOrders: 10,
    confirmedMinor: mln(fakt2Mln),
    deliveredOrders: 8,
    deliveredMinor: mln(fakt2Mln),
    inTransitOrders: 0,
    inTransitMinor: 0n,
    lostAfterConfirmOrders: 0,
    lostAfterConfirmMinor: 0n,
    rejectedOrders: 0,
    byOutcome: EMPTY,
    byOutcomeMinor: EMPTY_MINOR,
  }
}

function insights(current: ConfirmationSellerRatingRow[], previous: ConfirmationSellerRatingRow[] = []): InsightsRepository {
  return {
    ropHeadNames: async () => new Map(),
    ropAncestorNames: async () => new Map(),
    employeesByExternalId: async () => new Map([['7044', { id: 'flat-7044', fullName: 'Flat' }]]),
    confirmationSellerRating: async ({ start }: { start: Date }) =>
      start.getTime() === SEPTEMBER.start.getTime() ? current : previous,
  } as unknown as InsightsRepository
}

const late = (d: string, minutes: number, over: Partial<LateDay> = {}): LateDay => ({
  day: d,
  checkIn: '08:40',
  lateMinutes: minutes,
  holiday: false,
  onLeave: false,
  ...over,
})

function lateSource(byWindow: Record<string, Record<string, LateDay[]>>, linked: string[], asked?: string[]): PayrollLateSource {
  return {
    lateDays: async (from: string, to: string): Promise<LateRead> => {
      asked?.push(`${from}|${to}`)
      return {
        days: new Map(Object.entries(byWindow[`${from}|${to}`] ?? {})),
        linked: new Set(linked),
        syncedAt: new Date('2026-10-20T05:55:00Z'),
      }
    },
  }
}

const service = (rows: ConfirmationSellerRatingRow[], source: PayrollLateSource | null, previous: ConfirmationSellerRatingRow[] = []) =>
  new PayrollService(insights(rows, previous), null, () => {}, source)

describe('the lateness fine on the payroll', () => {
  it('takes 1 soʻm a late minute off JAMI, over the window’s Tashkent days', async () => {
    const asked: string[] = []
    const dto = await service(
      [row('late', 'Lola', 40), row('punctual', 'Lola', 40)],
      lateSource(
        {
          '2026-09-01|2026-09-30': {
            // Wed 2 Sep 15 min, Thu 3 Sep 32 min, Sun 6 Sep 50 min (a day off — not fined).
            late: [late('2026-09-02', 15), late('2026-09-03', 32), late('2026-09-06', 50)],
          },
        },
        ['late', 'punctual'],
        asked,
      ),
    ).payroll(SEPTEMBER, AUGUST, 'UZS', NOW)
    expect(asked).toContain('2026-09-01|2026-09-30')
    const by = new Map(dto.sellers.map((s) => [s.employeeId, s]))

    const fined = by.get('late')!
    expect(fined.lateMinutes).toBe(47)
    expect(fined.lateFine.amountMinor).toBe(String(som(47)))
    // 40 mln × 8% = 3 200 000, no fiksa below 45 mln; minus 47 soʻm.
    expect(fined.total.amountMinor).toBe(String(som(3_200_000 - 47)))
    // The tier is FAKT 2's alone.
    expect(fined.percent.amountMinor).toBe(String(som(3_200_000)))

    const onTime = by.get('punctual')!
    expect(onTime.lateMinutes).toBe(0)
    expect(onTime.lateFine.amountMinor).toBe('0')
    expect(onTime.total.amountMinor).toBe(String(som(3_200_000)))

    expect(dto.totals.lateMinutes).toBe(47)
    expect(dto.totals.lateFine.amountMinor).toBe(String(som(47)))
    expect(dto.totals.total.amountMinor).toBe(String(som(6_400_000 - 47)))
    expect(dto.teams[0]!.lateFine.amountMinor).toBe(String(som(47)))
    expect(dto.teams[0]!.total.amountMinor).toBe(String(som(6_400_000 - 47)))
    expect(dto.fund.amountMinor).toBe(String(BigInt(dto.totals.total.amountMinor) + BigInt(dto.ropTotals.total.amountMinor)))
    expect(dto.timepay).toEqual({
      syncedAt: '2026-10-20T05:55:00.000Z',
      perMinute: expect.objectContaining({ amountMinor: '100' }),
      linked: 2,
      unlinked: 0,
    })
  })

  it('fines nobody it does not know: an unlinked seller is «null», not «0 minutes»', async () => {
    const dto = await service([row('unknown', 'Lola', 40)], lateSource({}, [])).payroll(SEPTEMBER, AUGUST, 'UZS', NOW)
    const seller = dto.sellers[0]!
    expect(seller.lateMinutes).toBeNull()
    expect(seller.lateFine.amountMinor).toBe('0')
    expect(seller.total.amountMinor).toBe(String(som(3_200_000)))
    expect(dto.timepay.unlinked).toBe(1)
  })

  it('fines the comparison window by the same rule', async () => {
    const dto = await service(
      [row('s', 'Lola', 40)],
      lateSource(
        {
          '2026-09-01|2026-09-30': { s: [late('2026-09-02', 10)] },
          '2026-08-01|2026-08-31': { s: [late('2026-08-04', 100)] },
        },
        ['s'],
      ),
      [row('s', 'Lola', 40)],
    ).payroll(SEPTEMBER, AUGUST, 'UZS', NOW)
    const seller = dto.sellers[0]!
    expect(seller.total.amountMinor).toBe(String(som(3_200_000 - 10)))
    expect(seller.previous!.total.amountMinor).toBe(String(som(3_200_000 - 100)))
  })

  it('without TimePay pays exactly as before', async () => {
    const dto = await service([row('s', 'Lola', 40)], null).payroll(SEPTEMBER, AUGUST, 'UZS', NOW)
    expect(dto.sellers[0]!.total.amountMinor).toBe(String(som(3_200_000)))
    expect(dto.timepay.syncedAt).toBeNull()
  })

  it('fails the payroll when TimePay’s stored days cannot be read — never pays unfined in silence', async () => {
    const broken: PayrollLateSource = {
      lateDays: async () => {
        throw new Error('db down')
      },
    }
    await expect(service([row('s', 'Lola', 40)], broken).payroll(SEPTEMBER, AUGUST, 'UZS', NOW)).rejects.toThrow()
  })
})
