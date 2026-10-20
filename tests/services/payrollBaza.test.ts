import { beforeEach, describe, expect, it } from 'vitest'

import { type Period, resolvePeriod } from '@/server/domain/period/period'
import type { ConfirmationSellerRatingRow, InsightsRepository } from '@/server/repositories/insightsRepository'
import type { SellerLeadRow } from '@/server/domain/registration/ropReport'
import { type PayrollLeadsSource, PayrollService, resetPayrollCache } from '@/server/services/payrollService'

/**
 * THE 2026-10-20 PAYROLL: blocks (Toshkent · Navoiy · Baza · Zextra), БАЗА's
 * own tables, Marjona Shahtiyarovna's flat 18%, and «ROP otchet»'s lead,
 * order and conversion columns beside the pay.
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

function row(employeeId: string, rop: string | null, fakt2Mln: number, fakt1Orders = 10, day = 10): ConfirmationSellerRatingRow {
  return {
    employeeId,
    fullName: employeeId,
    rop,
    lastQueuedAt: new Date(Date.UTC(2026, 8, day)),
    cohortOrders: fakt1Orders,
    confirmedOrders: fakt1Orders,
    confirmedMinor: mln(fakt2Mln),
    deliveredOrders: Math.max(1, fakt1Orders - 2),
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

const COLLAGEN = 'Коллаген отдел продаж'
const TREE = new Map<string, string[]>([
  ['Lola', ['Навоий', COLLAGEN]],
  ['Baza', ['Навоий', COLLAGEN]],
  ['Marjona', ['Тошкент', COLLAGEN]],
  ['Malika', ['Зехтра отдел продаж']],
  ['Asliddin', ['Malika(ROP)', 'Зехтра отдел продаж']],
])

function insights(
  current: ConfirmationSellerRatingRow[],
  opts: {
    previous?: ConfirmationSellerRatingRow[]
    /** Who portal user 7044 is; by default somebody in none of the rows. */
    flatId?: string | null
    flatFails?: boolean
    tree?: Map<string, string[]>
  } = {},
): InsightsRepository {
  return {
    ropHeadNames: async () => new Map([['Marjona', 'Marjona Shahtiyarovna 197']]),
    ropAncestorNames: async () => opts.tree ?? TREE,
    employeesByExternalId: async () => {
      if (opts.flatFails) throw new Error('db down')
      const id = opts.flatId === undefined ? 'flat-7044' : opts.flatId
      return new Map(id === null ? [] : [['7044', { id, fullName: 'Marjona Shahtiyarovna 197' }]])
    },
    confirmationSellerRating: async ({ start }: { start: Date }) =>
      start.getTime() === SEPTEMBER.start.getTime() ? current : (opts.previous ?? []),
  } as unknown as InsightsRepository
}

function leadsOf(rows: SellerLeadRow[], asked?: [string, string][]): PayrollLeadsSource {
  return {
    sellerLeads: async (from: string, to: string) => {
      asked?.push([from, to])
      return rows
    },
  }
}

describe('БАЗА is paid by its own table', () => {
  it('pays Farrux\'s «Baza» and Malika\'s team 10/12/15% + oklad, the rest by the standard table', async () => {
    const dto = await new PayrollService(
      insights([row('farrux-seller', 'Baza', 28), row('malika-seller', 'Malika', 15), row('lola-seller', 'Lola', 28)]),
    ).payroll(SEPTEMBER, AUGUST, 'UZS', NOW)
    const by = new Map(dto.sellers.map((s) => [s.employeeId, s]))

    expect(by.get('farrux-seller')!.table).toBe('baza')
    expect(by.get('farrux-seller')!.percentRate).toBe(12)
    expect(by.get('farrux-seller')!.total.amountMinor).toBe(String(som(3_860_000)))

    expect(by.get('malika-seller')!.table).toBe('baza')
    expect(by.get('malika-seller')!.percentRate).toBe(8)
    expect(by.get('malika-seller')!.total.amountMinor).toBe(String(som(1_200_000 + 500_000)))

    expect(by.get('lola-seller')!.table).toBe('standard')
    expect(by.get('lola-seller')!.total.amountMinor).toBe(String(som(2_240_000)))
  })

  it('follows the seller\'s newest team: БАЗА\'s table and block for one who moved there', async () => {
    const dto = await new PayrollService(
      insights([row('moved', 'Lola', 10, 10, 5), row('moved', 'Baza', 18, 10, 25)]),
    ).payroll(SEPTEMBER, AUGUST, 'UZS', NOW)
    const moved = dto.sellers.find((s) => s.employeeId === 'moved')!
    expect(moved.rop).toBe('Baza')
    expect(moved.branch).toBe('baza')
    expect(moved.table).toBe('baza')
    // 28 mln on БАЗА's month: 12% + 500 000.
    expect(moved.total.amountMinor).toBe(String(som(3_860_000)))
  })

  it('pays each window by the table the row was on THEN', async () => {
    const dto = await new PayrollService(
      insights([row('was-baza', 'Lola', 28)], { previous: [row('was-baza', 'Baza', 28)] }),
    ).payroll(SEPTEMBER, AUGUST, 'UZS', NOW)
    const seller = dto.sellers[0]!
    expect(seller.table).toBe('standard')
    expect(seller.total.amountMinor).toBe(String(som(2_240_000)))
    expect(seller.previous!.total.amountMinor).toBe(String(som(3_860_000)))
  })

  it('pays the comparison window by the same table', async () => {
    const dto = await new PayrollService(
      insights([row('farrux-seller', 'Baza', 28)], { previous: [row('farrux-seller', 'Baza', 20)] }),
    ).payroll(SEPTEMBER, AUGUST, 'UZS', NOW)
    expect(dto.sellers[0]!.previous!.total.amountMinor).toBe(String(som(2_000_000 + 500_000)))
  })
})

