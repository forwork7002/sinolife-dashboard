import { describe, expect, it } from 'vitest'

import {
  LAG_BUCKETS,
  LEAD_COHORT_START,
  type LeadDealRow,
  foldLeads,
  lagBucket,
  leadCohortOverview,
} from '@/server/domain/leadCohort/leadCohort'

const TZ = 'Asia/Tashkent'

let seq = 0
function deal(over: Partial<LeadDealRow> & { arrivedAt: Date | null }): LeadDealRow {
  seq++
  return {
    dealId: `d${seq}`,
    customerId: `c${seq}`,
    pipeline: 12,
    distributedOn: null,
    aiQualifiedAt: null,
    ropEmployeeId: null,
    repeat: null,
    createdDay: '2026-09-20',
    ...over,
  }
}

/** The portal's own spelling: Moscow time. */
const msk = (local: string) => new Date(`${local}+03:00`)

const overview = (rows: LeadDealRow[], over: Partial<Parameters<typeof leadCohortOverview>[0]> = {}) =>
  leadCohortOverview({
    rows,
    from: '2026-09-20',
    to: '2026-09-24',
    today: '2026-09-24',
    timeZone: TZ,
    pipelines: [12, 4, 6],
    rop: null,
    names: new Map([
      ['rop-a', 'Sevinch'],
      ['rop-b', 'Charos'],
    ]),
    ...over,
  })

describe('the Tashkent day', () => {
  it('puts a lead that arrived at 23:30 Tashkent on the day it arrived, not the one before', () => {
    // 21:30 Moscow = 23:30 Tashkent on the 22nd.
    const [lead] = foldLeads([deal({ arrivedAt: msk('2026-09-22T21:30:00') })], TZ)
    expect(lead!.arrivedDay).toBe('2026-09-22')
  })

  it('moves a lead that arrived at 22:30 Moscow to the NEXT Tashkent day (00:30)', () => {
    const [lead] = foldLeads([deal({ arrivedAt: msk('2026-09-22T22:30:00') })], TZ)
    expect(lead!.arrivedDay).toBe('2026-09-23')
  })

  it('counts a 23:59 Tashkent arrival distributed the next morning at D+1', () => {
    const out = overview([deal({ arrivedAt: msk('2026-09-22T21:59:00'), distributedOn: '2026-09-23' })])
    const row = out.cohorts.new.rows.find((r) => r.day === '2026-09-22')!
    expect(row.arrived).toBe(1)
    expect(row.byLag[1]).toBe(1)
    expect(row.byLag[0]).toBe(0)
  })
})

describe('one lead, up to three deals', () => {
  it('counts a customer in Первичка, Тасдиклаш and Доставка once, with the earliest distribution day', () => {
    const arrivedAt = msk('2026-09-21T10:00:00')
    const rows = [
      deal({ customerId: 'same', pipeline: 12, arrivedAt, distributedOn: '2026-09-22', ropEmployeeId: 'rop-a' }),
      deal({ customerId: 'same', pipeline: 4, arrivedAt, distributedOn: '2026-09-21', ropEmployeeId: 'rop-b' }),
      deal({ customerId: 'same', pipeline: 6, arrivedAt, distributedOn: null, ropEmployeeId: null }),
    ]
    const out = overview(rows)
    expect(out.kpi.arrived).toBe(1)
    const row = out.cohorts.new.rows.find((r) => r.day === '2026-09-21')!
    expect(row.byLag[0]).toBe(1)
    expect(row.distributed).toBe(1)
    // The ROP of the copy that carried the earliest day.
    expect(out.rops).toEqual([{ employeeId: 'rop-b', name: 'Charos', total: 1, new: 1, repeat: 0, sameDay: 1 }])
  })

  it('keeps two arrivals of one customer as two leads', () => {
    const rows = [
      deal({ customerId: 'same', arrivedAt: msk('2026-09-21T10:00:00') }),
      deal({ customerId: 'same', arrivedAt: msk('2026-09-23T10:00:00') }),
    ]
    expect(overview(rows).kpi.arrived).toBe(2)
  })

  it('never merges two deals with no contact', () => {
    const arrivedAt = msk('2026-09-21T10:00:00')
    expect(overview([deal({ customerId: null, arrivedAt }), deal({ customerId: null, arrivedAt })]).kpi.arrived).toBe(2)
  })

  it('keeps a repeat mark that only one copy carries', () => {
    const arrivedAt = msk('2026-09-21T10:00:00')
    const out = overview([
      deal({ customerId: 'x', arrivedAt, repeat: null }),
      deal({ customerId: 'x', pipeline: 6, arrivedAt, repeat: 'BOUGHT' }),
    ])
    expect(out.cohorts.new.total.arrived).toBe(0)
    expect(out.cohorts.repeat.total.arrived).toBe(1)
    expect(out.kpi.repeat).toEqual({ total: 1, bought: 1, processing: 0, other: 0 })
  })
})

