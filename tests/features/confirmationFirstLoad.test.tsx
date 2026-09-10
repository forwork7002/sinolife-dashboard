// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE BOARD ASKS ONE QUESTION ON A BARE ARRIVAL, NOT TWO.
 *
 * `useRestoreRememberedPeriod` puts the remembered window back when the address
 * carries none, and it does so in an EFFECT — one commit after the first render
 * has already happened with the DEFAULT window. So the page fired a full
 * request for «Bugun», had its address replaced with «Shu oy» a moment later,
 * and fired the whole thing again. Reproduced at the hook level on 2026-09-10:
 * a bare `/confirmation` with a remembered month asked `{"preset":"today"}` and
 * then `{"preset":"this_month"}` — two react-query keys, two fetches.
 *
 * ON THIS BOARD THE WASTED ONE IS THE EXPENSIVE ONE — a whole-cohort CTE and a
 * ROP breakdown, seconds of database work on production, thrown away before
 * anything was drawn from it. TanStack cancels the browser's request when the
 * key changes, which is exactly what hid it: the network tab shows a cancelled
 * request and the database still does every second of the work.
 *
 * AND THE BARE ADDRESS IS NOT A RARE PATH. `/` resolves the account's first
 * section and `redirect`s to its route with no query string, so an operator
 * whose first section is Тасдиклаш lands on one at every sign-in. The sidebar
 * is already careful about this — `Shell`'s `hrefFor` carries the window on
 * every link — but a bookmark, the logo and the post-login redirect are not.
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

const { useAwaitingRememberedPeriod, useDashboardFilters, useRestoreRememberedPeriod } =
  await import('@/features/shared/useDashboardFilters')

/*
  `/confirmation` writes its address natively — see `SHALLOW_ROUTES` — so the
  restore lands here rather than on the router mock. `useSearchParams` is mocked
  and has to be kept in step by hand; in a browser Next's own router does it.
*/
let store: Record<string, string> = {}

beforeEach(() => {
  store = {}
  nav.search = ''
  nav.pathname = '/confirmation'
  nav.routed = []
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => void (store[key] = value),
      removeItem: (key: string) => void delete store[key],
    },
  })
  window.history.replaceState(null, '', '/confirmation')
  // Re-installed per test rather than once: `restoreAllMocks` below would
  // otherwise leave the later cases watching a door nobody writes through, and
  // they would fail for want of a spy rather than for want of the behaviour.
  vi.spyOn(window.history, 'replaceState').mockImplementation(
    (_state: unknown, _title: string, url?: string | URL | null) => {
      if (url != null) nav.search = String(url).split('?')[1] ?? ''
    },
  )
})

afterEach(() => vi.restoreAllMocks())

function remember(preset: string) {
  store['sinolife.period.v2'] = JSON.stringify({ window: { preset } })
}

/**
 * The board, arriving at whatever `nav.search` says, recording every distinct
 * question it would put to the API.
 *
 * A NEW `apiParams` IS A NEW REACT-QUERY KEY, which is a fetch — and a render
 * that is HOLDING (the gate is up) is not a question at all, so it records
 * nothing. That is the whole measurement.
 */
function board() {
  const asked: string[] = []

  const hook = renderHook(() => {
    const { apiParams } = useDashboardFilters()
    const awaiting = useAwaitingRememberedPeriod(true)
    // What the page does: `enabled: !awaiting` on its query.
    if (!awaiting) {
      const question = JSON.stringify(apiParams)
      if (asked.at(-1) !== question) asked.push(question)
    }
    useRestoreRememberedPeriod(true)
    return { apiParams, awaiting }
  })

  return { ...hook, asked }
}

describe('a bare arrival at the confirmation board', () => {
  it('asks only for the remembered window, never for the default first', async () => {
    remember('this_month')

    const { asked, rerender } = board()

    // The address is replaced, so the question the page ends on is the right one.
    await waitFor(() => expect(nav.search).toBe('preset=this_month'))
    act(() => rerender())

    /*
      ONE. Before the gate this read
        ['{"preset":"today"}', '{"preset":"this_month"}']
      and the first entry is a whole cohort build for a window nobody chose.
    */
    expect(asked).toEqual(['{"preset":"this_month"}'])
  })

  it('does not hold the board when there is nothing to restore', async () => {
    // A first-ever visitor. The gate must clear itself within a tick, or the
    // board waits for a window that is never coming.
    const { asked } = board()

    await waitFor(() => expect(asked).toEqual(['{"preset":"today"}']))
    expect(nav.routed).toEqual([])
  })

  it('never holds an arrival that already carries a window', () => {
    remember('this_month')
    nav.search = 'preset=today&outcomes=CONFIRMED'

    const { result, asked } = board()

    /*
      The common case, and it must cost nothing: every link on this dashboard
      carries a window, so the gate is down from the very first render and the
      request goes out with it. A stored window must not reach into an address
      that states its own — that is the rule `useRestoreRememberedPeriod`
      records, so that a link pasted into Telegram opens on the dates it was
      copied on.
    */
    expect(result.current.awaiting).toBe(false)
    expect(asked).toEqual(['{"preset":"today","outcomes":"CONFIRMED"}'])
    expect(nav.search).toBe('preset=today&outcomes=CONFIRMED')
  })

  it('restores without asking the server for a route it already has', async () => {
    remember('this_month')

    board()

    await waitFor(() => expect(nav.search).toBe('preset=this_month'))
    // The restore is the first thing that happens on a bare arrival, so an RSC
    // round trip here would delay the board's only request by the whole of it.
    expect(nav.routed).toEqual([])
  })
})
