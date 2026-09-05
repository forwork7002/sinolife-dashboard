import { describe, expect, it } from 'vitest'

import {
  PERMISSIONS,
  type Principal,
  can,
  canSeeSection,
  canViewEmployee,
  permissionsFor,
  rowScopeFor,
  scopeNeedsTeam,
} from '@/server/auth/rbac'
import { defaultSectionsFor } from '@/lib/sections'

/*
  Fixtures across BOTH axes, because the two are independent now.

  `sales` and `scoped` share a role and differ only in data scope, which is the
  distinction the old matrix could not express: a read-only account that still
  sees the company's numbers on the screens it was given.

  Sections carry the role default, which is what an account nobody has
  configured actually holds — a fixture with an empty list would be a user who
  can open nothing, and no such user exists.
*/
const admin: Principal = {
  userId: 'u1', role: 'ADMIN', isActive: true, employeeId: null,
  dataScope: 'ALL', sections: defaultSectionsFor('ADMIN'),
}
const manager: Principal = {
  userId: 'u2', role: 'MANAGER', isActive: true, employeeId: null,
  dataScope: 'ALL', sections: defaultSectionsFor('MANAGER'),
}
const sales: Principal = {
  userId: 'u3', role: 'SALES', isActive: true, employeeId: null,
  dataScope: 'ALL', sections: defaultSectionsFor('SALES'),
}
const scoped: Principal = {
  userId: 'u4', role: 'SALES', isActive: true, employeeId: 'emp-1',
  dataScope: 'OWN', sections: defaultSectionsFor('SALES'),
}
/* A ROP: one linked employee, and the whole unit under them to read. */
const team: Principal = {
  userId: 'u5', role: 'SALES', isActive: true, employeeId: 'emp-1',
  dataScope: 'TEAM', sections: defaultSectionsFor('SALES'),
}

describe('the permission matrix', () => {
  it('gives ADMIN everything', () => {
    for (const permission of PERMISSIONS) {
      expect(can(admin, permission)).toBe(true)
    }
  })

  it('lets any company-wide account read company-wide analytics', () => {
    // The bug this replaces: reading was a role question, so the only account
    // that saw the company was one that could also administer it.
    for (const principal of [manager, sales]) {
      expect(can(principal, 'analytics:read:all')).toBe(true)
      expect(can(principal, 'deals:read:all')).toBe(true)
      expect(can(principal, 'finance:read')).toBe(true)
    }
  })

  it('gives a company-wide account the lesser :own variants too', () => {
    // Withholding them would let an endpoint that asks only for `:own` reject
    // an administrator. Scoping is unaffected — it keys off `dataScope`.
    expect(can(admin, 'analytics:read:own')).toBe(true)
    expect(can(manager, 'deals:read:own')).toBe(true)
  })

  it('withholds the :all reads from an OWN-scoped account', () => {
    expect(can(scoped, 'analytics:read:own')).toBe(true)
    expect(can(scoped, 'deals:read:own')).toBe(true)
    expect(can(scoped, 'analytics:read:all')).toBe(false)
    expect(can(scoped, 'deals:read:all')).toBe(false)
    expect(can(scoped, 'finance:read')).toBe(false)
  })

  it('lets the role decide changes, and only changes', () => {
    // SALES is read-only; MANAGER owns the KPI plans; only ADMIN administers
    // the deployment itself.
    expect(can(manager, 'kpi:manage')).toBe(true)
    expect(can(sales, 'kpi:manage')).toBe(false)

    for (const principal of [manager, sales, scoped]) {
      expect(can(principal, 'users:manage')).toBe(false)
      expect(can(principal, 'sync:run')).toBe(false)
    }
  })

  it('does not let a read-only account look an employee up in detail', () => {
    expect(can(sales, 'employees:read:detail')).toBe(false)
    expect(can(manager, 'employees:read:detail')).toBe(true)
  })

  it('still lets every account see the leaderboard', () => {
    // A ranking each person can only see themselves in is not a ranking.
    expect(can(scoped, 'leaderboard:read')).toBe(true)
  })

  it('never grants a permission outside the declared list', () => {
    for (const role of ['ADMIN', 'MANAGER', 'SALES'] as const) {
      for (const scope of ['ALL', 'OWN'] as const) {
        for (const permission of permissionsFor(role, scope)) {
          expect(PERMISSIONS).toContain(permission)
        }
      }
    }
  })

  it('never gives an OWN-scoped account more than the same role gets at ALL', () => {
    for (const role of ['ADMIN', 'MANAGER', 'SALES'] as const) {
      const wide = permissionsFor(role, 'ALL')
      for (const permission of permissionsFor(role, 'OWN')) {
        expect(wide).toContain(permission)
      }
    }
  })
})

