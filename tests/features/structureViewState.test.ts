// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/**
 * TWO NEW URL KEYS, AND NEITHER MAY REACH THE API.
 *
 * `view` chooses which rendering of the org chart is on screen and `dep`
 * chooses which department's panel is open. Both are in the URL so a link
 * somebody pastes into Telegram opens on what was copied — the rule every
 * other view decision on this dashboard follows.
 *
 * The hazard is that `useDashboardFilters` builds `apiParams` from the same
 * object, and `apiParams` is the react-query KEY. A view key that leaked into
 * it would split one cached answer into two and refetch the whole tree on
 * every toggle — while the two renderings are, by design, two drawings of one
 * request. `dep` is worse: it changes on every card click.
 */

const replace = vi.fn()
let search = ''

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: () => {} }),
  usePathname: () => '/structure',
  useSearchParams: () => new URLSearchParams(search),
}))

const { STRUCTURE_VIEWS, useDashboardFilters } = await import(
  '@/features/shared/useDashboardFilters'
)

/** The hook's whole return value: `{ filters, update, reset, apiParams, … }`. */
function filters(query: string) {
  search = query
  return renderHook(() => useDashboardFilters()).result.current
}

describe('org chart view state', () => {
  it('defaults to the chart', () => {
    expect(filters('').filters.view).toBe('chart')
    expect(STRUCTURE_VIEWS).toEqual(['chart', 'list'])
  })

  it('honours a named view and falls back for anything else', () => {
    expect(filters('view=list').filters.view).toBe('list')
    // Same rule as `preset` and `queue`: the address bar is not a value this
    // hook may trust. An unknown one used to be a blank region of page with no
    // control on screen able to put it right.
    expect(filters('view=kanban').filters.view).toBe('chart')
    expect(filters('view=').filters.view).toBe('chart')
  })

  it('reads the open department off the URL', () => {
    expect(filters('dep=abc123').filters.dep).toBe('abc123')
    expect(filters('').filters.dep).toBeUndefined()
  })

  it('keeps both out of the API request', () => {
    const params = filters('view=list&dep=abc123&preset=this_month').apiParams
    expect(params).not.toHaveProperty('view')
    expect(params).not.toHaveProperty('dep')
    expect(params.preset).toBe('this_month')
  })

  /**
   * The «Filtrlarni tozalash (N)» button counts what it will clear, and
   * neither of these is a filter — one is a mode, the other a selection.
   */
  it('counts neither as an active filter', () => {
    expect(filters('view=list&dep=abc123').activeCount).toBe(0)
    expect(filters('view=list&dep=abc123&rop=Sevinch').activeCount).toBe(1)
  })

  /**
   * `reset()` keeps the MODE and drops the SELECTION.
   *
   * Clearing the filters must not silently swap the reading the person is
   * looking at — that is the same reasoning that keeps `queue` — but a panel
   * is one click from being reopened and nothing is lost by closing it.
   */
  it('keeps view and drops dep on reset', () => {
    replace.mockClear()
    filters('view=list&dep=abc123&preset=this_month&rop=Sevinch').reset()

    const [url] = replace.mock.calls[0] as [string]
    const kept = new URLSearchParams(url.split('?')[1] ?? '')
    expect(kept.get('view')).toBe('list')
    expect(kept.get('preset')).toBe('this_month')
    expect(kept.get('dep')).toBeNull()
    expect(kept.get('rop')).toBeNull()
  })
})
