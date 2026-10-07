// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { FaktTooltip, chartRows } from '@/components/charts/FaktTrendChart'
import type { FaktForecastPointDto, FaktTrendPointDto } from '@/lib/api'
import { NO_VALUE, formatUzs } from '@/lib/format'
import { t } from '@/lib/messages'

/**
 * THE TOOLTIP OVER A DASHED BUCKET — the one place a projection is read
 * digit by digit, and the one place the plot cannot vouch for.
 *
 * One fact can have no projection while the other does: FAKT 1 runs on from
 * the first order of a morning, FAKT 2 has nothing to divide until something
 * is delivered. The chart draws no dashed FAKT 2 line then, but hovering the
 * FAKT 1 one still opens a tooltip with a FAKT 2 row in it, and that row read
 * `formatUzs(fakt2Projected ?? 0)` — «0 soʻm» under «prognoz», the month
 * ending at nothing, on the bucket a reader is about to quote.
 */

afterEach(cleanup)

const MEASURED = [
  { date: '2026-10-05T19:00:00.000Z', fakt1: 120_000_000, fakt2: 0, orders: 9 },
] as unknown as FaktTrendPointDto[]

// FAKT 1 projects; nothing has been delivered yet, so FAKT 2 continues as null.
const FORECAST: FaktForecastPointDto[] = [
  { date: '2026-10-06T19:00:00.000Z', fakt1: 110_000_000, fakt2: null },
]

/** The tooltip's rows as label → value, read off what it rendered. */
function rowsOf(container: HTMLElement): Record<string, string> {
  return Object.fromEntries(
    [...container.querySelectorAll('dl > div')].map((row) => [
      row.querySelector('dt')?.textContent ?? '',
      row.querySelector('dd')?.textContent ?? '',
    ]),
  )
}

describe('the tooltip over a projected bucket', () => {
  it('prints an em dash for a fact with no projection, never 0 soʻm', () => {
    const bucket = chartRows(MEASURED, FORECAST).find((row) => row.projected)!
    const { container } = render(<FaktTooltip active payload={[{ payload: bucket }]} />)
    const rows = rowsOf(container)

    expect(rows[`${t.chart.fakt2} · prognoz`]).toBe(NO_VALUE)
    // The fact that does project still prints its money.
    expect(rows[`${t.chart.fakt1} · prognoz`]).toBe(formatUzs(110_000_000))
    expect(Object.values(rows)).not.toContain(formatUzs(0))
  })
})
