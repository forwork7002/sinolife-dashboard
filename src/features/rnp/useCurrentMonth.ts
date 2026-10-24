'use client'

import { useEffect, useState } from 'react'

import { rnpMonthOf } from './rnpDerive'

/**
 * The month it is now in Tashkent, where the floor works, kept current:
 * re-read every minute, so a page left open over midnight on the 1st moves to
 * the new month by itself — «RNP jadvali»'s and «KPI jadvali»'s.
 */
export function useCurrentMonth(): string {
  const [month, setMonth] = useState(() => rnpMonthOf(new Date()))
  useEffect(() => {
    const timer = window.setInterval(() => setMonth(rnpMonthOf(new Date())), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return month
}
