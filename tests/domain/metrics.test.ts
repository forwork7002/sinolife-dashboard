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
      expect(roundPercent(delta.percent)).toBe(14.9)
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
