import { describe, expect, it } from 'vitest'

import {
  HALF_TIERS,
  MONTH_TIERS,
  PERCENT_BP,
  WEEK_TIERS,
  ropPayroll,
  sellerPayroll,
} from '@/server/domain/payroll/sellerPayroll'
import {
  comparablePayrollPeriod,
  payrollPeriod,
  payrollWeekPeriod,
  previousPayrollMonday,
  previousPayrollMonth,
} from '@/server/domain/period/period'
import { payrollQuerySchema, payrollWeekQuerySchema } from '@/server/http/queryParams'

const som = (major: number) => BigInt(major) * 100n
const mln = (major: number) => som(major * 1_000_000)

const TZ = 'Asia/Tashkent'

/**
 * THE CLIENT'S OWN WORKED EXAMPLES, TYPED OUT.
 *
 * Every case in this block is a line from the instruction they sent on
 * 2026-09-14, with the answer they wrote beside it. They are the acceptance
 * test for the whole screen: a change to the tiers that still passes the rest
 * of the suite but fails one of these has changed what somebody is paid.
 */
describe('the pay scheme, against the client’s own table', () => {
  const month = (major: number) =>
    sellerPayroll({ basisMinor: mln(major), scheme: 'month' })
  const half = (major: number) =>
    sellerPayroll({ basisMinor: mln(major), scheme: 'half' })

  it('pays 8% and no fixed part at 30 mln for a month', () => {
    const pay = month(30)
    expect(pay.percentMinor).toBe(som(2_400_000))
    expect(pay.fixedMinor).toBe(0n)
    expect(pay.totalMinor).toBe(som(2_400_000))
  })

  it('pays 3 600 000 + 500 000 = 4 100 000 at 45 mln', () => {
    const pay = month(45)
    expect(pay.percentMinor).toBe(som(3_600_000))
    expect(pay.fixedMinor).toBe(som(500_000))
    expect(pay.totalMinor).toBe(som(4_100_000))
  })

  /*
    THE ONE CONTRADICTION IN THE INSTRUCTION, SETTLED BY THE CLIENT.

    Their sheet prints «8% (4 800 000) + 750 000 = 5 550 000 (Hujjat bo'yicha:
    5 500 000)». Asked which of the two governs, they answered the formula on
    2026-09-14. Pinned here because 50 000 soʻm a head a month is exactly the
    sort of difference nobody notices until payday.
  */
  it('pays 5 550 000 at 60 mln — the formula, not the 5 500 000 in the sheet', () => {
    expect(month(60).totalMinor).toBe(som(5_550_000))
    expect(month(60).totalMinor).not.toBe(som(5_500_000))
  })

  it('pays 5 600 000 + 1 000 000 = 6 600 000 at 70 mln', () => {
    const pay = month(70)
    expect(pay.percentMinor).toBe(som(5_600_000))
    expect(pay.fixedMinor).toBe(som(1_000_000))
    expect(pay.totalMinor).toBe(som(6_600_000))
  })

  it('reads the fortnight table at half the money', () => {
    expect(half(15).totalMinor).toBe(som(1_200_000))
    expect(half(22.5).totalMinor).toBe(som(2_300_000))
    expect(half(30).totalMinor).toBe(som(3_150_000))
    expect(half(35).totalMinor).toBe(som(3_800_000))
  })

  /*
    NOBODY IS DISMISSED AND NOBODY IS ZEROED.

    The sheet says «< 30 000 000 -> xodim ishdan ketadi (0 so'm)»; the client
    corrected it in the same conversation — «ishdan ketmaydi shunchaki
    yozilgan… 30 mln dan pastlarni ham hisoblayver». A zero here would be a
    real person's pay deleted by a line of prose nobody meant literally.
  */
  it('still pays 8% under the first tier, in both schemes', () => {
    expect(month(12).totalMinor).toBe(som(960_000))
    expect(month(12).fixedMinor).toBe(0n)
    expect(half(8).totalMinor).toBe(som(640_000))
    expect(sellerPayroll({ basisMinor: 0n, scheme: 'month' }).totalMinor).toBe(0n)
  })
})

