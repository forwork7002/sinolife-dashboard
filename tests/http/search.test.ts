import { describe, expect, it } from 'vitest'

import { defaultSectionsFor } from '@/lib/sections'
import { rowScopeFor, type Principal } from '@/server/auth/rbac'
import type { SearchRepository, SearchResults } from '@/server/repositories/searchRepository'
import { SearchService } from '@/server/services/searchService'

/**
 * The one box that crosses every screen.
 *
 * Which is exactly why it is worth testing: navigation is gated by section,
 * and a search that ignored those gates would be the way around them. The
 * cases below are about who may see WHAT, not about how the SQL finds it.
 */

const EMPTY: SearchResults = {
  deals: [],
  customers: [],
  employees: [],
  products: [],
  sources: [],
}

const FOUND: SearchResults = {
  deals: [
    {
      dealId: 'd1',
      bitrixId: '925842',
      orderCode: 'bx00790',
      title: 'CollagenMarine',
      customerName: 'Dilnoza',
      customerPhone: '+998901234567',
      amountMinor: 160_000_000n,
      currency: 'UZS',
      createdAt: new Date('2026-08-31T04:09:00.000Z'),
      stageName: 'Тасдиклаш · Заказ тасдиклаш',
      employeeName: 'Quvondiqova Gulmira',
      queued: true,
    },
  ],
  customers: [
    {
      customerId: 'c1',
      name: 'Dilnoza',
      phone: '+998901234567',
      orders: 3,
      lastOrderAt: new Date('2026-08-31T04:09:00.000Z'),
    },
  ],
  employees: [
    { id: 'e1', name: 'Quvondiqova Gulmira', detail: 'Baza(ROP)', departmentId: 'dep-7' },
  ],
  products: [{ id: 'p1', name: 'Zextra sure', detail: null, departmentId: null }],
  sources: [{ id: 's1', name: 'Instagram', detail: null, departmentId: null }],
}

function serviceReturning(
  results: SearchResults,
  capture?: { scope?: readonly string[] | null },
) {
  const repository = {
    search: async (_term: string, restrictToEmployeeIds?: readonly string[] | null) => {
      if (capture) capture.scope = restrictToEmployeeIds
      return results
    },
  } as unknown as SearchRepository

  return new SearchService(repository)
}

/** The scope the handler resolves before calling the service. */
function scopeOf(p: Principal, team: readonly string[] | null = null) {
  return rowScopeFor(p, team)
}

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: 'u1',
    role: 'ADMIN',
    isActive: true,
    employeeId: null,
    dataScope: 'ALL',
    sections: defaultSectionsFor('ADMIN'),
    ...overrides,
  }
}

describe('what the search is allowed to return', () => {
  it('shows an account everything it holds the screens for', async () => {
    const dto = await serviceReturning(FOUND).search(principal(), scopeOf(principal()), 'dilnoza', 'UZS')

    expect(dto.groups.map((g) => g.key)).toEqual([
      'deals',
      'customers',
      'employees',
      'products',
      'sources',
    ])
  })

  it('omits a group whose screen this account was never given', async () => {
    // Not "0 matches" — saying "3 you may not see" still says the customer
    // exists, which is the thing being withheld.
    const dto = await serviceReturning(FOUND).search(
      principal({ sections: ['logistics'] }),
      scopeOf(principal({ sections: ['logistics'] })),
      'dilnoza',
      'UZS',
    )

    expect(dto.groups).toEqual([])
  })

  it('gives an account with only the queue its orders and customers, nothing else', async () => {
    const dto = await serviceReturning(FOUND).search(
      principal({ sections: ['confirmation'] }),
      scopeOf(principal({ sections: ['confirmation'] })),
      'dilnoza',
      'UZS',
    )

    expect(dto.groups.map((g) => g.key)).toEqual(['deals', 'customers'])
  })

  it('passes an OWN-scoped account down to the SQL as its own employee', async () => {
    const capture: { scope?: readonly string[] | null } = {}
    await serviceReturning(FOUND, capture).search(
      principal({ dataScope: 'OWN', employeeId: 'emp-7' }),
      scopeOf(principal({ dataScope: 'OWN', employeeId: 'emp-7' })),
      'dilnoza',
      'UZS',
    )

    expect(capture.scope).toEqual(['emp-7'])
  })

  it('leaves a company-wide account unscoped', async () => {
    const capture: { scope?: readonly string[] | null } = {}
    await serviceReturning(FOUND, capture).search(principal(), scopeOf(principal()), 'dilnoza', 'UZS')

    expect(capture.scope).toBeNull()
  })

  it('drops a group that matched nothing rather than rendering an empty heading', async () => {
    const dto = await serviceReturning({ ...EMPTY, products: FOUND.products }).search(
      principal(),
      scopeOf(principal()),
      'zextra',
      'UZS',
    )

    expect(dto.groups.map((g) => g.key)).toEqual(['products'])
  })
})

