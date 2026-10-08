// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FormDayDto, FormOwnerDto } from '@/features/leads/leadSourcesApi'
import type { SideColumnDto } from '@/features/reklama/reklamaApi'

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
  usePathname: () => '/leads',
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

// The tabs ride the shell's `actions`: drawn here so a test can press «Targetologlar».
vi.mock('@/features/shared/PageShell', () => ({
  PageShell: ({ children, actions }: { children?: unknown; actions?: unknown }) => (
    <div>
      {actions as React.ReactNode}
      {children as React.ReactNode}
    </div>
  ),
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

// The cards with no form money (`forms.expenseOwners`): none, unless a test hands some.
let expenseOwners: FormOwnerDto[] = []
// «HR · Kosmetika» (`side`), the strip's last card: none, unless a test hands some.
let side: SideColumnDto[] = []

const requests: { path: string; params: Record<string, unknown> }[] = []

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    apiGet: (path: string, params: Record<string, unknown>) => {
      requests.push({ path, params })
      // «Lid manbalari» stays loading: this file is about the targetolog cards.
      if (path !== '/reklama/targetologs') return new Promise(() => {})
      return Promise.resolve({
        data: {
          forms: { owners: OWNERS, expenseOwners, days: [], spendUsd: 20, metaLeads: 0, outcome: OWNERS[0]!.outcome },
          importedAt: null,
          manual: [],
          side,
          canEdit: false,
          today: '2026-10-07',
        },
        meta: {},
      })
    },
  }
})

const { LeadsPage } = await import('@/features/leads/LeadsPage')
const { TargetologDaySection } = await import('@/features/reklama/TargetologDaySection')

/** «Lidlar» on its «Targetologlar» tab — where the strip lives since 2026-10-08. */
function mount(search: string) {
  window.history.replaceState(null, '', `/leads${search}`)
  requests.length = 0
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <LeadsPage />
    </QueryClientProvider>,
  )
  // The page's tabs, not «Lid manbalari»'s own «Targetologlar» table switch.
  fireEvent.click(within(screen.getByRole('group', { name: 'Qaysi jadvallar' })).getByRole('button', { name: 'Targetologlar' }))
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
    // Hiring is no brand's budget: the hint says why «HR $» is empty and what «Jami $» holds here.
    expect(screen.getByText(/Brend tanlanganda Jami \$ — faqat shu tanlovning puli\./)).toBeTruthy()
  })

  it('with both brands asks for no brand and lets the picker choose one product', async () => {
    mount('')
    expect(await screen.findByRole('table', { name: /Umar/ })).toBeTruthy()
    const asked = requests.find((r) => r.path === '/reklama/targetologs')!
    expect(asked.params).not.toHaveProperty('brand')
    expect(screen.getByRole('group', { name: 'Qaysi mahsulot' })).toBeTruthy()
    expect(cardTitles().some((t) => t.startsWith('Sinolife filtr forma 3'))).toBe(false)
    // With both brands «Jami $» is every dollar the accounts spent, HR included: no brand note.
    expect(screen.queryByText(/Brend tanlanganda/)).toBeNull()
  })
})

describe('«Targetologlar · kunlik» — a card with no form money (2026-10-07)', () => {
  it('draws an owner whose money is all hiring beside the targetologs, after them', async () => {
    expenseOwners = [{ ...owner({ key: 'Boshqa|Элдор', targetolog: 'Элдор', product: 'Boshqa', spendUsd: 0, leads: 0 }), hrUsd: 3, totalUsd: 3 }]
    try {
      mount('?brand=none')
      expect(await screen.findByRole('table', { name: /Элдор/ })).toBeTruthy()
      const titles = cardTitles()
      expect(titles.findIndex((t) => t.startsWith('Элдор'))).toBeGreaterThan(titles.findIndex((t) => t.startsWith('Umar')))
    } finally {
      expenseOwners = []
    }
  })
})

describe('«Targetologlar · kunlik» — «HR · Kosmetika» as the strip\'s last card (2026-10-07)', () => {
  const draw = (brand: 'all' | 'none' | 'Collagen') => {
    // The strip's own request carries the side table since 2026-10-08 (no second request on «Lidlar»).
    side = [
      { key: 'hr', name: 'HR', totalUsd: 9.12, days: [{ date: '2026-10-06', spendUsd: 9.12 }] },
      { key: 'kosmetika', name: 'Kosmetika', totalUsd: 0, days: [{ date: '2026-10-06', spendUsd: 0 }] },
    ]
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <TargetologDaySection params={{ preset: 'yesterday' }} brand={brand} />
      </QueryClientProvider>,
    )
  }
  afterEach(() => {
    side = []
  })

  it('closes the strip, after the targetologs, under «Hammasi» and «Brendsiz»', async () => {
    for (const brand of ['all', 'none'] as const) {
      cleanup()
      draw(brand)
      expect(await screen.findByRole('table', { name: 'HR · Kosmetika — kunlik' })).toBeTruthy()
      const titles = cardTitles()
      expect(titles.at(-1)).toMatch(/^HR · Kosmetika/)
    }
  })

  it('is not drawn under one brand — the money is no brand\'s', async () => {
    draw('Collagen')
    expect(await screen.findByRole('table', { name: /Umar/ })).toBeTruthy()
    expect(screen.queryByRole('table', { name: 'HR · Kosmetika — kunlik' })).toBeNull()
  })
})
