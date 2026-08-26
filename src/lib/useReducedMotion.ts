'use client'

import { useSyncExternalStore } from 'react'

/**
 * The user's motion preference, live.
 *
 * CSS animations honour `prefers-reduced-motion` in the stylesheet, but a
 * JS-driven animation — Recharts' draw-in, a rAF tween — cannot be reached by
 * a media query, so it needs the same answer in component code. This exists
 * so that answer is asked ONE way everywhere rather than each chart wiring
 * its own matchMedia listener.
 *
 * `useSyncExternalStore` rather than state-in-effect: the server snapshot is
 * `false` (animate by default — the markup renders finished values anyway),
 * and a live change to the OS setting re-renders immediately instead of on
 * the next mount.
 */
const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}
