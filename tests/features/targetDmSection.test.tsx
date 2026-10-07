// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * «DM · SAHIFALAR» ON «TARGET TAHLILI» (2026-10-07) is its own request: a
 * failing `/target/dm` fails its section alone, with a retry, and the lead
 * list under it still answers. Its tiles print the server's DM figures.
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

let dmFails = false
const dmRequests: Record<string, unknown>[] = []

const cells = (o: Record<string, number | null>) => ({
  conversations: 0,
  leads: 0,
  qualified: 0,
  spendUsd: 0,
  costPerQualifiedUsd: null,
  qualifiedPercent: null,
  conversationToQualifiedPercent: null,
  costPerConversationUsd: null,
  ...o,
})

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    apiGet: (path: string, params: Record<string, unknown>) => {
      if (path === '/target/leads') {
        return Promise.resolve({
          data: { items: [], pagination: { page: 1, pageSize: 50, totalItems: 7, totalPages: 1 } },
          meta: {},
        })
      }
      if (path === '/target/dm') {
        dmRequests.push(params)
        if (dmFails) return Promise.reject(new Error('DM oʻqilmadi'))
        const total = cells({ conversations: 500, leads: 160, qualified: 70, qualifiedPercent: 43.75, spendUsd: 260, costPerQualifiedUsd: 4.25, costPerConversationUsd: 0.52 })
        return Promise.resolve({
          data: {
            importedAt: null,
            dmSpendUsd: 260,
            dm: {
              total,
              days: [],
              pages: [{ key: 'UC_1X1J24', name: 'sinolifeuz', product: 'Collagen', carriesDmSpend: true, total, days: [] }],
              unattributed: { spendUsd: 0, conversations: 0 },
            },
            products: [],
          },
          meta: {},
        })
      }
      // The overview stays loading: this file is about the DM section.
      return new Promise(() => {})
    },
  }
})

const { TargetPage } = await import('@/features/target/TargetPage')

const mount = () => {
  window.history.replaceState(null, '', '/target?preset=this_month')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TargetPage />
    </QueryClientProvider>,
  )
}

describe('«Target tahlili» — the DM section', () => {
  it('prints the DM tiles from `/target/dm`, asked with the window and the product', async () => {
    dmFails = false
    mount()
    expect(await screen.findByText('1 kval narxi · DM')).toBeTruthy()
    expect(screen.getAllByText('DM · sahifalar boʻyicha').length).toBeGreaterThan(0)
    expect(await screen.findByText(/÷ 70 kval \(sinolifeuz\)/)).toBeTruthy()
    expect(dmRequests.at(-1)).toMatchObject({ preset: 'this_month', product: 'all' })
    expect(dmRequests.at(-1)).not.toHaveProperty('scope')
  })

  it('fails the DM section alone, with a retry, and the lead list still answers', async () => {
    dmFails = true
    mount()
    expect(await screen.findByText('DM oʻqilmadi')).toBeTruthy()
    const section = screen.getByText('DM oʻqilmadi').closest('[role="status"]')!
    expect(within(section as HTMLElement).getByRole('button')).toBeTruthy()
    expect(await screen.findByText('7 ta yozuv · 1/1')).toBeTruthy()
  })
})
