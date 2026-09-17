import { describe, expect, it } from 'vitest'

import { todayDateLine, weekdayOf } from '@/features/sellers/dateLine'

/**
 * The «Bugun» title line (EFIR Premium spec §7): the weekday is computed in
 * Asia/Tashkent from the server's window, never typed by hand.
 */
describe('the today date line', () => {
  it('2026-09-17 is «payshanba» — from Tashkent midnight, which is 19:00 UTC the day before', () => {
    expect(weekdayOf('2026-09-16T19:00:00.000Z')).toBe('payshanba')
    expect(weekdayOf('2026-09-17T12:00:00+05:00')).toBe('payshanba')
    // One second before Tashkent midnight is still Wednesday.
    expect(weekdayOf('2026-09-16T18:59:59.000Z')).toBe('chorshanba')
  })

  it('prints «17-sentabr 2026, payshanba · bugun»', () => {
    expect(todayDateLine('2026-09-16T19:00:00.000Z')).toBe('17-sentabr 2026, payshanba · bugun')
  })
})