describe('the tier boundaries', () => {
  it('pays the HIGHEST cleared tier, never the first match', () => {
    // Descending order is the mechanism; ascending would pay 500 000 here.
    expect(sellerPayroll({ basisMinor: mln(80), scheme: 'month' }).fixedMinor).toBe(
      som(1_000_000),
    )
  })

  it('is inclusive on the floor and exclusive just under it', () => {
    expect(sellerPayroll({ basisMinor: mln(45), scheme: 'month' }).fixedMinor).toBe(
      som(500_000),
    )
    expect(
      sellerPayroll({ basisMinor: mln(45) - 100n, scheme: 'month' }).fixedMinor,
    ).toBe(0n)
  })

  it('names the NEXT rung up, and the lowest one at that', () => {
    const under = sellerPayroll({ basisMinor: mln(38), scheme: 'month' })
    expect(under.nextFloorMinor).toBe(mln(45))
    expect(under.toNextMinor).toBe(mln(7))
    expect(under.tierFloorMinor).toBeNull()

    const top = sellerPayroll({ basisMinor: mln(90), scheme: 'month' })
    expect(top.nextFloorMinor).toBeNull()
    expect(top.toNextMinor).toBeNull()
    expect(top.tierFloorMinor).toBe(mln(70))
  })

  it('keeps the two tables apart', () => {
    // 30 mln is nothing in a month and the middle rung in a fortnight.
    expect(sellerPayroll({ basisMinor: mln(30), scheme: 'month' }).fixedMinor).toBe(0n)
    expect(sellerPayroll({ basisMinor: mln(30), scheme: 'half' }).fixedMinor).toBe(
      som(750_000),
    )
    expect(MONTH_TIERS).toHaveLength(HALF_TIERS.length)
  })
})

/**
 * «HAFTALIK DAROMAD FORMULASI», 2026-10-03 — every worked example the
 * document prints, typed out. The rate is the tier and applies to the WHOLE
 * figure; under 15 mln nothing is paid.
 */
