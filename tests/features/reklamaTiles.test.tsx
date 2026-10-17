// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DmCellsDto, ReklamaOverviewDto } from '@/features/reklama/reklamaApi'

/**
 * «Reklama samarasi»'s tiles in three rows (2026-10-17, the user: «Жами
 * реклама / Жами лид (ДМ+ГЕНЛИД) / Жами лид нархи / Жами квал лидлар», then
 * «Ген лид» and «ДМ» each as реклама / сони / квал). «Жами» is Ген + ДМ, the
 * vacancy money named under it and left out; with «Lidlar»'s forms block
 * unread the «Ген» counts and every «Жами» built on them are «—».
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/marketing',
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

vi.mock('@/features/shared/PageShell', () => ({
  PageShell: ({ children }: { children?: unknown }) => <div>{children as React.ReactNode}</div>,
}))

// The tables under the tiles are other files' business.
vi.mock('@/features/reklama/FormSection', () => ({ FormSection: () => null }))
vi.mock('@/features/reklama/QualitySection', () => ({ QualitySection: () => null }))
vi.mock('@/features/reklama/LeadFormSection', () => ({ LeadFormSection: () => null }))

// Reduced motion, so a figure is printed at once rather than counted up to.
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

afterEach(cleanup)

const dmCells = (c: Pick<DmCellsDto, 'leads' | 'qualified' | 'spendUsd'>): DmCellsDto => ({
  ...c,
  conversations: 500,
  costPerQualifiedUsd: c.qualified > 0 ? c.spendUsd / c.qualified : null,
  qualifiedPercent: null,
  conversationToQualifiedPercent: null,
  costPerConversationUsd: null,
})

let overview: ReklamaOverviewDto

const build = (form: { formLeads: number | null; qualified: number | null }): ReklamaOverviewDto => ({
  importedAt: '2026-10-17T09:00:00.000Z',
  window: { from: '2026-10-01', to: '2026-10-17' },
  spend: { totalUsd: 1150, formUsd: 900, dmUsd: 200, hiringUsd: 50, otherUsd: 0 },
  dm: {
    total: dmCells({ leads: 100, qualified: 20, spendUsd: 200 }),
    days: [],
    pages: [
      { key: 'a', name: 'sinolifeuz', product: 'Collagen', carriesDmSpend: true, targetolog: null, total: dmCells({ leads: 100, qualified: 20, spendUsd: 200 }), days: [] },
      // A page with no DM money stays out of every DM tile.
      { key: 'b', name: 'sinogummy', product: 'Collagen', carriesDmSpend: false, targetolog: null, total: dmCells({ leads: 40, qualified: 9, spendUsd: 0 }), days: [] },
    ],
    unattributed: { spendUsd: 0, conversations: 0 },
  },
  form: {
    total: { spendUsd: 900, metaLeads: 1000, costPerLeadUsd: 0.9, impressions: 0, clicks: 0, ctrPercent: null, cpcUsd: null, cpmUsd: null },
    ...form,
    days: [],
    owners: [],
  },
  quality: {
    total: { leads: 1000, noAnswer: 0, lowQuality: 0, success: 250, duplicate: 0, open: 0, successPercent: 25 },
    days: [],
    pages: [],
    stages: [],
  },
  leadForms: [],
})

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, apiGet: () => Promise.resolve({ data: overview, meta: {} }) }
})

const { ReklamaPage } = await import('@/features/reklama/ReklamaPage')

function mount(o: ReklamaOverviewDto) {
  overview = o
  window.history.replaceState(null, '', '/marketing')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ReklamaPage />
    </QueryClientProvider>,
  )
}

/** The tile's whole text, found by its label. */
const tile = (label: string) => screen.getByText(label, { selector: 'p' }).closest('.card')?.textContent ?? ''

describe('«Reklama samarasi» tiles', () => {
  it('sums Ген + ДМ into «Жами» and prices the leads with that money alone', async () => {
    mount(build({ formLeads: 1000, qualified: 150 }))
    await screen.findByText('Жами реклама', { selector: 'p' })
    await vi.waitFor(() => expect(tile('Жами лид')).toContain('1,100'))

    expect(tile('Жами реклама')).toContain('1,100')
    expect(tile('Жами реклама')).toContain('vakansiya kirmaydi')
    expect(tile('Жами лид')).toContain('1,000 ген + 100 ДМ')
    expect(tile('Жами лид нархи')).toContain('1.00')
    expect(tile('Жами квал лидлар')).toContain('170')

    expect(tile('Ген лид реклама')).toContain('900')
    expect(tile('Ген лид сони')).toContain('1,000')
    expect(tile('Ген лид квал')).toContain('150')

    expect(tile('ДМ лид реклама')).toContain('200')
    expect(tile('ДМ лид сони')).toContain('100')
    expect(tile('ДМ квал')).toContain('20')
    expect(tile('ДМ лид нархи')).toContain('2.00')
    expect(tile('ДМ квал нархи')).toContain('10.00')
    expect(tile('Lid → kval')).toContain('25')
  })

  it('prints «—» for the Ген counts and every «Жами» on them when the forms block was not read', async () => {
    mount(build({ formLeads: null, qualified: null }))
    await vi.waitFor(() => expect(tile('ДМ лид сони')).toContain('100'))

    for (const label of ['Жами лид', 'Жами лид нархи', 'Жами квал лидлар', 'Ген лид сони', 'Ген лид квал']) {
      expect(tile(label), label).toContain('—')
    }
    expect(tile('Жами лид')).toContain('oʻqilmadi')
    // The money is Meta's and is still there.
    expect(tile('Жами реклама')).toContain('1,100')
  })
})