describe('the columns', () => {
  it('buckets D+0 … D+6 and folds a week or more into the last', () => {
    expect(lagBucket('2026-09-01', '2026-09-01')).toBe(0)
    expect(lagBucket('2026-09-01', '2026-09-07')).toBe(6)
    expect(lagBucket('2026-09-01', '2026-09-08')).toBe(LAG_BUCKETS - 1)
    expect(lagBucket('2026-09-01', '2026-10-30')).toBe(LAG_BUCKETS - 1)
  })

  it('counts a distribution before the arrival at D+0 and reports it', () => {
    const out = overview([deal({ arrivedAt: msk('2026-09-22T10:00:00'), distributedOn: '2026-09-21' })])
    expect(out.cohorts.new.total.byLag[0]).toBe(1)
    expect(out.kpi.distributedBeforeArrival).toBe(1)
  })

  it('reproduces the client example: 100 in, 60 same day, 20 next day → 80 through', () => {
    const rows: LeadDealRow[] = []
    for (let i = 0; i < 100; i++) {
      rows.push(
        deal({
          arrivedAt: msk('2026-09-24T06:00:00'),
          distributedOn: i < 60 ? '2026-09-24' : i < 80 ? '2026-09-25' : null,
        }),
      )
    }
    const out = overview(rows, { to: '2026-09-25', today: '2026-09-25' })
    const row = out.cohorts.new.rows.find((r) => r.day === '2026-09-24')!
    expect([row.arrived, row.byLag[0], row.byLag[1], row.distributed, row.undistributed]).toEqual([100, 60, 20, 80, 20])
  })

  it('draws every day of the window, empty ones included, and the total sums the rows', () => {
    const out = overview([
      deal({ arrivedAt: msk('2026-09-20T10:00:00'), distributedOn: '2026-09-20' }),
      deal({ arrivedAt: msk('2026-09-24T10:00:00') }),
    ])
    expect(out.cohorts.new.rows.map((r) => r.day)).toEqual([
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
    ])
    expect(out.cohorts.new.total).toMatchObject({ arrived: 2, distributed: 1, undistributed: 1 })
  })
})

describe('the start date', () => {
  it(`starts the tables at ${LEAD_COHORT_START} and counts older arrivals apart`, () => {
    const out = overview(
      [
        // A returning customer: arrived in June, handed out this week.
        deal({ arrivedAt: msk('2026-06-10T10:00:00'), distributedOn: '2026-09-15', pipeline: 6, repeat: 'BOUGHT', ropEmployeeId: 'rop-a' }),
        deal({ arrivedAt: msk('2026-09-14T10:00:00'), distributedOn: '2026-09-14' }),
      ],
      { from: '2026-09-01', to: '2026-09-16', today: '2026-09-16' },
    )
    expect(out.cohortFrom).toBe(LEAD_COHORT_START)
    expect(out.cohorts.new.rows[0]!.day).toBe(LEAD_COHORT_START)
    expect(out.kpi.arrived).toBe(1)
    expect(out.kpi.arrivedBeforeStart).toBe(1)
    // …but the ROP it went to still received it.
    expect(out.rops.find((r) => r.employeeId === 'rop-a')).toMatchObject({ total: 1, repeat: 1 })
  })

  it('counts deals created in the window with no arrival once per customer', () => {
    const out = overview([
      deal({ customerId: 'm', arrivedAt: null, createdDay: '2026-09-21', pipeline: 12 }),
      deal({ customerId: 'm', arrivedAt: null, createdDay: '2026-09-22', pipeline: 4 }),
      deal({ customerId: 'n', arrivedAt: null, createdDay: '2026-09-01' }),
    ])
    expect(out.kpi.missingArrival).toBe(1)
    expect(out.kpi.arrived).toBe(0)
  })
})

describe('the tiles and the filters', () => {
  const rows = () => [
    deal({ arrivedAt: msk('2026-09-24T09:00:00'), distributedOn: '2026-09-24', aiQualifiedAt: msk('2026-09-24T11:00:00'), ropEmployeeId: 'rop-a' }),
    deal({ arrivedAt: msk('2026-09-23T09:00:00'), distributedOn: '2026-09-24', ropEmployeeId: 'rop-b' }),
    deal({ arrivedAt: msk('2026-09-23T09:00:00'), pipeline: 6, repeat: 'PROCESSING' }),
  ]

  it('counts arrived, today, AI, undistributed and repeat over the window', () => {
    expect(overview(rows()).kpi).toMatchObject({
      arrived: 3,
      arrivedToday: 1,
      distributedToday: 2,
      aiQualified: 1,
      undistributed: 1,
      repeat: { total: 1, bought: 0, processing: 1, other: 0 },
    })
  })

  it('narrows deals by pipeline BEFORE they fold', () => {
    const out = overview(rows(), { pipelines: [6] })
    expect(out.kpi.arrived).toBe(1)
    expect(out.cohorts.repeat.total.arrived).toBe(1)
  })

  it('narrows the tiles and the tables by ROP, never the ROP breakdown', () => {
    const out = overview(rows(), { rop: 'rop-a' })
    expect(out.kpi.arrived).toBe(1)
    expect(out.kpi.distributedToday).toBe(1)
    // Both ROPs stay; a tie on the count is broken by name.
    expect(out.rops.map((r) => r.employeeId)).toEqual(['rop-b', 'rop-a'])
    expect(out.ropOptions).toEqual([
      { employeeId: 'rop-b', name: 'Charos' },
      { employeeId: 'rop-a', name: 'Sevinch' },
    ])
  })
})
