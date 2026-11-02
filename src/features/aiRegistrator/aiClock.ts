'use client'

import { useSyncExternalStore } from 'react'

/*
  ONE CLOCK for the AI pages' timers («00:42» on a lane counts every second):
  every reader subscribes to the same store, the store owns the one interval,
  and it stops when the last reader leaves — `useMinuteNow`'s pattern at a
  second. 0 on the server: a time printed there would be the server's.
*/
let secondNow = 0
let secondTimer: ReturnType<typeof setInterval> | null = null
const secondListeners = new Set<() => void>()

function secondTick(): void {
  secondNow = Date.now()
  for (const listener of secondListeners) listener()
}

function subscribeSecond(listener: () => void): () => void {
  secondListeners.add(listener)
  if (secondTimer === null) {
    secondNow = Date.now()
    secondTimer = setInterval(secondTick, 1_000)
  }
  return () => {
    secondListeners.delete(listener)
    if (secondListeners.size === 0 && secondTimer !== null) {
      clearInterval(secondTimer)
      secondTimer = null
    }
  }
}

function secondSnapshot(): number {
  if (secondNow === 0) secondNow = Date.now()
  return secondNow
}

/**
 * The server's «now», ticking every second: the browser clock moved by how far
 * it was off at the last poll. The epoch on the server — no data is there to
 * time either, the page renders its skeleton.
 */
export function useServerNow(skewMs: number): Date {
  const now = useSyncExternalStore(subscribeSecond, secondSnapshot, () => 0)
  return new Date(now + skewMs)
}
