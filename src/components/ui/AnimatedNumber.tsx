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

  /*
    ONE TEXT NODE, ONE FIGURE (EFIR Premium spec §9).

    This used to print the value twice — a visually-hidden settled copy for
    assistive tech beside an `aria-hidden` counting copy — and the audit of
    the television board found the doubled figure in `textContent`: anything
    that reads the node as text (copy-paste, reader mode, a test, a scraper)
    saw «79 600 00079 600 000». Now there is exactly one: the tween writes the
    same text node it settles in. The count-up lasts under a second, and a
    screen reader that reads the node reads a number that is either final or
    about to be; the server renders the final value, so no HTML reader ever
    sees a half-counted one.

    The U+202F group separators arrive inside the formatted string and are
    never wrapped in elements of their own: tightening them breaks the group
    gap in Firefox.
  */
  return (
    <span
      // Keyed by change count, so each live update restarts the flash.
      key={flash}
      /* A number is one atom. `.figure-wrap` lifts its container's nowrap
         so a unit may fall to the next line; this is what keeps «3.2 mln»
         from splitting after the «3.2» when it does. */
      className={flash > 0 ? 'value-flash whitespace-nowrap' : 'whitespace-nowrap'}
    >
      {/* The tween passes through fractions on its way; a count of orders
          must never print one. Rounded when the target is whole, left alone
          for a rate that genuinely carries decimals. */}
      {format(Number.isInteger(value) ? Math.round(display) : display)}
    </span>
  )
}
