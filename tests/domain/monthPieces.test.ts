import { describe, expect, it } from 'vitest'

import { monthPieces, resolvePeriod, zonedMonthKey } from '@/server/domain/period/period'

const TZ = 'Asia/Tashkent'
const NOW = new Date('2026-10-28T05:00:00Z')

describe('monthPieces — a window cut at every Tashkent month boundary', () => {
  it('hands a window inside one month back as itself', () => {
    const month = resolvePeriod('this_month', { timeZone: TZ, now: NOW })
    expect(monthPieces(month)).toEqual([month])
    expect(monthPieces(month)[0]).toBe(month)
  })

  it('tiles «Shu yil» with ten pieces, no gap and no overlap, the last one to tonight', () => {
    const year = resolvePeriod('this_year', { timeZone: TZ, now: NOW })
    const pieces = monthPieces(year)
    expect(pieces.map((p) => zonedMonthKey(p.start, TZ))).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10',
    ])
    expect(pieces[0]!.start).toEqual(year.start)
    expect(pieces.at(-1)!.end).toEqual(year.end)
    for (let i = 1; i < pieces.length; i += 1) expect(pieces[i]!.start).toEqual(pieces[i - 1]!.end)
    // Tashkent midnight, never UTC's: February opens at 19:00 UTC on 31 January.
    expect(pieces[1]!.start.toISOString()).toBe('2026-01-31T19:00:00.000Z')
    expect(pieces.every((p) => p.preset === 'custom' && p.timeZone === TZ)).toBe(true)
  })

  it('keeps a part-month at either end as a part', () => {
    const custom = resolvePeriod('custom', {
      timeZone: TZ,
      now: NOW,
      customStart: new Date('2026-07-15T00:00:00+05:00'),
      customEnd: new Date('2026-09-10T00:00:00+05:00'),
    })
    expect(monthPieces(custom).map((p) => [p.start.toISOString(), p.end.toISOString()])).toEqual([
      ['2026-07-14T19:00:00.000Z', '2026-07-31T19:00:00.000Z'],
      ['2026-07-31T19:00:00.000Z', '2026-08-31T19:00:00.000Z'],
      ['2026-08-31T19:00:00.000Z', '2026-09-10T19:00:00.000Z'],
    ])
  })
})