describe('deactivated accounts', () => {
  it('lose every permission while keeping their role', () => {
    // Disabling a user must take effect without deleting anything.
    const disabled: Principal = { ...admin, isActive: false }
    for (const permission of PERMISSIONS) {
      expect(can(disabled, permission)).toBe(false)
    }
  })

  it('are scoped to nothing rather than to everything', () => {
    expect(rowScopeFor({ ...admin, isActive: false }).restrictToEmployeeIds).not.toBeNull()
  })

  it('can open no section', () => {
    const disabled: Principal = { ...admin, isActive: false }
    for (const section of admin.sections) {
      expect(canSeeSection(disabled, section)).toBe(false)
    }
  })
})

describe('section reach', () => {
  it('grants exactly what was ticked', () => {
    const granted: Principal = { ...sales, sections: ['logistics'] }
    expect(canSeeSection(granted, 'logistics')).toBe(true)
    expect(canSeeSection(granted, 'margin')).toBe(false)
  })
})

describe('deal scoping', () => {
  it('does not restrict a company-wide account, whatever its role', () => {
    expect(rowScopeFor(admin)).toEqual({ restrictToEmployeeIds: null })
    expect(rowScopeFor(manager)).toEqual({ restrictToEmployeeIds: null })
    expect(rowScopeFor(sales)).toEqual({ restrictToEmployeeIds: null })
  })

  it('restricts an OWN-scoped account to its linked employee', () => {
    expect(rowScopeFor(scoped)).toEqual({ restrictToEmployeeIds: ['emp-1'] })
  })

  it('fails CLOSED for an OWN-scoped account with no linked employee', () => {
    // The dangerous bug would be returning null here — an unlinked account
    // would silently see the whole company. A sentinel that matches no row is
    // the safe reading of "we do not know whose deals these are". The admin
    // screen refuses to save this pairing; the policy still has to hold if it
    // appears.
    const unlinked: Principal = { ...scoped, employeeId: null }
    const scope = rowScopeFor(unlinked)

    expect(scope.restrictToEmployeeIds).not.toBeNull()
    expect(scope.restrictToEmployeeIds).toHaveLength(1)
    expect(scope.restrictToEmployeeIds?.[0]).not.toBe('')
  })

  it('does not scope a read-only account that was never narrowed', () => {
    // The exact account the old model broke: created SALES, no employee link,
    // six sections ticked — and every figure blank.
    expect(rowScopeFor({ ...sales, employeeId: null })).toEqual({
      restrictToEmployeeIds: null,
    })
  })
})

