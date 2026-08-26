'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

/**
 * Smooth navigation between screens.
 *
 * WHY THIS EXISTS RATHER THAN React's <ViewTransition>
 * React ships a `<ViewTransition>` component and the Next guide documents it,
 * but it is gated behind a feature flag that is OFF in the React canary this
 * version of Next bundles. Wrapping the page in it is silently inert — the
 * component renders, no `view-transition-name` reaches the DOM, and
 * `document.startViewTransition` is never called. Measured, not assumed: a
 * CDP run counted zero calls across five navigations with the component in
 * place, in both the update-in-place and keyed-pair shapes.
 *
 * So this drives the browser API directly. Same CSS in globals.css, same
 * result, and it does not depend on which React channel the framework happens
 * to vendor this month.
 *
 * HOW IT WORKS
 * A single CAPTURE-phase listener on the document, so EVERY in-app link gets
 * the transition — the sidebar, a leaderboard row, a deal id in a table — with
 * no component having to opt in and none of them able to forget.
 *
 * Capture, not bubble, and that is not a detail. `next/link` attaches its
 * handler to the anchor itself, so in the bubble phase it runs FIRST: it has
 * already called `preventDefault` and started the navigation by the time a
 * document-level listener sees the event, and this one bailed on
 * `defaultPrevented` every single time. Capture runs before the target's own
 * handlers. And because Link checks `e.defaultPrevented` before navigating,
 * calling `preventDefault` here makes it stand down — one navigation, ours, no
 * `stopPropagation` needed and every other click handler on the page intact.
 *
 *   1. The click is intercepted and the default navigation cancelled.
 *   2. `startViewTransition` takes a snapshot of the current screen.
 *   3. Its callback pushes the route and returns a promise.
 *   4. The promise resolves in a layout effect once the new pathname has
 *      committed — after the DOM changed, before the browser paints. That
 *      ordering is the whole trick: resolve any earlier and the browser
 *      snapshots the OLD content twice and nothing appears to move.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * No `prefers-reduced-motion` check here. The CSS already replaces the movement
 * with a short crossfade for those readers, which is gentler than the instant
 * swap that skipping the transition entirely would produce.
 */
export function RouteTransitions() {
  const router = useRouter()
  const pathname = usePathname()

  /** Resolves the transition once the destination has rendered. */
  const resolve = useRef<(() => void) | null>(null)
  const awaiting = useRef<string | null>(null)

  const settle = useCallback(() => {
    const pending = resolve.current
    resolve.current = null
    awaiting.current = null
    pending?.()
  }, [])

  // Layout effect, not effect: this must run after the commit and before the
  // paint, which is exactly the window the browser is holding open for us.
  useLayoutEffect(() => {
    if (resolve.current && awaiting.current === pathname) settle()
  }, [pathname, settle])

  useEffect(() => {
    if (typeof document.startViewTransition !== 'function') return

    function onClick(event: MouseEvent) {
      // Anything the browser or another handler already claimed.
      if (event.defaultPrevented || event.button !== 0) return
      // Modifier-clicks open tabs and windows; those are not our navigation.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest('a')
      if (!anchor) return

      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('#')) return
      if (anchor.hasAttribute('download')) return
      if (anchor.target && anchor.target !== '_self') return

      let url: URL
      try {
        url = new URL(anchor.href, window.location.href)
      } catch {
        return
      }

      // External links, and clicking the page you are already on.
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return
      }

      event.preventDefault()

      // A second click while one transition is in flight would leave the first
      // promise dangling and the overlay stuck. Let the pending one finish.
      if (resolve.current) settle()

      awaiting.current = url.pathname

      document.startViewTransition(
        () =>
          new Promise<void>((done) => {
            resolve.current = done
            router.push(`${url.pathname}${url.search}`)

            /**
             * Backstop.
             *
             * If the route never arrives — a failed chunk, a redirect that
             * lands somewhere else — the promise would never resolve and the
             * browser would hold the frozen snapshot over a live page
             * indefinitely. One second is longer than any navigation here and
             * short enough that a stuck screen is never what the user sees.
             */
            window.setTimeout(() => {
              if (resolve.current === done) settle()
            }, 1000)
          }),
      )
    }

    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [router, settle])

  return null
}
