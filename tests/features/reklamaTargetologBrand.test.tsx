// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FormDayDto, FormOwnerDto } from '@/features/leads/leadSourcesApi'

/**
 * «TARGETOLOGLAR · KUNLIK» UNDER THE BRAND SWITCH (2026-10-06).
 *
 * The card used to be asked for without the brand and narrowed in the
 * browser by each owner's product, so a CRM form naming no targetolog
 * («Boshqa» by its name) showed under «Brendsiz» although «Lidlar» — and
 * `leadBrand` — file its leads under Collagen. Now the brand rides the
 * request, the server narrows by «Lidlar»'s rules, and every card it returns
 * is drawn; with both brands the product picker still chooses.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/marketing',
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

// The page's tables measure their pinned columns; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

afterEach(cleanup)

const day = (date: string): FormDayDto => ({
  date,
  spendUsd: 0,
  metaLeads: 0,
  leads: 0,
  success: 0,
  formUsd: 0,
  siteUsd: 0,
  siteLeads: 0,
  smsUsd: 0,
  smsCount: 0,
  hrUsd: 0,
  otherUsd: 0,
  totalUsd: 0,
})

const owner = (o: Pick<FormOwnerDto, 'key' | 'targetolog' | 'product'> & { spendUsd: number; leads: number }): FormOwnerDto => ({
  ...o,
  forms: [],
  accounts: [],
  metaLeads: 0,
  formUsd: o.spendUsd,
  siteUsd: 0,
  siteLeads: 0,
  smsUsd: 0,
  smsCount: 0,
  hrUsd: 0,
  otherUsd: 0,
  totalUsd: o.spendUsd,
  outcome: { leads: o.leads, success: 0, noAnswer: o.leads, lowQuality: 0, duplicate: 0, open: 0, successPercent: 0 },
  reachPercent: null,
  costPerLeadUsd: null,
  costPerSuccessUsd: null,
  days: [day('2026-10-06')],
})

// What the server answers for Collagen: Umar's card, and the unnamed form whose leads `leadBrand` files under Collagen.
const OWNERS = [
  owner({ key: 'Collagen|Umar', targetolog: 'Umar', product: 'Collagen', spendUsd: 20, leads: 5 }),
  owner({ key: 'form|Sinolife filtr forma 3', targetolog: 'Sinolife filtr forma 3', product: 'Boshqa', spendUsd: 0, leads: 9 }),
]

const requests: { path: string; params: Record<string, unknown> }[] = []

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    apiGet: (path: string, params: Record<string, unknown>) => {
      requests.push({ path, params })
      // The ad sheets stay loading: this file is about the targetolog cards.
      if (path === '/reklama/overview') return new Promise(() => {})
      return Promise.resolve({
        data: { forms: { owners: OWNERS, days: [], spendUsd: 20, metaLeads: 0, outcome: OWNERS[0]!.outcome }, importedAt: null },
        meta: {},
      })
    },
  }
})

const { ReklamaPage } = await import('@/features/reklama/ReklamaPage')

function mount(search: string) {
  window.history.replaceState(null, '', `/marketing${search}`)
  requests.length = 0
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ReklamaPage />
    </QueryClientProvider>,
  )
}

const cardTitles = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent ?? '')

describe('«Targetologlar · kunlik» — the brand switch', () => {
  it('asks for the brand and draws every card the server returns for it, a «Boshqa» form included', async () => {
    mount('?brand=Collagen')
    expect(await screen.findByRole('table', { name: /Sinolife filtr forma 3/ })).toBeTruthy()
    const asked = requests.find((r) => r.path === '/reklama/targetologs')!
    expect(asked.params).toMatchObject({ brand: 'Collagen' })
    expect(cardTitles().some((t) => t.startsWith('Umar'))).toBe(true)
    expect(cardTitles().some((t) => t.startsWith('Sinolife filtr forma 3'))).toBe(true)
    // The page's switch wins: no product picker beside it.
    expect(screen.queryByRole('group', { name: 'Qaysi mahsulot' })).toBeNull()
  })

  it('with both brands asks for no brand and lets the picker choose one product', async () => {
    mount('')
    expect(await screen.findByRole('table', { name: /Umar/ })).toBeTruthy()
    const asked = requests.find((r) => r.path === '/reklama/targetologs')!
    expect(asked.params).not.toHaveProperty('brand')
    expect(screen.getByRole('group', { name: 'Qaysi mahsulot' })).toBeTruthy()
    expect(cardTitles().some((t) => t.startsWith('Sinolife filtr forma 3'))).toBe(false)
  })
})
