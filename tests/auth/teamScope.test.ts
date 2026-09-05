import { describe, expect, it } from 'vitest'

import { type Principal } from '@/server/auth/rbac'
import { ScopeRepository } from '@/server/repositories/scopeRepository'
import { ScopeService } from '@/server/services/scopeService'
import { defaultSectionsFor } from '@/lib/sections'

/**
 * Who a TEAM-scoped account may read.
 *
 * The client's request in their own words: «ROP Asliddin bersam shu faqat
 * uzini malumotlarini korishi kerak umumiy emas» — a team head reads their own
 * floor, not the firm's. `dataScope` could previously say "the company" or
 * "one person", and a ROP is neither.
 *
 * Two things are pinned here and they fail in opposite directions. The SQL
 * decides who is IN the team, and getting it wrong shows a ROP somebody else's
 * money. The memo decides how long that answer is reused, and a key that
 * omitted the employee would serve one account another account's scope — not a
 * stale answer, the WRONG one.
 */

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: 'u1',
    role: 'SALES',
    isActive: true,
    employeeId: 'emp-rop',
    dataScope: 'TEAM',
    sections: defaultSectionsFor('SALES'),
    ...overrides,
  }
}

/** Captures the statement and answers with whatever the test set up. */
function fakePrisma(rowsByEmployee: Record<string, string[]>) {
  const calls: { sql: string; employeeId: string }[] = []
  const prisma = {
    $queryRawUnsafe: async (sql: string, employeeId: string) => {
      calls.push({ sql, employeeId })
      return (rowsByEmployee[employeeId] ?? []).map((id) => ({ id }))
    },
  }
  return { prisma, calls }
}

function serviceFor(rowsByEmployee: Record<string, string[]>) {
  const { prisma, calls } = fakePrisma(rowsByEmployee)
  const repository = new ScopeRepository(prisma as never)
  return { service: new ScopeService(repository), calls }
}

