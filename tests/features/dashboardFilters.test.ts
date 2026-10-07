import { describe, expect, it } from 'vitest'

import { PERIOD_PRESETS } from '@/components/layout/PeriodFilter'
import { resolvePresetParam } from '@/features/shared/useDashboardFilters'
import { isCustomWindow } from '@/lib/customWindow'
import { periodQuerySchema } from '@/server/http/queryParams'

/**
 * The reporting window arrives from the address bar, which nobody controls.
 *
 * Links are pasted between phones, truncated by chat apps, hand-edited and
 * kept from older releases. A preset this hook cannot read used to be handed
 * to the API unchanged: the API rejected it, every card on the page went to an
 * error state, and the control lit no button — so there was nothing on screen
 * left to click that would put it right. Falling back to the default is the
 * one outcome that leaves a working page and a steerable control.
 */
describe('resolvePresetParam', () => {
  it('accepts every preset the control offers', () => {
    for (const preset of PERIOD_PRESETS) {
      expect(resolvePresetParam(preset, null, null)).toBe(preset)
    }
  })

  it('falls back to the default when the parameter is absent', () => {
    expect(resolvePresetParam(null, null, null)).toBe('today')
  })

  it('falls back rather than forwarding a value the API would reject', () => {
    for (const bad of ['garbage', 'last_decade', 'TODAY', '', 'today ']) {
      expect(resolvePresetParam(bad, null, null)).toBe('today')
    }
  })

  it('honours a custom range that carries both of its bounds', () => {
    expect(resolvePresetParam('custom', '2026-08-01', '2026-08-23')).toBe('custom')
  })

  it('refuses a custom range missing a bound, which the API also refuses', () => {
    expect(resolvePresetParam('custom', '2026-08-01', null)).toBe('today')
    expect(resolvePresetParam('custom', null, '2026-08-23')).toBe('today')
    expect(resolvePresetParam('custom', null, null)).toBe('today')
  })

  it('refuses the bounds the API refuses: no calendar day, an end before its start, over ten years', () => {
    // «2026-9» typed into a month field Firefox draws as plain text.
    expect(resolvePresetParam('custom', '2026-9-01', '2026-09-30')).toBe('today')
    expect(resolvePresetParam('custom', '2026-02-30', '2026-03-05')).toBe('today')
    expect(resolvePresetParam('custom', '2026-08-23', '2026-08-01')).toBe('today')
    expect(resolvePresetParam('custom', '2010-01-01', '2026-08-01')).toBe('today')
    expect(resolvePresetParam('custom', '2016-08-01', '2026-08-01')).toBe('custom')
  })
})

/**
 * THE CLIENT'S COPY OF THE WINDOW RULE ANSWERS AS THE SERVER DOES.
 *
 * `isCustomWindow` restates three of `periodQuerySchema`'s refusals by hand —
 * client code may not import the schema — and a window the two disagree on is
 * the bug the copy exists to prevent: honoured, remembered and carried on every
 * sidebar link by the browser, then a 400 on every request of every page. So
 * one table goes to both, with the edges where a drift would show first: the
 * ten-year ceiling to the day, the leap day, the order of the bounds.
 */
describe('isCustomWindow against periodQuerySchema', () => {
  const plusDays = (iso: string, days: number) =>
    new Date(Date.parse(`${iso}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10)

  const windows: readonly (readonly [string | undefined, string | undefined])[] = [
    ['2026-08-01', '2026-08-23'],
    ['2026-08-01', '2026-08-01'],
    // Ten years of 366 days is the ceiling, inclusive; one day more is over it.
    ['2016-01-01', plusDays('2016-01-01', 3660)],
    ['2016-01-01', plusDays('2016-01-01', 3661)],
    ['2026-02-29', '2026-03-05'],
    ['2024-02-29', '2024-03-05'],
    ['2026-02-30', '2026-03-05'],
    ['2026-08-23', '2026-08-01'],
    // «2026-9» typed into a month field Firefox draws as plain text.
    ['2026-9-01', '2026-09-30'],
    ['2026-08', '2026-09'],
    ['2026-08-01T00:00', '2026-08-02'],
    ['2026-08-01', undefined],
    [undefined, '2026-08-01'],
  ]

  it('accepts and refuses exactly the windows the API does', () => {
    for (const [from, to] of windows) {
      const server = periodQuerySchema.safeParse({ preset: 'custom', from, to }).success
      expect(isCustomWindow(from, to), `${from} → ${to}`).toBe(server)
    }
  })

  it('is asked about both answers, not only refusals', () => {
    const answers = windows.map(([from, to]) => isCustomWindow(from, to))
    expect(answers).toContain(true)
    expect(answers).toContain(false)
  })
})
