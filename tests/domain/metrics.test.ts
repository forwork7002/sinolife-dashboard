import { describe, expect, it } from 'vitest'

import {
  conversionRate,
  fromBasisPoints,
  growth,
  ratePercent,
  roundPercent,
  toBasisPoints,
  toDeltaDto,
} from '@/server/domain/analytics/metrics'

describe('growth', () => {
  it('computes an ordinary increase', () => {
    const delta = growth(115, 100)
    expect(delta).toEqual({ kind: 'change', percent: 15, direction: 'up' })
  })

  it('computes an ordinary decrease', () => {
    const delta = growth(93, 100)
    expect(delta.kind).toBe('change')
    if (delta.kind === 'change') {
      expect(roundPercent(delta.percent)).toBe(-7)
      expect(delta.direction).toBe('down')
    }
  })

  it('reports no_baseline instead of dividing by zero', () => {
    // This is the bug this whole module exists to prevent: rendering
    // "+Infinity%" or a made-up "+100%" when the previous period was empty.
    expect(growth(50_000, 0)).toEqual({ kind: 'no_baseline', current: 50_000 })
  })

  it('treats zero-to-zero as unchanged, not as a new baseline', () => {
    expect(growth(0, 0)).toEqual({ kind: 'unchanged' })
  })

  it('distinguishes missing data from a value of zero', () => {
    expect(growth(null, 100)).toEqual({ kind: 'no_data' })
    expect(growth(100, null)).toEqual({ kind: 'no_data' })
  })

  /**
   * The bug these lock in.
   *
   * `growth()` had no floor on the baseline, so any non-zero previous period
   * produced a ratio however tiny it was. On the leaderboard, 43 of the 60
   * rows showing a multiple had a baseline of three deals or fewer and 25 had
   * exactly one — one 900,000 soʻm deal last month printed «↑×153» and sorted
   * that person above everyone who actually sells.
   */
  it('suppresses a ratio when the baseline is a twentieth of the current value', () => {
    expect(growth(137_300_000, 900_000)).toEqual({
      kind: 'small_base',
      current: 137_300_000,
      previous: 900_000,
    })
  })

  it('keeps real growth that clears the floor', () => {
    const delta = growth(510, 100)
    expect(delta.kind).toBe('change')
  })

  it('reports a fall from a large base rather than suppressing it', () => {
    // A collapse has a big denominator by definition, and it is exactly the
    // signal nobody wants hidden.
    const delta = growth(1, 1000)
    expect(delta).toMatchObject({ kind: 'change', direction: 'down' })
  })

  it('does not treat an exactly-20× jump as measurable growth', () => {
    expect(growth(2000, 100).kind).toBe('small_base')
  })

  it('leaves the zero baseline as no_baseline, not small_base', () => {
    expect(growth(50_000, 0)).toEqual({ kind: 'no_baseline', current: 50_000 })
    expect(growth(undefined, undefined)).toEqual({ kind: 'no_data' })
    // ...whereas a real zero is a real measurement:
    expect(growth(0, 100)).toEqual({ kind: 'change', percent: -100, direction: 'down' })
  })

  it('does not flip sign when the baseline is negative', () => {
    // Recovering from -100 to -50 is an improvement. Dividing by the signed
    // baseline would report it as -50%.
    const delta = growth(-50, -100)
    expect(delta.kind).toBe('change')
    if (delta.kind === 'change') {
      expect(delta.percent).toBe(50)
      expect(delta.direction).toBe('up')
    }
  })

  it('accepts bigint money totals', () => {
    const delta = growth(34_000_000_000n, 29_600_000_000n)
    expect(delta.kind).toBe('change')
    if (delta.kind === 'change') {
      /* One decimal, because that is what `toDeltaDto` pins a Delta to — see
         `roundPercent`, whose own default is now SHARE_DECIMALS. */
      expect(roundPercent(delta.percent, 1)).toBe(14.9)
    }
  })

  it('rejects non-finite input rather than propagating NaN', () => {
    expect(growth(Number.NaN, 100)).toEqual({ kind: 'no_data' })
    expect(growth(100, Number.POSITIVE_INFINITY)).toEqual({ kind: 'no_data' })
  })

  it('reports equal values as unchanged', () => {
    expect(growth(250, 250)).toEqual({ kind: 'unchanged' })
  })
})

