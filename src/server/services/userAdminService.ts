/**
 * Account administration.
 *
 * The only place accounts are created, re-roled, re-scoped or disabled from
 * inside the running application. It exists so the rules below live once
 * rather than once per route:
 *
 *   - a password must pass the same policy the sign-in path enforces;
 *   - nobody may change their OWN role or disable themselves, because an
 *     administrator who does it by accident locks the whole company out of
 *     user management and there is no second door;
 *   - the LAST active administrator cannot be demoted or disabled, for the
 *     same reason and with no way to undo it from the UI;
 *   - every change is written to the audit log with a before/after diff, and
 *     the diff never contains a password.
 *
 * Deactivating rather than deleting is the default on purpose: `can()` already
 * strips every permission from an inactive account, so disabling takes effect
 * immediately while keeping the audit trail's actor references intact.
 */

import { checkPassword } from '@/lib/passwordPolicy'
import { SECTION_IDS, type SectionValue } from '@/lib/sections'
import { prisma } from '@/server/db/prisma'
import type { RoleValue } from '@/server/domain/types'
import { ApiError } from '@/server/http/errors'
import { provisionUser, setPassword } from '@/server/auth/provisioning'

export interface UserRow {
  readonly id: string
  readonly name: string
  /** What this person types to sign in. Null on the founding email account. */
  readonly username: string | null
  readonly email: string
  readonly role: RoleValue
  readonly isActive: boolean
  readonly sections: readonly SectionValue[]
  readonly employeeId: string | null
  readonly employeeName: string | null
  readonly twoFactorEnabled: boolean
  readonly createdAt: string
}

const SELECT = {
  id: true,
  name: true,
  username: true,
  displayUsername: true,
  email: true,
  role: true,
  isActive: true,
  sections: true,
  employeeId: true,
  twoFactorEnabled: true,
  createdAt: true,
  employee: { select: { fullName: true } },
} as const

function toRow(u: {
  id: string
  name: string
  username: string | null
  displayUsername: string | null
  email: string
  role: RoleValue
  isActive: boolean
  sections: string[]
  employeeId: string | null
  twoFactorEnabled: boolean
  createdAt: Date
  employee: { fullName: string } | null
}): UserRow {
  return {
    id: u.id,
    name: u.name,
    // The administrator's own casing, so a login typed "Dilnoza" reads back
    // that way even though it matches case-insensitively.
    username: u.displayUsername ?? u.username,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    // Raw, NOT resolved through the role fallback: this screen edits what is
    // STORED, and showing the fallback here would make an unconfigured account
    // look configured — the admin would then "save" the defaults and freeze
    // them, so the account stops following its role.
    sections: u.sections.filter((s): s is SectionValue =>
      (SECTION_IDS as readonly string[]).includes(s),
    ),
    employeeId: u.employeeId,
    employeeName: u.employee?.fullName ?? null,
    twoFactorEnabled: u.twoFactorEnabled,
    createdAt: u.createdAt.toISOString(),
  }
}

export async function listUsers(): Promise<UserRow[]> {
  const users = await prisma.user.findMany({
    select: SELECT,
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
  })
  return users.map(toRow)
}

/** How many administrators could still sign in. Guards every demotion. */
async function activeAdminCount(): Promise<number> {
  return prisma.user.count({ where: { role: 'ADMIN', isActive: true } })
}

function assertPassword(password: string, email: string, name: string): void {
  const check = checkPassword(password, { email, name })
  if (!check.ok) {
    throw ApiError.validation('Parol talablarga javob bermaydi.', [
      { path: 'password', message: check.problems.join(' ') },
    ])
  }
}

function cleanSections(sections: readonly string[] | undefined): string[] {
  if (!sections) return []
  // Deduplicated and filtered to ids that still exist, so a stale name in a
  // request body cannot sit in the column granting nothing and confusing the
  // next reader.
  return [...new Set(sections.filter((s) => (SECTION_IDS as readonly string[]).includes(s)))]
}

