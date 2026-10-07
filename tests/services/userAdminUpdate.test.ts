import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * PATCH /users/:id — what an administrator's edit does to the account.
 *
 * Two findings pinned here, both on `updateUser`:
 *  - a password reset (or a deactivation) must end the target's sessions, or
 *    the intruder whose cookie prompted the reset keeps browsing;
 *  - the edit is all-or-nothing and audited: a password used to be written
 *    first, through better-auth's adapter, and a row update that then failed
 *    (a taken employeeId → P2002 → 500) left the new password, the old role
 *    and no `passwordChanged` audit row.
 *
 * The fake database applies a transaction's writes only if the callback
 * resolves — the property Postgres gives `prisma.$transaction`.
 */

interface UserRowFake {
  id: string
  name: string
  username: string | null
  displayUsername: string | null
  email: string
  role: 'ADMIN' | 'MANAGER' | 'SALES'
  isActive: boolean
  sections: string[]
  wideSections: string[]
  dataScope: 'ALL' | 'TEAM' | 'OWN'
  employeeId: string | null
  twoFactorEnabled: boolean
  createdAt: Date
}
interface State {
  users: UserRowFake[]
  accounts: { userId: string; providerId: string; issuer: string; accountId: string; password: string }[]
  sessions: { id: string; userId: string }[]
  audit: { action: string; changes: Record<string, unknown> }[]
}

const db = vi.hoisted(() => ({
  state: null as unknown as State,
  failUserUpdate: null as Error | null,
}))

function user(id: string, extra: Partial<UserRowFake> = {}): UserRowFake {
  return {
    id,
    name: `Name ${id}`,
    username: id,
    displayUsername: id,
    email: `${id}@sinolife.local`,
    role: 'SALES',
    isActive: true,
    sections: [],
    wideSections: [],
    dataScope: 'ALL',
    employeeId: null,
    twoFactorEnabled: false,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    ...extra,
  }
}

const withEmployee = (u: UserRowFake) => ({ ...u, employee: null })

function client(state: State) {
  const findUser = (where: { id?: string; employeeId?: string }) =>
    state.users.find((u) => (where.id !== undefined ? u.id === where.id : u.employeeId === where.employeeId)) ?? null
  return {
    user: {
      findUnique: async ({ where }: { where: { id?: string; employeeId?: string } }) => {
        const u = findUser(where)
        return u ? withEmployee(u) : null
      },
      findFirst: async ({ where }: { where: { username: string; NOT: { id: string } } }) =>
        state.users.find((u) => u.username === where.username && u.id !== where.NOT.id) ?? null,
      count: async () => state.users.filter((u) => u.role === 'ADMIN' && u.isActive).length,
      update: async ({ where, data }: { where: { id: string }; data: Partial<UserRowFake> }) => {
        if (db.failUserUpdate) throw db.failUserUpdate
        const u = state.users.find((x) => x.id === where.id)!
        if (data.employeeId && state.users.some((x) => x.id !== u.id && x.employeeId === data.employeeId)) {
          throw Object.assign(new Error('Unique constraint failed on employeeId'), { code: 'P2002' })
        }
        Object.assign(u, data)
        return withEmployee(u)
      },
    },
    account: {
      updateMany: async ({ where, data }: { where: State['accounts'][number]; data: { password: string } }) => {
        const hits = state.accounts.filter(
          (a) =>
            a.userId === where.userId &&
            a.providerId === where.providerId &&
            a.issuer === where.issuer &&
            a.accountId === where.accountId,
        )
        for (const a of hits) a.password = data.password
        return { count: hits.length }
      },
    },
    session: {
      deleteMany: async ({ where }: { where: { userId: string; NOT?: { id: string } } }) => {
        const keep = state.sessions.filter((s) => s.userId !== where.userId || s.id === where.NOT?.id)
        const count = state.sessions.length - keep.length
        state.sessions = keep
        return { count }
      },
    },
    auditLog: {
      create: async ({ data }: { data: { action: string; changes: Record<string, unknown> } }) => {
        state.audit.push({ action: data.action, changes: data.changes })
        return data
      },
    },
    employee: { findUnique: async () => ({ id: 'emp', departmentId: 'd' }) },
  }
}

vi.mock('@/server/db/prisma', () => ({
  prisma: new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === '$transaction') {
          return async (work: (tx: unknown) => Promise<unknown>) => {
            const draft = structuredClone(db.state)
            const result = await work(client(draft))
            db.state = draft // commit only when the callback resolved
            return result
          }
        }
        return (client(db.state) as Record<string, unknown>)[prop as string]
      },
    },
  ),
}))

vi.mock('@/server/auth/provisioning', () => ({
  provisionUser: async () => {
    throw new Error('not used')
  },
  hashPassword: async (password: string) => `hash(${password})`,
  // The old, non-transactional path: written straight through, as
  // better-auth's adapter did. Present so the suite can show what it caught.
  setPassword: async (userId: string, password: string) => {
    for (const a of db.state.accounts) if (a.userId === userId) a.password = `hash(${password})`
  },
  credentialWhere: (userId: string) => ({
    userId,
    providerId: 'credential',
    issuer: 'local:credential',
    accountId: userId,
  }),
}))

