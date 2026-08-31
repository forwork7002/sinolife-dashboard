/**
 * Search results, turned into somewhere to go.
 *
 * The repository finds rows; this decides what a row MEANS to click. Both
 * halves of that are policy and belong on the server: which screen answers
 * for a kind of thing, and whether this particular account may open it at all.
 *
 * EVERY GROUP IS GATED BY A SECTION. Search crosses the whole dashboard, so
 * without that it would be a way around the boundary an administrator drew —
 * type a phone number and read an order off a screen you were never given.
 * A group whose screen this account does not hold is not narrowed, it is
 * absent: telling somebody "3 matches you may not see" still tells them the
 * customer exists.
 *
 * THE DESTINATION CARRIES A WIDE WINDOW. An order found by its id is usually
 * an old one, and landing on a screen showing today would say "not found"
 * about the row that was just listed. `this_year` is wide enough for the
 * question being asked and still bounded.
 */

import type { SectionValue } from '@/lib/sections'
import { toMoneyDto, money, type MoneyDto } from '@/server/domain/money/money'
import type { Principal } from '@/server/auth/rbac'
import { canSeeSection, dealScopeFor } from '@/server/auth/rbac'
import type { SearchRepository } from '@/server/repositories/searchRepository'

export interface SearchHitDto {
  readonly id: string
  readonly label: string
  /** The second line: what makes this row recognisable. */
  readonly hint: string
  /** Where clicking it goes, query string and all. */
  readonly href: string
  readonly amount?: MoneyDto
}

export interface SearchGroupDto {
  readonly key: 'deals' | 'customers' | 'employees' | 'products' | 'sources'
  readonly label: string
  readonly items: readonly SearchHitDto[]
}

export interface SearchDto {
  readonly query: string
  readonly groups: readonly SearchGroupDto[]
  /** True when the term was too short to look anything up. */
  readonly tooShort: boolean
}

/** Wide enough to hold an order somebody is asking about by id. */
const WINDOW = 'preset=this_year'

export class SearchService {
  constructor(private readonly repository: SearchRepository) {}

  async search(principal: Principal, term: string, currency: string): Promise<SearchDto> {
    const query = term.trim()
    const scope = dealScopeFor(principal)

    const results = await this.repository.search(query, scope.restrictToEmployeeId)
    const allow = (section: SectionValue) => canSeeSection(principal, section)

    const groups: SearchGroupDto[] = []

    if (allow('confirmation')) {
      groups.push({
        key: 'deals',
        label: 'Buyurtmalar',
        items: results.deals.map((d) => ({
          id: `deal-${d.dealId}`,
          label: d.customerName?.trim() || d.title,
          hint: [
            d.bitrixId ? `ID ${d.bitrixId}` : null,
            d.orderCode,
            d.customerPhone,
            d.stageName,
            d.employeeName,
          ]
            .filter(Boolean)
            .join(' · '),
          // Searched by the id the queue itself searches by, so the row that
          // was listed here is the row that is highlighted there.
          href: `/confirmation?${WINDOW}&q=${encodeURIComponent(d.bitrixId ?? d.title)}`,
          amount: toMoneyDto(money(d.amountMinor, d.currency || currency)),
        })),
      })

      groups.push({
        key: 'customers',
        label: 'Mijozlar',
        items: results.customers.map((c) => ({
          id: `customer-${c.customerId}`,
          label: c.name,
          hint: [c.phone, `${c.orders} ta buyurtma`].filter(Boolean).join(' · '),
          // By phone where there is one: a name repeats across people, a
          // number does not.
          href: `/confirmation?${WINDOW}&q=${encodeURIComponent(c.phone ?? c.name)}`,
        })),
      })
    }

    if (allow('structure')) {
      groups.push({
        key: 'employees',
        label: 'Xodimlar',
        items: results.employees.map((e) => ({
          id: `employee-${e.id}`,
          label: e.name,
          hint: e.detail ?? 'Boʻlimsiz',
          href: '/structure',
        })),
      })
    }

    if (allow('sales')) {
      groups.push({
        key: 'products',
        label: 'Mahsulotlar',
        items: results.products.map((p) => ({
          id: `product-${p.id}`,
          label: p.name,
          hint: 'Savdo dinamikasida ochish',
          href: `/analytics/sales?preset=this_month&productIds=${encodeURIComponent(p.id)}`,
        })),
      })

      groups.push({
        key: 'sources',
        label: 'Manbalar',
        items: results.sources.map((s) => ({
          id: `source-${s.id}`,
          label: s.name,
          hint: 'Savdo dinamikasida ochish',
          href: `/analytics/sales?preset=this_month&sourceIds=${encodeURIComponent(s.id)}`,
        })),
      })
    }

    return {
      query,
      // An empty group would render as a heading with nothing under it.
      groups: groups.filter((group) => group.items.length > 0),
      tooShort: query.length > 0 && query.length < 3,
    }
  }
}
