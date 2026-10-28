import { beforeEach, describe, expect, it } from 'vitest'

import type { Period } from '@/server/domain/period/period'
import type { RnpTeamDayRow } from '@/server/repositories/insightsRepository'
import type { RoistatBitrixRow } from '@/server/repositories/roistatRepository'

/*
  «Kunlar boʻyicha» and Roistat over the sync worker's stored months
  (2026-10-28). The equality itself — a window's rows are its months' rows
  added up, stored or live — was measured against the old statement in
  PGlite over every migration and 59 000 seeded deals: 6 windows × 3 shapes ×
  brand-keyed or not, the stored path identical to the live one row for row
  (a deal-day sum apart in its sixth decimal), and to the old statement in
  every window inside one month and every «Hammasi» day / total read. These
  cases pin how the service puts the pieces together.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { RoistatService, monthScanKey, resetRoistatCaches } = await import('@/server/services/roistatService')
const { bitrixRowsOfShape, mergeBitrixRows } = await import('@/server/repositories/roistatRepository')
const { resolvePeriod } = await import('@/server/domain/period/period')

const TZ = 'Asia/Tashkent'
const NOW = new Date('2026-10-28T05:00:00Z')
const iso = (period: Period) => [period.start.toISOString(), period.end.toISOString()]

function row(set: RoistatBitrixRow['set'], fields: Partial<RoistatBitrixRow> = {}): RoistatBitrixRow {
  return {
    set,
    day: null,
    sourceId: null,
    sourceName: null,
    formTitle: null,
    targetolog: null,
    productLine: null,
    region: null,
    rop: null,
    seller: null,
    registrar: null,
    brandSource: null,
    brandForm: null,
    brandLine: null,
    brandTeam: null,
    brandProduct: null,
    leads: 0,
    clean: 0,
    kval: 0,
    orders: 0,
    orderedMinor: 0n,
    sold: 0,
    soldMinor: 0n,
    newCustomers: 0,
    dealDaysSum: 0,
    dealCount: 0,
    ...fields,
  }
}

function teamDay(day: string, fakt1Minor: bigint): RnpTeamDayRow {
  return { day, rop: 'Sevinch(ROP)', fakt1Orders: 1, fakt1Minor, fakt2Orders: 0, fakt2Minor: 0n, refusedOrders: 0, refusedMinor: 0n, productBrand: null, formBrand: 'Collagen' }
}

/** A month's widest stored scan: its total and one day, split by two brand inputs. */
function storedMonth(month: string, leads: number): RoistatBitrixRow[] {
  return [
    row('total', { brandSource: 'UC_FB', leads, soldMinor: 100n }),
    row('total', { brandSource: 'WEB', leads: 1, soldMinor: 1n }),
    row('day', { day: `${month}-05`, brandSource: 'UC_FB', leads, soldMinor: 100n }),
    row('day', { day: `${month}-05`, brandSource: 'WEB', leads: 1, soldMinor: 1n }),
    row('form', { formTitle: 'Заполнение CRM-формы "Umar-collagen 3"', brandSource: 'UC_FB', leads }),
  ]
}

