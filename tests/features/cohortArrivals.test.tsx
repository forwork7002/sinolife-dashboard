// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ArrivalBars } from '@/features/cohort/ArrivalBars'

/**
 * «Qancha yangi mijoz keladi» — the client's first question, answered from
 * the cohort sizes that were already on the wire.
 *
 * This repo carries no @testing-library/jest-dom and no @testing-library/
 * user-event, so every assertion below is expressed with plain
 * `getAttribute`/`textContent` and vitest's own `toBe`/`toMatch` — never
 * `toBeInTheDocument()` or `toHaveAttribute()`.
 */
const rows = [
  { cohort: '2025-07-01', size: 13 },
  { cohort: '2025-08-01', size: 24 },
  { cohort: '2025-09-01', size: 17 },
  { cohort: '2026-08-01', size: 20 },
  { cohort: '2026-09-01', size: 2 },
]

describe('the arrivals block', () => {
  it('draws one bar per month, oldest first', () => {
    render(<ArrivalBars rows={rows} currentMonth="2026-09-01" />)

    // Scoped to the bar container: a bare `screen.getAllByRole('img')` would
    // also catch the InfoTip's SVG glyph, which sits in the same section.
    const bars = within(screen.getByTestId('arrival-bars')).getAllByRole('img', {
      hidden: true,
    })
    expect(bars).toHaveLength(5)
    expect(bars[0]?.getAttribute('aria-label')).toMatch(/2025/)
  })

  it('marks the running month as unfinished', () => {
    /*
      A customer joins a month when their order is DELIVERED, so the current
      month is half-lived and its bar is always short. Drawn as a finished
      month it reads as a collapse.
    */
    render(<ArrivalBars rows={rows} currentMonth="2026-09-01" />)
    const running = screen.getByLabelText(/2026.*sen.*oy tugamagan/i)
    expect(running.getAttribute('data-partial')).toBe('true')
  })

  it('keeps the running month out of the comparison sentence', () => {
    render(<ArrivalBars rows={rows} currentMonth="2026-09-01" />)

    // `formatMonth` (src/lib/format.ts) prints `YYYY-<3-letter short month>`,
    // never a full month name — August 2026 renders as "2026-avg" and
    // September 2026 as "2026-sen". August is the last COMPLETE month: 20
    // against the mean of the complete months before it — never against
    // September's partial 2.
    const text = screen.getByRole('status').textContent
    expect(text).toMatch(/2026-avg/)
    expect(text).not.toMatch(/2026-sen/)
  })

  it('says nothing rather than compare against one month', () => {
    render(
      <ArrivalBars rows={[{ cohort: '2026-09-01', size: 2 }]} currentMonth="2026-09-01" />,
    )
    expect(screen.queryByRole('status')).toBeNull()
  })
})
