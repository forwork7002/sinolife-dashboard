import { describe, expect, it } from 'vitest'

import { talkChartPoints } from '@/components/charts/CallTalkChart'
import { CALL_SIDES } from '@/lib/callQuality'

/**
 * The chart itself cannot be seen here — recharts measures its container, and
 * jsdom has none — so what is tested is the one part that can be wrong: the
 * transform. The stack top must equal the «Suhbat vaqti» tile, which is why the
 * unlinked side is drawn rather than dropped.
 */
describe('talkChartPoints', () => {
  it('converts seconds to hours per side, and the stack top is the day total', () => {
    const points = talkChartPoints([
      { day: '2026-09-15', talkSec: { BAZA: 36_000, NOT_BAZA: 432_000, UNLINKED: 3_600 } },
    ])

    expect(points).toHaveLength(1)
    expect(points[0]).toEqual(
      expect.objectContaining({ BAZA: 10, NOT_BAZA: 120, UNLINKED: 1, total: 131 }),
    )
    const stacked = CALL_SIDES.reduce((sum, side) => sum + points[0]![side.key], 0)
    expect(stacked).toBe(points[0]!.total)
  })

  it('keeps the order it was given, one point per day', () => {
    const points = talkChartPoints([
      { day: '2026-09-15', talkSec: { BAZA: 0, NOT_BAZA: 0, UNLINKED: 0 } },
      { day: '2026-09-16', talkSec: { BAZA: 7_200, NOT_BAZA: 0, UNLINKED: 0 } },
    ])
    expect(points.map((p) => p.day)).toEqual(['2026-09-15', '2026-09-16'])
    expect(points[1]!.total).toBe(2)
  })
})