describe('ratePercent', () => {
  it('computes a share of a whole', () => {
    expect(ratePercent(25, 200)).toBe(12.5)
  })

  it('returns null on a zero denominator rather than 0%', () => {
    // "0 of 0" is undefined. Reporting 0% would claim a failure that did not
    // happen.
    expect(ratePercent(0, 0)).toBeNull()
    expect(ratePercent(5, 0)).toBeNull()
  })

  it('returns null for missing input', () => {
    expect(ratePercent(null, 10)).toBeNull()
    expect(ratePercent(10, undefined)).toBeNull()
  })
})

describe('conversionRate', () => {
  it('measures won against resolved deals only', () => {
    // 30 won, 20 lost, and any number still open -> 60%.
    expect(conversionRate(30, 20)).toBe(60)
  })

  it('is undefined when nothing has resolved yet', () => {
    expect(conversionRate(0, 0)).toBeNull()
  })

  it('is 100% when nothing was lost', () => {
    expect(conversionRate(7, 0)).toBe(100)
  })

  it('rejects negative or fractional counts', () => {
    expect(conversionRate(-1, 5)).toBeNull()
    expect(conversionRate(1.5, 5)).toBeNull()
  })
})

describe('basis points', () => {
  it('round-trips a percentage', () => {
    expect(toBasisPoints(14.87)).toBe(1487)
    expect(fromBasisPoints(1487)).toBe(14.87)
  })

  it('passes null through', () => {
    expect(toBasisPoints(null)).toBeNull()
    expect(fromBasisPoints(null)).toBeNull()
  })
})

describe('toDeltaDto', () => {
  it('rounds the percentage for display', () => {
    const dto = toDeltaDto(growth(115.456, 100))
    expect(dto).toEqual({ kind: 'change', percent: 15.5, direction: 'up' })
  })

  it('drops the raw value from no_baseline so the UI cannot render it as a rate', () => {
    expect(toDeltaDto({ kind: 'no_baseline', current: 999 })).toEqual({
      kind: 'no_baseline',
    })
  })
})

/**
 * THE DEFAULT IS THE POLICY, AND IT USED TO CONTRADICT ITS OWN DOC COMMENT.
 *
 * `roundPercent`'s paragraph has always said «the client rounds once, at the
 * point where the number becomes text», while the signature defaulted to one
 * decimal — so every caller that forgot `SHARE_DECIMALS` put a number on the
 * wire that the client rounded a SECOND time. A value in [x.45, x.5) crosses on
 * the way, which is why it looked like a glitch in a few rows rather than the
 * rule it was: the cohort matrix shipped a cell reading 4% beside its own
 * «Qaytgan» column reading 3%, both from 118 of 3 390.
 *
 * These cases pin the default itself, because the default is the only thing
 * standing between the next service and the same bug.
 */
describe('roundPercent, the transport rounding', () => {
  it('keeps four decimals by default, so the client can round once', () => {
    expect(roundPercent(3.4808259587020647)).toBe(3.4808)
    expect(roundPercent(64.46666666666667)).toBe(64.4667)
  })

  /*
    The crossing the whole class turns on: quantised to one decimal first, a
    true 3.48% reaches the client as 3.5 and prints as «4%»; left at four, it
    prints as «3%», which is what the count beside it says.
  */
  it('does not push a value across a .5 boundary the way one decimal did', () => {
    expect(Math.round(roundPercent(3.4808259587020647))).toBe(3)
    expect(Math.round(roundPercent(3.4808259587020647, 1))).toBe(4)
  })

  it('still answers exactly when asked for one decimal', () => {
    expect(roundPercent(14.8649, 1)).toBe(14.9)
    expect(roundPercent(0.026, 1)).toBe(0)
    /* The case the SHARE_DECIMALS paragraph was written for: one decimal hands
       the client an exact zero for a real non-zero share. */
    expect(roundPercent(0.026)).toBe(0.026)
  })
})
