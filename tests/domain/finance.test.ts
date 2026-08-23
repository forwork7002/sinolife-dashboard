import { describe, expect, it } from 'vitest'

import { resolvePeriod } from '@/server/domain/period/period'
import {
  type FinanceDeal,
  type FinancePayment,
  ageDebt,
  collectionTrend,
  collectionsByMethod,
  debtByEmployee,
  outstandingTotal,
  settleDeals,
  summarizeFinance,
} from '@/server/domain/analytics/finance'

const UZS = 'UZS'
const NOW = new Date('2026-08-23T09:30:00.000Z')
const august = resolvePeriod('this_month', { timeZone: 'Asia/Tashkent', now: NOW })

function deal(
  dealId: string,
  amountMinor: bigint,
  closedIso: string,
  employeeId = 'emp-1',
): FinanceDeal {
  return { dealId, employeeId, amountMinor, currency: UZS, closedAt: new Date(closedIso) }
}

function payment(
  dealId: string,
  amountMinor: bigint,
  paidIso: string,
  method: FinancePayment['method'] = 'BANK_TRANSFER',
): FinancePayment {
  return { dealId, amountMinor, currency: UZS, paidAt: new Date(paidIso), method }
}

describe('settleDeals', () => {
  const deals = [
    deal('d1', 100_000_00n, '2026-08-05T06:00:00.000Z'),
    deal('d2', 200_000_00n, '2026-08-06T06:00:00.000Z'),
    deal('d3', 50_000_00n, '2026-08-07T06:00:00.000Z'),
  ]
  const payments = [
    payment('d1', 100_000_00n, '2026-08-10T06:00:00.000Z'),
    payment('d2', 80_000_00n, '2026-08-11T06:00:00.000Z'),
  ]

  const settled = settleDeals(deals, payments, UZS)

  it('marks a fully paid deal as PAID with nothing outstanding', () => {
    const d1 = settled.find((s) => s.dealId === 'd1')!
    expect(d1.status).toBe('PAID')
    expect(d1.outstanding.amountMinor).toBe(0n)
    expect(d1.collectedPercent).toBe(100)
  })

  it('marks a part-paid deal as PARTIAL with the remainder outstanding', () => {
    const d2 = settled.find((s) => s.dealId === 'd2')!
    expect(d2.status).toBe('PARTIAL')
    expect(d2.outstanding.amountMinor).toBe(120_000_00n)
    expect(d2.collectedPercent).toBe(40)
  })

  it('marks a deal with no payments as UNPAID', () => {
    const d3 = settled.find((s) => s.dealId === 'd3')!
    expect(d3.status).toBe('UNPAID')
    expect(d3.outstanding.amountMinor).toBe(50_000_00n)
    expect(d3.collectedPercent).toBe(0)
  })

  it('sums multiple payments against one deal', () => {
    const multi = settleDeals(
      [deal('d1', 100_000_00n, '2026-08-05T06:00:00.000Z')],
      [
        payment('d1', 40_000_00n, '2026-08-06T06:00:00.000Z'),
        payment('d1', 60_000_00n, '2026-08-09T06:00:00.000Z'),
      ],
      UZS,
    )
    expect(multi[0]!.status).toBe('PAID')
  })

  it('clamps an overpaid deal to zero outstanding rather than a negative balance', () => {
    // A negative receivable is a credit note, which this model does not
    // represent. Left unclamped it would net off other deals' real debt.
    const over = settleDeals(
      [deal('d1', 100_000_00n, '2026-08-05T06:00:00.000Z')],
      [payment('d1', 150_000_00n, '2026-08-06T06:00:00.000Z')],
      UZS,
    )
    expect(over[0]!.outstanding.amountMinor).toBe(0n)
    expect(over[0]!.status).toBe('PAID')
  })

  it('refuses to settle across currencies rather than summing them', () => {
    // Adding USD to UZS produces a number that is not money in any currency,
    // and the mistake would surface later as an inexplicably wrong debt.
    expect(() =>
      settleDeals(
        [{ dealId: 'd1', employeeId: 'e1', amountMinor: 100n, currency: 'USD', closedAt: new Date() }],
        [],
        UZS,
      ),
    ).toThrow(/different currencies/i)

    expect(() =>
      settleDeals(
        [deal('d1', 100n, '2026-08-05T06:00:00.000Z')],
        [{ dealId: 'd1', amountMinor: 50n, currency: 'USD', paidAt: new Date(), method: 'CASH' }],
        UZS,
      ),
    ).toThrow(/different currencies/i)
  })

  it('ignores payments referencing an unknown deal', () => {
    const settledOrphan = settleDeals(deals, [...payments, payment('ghost', 999n, '2026-08-12T06:00:00.000Z')], UZS)
    expect(settledOrphan).toHaveLength(3)
  })
})

