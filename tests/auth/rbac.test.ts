import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  PERMISSIONS,
  type Permission,
  type Principal,
  can,
  canSeeSection,
  rowScopeFor,
  scopeNeedsTeam,
  wideSectionsFor,
  widenForSection,
} from '@/server/auth/rbac'
import { defaultSectionsFor, wideSectionsToStore } from '@/lib/sections'
import type { DataScopeValue, RoleValue } from '@/server/domain/types'

/** Every permission an account with this role and scope would hold. */
function permissionsFor(role: RoleValue, dataScope: DataScopeValue = 'ALL'): readonly Permission[] {
  const probe: Principal = { userId: '', role, isActive: true, employeeId: null, dataScope, sections: [] }
  return PERMISSIONS.filter((permission) => can(probe, permission))
}

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
      expect(can(principal, 'kpi:read:all')).toBe(true)
    }
  })

  it('gives a company-wide account the lesser :own variants too', () => {
    // Withholding them would let an endpoint that asks only for `:own` reject
    // an administrator. Scoping is unaffected — it keys off `dataScope`.
    expect(can(admin, 'analytics:read:own')).toBe(true)
    expect(can(manager, 'kpi:read:own')).toBe(true)
  })

  it('withholds the :all reads from an OWN-scoped account', () => {
    expect(can(scoped, 'analytics:read:own')).toBe(true)
    expect(can(scoped, 'kpi:read:own')).toBe(true)
    expect(can(scoped, 'analytics:read:all')).toBe(false)
    expect(can(scoped, 'kpi:read:all')).toBe(false)
  })

  it('lets the role decide changes, and only changes', () => {
    // SALES is read-only; MANAGER owns the KPI plans; only ADMIN administers
    // the deployment itself.
    expect(can(manager, 'kpi:manage')).toBe(true)
    expect(can(sales, 'kpi:manage')).toBe(false)

    for (const principal of [manager, sales, scoped]) {
      expect(can(principal, 'users:manage')).toBe(false)
    }
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

/*
  PER-SECTION SCOPE (2026-10-05). A ROP reads «Tasdiqlash» for their own team
  and «RNP» for the whole company: the endpoint behind a wide screen sees an
  ALL principal, every other endpoint sees the TEAM one.
*/
describe('widenForSection', () => {
  const rop: Principal = {
    userId: 'u-rop', role: 'SALES', isActive: true, employeeId: 'emp-rop',
    dataScope: 'TEAM',
    sections: ['confirmation', 'logistics', 'sellers', 'sales', 'rnp'],
    wideSections: ['rnp', 'sellers'],
  }

  it('reads a wide screen as the whole company, and nothing else', () => {
    const onRnp = widenForSection(rop, 'rnp')
    expect(onRnp.dataScope).toBe('ALL')
    expect(onRnp.widened).toBe(true)
    expect(can(onRnp, 'analytics:read:all')).toBe(true)
    expect(rowScopeFor(onRnp).restrictToEmployeeIds).toBeNull()

    const onQueue = widenForSection(rop, 'confirmation')
    expect(onQueue.dataScope).toBe('TEAM')
    expect(can(onQueue, 'analytics:read:all')).toBe(false)
  })

  it('never widens an endpoint that belongs to no screen', () => {
    expect(widenForSection(rop, null)).toBe(rop)
  })

  /*
    `/analytics/sellers` feeds «Sotuvchilar reytingi» AND Savdo dinamikasi.
    The request does not say which screen sent it, so one wide and one narrow
    must stay narrow — or Savdo dinamikasi would read the company through it.
  */
  it('widens a shared endpoint only when every screen it feeds is wide', () => {
    expect(widenForSection(rop, ['sellers', 'sales']).dataScope).toBe('TEAM')
    expect(
      widenForSection({ ...rop, wideSections: ['sellers', 'sales'] }, ['sellers', 'sales'])
        .dataScope,
    ).toBe('ALL')
    // «Sotuvchilar reytingi» answers everybody the company, so it counts as wide.
    expect(
      widenForSection({ ...rop, wideSections: ['sales'] }, ['sellers', 'sales']).dataScope,
    ).toBe('ALL')
    // A screen the account does not hold does not count against it.
    expect(widenForSection({ ...rop, sections: ['sellers'] }, ['sellers', 'sales']).dataScope).toBe(
      'ALL',
    )
  })

  it('does nothing for a deactivated account or one with no wide screens', () => {
    expect(widenForSection({ ...rop, isActive: false }, 'rnp').dataScope).toBe('TEAM')
    expect(widenForSection({ ...rop, wideSections: undefined }, 'rnp').dataScope).toBe('TEAM')
  })

  it('counts a wide tick only on a screen the account holds', () => {
    expect(wideSectionsFor(['confirmation', 'rnp'], ['rnp', 'leads', 'nonsense'])).toEqual(['rnp'])
    expect(wideSectionsFor(['confirmation'], null)).toEqual([])
  })
})

describe('wideSectionsToStore', () => {
  it('stores only what the administrator sent, among the account’s own ticks', () => {
    expect(wideSectionsToStore(['rnp', 'logistics', 'margin'], ['confirmation', 'logistics', 'rnp'], 'TEAM')).toEqual([
      'logistics',
      'rnp',
    ])
  })

  /*
    Never added on the server: a password reset on an OWN seller whose stale
    ticks include payroll used to widen it (security review, 2026-10-05).
  */
  it('never adds a ticked company-only screen nobody sent', () => {
    expect(wideSectionsToStore([], ['payroll', 'rnp'], 'OWN')).toEqual([])
    expect(wideSectionsToStore(undefined, ['payroll', 'rnp'], 'TEAM')).toEqual([])
  })

  it('stores nothing on an ALL account and nothing for the screens open to everyone', () => {
    expect(wideSectionsToStore(['rnp'], ['rnp'], 'ALL')).toEqual([])
    expect(wideSectionsToStore(['sellers', 'structure'], ['sellers', 'structure'], 'TEAM')).toEqual([])
  })

  it('drops a wide tick whose section was unticked', () => {
    expect(wideSectionsToStore(['rnp', 'logistics'], ['logistics'], 'TEAM')).toEqual(['logistics'])
  })
})

/*
  NO PERMISSION NOBODY ASKS FOR. Six were removed on 2026-10-07 because their
  endpoints went in the 2026-09-10 cull and nothing checked them since — a
  grant that guards nothing is a rule a reviewer reasons about and no code
  enforces. Every entry must be named by a route's ACCESS, by the shared
  permission lists, or by the page guard / viewer.
*/
describe('every permission is asked for somewhere', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) return sources(path)
      return /\.tsx?$/.test(entry) ? [readFileSync(path, 'utf8')] : []
    })
  }
  const askers = [
    ...sources(join(process.cwd(), 'src/app/api/v1')),
    ...['src/server/http/permissions.ts', 'src/server/auth/pageGuard.ts', 'src/server/auth/viewer.ts'].map((p) =>
      readFileSync(join(process.cwd(), p), 'utf8'),
    ),
  ].join('\n')

  it.each(PERMISSIONS.map((p) => [p]))('%s is checked by a route, a guard or the viewer', (permission) => {
    expect(askers).toContain(`'${permission}'`)
  })
})