describe('Marjona Shahtiyarovna — 18% of her own FAKT 2', () => {
  it('pays the flat rate, no fiksa, and her ROP pay as before', async () => {
    const dto = await new PayrollService(
      insights([row('marjona', 'Marjona', 50), row('her-seller', 'Marjona', 50)], { flatId: 'marjona' }),
    ).payroll(SEPTEMBER, AUGUST, 'UZS', NOW)
    const by = new Map(dto.sellers.map((s) => [s.employeeId, s]))

    expect(by.get('marjona')!.table).toBe('flat')
    expect(by.get('marjona')!.percentRate).toBe(18)
    expect(by.get('marjona')!.fixed.amountMinor).toBe('0')
    expect(by.get('marjona')!.total.amountMinor).toBe(String(som(9_000_000)))
    // Her own seller is on the standard month: 4 000 000 + 500 000.
    expect(by.get('her-seller')!.total.amountMinor).toBe(String(som(4_500_000)))

    const team = dto.teams.find((t) => t.rop === 'Marjona')!
    // 2% of 100 mln + the 2 000 000 monthly oklad.
    expect(team.ropPay!.total.amountMinor).toBe(String(som(4_000_000)))
  })

  it('fails the payroll rather than pay her by the wrong table when the lookup fails', async () => {
    await expect(
      new PayrollService(insights([row('marjona', 'Marjona', 50)], { flatFails: true })).payroll(SEPTEMBER, AUGUST, 'UZS', NOW),
    ).rejects.toThrow()
  })

  it('fails it too when the lookup answers and finds nobody — the same wrong table, silently', async () => {
    await expect(
      new PayrollService(insights([row('marjona', 'Marjona', 50)], { flatId: null })).payroll(SEPTEMBER, AUGUST, 'UZS', NOW),
    ).rejects.toThrow(/7044/)
  })

  it('names her for the rule card, and her flat rate beats БАЗА\'s table', async () => {
    const dto = await new PayrollService(insights([row('marjona', 'Baza', 30)], { flatId: 'marjona' })).payroll(
      SEPTEMBER,
      AUGUST,
      'UZS',
      NOW,
    )
    expect(dto.flatRates).toEqual([{ fullName: 'Marjona Shahtiyarovna 197', percentRate: 18 }])
    expect(dto.sellers[0]!.table).toBe('flat')
    expect(dto.sellers[0]!.total.amountMinor).toBe(String(som(5_400_000)))
  })
})

