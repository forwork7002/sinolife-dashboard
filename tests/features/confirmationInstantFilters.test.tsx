// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { boardCohortKey, boardSummaryKey } from '@/features/confirmation/summaryKey'

/**
 * THE CONFIRMATION BOARD ANSWERS A CLICK BEFORE IT ANSWERS A SERVER.
 *
 * WHAT WAS MEASURED, on 2026-09-10, against a warm dev server on localhost
 * with one row in the table:
 *
 *     click a state tile        t+0
 *     RSC request goes out      t+45ms
 *     the URL commits           t+212ms   ← the tile lights up only HERE
 *     the API request starts    t+521ms
 *
 * Half a second of a screen that has not acknowledged the click, on a
 * loopback — and every millisecond of it bought nothing, because the server
 * side of `/confirmation` is `requireSection` plus a client component and reads
 * no `searchParams` at all. The payload that round trip fetched was the one
 * already on screen. Over the internet, to a droplet, in front of a query that
 * then takes two seconds of its own, this is what the floor calls a freeze.
 *
 * `SHALLOW_ROUTES` in `useDashboardFilters` is the cure and this file is what
 * keeps it: the address is written with `window.history.replaceState`, which
 * Next's own router integrates with `useSearchParams`, so the filter state
 * moves in the same tick and no server is asked anything.
 *
 * THE SECOND HALF IS AN ACCUMULATION BUG THE FIRST ONE EXPOSED. `update` built
 * its next address from the `params` its closure captured, so two changes
 * inside one render — which is ordinary once clicks are answered in
 * milliseconds — both built on the address before either of them, and the
 * second silently overwrote the first.
 */

const nav = vi.hoisted(() => ({ search: '', pathname: '/confirmation', routed: [] as string[] }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: (url: string) => nav.routed.push(url),
    push: (url: string) => nav.routed.push(url),
  }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}))

const { useDashboardFilters } = await import('@/features/shared/useDashboardFilters')

/** Every native address write, and the address bar kept in step with it. */
const shallow: string[] = []

beforeEach(() => {
  shallow.length = 0
  nav.routed = []
})

/*
  THE SPY RECORDS; IT DOES NOT REPLACE.

  `replaceState` really does move `window.location`, and the hook really does
  read `window.location` back when it composes the next address — that is what
  stops two changes in one render losing the first. A mock that only recorded
  the call would leave the address bar frozen, and the accumulation case below
  would fail against code that is correct in every browser.
*/
const realReplaceState = window.history.replaceState.bind(window.history)

vi.spyOn(window.history, 'replaceState').mockImplementation(
  (state: unknown, title: string, url?: string | URL | null) => {
    realReplaceState(state, title, url)
    if (url == null) return
    shallow.push(String(url))
    // `useSearchParams` is mocked, so it is kept in step by hand — in a browser
    // Next's router does this itself, which is the whole point of the change.
    nav.search = String(url).split('?')[1] ?? ''
  },
)

function board(search: string, pathname = '/confirmation') {
  nav.pathname = pathname
  nav.search = search
  // The address bar carries what `useSearchParams` carries — in a browser the
  // two cannot disagree, and on a shallow route the hook reads the live one.
  window.history.pushState(null, '', `${pathname}${search ? `?${search}` : ''}`)
  shallow.length = 0
  nav.routed = []
  return renderHook(() => useDashboardFilters())
}

const paramsOf = (href: string) => new URLSearchParams(href.split('?')[1] ?? '')

describe('a filter change on the confirmation board asks no server', () => {
  it('writes the address natively rather than navigating the route', () => {
    const { result } = board('preset=today')

    act(() => result.current.update({ outcomes: ['CONFIRM_NEW'] }))

    expect(shallow).toHaveLength(1)
    expect(paramsOf(shallow[0]!).get('outcomes')).toBe('CONFIRM_NEW')
    /*
      THE ASSERTION THAT MATTERS. A `router.replace` here is a round trip to
      re-render a page whose server half reads nothing from the query string,
      and the reader waits for it before the tile they pressed lights up.
    */
    expect(nav.routed).toEqual([])
  })

  /*
    LOGISTIKA JOINED THE SET ON 2026-09-10, and it qualifies for the same one
    reason: `src/app/logistics/page.tsx` takes no props and reads no
    `searchParams` — it is `requireSection` plus a client component. Every
    period change on that screen was paying the 521 ms round trip measured
    above to fetch a payload the browser already had.
  */
  it('writes the address natively on Logistika too', () => {
    const { result } = board('preset=today', '/logistics')

    act(() => result.current.setPeriod({ preset: 'this_month' }))

    expect(shallow).toHaveLength(1)
    expect(paramsOf(shallow[0]!).get('preset')).toBe('this_month')
    expect(nav.routed).toEqual([])
  })

  /*
    FOUR MORE ON 2026-09-11, each checked against the one condition: none of
    their server pages mentions `searchParams`. Two of them had a control a
    reader uses repeatedly rather than occasionally — «Yalpi marja» grew a
    search box that calls `update` on EVERY KEYSTROKE with no debounce, and
    «Kadrlar tuzilmasi» writes `?dep=` on every card click — so the half second
    was being paid per character and per department.
  */
  it.each([
    ['/margin', 'the product search box', () => ({ q: 'zextra' })],
    ['/analytics/cohort', 'the period chips', () => ({ q: undefined })],
    ['/kpi', 'the employee filter', () => ({ employeeIds: ['e1'] })],
    ['/structure', 'a card click writing ?dep=', () => ({ dep: 'dep-7' })],
  ])('writes the address natively on %s (%s)', (pathname, _what, change) => {
    const { result } = board('preset=this_month', pathname)

    act(() => result.current.update(change() as never))

    expect(nav.routed).toEqual([])
    expect(shallow).toHaveLength(1)
  })

  it('leaves every other screen navigating exactly as it did', () => {
    /*
      The opt-in is a SET of routes for a reason: this cure is only sound where
      nothing on the server side of the page reads `searchParams`. Every other
      screen keeps `router.replace` until it has been checked, one at a time.
    */
    const { result } = board('preset=today', '/analytics/sales')

    act(() => result.current.update({ status: 'WON' }))

    expect(shallow).toEqual([])
    expect(nav.routed).toHaveLength(1)
    expect(paramsOf(nav.routed[0]!).get('status')).toBe('WON')
  })

  it('reaches the API with the new selection in the same render', () => {
    const { result, rerender } = board('preset=today')

    act(() => result.current.update({ outcomes: ['CONFIRMED'] }))
    rerender()

    // What the query key is built from. If this lags the click, so does the
    // request, which is the whole of the delay this change removes.
    expect(result.current.apiParams.outcomes).toBe('CONFIRMED')
    expect(result.current.filters.outcomes).toEqual(['CONFIRMED'])
  })
})