/**
 * The domain synthesised emails hang off.
 *
 * `.local` is reserved and unroutable by design — nothing can ever be
 * delivered to these addresses, which is the point: they exist to satisfy
 * better-auth's unique-email column, not to be written to.
 */
const SYNTHETIC_EMAIL_DOMAIN = 'sinolife.local'

export interface CreateInput {
  readonly name: string
  /** The login the person will type. */
  readonly username: string
  readonly password: string
  readonly role: RoleValue
  readonly sections?: readonly string[]
  readonly employeeId?: string | null
}

export async function createUser(
  actorUserId: string,
  input: CreateInput,
  audit: { ip: string | null; userAgent: string | null },
): Promise<UserRow> {
  const username = input.username.trim()
  const key = username.toLowerCase()
  assertPassword(input.password, username, input.name)

  const email = `${key}@${SYNTHETIC_EMAIL_DOMAIN}`
  const existing = await prisma.user.findFirst({
    where: { OR: [{ username: key }, { email }] },
    select: { id: true },
  })
  if (existing) {
    throw ApiError.validation('Bu login allaqachon band.', [
      { path: 'username', message: 'Boshqa login tanlang.' },
    ])
  }

  const result = await provisionUser({
    name: input.name,
    email,
    username,
    password: input.password,
    role: input.role,
    employeeId: input.employeeId ?? null,
  })

  const saved = await prisma.user.update({
    where: { id: result.id },
    data: { sections: cleanSections(input.sections) },
    select: SELECT,
  })

  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: 'user.create',
      entity: 'user',
      entityId: saved.id,
      // The password is deliberately absent — an audit trail that records
      // credentials is a credential store nobody meant to build.
      changes: {
        after: {
          username: saved.username,
          role: saved.role,
          sections: saved.sections,
          employeeId: saved.employeeId,
        },
      },
      ipAddress: audit.ip,
      userAgent: audit.userAgent,
    },
  })

  return toRow(saved)
}

export interface UpdateInput {
  readonly name?: string
  /** A new login. Changing it changes what this person types to sign in. */
  readonly username?: string
  readonly role?: RoleValue
  readonly isActive?: boolean
  readonly sections?: readonly string[]
  readonly employeeId?: string | null
  readonly password?: string
}

