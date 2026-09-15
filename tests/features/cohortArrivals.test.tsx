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
 *
 * FIX ROUND 1: `CohortSummaryDto.rows` IS SPARSE — a month with no first-time
 * buyer emits no row at all — so the first four cases below use a
 * CONTIGUOUS fixture (every calendar month present) to keep their numbers
 * simple, and three more cases below them exercise the gap the component now
 * has to fill: a bar for a silent month, that bar drawn as a measured zero
 * rather than hatched, and a comparison mean computed over the dense
 * calendar rather than over however many rows happened to exist.
 */

/** Scrambled on purpose — the component must sort before it draws. */
const rows = [
  { cohort: '2026-05-01', size: 14 },
  { cohort: '2026-01-01', size: 10 },
  { cohort: '2026-08-01', size: 20 },
  { cohort: '2026-03-01', size: 15 },
  { cohort: '2026-09-01', size: 2 },
  { cohort: '2026-02-01', size: 12 },
  { cohort: '2026-07-01', size: 16 },
  { cohort: '2026-04-01', size: 11 },
  { cohort: '2026-06-01', size: 13 },
]

describe('the arrivals block', () => {
  it('draws one bar per month, oldest first', () => {
    render(<ArrivalBars rows={rows} currentMonth="2026-09-01" />)

    // Scoped to the bar container: a bare `screen.getAllByRole('img')` would
    // also catch the InfoTip's SVG glyph, which sits in the same section.
    const bars = within(screen.getByTestId('arrival-bars')).getAllByRole('img', {
      hidden: true,
    })
    expect(bars).toHaveLength(9)
    expect(bars[0]?.getAttribute('aria-label')).toMatch(/2026-yan/)
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

  it('says «oy tugamagan» on the screen, not only in the bar’s label', () => {
    /*
      HATCHED **AND LABELLED** — spec §4.1. The words existed only in the
      bar's `aria-label`, and this block has no month axis and no legend, so a
      sighted manager had the hatch texture and nothing to convert it into.
      The caption names the month too: «the striped one» is not findable by
      counting columns.
    */
    const { container } = render(<ArrivalBars rows={rows} currentMonth="2026-09-01" />)

    const caption = within(container).getByText(/oy tugamagan/i)
    expect(caption.textContent).toMatch(/2026-sen/)
    // It is not the bar itself — a `role="img"` label is not visible text.
    expect(caption.getAttribute('role')).toBeNull()
  })

  it('does not caption a hatched bar it never drew', () => {
    /*
      With no rows there is no calendar to anchor on, so the block draws no
      bars at all — and a caption explaining a mark that is not on screen is
      noise pointing at a month nothing is drawing. This is the only shape
      where the running month is absent: the dense calendar always runs
      THROUGH `currentMonth`, so wherever there are bars, one of them is the
      hatched one.
    */
    render(<ArrivalBars rows={[]} currentMonth="2026-09-01" />)

    expect(screen.queryByText(/oy tugamagan/i)).toBeNull()
  })

  it('keeps the running month out of the comparison sentence', () => {
    render(<ArrivalBars rows={rows} currentMonth="2026-09-01" />)

    // `formatMonth` (src/lib/format.ts) prints `YYYY-<3-letter short month>`,
    // never a full month name — August 2026 renders as "2026-avg" and
    // September 2026 as "2026-sen". August is the last COMPLETE month: 20
    // against the mean of the seven complete months before it (Jan-Jul,
    // sum 91 / 7 = 13) — never against September's partial 2.
    const text = screen.getByRole('status').textContent
    expect(text).toMatch(/2026-avg/)
    expect(text).not.toMatch(/2026-sen/)
    expect(text).toMatch(/oldingi 7 toʻliq oy/)
    expect(text).toMatch(/13 ta/)
  })

  it('says nothing rather than compare against one month', () => {
    render(
      <ArrivalBars rows={[{ cohort: '2026-09-01', size: 2 }]} currentMonth="2026-09-01" />,
    )
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says nothing with exactly one complete month behind the last one', () => {
    // The two-month floor's own boundary: two complete months (Jul, Aug)
    // means exactly ONE complete month sits behind the last one — a single
    // month is not a trend, so still no sentence.
    render(
      <ArrivalBars
        rows={[
          { cohort: '2026-07-01', size: 5 },
          { cohort: '2026-08-01', size: 9 },
        ]}
        currentMonth="2026-09-01"
      />,
    )
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('fills a silent month with a measured zero, not a missing bar', () => {
    /*
      `rows` is sparse — a month with no first-time buyer emits no row at all
      (insightsRepository.ts's cohort query; InsightsService.cohorts() has
      already had to learn the same lesson once, in its "THE HORIZON IS THE
      CLOCK" comment). 2026-02 has no row here, exactly that silent month.
    */
    render(
      <ArrivalBars
        rows={[
          { cohort: '2026-01-01', size: 10 },
          { cohort: '2026-03-01', size: 14 },
        ]}
        currentMonth="2026-03-01"
      />,
    )

    const bars = within(screen.getByTestId('arrival-bars')).getAllByRole('img', {
      hidden: true,
    })
    expect(bars).toHaveLength(3)

    const gap = bars[1]
    expect(gap?.getAttribute('aria-label')).toMatch(/2026-fev/)
    expect(gap?.getAttribute('aria-label')).toMatch(/0 ta yangi mijoz/)
    // Measured, not merely unreached — never hatched like the running month.
    expect(gap?.getAttribute('data-partial')).toBe('false')
  })

  it('takes the comparison mean over the dense calendar, not the sparse rows', () => {
    /*
      Jan present, Feb silent, Mar present, Apr running. Reading `rows`
      directly gives exactly ONE month (Jan) between the data's two real rows
      and the last complete one (Mar) — under the two-month floor that prints
      NO sentence at all. The calendar says otherwise: Jan AND Feb both
      precede Mar, so the mean is taken over two months, (10 + 0) / 2 = 5,
      and the sentence renders.
    */
    render(
      <ArrivalBars
        rows={[
          { cohort: '2026-01-01', size: 10 },
          { cohort: '2026-03-01', size: 14 },
        ]}
        currentMonth="2026-04-01"
      />,
    )

    const bars = within(screen.getByTestId('arrival-bars')).getAllByRole('img', {
      hidden: true,
    })
    expect(bars).toHaveLength(4)

    const text = screen.getByRole('status').textContent
    expect(text).toMatch(/2026-mar/)
    expect(text).toMatch(/14 ta yangi mijoz/)
    expect(text).toMatch(/oldingi 2 toʻliq oy/)
    expect(text).toMatch(/5 ta/)
  })
})
