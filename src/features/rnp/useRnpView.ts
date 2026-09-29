'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * «Jadvaldagidek» (the default, `sheet`) or «Kengaytirilgan» (`?view=full`).
 *
 * In the URL for the reason `?rop=` is (`cohort/useCohortRop.ts` states the
 * mechanism once): it decides which screen is on show and it is what gets
 * sent in a link. Written with `replaceState`, read through
 * `useSyncExternalStore`, the default stripped from the query string.
 */
export type RnpView = 'sheet' | 'full'

const listeners = new Set<() => void>()

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener('popstate', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('popstate', onChange)
  }
}

function snapshot(): RnpView {
  return new URL(window.location.href).searchParams.get('view') === 'full' ? 'full' : 'sheet'
}

function serverSnapshot(): RnpView {
  return 'sheet'
}

export function useRnpView(): { readonly view: RnpView; readonly setView: (view: RnpView) => void } {
  const view = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  const setView = useCallback((next: RnpView) => {
    const url = new URL(window.location.href)
    if (next === 'sheet') url.searchParams.delete('view')
    else url.searchParams.set('view', next)
    window.history.replaceState(null, '', url.toString())
    for (const listener of listeners) listener()
  }, [])
  return { view, setView }
}
