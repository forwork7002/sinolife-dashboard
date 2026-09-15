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
