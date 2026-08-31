import { describe, expect, it } from 'vitest'

import { defaultSectionsFor } from '@/lib/sections'
import type { Principal } from '@/server/auth/rbac'
import type { SearchRepository, SearchResults } from '@/server/repositories/searchRepository'
import { commandCentreCacheKey } from '@/server/services/commandCentreCacheKey'
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
  employees: [{ id: 'e1', name: 'Quvondiqova Gulmira', detail: 'Baza(ROP)' }],
  products: [{ id: 'p1', name: 'Zextra sure', detail: null }],
  sources: [{ id: 's1', name: 'Instagram', detail: null }],
}

function serviceReturning(results: SearchResults, capture?: { scope?: string }) {
  const repository = {
    search: async (_term: string, restrictToEmployeeId?: string) => {
      if (capture) capture.scope = restrictToEmployeeId
      return results
    },
  } as unknown as SearchRepository

  return new SearchService(repository)
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
    const dto = await serviceReturning(FOUND).search(principal(), 'dilnoza', 'UZS')

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
      'dilnoza',
      'UZS',
    )

    expect(dto.groups).toEqual([])
  })

  it('gives an account with only the queue its orders and customers, nothing else', async () => {
    const dto = await serviceReturning(FOUND).search(
      principal({ sections: ['confirmation'] }),
      'dilnoza',
      'UZS',
    )

    expect(dto.groups.map((g) => g.key)).toEqual(['deals', 'customers'])
  })

  it('passes an OWN-scoped account down to the SQL as its own employee', async () => {
    const capture: { scope?: string } = {}
    await serviceReturning(FOUND, capture).search(
      principal({ dataScope: 'OWN', employeeId: 'emp-7' }),
      'dilnoza',
      'UZS',
    )

    expect(capture.scope).toBe('emp-7')
  })

  it('leaves a company-wide account unscoped', async () => {
    const capture: { scope?: string } = {}
    await serviceReturning(FOUND, capture).search(principal(), 'dilnoza', 'UZS')

    expect(capture.scope).toBeUndefined()
  })

  it('drops a group that matched nothing rather than rendering an empty heading', async () => {
    const dto = await serviceReturning({ ...EMPTY, products: FOUND.products }).search(
      principal(),
      'zextra',
      'UZS',
    )

    expect(dto.groups.map((g) => g.key)).toEqual(['products'])
  })
})

describe('where a result takes you', () => {
  it('opens an order in the queue, by the id the queue searches on', async () => {
    const dto = await serviceReturning(FOUND).search(principal(), '925842', 'UZS')
    const deal = dto.groups.find((g) => g.key === 'deals')!.items[0]

    expect(deal.href).toContain('/confirmation?')
    expect(deal.href).toContain('q=925842')
  })

  it('carries a wide window, or the row just listed would not be there', async () => {
    // An order found by its id is usually an old one. Landing on a screen
    // showing today would say "not found" about the row that was clicked.
    const dto = await serviceReturning(FOUND).search(principal(), '925842', 'UZS')

    for (const group of dto.groups) {
      for (const item of group.items) {
        if (item.href.startsWith('/confirmation')) expect(item.href).toContain('preset=this_year')
      }
    }
  })

  it('finds a customer by their number rather than their name', async () => {
    // A name repeats across people; a number does not.
    const dto = await serviceReturning(FOUND).search(principal(), 'dilnoza', 'UZS')
    const customer = dto.groups.find((g) => g.key === 'customers')!.items[0]

    expect(customer.href).toContain(encodeURIComponent('+998901234567'))
  })

  it('carries the order amount so a row can be told from its namesakes', async () => {
    const dto = await serviceReturning(FOUND).search(principal(), '925842', 'UZS')
    const deal = dto.groups.find((g) => g.key === 'deals')!.items[0]

    expect(deal.amount?.amount).toBe(1_600_000)
  })
})

describe('a term too short to look up', () => {
  it('says so, rather than reporting that nothing matched', async () => {
    const dto = await serviceReturning(EMPTY).search(principal(), 'di', 'UZS')

    expect(dto.tooShort).toBe(true)
    expect(dto.groups).toEqual([])
  })

  it('does not call an empty box too short', async () => {
    const dto = await serviceReturning(EMPTY).search(principal(), '', 'UZS')

    expect(dto.tooShort).toBe(false)
  })
})

/**
 * The command centre's build cache.
 *
 * The bug this holds down: two presets can resolve to the SAME window and
 * still want different comparisons. Every Monday "today" and "this week" are
 * both [Mon 00:00, Tue 00:00), but one looks back a day and the other a week.
 * Keyed on the window alone they shared an entry, and whichever was asked
 * first served the other its neighbour's "previous period" figures.
 */
describe('the command centre cache key', () => {
  const window = {
    start: new Date('2026-08-30T19:00:00.000Z'),
    end: new Date('2026-08-31T19:00:00.000Z'),
    timeZone: 'Asia/Tashkent',
  }

  it('separates two presets that resolve to the same days', () => {
    const today = commandCentreCacheKey({ ...window, preset: 'today' }, 'UZS')
    const week = commandCentreCacheKey({ ...window, preset: 'this_week' }, 'UZS')

    expect(today).not.toBe(week)
  })

  it('still shares one entry for the same preset and window', () => {
    // The whole point of the cache: six people opening the same screen inside
    // 45 seconds must not each run sixteen queries.
    expect(commandCentreCacheKey({ ...window, preset: 'today' }, 'UZS')).toBe(
      commandCentreCacheKey({ ...window, preset: 'today' }, 'UZS'),
    )
  })

  it('separates currencies, which change every money figure on the screen', () => {
    expect(commandCentreCacheKey({ ...window, preset: 'today' }, 'UZS')).not.toBe(
      commandCentreCacheKey({ ...window, preset: 'today' }, 'USD'),
    )
  })
})