describe('the team query', () => {
  it('reads both the unit they are filed in and the units they head', async () => {
    const { service, calls } = serviceFor({ 'emp-rop': ['emp-a'] })
    await service.resolve(principal())
    const sql = calls[0]!.sql

    /*
      Two arms, and the second is not redundant. «Навоий» names a head whose
      own units are «Kompaniya(ROP)» and «Тошкент онлайн» — the portal draws
      that card with no head row because his record does not sit in the unit he
      runs. Reading membership alone would hand that man his own team and not
      the branch he leads.
    */
    expect(sql).toContain('e."departmentId"')
    expect(sql).toContain('d."headId" = $1')
  })

  it('descends from HEADSHIP only, never from being filed in a unit', () => {
    /*
      The difference decides whether an ordinary registrar filed in «Тошкент
      онлайн» — a unit with nine teams under it — reads their own desk or the
      whole floor. Being filed somewhere says where your work is counted; it
      does not say you run what sits beneath it. The recursion therefore hangs
      off the headship arm, and the membership arm is unioned in flat
      afterwards.
    */
    const { service, calls } = serviceFor({ 'emp-rop': [] })
    void service.resolve(principal())

    return service.resolve(principal()).then(() => {
      const sql = calls[0]!.sql
      expect(sql).toContain('WITH RECURSIVE headed AS (')
      // The recursive step joins the HEADED set, not a set that includes the
      // membership. Swapping these is a silent widening, not an error.
      expect(sql).toContain('JOIN headed h ON child."parentId" = h.id')
      expect(sql).not.toMatch(/JOIN (anchor|scope) \w+ ON child\."parentId"/)
    })
  })

  it('terminates on a cycle rather than recursing forever', async () => {
    // Nothing in the schema forbids a department being its own ancestor.
    // UNION de-duplicates and stops; UNION ALL would not.
    const { service, calls } = serviceFor({ 'emp-rop': [] })
    await service.resolve(principal())

    expect(calls[0]!.sql).not.toContain('UNION ALL')
  })

  it('reads the PRIMARY unit, never department_member', async () => {
    /*
      The one substitution that would produce a plausible wrong answer instead
      of an error. `department_member` holds every unit Bitrix24 lists a person
      in — nine of this portal's active people sit in two — and it exists for
      the org chart, which counts a person in each. This is a MONEY question:
      every analytic credits a person to exactly one unit, so reading
      memberships here would put one operator's orders on two ROPs' boards,
      each reading them as their own team's work.
    */
    const { service, calls } = serviceFor({ 'emp-rop': [] })
    await service.resolve(principal())

    expect(calls[0]!.sql).toContain(`e."departmentId" IN (SELECT id FROM scope)`)
    expect(calls[0]!.sql).not.toContain('department_member')
  })

  it('asks for the team once and reuses it inside the minute', async () => {
    const { service, calls } = serviceFor({ 'emp-rop': ['emp-a'] })
    const at = new Date('2026-09-05T10:00:00.000Z')

    await service.resolve(principal(), at)
    await service.resolve(principal(), new Date(at.getTime() + 30_000))

    // `/meta/alerts` alone is one request per page per minute; a recursive
    // query per request would be paid on every screen.
    expect(calls).toHaveLength(1)
  })

  it('asks again once the memo is older than the sync tick it follows', async () => {
    const { service, calls } = serviceFor({ 'emp-rop': ['emp-a'] })
    const at = new Date('2026-09-05T10:00:00.000Z')

    await service.resolve(principal(), at)
    await service.resolve(principal(), new Date(at.getTime() + 61_000))

    expect(calls).toHaveLength(2)
  })

  it('NEVER serves one account another account\'s team', async () => {
    /*
      The dangerous half of a memo, and the reason the key is the employee id
      and nothing shorter. A key that omitted it would not return a slightly
      stale scope — it would return somebody else's, which is a data leak with
      a cache in front of it.
    */
    const { service } = serviceFor({ 'emp-rop': ['emp-a'], 'emp-two': ['emp-z'] })
    const at = new Date('2026-09-05T10:00:00.000Z')

    const first = await service.resolve(principal(), at)
    const second = await service.resolve(principal({ employeeId: 'emp-two' }), at)

    expect(first.restrictToEmployeeIds).toContain('emp-a')
    expect(first.restrictToEmployeeIds).not.toContain('emp-z')
    expect(second.restrictToEmployeeIds).toContain('emp-z')
    expect(second.restrictToEmployeeIds).not.toContain('emp-a')
  })

  it('does not cache a failure', async () => {
    /*
      Caching a rejection turns one bad minute into sixty seconds of them — and
      here "bad" means every screen comes back empty, which reads as "you have
      no data" rather than "we could not tell".
    */
    let attempts = 0
    const prisma = {
      $queryRawUnsafe: async () => {
        attempts += 1
        throw new Error('connection lost')
      },
    }
    const service = new ScopeService(new ScopeRepository(prisma as never))
    const at = new Date('2026-09-05T10:00:00.000Z')

    await expect(service.resolve(principal(), at)).rejects.toThrow()
    await expect(service.resolve(principal(), at)).rejects.toThrow()

    expect(attempts).toBe(2)
  })
})

describe('what the other scopes cost', () => {
  it('spends no query on a company-wide account', async () => {
    const { service, calls } = serviceFor({})
    const scope = await service.resolve(principal({ dataScope: 'ALL' }))

    expect(scope.restrictToEmployeeIds).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('spends no query on an OWN-scoped account', async () => {
    const { service, calls } = serviceFor({})
    const scope = await service.resolve(principal({ dataScope: 'OWN' }))

    expect(scope.restrictToEmployeeIds).toEqual(['emp-rop'])
    expect(calls).toHaveLength(0)
  })

  it('fails closed for a TEAM account with nobody linked, and asks nothing', async () => {
    // A provisioning mistake the admin screen refuses to create. Querying for
    // a null id would be the shape that eventually returns everybody.
    const { service, calls } = serviceFor({})
    const scope = await service.resolve(principal({ employeeId: null }))

    expect(scope.restrictToEmployeeIds).toEqual(['__no_employee_linked__'])
    expect(calls).toHaveLength(0)
  })

  it('leaves a deactivated ROP with nothing, not with everything', async () => {
    const { service } = serviceFor({ 'emp-rop': ['emp-a'] })
    const scope = await service.resolve(principal({ isActive: false }))

    expect(scope.restrictToEmployeeIds).toEqual(['emp-rop'])
  })
})