describe('summarizeFinance', () => {
  const settled = settleDeals(
    [
      deal('d1', 100_000_00n, '2026-08-05T06:00:00.000Z'),
      deal('d2', 200_000_00n, '2026-08-06T06:00:00.000Z'),
      deal('d3', 50_000_00n, '2026-08-07T06:00:00.000Z'),
    ],
    [
      payment('d1', 100_000_00n, '2026-08-10T06:00:00.000Z'),
      payment('d2', 80_000_00n, '2026-08-11T06:00:00.000Z'),
    ],
    UZS,
  )

  const summary = summarizeFinance(settled, UZS)

  it('totals invoiced and collected', () => {
    expect(summary.invoiced.amountMinor).toBe(350_000_00n)
    expect(summary.collected.amountMinor).toBe(180_000_00n)
  })

  it('totals outstanding per deal, so an overpayment cannot mask real debt', () => {
    const withOverpayment = summarizeFinance(
      settleDeals(
        [
          deal('a', 100_000_00n, '2026-08-05T06:00:00.000Z'),
          deal('b', 100_000_00n, '2026-08-05T06:00:00.000Z'),
        ],
        [payment('a', 300_000_00n, '2026-08-06T06:00:00.000Z')],
        UZS,
      ),
      UZS,
    )
    // Deal b is still owed in full, even though deal a was massively overpaid.
    expect(withOverpayment.outstanding.amountMinor).toBe(100_000_00n)
  })

  it('computes the collection rate', () => {
    expect(summary.collectionRatePercent).toBeCloseTo(51.43, 1)
  })

  it('counts each settlement status', () => {
    expect(summary.paidCount).toBe(1)
    expect(summary.partialCount).toBe(1)
    expect(summary.unpaidCount).toBe(1)
    expect(summary.debtorCount).toBe(2)
  })

  it('returns a null collection rate when nothing was invoiced', () => {
    // 0% would claim a failure to collect that never happened.
    const empty = summarizeFinance([], UZS)
    expect(empty.collectionRatePercent).toBeNull()
    expect(empty.invoiced.amountMinor).toBe(0n)
    expect(empty.debtorCount).toBe(0)
  })

  it('reports a full collection rate when everything is paid', () => {
    const allPaid = summarizeFinance(
      settleDeals(
        [deal('d1', 100_000_00n, '2026-08-05T06:00:00.000Z')],
        [payment('d1', 100_000_00n, '2026-08-06T06:00:00.000Z')],
        UZS,
      ),
      UZS,
    )
    expect(allPaid.collectionRatePercent).toBe(100)
    expect(outstandingTotal(allPaid).amountMinor).toBe(0n)
  })
})

describe('collectionsByMethod', () => {
  const payments = [
    payment('d1', 100_000_00n, '2026-08-10T06:00:00.000Z', 'BANK_TRANSFER'),
    payment('d2', 60_000_00n, '2026-08-11T06:00:00.000Z', 'CARD'),
    payment('d3', 40_000_00n, '2026-08-12T06:00:00.000Z', 'BANK_TRANSFER'),
    // Outside the period — must not be counted.
    payment('d4', 999_000_00n, '2026-07-10T06:00:00.000Z', 'CASH'),
  ]

  const rows = collectionsByMethod(payments, august, UZS)

  it('aggregates by method and sorts by amount', () => {
    expect(rows[0]!.method).toBe('BANK_TRANSFER')
    expect(rows[0]!.amount.amountMinor).toBe(140_000_00n)
    expect(rows[0]!.count).toBe(2)
  })

  it('excludes payments outside the period', () => {
    expect(rows.find((r) => r.method === 'CASH')).toBeUndefined()
  })

  it('returns an empty list when nothing was collected', () => {
    expect(collectionsByMethod([], august, UZS)).toEqual([])
  })
})

