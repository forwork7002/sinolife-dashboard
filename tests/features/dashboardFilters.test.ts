import { describe, expect, it } from 'vitest'

import { PERIOD_PRESETS } from '@/components/layout/PeriodFilter'
import { resolvePresetParam } from '@/features/shared/useDashboardFilters'

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
    expect(resolvePresetParam(null, null, null)).toBe('this_month')
  })

  it('falls back rather than forwarding a value the API would reject', () => {
    for (const bad of ['garbage', 'last_decade', 'THIS_MONTH', '', 'this_month ']) {
      expect(resolvePresetParam(bad, null, null)).toBe('this_month')
    }
  })

  it('honours a custom range that carries both of its bounds', () => {
    expect(resolvePresetParam('custom', '2026-08-01', '2026-08-23')).toBe('custom')
  })

  it('refuses a custom range missing a bound, which the API also refuses', () => {
    expect(resolvePresetParam('custom', '2026-08-01', null)).toBe('this_month')
    expect(resolvePresetParam('custom', null, '2026-08-23')).toBe('this_month')
    expect(resolvePresetParam('custom', null, null)).toBe('this_month')
  })
})
