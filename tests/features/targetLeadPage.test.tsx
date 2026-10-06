// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * «LEADLAR ROʻYXATI» STARTS AGAIN AT PAGE 1 IN A NEW WINDOW (2026-10-06).
 *
 * The page number is the screen's own state, not the URL's, so nothing reset
 * it when the dashboard period changed: page 3 of «Shu oy» was asked of
 * «Bugun», whose 40 leads have one page, and the table said «Bu davrda lead
 * yoʻq» under «40 ta yozuv · 3/1». The same list can also shrink under an
 * unchanged window («Bugun» past midnight): the page then goes to the last one.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/target',
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

vi.mock('@/features/shared/PageShell', () => ({
  PageShell: ({ children }: { children?: unknown }) => <div>{children as React.ReactNode}</div>,
}))

window.matchMedia = ((query: string) => ({
  matches: query.includes('prefers-reduced-motion'),
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

// The lead table measures its pinned columns; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView = () => {}

afterEach(cleanup)

const leadRequests: Record<string, unknown>[] = []
// «Shu oy»'s lead count; a case lowers it to shrink the list under an unchanged window.
let monthItems = 150

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    apiGet: (path: string, params: Record<string, unknown>) => {
      // The overview stays loading: this file is about the lead list's page.
      if (path !== '/target/leads') return new Promise(() => {})
      leadRequests.push(params)
      const month = params.preset === 'this_month'
      const totalItems = month ? monthItems : 40
      return Promise.resolve({
        data: {
          items: [],
          pagination: { page: params.page, pageSize: 50, totalItems, totalPages: Math.ceil(totalItems / 50) },
        },
        meta: {},
      })
    },
  }
})

const { TargetPage } = await import('@/features/target/TargetPage')

describe('«Leadlar roʻyxati» — the page number', () => {
  it('goes back to page 1 when the dashboard window changes, and never asks the new window for the old page', async () => {
    window.history.replaceState(null, '', '/target?preset=this_month')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // A fresh element each time: React does not re-render an identical one, and the new address must be read.
    const tree = () => (
      <QueryClientProvider client={client}>
        <TargetPage />
      </QueryClientProvider>
    )
    const { rerender } = render(tree())

    expect(await screen.findByText('150 ta yozuv · 1/3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keyingi' }))
    expect(await screen.findByText('150 ta yozuv · 2/3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keyingi' }))
    expect(await screen.findByText('150 ta yozuv · 3/3')).toBeTruthy()

    leadRequests.length = 0
    window.history.replaceState(null, '', '/target?preset=today')
    rerender(tree())

    expect(await screen.findByText('40 ta yozuv · 1/1')).toBeTruthy()
    await waitFor(() => expect(leadRequests.some((p) => p.preset === 'today')).toBe(true))
    expect(leadRequests.filter((p) => p.preset === 'today').map((p) => p.page)).toEqual([1])
  })

  it('goes to the last page there is when the same window\'s list shrinks under it', async () => {
    monthItems = 150
    window.history.replaceState(null, '', '/target?preset=this_month')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <TargetPage />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('150 ta yozuv · 1/3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keyingi' }))
    expect(await screen.findByText('150 ta yozuv · 2/3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keyingi' }))
    expect(await screen.findByText('150 ta yozuv · 3/3')).toBeTruthy()

    // The same window answers 40 leads now — one page — and the address has not moved.
    monthItems = 40
    leadRequests.length = 0
    await act(() => client.refetchQueries({ queryKey: ['target-leads'], type: 'active' }))

    expect(await screen.findByText('40 ta yozuv · 1/1')).toBeTruthy()
    await waitFor(() => expect(leadRequests.map((p) => p.page)).toEqual([3, 1]))
  })
})
