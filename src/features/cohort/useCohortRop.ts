'use client'

import { useCallback, useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()

function publish(): void {
  for (const listener of listeners) listener()
}

/* `popstate` covers back/forward; a same-tab write always goes through
   `setRop` below, which publishes directly rather than waiting on an event
   `history.replaceState` never fires. */
function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener('popstate', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('popstate', onChange)
  }
}

/**
 * Which team's customers the matrix is cut to — a team NAME, or null for all.
 *
 * THIS FILE WAS `useCohortMode.ts` AND CARRIED TWO HOOKS. The other one held
 * `?mode=`, the «Oddiy» / «Batafsil» switch; that reading was removed on
 * 2026-09-16 and the hook went with it. What is left is the mechanism, which
 * both halves shared and which is worth stating once:
 *
 * IT LIVES IN THE URL because it decides WHICH ANSWER is on screen, not how
 * one card draws it. `view` and `months` on the matrix are local state —
 * both arrays are already on the payload and switching costs no request;
 * this one changes the cohort, its denominator and every figure derived from
 * them, and it is the thing somebody sends a colleague a link to («bu bizning
 * jamoa»). It is written with `replaceState` because a router push re-runs
 * the server component — 521 ms of frozen UI per click on this product,
 * measured. The default is stripped from the query string rather than written
 * into it: a default in a shared link is noise.
 *
 * Read through `useSyncExternalStore`, for the reason `theme.ts`,
 * `periodMemory` and `sidebarCollapsed` all are: the URL is only readable
 * once mounted (there is no `window` on the server), so a value read during
 * render would make the first client paint disagree with the markup the
 * server sent. `getServerSnapshot` answers the default — what the shell
 * renders — and the true value takes over once mounted. A plain
 * `useState` + `useEffect(() => setLocal(read()), [])` reads the same way but
 * is a `setState` call synchronous in an effect body, which this repo's
 * `react-hooks/set-state-in-effect` rule refuses for exactly the reason its
 * message gives: syncing with an external system belongs in
 * `useSyncExternalStore`, not in a bare effect.
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
