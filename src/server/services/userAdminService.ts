/**
 * Account administration.
 *
 * The only place accounts are created, re-roled, re-scoped or disabled from
 * inside the running application. It exists so the rules below live once
 * rather than once per route:
 *
 *   - a password must pass the same policy the sign-in path enforces;
 *   - a data scope must be one an account can actually be served: OWN needs a
 *     linked employee that exists, or the account opens every screen it was
 *     given and finds all of them empty;
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
import type { DataScopeValue, RoleValue } from '@/server/domain/types'
import { ApiError } from '@/server/http/errors'
import { provisionUser, setPassword } from '@/server/auth/provisioning'
import {
  type DepartmentHead,
  type HeadlessUnit,
  departmentHeads,
  headlessUnits,
} from '@/server/domain/employees/departmentHeads'
import { rowScopeFor } from '@/server/auth/rbac'
import { scopeRepository } from '@/server/services/container'

export interface UserRow {
  readonly id: string
  readonly name: string
  /** What this person types to sign in. Null on the founding email account. */
  readonly username: string | null
  readonly email: string
  readonly role: RoleValue
  readonly isActive: boolean
  readonly sections: readonly SectionValue[]
  /** How much of each granted section this account reads. */
  readonly dataScope: DataScopeValue
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
  dataScope: true,
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
  dataScope: DataScopeValue
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
    dataScope: u.dataScope,
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

/**
 * A head, with the size of the scope they would carry.
 *
 * `teamSize` is the only thing this adds to the domain shape, and it is the
 * one figure that cannot be worked out from the tree alone without writing a
 * second definition of who is on a team.
 */
export interface DepartmentHeadRow extends DepartmentHead {
  /** How many employees «Faqat oʻz boʻlimi» actually resolves to for them. */
  readonly teamSize: number
}

/**
 * The people a «Faqat oʻz boʻlimi» account can honestly be anchored to.
 *
 * WHY A SECOND LIST AND NOT THE ROSTER. The account form's employee picker
 * offers all 289 people, which is right for a company-wide or an OWN account —
 * either can be linked to anybody. A TEAM account cannot. Its scope is grown
 * from the department tree, so somebody the portal filed nowhere and who heads
 * nothing anchors on nothing, and `assertScopeIsUsable` refuses to save them.
 * Offering the whole roster for that one choice is offering mostly wrong
 * answers in an unsearchable dropdown, which is what the floor asked us to
 * stop doing.
 *
 * THE TEAM SIZE IS ASKED OF THE REAL RESOLVER, ONE HEAD AT A TIME. It could be
 * counted from the tree in a dozen lines beside the rest of the shaping, and
 * that would be a SECOND definition of who is on a team — the failure this
 * codebase pays for most often, because two definitions agree until the day
 * they do not and neither of them errors. `ScopeRepository.teamEmployeeIds` is
 * the definition; this asks it. Roughly nineteen recursive queries on a portal
 * with twenty departments, on a screen only an administrator opens and only on
 * the tab that needs them — which is why the route takes `?include=heads`
 * rather than answering with this every minute.
 *
 * The count includes INACTIVE employees, because the scope does: their past
 * orders are still the team's, and a number here that disagreed with the board
 * the account then opens would be worse than a number that needs a caption.
 */
export interface DepartmentHeadsPayload {
  readonly heads: readonly DepartmentHeadRow[]
  /** Units nobody heads, so the administrator knows why one is missing. */
  readonly headless: readonly HeadlessUnit[]
}

