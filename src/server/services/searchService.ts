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
import { canSeeSection, type RowScope } from '@/server/auth/rbac'
import type { SearchDealRow, SearchRepository } from '@/server/repositories/searchRepository'
import { classifySearchTerm } from '@/lib/searchTerm'

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

/**
 * What the confirmation queue is asked for, to show this deal's order.
 *
 * A DEAL THAT ARRIVED IN TASDIQLASH by the id the queue itself searches by,
 * so the row that was listed here is the row that is highlighted there.
 *
 * ANY OTHER DEAL BY ITS CUSTOMER'S PHONE. The number arms list every deal of
 * the customer, newest first, so the top hit for a delivered customer is often
 * the База twin made ~10 days after delivery, or a fresh Регистрация lead —
 * deals that never reach the queue, whose own id opened an empty board for the
 * order just listed. The queue matches a phone as digits across the whole
 * family, the twin's Доставка original included. The order code is second: it
 * is matched as a substring there, so «bx10043» also finds «bx100431». The id
 * is last, as before.
 *
 * A CUSTOMER THE QUEUE NEVER SAW has nothing there for any link to find — the
 * usual fresh lead, whose every deal is still in Регистрация. Its row stays,
 * because a phone search is also how somebody checks whether a number is
 * already a lead, and says so (`notQueuedHint`) before it is opened.
 */
function queueTerm(d: SearchDealRow): string {
  if (d.queued) return d.bitrixId ?? d.title
  return d.customerPhone ?? d.orderCode ?? d.bitrixId ?? d.title
}

/** What a deal row adds to its hint when the queue holds nothing of its customer. */
function notQueuedHint(d: SearchDealRow): string | null {
  // `queued` too: a deal with no customer can be queued itself, and `customerQueued` is then false.
  return d.queued || d.customerQueued ? null : 'Tasdiqlashga tushmagan'
}

export class SearchService {
  constructor(private readonly repository: SearchRepository) {}

  async search(
    principal: Principal,
    scope: RowScope,
    term: string,
    currency: string,
  ): Promise<SearchDto> {
    const query = term.trim()

    const results = await this.repository.search(query, scope.restrictToEmployeeIds)
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
            notQueuedHint(d),
          ]
            .filter(Boolean)
            .join(' · '),
          href: `/confirmation?${WINDOW}&q=${encodeURIComponent(queueTerm(d))}`,
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
        /*
          TO THEIR UNIT, NOT TO THE READER'S.

          This linked to a bare `/structure`, and that screen opens on the
          reader's OWN chain, lit and fitted. So a supervisor who typed an
          operator's name to find out who runs them landed on their own
          department — the one thing they already knew. `?dep=` force-opens the
          ancestors, flies to the card and opens the roster, so the path from a
          name on an order to that person's ROP becomes one keystroke and one
          press. A person filed in no unit still gets the bare page.
        */
        items: results.employees.map((e) => ({
          id: `employee-${e.id}`,
          label: e.name,
          hint: e.detail ?? 'Boʻlimsiz',
          href: e.departmentId ? `/structure?dep=${encodeURIComponent(e.departmentId)}` : '/structure',
        })),
      })
    }

    /*
      PRODUCTS GO TO YALPI MARJA, NOT TO SAVDO DINAMIKASI.

      This group used to link to `/analytics/sales?productIds=<id>`, and that
      screen has applied no product filter since it was stripped to FAKT 1 /
      FAKT 2: `boardFilters` and `pulseFilters` carry employees, departments
      and sources only, so the parameter parsed cleanly, reached no SQL, and
      the reader was handed the WHOLE COMPANY's month under a product's name —
      with a lit «Filtrlarni tozalash (1)» button asserting a filter was on.

      Yalpi marja is the one screen that itemises by product, and its table now
      narrows on `?q=` in the browser. So the link carries the NAME, not the
      id: the destination matches on what it prints, and a reader who edits the
      box sees the list follow. The group is gated on `margin` for the same
      reason — the section that answers it is the section that must be held.

      AND IT CARRIES THE ORDERS' WIDE WINDOW. An address with a query string
      skips the remembered-window restore, so a bare `?q=` opened on «Bugun»,
      and a product nobody sold today read «mahsulot topilmadi» under the name
      the palette had just listed.
    */
    if (allow('margin')) {
      groups.push({
        key: 'products',
        label: 'Mahsulotlar',
        items: results.products.map((p) => ({
          id: `product-${p.id}`,
          label: p.name,
          hint: 'Yalpi marjada ochish',
          href: `/margin?${WINDOW}&q=${encodeURIComponent(p.name)}`,
        })),
      })
    }

    if (allow('sales')) {
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
      tooShort: classifySearchTerm(query).status === 'short',
    }
  }
}
