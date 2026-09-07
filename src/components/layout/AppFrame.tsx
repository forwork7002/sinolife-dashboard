'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { Shell } from './Shell'

/**
 * The shell, mounted ONCE — in the root layout, not in every page.
 *
 * When every page rendered its own <Shell> (via PageShell, or directly on the
 * marketing and account screens), React saw a different component type at the
 * same position on each navigation and tore the whole chrome down: sidebar,
 * header, palette and account block rebuilt, `['meta','alerts']`, `['filters']`
 * and the session re-subscribed, localStorage re-read — on every click.
 * Mounted here, the chrome persists and only the page under it changes.
 *
 * The login screen is the one bare route: it has no session to draw a shell
 * from, and the shell's own queries would 401 against a signed-out browser.
 */
const BARE_ROUTES: readonly string[] = ['/login']

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const bare = BARE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  )
  if (bare) return <>{children}</>
  return <Shell>{children}</Shell>
}