export async function listDepartmentHeads(): Promise<DepartmentHeadsPayload> {
  const [units, headed] = await Promise.all([
    // The whole tree, for the descendant count. Twenty rows on this portal.
    prisma.department.findMany({ select: { id: true, name: true, parentId: true } }),
    prisma.department.findMany({
      /*
        NO `isActive` FILTER, deliberately, and it is the scope's own rule
        rather than a preference. `ScopeRepository` includes inactive units and
        inactive people on purpose — their orders are still the team's — so a
        list that hid them here would offer a reach smaller than the grant it
        then makes. The dropdown habit of filtering `isActive` belongs to
        `findDepartments`, which feeds filters, not to a scope preview.
      */
      where: { headId: { not: null } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        head: {
          select: {
            id: true,
            fullName: true,
            isActive: true,
            department: { select: { name: true } },
            user: {
              select: {
                id: true,
                username: true,
                displayUsername: true,
                isActive: true,
                dataScope: true,
                sections: true,
              },
            },
          },
        },
      },
    }),
  ])

  const headedInput = headed.map((unit) => ({
      id: unit.id,
      name: unit.name,
      head: unit.head
        ? {
            id: unit.head.id,
            fullName: unit.head.fullName,
            isActive: unit.head.isActive,
            homeDepartmentName: unit.head.department?.name ?? null,
            account: unit.head.user
              ? {
                  id: unit.head.user.id,
                  // The administrator's own casing, exactly as `toRow` reads it.
                  username: unit.head.user.displayUsername ?? unit.head.user.username,
                  isActive: unit.head.user.isActive,
                  dataScope: unit.head.user.dataScope,
                  sections: unit.head.user.sections.filter((section): section is SectionValue =>
                    (SECTION_IDS as readonly string[]).includes(section),
                  ),
                }
              : null,
          }
        : null,
  }))

  const rows = departmentHeads(units, headedInput)

  const sized = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      /*
        THE NUMBER THE REQUEST PATH WOULD PRODUCE, NOT A COUNT OF THE QUERY.

        `teamEmployeeIds` answers "who is in the tree beneath this person";
        `rowScopeFor` is what turns that into a scope, and it adds the reader
        themself unconditionally — a head the portal filed nowhere is not in
        their own query's answer but is certainly in their own scope. Counting
        the raw rows would print one less than the account gets for exactly the
        people whose record is odd enough to be worth checking. Running the
        real function over the real answer costs one Set and cannot drift.
      */
      teamSize: (rowScopeFor(
        {
          userId: '',
          role: 'SALES',
          isActive: true,
          employeeId: row.employeeId,
          dataScope: 'TEAM',
          sections: [],
        },
        await scopeRepository.teamEmployeeIds(row.employeeId),
      ).restrictToEmployeeIds ?? []).length,
    })),
  )

  return { heads: sized, headless: headlessUnits(units, headedInput) }
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
 * A scope that resolves to nothing is a mistake, not a setting.
 *
 * OWN means "this person's own records", which needs a person. Stored without
 * one it produces exactly the failure this whole field was added to remove:
 * an account that opens every screen it was given and finds all of them
 * blank. Refusing at the door, with the field named, is the only version of
 * this the administrator can act on.
 *
 * The employee is also checked to EXIST. A stale id pasted from somewhere
 * else would otherwise sail through the foreign key as `SetNull` on delete
 * and leave the same silent blank behind.
 */