describe('the weekly income, against the client’s own table', () => {
  const week = (soms: number) => sellerPayroll({ basisMinor: som(soms), scheme: 'week' })

  it('pays nothing under 15 mln', () => {
    expect(week(14_999_999).totalMinor).toBe(0n)
    expect(week(14_999_999).percentBp).toBe(0n)
    expect(week(0).totalMinor).toBe(0n)
  })

  it('24 900 000 × 5% = 1 245 000', () => {
    const pay = week(24_900_000)
    expect(pay.percentBp).toBe(500n)
    expect(pay.fixedMinor).toBe(0n)
    expect(pay.totalMinor).toBe(som(1_245_000))
    expect(week(15_000_000).totalMinor).toBe(som(750_000))
  })

  it('34 900 000 × 8% + 300 000 = 3 092 000', () => {
    const pay = week(34_900_000)
    expect(pay.percentMinor).toBe(som(2_792_000))
    expect(pay.fixedMinor).toBe(som(300_000))
    expect(pay.totalMinor).toBe(som(3_092_000))
  })

  it('49 900 000 × 10% + 600 000 = 5 590 000', () => {
    const pay = week(49_900_000)
    expect(pay.percentMinor).toBe(som(4_990_000))
    expect(pay.totalMinor).toBe(som(5_590_000))
  })

  it('50 000 000 × 12% + 1 200 000 = 7 200 000', () => {
    const pay = week(50_000_000)
    expect(pay.percentBp).toBe(1_200n)
    expect(pay.totalMinor).toBe(som(7_200_000))
    expect(pay.nextFloorMinor).toBeNull()
  })

  it('applies the rate to the whole figure, not the part above the floor', () => {
    // 25 mln: 8% of all 25 mln (2 000 000) + 300 000.
    expect(week(25_000_000).totalMinor).toBe(som(2_300_000))
  })

  it('changes tier exactly on each floor, never a tiyin early', () => {
    expect(week(25_000_000).totalMinor).toBe(som(2_300_000))
    const below25 = sellerPayroll({ basisMinor: som(25_000_000) - 1n, scheme: 'week' })
    expect(below25.percentBp).toBe(500n)
    expect(below25.fixedMinor).toBe(0n)

    expect(week(35_000_000).totalMinor).toBe(som(4_100_000))
    const below35 = sellerPayroll({ basisMinor: som(35_000_000) - 1n, scheme: 'week' })
    expect(below35.percentBp).toBe(800n)
    expect(below35.fixedMinor).toBe(som(300_000))

    const below50 = sellerPayroll({ basisMinor: som(50_000_000) - 1n, scheme: 'week' })
    expect(below50.percentBp).toBe(1_000n)
    expect(below50.fixedMinor).toBe(som(600_000))
  })

  it('keeps every table strictly descending, floor 0 last', () => {
    for (const tiers of [WEEK_TIERS, MONTH_TIERS, HALF_TIERS]) {
      for (let i = 1; i < tiers.length; i++) {
        expect(tiers[i]!.floorMinor < tiers[i - 1]!.floorMinor).toBe(true)
      }
      expect(tiers[tiers.length - 1]!.floorMinor).toBe(0n)
    }
  })

  it('points a seller under 15 mln at 15 mln', () => {
    const pay = week(9_000_000)
    expect(pay.tierFloorMinor).toBeNull()
    expect(pay.nextFloorMinor).toBe(mln(15))
    expect(pay.toNextMinor).toBe(mln(6))
  })
})

describe('the eight per cent itself', () => {
  it('is integer arithmetic, rounded half up', () => {
    expect(PERCENT_BP).toBe(800n)
    // 12 345 678 soʻm -> 987 654.24 -> 987 654 soʻm and 24 tiyin, exactly.
    expect(sellerPayroll({ basisMinor: som(12_345_678), scheme: 'month' }).percentMinor)
      .toBe(98_765_424n)
    // A half-tiyin rounds away from zero, like every other money helper here.
    expect(sellerPayroll({ basisMinor: 1_234n, scheme: 'month' }).percentMinor).toBe(99n)
  })
})

/**
 * THE WINDOW, because a payroll paid on the wrong fortnight is the same bug as
 * a payroll computed with the wrong rate.
 */
describe('the payroll window', () => {
  const iso = (date: Date) => date.toISOString()

  it('opens a Tashkent month at 19:00 UTC the day before', () => {
    const period = payrollPeriod('2026-09', 'full', TZ)
    expect(iso(period.start)).toBe('2026-08-31T19:00:00.000Z')
    expect(iso(period.end)).toBe('2026-09-30T19:00:00.000Z')
  })

  it('splits at the 16th, so the first half is 1–15 inclusive', () => {
    const first = payrollPeriod('2026-09', 'first', TZ)
    const second = payrollPeriod('2026-09', 'second', TZ)
    expect(iso(first.start)).toBe('2026-08-31T19:00:00.000Z')
    expect(iso(first.end)).toBe('2026-09-15T19:00:00.000Z')
    // Half-open and tiling: the first half's end IS the second half's start.
    expect(iso(second.start)).toBe(iso(first.end))
    expect(iso(second.end)).toBe(iso(payrollPeriod('2026-09', 'full', TZ).end))
  })

  it('gives the second half whatever the month has left, February included', () => {
    const feb = payrollPeriod('2026-02', 'second', TZ)
    expect(iso(feb.start)).toBe('2026-02-15T19:00:00.000Z')
    expect(iso(feb.end)).toBe('2026-02-28T19:00:00.000Z')

    const jan = payrollPeriod('2026-01', 'second', TZ)
    expect(iso(jan.end)).toBe('2026-01-31T19:00:00.000Z')
  })

  it('refuses a month it cannot read', () => {
    expect(() => payrollPeriod('2026-13', 'full', TZ)).toThrow()
    expect(() => payrollPeriod('sentabr', 'full', TZ)).toThrow()
  })
})

