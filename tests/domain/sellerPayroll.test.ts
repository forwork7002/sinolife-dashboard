import { describe, expect, it } from 'vitest'

import {
  BAZA_HALF_TIERS,
  BAZA_MONTH_TIERS,
  BAZA_WEEK_TIERS,
  FLAT_RATE_SELLERS,
  HALF_TIERS,
  MONTH_TIERS,
  PERCENT_BP,
  WEEK_TIERS,
  payrollSchemeOf,
  ropPayroll,
  sellerPayroll,
} from '@/server/domain/payroll/sellerPayroll'
import { resolvePeriod } from '@/server/domain/period/period'
import { payrollQuerySchema } from '@/server/http/queryParams'

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
 * WHICH TABLE A WINDOW IS PAID BY (2026-10-17): its length, measured on the
 * whole calendar unit — «Shu oy» is a month on the 5th as on the 30th.
 */
describe('payrollSchemeOf', () => {
  const NOW = new Date('2026-10-05T06:00:00Z')
  const custom = (from: string, to: string) =>
    resolvePeriod('custom', {
      timeZone: TZ,
      now: NOW,
      customStart: new Date(`${from}T12:00:00Z`),
      customEnd: new Date(`${to}T12:00:00Z`),
    })

  it('pays up to 7 days by the week, up to 16 by the fortnight, longer by the month', () => {
    expect(payrollSchemeOf(custom('2026-10-01', '2026-10-01'))).toBe('week')
    expect(payrollSchemeOf(custom('2026-09-28', '2026-10-04'))).toBe('week')
    expect(payrollSchemeOf(custom('2026-09-28', '2026-10-05'))).toBe('half')
    expect(payrollSchemeOf(custom('2026-09-01', '2026-09-15'))).toBe('half')
    expect(payrollSchemeOf(custom('2026-08-16', '2026-08-31'))).toBe('half')
    expect(payrollSchemeOf(custom('2026-08-15', '2026-08-31'))).toBe('month')
    expect(payrollSchemeOf(custom('2026-09-01', '2026-09-30'))).toBe('month')
  })

  it('answers at most a month: «Shu yil» and a range over 31 days are a 400', () => {
    expect(payrollQuerySchema.safeParse({ preset: 'this_month' }).success).toBe(true)
    expect(payrollQuerySchema.safeParse({ preset: 'this_year' }).success).toBe(false)
    expect(payrollQuerySchema.safeParse({ preset: 'custom', from: '2026-08-01', to: '2026-08-31' }).success).toBe(true)
    expect(payrollQuerySchema.safeParse({ preset: 'custom', from: '2026-08-01', to: '2026-09-01' }).success).toBe(false)
    expect(payrollQuerySchema.safeParse({ preset: 'custom' }).success).toBe(false)
  })

  it('reads «Shu oy» as the whole month, however early in it', () => {
    expect(payrollSchemeOf(resolvePeriod('this_month', { timeZone: TZ, now: NOW }))).toBe('month')
    expect(payrollSchemeOf(resolvePeriod('today', { timeZone: TZ, now: NOW }))).toBe('week')
    expect(payrollSchemeOf(resolvePeriod('previous_month', { timeZone: TZ, now: NOW }))).toBe('month')
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

/**
 * БАЗА — the client, 2026-10-20: «20 mln ga 10% 500 oklad, 25 mln ga 12% 500
 * oklad, 35 mln ga 15% 500 oklad», under 20 mln «8% foiz va oklad oladi
 * tamom»; 15 days and a week divide the month, oklad included (the user's
 * choice). The rate applies to the whole figure.
 */
describe('БАЗА tables (2026-10-20)', () => {
  const baza = (major: number, scheme: 'month' | 'half' | 'week' = 'month') =>
    sellerPayroll({ basisMinor: mln(major), scheme, table: 'baza' })

  it('pays 8% + 500 000 under 20 mln — the oklad comes on every rung', () => {
    const pay = baza(15)
    expect(pay.percentBp).toBe(800n)
    expect(pay.percentMinor).toBe(som(1_200_000))
    expect(pay.fixedMinor).toBe(som(500_000))
    expect(pay.totalMinor).toBe(som(1_700_000))
    expect(pay.tierFloorMinor).toBeNull()
    expect(pay.nextFloorMinor).toBe(mln(20))
  })

  it('pays 10% / 12% / 15% from 20 / 25 / 35 mln, each + 500 000', () => {
    expect(baza(20).totalMinor).toBe(som(2_000_000 + 500_000))
    expect(baza(25).totalMinor).toBe(som(3_000_000 + 500_000))
    expect(baza(35).totalMinor).toBe(som(5_250_000 + 500_000))
  })

  it('28 mln × 12% + 500 000 = 3 860 000 — the example the user was shown', () => {
    const pay = baza(28)
    expect(pay.percentBp).toBe(1_200n)
    expect(pay.totalMinor).toBe(som(3_860_000))
  })

  it('applies the rate to the whole figure, never only above the floor', () => {
    expect(baza(40).percentMinor).toBe(som(6_000_000))
  })

  it('changes rung exactly on each floor', () => {
    const tiyin = 1n
    expect(sellerPayroll({ basisMinor: mln(20) - tiyin, scheme: 'month', table: 'baza' }).percentBp).toBe(800n)
    expect(sellerPayroll({ basisMinor: mln(25) - tiyin, scheme: 'month', table: 'baza' }).percentBp).toBe(1_000n)
    expect(sellerPayroll({ basisMinor: mln(35) - tiyin, scheme: 'month', table: 'baza' }).percentBp).toBe(1_200n)
  })

  it('halves floors and oklad over 15 days: 10 / 12,5 / 17,5 mln, 250 000', () => {
    expect(baza(9, 'half').totalMinor).toBe(som(720_000 + 250_000))
    expect(baza(10, 'half').totalMinor).toBe(som(1_000_000 + 250_000))
    expect(baza(12.5, 'half').totalMinor).toBe(som(1_500_000 + 250_000))
    expect(baza(17.5, 'half').totalMinor).toBe(som(2_625_000 + 250_000))
  })

  it('quarters them over a week: 5 / 6,25 / 8,75 mln, 125 000', () => {
    expect(baza(4, 'week').totalMinor).toBe(som(320_000 + 125_000))
    expect(baza(5, 'week').totalMinor).toBe(som(500_000 + 125_000))
    expect(baza(6.25, 'week').totalMinor).toBe(som(750_000 + 125_000))
    expect(baza(8.75, 'week').totalMinor).toBe(som(1_312_500 + 125_000))
  })

  it('keeps every БАЗА table strictly descending, floor 0 last, oklad on each rung', () => {
    for (const tiers of [BAZA_MONTH_TIERS, BAZA_HALF_TIERS, BAZA_WEEK_TIERS]) {
      expect(tiers.at(-1)!.floorMinor).toBe(0n)
      for (let i = 1; i < tiers.length; i++) expect(tiers[i]!.floorMinor < tiers[i - 1]!.floorMinor).toBe(true)
      expect(new Set(tiers.map((tier) => tier.fixedMinor)).size).toBe(1)
    }
  })

  it('leaves the standard tables alone', () => {
    expect(sellerPayroll({ basisMinor: mln(30), scheme: 'month' }).totalMinor).toBe(som(2_400_000))
    expect(sellerPayroll({ basisMinor: mln(30), scheme: 'month', table: 'standard' }).totalMinor).toBe(som(2_400_000))
  })
})

describe('a flat rate of the person\'s own — «Marjona Shahtiyarovna 18%» (2026-10-20)', () => {
  it('is portal user 7044 at 18%', () => {
    expect(FLAT_RATE_SELLERS['7044']).toBe(1_800n)
  })

  it('pays 18% of FAKT 2 and nothing else, on every scheme', () => {
    for (const scheme of ['month', 'half', 'week'] as const) {
      const pay = sellerPayroll({ basisMinor: mln(50), scheme, table: 'flat', flatBp: 1_800n })
      expect(pay.percentMinor).toBe(som(9_000_000))
      expect(pay.fixedMinor).toBe(0n)
      expect(pay.totalMinor).toBe(som(9_000_000))
      expect(pay.tierFloorMinor).toBeNull()
      expect(pay.nextFloorMinor).toBeNull()
    }
  })

  it('refuses a flat seller without a rate rather than paying a guess', () => {
    expect(() => sellerPayroll({ basisMinor: mln(1), scheme: 'month', table: 'flat' })).toThrow()
  })
})