export async function updateUser(
  actorUserId: string,
  targetId: string,
  input: UpdateInput,
  audit: { ip: string | null; userAgent: string | null },
): Promise<UserRow> {
  const before = await prisma.user.findUnique({ where: { id: targetId }, select: SELECT })
  if (!before) throw ApiError.notFound('Bunday hisob topilmadi.')

  const isSelf = targetId === actorUserId

  // Self-lockout guards. An administrator who removes their own last power has
  // no way back in through the UI, and this deployment has no second admin
  // channel to recover through.
  if (isSelf && input.role !== undefined && input.role !== before.role) {
    throw ApiError.forbidden('Oʻz rolingizni oʻzgartira olmaysiz.')
  }
  if (isSelf && input.isActive === false) {
    throw ApiError.forbidden('Oʻz hisobingizni faolsizlantira olmaysiz.')
  }

  const losesAdmin =
    before.role === 'ADMIN' &&
    ((input.role !== undefined && input.role !== 'ADMIN') || input.isActive === false)

  if (losesAdmin && (await activeAdminCount()) <= 1) {
    throw ApiError.forbidden(
      'Bu yagona faol administrator. Avval boshqa birovga administrator huquqini bering.',
    )
  }

  /*
    A NEW LOGIN, which is a bigger change than it looks.

    It is what the person types to sign in, so it has to stay unique, and the
    synthesised email has to follow it — an account created as
    `dilnoza@sinolife.local` whose login became `dilnozak` would keep an email
    that no longer names it, and the next admin reading the table would not be
    able to tell which was current.

    A REAL email is left alone. The founding administrator signs in with a
    genuine address; rewriting it to `<login>@sinolife.local` would break the
    one account that can create the others.
  */
  let nextEmail: string | undefined
  if (input.username !== undefined) {
    const username = input.username.trim()
    const key = username.toLowerCase()

    if (!/^[a-zA-Z0-9._-]+$/.test(username) || key.length < 3 || key.length > 32) {
      throw ApiError.validation('Login notoʻgʻri.', [
        { path: 'username', message: '3–32 belgi; harf, raqam, nuqta, chiziqcha.' },
      ])
    }

    const clash = await prisma.user.findFirst({
      where: { username: key, NOT: { id: targetId } },
      select: { id: true },
    })
    if (clash) {
      throw ApiError.validation('Bu login allaqachon band.', [
        { path: 'username', message: 'Boshqa login tanlang.' },
      ])
    }

    if (before.email.endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`)) {
      nextEmail = `${key}@${SYNTHETIC_EMAIL_DOMAIN}`
    }
  }

  if (input.password !== undefined) {
    assertPassword(input.password, input.username ?? before.username ?? before.email, input.name ?? before.name)
    await setPassword(targetId, input.password)
  }

  const after = await prisma.user.update({
    where: { id: targetId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.username !== undefined
        ? {
            username: input.username.trim().toLowerCase(),
            displayUsername: input.username.trim(),
          }
        : {}),
      ...(nextEmail !== undefined ? { email: nextEmail } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.sections !== undefined ? { sections: cleanSections(input.sections) } : {}),
      ...(input.employeeId !== undefined ? { employeeId: input.employeeId } : {}),
    },
    select: SELECT,
  })

  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: 'user.update',
      entity: 'user',
      entityId: targetId,
      changes: {
        before: {
          name: before.name,
          username: before.username,
          role: before.role,
          isActive: before.isActive,
          sections: before.sections,
          employeeId: before.employeeId,
        },
        after: {
          name: after.name,
          username: after.username,
          role: after.role,
          isActive: after.isActive,
          sections: after.sections,
          employeeId: after.employeeId,
        },
        // Recorded as a fact, never as a value.
        passwordChanged: input.password !== undefined,
      },
      ipAddress: audit.ip,
      userAgent: audit.userAgent,
    },
  })

  return toRow(after)
}

/**
 * Remove an account for good.
 *
 * Deactivating is still the gentler default and stays the recommended move —
 * it revokes every permission immediately while leaving the person's history
 * legible. Deletion exists for the case deactivation cannot serve: an account
 * created by mistake, or a login that must stop existing rather than merely
 * stop working.
 *
 * The same two lockout guards apply as for demotion, for the same reason:
 * there is no way back into user management from inside the product once the
 * last administrator is gone.
 *
 * Sessions and credentials go with it — `session` and `account` cascade on the
 * user, so a deleted person cannot keep browsing on a live cookie. The audit
 * trail does NOT: `auditLog.actorUserId` is ON DELETE SET NULL, so what they
 * did remains recorded even though who they were no longer resolves. Losing
 * the record of a change because the account that made it was removed would
 * make the log worthless precisely when it matters.
 */
export async function deleteUser(
  actorUserId: string,
  targetId: string,
  audit: { ip: string | null; userAgent: string | null },
): Promise<{ id: string }> {
  const before = await prisma.user.findUnique({ where: { id: targetId }, select: SELECT })
  if (!before) throw ApiError.notFound('Bunday hisob topilmadi.')

  if (targetId === actorUserId) {
    throw ApiError.forbidden('Oʻz hisobingizni oʻchira olmaysiz.')
  }
  if (before.role === 'ADMIN' && before.isActive && (await activeAdminCount()) <= 1) {
    throw ApiError.forbidden(
      'Bu yagona faol administrator. Avval boshqa birovga administrator huquqini bering.',
    )
  }

  // Written BEFORE the delete: afterwards the row is gone and there is nothing
  // left to describe.
  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: 'user.delete',
      entity: 'user',
      entityId: targetId,
      changes: {
        before: {
          name: before.name,
          username: before.username,
          role: before.role,
          isActive: before.isActive,
          sections: before.sections,
        },
      },
      ipAddress: audit.ip,
      userAgent: audit.userAgent,
    },
  })

  await prisma.user.delete({ where: { id: targetId } })

  return { id: targetId }
}