describe('the weekly window', () => {
  const iso = (date: Date) => date.toISOString()

  it('runs Monday 00:00 to the next Monday 00:00, Tashkent', () => {
    const week = payrollWeekPeriod('2026-09-28', TZ)
    expect(iso(week.start)).toBe('2026-09-27T19:00:00.000Z')
    expect(iso(week.end)).toBe('2026-10-04T19:00:00.000Z')
  })

  it('tiles: one week ends where the next begins, across a month', () => {
    const a = payrollWeekPeriod('2026-09-28', TZ)
    const b = payrollWeekPeriod('2026-10-05', TZ)
    expect(iso(a.end)).toBe(iso(b.start))
  })

  it('keeps the Monday in a zone east of UTC+12', () => {
    const week = payrollWeekPeriod('2026-09-28', 'Pacific/Kiritimati')
    expect(iso(week.start)).toBe('2026-09-27T10:00:00.000Z')
    expect(iso(week.end)).toBe('2026-10-04T10:00:00.000Z')
  })

  it('refuses a date that is not a Monday, or not a date', () => {
    expect(() => payrollWeekPeriod('2026-09-30', TZ)).toThrow()
    expect(() => payrollWeekPeriod('2026-02-30', TZ)).toThrow()
    expect(() => payrollWeekPeriod('28-09-2026', TZ)).toThrow()
  })

  it('is refused at the query string as a 400, not a 500', () => {
    expect(payrollWeekQuerySchema.safeParse({ week: '2026-09-28' }).success).toBe(true)
    expect(payrollWeekQuerySchema.safeParse({ week: '2026-09-30' }).success).toBe(false)
    expect(payrollWeekQuerySchema.safeParse({ week: '2026-02-30' }).success).toBe(false)
    // Date.UTC would read year 0 as 1900, a Monday on 1 January.
    expect(payrollWeekQuerySchema.safeParse({ week: '0000-01-01' }).success).toBe(false)
    expect(payrollWeekQuerySchema.safeParse({}).success).toBe(false)
    // 0000-01-03 is a Monday, but the week before it has no YYYY to name it.
    expect(payrollWeekQuerySchema.safeParse({ week: '0000-01-03' }).success).toBe(false)
    expect(payrollQuerySchema.safeParse({ month: '0000-01' }).success).toBe(false)
    expect(payrollQuerySchema.safeParse({ month: '0001-01' }).success).toBe(true)
  })
})

/**
 * «KIM QANCHAGA OʻSGAN» — the window a payroll period is compared against.
 *
 * The like period before it (2026-10-05): a week against the week before, a
 * half against the same half of the month before, a month against the month
 * before. While the period is still running the previous one is cut to the
 * same elapsed time, or 5 days of October would be set against all of
 * September and every seller would read as a collapse.
 */
