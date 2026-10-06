// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE SEARCH BOX NEVER SENDS A TERM OF NOTHING BUT SPACES.
 *
 * A space typed into Тасдиклаш's box and left for the 350 ms debounce went
 * out as `?q=%20`, and every request on the page answered 400 — the table,
 * the six tiles, the region list — until somebody cleared the box. The server
 * reads a blank term as none now too (`filtering.test.ts`); this is the
 * address side. A real term is written AS TYPED: the box re-reads the address,
 * so a trimmed «ali» would eat the space a reader is in the middle of typing.
 */

/** The address the page was opened on — bare unless a test says otherwise. */
const address = vi.hoisted(() => ({ search: '' }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/confirmation',
  useSearchParams: () => new URLSearchParams(address.search),
}))

const { PageShell } = await import('@/features/shared/PageShell')
const { useDashboardFilters } = await import('@/features/shared/useDashboardFilters')

let written: string[] = []

beforeEach(() => {
  written = []
  address.search = ''
  // `/confirmation` is a shallow route: the address is written with `replaceState`.
  vi.spyOn(window.history, 'replaceState').mockImplementation((_state, _unused, url) => {
    written.push(String(url))
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function type(term: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false } } })
  render(
    <QueryClientProvider client={client}>
      <PageShell title="Tasdiqlash navbati" description={null} filters={{ search: true }}>
        {null}
      </PageShell>
    </QueryClientProvider>,
  )
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: term } })
}

describe('the search box', () => {
  it('writes no `q` for a term of nothing but spaces', async () => {
    type('   ')
    await waitFor(() => expect(written.length).toBeGreaterThan(0))
    expect(written.at(-1)).not.toContain('q=')
  })

  it('writes a real term as typed, its trailing space included', async () => {
    type('ali ')
    await waitFor(() => expect(written.length).toBeGreaterThan(0))
    expect(new URL(written.at(-1)!, 'http://x').searchParams.get('q')).toBe('ali ')
  })

  it('reads an old link’s `?q=%20` as no search — nothing in the box, nothing counted, nothing sent', () => {
    address.search = 'q=%20'
    const blank = renderHook(() => useDashboardFilters()).result.current
    expect(blank.filters.q).toBeUndefined()
    expect(blank.activeCount).toBe(0)
    expect(blank.apiParams.q).toBeUndefined()

    // A real term is still read as typed.
    address.search = 'q=ali%20'
    expect(renderHook(() => useDashboardFilters()).result.current.filters.q).toBe('ali ')
  })
})
