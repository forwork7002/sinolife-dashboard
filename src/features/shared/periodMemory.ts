'use client'

import type { PeriodSelection } from '@/components/layout/PeriodFilter'

/**
 * THE reporting window, remembered per browser and shared by every screen.
 *
 * ONE WINDOW, NOT ONE PER SECTION. It used to be per route, on the reasoning
 * that the confirmation queue is read for today and the sales chart for the
 * month — but in practice a reader moves between screens asking the SAME
 * question of each, and having every screen answer for a different day made
 * the numbers on two of them impossible to compare. Whoever wants a different
 * window on a screen changes it there; what they must not have to do is
 * remember which window each screen happens to be sitting in.
 *
 * THE URL STILL WINS. `useDashboardFilters` holds the window in the query
 * string, and that stays the source of truth — a link somebody pastes into
 * Telegram must open on the dates it was copied on, not on whatever the
 * recipient last looked at. This only supplies a window when the address bar
 * carries none, and it is written only when a person actually chooses one.
 *
 * PER BROWSER, NOT PER ACCOUNT. It is a convenience, not a setting: two people
 * sharing a login should not move each other's dates around, and nothing here
 * is worth a database round trip on every page load.
 *
 * Storage can be absent or throw — a private window, a browser with site data
 * blocked, a quota that is full. Every path returns the default rather than
 * failing, because a forgotten date is a small annoyance and a page that will
 * not render is not.
 */

const KEY = 'sinolife.period.v2'

type Stored = { window?: PeriodSelection }

/*
  A subscribable snapshot, so the sidebar can render from this without
  reading storage during render.

  It is a STRING rather than the parsed map on purpose: `useSyncExternalStore`
  compares snapshots by identity, and a fresh object on every call would
  re-render for ever. A string of the same content is the same value.
*/
let snapshot = '{}'
let loaded = false
const listeners = new Set<() => void>()

function refresh(): void {
  const next = JSON.stringify(readAll())
  if (next === snapshot) return
  snapshot = next
  for (const listener of listeners) listener()
}

/** Subscribe to changes, including ones made in another tab. */
export function subscribePeriodMemory(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener('storage', refresh)

  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0) window.removeEventListener('storage', refresh)
  }
}

export function periodMemorySnapshot(): string {
  if (!loaded) {
    loaded = true
    snapshot = JSON.stringify(readAll())
  }
  return snapshot
}

/**
 * What the SERVER rendered, which is nothing.
 *
 * The server has no browser storage, so it emits bare links; React hydrates
 * against this value and then re-renders with the real one. Returning the
 * stored map here instead is what produces a hydration mismatch on every
 * entry in the sidebar.
 */
export function periodMemoryServerSnapshot(): string {
  return '{}'
}

function readAll(): Stored {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Stored) : {}
  } catch {
    return {}
  }
}

/** The window last chosen, or null for "never chosen". */
export function rememberedPeriod(): PeriodSelection | null {
  if (typeof window === 'undefined') return null
  return usable(readAll().window)
}

/**
 * A stored window we can actually resolve.
 *
 * A custom range missing a bound resolves to nothing, and storing one is a bug
 * elsewhere rather than something to render around.
 */
function usable(stored: PeriodSelection | undefined): PeriodSelection | null {
  if (!stored?.preset) return null
  if (stored.preset === 'custom' && !(stored.from && stored.to)) return null
  return stored
}

export function rememberPeriod(selection: PeriodSelection): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(KEY, JSON.stringify({ window: selection }))
    refresh()
  } catch {
    // Nothing to do and nothing worth telling the reader: the dates on screen
    // are correct either way, they just will not be there next time.
  }
}

/** Drop the remembered window, so "clear filters" really clears it. */
export function forgetPeriod(): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.removeItem(KEY)
    refresh()
  } catch {
    /* see rememberPeriod */
  }
}

/** The query string every nav link carries, so the window survives a move. */
export function periodQuery(memory?: string): string {
  const stored = memory === undefined
    ? rememberedPeriod()
    : usable((JSON.parse(memory) as Stored).window)
  if (!stored) return ''

  const params = new URLSearchParams({ preset: stored.preset })
  if (stored.preset === 'custom' && stored.from && stored.to) {
    params.set('from', stored.from)
    params.set('to', stored.to)
  }
  return `?${params.toString()}`
}
