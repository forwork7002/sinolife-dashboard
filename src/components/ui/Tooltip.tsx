'use client'

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'

import { InfoGlyph } from '@/components/ui/Icons'

/**
 * The tooltip primitive — what replaces every native `title` that carries data.
 *
 * `title` was the cheapest possible tooltip and it failed everyone who is not
 * a patient mouse user: it never appears on keyboard focus, never on touch,
 * arrives after a second of hovering, and renders in whatever style the OS
 * feels like. The exact values this dashboard tucks into titles (full soʻm
 * amounts, comparison windows, denominators) deserve better delivery.
 *
 * This one shows after ~150ms on hover, immediately on keyboard focus, and on
 * tap for touch (tap again or tap outside to dismiss). The popover is a
 * `.tip`-styled panel portalled to document.body — the portal is not
 * decoration: cards here clip their overflow, and a tooltip born inside one
 * would be amputated at the card edge.
 *
 * Positioning is a small flip-aware hook: above the trigger by default,
 * below when the viewport says no, horizontally clamped so it can never bleed
 * off-screen. Fixed positioning + getBoundingClientRect, remeasured on scroll
 * and resize while open.
 *
 * Screen readers get the content through `aria-describedby` on the trigger —
 * the id only exists while the tip is mounted, so there is never a dangling
 * reference (the same discipline as MultiSelect's aria-controls).
 *
 * Motion: none of its own. Whatever entrance `.tip` defines lives in
 * globals.css behind the house reduced-motion guard; this component only
 * mounts and unmounts.
 */

/** Distance between trigger edge and tip edge, and the viewport safe margin. */
const GAP = 8

interface TipPosition {
  readonly top: number
  readonly left: number
  readonly placement: 'top' | 'bottom'
}

/*
  useLayoutEffect on the server is a React warning; the wrapper renders
  server-side even though the tip never does. Swapping in useEffect for SSR is
  the standard cure — by the time either runs on a client they are equivalent
  for our purposes minus one frame of flicker, which visibility:hidden covers.
*/
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * Where the tip goes, measured — not guessed.
 *
 * Two-pass on purpose: the tip mounts hidden at 0,0, this measures both
 * rectangles, then positions it. Guessing the tip's size instead would break
 * the flip decision exactly when it matters — on long content near the top
 * edge.
 */
function useTipPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  tipRef: RefObject<HTMLElement | null>,
): TipPosition | null {
  const [position, setPosition] = useState<TipPosition | null>(null)

  const measure = useCallback(() => {
    const anchor = anchorRef.current
    const tip = tipRef.current
    if (!anchor || !tip) return

    const a = anchor.getBoundingClientRect()
    const t = tip.getBoundingClientRect()

    // Above unless there is no room above; below is the fallback, and if
    // neither fits the reader is on a very small screen where "below" at
    // least follows reading order.
    const topIfAbove = a.top - t.height - GAP
    const placement: 'top' | 'bottom' = topIfAbove >= GAP ? 'top' : 'bottom'
    const top = placement === 'top' ? topIfAbove : a.bottom + GAP

    // Centered on the trigger, clamped to the viewport with the same margin.
    const centered = a.left + a.width / 2 - t.width / 2
    const left = Math.min(Math.max(centered, GAP), window.innerWidth - t.width - GAP)

    setPosition({ top, left, placement })
  }, [anchorRef, tipRef])

  useIsomorphicLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    measure()
    // Capture-phase scroll: the trigger may live inside any number of
    // scrolling containers, and only capture sees them all.
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [open, measure])

  return position
}

export interface TooltipProps {
  /** What the tip says. Values worth a tooltip are worth tabular figures. */
  readonly content: ReactNode
  /** A single element; it gains aria-describedby while the tip is open. */
  readonly children: ReactElement<{ 'aria-describedby'?: string }>
  /** Hover delay, ms. Focus and touch never wait. */
  readonly delay?: number
  readonly className?: string
}

export function Tooltip({ content, children, delay = 150, className = '' }: TooltipProps) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  // Emulated mouse events trail every tap; this timestamp is how hover
  // handlers recognise them and stand down, so a dismissing tap cannot be
  // undone by its own synthetic mouseenter.
  const lastTouchAt = useRef(0)
  const id = useId()
  const tipId = `${id}-tip`

  const position = useTipPosition(open, anchorRef, tipRef)

  const clearTimer = () => window.clearTimeout(timer.current)

  const show = () => {
    clearTimer()
    timer.current = window.setTimeout(() => setOpen(true), delay)
  }

  const showNow = () => {
    clearTimer()
    setOpen(true)
  }

  const hide = () => {
    clearTimer()
    // The short grace lets the pointer cross the gap into the tip (to select
    // and copy a value) without the tip vanishing under it.
    timer.current = window.setTimeout(() => setOpen(false), 80)
  }

  const hideNow = () => {
    clearTimer()
    setOpen(false)
  }

  // A pending timer that outlives the component would set state on an
  // unmounted tree.
  useEffect(() => () => window.clearTimeout(timer.current), [])

  // Touch: outside tap dismisses; Esc too, which also serves keyboard users
  // who focused the trigger and have read enough.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (anchorRef.current?.contains(target)) return
      if (tipRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const recentTouch = () => Date.now() - lastTouchAt.current < 700

  // The trigger keeps its own identity; it only gains the description while
  // the description exists.
  const trigger = isValidElement(children)
    ? cloneElement(children, { 'aria-describedby': open ? tipId : undefined })
    : children

  return (
    <span
      ref={anchorRef}
      className={`inline-flex ${className}`}
      onMouseEnter={() => {
        if (!recentTouch()) show()
      }}
      onMouseLeave={() => {
        if (!recentTouch()) hide()
      }}
      onFocus={(event) => {
        // Focus-visible only: a mouse click also focuses, and a tip that
        // pops on every click reads as a bug, not a courtesy.
        if (event.target.matches(':focus-visible')) showNow()
      }}
      onBlur={hideNow}
      onPointerDown={(event) => {
        if (event.pointerType !== 'touch') return
        lastTouchAt.current = Date.now()
        clearTimer()
        setOpen((value) => !value)
      }}
    >
      {trigger}
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={tipId}
            role="tooltip"
            className="tip"
            // Hidden until measured — one frame — so the reader never sees
            // the tip teleport from 0,0 to its place.
            style={{
              position: 'fixed',
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              maxWidth: 280,
              zIndex: 60,
              visibility: position ? 'visible' : 'hidden',
            }}
            onMouseEnter={clearTimer}
            onMouseLeave={hide}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  )
}

/**
 * InfoTip — the ⓘ that carries a hint.
 *
 * For the places where nothing on screen is a natural trigger: a label whose
 * denominator needs stating, a metric whose window needs naming. A small
 * ghost button, because a hint a keyboard user cannot reach is a hint half
 * the audience never gets.
 */
export function InfoTip({
  content,
  label = 'Izoh',
  className = '',
}: {
  readonly content: ReactNode
  /** Accessible name of the trigger, not of the content. */
  readonly label?: string
  readonly className?: string
}) {
  return (
    <Tooltip content={content} className={className}>
      <button
        type="button"
        aria-label={label}
        className="focusable inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--grid)] hover:text-[var(--ink-secondary)]"
        style={{ color: 'var(--ink-muted)' }}
      >
        <InfoGlyph size={13} />
      </button>
    </Tooltip>
  )
}
