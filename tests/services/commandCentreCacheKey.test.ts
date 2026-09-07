import { describe, expect, it } from 'vitest'

import { commandCentreCacheKey } from '@/server/services/commandCentreCacheKey'

/**
 * The command centre's build cache.
 *
 * The bug this holds down: two presets can resolve to the SAME window and
 * still want different comparisons. Every Monday "today" and "this week" are
 * both [Mon 00:00, Tue 00:00), but one looks back a day and the other a week.
 * Keyed on the window alone they shared an entry, and whichever was asked
 * first served the other its neighbour's "previous period" figures.
 *
 * These three cases lived in `tests/http/search.test.ts` until the global ⌘K
 * search was removed and that file went with it. They are the only coverage
 * this key has anywhere, and nothing would have gone red if they had been
 * deleted alongside the feature they were merely sharing a file with.
 */
describe('the command centre cache key', () => {
  const window = {
    start: new Date('2026-08-30T19:00:00.000Z'),
    end: new Date('2026-08-31T19:00:00.000Z'),
    timeZone: 'Asia/Tashkent',
  }

  it('separates two presets that resolve to the same days', () => {
    const today = commandCentreCacheKey({ ...window, preset: 'today' }, 'UZS')
    const week = commandCentreCacheKey({ ...window, preset: 'this_week' }, 'UZS')

    expect(today).not.toBe(week)
  })

  it('still shares one entry for the same preset and window', () => {
    // The whole point of the cache: six people opening the same screen inside
    // 45 seconds must not each run sixteen queries.
    expect(commandCentreCacheKey({ ...window, preset: 'today' }, 'UZS')).toBe(
      commandCentreCacheKey({ ...window, preset: 'today' }, 'UZS'),
    )
  })

  it('separates currencies, which change every money figure on the screen', () => {
    expect(commandCentreCacheKey({ ...window, preset: 'today' }, 'UZS')).not.toBe(
      commandCentreCacheKey({ ...window, preset: 'today' }, 'USD'),
    )
  })
})