describe('the comparison window', () => {
  const iso = (date: Date) => date.toISOString()

  it('names the month before, across a year', () => {
    expect(previousPayrollMonth('2026-10')).toBe('2026-09')
    expect(previousPayrollMonth('2026-01')).toBe('2025-12')
  })

  it('names the Monday a week earlier, across a month', () => {
    expect(previousPayrollMonday('2026-10-05')).toBe('2026-09-28')
    expect(previousPayrollMonday('2026-03-02')).toBe('2026-02-23')
    expect(previousPayrollMonday('2026-01-05')).toBe('2025-12-29')
  })

  it('compares a closed period with the whole previous one', () => {
    const current = payrollPeriod('2026-09', 'first', TZ)
    const previous = payrollPeriod('2026-08', 'first', TZ)
    const now = new Date('2026-10-05T06:00:00Z')
    const compared = comparablePayrollPeriod(current, previous, now)
    expect(iso(compared.start)).toBe(iso(previous.start))
    expect(iso(compared.end)).toBe(iso(previous.end))
  })

  it('cuts the previous period to the elapsed time while this one runs, to ten minutes', () => {
    const current = payrollPeriod('2026-10', 'full', TZ)
    const previous = payrollPeriod('2026-09', 'full', TZ)
    // 4 days, 11 hours, 30 minutes and 42 seconds into October, Tashkent.
    const now = new Date('2026-10-05T06:30:42.500Z')
    const compared = comparablePayrollPeriod(current, previous, now)
    expect(iso(compared.start)).toBe('2026-08-31T19:00:00.000Z')
    expect(iso(compared.end)).toBe('2026-09-05T06:30:00.000Z')
  })

  it('holds the cut still across the screen’s two-minute polls', () => {
    /*
      The window is the payroll memo's key. Floored to the minute it moved
      between every two 120 s polls, so every poll of a running period was a
      miss that paid the delivered-rows scans in front of the reader.
    */
    const current = payrollPeriod('2026-10', 'full', TZ)
    const previous = payrollPeriod('2026-09', 'full', TZ)
    const at = (instant: string) => iso(comparablePayrollPeriod(current, previous, new Date(instant)).end)
    expect(at('2026-10-05T06:30:00.000Z')).toBe('2026-09-05T06:30:00.000Z')
    expect(at('2026-10-05T06:32:00.000Z')).toBe('2026-09-05T06:30:00.000Z')
    expect(at('2026-10-05T06:39:59.999Z')).toBe('2026-09-05T06:30:00.000Z')
    expect(at('2026-10-05T06:40:00.000Z')).toBe('2026-09-05T06:40:00.000Z')
  })

  it('never runs the cut past the previous period’s own end', () => {
    // 16–31 March against 16–28 February: 15½ days in, February's 13 are all there is.
    const current = payrollPeriod('2026-03', 'second', TZ)
    const previous = payrollPeriod('2026-02', 'second', TZ)
    const now = new Date('2026-03-31T12:00:00Z')
    const compared = comparablePayrollPeriod(current, previous, now)
    expect(iso(compared.end)).toBe(iso(previous.end))
  })

  it('gives a period that has not started an empty previous window', () => {
    const current = payrollWeekPeriod('2026-10-12', TZ)
    const previous = payrollWeekPeriod('2026-10-05', TZ)
    const compared = comparablePayrollPeriod(current, previous, new Date('2026-10-05T06:00:00Z'))
    expect(iso(compared.end)).toBe(iso(compared.start))
  })
})

describe('ropPayroll — «ROPlar guruhi FAKT 2 dan 2% + 2 mln oklad» (2026-10-07)', () => {
  it('pays 2% of the team FAKT 2 plus the 2 000 000 oklad on the month', () => {
    const pay = ropPayroll({ basisMinor: mln(120), scheme: 'month' })
    expect(pay.percentMinor).toBe(mln(2.4))
    expect(pay.fixedMinor).toBe(mln(2))
    expect(pay.totalMinor).toBe(mln(4.4))
  })

  it('pays the 2% alone on a half and on a week — the oklad is monthly', () => {
    for (const scheme of ['half', 'week'] as const) {
      const pay = ropPayroll({ basisMinor: mln(50), scheme })
      expect(pay.percentMinor).toBe(mln(1))
      expect(pay.fixedMinor).toBe(0n)
      expect(pay.totalMinor).toBe(mln(1))
    }
  })

  it('still pays the monthly oklad when the team delivered nothing', () => {
    expect(ropPayroll({ basisMinor: 0n, scheme: 'month' }).totalMinor).toBe(mln(2))
  })
})