describe('collectionTrend', () => {
  it('tiles the period and reconciles with the totals', () => {
    const deals = [deal('d1', 100_000_00n, '2026-08-05T06:00:00.000Z')]
    const payments = [payment('d1', 60_000_00n, '2026-08-06T06:00:00.000Z')]

    const trend = collectionTrend(deals, payments, august, UZS)

    expect(trend).toHaveLength(23)
    const invoiced = trend.reduce((s, p) => s + p.invoiced.amountMinor, 0n)
    const collected = trend.reduce((s, p) => s + p.collected.amountMinor, 0n)
    expect(invoiced).toBe(100_000_00n)
    expect(collected).toBe(60_000_00n)
  })

  it('keeps quiet buckets at zero rather than dropping them', () => {
    const trend = collectionTrend([], [], august, UZS)
    expect(trend).toHaveLength(23)
    expect(trend.every((p) => p.invoiced.amountMinor === 0n)).toBe(true)
  })
})

describe('ageDebt', () => {
  const deals = [
    deal('recent', 100_000_00n, '2026-08-10T00:00:00.000Z'),
    deal('mid', 200_000_00n, '2026-07-01T00:00:00.000Z'),
    deal('old', 300_000_00n, '2026-05-01T00:00:00.000Z'),
    deal('paid', 400_000_00n, '2026-01-01T00:00:00.000Z'),
  ]
  const payments = [payment('paid', 400_000_00n, '2026-01-05T00:00:00.000Z')]
  const settled = settleDeals(deals, payments, UZS)
  const rows = ageDebt(deals, settled, NOW, UZS)

  it('buckets by age since the deal was won', () => {
    expect(rows.find((r) => r.bucket === '0-30')!.amount.amountMinor).toBe(100_000_00n)
    expect(rows.find((r) => r.bucket === '31-60')!.amount.amountMinor).toBe(200_000_00n)
    expect(rows.find((r) => r.bucket === '90+')!.amount.amountMinor).toBe(300_000_00n)
  })

  it('excludes fully settled deals entirely', () => {
    const total = rows.reduce((s, r) => s + r.amount.amountMinor, 0n)
    expect(total).toBe(600_000_00n)
  })

  it('always returns every bucket, including empty ones', () => {
    // An absent 90+ row and a 90+ row reading zero mean different things to
    // whoever has to chase the debt.
    expect(rows).toHaveLength(4)
    const empty = ageDebt([], [], NOW, UZS)
    expect(empty).toHaveLength(4)
    expect(empty.every((r) => r.amount.amountMinor === 0n)).toBe(true)
  })
})

describe('debtByEmployee', () => {
  it('attributes outstanding balances and sorts by size', () => {
    const deals = [
      deal('d1', 100_000_00n, '2026-08-05T06:00:00.000Z', 'emp-1'),
      deal('d2', 300_000_00n, '2026-08-06T06:00:00.000Z', 'emp-2'),
      deal('d3', 50_000_00n, '2026-08-07T06:00:00.000Z', 'emp-1'),
    ]
    const settled = settleDeals(deals, [], UZS)
    const rows = debtByEmployee(deals, settled, UZS)

    expect(rows[0]!.employeeId).toBe('emp-2')
    expect(rows[0]!.outstanding.amountMinor).toBe(300_000_00n)
    expect(rows[1]!.employeeId).toBe('emp-1')
    expect(rows[1]!.outstanding.amountMinor).toBe(150_000_00n)
    expect(rows[1]!.dealCount).toBe(2)
  })

  it('omits employees with no outstanding balance', () => {
    const deals = [deal('d1', 100_000_00n, '2026-08-05T06:00:00.000Z', 'emp-1')]
    const settled = settleDeals(deals, [payment('d1', 100_000_00n, '2026-08-06T06:00:00.000Z')], UZS)
    expect(debtByEmployee(deals, settled, UZS)).toEqual([])
  })
})
