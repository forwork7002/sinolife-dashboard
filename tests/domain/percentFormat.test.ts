import { describe, expect, it } from 'vitest'

import { formatPercent } from '@/lib/format'

/**
 * A percentage may never print a zero for something that is not zero.
 *
 * Every case here was found on the live dashboard: a product line worth
 * 1.1 bn soʻm printing "0%" beside a visibly non-zero bar, sellers who had
 * won money sharing "0.0%" with sellers who had won none, cohort cells with
 * returning customers carrying the same digit as the cells where nobody came
 * back. A reader takes 0% as "none", so rounding it there was not an
 * approximation — it was a different fact.
 */

describe('a share too small for its precision', () => {
  it('says "below" rather than zero', () => {
    expect(formatPercent(0.0258, 1)).toBe('<0.1%')
    expect(formatPercent(0.3586, 0)).toBe('<1%')
  })

  it('keeps the sign when the value is negative', () => {
    expect(formatPercent(-0.02, 1)).toBe('>-0.1%')
  })

  it('still prints a true zero as zero', () => {
    // The one case where the digit is honest, and the case a reader relies on
    // to tell "nothing happened" from "almost nothing happened".
    expect(formatPercent(0, 1)).toBe('0.0%')
    expect(formatPercent(0, 0)).toBe('0%')
  })

  it('rounds normally once the value is large enough to show', () => {
    expect(formatPercent(0.06, 1)).toBe('0.1%')
    expect(formatPercent(33.4866, 1)).toBe('33.5%')
    expect(formatPercent(96, 1)).toBe('96.0%')
  })

  it('leaves absent values as an em dash', () => {
    expect(formatPercent(null)).toBe('—')
    expect(formatPercent(Number.NaN)).toBe('—')
  })
})
