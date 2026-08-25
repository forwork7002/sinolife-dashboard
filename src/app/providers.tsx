'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

/**
 * Client-side data layer.
 *
 * Replaces hand-rolled fetch-in-useEffect. That pattern has to reimplement
 * request cancellation, stale-response ordering and loading/error state by
 * hand, and it triggers a cascading render on every mount because the loading
 * flag is set from inside the effect. A query cache does all of it declaratively.
 *
 * The client is created inside state so each browser session gets exactly one,
 * and a server render never shares a cache between requests.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            /**
             * The dashboard keeps itself current.
             *
             * A sync worker pulls from Bitrix24 every minute, so the browser
             * asks again on the same cadence. Someone watching the screen sees
             * today's orders arrive without touching anything, which is the
             * whole point of leaving it open on a wall.
             *
             * `staleTime` sits just under the interval so a navigation between
             * pages reuses the cache instead of re-issuing every query, while
             * the timer still fires on schedule.
             */
            refetchInterval: 60_000,
            staleTime: 55_000,

            /**
             * Not while the tab is hidden.
             *
             * A dashboard left open in a background tab for a week would
             * otherwise issue ten thousand queries nobody reads. Focus brings
             * it straight back up to date.
             */
            refetchIntervalInBackground: false,
            refetchOnWindowFocus: true,

            // A 400 from validation will fail identically on retry; only
            // retry once, for genuine transport blips.
            retry: 1,

            /**
             * Keep the previous period's numbers on screen while the next
             * ones load.
             *
             * Without it, every period change blanks the page to skeletons for
             * a moment — which on a one-minute refresh cycle means the screen
             * flickers on its own.
             */
            placeholderData: <T,>(previous: T) => previous,
          },
        },
      }),
  )

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
