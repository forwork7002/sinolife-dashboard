import { describe, expect, it } from 'vitest'

import {
  FIRST_PLACE_USD,
  HALF_TIERS,
  MONTH_TIERS,
  PERCENT_BP,
  sellerPayroll,
} from '@/server/domain/payroll/sellerPayroll'
import { payrollPeriod } from '@/server/domain/period/period'

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
  const month = (major: number, rank = 9) =>
    sellerPayroll({ basisMinor: mln(major), scheme: 'month', rank })
  const half = (major: number, rank = 9) =>
    sellerPayroll({ basisMinor: mln(major), scheme: 'half', rank })

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
    expect(sellerPayroll({ basisMinor: 0n, scheme: 'month', rank: 40 }).totalMinor).toBe(0n)
  })
})

describe('the tier boundaries', () => {
  it('pays the HIGHEST cleared tier, never the first match', () => {
    // Descending order is the mechanism; ascending would pay 500 000 here.
    expect(sellerPayroll({ basisMinor: mln(80), scheme: 'month', rank: 3 }).fixedMinor).toBe(
      som(1_000_000),
    )
  })

  it('is inclusive on the floor and exclusive just under it', () => {
    expect(sellerPayroll({ basisMinor: mln(45), scheme: 'month', rank: 3 }).fixedMinor).toBe(
      som(500_000),
    )
    expect(
      sellerPayroll({ basisMinor: mln(45) - 100n, scheme: 'month', rank: 3 }).fixedMinor,
    ).toBe(0n)
  })

  it('names the NEXT rung up, and the lowest one at that', () => {
    const under = sellerPayroll({ basisMinor: mln(38), scheme: 'month', rank: 12 })
    expect(under.nextFloorMinor).toBe(mln(45))
    expect(under.toNextMinor).toBe(mln(7))
    expect(under.tierFloorMinor).toBeNull()

    const top = sellerPayroll({ basisMinor: mln(90), scheme: 'month', rank: 1 })
    expect(top.nextFloorMinor).toBeNull()
    expect(top.toNextMinor).toBeNull()
    expect(top.tierFloorMinor).toBe(mln(70))
  })

  it('keeps the two tables apart', () => {
    // 30 mln is nothing in a month and the middle rung in a fortnight.
    expect(sellerPayroll({ basisMinor: mln(30), scheme: 'month', rank: 5 }).fixedMinor).toBe(0n)
    expect(sellerPayroll({ basisMinor: mln(30), scheme: 'half', rank: 5 }).fixedMinor).toBe(
      som(750_000),
    )
    expect(MONTH_TIERS).toHaveLength(HALF_TIERS.length)
  })
})

describe('the dollar incentives', () => {
  it('pays 50$ from 40 mln and 100$ from 50 mln', () => {
    expect(sellerPayroll({ basisMinor: mln(39), scheme: 'month', rank: 4 }).tierUsd).toBe(0)
    expect(sellerPayroll({ basisMinor: mln(40), scheme: 'month', rank: 4 }).tierUsd).toBe(50)
    expect(sellerPayroll({ basisMinor: mln(49), scheme: 'month', rank: 4 }).tierUsd).toBe(50)
    expect(sellerPayroll({ basisMinor: mln(50), scheme: 'month', rank: 4 }).tierUsd).toBe(100)
    expect(sellerPayroll({ basisMinor: mln(120), scheme: 'month', rank: 4 }).tierUsd).toBe(100)
  })

  it('adds 25$ for first place, on top of whatever the tier paid', () => {
    expect(sellerPayroll({ basisMinor: mln(55), scheme: 'month', rank: 1 }).bonusUsd).toBe(125)
    expect(sellerPayroll({ basisMinor: mln(45), scheme: 'month', rank: 1 }).bonusUsd).toBe(75)
    expect(sellerPayroll({ basisMinor: mln(10), scheme: 'month', rank: 1 }).bonusUsd).toBe(
      FIRST_PLACE_USD,
    )
    expect(sellerPayroll({ basisMinor: mln(55), scheme: 'month', rank: 2 }).bonusUsd).toBe(100)
  })

  it('leaves the soʻm alone — the bonus is a second currency, never converted', () => {
    const leader = sellerPayroll({ basisMinor: mln(55), scheme: 'month', rank: 1 })
    expect(leader.totalMinor).toBe(leader.percentMinor + leader.fixedMinor)
  })
})

describe('the eight per cent itself', () => {
  it('is integer arithmetic, rounded half up', () => {
    expect(PERCENT_BP).toBe(800n)
    // 12 345 678 soʻm -> 987 654.24 -> 987 654 soʻm and 24 tiyin, exactly.
    expect(sellerPayroll({ basisMinor: som(12_345_678), scheme: 'month', rank: 7 }).percentMinor)
      .toBe(98_765_424n)
    // A half-tiyin rounds away from zero, like every other money helper here.
    expect(sellerPayroll({ basisMinor: 1_234n, scheme: 'month', rank: 7 }).percentMinor).toBe(99n)
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
