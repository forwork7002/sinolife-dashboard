import { describe, expect, it } from 'vitest'

import { InvalidPeriodError, sinceMonth } from '@/server/domain/period/period'

/**
 * The window behind the record wall — a lower bound that is a FACT.
 *
 * Every other window in this application is a preset or a pair of dates the
 * reader chose. This one opens at a month the reader cannot move, because
 * before it the portal credited a deal to whoever held the row rather than to
 * the seller who sold it (`sellerBoardService.RECORDS_FROM` carries the
 * measured evidence). So the arithmetic is worth pinning on its own: get the
 * boundary wrong by five hours and the first orders of the opening month are
 * filed under the month the wall exists to exclude.
 */

const TZ = 'Asia/Tashkent'
const NOW = new Date('2026-09-08T09:00:00+05:00')

describe('sinceMonth', () => {
  it('opens at midnight in the reporting zone, not at midnight UTC', () => {
    const period = sinceMonth('2026-08', NOW, TZ)

    // Tashkent is +05:00, so its 1 August begins at 19:00 UTC on 31 July.
    // Built with Date.UTC instead, the window would start five hours early and
    // sweep in the last evening of July — which on this portal is about a
    // hundred orders filed under a month whose attribution is not trustworthy.
    expect(period.start.toISOString()).toBe('2026-07-31T19:00:00.000Z')
  })

  it('runs to now, so the month in progress is on the wall', () => {
    const period = sinceMonth('2026-08', NOW, TZ)
    expect(period.end.getTime()).toBe(NOW.getTime())
  })

  it('is a custom window, because no preset selects it', () => {
    const period = sinceMonth('2026-08', NOW, TZ)
    expect(period.preset).toBe('custom')
    expect(period.timeZone).toBe(TZ)
  })

  it('collapses rather than inverting when the month has not arrived yet', () => {
    // A window whose end preceded its start would return nothing and look like
    // "no records", which is indistinguishable from a working empty wall.
    const period = sinceMonth('2027-01', NOW, TZ)
    expect(period.end.getTime()).toBe(period.start.getTime())
  })

  it('handles a January boundary without stepping into the previous year', () => {
    const period = sinceMonth('2026-01', NOW, TZ)
    expect(period.start.toISOString()).toBe('2025-12-31T19:00:00.000Z')
  })

  it('refuses anything that is not a real YYYY-MM', () => {
    expect(() => sinceMonth('2026-13', NOW, TZ)).toThrow(InvalidPeriodError)
    expect(() => sinceMonth('2026-00', NOW, TZ)).toThrow(InvalidPeriodError)
    expect(() => sinceMonth('2026-8', NOW, TZ)).toThrow(InvalidPeriodError)
    expect(() => sinceMonth('avgust', NOW, TZ)).toThrow(InvalidPeriodError)
  })

  it('is half-open like every other window here', () => {
    const period = sinceMonth('2026-08', NOW, TZ)
    // The start instant belongs to the window; the end instant does not.
    expect(period.start.getTime()).toBeLessThan(period.end.getTime())
  })
})
