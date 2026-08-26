'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A number that arrives, rather than appearing.
 *
 * On first paint it counts up to its value; when a live refresh changes the
 * value it glides from the old figure to the new one and flashes a brief
 * highlight, so the reader notices the change happen instead of doubting
 * their memory of what the tile said a minute ago. The dashboard refetches
 * every sixty seconds — on a screen left open on a wall, that glide IS the
 * "live" signal.
 *
 * DETAILS THAT MAKE IT SAFE
 * - The formatted string is rendered inside `.figure` (tabular figures), so a
 *   rolling digit does not change width and nothing beside it jitters.
 * - The server renders the FINAL value. Animation starts in an effect, after
 *   hydration, so there is no SSR/client mismatch and no reader of the HTML —
 *   a crawler, a test, reader mode — ever sees a half-counted number.
 * - `prefers-reduced-motion` renders the final value immediately, and a
 *   change still flashes (opacity only) so the update is not silent.
 * - Interrupted animations retarget from wherever they are, so two refetches
 *   in quick succession cannot fight.
 */
export function AnimatedNumber({
  value,
  format,
  duration = 750,
}: {
  value: number
  /** The same formatter the static rendering would use. */
  format: (value: number) => string
  duration?: number
}) {
  const [display, setDisplay] = useState(value)
  const [flash, setFlash] = useState(0)

  /** Where the tween currently is, surviving re-renders and retargeting. */
  const current = useRef(value)
  const frame = useRef<number>(0)
  const mounted = useRef(false)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // First mount counts up from zero; later changes glide from where the
    // number already is. Both are the same tween with a different start.
    const from = mounted.current ? current.current : reduced ? value : 0
    const isUpdate = mounted.current
    mounted.current = true

    if (isUpdate && from !== value) setFlash((n) => n + 1)

    if (reduced || from === value) {
      current.current = value
      setDisplay(value)
      return
    }

    const started = performance.now()
    const span = value - from

    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration)
      // Ease-out cubic: fast arrival, gentle settle — the house curve.
      const eased = 1 - (1 - t) ** 3
      current.current = from + span * eased
      setDisplay(current.current)
      if (t < 1) frame.current = requestAnimationFrame(tick)
    }

    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [value, duration])

  return (
    <span
      // Keyed by change count, so each live update restarts the flash.
      key={flash}
      className={flash > 0 ? 'value-flash' : undefined}
      // The EXACT value for assistive tech and copy-paste; the counting is
      // presentation only.
      aria-label={format(value)}
    >
      <span aria-hidden="true">{format(display)}</span>
    </span>
  )
}
