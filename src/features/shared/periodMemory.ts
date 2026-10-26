'use client'

import type { PeriodSelection } from '@/components/layout/PeriodFilter'
import { isCustomWindow } from '@/lib/customWindow'

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
 * BUT ONLY UP TO A MONTH (2026-10-26, the client: «1 oydan koʻp maʼlumot
 * qidirib, misol uchun yillik … keyingi boʻlimga oʻtsa u boʻlimda ham yillik
 * turmasin, bugun boʻlib tursin»). A year, or a range of more than
 * `CARRIED_MAX_DAYS` days, is asked of ONE screen on purpose; carried, it
 * opened every next screen on a year — the slowest question each of them
 * can be asked, on a one-core database — for a reader who only wanted to look
 * at today there. Such a window is remembered as chosen and READ as never
 * chosen (`usable`), so every other section's link is bare and opens on the
 * default, «Bugun». Up to a month — Bugun · Kecha · Hafta · Shu oy · Oʻtgan
 * oy, or a range of 31 days — still travels, for the comparison above. The
 * screen it was chosen on keeps it: the address carries it, and the rail's
 * entry for the current section links to the current address.
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

/** The longest window carried to another section: a month — «Shu oy» of 31 days, or a 31-day range. */
export const CARRIED_MAX_DAYS = 31

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
 * A stored window we can actually resolve — and one short enough to travel.
 *
 * A custom range missing a bound resolves to nothing, and storing one is a bug
 * elsewhere rather than something to render around. So does one the API would
 * refuse («2026-9-01» typed into a month field drawn as text): remembered, it
 * rode every nav link and opened every screen on a 400. And a window longer
 * than a month is not carried at all — see the note at the top.
 */
function usable(stored: PeriodSelection | undefined): PeriodSelection | null {
  if (!stored?.preset) return null
  if (stored.preset === 'custom' && !isCustomWindow(stored.from, stored.to)) return null
  return carries(stored) ? stored : null
}

/**
 * Whether a window travels to the next section: every preset up to a month,
 * and a range of at most `CARRIED_MAX_DAYS` calendar days, both ends counted.
 */
export function carries(selection: PeriodSelection): boolean {
  if (selection.preset === 'this_year') return false
  if (selection.preset !== 'custom') return true
  if (!selection.from || !selection.to) return false
  const days = Math.round((Date.parse(selection.to) - Date.parse(selection.from)) / 86_400_000) + 1
  return days <= CARRIED_MAX_DAYS
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
