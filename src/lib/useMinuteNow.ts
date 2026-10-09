'use client'

import { useSyncExternalStore } from 'react'

/**
 * «47 daq» that keeps counting — ONE clock for every waiting timer on screen.
 *
 * A drawer of fifty rows with an interval each is fifty timers firing out of
 * step and fifty renders a minute; here every reader subscribes to the same
 * store, the store owns the one interval, and it stops when the last reader
 * leaves. Half a minute, not a whole one: the unit shown is a minute, so a
 * figure is never more than thirty seconds behind the wall clock.
 *
 * A hidden tab throttles timers, so coming back re-reads the clock at once
 * rather than showing the minute the reader left on.
 *
 * The server snapshot is 0 — «not known yet»: a time printed during the
 * server render would be the server's, and the first client frame would
 * disagree with it. Callers treat 0 as no clock.
 */
const TICK_MS = 30_000

let now = 0
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function tick(): void {
  now = Date.now()
  for (const listener of listeners) listener()
}

function onVisible(): void {
  if (document.visibilityState === 'visible') tick()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (timer === null) {
    now = Date.now()
    timer = setInterval(tick, TICK_MS)
    document.addEventListener('visibilitychange', onVisible)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
      document.removeEventListener('visibilitychange', onVisible)
    }
  }
}

function snapshot(): number {
  // Read before the first subscription lands: start the clock rather than answer 0.
  if (now === 0) now = Date.now()
  return now
}

/** Epoch milliseconds, refreshed every half minute for every caller at once; 0 on the server. */
export function useMinuteNow(): number {
  return useSyncExternalStore(subscribe, snapshot, () => 0)
}
