import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { rangeDateLine, todayDateLine, weekdayOf } from '@/features/sellers/dateLine'

/**
 * The «Bugun» title line (EFIR Premium spec §7): the weekday is computed in
 * Asia/Tashkent from the server's window, never typed by hand.
 */
describe('the today date line', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('2026-09-17 is «payshanba» — from Tashkent midnight, which is 19:00 UTC the day before', () => {
    expect(weekdayOf('2026-09-16T19:00:00.000Z')).toBe('payshanba')
    expect(weekdayOf('2026-09-17T12:00:00+05:00')).toBe('payshanba')
    // One second before Tashkent midnight is still Wednesday.
    expect(weekdayOf('2026-09-16T18:59:59.000Z')).toBe('chorshanba')
  })

  it('prints «17-sentabr 2026, payshanba · bugun»', () => {
    expect(todayDateLine('2026-09-16T19:00:00.000Z')).toBe('17-sentabr 2026, payshanba · bugun')
  })

  it('names every weekday of a week in Uzbek', () => {
    const week = ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19']
    expect(week.map((d) => weekdayOf(`${d}T12:00:00+05:00`))).toEqual([
      'yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba',
    ])
  })

  /*
    FOUND ON THE REAL-DATA AUDIT (2026-09-17, headless Chromium, 1920×1080):
    the line read «17-M09 2026, Thu · bugun». Chromium's ICU carries no Uzbek
    month or weekday names; Node's full ICU does, which is why the two cases
    above passed while the television printed the pattern. The stub below is a
    browser whose 'uz' data is missing — it answers an Uzbek request in
    English — and the line must not notice.
  */
  it('does not depend on the browser carrying Uzbek locale data', async () => {
    const Real = Intl.DateTimeFormat
    function NoUzbek(this: unknown, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
      const asked = Array.isArray(locales) ? locales[0] : locales
      return new Real(asked !== undefined && /^uz/i.test(asked) ? 'en-US' : locales, options)
    }
    NoUzbek.supportedLocalesOf = Real.supportedLocalesOf
    vi.stubGlobal('Intl', { ...Intl, DateTimeFormat: NoUzbek })
    vi.resetModules()
    const fresh = await import('@/features/sellers/dateLine')
    expect(fresh.todayDateLine('2026-09-16T19:00:00.000Z')).toBe('17-sentabr 2026, payshanba · bugun')
    expect(fresh.weekdayOf('2026-09-18T12:00:00+05:00')).toBe('juma')
  })

  /*
    EVERY OTHER WINDOW, IN THE MOCK'S WORDS (premium review, 2026-09-17). The end is
    the API's EXCLUSIVE bound — Tashkent midnight after the last day — so the last
    day printed is the instant before it, as PageShell reads the same field.
  */
  it('prints any other window from the same tables — one day, one month, one year, across years', () => {
    // «Shu oy» on 2026-09-17: 1 Sep 00:00 → 18 Sep 00:00 Tashkent.
    expect(rangeDateLine('2026-08-31T19:00:00.000Z', '2026-09-17T19:00:00.000Z')).toBe('1–17 sentabr 2026')
    // «Kecha»: one day names its weekday, without «bugun».
    expect(rangeDateLine('2026-09-15T19:00:00.000Z', '2026-09-16T19:00:00.000Z')).toBe('16-sentabr 2026, chorshanba')
    expect(rangeDateLine('2026-08-27T19:00:00.000Z', '2026-09-03T19:00:00.000Z')).toBe('28 avgust – 3 sentabr 2026')
    expect(rangeDateLine('2025-12-27T19:00:00.000Z', '2026-01-03T19:00:00.000Z')).toBe('28 dekabr 2025 – 3 yanvar 2026')
  })

  it('the range does not depend on Uzbek locale data either', async () => {
    const Real = Intl.DateTimeFormat
    function NoUzbek(this: unknown, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
      const asked = Array.isArray(locales) ? locales[0] : locales
      return new Real(asked !== undefined && /^uz/i.test(asked) ? 'en-US' : locales, options)
    }
    NoUzbek.supportedLocalesOf = Real.supportedLocalesOf
    vi.stubGlobal('Intl', { ...Intl, DateTimeFormat: NoUzbek })
    vi.resetModules()
    const fresh = await import('@/features/sellers/dateLine')
    expect(fresh.rangeDateLine('2026-08-31T19:00:00.000Z', '2026-09-17T19:00:00.000Z')).toBe('1–17 sentabr 2026')
  })

  it('asks Intl for no Uzbek names at all', () => {
    const source = readFileSync(new URL('../../src/features/sellers/dateLine.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/new Intl\.DateTimeFormat\(\s*['"]uz/)
  })
})
