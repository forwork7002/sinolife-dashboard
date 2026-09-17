import { describe, expect, it } from 'vitest'

import * as frontend from '@/features/sellers/medalCatalog'
import * as server from '@/server/domain/analytics/sellerMedals'

/**
 * THE FRONTEND COPY AGAINST ITS ORIGINAL.
 *
 * `medalCatalog.ts` restates the engine's vocabulary because `src/features`
 * may not import `src/server` (eslint). Each side used to be pinned to its own
 * literal array in its own test file, so an edit to the server's order and its
 * test — without the frontend — passed both suites and put the seats and the
 * rows out of step with the engine. Tests are exempt from the layer rule, so
 * this file reads BOTH modules and compares them directly (premium review,
 * 2026-09-17).
 */
describe('medalCatalog mirrors sellerMedals', () => {
  it('MEDAL_ORDER — the same codes in the same order', () => {
    expect([...frontend.MEDAL_ORDER]).toEqual([...server.MEDAL_ORDER])
  })

  it('MEDAL_UNLOCK_LEVEL — the same level for every code', () => {
    expect({ ...frontend.MEDAL_UNLOCK_LEVEL }).toEqual({ ...server.MEDAL_UNLOCK_LEVEL })
  })

  it('every engine code has a name, a metal and nothing extra', () => {
    const codes = [...server.MEDAL_CODES].sort()
    expect(Object.keys(frontend.MEDALS).sort()).toEqual(codes)
    expect(Object.keys(frontend.MEDAL_METAL).sort()).toEqual(codes)
  })

  it('the ladder — titles, thresholds and the Legenda step', () => {
    expect(frontend.LADDER.map((r) => r.title)).toEqual([...server.LEVEL_TITLES])
    // Yangi opens at the first soʻm (1 minor unit), which the frontend states as «no threshold».
    expect(frontend.LADDER.map((r) => r.thresholdSom)).toEqual(
      server.LEVEL_THRESHOLDS_MINOR.map((minor) => (minor === 1n ? null : Number(minor / 100n))),
    )
    expect(frontend.LEGENDA_STEP_SOM).toBe(Number(server.LEGENDA_STEP_MINOR / 100n))
  })

  it('an unknown code (a server deployed ahead of an open tab) is dropped, never looked up', () => {
    const unknown = { code: 'future-medal', count: 1, at: null, amount: null, orders: null, percent: null }
    const known = { code: 'month-gold', count: 1, at: '2026-08-01', amount: null, orders: null, percent: null }
    const medals = [unknown, known] as unknown as Parameters<typeof frontend.sortMedals>[0]
    expect(frontend.sortMedals(medals).map((m) => m.code)).toEqual(['month-gold'])
    expect(frontend.seatMedals(medals, 4).map((m) => m.code)).toEqual(['month-gold'])
    expect(frontend.isKnownMedal('future-medal')).toBe(false)
    expect(frontend.isKnownMedal('first-sale')).toBe(true)
  })
})