async function assertScopeIsUsable(
  dataScope: DataScopeValue,
  employeeId: string | null,
): Promise<void> {
  if (dataScope === 'ALL') return

  if (!employeeId) {
    throw ApiError.validation('Bu doira uchun xodim bogʻlanishi kerak.', [
      {
        path: 'employeeId',
        message:
          dataScope === 'TEAM'
            ? '«Faqat oʻz boʻlimi» uchun xodimni tanlang — boʻlim oʻsha xodimdan topiladi.'
            : '«Faqat oʻz natijalari» uchun xodimni tanlang — aks holda hisob hech nima koʻrmaydi.',
      },
    ])
  }

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, departmentId: true, heads: { select: { id: true }, take: 1 } },
  })
  if (!employee) {
    throw ApiError.validation('Bunday xodim topilmadi.', [
      { path: 'employeeId', message: 'Roʻyxatdan xodim tanlang.' },
    ])
  }

  /*
    A TEAM SCOPE NEEDS A TEAM, AND THIS IS THE ONLY MOMENT ANYONE WILL NOTICE.

    The scope is grown from the department tree: the unit this person is filed
    in, plus any unit they HEAD, plus everything under either. Somebody the
    portal has filed nowhere and who heads nothing anchors on nothing, so the
    scope collapses to that one person — an account labelled «Faqat oʻz
    boʻlimi» that behaves as «Faqat oʻz natijalari» and reads one row where a
    ROP expected fifteen.

    Refused at the door with the field named, exactly as the missing link
    above is, because the alternative is an administrator who saves it, hands
    over the password, and hears about it from the floor a day later. The head
    check is a `take: 1` on the reverse relation — this asks whether ANY unit
    names them, not which one.
  */
  if (dataScope === 'TEAM' && !employee.departmentId && employee.heads.length === 0) {
    throw ApiError.validation('Bu xodim hech qaysi boʻlimda emas.', [
      {
        path: 'employeeId',
        message:
          'Boʻlim doirasi uchun xodim boʻlimga biriktirilgan yoki boʻlim rahbari boʻlishi kerak.',
      },
    ])
  }
}

/**
 * One employee, one login — refused BEFORE anything is written.
 *
 * `user.employeeId` is `@unique`, and `provisionUser` writes it in its third
 * statement, after `createUser` and `createAccount` have already committed. So
 * picking somebody who already has a login produced a Prisma `P2002` that
 * nothing in this codebase translates — a 500 to the administrator — while
 * leaving behind a real, signable account with no username, role SALES and
 * scope ALL. A half-made account nobody meant to create is a worse outcome
 * than any error message.
 *
 * Named here rather than caught afterwards because the caller can act on it:
 * the answer is "edit that account", and this says whose it is.
 */
async function assertEmployeeIsFree(employeeId: string | null): Promise<void> {
  if (!employeeId) return

  const taken = await prisma.user.findUnique({
    where: { employeeId },
    select: { name: true, username: true, displayUsername: true },
  })
  if (!taken) return

  const login = taken.displayUsername ?? taken.username
  throw ApiError.validation('Bu xodimga allaqachon hisob ochilgan.', [
    {
      path: 'employeeId',
      message: login
        ? `Mavjud hisob: ${taken.name} (${login}). Uni tahrirlang yoki boshqa xodimni tanlang.`
        : `Mavjud hisob: ${taken.name}. Uni tahrirlang yoki boshqa xodimni tanlang.`,
    },
  ])
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
  /** Defaults to ALL — a new account is meant to see what it was given. */
  readonly dataScope?: DataScopeValue
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

  const dataScope: DataScopeValue = input.dataScope ?? 'ALL'
  await assertScopeIsUsable(dataScope, input.employeeId ?? null)
  await assertEmployeeIsFree(input.employeeId ?? null)

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
    data: { sections: cleanSections(input.sections), dataScope },
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
          dataScope: saved.dataScope,
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
  readonly dataScope?: DataScopeValue
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

  /*
    Validated against the RESULT of the patch, not the request.

    A body that only flips the scope to OWN still has to be judged with the
    employee link already on the row, and a body that only clears the link has
    to be judged against the scope already stored. Checking either field on its
    own lets the pair drift into the unusable combination one edit at a time.
  */
  await assertScopeIsUsable(
    input.dataScope ?? before.dataScope,
    input.employeeId !== undefined ? input.employeeId : before.employeeId,
  )

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
      ...(input.dataScope !== undefined ? { dataScope: input.dataScope } : {}),
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
          dataScope: before.dataScope,
          employeeId: before.employeeId,
        },
        after: {
          name: after.name,
          username: after.username,
          role: after.role,
          isActive: after.isActive,
          sections: after.sections,
          dataScope: after.dataScope,
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
          dataScope: before.dataScope,
        },
      },
      ipAddress: audit.ip,
      userAgent: audit.userAgent,
    },
  })

  await prisma.user.delete({ where: { id: targetId } })

  return { id: targetId }
}
