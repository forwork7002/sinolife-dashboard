import { describe, expect, it } from 'vitest'

import {
  BRANCH_ALL,
  BranchDirectory,
  type BranchEmployeeRow,
  type BranchGraph,
  NO_EMPLOYEE_IN_SCOPE,
  UnknownBranchError,
  branchRequestFrom,
  buildBranchSnapshot,
  intersectEmployeeScope,
  narrowEmployeeIds,
  resolveBranchScope,
  scopedPeriod,
} from '@/server/domain/employees/branches'

/**
 * The portal's real tree, shrunk.
 *
 * Same shape as the live one — a root, two branches with sales teams under
 * them, two top-level departments with none, people at BOTH depths — because
 * every interesting case in this resolver is a shape case. The `branchId` /
 * `branchName` columns are what the recursive CTE stamps on each row, so a
 * fixture is allowed to state them directly.
 */
const ROOT = { id: 'd0', name: 'NEWGEN' }
const NAVOIY = { id: 'd1', name: 'Навоий' }
const TOSHKENT = { id: 'd2', name: 'Тошкент онлайн' }
const OPERATSION = { id: 'd3', name: 'Операцион' }
const REGISTRATSIYA = { id: 'd4', name: 'Регистрация' }

const graph: BranchGraph = {
  departments: [
    { id: ROOT.id, name: ROOT.name, branchId: null, branchName: null },
    { id: NAVOIY.id, name: NAVOIY.name, branchId: NAVOIY.id, branchName: NAVOIY.name },
    { id: TOSHKENT.id, name: TOSHKENT.name, branchId: TOSHKENT.id, branchName: TOSHKENT.name },
    {
      id: OPERATSION.id,
      name: OPERATSION.name,
      branchId: OPERATSION.id,
      branchName: OPERATSION.name,
    },
    {
      id: REGISTRATSIYA.id,
      name: REGISTRATSIYA.name,
      branchId: REGISTRATSIYA.id,
      branchName: REGISTRATSIYA.name,
    },
    { id: 'n1', name: 'Sevinch(ROP)', branchId: NAVOIY.id, branchName: NAVOIY.name },
    { id: 'n2', name: 'Lola(ROP)', branchId: NAVOIY.id, branchName: NAVOIY.name },
    { id: 't1', name: 'Asliddin(ROP)', branchId: TOSHKENT.id, branchName: TOSHKENT.name },
  ],
  employees: [
    person('e1', 'n1', 'Sevinch(ROP)', NAVOIY),
    person('e2', 'n1', 'Sevinch(ROP)', NAVOIY, { isDepartmentHead: true }),
    // The seven people the one-level lookup gets wrong: filed in the BRANCH
    // itself, not in one of its teams.
    person('e3', NAVOIY.id, NAVOIY.name, NAVOIY),
    person('e4', 't1', 'Asliddin(ROP)', TOSHKENT),
    person('e5', TOSHKENT.id, TOSHKENT.name, TOSHKENT),
    person('e6', OPERATSION.id, OPERATSION.name, OPERATSION),
    person('e7', REGISTRATSIYA.id, REGISTRATSIYA.name, REGISTRATSIYA),
    // Filed directly in the root: the company centre, "markaz".
    { ...person('e8', ROOT.id, ROOT.name, null), sitsInRoot: true },
    // Filed nowhere at all.
    person('e9', null, null, null),
  ],
}

function person(
  id: string,
  departmentId: string | null,
  departmentName: string | null,
  branch: { id: string; name: string } | null,
  extra: { isDepartmentHead?: boolean } = {},
): BranchEmployeeRow {
  return {
    id,
    departmentId,
    departmentName,
    branchId: branch?.id ?? null,
    branchName: branch?.name ?? null,
    sitsInRoot: false,
    isDepartmentHead: extra.isDepartmentHead ?? false,
  }
}

const snapshot = buildBranchSnapshot(graph)