vi.mock('@/server/services/container', () => ({ scopeRepository: {} }))

const { updateUser } = await import('@/server/services/userAdminService')
const { ApiError } = await import('@/server/http/errors')

const AUDIT = { ip: null, userAgent: null }

beforeEach(() => {
  db.failUserUpdate = null
  db.state = {
    users: [user('admin', { role: 'ADMIN' }), user('x'), user('y', { employeeId: 'emp-y' })],
    accounts: ['admin', 'x', 'y'].map((id) => ({
      userId: id,
      providerId: 'credential',
      issuer: 'local:credential',
      accountId: id,
      password: `hash(old-${id})`,
    })),
    sessions: [
      { id: 's-admin', userId: 'admin' },
      { id: 's-admin-phone', userId: 'admin' },
      { id: 's-x-laptop', userId: 'x' },
      { id: 's-x-stolen', userId: 'x' },
      { id: 's-y', userId: 'y' },
    ],
    audit: [],
  }
})

const passwordOf = (id: string) => db.state.accounts.find((a) => a.userId === id)?.password
const sessionsOf = (id: string) => db.state.sessions.filter((s) => s.userId === id).map((s) => s.id)

describe('an administrator resets a password', () => {
  it("ends every one of the target's sessions and audits it", async () => {
    await updateUser('admin', 'x', { password: 'yangi-parol-77' }, AUDIT, 's-admin')

    expect(passwordOf('x')).toBe('hash(yangi-parol-77)')
    expect(sessionsOf('x')).toEqual([])
    expect(sessionsOf('y')).toEqual(['s-y'])
    expect(db.state.audit).toHaveLength(1)
    expect(db.state.audit[0].changes).toMatchObject({ passwordChanged: true, sessionsRevoked: 2 })
  })

  it('keeps the editor signed in when they reset their own password here', async () => {
    await updateUser('admin', 'admin', { password: 'yangi-parol-77' }, AUDIT, 's-admin')
    expect(sessionsOf('admin')).toEqual(['s-admin'])
  })

  it('leaves sessions alone on an edit that is neither', async () => {
    await updateUser('admin', 'x', { name: 'Dilnoza Karimova' }, AUDIT, 's-admin')
    expect(sessionsOf('x')).toEqual(['s-x-laptop', 's-x-stolen'])
    expect(db.state.audit[0].changes).toMatchObject({ passwordChanged: false, sessionsRevoked: 0 })
  })
})

describe('an administrator deactivates an account', () => {
  it('ends its sessions, so reactivating it later revives none', async () => {
    await updateUser('admin', 'x', { isActive: false }, AUDIT, 's-admin')
    expect(sessionsOf('x')).toEqual([])
    expect(db.state.users.find((u) => u.id === 'x')?.isActive).toBe(false)
  })
})

describe('an edit that cannot be saved', () => {
  it('refuses an employee who already has a login BEFORE anything is written', async () => {
    const attempt = updateUser('admin', 'x', { employeeId: 'emp-y', password: 'yangi-parol-77' }, AUDIT, 's-admin')

    await expect(attempt).rejects.toBeInstanceOf(ApiError)
    await expect(attempt).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(passwordOf('x')).toBe('hash(old-x)')
    expect(sessionsOf('x')).toEqual(['s-x-laptop', 's-x-stolen'])
    expect(db.state.audit).toEqual([])
  })

  it("re-saving the account's own employee is not a clash", async () => {
    await updateUser('admin', 'y', { employeeId: 'emp-y', name: 'Y' }, AUDIT, 's-admin')
    expect(db.state.users.find((u) => u.id === 'y')?.name).toBe('Y')
  })

  it('changes nothing at all when the row update fails after the checks', async () => {
    db.failUserUpdate = new Error('connection reset')
    await expect(
      updateUser('admin', 'x', { password: 'yangi-parol-77', role: 'MANAGER' }, AUDIT, 's-admin'),
    ).rejects.toThrow('connection reset')

    expect(passwordOf('x')).toBe('hash(old-x)')
    expect(sessionsOf('x')).toEqual(['s-x-laptop', 's-x-stolen'])
    expect(db.state.users.find((u) => u.id === 'x')?.role).toBe('SALES')
    expect(db.state.audit).toEqual([])
  })

  it('refuses rather than audit a password change with no credential row to change', async () => {
    db.state.accounts = db.state.accounts.filter((a) => a.userId !== 'x')
    await expect(updateUser('admin', 'x', { password: 'yangi-parol-77' }, AUDIT, 's-admin')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    expect(db.state.audit).toEqual([])
    expect(sessionsOf('x')).toEqual(['s-x-laptop', 's-x-stolen'])
  })
})
