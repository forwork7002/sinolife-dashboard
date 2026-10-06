'use client'

import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'

import { ViewerProvider, type Viewer } from '@/lib/viewer'

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
export function Providers({
  children,
  /**
   * Who is signed in, resolved by the root layout on the server.
   *
   * It rides through here because this is already the one client boundary the
   * whole tree sits under. The shell reads it with `useServerViewer()` and
   * draws the menu this account actually holds on the first frame, instead of
   * showing everything until `/meta/filters` answers. See `@/lib/viewer`.
   */
  viewer = null,
}: {
  children: ReactNode
  viewer?: Viewer | null
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            /**
             * The dashboard keeps itself current.
             *
             * The sync worker pulls from Bitrix24 every 120 s in production
             * (`SYNC_INTERVAL_SEC`), so the browser asks again on the same
             * cadence. Someone watching the screen sees today's orders arrive
             * without touching anything, which is the whole point of leaving
             * it open on a wall.
             *
             * It was 60 s against that 120 s tick until 2026-10-05: every
             * second poll could not find anything new, and on a database
             * measured at 1.6× its one vCPU that day, half of every screen's
             * polling was load with no answer behind it.
             *
             * `staleTime` sits just under the interval so a navigation between
             * pages reuses the cache instead of re-issuing every query, while
             * the timer still fires on schedule.
             */
            refetchInterval: 120_000,
            staleTime: 115_000,

            /**
             * Half an hour in the cache after the last reader leaves.
             *
             * There is no dashboard layout: every screen's queries live in its
             * page component, which unmounts on every navigation. At the
             * library's five-minute default, ten minutes on «Tasdiqlash» was
             * enough to throw «Savdo dinamikasi»'s answer away, and going back
             * to it drew skeletons and waited the whole round trip (~1–1.6 s on
             * the heavier endpoints) instead of painting the last figures at
             * once. Kept, they are past `staleTime` by then, so the return
             * still refetches them — behind the figures, not instead of them.
             * Nothing outlives the account that read it: «Chiqish» clears the
             * cache (`Shell`), and so does reaching /login by any other road
             * (`ForgetOnLogin` below).
             */
            gcTime: 30 * 60_000,

            /**
             * Not while the tab is hidden.
             *
             * A dashboard left open in a background tab for a week would
             * otherwise issue ten thousand queries nobody reads.
             */
            refetchIntervalInBackground: false,

            /**
             * ON FOCUS TOO — BUT ONLY WHEN THE DATA IS ACTUALLY OLD.
             *
             * This was true, then false, and is true again; the two failures
             * are different and the setting alone is not what separates them.
             *
             * IT WAS TURNED OFF on 2026-09-03 because the dashboard is read
             * BESIDE Bitrix24: the tab is left and returned to every few
             * seconds, and every return reissued every query on the page. The
             * screen reloaded under the reader's hands for no reason they had
             * given it.
             *
             * TURNING IT OFF COST THE OTHER HALF, and the client reported that
             * on 2026-09-14 as «avtomatik yangilanmayapti»: the interval above
             * does not run while the tab is HIDDEN (see
             * `refetchIntervalInBackground`), so somebody who works in
             * Bitrix24 and glances at the dashboard came back to numbers from
             * whenever they last looked, and the screen would not correct
             * itself until the resumed timer fired — measured at up to a full
             * minute, and for a glance of ten seconds, never.
             *
             * WHAT MAKES BOTH TRUE AT ONCE IS `staleTime`, which was already
             * 55 seconds and is what this now leans on: a focus refetch fires
             * only for a query that is STALE, so returning twice in a minute
             * costs nothing and returning after an hour is up to date before
             * the reader has finished looking at it. At most one refetch per
             * query per minute, which is the same promise the interval makes.
             */
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

  return (
    <QueryClientProvider client={client}>
      <ForgetOnLogin />
      <ViewerProvider value={viewer}>{children}</ViewerProvider>
    </QueryClientProvider>
  )
}

/**
 * The cache is emptied on the way IN, not only on the way out.
 *
 * `Shell`'s «Chiqish» clears it, but that button is not the only way a session
 * ends. A revoked or expired one is sent to /login by the middleware or the
 * page guard, and the login form comes back with `router.push` — both soft
 * navigations, so this one client, holding up to half an hour of answers
 * (`gcTime`), lived on into whichever account signed in next on the tab and
 * painted the last account's figures before its own refetch landed: a ROP
 * shown company-wide numbers under the same key. Nothing on /login reads a
 * query, so emptying it there costs nothing.
 */
function ForgetOnLogin() {
  const client = useQueryClient()
  const pathname = usePathname()
  useEffect(() => {
    if (pathname === '/login') client.clear()
  }, [client, pathname])
  return null
}
