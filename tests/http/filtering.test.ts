import { describe, expect, it } from 'vitest'

import { dealScopeFor, type Principal } from '@/server/auth/rbac'
import { dealsQuerySchema, searchParamsToObject } from '@/server/http/queryParams'

/**
 * Query-contract and scoping tests.
 *
 * These cover the composition that route handlers perform — spreading the
 * authorisation scope over the parsed query — without needing a database. The
 * property that matters is that scope always wins, whatever the caller sent.
 */

const sales: Principal = {
  userId: 'u1',
  role: 'SALES',
  isActive: true,
  employeeId: 'emp-own',
  dataScope: 'OWN',
  sections: [],
}

const manager: Principal = {
  userId: 'u2',
  role: 'MANAGER',
  isActive: true,
  employeeId: null,
  dataScope: 'ALL',
  sections: [],
}

/** Mirrors what every route handler does: parsed query, then scope on top. */
function buildFilters(queryString: string, principal: Principal) {
  const query = dealsQuerySchema.parse(
    searchParamsToObject(new URLSearchParams(queryString)),
  )
  return { ...query, ...dealScopeFor(principal) }
}

describe('scope composition in route handlers', () => {
  it('pins an OWN-scoped caller to their own employee id', () => {
    const filters = buildFilters('preset=this_month', sales)
    expect(filters.restrictToEmployeeId).toBe('emp-own')
  })

  it('keeps the restriction even when the caller names another employee', () => {
    // The whole point of spreading scope LAST: a hand-crafted query string
    // must not be able to widen what the caller can see.
    const filters = buildFilters('employeeIds=emp-other,emp-third', sales)
    expect(filters.restrictToEmployeeId).toBe('emp-own')
    // The requested filter survives, but it narrows within the scope — the
    // repository ANDs both clauses, so the result is the empty intersection.
    expect(filters.employeeIds).toEqual(['emp-other', 'emp-third'])
  })

  it('leaves a company-wide caller unrestricted', () => {
    const filters = buildFilters('employeeIds=emp-other', manager)
    expect(filters.restrictToEmployeeId).toBeUndefined()
    expect(filters.employeeIds).toEqual(['emp-other'])
  })

  it('restricts a deactivated caller to nothing', () => {
    const filters = buildFilters('', { ...manager, isActive: false })
    expect(filters.restrictToEmployeeId).toBeDefined()
  })
})

describe('filter parsing end to end', () => {
  it('parses a realistic dashboard query string', () => {
    const filters = buildFilters(
      'preset=custom&from=2026-08-01&to=2026-08-23&employeeIds=a,b&stageIds=s1&status=WON&q=Oq+Yo%CA%BBl&page=2&pageSize=50&sort=amountMinor&order=asc',
      manager,
    )

    expect(filters.preset).toBe('custom')
    expect(filters.from?.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(filters.employeeIds).toEqual(['a', 'b'])
    expect(filters.stageIds).toEqual(['s1'])
    expect(filters.status).toBe('WON')
    expect(filters.q).toBe('Oq Yoʻl')
    expect(filters.page).toBe(2)
    expect(filters.pageSize).toBe(50)
    expect(filters.sort).toBe('amountMinor')
    expect(filters.order).toBe('asc')
  })

  it('rejects a sort column outside the allowlist', () => {
    // An arbitrary sort column is an information leak, so it is enumerated
    // rather than passed through.
    expect(() => buildFilters('sort=passwordHash', manager)).toThrow()
    expect(() => buildFilters('sort=user.email', manager)).toThrow()
  })

  it('rejects a page size large enough to pull the whole table', () => {
    expect(() => buildFilters('pageSize=100000', manager)).toThrow()
  })

  it('rejects an unknown status rather than ignoring it', () => {
    // Silently dropping it would return unfiltered data under a filter label.
    expect(() => buildFilters('status=PENDING', manager)).toThrow()
  })

  it('rejects a custom range with no bounds', () => {
    expect(() => buildFilters('preset=custom', manager)).toThrow()
  })

  it('trims and bounds free-text search', () => {
    expect(buildFilters('q=%20%20Oq%20%20', manager).q).toBe('Oq')
    expect(() => buildFilters(`q=${'x'.repeat(200)}`, manager)).toThrow()
  })

  it('applies defaults for an empty query string', () => {
    const filters = buildFilters('', manager)
    expect(filters.preset).toBe('today')
    expect(filters.page).toBe(1)
    expect(filters.pageSize).toBe(25)
    expect(filters.order).toBe('desc')
    expect(filters.employeeIds).toBeUndefined()
  })
})
