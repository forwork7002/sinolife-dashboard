'use client'

import { useEffect, useRef } from 'react'

import { useReducedMotion } from '@/lib/useReducedMotion'

/**
 * A list that turns its own pages, for a screen nobody is standing at.
 *
 * The sellers board is read off a television on the sales floor, and a
 * television has no mouse: whatever sits below the fold is never seen. Fifty
 * sellers do not fit in the height a 1080p screen leaves under the podium,
 * so a board that only showed its first twelve rows would tell the other
 * thirty-eight nothing — and they are the ones the board is for.
 *
 * The list therefore drifts: down at a walking pace, a dwell at the bottom,
 * back up, a dwell at the top. Reversing rather than jumping, because a
 * jump on a screen watched from across a room reads as a glitch. The pace
 * is set so a name is on screen for about ten seconds — long enough to find
 * yourself, not so long that the bottom of the board is a minute away.
 *
 * WHAT STOPS IT. Any hand on the list — pointer over it, a wheel, a touch,
 * keyboard focus inside — holds it still, and it resumes a moment after the
 * hand leaves, from wherever the reader left it. A resting pointer and a
 * wheel tick are held SEPARATELY, or the tick's few seconds would expire
 * under a cursor that never moved. On a desk this is a normal
 * scrollable list that happens to move when ignored. Reduced motion turns it
 * off entirely: a list that scrolls itself is exactly the kind of motion that
 * preference exists to refuse, and `useReducedMotion` is the one place the
 * question is asked.
 *
 * The position is kept in a variable and written to `scrollTop` each frame,
 * rather than read back and incremented — at this pace a frame moves a
 * fraction of a pixel, and an element that rounds `scrollTop` would swallow
 * every step and never move.
 */
export function useAutoScroll<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled || reduced) return

    /** Pixels per second. */
    const PACE = 26
    /** How long the list rests at either end before turning. */
    const DWELL_MS = 4_000
    /** How long a hand keeps the list still after it lets go. */
    const RELEASE_MS = 6_000

    /*
      The longest step one frame may apply.

      `requestAnimationFrame` does not run in a background tab, and a
      television's panel sleeps: the first frame after either is minutes from
      the last one, and an uncapped `elapsed` would apply the whole pause at
      once — the list arrives at an end while nobody watched it travel, which
      is the jump this hook reverses direction to avoid. Capped, a pause
      simply costs the drift the time it was asleep.
    */
    const MAX_STEP_MS = 250

    let frame = 0
    let last = 0
    let direction: 1 | -1 = 1
    let position = el.scrollTop
    /*
      A HAND ON THE LIST IS TWO DIFFERENT FACTS, AND ONE MAY NOT ERASE THE
      OTHER. A pointer resting on the list holds it for as long as it rests
      there; a wheel tick or a touch holds it for a few seconds after the
      last one. Kept as a single deadline, the wheel overwrote the pointer's
      hold — the reader scrolled to their own row, stopped, and six seconds
      later the row slid out from under a cursor that had never left. So the
      standing holds are flags and only the timed one is a deadline.
    */
    let hovering = false
    let focused = false
    /** When the drift may resume, once no hand is resting on the list. */
    let releaseAt = performance.now() + DWELL_MS
    const holding = (now: number) => hovering || focused || now < releaseAt

    const step = (now: number) => {
      frame = requestAnimationFrame(step)
      const elapsed = last ? Math.min(now - last, MAX_STEP_MS) : 0
      last = now

      if (holding(now)) {
        // Follow the reader's own scrolling while held, so the drift resumes
        // from where they left the list and not from where it was.
        position = el.scrollTop
        return
      }

      const range = el.scrollHeight - el.clientHeight
      if (range <= 0) return

      position += direction * (PACE * elapsed) / 1_000
      if (position >= range) {
        position = range
        direction = -1
        releaseAt = now + DWELL_MS
      } else if (position <= 0) {
        position = 0
        direction = 1
        releaseAt = now + DWELL_MS
      }
      el.scrollTop = position
    }

    const enter = () => {
      hovering = true
    }
    const leave = () => {
      hovering = false
      releaseAt = performance.now() + RELEASE_MS
    }
    const focus = () => {
      focused = true
    }
    const blur = () => {
      focused = false
      releaseAt = performance.now() + RELEASE_MS
    }
    // A wheel or a touch is a hand that will let go on its own — it extends
    // the deadline and never shortens a pointer's or the keyboard's hold.
    const touch = () => {
      releaseAt = performance.now() + RELEASE_MS
    }

    el.addEventListener('pointerenter', enter)
    el.addEventListener('pointerleave', leave)
    el.addEventListener('focusin', focus)
    el.addEventListener('focusout', blur)
    el.addEventListener('wheel', touch, { passive: true })
    el.addEventListener('touchstart', touch, { passive: true })
    frame = requestAnimationFrame(step)

    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('pointerenter', enter)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('focusin', focus)
      el.removeEventListener('focusout', blur)
      el.removeEventListener('wheel', touch)
      el.removeEventListener('touchstart', touch)
    }
  }, [enabled, reduced])

  return ref
}
