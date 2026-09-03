// @vitest-environment jsdom
import { readFileSync } from 'node:fs'

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/**
 * THE BELL AND THE BOARD BEHIND IT ARE ONE COHORT, OR THE HEADER IS LYING.
 *
 * The badge counts `queuePressure(allTime, …, 'backlog')` — every order still
 * waiting, whenever it arrived. The page it links to answers whichever
 * question its URL asks for, and `queue` is the only thing in that URL that
 * chooses. When the mode switch was removed the link was rewritten to
 * `?outcomes=CONFIRM_NEW`, which narrows the STATE and leaves the board on its
 * own reporting window: the header showed 7 over a board showing 2, both
 * correct, nothing on screen saying they were different questions.
 *
 * Two halves have to hold for that not to come back, and they live in
 * different layers, which is exactly why one was edited without the other:
 * the link has to ASK for the backlog, and the URL vocabulary has to CARRY
 * `queue` through to the API.
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

describe('the header bell links to the board it counts', () => {
  const shell = bare('src/components/layout/Shell.tsx')
  const alerts = bare('src/server/services/alertsService.ts')

  it('asks the confirmation board for the backlog, not for a window', () => {
    const href = /href="(\/confirmation[^"]*)"/.exec(shell)?.[1]
    expect(href).toBeDefined()

    const query = new URLSearchParams(href!.split('?')[1] ?? '')
    expect(query.get('queue')).toBe('backlog')
    /*
      A preset would contradict the mode it arrives with — backlog ignores the
      window, so a date in the link could only mislead whoever pasted it on.
    */
    expect(query.get('preset')).toBeNull()
    expect(query.get('from')).toBeNull()
  })

  it('counts that same backlog in the payload behind the badge', () => {
    expect(alerts).toContain("'backlog'")
    // All time, because the oldest unworked order predates every preset.
    expect(alerts).toContain('allTime(')
  })
})

describe('the queue mode travels in the URL', () => {
  it('reads the backlog mode and forwards it to the API', () => {
    const { result } = filtersFor('queue=backlog')

    expect(result.current.filters.queue).toBe('backlog')
    expect(result.current.apiParams.queue).toBe('backlog')
  })

  it('defaults to the windowed board and sends nothing for it', () => {
    const { result } = filtersFor('preset=today')

    expect(result.current.filters.queue).toBe('window')
    /*
      ABSENT, not 'window'. Every other screen shares this hook, and a
      parameter appearing in their requests would move every react-query key
      on the dashboard for a value none of them read.
    */
    expect(result.current.apiParams).not.toHaveProperty('queue')
  })

  it('falls back rather than forwarding a mode the API would reject', () => {
    for (const bad of ['BACKLOG', 'backlog ', 'all', '']) {
      expect(filtersFor(`queue=${encodeURIComponent(bad)}`).result.current.filters.queue).toBe(
        'window',
      )
    }
  })

  it('is not counted among the filters the clear button offers to remove', () => {
    expect(filtersFor('queue=backlog').result.current.activeCount).toBe(0)
  })

  it('leaves the address bare on the way out, so the remembered window comes back', () => {
    const { result } = filtersFor('queue=backlog')

    /*
      `update({ queue: 'window' })` would WRITE the default rather than remove
      it — `update` only deletes undefined, '' and []. The leftover
      `?queue=window` is not bare, and `useRestoreRememberedPeriod` restores
      only into an address with nothing in it, so the reader coming back from
      the bell would lose the window this section was last read in and land on
      «Bugun».
    */
    act(() => result.current.update({ queue: undefined }))

    expect(nav.replaced).toHaveLength(1)
    expect(new URLSearchParams(nav.replaced[0]!.split('?')[1] ?? '').toString()).toBe('')
  })

  it('survives clearing the filters, because it is a question and not a filter', () => {
    const { result } = filtersFor('queue=backlog&rop=Sevinch&q=944')

    act(() => result.current.reset())

    expect(nav.replaced).toHaveLength(1)
    const kept = new URLSearchParams(nav.replaced[0]!.split('?')[1] ?? '')
    expect(kept.get('queue')).toBe('backlog')
    expect(kept.get('rop')).toBeNull()
    expect(kept.get('q')).toBeNull()
  })
})