describe('where a result takes you', () => {
  it('opens an order in the queue, by the id the queue searches on', async () => {
    const dto = await serviceReturning(FOUND).search(principal(), scopeOf(principal()), '925842', 'UZS')
    const deal = dto.groups.find((g) => g.key === 'deals')!.items[0]

    expect(deal.href).toContain('/confirmation?')
    expect(deal.href).toContain('q=925842')
  })

  /*
    THE QUEUE CAN ONLY FIND WHAT ARRIVED IN IT. A phone lists every deal of the
    customer, newest first — the База twin made after delivery, a fresh
    Регистрация lead — and their own ids opened an empty board for the row
    just listed. The customer's phone finds the family there.
  */
  it('opens a deal that never reached the queue by its customer’s phone', async () => {
    const twin = {
      ...FOUND.deals[0]!,
      dealId: 'd2',
      bitrixId: '1010043',
      orderCode: 'bx10043',
      stageName: 'База · Новый',
      queued: false,
    }
    const lead = { ...twin, dealId: 'd3', bitrixId: '1012001', orderCode: null, stageName: 'Регистрация · Новый лид' }
    const dto = await serviceReturning({ ...FOUND, deals: [twin, lead] }).search(
      principal(),
      scopeOf(principal()),
      '998901234567',
      'UZS',
    )
    const [twinHit, leadHit] = dto.groups.find((g) => g.key === 'deals')!.items

    expect(twinHit!.href).toContain(`q=${encodeURIComponent('+998901234567')}`)
    expect(leadHit!.href).toContain(`q=${encodeURIComponent('+998901234567')}`)
    expect(twinHit!.href).not.toContain('q=1010043')
  })

  it('falls back to the order code, then the id, for such a deal with no phone', async () => {
    const twin = { ...FOUND.deals[0]!, customerPhone: null, orderCode: 'bx10043', queued: false }
    const bare = { ...twin, dealId: 'd4', orderCode: null }
    const dto = await serviceReturning({ ...FOUND, deals: [twin, bare] }).search(
      principal(),
      scopeOf(principal()),
      '925842',
      'UZS',
    )
    const [byCode, byId] = dto.groups.find((g) => g.key === 'deals')!.items

    expect(byCode!.href).toContain('q=bx10043')
    expect(byId!.href).toContain('q=925842')
  })

  it('carries a wide window, or the row just listed would not be there', async () => {
    // An order found by its id is usually an old one. Landing on a screen
    // showing today would say "not found" about the row that was clicked.
    const dto = await serviceReturning(FOUND).search(principal(), scopeOf(principal()), '925842', 'UZS')

    for (const group of dto.groups) {
      for (const item of group.items) {
        if (item.href.startsWith('/confirmation')) expect(item.href).toContain('preset=this_year')
      }
    }
  })

  it('finds a customer by their number rather than their name', async () => {
    // A name repeats across people; a number does not.
    const dto = await serviceReturning(FOUND).search(principal(), scopeOf(principal()), 'dilnoza', 'UZS')
    const customer = dto.groups.find((g) => g.key === 'customers')!.items[0]

    expect(customer.href).toContain(encodeURIComponent('+998901234567'))
  })

  /*
    EVERY DESTINATION MUST BE ABLE TO ACT ON WHAT IT IS SENT.

    «Mahsulotlar» pointed at `/analytics/sales?productIds=<id>` for weeks after
    that screen stopped applying a product filter — the parameter parsed, the
    request returned 200, no SQL ever saw it, and the reader was handed the
    whole company's month under one product's name. The failure was silent in
    every layer, which is why it is pinned here rather than left to review.
  */
  it('sends a product to the one screen that itemises by product', async () => {
    const dto = await serviceReturning(FOUND).search(principal(), scopeOf(principal()), 'collagen', 'UZS')
    const product = dto.groups.find((g) => g.key === 'products')!.items[0]!

    expect(product.href).toContain('/margin?')
    // The NAME, not the id: Yalpi marja narrows its table on what it prints.
    expect(product.href).toContain(`q=${encodeURIComponent(FOUND.products[0]!.name)}`)
    // With no preset the screen opened on «Bugun», where a product nobody sold today is «not found».
    expect(product.href).toContain('preset=this_year')
  })

  it('never sends anyone to a filter the destination does not apply', async () => {
    const dto = await serviceReturning(FOUND).search(principal(), scopeOf(principal()), 'collagen', 'UZS')

    for (const group of dto.groups) {
      for (const item of group.items) {
        // Savdo dinamikasi reads employees, departments and sources. It has
        // read neither of these two since it was stripped to FAKT 1 / FAKT 2.
        expect(item.href).not.toContain('productIds=')
        expect(item.href).not.toContain('stageIds=')
      }
    }
  })

  it('opens an employee on THEIR unit, not on the reader\u2019s own', async () => {
    /*
      «Xodimlar» linked to a bare `/structure`, and that screen opens on the
      READER's chain — so typing an operator's name to find out who runs them
      drew the supervisor's own department, the one answer they already had.
    */
    const dto = await serviceReturning(FOUND).search(principal(), scopeOf(principal()), 'gulmira', 'UZS')
    const person = dto.groups.find((g) => g.key === 'employees')!.items[0]!

    expect(person.href).toBe('/structure?dep=dep-7')
  })

  it('falls back to the bare chart for someone filed in no unit', async () => {
    const unfiled = {
      ...FOUND,
      employees: [{ id: 'e2', name: 'Yangi Xodim', detail: null, departmentId: null }],
    }
    const dto = await serviceReturning(unfiled).search(principal(), scopeOf(principal()), 'yangi', 'UZS')
    const person = dto.groups.find((g) => g.key === 'employees')!.items[0]!

    expect(person.href).toBe('/structure')
  })

  it('carries the order amount so a row can be told from its namesakes', async () => {
    const dto = await serviceReturning(FOUND).search(principal(), scopeOf(principal()), '925842', 'UZS')
    const deal = dto.groups.find((g) => g.key === 'deals')!.items[0]

    expect(deal.amount?.amount).toBe(1_600_000)
  })
})

describe('a term too short to look up', () => {
  it('says so, rather than reporting that nothing matched', async () => {
    const dto = await serviceReturning(EMPTY).search(principal(), scopeOf(principal()), 'di', 'UZS')

    expect(dto.tooShort).toBe(true)
    expect(dto.groups).toEqual([])
  })

  it('does not call an empty box too short', async () => {
    const dto = await serviceReturning(EMPTY).search(principal(), scopeOf(principal()), '', 'UZS')

    expect(dto.tooShort).toBe(false)
  })
})
