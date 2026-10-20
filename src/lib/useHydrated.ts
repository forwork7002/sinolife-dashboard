'use client'

import { useSyncExternalStore } from 'react'

/**
 * False while React is hydrating server HTML, true from the next render on —
 * and true at once on a component mounted by a client-side navigation.
 *
 * WHY A PAGE NEEDS IT (2026-10-20). The shell is the `(app)` layout's and sits
 * OUTSIDE the page's Suspense boundary, so it hydrates first and starts the
 * queries it shares with the page (`['filters']`, the session) before the
 * page has hydrated. When one of them answers in between, the page hydrates
 * with data the server never had: a text difference is React #418 and the
 * page is thrown away and redrawn (measured on «Hisob»), an attribute
 * difference is never patched at all — a filter rendered `disabled` with no
 * options on the server stayed disabled. Read shared data through this and
 * the page hydrates on what the server printed, then takes the data on the
 * next frame.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscribe, isClient, isServer)
}

// Hydration ends once and never again: nothing to subscribe to.
function noSubscribe(): () => void {
  return () => {}
}

const isClient = () => true
const isServer = () => false
