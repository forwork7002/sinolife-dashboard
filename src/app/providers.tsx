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
            // Analytics reflect a database that only changes on sync, so a
            // short stale window avoids refetching on every tab focus while
            // keeping the numbers current.
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // A 400 from validation will fail identically on retry; only
            // retry once, for genuine transport blips.
            retry: 1,
          },
        },
      }),
  )

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
