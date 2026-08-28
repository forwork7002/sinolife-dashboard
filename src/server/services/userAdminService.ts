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

export interface CreateInput {
  readonly name: string
  readonly email: string
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
  assertPassword(input.password, input.email, input.name)

  const email = input.email.toLowerCase()
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (existing) {
    throw ApiError.validation('Bu email allaqachon band.', [
      { path: 'email', message: 'Bunday hisob mavjud.' },
    ])
  }

  const result = await provisionUser({
    name: input.name,
    email,
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
          email: saved.email,
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

  if (input.password !== undefined) {
    assertPassword(input.password, before.email, input.name ?? before.name)
    await setPassword(targetId, input.password)
  }

  const after = await prisma.user.update({
    where: { id: targetId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
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
          role: before.role,
          isActive: before.isActive,
          sections: before.sections,
          employeeId: before.employeeId,
        },
        after: {
          name: after.name,
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
