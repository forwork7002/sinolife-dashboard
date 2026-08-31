import { describe, expect, it } from 'vitest'

import {
  PERMISSIONS,
  type Principal,
  can,
  canSeeSection,
  canViewEmployee,
  dealScopeFor,
  permissionsFor,
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
    expect(dealScopeFor({ ...admin, isActive: false }).restrictToEmployeeId).toBeDefined()
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
    expect(dealScopeFor(admin)).toEqual({})
    expect(dealScopeFor(manager)).toEqual({})
    expect(dealScopeFor(sales)).toEqual({})
  })

  it('restricts an OWN-scoped account to its linked employee', () => {
    expect(dealScopeFor(scoped)).toEqual({ restrictToEmployeeId: 'emp-1' })
  })

  it('fails CLOSED for an OWN-scoped account with no linked employee', () => {
    // The dangerous bug would be returning {} here — an unlinked account would
    // silently see the whole company. A sentinel that matches no row is the
    // safe reading of "we do not know whose deals these are". The admin screen
    // refuses to save this pairing; the policy still has to hold if it appears.
    const unlinked: Principal = { ...scoped, employeeId: null }
    const scope = dealScopeFor(unlinked)

    expect(scope.restrictToEmployeeId).toBeDefined()
    expect(scope.restrictToEmployeeId).not.toBe('')
    expect(scope).not.toEqual({})
  })

  it('does not scope a read-only account that was never narrowed', () => {
    // The exact account the old model broke: created SALES, no employee link,
    // six sections ticked — and every figure blank.
    expect(dealScopeFor({ ...sales, employeeId: null })).toEqual({})
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
})
