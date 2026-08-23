import { describe, expect, it } from 'vitest'

import {
  PERMISSIONS,
  type Permission,
  type Principal,
  can,
  canViewEmployee,
  dealScopeFor,
  permissionsFor,
} from '@/server/auth/rbac'

const admin: Principal = { userId: 'u1', role: 'ADMIN', isActive: true, employeeId: null }
const manager: Principal = { userId: 'u2', role: 'MANAGER', isActive: true, employeeId: null }
const sales: Principal = { userId: 'u3', role: 'SALES', isActive: true, employeeId: 'emp-1' }

describe('the permission matrix', () => {
  it('gives ADMIN everything', () => {
    for (const permission of PERMISSIONS) {
      expect(can(admin, permission)).toBe(true)
    }
  })

  it('lets MANAGER read company-wide analytics', () => {
    expect(can(manager, 'analytics:read:all')).toBe(true)
    expect(can(manager, 'deals:read:all')).toBe(true)
    expect(can(manager, 'finance:read')).toBe(true)
  })

  it('gives a superior role the lesser :own variants too', () => {
    // Withholding them would let an endpoint that asks only for `:own` reject
    // an administrator. Scoping is unaffected — it keys off the `:all` grant.
    expect(can(admin, 'analytics:read:own')).toBe(true)
    expect(can(manager, 'deals:read:own')).toBe(true)
  })

  it('still leaves ADMIN and MANAGER unscoped despite holding :own', () => {
    expect(dealScopeFor(admin)).toEqual({})
    expect(dealScopeFor(manager)).toEqual({})
  })

  it('does not let MANAGER run a sync or manage users', () => {
    expect(can(manager, 'sync:run')).toBe(false)
    expect(can(manager, 'users:manage')).toBe(false)
    expect(can(manager, 'kpi:manage')).toBe(false)
  })

  it('limits SALES to their own data', () => {
    expect(can(sales, 'analytics:read:own')).toBe(true)
    expect(can(sales, 'deals:read:own')).toBe(true)
    expect(can(sales, 'analytics:read:all')).toBe(false)
    expect(can(sales, 'deals:read:all')).toBe(false)
  })

  it('does not let SALES see finance or other employees in detail', () => {
    expect(can(sales, 'finance:read')).toBe(false)
    expect(can(sales, 'employees:read:detail')).toBe(false)
  })

  it('still lets SALES see the leaderboard', () => {
    // A ranking each person can only see themselves in is not a ranking.
    expect(can(sales, 'leaderboard:read')).toBe(true)
  })

  it('grants no ADMIN-only permission to any lesser role', () => {
    const adminOnly: Permission[] = ['users:manage', 'sync:run', 'kpi:manage']
    for (const permission of adminOnly) {
      expect(can(manager, permission)).toBe(false)
      expect(can(sales, permission)).toBe(false)
    }
  })

  it('never grants a permission outside the declared list', () => {
    for (const role of ['ADMIN', 'MANAGER', 'SALES'] as const) {
      for (const permission of permissionsFor(role)) {
        expect(PERMISSIONS).toContain(permission)
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

  it('are scoped to nothing', () => {
    const disabled: Principal = { ...admin, isActive: false }
    expect(dealScopeFor(disabled).restrictToEmployeeId).toBeDefined()
  })
})

describe('deal scoping', () => {
  it('does not restrict ADMIN or MANAGER', () => {
    expect(dealScopeFor(admin)).toEqual({})
    expect(dealScopeFor(manager)).toEqual({})
  })

  it('restricts SALES to their linked employee', () => {
    expect(dealScopeFor(sales)).toEqual({ restrictToEmployeeId: 'emp-1' })
  })

  it('fails CLOSED for a SALES account with no linked employee', () => {
    // The dangerous bug would be returning {} here — an unlinked salesperson
    // would silently see the whole company. A sentinel that matches no row is
    // the safe reading of "we do not know whose deals these are".
    const unlinked: Principal = { ...sales, employeeId: null }
    const scope = dealScopeFor(unlinked)

    expect(scope.restrictToEmployeeId).toBeDefined()
    expect(scope.restrictToEmployeeId).not.toBe('')
    expect(scope).not.toEqual({})
  })
})

describe('employee detail visibility', () => {
  it('lets a manager view anyone', () => {
    expect(canViewEmployee(manager, 'emp-9')).toBe(true)
  })

  it('lets a salesperson view only themselves', () => {
    expect(canViewEmployee(sales, 'emp-1')).toBe(true)
    expect(canViewEmployee(sales, 'emp-2')).toBe(false)
  })

  it('does not let a deactivated manager view anyone', () => {
    expect(canViewEmployee({ ...manager, isActive: false }, 'emp-9')).toBe(false)
  })
})