function harness(options: { stored?: Map<string, { rows: unknown; builtAt: Date }>; borrowed?: RnpTeamDayRow[] | null } = {}) {
  const bitrixCalls: { from: string; to: string; shape: string; keyed: boolean; asOf: string }[] = []
  const faktCalls: { from: string; to: string }[] = []
  const repository = {
    bitrix: async (period: Period, asOf: Date, shape = 'all', keyed = false) => {
      const [from, to] = iso(period)
      bitrixCalls.push({ from: from!, to: to!, shape, keyed, asOf: asOf.toISOString() })
      return [row('total', { leads: 7, soldMinor: 10n }), row('day', { day: '2026-10-27', leads: 7, soldMinor: 10n })]
    },
    meta: async () => [],
    metaName: async () => null,
    metaImportedAt: async () => null,
  }
  const insights = {
    rnpTeamDays: async (period: Period) => {
      const [from, to] = iso(period)
      faktCalls.push({ from: from!, to: to! })
      return [teamDay('2026-10-27', 500n)]
    },
  }
  const reads: string[] = []
  const reader = options.stored
    ? {
        read: async (key: string) => {
          reads.push(key)
          return (options.stored!.get(key) as never) ?? null
        },
      }
    : null
  const borrow = options.borrowed === undefined ? null : () => (options.borrowed ? Promise.resolve(options.borrowed) : null)
  const service = new RoistatService(
    repository as never,
    { campaignDays: async () => [] },
    { forDays: async (days: readonly string[]) => days.map(() => 12_000) },
    insights,
    reader,
    borrow,
  )
  return { service, bitrixCalls, faktCalls, reads }
}

/** Every closed month of 2026 stored at `builtAt`, scans and FAKT. */
function store2026(builtAt: Date, skip: readonly string[] = []) {
  const stored = new Map<string, { rows: unknown; builtAt: Date }>()
  for (let m = 1; m <= 9; m += 1) {
    const month = `2026-${String(m).padStart(2, '0')}`
    if (skip.includes(month)) continue
    stored.set(monthScanKey('bitrix', month), { rows: storedMonth(month, m), builtAt })
    stored.set(monthScanKey('bitrix-days', month), { rows: bitrixRowsOfShape(storedMonth(month, m), 'days', true), builtAt })
    stored.set(monthScanKey('fakt', month), { rows: [teamDay(`${month}-05`, BigInt(m))], builtAt })
  }
  return stored
}

beforeEach(() => resetRoistatCaches())

describe('mergeBitrixRows / bitrixRowsOfShape', () => {
  it('adds up the rows of one group, every counter, and keeps the others apart', () => {
    const merged = mergeBitrixRows([
      row('day', { day: '2026-09-05', leads: 2, orderedMinor: 5n, dealDaysSum: 1.5, dealCount: 1 }),
      row('day', { day: '2026-09-05', leads: 3, orderedMinor: 7n, dealDaysSum: 2, dealCount: 2 }),
      row('day', { day: '2026-09-06', leads: 1 }),
    ])
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ day: '2026-09-05', leads: 5, orderedMinor: 12n, dealDaysSum: 3.5, dealCount: 3 })
  })

  it('cuts a shape from the widest stored scan: its sets, and unkeyed its brand splits added back', () => {
    const widest = storedMonth('2026-09', 9)
    expect(bitrixRowsOfShape(widest, 'total', false)).toEqual([row('total', { leads: 10, soldMinor: 101n })])
    expect(bitrixRowsOfShape(widest, 'days', false).map((r) => [r.set, r.leads])).toEqual([['total', 10], ['day', 10]])
    // Brand-keyed: the splits stand, for the brand switch to narrow.
    expect(bitrixRowsOfShape(widest, 'days', true)).toHaveLength(4)
    expect(bitrixRowsOfShape(widest, 'all', false)).toHaveLength(3)
  })
})