describe('what counts as a branch', () => {
  it('finds the top-level units that have sales teams under them', () => {
    expect(snapshot.branches.map((b) => b.name)).toEqual([NAVOIY.name, TOSHKENT.name])
  })

  it('leaves the top-level units that sell nothing out of the branch list', () => {
    // Операцион and Регистрация sit at the same level as the two filials and
    // are functions, not places. They are named in the excluded block instead —
    // Операцион closed 12.6% of last month's revenue and must be disclosed,
    // never silently dropped.
    expect(snapshot.units.map((u) => u.name)).toEqual([OPERATSION.name, REGISTRATSIYA.name])
    expect(snapshot.branches.map((b) => b.name)).not.toContain(OPERATSION.name)
  })

  it('counts the sales teams under each branch', () => {
    expect(snapshot.branches.map((b) => [b.name, b.teamCount])).toEqual([
      [NAVOIY.name, 2],
      [TOSHKENT.name, 1],
    ])
  })
})

describe('membership at every depth', () => {
  it('claims the people filed in the branch itself, not only in its teams', () => {
    // This is the whole reason the resolver is a tree walk. A `parent.name`
    // lookup answers "NEWGEN" for e3 and e5 and quietly moves them into the
    // company centre.
    expect(snapshot.employeeIdsByBranch.get('навоий')).toEqual(['e1', 'e2', 'e3'])
    expect(snapshot.employeeIdsByBranch.get('тошкент онлайн')).toEqual(['e4', 'e5'])
  })

  it('counts sellers with the sellers rule, so a ROP is not one', () => {
    // e2 heads Sevinch(ROP) and e3 sits in the branch office: neither sells.
    expect(snapshot.branches[0]).toMatchObject({ headcount: 3, sellerCount: 1 })
    expect(snapshot.branches[1]).toMatchObject({ headcount: 2, sellerCount: 1 })
  })

  it('separates the root-dwellers from the people filed nowhere', () => {
    expect(snapshot.centreHeadcount).toBe(1)
    expect(snapshot.unassignedHeadcount).toBe(1)
    expect(snapshot.orphanHeadcount).toBe(0)
  })

  it('splits the roster into buckets that are exhaustive and disjoint', () => {
    // The property `scripts/verifyBranchScope.ts` then checks against the deal
    // ledger: if the buckets do not cover everyone, no total they produce can
    // be trusted to sum to the unscoped one.
    const seen = new Set<string>()
    for (const bucket of snapshot.buckets) {
      for (const id of bucket.employeeIds) {
        expect(seen.has(id), `${id} counted twice`).toBe(false)
        seen.add(id)
      }
    }
    expect(seen.size).toBe(snapshot.totalHeadcount)
    expect(snapshot.buckets.map((b) => b.label)).toEqual([
      NAVOIY.name,
      TOSHKENT.name,
      OPERATSION.name,
      REGISTRATSIYA.name,
      'markaz',
      'boʻlimsiz',
      'yoʻqolgan boʻlim',
    ])
  })

  it('accounts for every employee exactly once', () => {
    const inBranches = snapshot.branches.reduce((sum, b) => sum + b.headcount, 0)
    const inUnits = snapshot.units.reduce((sum, u) => sum + u.headcount, 0)
    expect(
      inBranches +
        inUnits +
        snapshot.centreHeadcount +
        snapshot.unassignedHeadcount +
        snapshot.orphanHeadcount,
    ).toBe(snapshot.totalHeadcount)
    expect(snapshot.totalHeadcount).toBe(9)
  })
})

describe('reading ?filial=', () => {
  it('treats an absent value as the default branch, never as everything', () => {
    expect(branchRequestFrom(undefined, NAVOIY.name)).toEqual({
      kind: 'branch',
      name: NAVOIY.name,
    })
    expect(branchRequestFrom('', NAVOIY.name)).toEqual({ kind: 'branch', name: NAVOIY.name })
    expect(branchRequestFrom('   ', NAVOIY.name)).toEqual({ kind: 'branch', name: NAVOIY.name })
  })

  it('opens up to every branch only when asked in the URL', () => {
    expect(branchRequestFrom(BRANCH_ALL, NAVOIY.name)).toEqual({ kind: 'all' })
    expect(branchRequestFrom('ALL', NAVOIY.name)).toEqual({ kind: 'all' })
  })

  it('passes a named branch through, trimmed', () => {
    expect(branchRequestFrom('  Тошкент онлайн ', NAVOIY.name)).toEqual({
      kind: 'branch',
      name: 'Тошкент онлайн',
    })
  })
})