describe('the blocks', () => {
  it('files teams under Toshkent · Navoiy · Baza · Zextra · Boshqa, in that order, summing to the fund', async () => {
    const dto = await new PayrollService(
      insights([
        row('a', 'Asliddin', 30),
        row('b', 'Baza', 28),
        row('l', 'Lola', 40),
        row('m', 'Marjona', 20),
        row('x', null, 5),
        row('k', 'Malika', 10),
      ]),
    ).payroll(SEPTEMBER, AUGUST, 'UZS', NOW)

    expect(dto.branches.map((b) => b.branch)).toEqual(['toshkent', 'navoiy', 'baza', 'zextra', 'other'])
    expect([...dto.branches.find((b) => b.branch === 'baza')!.teams].sort()).toEqual(['Baza', 'Malika'])
    expect(dto.sellers.find((s) => s.employeeId === 'a')!.branch).toBe('zextra')

    const sum = (pick: (b: (typeof dto.branches)[number]) => string) =>
      dto.branches.reduce((acc, b) => acc + BigInt(pick(b)), 0n)
    expect(sum((b) => b.total.amountMinor)).toBe(BigInt(dto.totals.total.amountMinor))
    expect(sum((b) => b.fakt2.amountMinor)).toBe(BigInt(dto.totals.fakt2.amountMinor))
    expect(sum((b) => b.ropTotal.amountMinor)).toBe(BigInt(dto.ropTotals.total.amountMinor))
    expect(dto.branches.reduce((acc, b) => acc + b.sellers, 0)).toBe(dto.totals.sellers)
    expect(dto.branches.reduce((acc, b) => acc + b.fakt1Orders, 0)).toBe(dto.totals.fakt1Orders)
    expect(dto.branches.reduce((acc, b) => acc + b.fakt2Orders, 0)).toBe(dto.totals.fakt2Orders)
    // The fund is both parts summed on the server, in minor units.
    expect(BigInt(dto.fund.amountMinor)).toBe(BigInt(dto.totals.total.amountMinor) + BigInt(dto.ropTotals.total.amountMinor))
  })

  it('prints every team under «Boshqa» when the tree cannot be read — no pay moves', async () => {
    const dto = await new PayrollService({
      ...insights([row('l', 'Lola', 40), row('b', 'Baza', 28)]),
      ropAncestorNames: async () => {
        throw new Error('db down')
      },
    } as unknown as InsightsRepository).payroll(SEPTEMBER, AUGUST, 'UZS', NOW)
    // БАЗА is known by its team, not by the tree.
    expect(dto.branches.map((b) => b.branch)).toEqual(['baza', 'other'])
    expect(dto.sellers.find((s) => s.employeeId === 'b')!.table).toBe('baza')
  })
})

describe('«Лид сони», «Транз-1», «Конверсия», «Транз-2» — «ROP otchet»\'s', () => {
  it('reads the window\'s calendar days and sums a person\'s leads across teams', async () => {
    const asked: [string, string][] = []
    const dto = await new PayrollService(
      insights([row('l', 'Lola', 40, 12), row('m', 'Marjona', 20, 3)]),
      leadsOf(
        [
          { rop: 'Lola', employeeId: 'l', leads: 30 },
          { rop: 'Sevinch', employeeId: 'l', leads: 10 },
          { rop: 'Lola', employeeId: null, leads: 99 },
        ],
        asked,
      ),
    ).payroll(SEPTEMBER, AUGUST, 'UZS', NOW)

    expect(asked).toEqual([['2026-09-01', '2026-09-30']])
    const l = dto.sellers.find((s) => s.employeeId === 'l')!
    expect(l.leads).toBe(40)
    expect(l.fakt1Orders).toBe(12)
    expect(l.fakt2Orders).toBe(10)
    expect(l.conversion).toBe(30)
    // No lead handed to her: zero leads, and no conversion to divide.
    const m = dto.sellers.find((s) => s.employeeId === 'm')!
    expect(m.leads).toBe(0)
    expect(m.conversion).toBeNull()

    // Totals are the rows' sums; the conversion is of the sums of the rows that had a lead —
    // her 3 orders came from no lead, so they do not lift it to 37.5%.
    expect(dto.totals.leads).toBe(40)
    expect(dto.totals.fakt1Orders).toBe(15)
    expect(dto.totals.conversion).toBe(30)
  })

  it('reads «—», never zero, when the leads cannot be read — and says so in the log', async () => {
    const warned: string[] = []
    const dto = await new PayrollService(
      insights([row('l', 'Lola', 40)]),
      {
        sellerLeads: async () => {
          throw new Error('db down')
        },
      },
      (_context, message) => warned.push(message),
    ).payroll(SEPTEMBER, AUGUST, 'UZS', NOW)
    expect(warned).toEqual([expect.stringMatching(/leads unread/)])
    expect(dto.sellers[0]!.leads).toBeNull()
    expect(dto.sellers[0]!.conversion).toBeNull()
    expect(dto.totals.leads).toBeNull()
    expect(dto.teams[0]!.leads).toBeNull()
    expect(dto.branches[0]!.leads).toBeNull()
    // The pay is untouched.
    expect(dto.totals.total.amountMinor).toBe(String(som(3_200_000)))
  })
})
