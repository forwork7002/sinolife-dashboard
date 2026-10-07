// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { ConfirmedRateChart } from '@/components/charts/ConfirmedRateChart'
import { trendGranularity } from '@/features/sales/trendGranularity'

/**
 * WHAT ONE POINT OF THE TREND IS, READ OFF THE TREND.
 *
 * The server buckets the queue cohort by day up to 62 days, by week to 365 and
 * by month past that, and clips the FIRST bucket to the window's start. Every
 * caption that measured the first gap was therefore wrong on exactly the
 * windows the client reaches through the picker: a 115-day range opening on a
 * Sunday («kunlik» over weeks), a year and a half opening mid-month
 * («haftalik» over months), and the rate chart said «har bir kun uchun»
 * whatever it was drawing — forty-one weekly points on «Yil → 2026».
 */

const DAY = 86_400_000
/** Points `strides` apart, in days, from a Tashkent midnight. */
const points = (...strides: number[]) => {
  let at = Date.parse('2026-03-07T19:00:00.000Z')
  const out = [{ date: new Date(at).toISOString() }]
  for (const stride of strides) {
    at += stride * DAY
    out.push({ date: new Date(at).toISOString() })
  }
  return out
}

describe('reading the bucket size off the points', () => {
  it('sees weeks behind a first bucket clipped to one day', () => {
    // 2026-03-08 is a Sunday: [8, 9) and then whole Monday weeks.
    expect(trendGranularity(points(1, 7, 7, 7, 7))).toBe('week')
  })

  it('sees months behind a first bucket clipped to a week', () => {
    expect(trendGranularity(points(7, 30, 31, 30, 31))).toBe('month')
  })

  it('sees days as days', () => {
    expect(trendGranularity(points(1, 1, 1))).toBe('day')
  })

  it('makes no claim under two points', () => {
    expect(trendGranularity(points())).toBeNull()
    expect(trendGranularity([])).toBeNull()
  })
})

/*
  jsdom has no `matchMedia` (the chart asks it whether to animate) and no
  `ResizeObserver` (recharts' container measures with one). The caption is
  what is asserted, and it sits outside the plot.
*/
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
})

afterEach(cleanup)

const RATE_POINTS = points(1, 7).map((p) => ({
  date: p.date,
  rate: 90,
  cohortOrders: 10,
  byOutcome: { CONFIRM_NEW: 0, NO_ANSWER: 0, CONFIRMED: 9, REJECTED: 1, UNCONFIRMED_SHIPPED: 0 },
}))

describe('the rate chart’s caption', () => {
  it('names the bucket it is handed, not always a day', () => {
    const { container } = render(
      <ConfirmedRateChart data={RATE_POINTS} granularity="week" height={240} />,
    )

    expect(container.textContent).toContain('har bir hafta uchun')
    expect(container.textContent).not.toContain('har bir kun')
  })

  it('makes no claim when the size is unknown', () => {
    const { container } = render(
      <ConfirmedRateChart data={RATE_POINTS} granularity={null} height={240} />,
    )

    expect(container.textContent).not.toContain('har bir')
  })
})
