'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * Which reading of the cohort screen is on show.
 *
 * `simple` answers the three questions a manager asks — how many customers
 * arrive, do they come back, where is the money — in sentences and shapes.
 * `detail` is the matrix and the bands beneath it. Both read the SAME
 * `/insights/cohorts` response; the toggle is a rendering choice, never a
 * refetch, and never a permission.
 *
 * IT LIVES IN THE URL because a manager is sent a link to what somebody is
 * looking at, and it is written with `replaceState` because a router push
 * re-runs the server component — 521 ms of frozen UI per click on this
 * product, measured. The default is stripped from the query string rather
 * than written into it: a default in a shared link is noise.
 *
 * Read through `useSyncExternalStore`, for the reason `theme.ts`,
 * `periodMemory` and `sidebarCollapsed` all are: the URL is only readable
 * once mounted (there is no `window` on the server), so a value read during
 * render would make the first client paint disagree with the markup the
 * server sent. `getServerSnapshot` answers `simple` — the default the shell
 * renders — and the true value takes over once mounted. A plain
 * `useState` + `useEffect(() => setLocal(read()), [])` reads the same way but
 * is a `setState` call synchronous in an effect body, which this repo's
 * `react-hooks/set-state-in-effect` rule refuses for exactly the reason its
 * message gives: syncing with an external system belongs in
 * `useSyncExternalStore`, not in a bare effect.
 */
export type CohortMode = 'simple' | 'detail'

const DEFAULT_MODE: CohortMode = 'simple'

const listeners = new Set<() => void>()

function publish(): void {
  for (const listener of listeners) listener()
}

/* `popstate` covers back/forward; a same-tab write always goes through
   `setMode` below, which publishes directly rather than waiting on an event
   `history.replaceState` never fires. */
function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener('popstate', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('popstate', onChange)
  }
}

function snapshot(): CohortMode {
  const value = new URL(window.location.href).searchParams.get('mode')
  return value === 'detail' || value === 'simple' ? value : DEFAULT_MODE
}

function serverSnapshot(): CohortMode {
  return DEFAULT_MODE
}

export function useCohortMode(): {
  readonly mode: CohortMode
  readonly setMode: (mode: CohortMode) => void
} {
  const mode = useSyncExternalStore(subscribe, snapshot, serverSnapshot)

  const setMode = useCallback((next: CohortMode) => {
    const url = new URL(window.location.href)
    if (next === DEFAULT_MODE) url.searchParams.delete('mode')
    else url.searchParams.set('mode', next)
    window.history.replaceState(null, '', url.toString())
    publish()
  }, [])

  return { mode, setMode }
}

/**
 * Which team's customers the matrix is cut to — a team NAME, or null for all.
 *
 * IN THE URL, AND FOR THE REASON `mode` IS: it decides WHICH ANSWER is on
 * screen, not how one card draws it. `view` and `months` on the matrix are
 * local state because both arrays are already on the payload and switching
 * costs no request; this one changes the cohort, its denominator and every
 * figure derived from them, and it is the thing somebody sends a colleague a
 * link to («bu bizning jamoa»). Same `replaceState`, same store, same
 * `getServerSnapshot` of the default, all for the reasons spelled out above.
 *
 * A NAME AND NOT AN ID, because the portal has no id to give: «Организация
 * сотрудника» is a string stamped on the deal. The strings come from the
 * endpoint's own `?include=rops`, so nothing here ever has to spell one.
 *
 * An unknown name is NOT rejected here. It cannot be — this hook has no
 * roster, and the list arrives asynchronously — so it rides through to the
 * server, matches no customer, and the screen draws its empty state. That is
 * the honest failure for a link whose team has since been renamed in
 * Bitrix24; inventing a fallback to the whole company would answer a link
 * about one team with the company's numbers under the team's name.
 */
export function useCohortRop(): {
  readonly rop: string | null
  readonly setRop: (rop: string | null) => void
} {
  const rop = useSyncExternalStore(subscribe, ropSnapshot, ropServerSnapshot)

  const setRop = useCallback((next: string | null) => {
    const url = new URL(window.location.href)
    if (next === null) url.searchParams.delete('rop')
    else url.searchParams.set('rop', next)
    window.history.replaceState(null, '', url.toString())
    publish()
  }, [])

  return { rop, setRop }
}

function ropSnapshot(): string | null {
  const value = new URL(window.location.href).searchParams.get('rop')
  /* An empty `?rop=` is «the whole company», not a team with no name: the
     route's schema refuses an empty string, so passing one through would turn
     a tidied-up URL into a 400 instead of the default view. */
  return value === null || value === '' ? null : value
}

function ropServerSnapshot(): string | null {
  return null
}