describe('RoistatService over the stored months', () => {
  it('reads «Shu yil» as its nine stored months plus ONE live read of the running month', async () => {
    const { service, bitrixCalls, faktCalls } = harness({ stored: store2026(new Date('2026-10-28T04:30:00Z')) })
    const dto = await service.days(resolvePeriod('this_year', { timeZone: TZ, now: NOW }), NOW)
    expect(bitrixCalls).toEqual([
      { from: '2026-09-30T19:00:00.000Z', to: '2026-10-28T19:00:00.000Z', shape: 'days', keyed: false, asOf: NOW.toISOString() },
    ])
    expect(faktCalls).toEqual([{ from: '2026-09-30T19:00:00.000Z', to: '2026-10-28T19:00:00.000Z' }])
    // 1 + … + 9 stored leads, plus a lead on WEB each month, plus the running month's 7.
    expect(dto.total.leads).toBe(45 + 9 + 7)
    expect(dto.rows.find((r) => r.key === '2026-09-05')?.leads).toBe(10)
    expect(dto.fakt?.byDay['2026-03-05']?.fakt1PrimaryUzs).toBe(0) // 3 tiyin round to 0 soʻm
    expect(dto.fakt?.byDay['2026-10-27']?.fakt1PrimaryUzs).toBe(5)
  })

  it('serves «Oʻtgan oy» — a closed whole month on its own — from the store, no statement run', async () => {
    const { service, bitrixCalls, faktCalls } = harness({ stored: store2026(new Date('2026-10-28T04:30:00Z')) })
    const dto = await service.days(resolvePeriod('previous_month', { timeZone: TZ, now: NOW }), NOW)
    expect(bitrixCalls).toEqual([])
    expect(faktCalls).toEqual([])
    expect(dto.total.leads).toBe(10)
  })

  it('reads a run of months the store lacks as one live window, beside the stored ones', async () => {
    const { service, bitrixCalls } = harness({ stored: store2026(new Date('2026-10-28T04:30:00Z'), ['2026-04', '2026-05']) })
    await service.days(resolvePeriod('this_year', { timeZone: TZ, now: NOW }), NOW)
    expect(bitrixCalls.map((c) => [c.from, c.to])).toEqual([
      ['2026-03-31T19:00:00.000Z', '2026-05-31T19:00:00.000Z'],
      ['2026-09-30T19:00:00.000Z', '2026-10-28T19:00:00.000Z'],
    ])
  })

  it('reads the whole window in one statement, as before, when the store holds nothing for it', async () => {
    const empty = harness({ stored: new Map() })
    await empty.service.days(resolvePeriod('this_year', { timeZone: TZ, now: NOW }), NOW)
    expect(empty.bitrixCalls.map((c) => [c.from, c.to])).toEqual([['2025-12-31T19:00:00.000Z', '2026-10-28T19:00:00.000Z']])
    expect(empty.faktCalls).toEqual([{ from: '2025-12-31T19:00:00.000Z', to: '2026-10-28T19:00:00.000Z' }])

    resetRoistatCaches()
    const none = harness()
    await none.service.days(resolvePeriod('this_year', { timeZone: TZ, now: NOW }), NOW)
    expect(none.bitrixCalls).toHaveLength(1)
  })

  it('never serves a stored month past its age: six hours while its sales still open, two days after', async () => {
    // September closed 28 days ago — still settling: 7 hours old is too old.
    const stale = harness({ stored: store2026(new Date('2026-10-27T22:00:00Z')) })
    await stale.service.days(resolvePeriod('this_year', { timeZone: TZ, now: NOW }), NOW)
    expect(stale.bitrixCalls.map((c) => [c.from, c.to])).toEqual([['2026-08-31T19:00:00.000Z', '2026-10-28T19:00:00.000Z']])

    // A month built before it closed is not the month.
    const early = store2026(new Date('2026-10-28T04:30:00Z'))
    early.set(monthScanKey('bitrix-days', '2026-09'), { rows: storedMonth('2026-09', 9), builtAt: new Date('2026-09-29T10:00:00Z') })
    const built = harness({ stored: early })
    await built.service.days(resolvePeriod('previous_month', { timeZone: TZ, now: NOW }), NOW)
    expect(built.bitrixCalls).toHaveLength(1)
  })

  it('reads the previous window at its own age: a stored month only once it was settled at that age', async () => {
    const stored = new Map<string, { rows: unknown; builtAt: Date }>()
    for (let m = 1; m <= 10; m += 1) {
      const month = `2025-${String(m).padStart(2, '0')}`
      stored.set(monthScanKey('bitrix', month), { rows: storedMonth(month, 1), builtAt: new Date('2026-10-28T04:30:00Z') })
      stored.set(monthScanKey('bitrix-days', month), { rows: storedMonth(month, 1), builtAt: new Date('2026-10-28T04:30:00Z') })
    }
    const { service, bitrixCalls } = harness({ stored })
    // «Shu yil» against 1.01–28.10.2025 read as of 28.10.2025: January–August were settled by then and are
    // stored; September's sales could still open on that day, so it is read live at that age, with October.
    await service.overview(resolvePeriod('this_year', { timeZone: TZ, now: NOW }), { dim: 'days' }, NOW)
    expect(bitrixCalls.filter((c) => c.shape === 'total')).toEqual([
      { from: '2025-08-31T19:00:00.000Z', to: '2025-10-28T19:00:00.000Z', shape: 'total', keyed: false, asOf: '2025-10-28T05:00:00.000Z' },
    ])
    // «Oʻtgan oy»'s is August read as of 27.09 — not settled then either: live, as before.
    resetRoistatCaches()
    const august = harness({ stored })
    await august.service.overview(resolvePeriod('previous_month', { timeZone: TZ, now: NOW }), { dim: 'days' }, NOW)
    expect(august.bitrixCalls.filter((c) => c.shape === 'total')).toEqual([
      { from: '2026-07-31T19:00:00.000Z', to: '2026-08-31T19:00:00.000Z', shape: 'total', keyed: false, asOf: '2026-09-27T05:00:00.000Z' },
    ])
  })

  it("borrows the running month's FAKT from the RNP sheet's memo, and scans it itself without one", async () => {
    const borrowed = harness({ stored: store2026(new Date('2026-10-28T04:30:00Z')), borrowed: [teamDay('2026-10-26', 900n)] })
    const dto = await borrowed.service.days(resolvePeriod('this_month', { timeZone: TZ, now: NOW }), NOW)
    expect(borrowed.faktCalls).toEqual([])
    expect(dto.fakt?.byDay['2026-10-26']?.fakt1PrimaryUzs).toBe(9)

    resetRoistatCaches()
    const cold = harness({ stored: store2026(new Date('2026-10-28T04:30:00Z')), borrowed: null })
    await cold.service.days(resolvePeriod('this_month', { timeZone: TZ, now: NOW }), NOW)
    expect(cold.faktCalls).toHaveLength(1)

    // Yesterday is not the running month to date: never borrowed.
    resetRoistatCaches()
    const yesterday = harness({ borrowed: [teamDay('2026-10-26', 900n)] })
    await yesterday.service.days(resolvePeriod('yesterday', { timeZone: TZ, now: NOW }), NOW)
    expect(yesterday.faktCalls).toHaveLength(1)
  })

  it('reads the running month once for «Shu oy» and «Shu yil» alike', async () => {
    const { service, bitrixCalls } = harness({ stored: store2026(new Date('2026-10-28T04:30:00Z')) })
    await service.days(resolvePeriod('this_month', { timeZone: TZ, now: NOW }), NOW)
    await service.days(resolvePeriod('this_year', { timeZone: TZ, now: NOW }), NOW)
    expect(bitrixCalls).toHaveLength(1)
  })

  it("warms «Shu oy» into the screen's memo in the working day, and builds nothing at night", async () => {
    const { service, bitrixCalls } = harness({ stored: store2026(new Date('2026-10-28T04:30:00Z')) })
    expect(await service.warm(new Date('2026-10-27T20:00:00Z'), TZ)).toBe('off-hours')
    expect(bitrixCalls).toHaveLength(0)
    await service.warm(NOW, TZ)
    expect(bitrixCalls).toHaveLength(1)
    // The reader then gets the warmed answer: no second read.
    await service.days(resolvePeriod('this_month', { timeZone: TZ, now: NOW }), NOW)
    expect(bitrixCalls).toHaveLength(1)
  })
})