describe('resolving the scope', () => {
  it('narrows to the branch and states what it left out', () => {
    const resolved = resolveBranchScope(snapshot, { kind: 'branch', name: NAVOIY.name })

    expect(resolved.employeeIds).toEqual(['e1', 'e2', 'e3'])
    expect(resolved.branchDepartmentId).toBe(NAVOIY.id)
    expect(resolved.meta).toEqual({
      branch: NAVOIY.name,
      employees: 3,
      excluded: {
        otherBranches: 2,
        operations: 1,
        registration: 1,
        centre: 1,
        other: 1,
        total: 6,
      },
    })
  })

  it('makes the block add up to the whole roster', () => {
    // The property that makes it worth printing: a reader can see where the
    // other people went instead of wondering whether the total is broken.
    for (const branch of snapshot.branches) {
      const { meta } = resolveBranchScope(snapshot, { kind: 'branch', name: branch.name })
      expect(meta.employees + meta.excluded.total).toBe(snapshot.totalHeadcount)
    }
  })

  it('restricts nothing when the caller asked for every branch', () => {
    const resolved = resolveBranchScope(snapshot, { kind: 'all' })
    expect(resolved.employeeIds).toBeNull()
    expect(resolved.meta.branch).toBeNull()
    expect(resolved.meta.employees).toBe(snapshot.totalHeadcount)
    expect(resolved.meta.excluded.total).toBe(0)
  })

  it('tolerates the hand-typed spelling of a branch name', () => {
    const resolved = resolveBranchScope(snapshot, { kind: 'branch', name: '  навоий ' })
    expect(resolved.meta.branch).toBe(NAVOIY.name)
  })

  it('refuses an unknown branch instead of showing the whole company', () => {
    // A typo in the URL must be a 400. Falling back to "everything" would put
    // 16.08 mlrd on a page headed with a branch that does not exist.
    let thrown: unknown
    try {
      resolveBranchScope(snapshot, { kind: 'branch', name: 'Samarqand' })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(UnknownBranchError)
    expect((thrown as UnknownBranchError).known).toEqual([NAVOIY.name, TOSHKENT.name])
  })
})

describe('intersecting with the authorisation scope', () => {
  it('leaves an unrestricted caller with the branch', () => {
    expect(intersectEmployeeScope(['e1', 'e2'], undefined)).toEqual(['e1', 'e2'])
  })

  it('leaves a SALES caller pinned to themselves when no branch is active', () => {
    expect(intersectEmployeeScope(null, ['e1'])).toEqual(['e1'])
  })

  it('narrows a SALES caller to themselves INSIDE their branch, never to it', () => {
    // The rule that must never invert: two restrictions narrow. A union would
    // hand a salesperson their whole branch.
    expect(intersectEmployeeScope(['e1', 'e2', 'e3'], ['e1'])).toEqual(['e1'])
  })

  it('narrows a TEAM caller to the part of their team inside the branch', () => {
    /*
      The authorisation scope is a LIST now, because a ROP is fifteen people.
      A team that straddles two filials must come back as the members of the
      one being viewed — not the whole team (a union, which widens) and not the
      whole branch (dropping the auth side, which widens further).
    */
    expect(intersectEmployeeScope(['e1', 'e2', 'e3'], ['e2', 'e9'])).toEqual(['e2'])
  })

  it('yields nobody when the two restrictions disagree', () => {
    // A Тошкент salesperson opening the Навоий view sees nothing — not their
    // own numbers under someone else's heading.
    expect(intersectEmployeeScope(['e1', 'e2'], ['e4'])).toEqual([NO_EMPLOYEE_IN_SCOPE])
    // And a whole team on the wrong side of the boundary, likewise.
    expect(intersectEmployeeScope(['e1', 'e2'], ['e4', 'e5'])).toEqual([NO_EMPLOYEE_IN_SCOPE])
  })

  it('never produces an empty list', () => {
    // Every repository tests id lists with `?.length`, so an empty array reads
    // as "no filter" and widens the query to the whole company.
    const cases = [
      intersectEmployeeScope(['e1'], ['e4']),
      intersectEmployeeScope(['e1'], ['e4', 'e5']),
      resolveBranchScope(snapshot, { kind: 'branch', name: TOSHKENT.name }, ['e1']).employeeIds,
      narrowEmployeeIds(['e4'], ['e1', 'e2']),
    ]
    for (const ids of cases) {
      expect(ids).not.toBeNull()
      expect(ids!.length).toBeGreaterThan(0)
    }
  })
})

describe('narrowing a caller-supplied employee filter', () => {
  it('keeps the request when nothing is scoped', () => {
    expect(narrowEmployeeIds(['e4'], null)).toEqual(['e4'])
  })

  it('falls back to the scope when the caller asked for nobody in particular', () => {
    expect(narrowEmployeeIds(undefined, ['e1', 'e2'])).toEqual(['e1', 'e2'])
    expect(narrowEmployeeIds([], ['e1', 'e2'])).toEqual(['e1', 'e2'])
  })

  it('keeps only the overlap', () => {
    expect(narrowEmployeeIds(['e1', 'e4'], ['e1', 'e2', 'e3'])).toEqual(['e1'])
  })
})

describe('the scoped window the insights SQL receives', () => {
  const period = {
    preset: 'this_month' as const,
    start: new Date('2026-08-01T00:00:00.000Z'),
    end: new Date('2026-09-01T00:00:00.000Z'),
    timeZone: 'Asia/Tashkent',
    days: 31,
  }

  it('carries the ids alongside the window', () => {
    const window = scopedPeriod(period, { restrictToEmployeeIds: ['e1'] })
    expect(window.start).toEqual(period.start)
    expect(window.restrictToEmployeeIds).toEqual(['e1'])
  })

  it('says null rather than undefined when nothing is scoped', () => {
    // The SQL tests `IS NULL`; an absent key and a null one must not be two
    // different states by the time they reach a query.
    expect(scopedPeriod(period, {}).restrictToEmployeeIds).toBeNull()
  })
})

describe('the cache in front of the tree', () => {
  function directory(ttlMs: number) {
    let now = 0
    let loads = 0
    const dir = new BranchDirectory(
      async () => {
        loads += 1
        return graph
      },
      ttlMs,
      () => now,
    )
    return {
      dir,
      loads: () => loads,
      advance: (ms: number) => {
        now += ms
      },
    }
  }

  it('reads the tree once per TTL, not once per request', async () => {
    const { dir, loads, advance } = directory(60_000)

    await dir.snapshot()
    await dir.snapshot()
    advance(59_000)
    await dir.snapshot()
    expect(loads()).toBe(1)

    advance(2_000)
    await dir.snapshot()
    expect(loads()).toBe(2)
  })

  it('shares one load between concurrent callers', async () => {
    const { dir, loads } = directory(60_000)
    await Promise.all([dir.snapshot(), dir.snapshot(), dir.snapshot()])
    expect(loads()).toBe(1)
  })

  it('reloads after an explicit invalidation', async () => {
    const { dir, loads } = directory(60_000)
    await dir.snapshot()
    dir.invalidate()
    await dir.snapshot()
    expect(loads()).toBe(2)
  })

  it('does not pin a failure in front of every later request', async () => {
    let attempt = 0
    const dir = new BranchDirectory(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('connection lost')
      return graph
    })

    await expect(dir.snapshot()).rejects.toThrow('connection lost')
    await expect(dir.snapshot()).resolves.toMatchObject({ totalHeadcount: 9 })
  })
})
