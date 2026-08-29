'use client'

import { createAuthClient } from 'better-auth/react'
import { twoFactorClient, usernameClient } from 'better-auth/client/plugins'

import type { RoleValue } from '@/lib/roles'

/**
 * Browser-side auth.
 *
 * Talks to /api/auth/*. The session it exposes is a CONVENIENCE for rendering —
 * hiding a nav item the user cannot use. It is never the authorisation
 * decision: every endpoint re-checks the permission server-side, so a tampered
 * client gets a 403 rather than data.
 */
export const authClient = createAuthClient({
  /**
   * TWO-FACTOR.
   *
   * The plugin's job on this side is small and easy to misread, so: it adds
   * the `authClient.twoFactor.*` methods, and it watches every response for a
   * `twoFactorRedirect: true` body. That flag is how a sign-in that got the
   * password right but is NOT finished announces itself — better-auth returns
   * 200 with no session, because the second factor is still outstanding.
   *
   * NO `twoFactorPage` AND NO `onTwoFactorRedirect` HERE, ON PURPOSE.
   * Both of the plugin's built-in reactions navigate the browser away, and
   * `twoFactorPage` does it with a full page reload. The login form already
   * holds the state a code prompt needs (it knows a sign-in is in flight, it
   * owns the error area, it knows where `?next=` was pointing); throwing that
   * away and re-mounting a second page to ask for six digits loses all of it.
   *
   * So the flag is left for the caller to read. `signIn.email(...)` resolves
   * with `data.twoFactorRedirect === true` instead of a session, and the form
   * swaps its own fields for the code prompt. See `sessionUser` below for what
   * the finished session then looks like.
   */
  plugins: [twoFactorClient(), usernameClient()],
})

export const { signIn, signOut, useSession, twoFactor } = authClient

export interface SessionUser {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly role: RoleValue
  readonly employeeId: string | null
  /**
   * Whether an authenticator app is armed for this account.
   *
   * Contributed by the two-factor plugin's user schema, not by our
   * `additionalFields`. It is here so the account screen can show the true
   * state — "2FA yoqilgan" versus a setup button — rather than guessing from
   * whether a setup request has ever succeeded. Like every other field on this
   * object it is for RENDERING only: turning 2FA on or off goes through the
   * server, which re-checks the password before it will move this flag.
   */
  readonly twoFactorEnabled: boolean
}

export function sessionUser(user: unknown): SessionUser | null {
  if (!user || typeof user !== 'object') return null
  const u = user as Record<string, unknown>

  return {
    id: String(u.id ?? ''),
    name: String(u.name ?? ''),
    email: String(u.email ?? ''),
    role: (u.role as RoleValue) ?? 'SALES',
    employeeId: (u.employeeId as string | null) ?? null,
    // Absent on a session issued before the plugin existed; absent is "off".
    twoFactorEnabled: u.twoFactorEnabled === true,
  }
}
