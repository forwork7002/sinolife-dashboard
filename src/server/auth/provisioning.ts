/**
 * Server-side account provisioning.
 *
 * Public sign-up is disabled, and stays disabled — accounts on an internal
 * dashboard are created by an administrator, not by whoever finds the URL.
 * This module is the sanctioned way in.
 *
 * It goes through better-auth's own context so the credential is hashed by the
 * exact function the sign-in path verifies against. Writing a hash directly
 * into the `account` table is how a seeded user ends up unable to log in.
 */

import { createLocalAccountIssuer } from 'better-auth/db'

import { auth } from './auth'
import { prisma } from '@/server/db/prisma'
import type { RoleValue } from '@/server/domain/types'

export interface ProvisionInput {
  readonly name: string
  readonly email: string
  /**
   * The login this person actually types. Absent for the founding account,
   * which predates login names and signs in by email.
   */
  readonly username?: string | null
  readonly password: string
  readonly role: RoleValue
  /** Links a SALES login to a salesperson, enabling own-data scoping. */
  readonly employeeId?: string | null
}

export interface ProvisionResult {
  readonly id: string
  readonly email: string
  readonly role: RoleValue
  readonly employeeId: string | null
  readonly created: boolean
}

/**
 * Create the account if it is absent, then apply role and employee link.
 *
 * Idempotent: re-running updates the role and link without touching the
 * password, so re-seeding never silently resets someone's credential.
 *
 * Role and `employeeId` are applied HERE rather than passed through a sign-up
 * body — those fields are declared `input: false` precisely so that a client
 * cannot grant itself a role.
 */
export async function provisionUser(input: ProvisionInput): Promise<ProvisionResult> {
  const ctx = await auth.$context
  const email = input.email.toLowerCase()

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  })

  let userId = existing?.id

  if (!userId) {
    const user = await ctx.internalAdapter.createUser(
      {
        name: input.name,
        email,
        emailVerified: true,
      },
      // Provenance for better-auth's hooks: this account was created
      // administratively, not through a public sign-up.
      { method: 'admin' },
    )
    userId = user.id
  }

  /**
   * The credential account is ensured SEPARATELY from the user.
   *
   * These are two writes, and the first can succeed while the second fails —
   * which leaves a user row with no credential: an account that looks fine in
   * the users table and can never be signed into. Checking the user alone
   * meant re-running the seed skipped straight past the broken half and
   * "succeeded" without fixing anything.
   *
   * Converging on both makes provisioning genuinely idempotent from any
   * partial state.
   */
  const credential = await prisma.account.findFirst({
    where: { userId, providerId: 'credential' },
    select: { id: true },
  })

  if (!credential) {
    await ctx.internalAdapter.createAccount({
      userId,
      providerId: 'credential',
      // Required: sign-in matches on (issuer, accountId, providerId). Omitting
      // it creates a row that looks correct and can never be signed into.
      issuer: createLocalAccountIssuer('credential'),
      accountId: userId,
      password: await ctx.password.hash(input.password),
    })
  }

  const saved = await prisma.user.update({
    where: { id: userId },
    data: {
      role: input.role,
      isActive: true,
      employeeId: input.employeeId ?? null,
      // Normalised here rather than left to the plugin: the plugin normalises
      // what arrives through ITS endpoints, and this account is being created
      // administratively, around them.
      ...(input.username
        ? { username: input.username.toLowerCase(), displayUsername: input.username }
        : {}),
    },
    select: { id: true, email: true, role: true, employeeId: true },
  })

  return {
    id: saved.id,
    email: saved.email,
    role: saved.role,
    employeeId: saved.employeeId,
    created: !existing,
  }
}

/** Replace an existing account's password. Used by admin password reset. */
export async function setPassword(userId: string, password: string): Promise<void> {
  const ctx = await auth.$context
  await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(password))
}
