import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  PERIOD_PRESETS,
  allTime,
  containsInstant,
  periodLengthInDays,
  resolvePeriod,
} from '@/server/domain/period/period'

/**
 * A SEARCH ON THE CONFIRMATION BOARD LOOKS AT EVERY DATE.
 *
 * The box searches the Bitrix id, the order code, the customer, their phone,
 * the amount, the address — every one of them names ONE order rather than
 * describing a period. But the board opens on «Bugun», so a search bounded by
 * the window answered «Buyurtma topilmadi» for anything older than this
 * morning, while an operator held the customer who placed it on the line. The
 * window is dropped as soon as `q` arrives.
 *
 * Three halves have to hold, and they live in three layers — which is exactly
 * why one can be edited without the others:
 *
 *   1. the route must ANSWER for all of time when `q` is set,
 *   2. `allTime` must actually outrun every preset the control offers,
 *   3. the page must SAY SO, and say it about the rows on screen rather than
 *      about the address bar, which runs a debounce ahead of them.
 */

/** Assertions about source read the code, never the prose explaining it. */
const bare = (path: string) =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

describe('the route answers a search over all of time', () => {
  const route = bare('src/app/api/v1/insights/confirmations/orders/route.ts')

  it('picks the all-time span on `q` and the requested window otherwise', () => {
    // Both branches in one assertion: a rule that only ever returned allTime
    // would pass a test that merely looked for the call. The search shares the
    // branch with «Жами» — see confirmationAllOrders.test.tsx.
    expect(route).toMatch(/ctx\.query\.q \|\|[\s\S]{0,40}allTime\(ctx\.timeZone\)/)
    expect(route).toContain('periodFrom(ctx.query, ctx.timeZone, ctx.now)')
  })

  it('reports the span it actually used, so `meta.period` cannot lie', () => {
    /*
      The window is chosen ABOVE the service call and handed to it, so the one
      `period` in this file is both what was queried and what is reported.
      Dropping the window inside the repository instead would leave the page
      printing «Bugun» over rows from August.
    */
    expect(route).toContain('toPeriodDto(period)')
    expect(route).toContain('insightsService.confirmationQueue(\n      period,')
  })
})

describe('the all-time span really does reach every order', () => {
  const timeZone = 'Asia/Tashkent'
  const now = new Date('2026-09-04T09:00:00.000Z')
  const span = allTime(timeZone)

  const named = PERIOD_PRESETS.filter((preset) => preset !== 'custom')

  it('is testing every preset the control can produce', () => {
    // A filter that silently emptied would make the cases below vacuous.
    expect(named.length).toBe(PERIOD_PRESETS.length - 1)
  })

  it.each(named.map((preset) => [preset] as const))('contains the whole of «%s»', (preset) => {
    const period = resolvePeriod(preset, { timeZone, now })
    expect(containsInstant(span, period.start)).toBe(true)
    // The end is exclusive on both sides, so the instant before it is the last
    // one the preset can hold.
    expect(containsInstant(span, new Date(period.end.getTime() - 1))).toBe(true)
  })

  it('contains a custom window at both ends of what the picker allows', () => {
    // 'custom' is the one preset with no bounds of its own — the picker writes
    // them — so it is checked against a range far wider than anyone will set.
    const period = resolvePeriod('custom', {
      timeZone,
      now,
      customStart: new Date('2000-01-01T00:00:00.000Z'),
      customEnd: new Date('2099-12-31T00:00:00.000Z'),
    })
    expect(containsInstant(span, period.start)).toBe(true)
    expect(containsInstant(span, new Date(period.end.getTime() - 1))).toBe(true)
  })

  it('takes the single-statement shape, not the two-query one', () => {
    /*
      `insightsService.confirmationQueue` splits on a 62-day window: up to two
      months it fires the page and the ROP panel side by side, past that it
      builds the cohort once in one statement — the only shape that finished a
      year on production. An all-time span must land on the second.
    */
    expect(periodLengthInDays(span)).toBeGreaterThan(62)
  })
})

describe('the page says which span the rows came from', () => {
  const page = bare('src/features/confirmation/ConfirmationPage.tsx')

  it('reads the search off the ANSWER, not off the URL', () => {
    /*
      The same rule the state filter learned the hard way: the URL flips on the
      search box's debounce, the rows arrive later. Read from `filters.q`, the
      banner would announce an all-time search over the windowed rows still on
      screen, and the date line would vanish from under a title that still
      described «Bugun».
    */
    expect(page).toContain("askedQ: String(apiParams.q ?? '')")
    expect(page).toContain('const globalSearch = Boolean(query.data?.askedQ) && !backlog')
  })

  it('never prints a date line the rows may not obey', () => {
    /*
      Suppressed outright today — another pass decided the preset row already
      says which window is on screen, so the resolved dates beside the
      description only restated a control the reader is looking at.

      The invariant this pins is the one that has a failure behind it, not that
      decision: if a date line ever comes back, it must be guarded by EVERY
      mode that answers over an unbounded span, or the search results carry
      «01.01.1970 – 31.12.2099» under the title.
    */
    const passed = /meta=\{([^}]+)\}/.exec(page)?.[1]?.trim()
    expect(passed).toBeDefined()
    if (passed !== 'undefined') {
      expect(passed).toContain('globalSearch')
      expect(passed).toContain('allOrders')
    }
  })

  it('dims the period control instead of leaving it looking like a filter', () => {
    // Dimmed, not hidden: hiding it reflows the filter row sideways under the
    // caret on every search and again on every clear.
    // Not while «Жами» is lit: dimming would grey the lit chip too. That half
    // is pinned in confirmationAllOrders.test.tsx.
    expect(page).toMatch(/periodMuted=\{globalSearch\b/)
    expect(page).toContain('period={!backlog}')
  })

  it('offers the way back out of a search, as backlog mode does', () => {
    expect(page).toContain('onClick={() => update({ q: undefined })}')
  })

  it('does not tell an empty search to widen the period', () => {
    // The period is already as wide as it goes; «Filtrlarni tozalab koʻring»
    // alone would send the reader back to a control that cannot help.
    expect(page).toContain('Butun tarix boʻyicha qidirildi')
  })
})