describe('two changes inside one render both survive', () => {
  it('keeps the first filter when a second is set before the URL lands', () => {
    const { result } = board('preset=today')

    /*
      One render, two changes — a region ticked and a сумма bound applied, or
      any filter click racing the page-reset effect beside it. Built from the
      captured `params`, the second wrote an address that had never heard of
      the first: `?preset=today&amountMin=1000000`, with «Хоразм» gone from
      both the table and the control that would have removed it.
    */
    act(() => {
      result.current.update({ regions: ['Xorazm'] })
      result.current.update({ amountMin: 1_000_000 })
    })

    const last = paramsOf(shallow.at(-1)!)
    expect(last.get('regions')).toBe('Xorazm')
    expect(last.get('amountMin')).toBe('1000000')
  })

  it('accumulates a state selection tile by tile', () => {
    const { result, rerender } = board('preset=today')

    // «pick 🟡 then ❌ and you get both» is what the tiles document, and what
    // they could not do: the two clicks landed 60ms apart and the second won.
    act(() => result.current.update({ outcomes: ['CONFIRM_NEW'] }))
    rerender()
    act(() =>
      result.current.update({ outcomes: [...result.current.filters.outcomes, 'CONFIRMED'] }),
    )

    expect(paramsOf(shallow.at(-1)!).get('outcomes')).toBe('CONFIRM_NEW,CONFIRMED')
  })

  it('clears the filters against the address as it stands, not as it was', () => {
    const { result } = board('preset=today&queue=backlog')

    act(() => {
      result.current.update({ regions: ['Xorazm'] })
      result.current.reset()
    })

    const kept = paramsOf(shallow.at(-1)!)
    // The window and the question survive; the filter set a moment ago does
    // not come back from a stale closure.
    expect(kept.get('preset')).toBe('today')
    expect(kept.get('queue')).toBe('backlog')
    expect(kept.get('regions')).toBeNull()
  })
})

describe('what the tile band is allowed to blank for', () => {
  const base = { preset: 'today', q: '944' }

  it('treats a ROP selection as the same population, differently cut', () => {
    // Same cohort — so the band dims and keeps its figures rather than
    // rebuilding itself out of six grey blocks on every tick of a checkbox.
    expect(boardCohortKey({ ...base, rops: 'Sevinch' })).toBe(boardCohortKey(base))
    // But NOT the same answer: the figures still have to be refetched, so the
    // narrower key must tell them apart.
    expect(boardSummaryKey({ ...base, rops: 'Sevinch' })).not.toBe(boardSummaryKey(base))
  })

  it('honours the legacy single ?rop= the same way', () => {
    // `useDashboardFilters` folds `?rop=` into `rops`, and links carrying it
    // still arrive from Telegram. A key that saw through one spelling and not
    // the other would blank the band for half the readers.
    expect(boardCohortKey({ ...base, rop: 'Sevinch' })).toBe(boardCohortKey(base))
  })

  it('treats a different window or mode as a different cohort', () => {
    const changes: Record<string, string>[] = [
      { preset: 'this_month' },
      { preset: 'custom', from: '2026-09-01', to: '2026-09-05' },
      { queue: 'backlog' },
    ]
    for (const change of changes) {
      expect(boardCohortKey({ ...base, ...change })).not.toBe(boardCohortKey(base))
    }
  })

  it('keeps the cohort across the search, region and сумма filters', () => {
    /*
      Each narrows inside the window, exactly as a ROP does — and clearing one
      widens back to it. Blanking the band for them made «Filtrlarni tozalash»
      after a region filter drop six tiles to grey and fade the whole page,
      which the client read as a reload (2026-09-11). They are still in the
      summary key, so the figures are still refetched.
    */
    const changes: Record<string, string>[] = [
      { q: '945' },
      { regions: 'Xorazm' },
      { amountMin: '1000000' },
      { amountMax: '1000000' },
    ]
    for (const change of changes) {
      expect(boardCohortKey({ ...base, ...change })).toBe(boardCohortKey(base))
      expect(boardSummaryKey({ ...base, ...change })).not.toBe(boardSummaryKey(base))
    }
  })

  it('ignores the state selection in both keys, because no tile reads it', () => {
    // The band is six figures compared against each other; a band that moved
    // to match its own selection could not be used for the comparison.
    expect(boardSummaryKey({ ...base, outcomes: 'CONFIRMED' })).toBe(boardSummaryKey(base))
    expect(boardCohortKey({ ...base, outcomes: 'CONFIRMED' })).toBe(boardCohortKey(base))
  })
})
