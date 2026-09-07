// @vitest-environment jsdom
import { readFileSync } from 'node:fs'

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CONFIRMATION_QUEUE_MODES as CLIENT_MODES } from '@/lib/api'
import { CONFIRMATION_QUEUE_MODES as SERVER_MODES } from '@/server/domain/types'

/**
 * «ЖАМИ» — THE BOARD WITH NO DATES AT ALL.
 *
 * The third question this screen answers. The operators asked for it by name:
 * a customer on the line does not say which month their order reached
 * Тасдиклаш, and stepping Bugun → Kecha → Shu oy → Sana to find one row is not
 * a search. It is a MODE, not a preset — there is no window to resolve.
 *
 * It is assembled from four layers that can each be edited alone, which is why
 * each one is pinned here: the vocabulary (both sides of a hand-mirrored
 * union), the URL, the span the API answers over, and the control on screen.
 */

const nav = vi.hoisted(() => ({ search: '', replaced: [] as string[] }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: (url: string) => nav.replaced.push(url),
    push: (url: string) => nav.replaced.push(url),
  }),
  usePathname: () => '/confirmation',
  useSearchParams: () => new URLSearchParams(nav.search),
}))

const { useDashboardFilters } = await import('@/features/shared/useDashboardFilters')

function filtersFor(search: string) {
  nav.search = search
  nav.replaced = []
  return renderHook(() => useDashboardFilters())
}

/** Assertions about source read the code, never the prose explaining it. */
const bare = (path: string) =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

describe('the mode exists on both sides of the mirror', () => {
  /*
    `src/lib/roles.ts`, `src/lib/dataScope.ts` and this union restate types
    from `@/server/domain/types` by hand, and NOTHING checks the mirror — the
    architecture note says so in as many words. A mode added on the server and
    forgotten in `@/lib/api` is a control that 400s the whole page the first
    time somebody clicks it.
  */
  it('names the same three questions in the same order', () => {
    expect([...CLIENT_MODES]).toEqual([...SERVER_MODES])
  })

  it('includes the all-orders board', () => {
    expect(SERVER_MODES).toContain('all')
  })
})

describe('the mode travels in the URL', () => {
  it('is read and forwarded to the API', () => {
    const { result } = filtersFor('queue=all')

    expect(result.current.filters.queue).toBe('all')
    expect(result.current.apiParams.queue).toBe('all')
  })

  it('survives clearing the filters, because it is a question and not a filter', () => {
    const { result } = filtersFor('queue=all&rop=Sevinch&q=944')

    act(() => result.current.reset())

    const kept = new URLSearchParams(nav.replaced[0]!.split('?')[1] ?? '')
    expect(kept.get('queue')).toBe('all')
    expect(kept.get('rop')).toBeNull()
  })

  it('is not counted among the filters the clear button offers to remove', () => {
    expect(filtersFor('queue=all').result.current.activeCount).toBe(0)
  })

  it('LEAVES when a date is picked, so no preset can light over an all-time board', () => {
    /*
      «Жами» sits in the same control as the presets, so clicking «Bugun» while
      it is on is a request for today. Without this the board stayed unbounded
      with «Bugun» lit above it — a screen contradicting its own control.
    */
    const { result } = filtersFor('queue=all&preset=this_month')

    act(() => result.current.setPeriod({ preset: 'today' }))

    const next = new URLSearchParams(nav.replaced[0]!.split('?')[1] ?? '')
    expect(next.get('preset')).toBe('today')
    expect(next.get('queue')).toBeNull()
  })

  it('leaves the backlog alone when a date is picked', () => {
    /*
      Backlog mode hides the period control, so this cannot happen through the
      UI — but clearing `queue` blind here would be a way for a later caller to
      lose the board the header bell links to.
    */
    const { result } = filtersFor('queue=backlog')

    act(() => result.current.setPeriod({ preset: 'today' }))

    expect(new URLSearchParams(nav.replaced[0]!.split('?')[1] ?? '').get('queue')).toBe('backlog')
  })
})

describe('the API answers it over an unbounded span', () => {
  const route = bare('src/app/api/v1/insights/confirmations/orders/route.ts')
  const service = bare('src/server/services/insightsService.ts')
  const repository = bare('src/server/repositories/insightsRepository.ts')

  it('drops the reporting window for the all-orders board', () => {
    expect(route).toMatch(/ctx\.query\.q \|\| ctx\.query\.queue === 'all'/)
    expect(route).toContain('allTime(ctx.timeZone)')
  })

  it('says "only window reads the period" rather than listing the exceptions', () => {
    /*
      A fourth mode added to the union would otherwise arrive silently bounded
      by a window it never meant to read, and the symptom is a board quietly
      missing rows — the one thing this screen must not do.
    */
    expect(service).toContain("mode === 'window' ? this.window(period, scope)")
  })

  it('keeps ONE windowed cohort, so all and window cannot drift apart', () => {
    /*
      Three modes, two branches: 'all' is the windowed cohort read over an
      unbounded span. A branch of its own would be a third definition of "an
      order is on this board".
    */
    const queueSql = repository.slice(
      repository.indexOf('private static queueSql'),
      repository.indexOf('async queuePressure'),
    )
    expect(queueSql).not.toBe('')
    expect(queueSql).not.toContain("=== 'all'")
    expect(queueSql.match(/mode === 'backlog'/g)).toHaveLength(2)
  })
})

describe('the control says which board is on screen', () => {
  const page = bare('src/features/confirmation/ConfirmationPage.tsx')

  it('puts the chip with the presets, not among the filters', () => {
    expect(page).toContain('periodExtra={')
    expect(page).toContain("label: 'Jami'")
  })

  it('toggles, so the same chip is the way back', () => {
    expect(page).toContain("onSelect: () => update({ queue: allOrders ? undefined : 'all' })")
  })

  it('is not offered on the backlog, which is unbounded already', () => {
    expect(page).toMatch(/periodExtra=\{\s*backlog\s*\?\s*undefined/)
  })

  it('never prints a date line the rows may not obey', () => {
    /*
      Suppressed outright today — another pass decided the preset row already
      says which window is on screen, so the resolved dates beside the
      description only restated a control the reader is looking at.

      The invariant this pins is the one that has a failure behind it, not that
      decision: if a date line ever comes back, it must be guarded by EVERY
      mode that answers over an unbounded span, or the search results carry
      «01.01.1970 – 31.12.2099» under the title.
    */
    const passed = /meta=\{([^}]+)\}/.exec(page)?.[1]?.trim()
    expect(passed).toBeDefined()
    if (passed !== 'undefined') {
      expect(passed).toContain('globalSearch')
      expect(passed).toContain('allOrders')
    }
  })

  it('does not dim the preset row while its own chip is lit', () => {
    // A lit-but-faded control reads as broken; the unlit presets beside it
    // already say no window is in force.
    expect(page).toContain('periodMuted={globalSearch && !allOrders}')
  })
})

describe('the preset group lights exactly one chip', () => {
  const control = bare('src/components/layout/PeriodFilter.tsx')

  it('unlights every date preset while the extra chip is active', () => {
    expect(control).toContain('const active = preset === value && !extra?.active')
  })

  it('unlights the picker too, so a custom window cannot claim dates', () => {
    expect(control).toContain("const custom = value === 'custom' && !extra?.active")
  })
})