describe('team scoping', () => {
  it('says a TEAM account needs its subtree resolved, and the others do not', () => {
    // What tells the handler whether to spend a query. ALL and OWN are decided
    // by the session row alone.
    expect(scopeNeedsTeam(team)).toBe(true)
    expect(scopeNeedsTeam(scoped)).toBe(false)
    expect(scopeNeedsTeam(admin)).toBe(false)
    // A disabled ROP resolves nothing and still fails closed below.
    expect(scopeNeedsTeam({ ...team, isActive: false })).toBe(false)
  })

  it('reads its whole unit, and itself with it', () => {
    const scope = rowScopeFor(team, ['emp-2', 'emp-3'])

    expect(scope.restrictToEmployeeIds).toContain('emp-2')
    expect(scope.restrictToEmployeeIds).toContain('emp-3')
    // The reader is always in their own scope. A ROP whose unit was renamed
    // out from under them still owns their own rows, and a board missing them
    // reads as "you have never sold anything" rather than as a tree problem.
    expect(scope.restrictToEmployeeIds).toContain('emp-1')
  })

  it('does not repeat the reader when the subtree already names them', () => {
    // The ids reach SQL as a list; a duplicate is harmless but says the set
    // was built by concatenation rather than by union, which is the shape that
    // eventually double-counts something.
    const ids = rowScopeFor(team, ['emp-1', 'emp-2']).restrictToEmployeeIds ?? []
    expect(ids.filter((id) => id === 'emp-1')).toHaveLength(1)
  })

  it('THROWS rather than widen when the subtree was never resolved', () => {
    /*
      The failure this whole mechanism is built against: a new call site that
      forgets to resolve the team. Returning "the company" there would be a ROP
      reading every other team's money and nothing on screen saying so, so the
      policy refuses to answer at all. Loud beats wrong.
    */
    expect(() => rowScopeFor(team)).toThrow(/TEAM principal/)
  })

  it('fails CLOSED for a TEAM account whose unit resolved to nobody', () => {
    // An employee the portal has filed nowhere. The scope collapses to that
    // one person — never to everybody.
    expect(rowScopeFor(team, [])).toEqual({ restrictToEmployeeIds: ['emp-1'] })
  })

  it('fails CLOSED for a TEAM account with no linked employee', () => {
    const unlinked: Principal = { ...team, employeeId: null }
    const ids = rowScopeFor(unlinked, []).restrictToEmployeeIds

    expect(ids).not.toBeNull()
    expect(ids).toHaveLength(1)
    expect(ids?.[0]).toBe('__no_employee_linked__')
  })
})

describe('employee detail visibility', () => {
  it('lets a manager view anyone', () => {
    expect(canViewEmployee(manager, 'emp-9')).toBe(true)
  })

  it('lets a read-only account view only its own linked employee', () => {
    expect(canViewEmployee(scoped, 'emp-1')).toBe(true)
    expect(canViewEmployee(scoped, 'emp-2')).toBe(false)
  })

  it('does not let a deactivated manager view anyone', () => {
    expect(canViewEmployee({ ...manager, isActive: false }, 'emp-9')).toBe(false)
  })

  it('lets a ROP open the cards on the board they were given', () => {
    // Otherwise the team board a ROP is allowed to read links to fifteen
    // refusals — the drill-down is how the row is used.
    const scope = rowScopeFor(team, ['emp-2', 'emp-3'])
    expect(canViewEmployee(team, 'emp-2', scope)).toBe(true)
    expect(canViewEmployee(team, 'emp-9', scope)).toBe(false)
  })

  it('does NOT let a narrowed MANAGER outrank their own scope', () => {
    /*
      The scope has to be asked BEFORE the role. `employees:read:detail` is a
      role permission every MANAGER holds unconditionally, and MANAGER is the
      plausible configuration for a ROP — it is the role that carries
      `kpi:manage`, and the ROPs own the KPI plans. Asking for the permission
      first meant a ROP scoped to one team could open any card in the company.
    */
    const ropManager: Principal = { ...manager, dataScope: 'TEAM', employeeId: 'emp-1' }
    const scope = rowScopeFor(ropManager, ['emp-2'])

    expect(canViewEmployee(ropManager, 'emp-2', scope)).toBe(true)
    expect(canViewEmployee(ropManager, 'emp-9', scope)).toBe(false)
    // Their own card, always.
    expect(canViewEmployee(ropManager, 'emp-1', scope)).toBe(true)
  })

  it('fails closed when a caller forgets to pass the scope', () => {
    // "We were not told" reads as "nothing but themselves", never as "anyone".
    const ropManager: Principal = { ...manager, dataScope: 'TEAM', employeeId: 'emp-1' }
    expect(canViewEmployee(ropManager, 'emp-9')).toBe(false)
    // A company-wide manager is unchanged: null scope, role decides.
    expect(canViewEmployee(manager, 'emp-9')).toBe(true)
  })
})
