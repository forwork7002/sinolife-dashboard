'use client'

import { createAuthClient } from 'better-auth/react'

import type { RoleValue } from '@/lib/roles'

/**
 * Browser-side auth.
 *
 * Talks to /api/auth/*. The session it exposes is a CONVENIENCE for rendering —
 * hiding a nav item the user cannot use. It is never the authorisation
 * decision: every endpoint re-checks the permission server-side, so a tampered
 * client gets a 403 rather than data.
 */
export const authClient = createAuthClient()

export const { signIn, signOut, useSession } = authClient

export interface SessionUser {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly role: RoleValue
  readonly employeeId: string | null
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
  }
}
