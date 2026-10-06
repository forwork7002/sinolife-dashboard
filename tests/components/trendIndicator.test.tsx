// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { TrendIndicator } from '@/components/ui/TrendIndicator'
import { formatPercent } from '@/lib/format'

/**
 * «×» IS A RISE OF AT LEAST A DOUBLING, AND NOTHING ELSE.
 *
 * The pill gets the percent unsigned, and a fall to zero — `growth(0, p)`,
 * −100% — went down the × branch as «↓×2»: the text of a doubling, with only
 * the arrow to tell them apart. Roistat's tiles read that way every morning
 * before the first lead, and a payroll team with nothing delivered yet on a
 * Monday read as «halved».
 */

afterEach(cleanup)

const pill = (percent: number, direction: 'up' | 'down') =>
  render(<TrendIndicator delta={{ kind: 'change', percent, direction }} />).container.textContent

describe('TrendIndicator', () => {
  it('prints a fall to zero as 100%, never as a multiple', () => {
    const text = pill(-100, 'down')
    expect(text).toContain(formatPercent(100))
    expect(text).not.toContain('×')
  })

  it('prints a fall past −100% (a negative base) as its percentage too', () => {
    const text = pill(-400, 'down')
    expect(text).toContain(formatPercent(400))
    expect(text).not.toContain('×')
  })

  it('keeps the multiple for a rise of a doubling or more, and the percentage below it', () => {
    expect(pill(100, 'up')).toContain('×2')
    expect(pill(410, 'up')).toContain('×5.1')
    expect(pill(1_150, 'up')).toContain('×13')
    expect(pill(99, 'up')).toContain(formatPercent(99))
    expect(pill(-40, 'down')).toContain(formatPercent(40))
  })
})
