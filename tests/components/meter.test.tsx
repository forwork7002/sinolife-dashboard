// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Meter } from '@/components/ui/Stat'
import { formatPercent } from '@/lib/format'

/**
 * THE BAR STOPS AT FULL; THE FIGURE DOES NOT.
 *
 * Logistika's ROP «Qamrov» is FAKT 2 ÷ FAKT 1, which passes 100 by design (an
 * order refused in the queue and delivered anyway). The meter printed the
 * clamped value, so a team at 104% read «100.0%» — the same text as a team at
 * exactly 100, and not the 104% the hero ring above it prints.
 */

afterEach(cleanup)

describe('Meter', () => {
  it('prints and announces a value over 100 as it is, with the bar at full width', () => {
    const { container } = render(<Meter value={104} tone="neutral" label="Qamrov" />)

    expect(screen.getByText(formatPercent(104))).toBeTruthy()
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(`Qamrov: ${formatPercent(104)}`)
    const bar = container.querySelector<HTMLElement>('[role="img"] > div')
    expect(bar?.style.width).toBe('100%')
  })

  it('draws a value under 100 to its own width', () => {
    const { container } = render(<Meter value={62.5} />)

    expect(screen.getByText(formatPercent(62.5))).toBeTruthy()
    expect(container.querySelector<HTMLElement>('[role="img"] > div')?.style.width).toBe('62.5%')
  })
})
