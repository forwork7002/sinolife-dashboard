// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AiRegistratorPage } from '@/features/aiRegistrator/AiRegistratorPage'

/** «AI registrator» under «Lidlar»: the calls, AI vs the registrars, the sellers, the tries, the leads one by one. */

afterEach(cleanup)

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

vi.mock('@/features/shared/useDashboardFilters', () => ({
  useDashboardFilters: () => ({ apiParams: { preset: 'today' } }),
}))
vi.mock('@/features/shared/PageShell', () => ({
  PageShell: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}))

const money = (amount: number) => ({ amountMinor: String(amount * 100), currency: 'UZS', amount })
const group = (leads: number, ordered: number, sold: number) => ({
  leads,
  withSalesDeal: ordered,
  ordered,
  orderSum: money(ordered * 500_000),
  sold,
  soldSum: money(sold * 450_000),
  lost: 0,
  noDeal: leads - ordered,
  orderedRateBp: leads === 0 ? null : (ordered / leads) * 10_000,
  soldRateBp: leads === 0 ? null : (sold / leads) * 10_000,
  soldPerLead: leads === 0 ? null : money((sold * 450_000) / leads),
  medianHoursToOrder: ordered > 0 ? 3 : null,
})

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    apiGet: async (path: string, params: Record<string, unknown>) => {
      if (path === '/leads/ai-registrator/calls') {
        asked.push(params)
        return { data: CALLS, meta: {} }
      }
      return REPORT
    },
  }
})

const asked = vi.hoisted(() => [] as Record<string, unknown>[])

const CALLS = {
  total: 1,
  rows: [
    {
      callId: 'call-1',
      dealId: '1001',
      title: 'Aziza',
      phone: '998901234567',
      at: '2026-10-22T07:00:00.000Z',
      answeredAt: '2026-10-22T07:00:05.000Z',
      durationSec: 84,
      attempt: 2,
      outcome: 'interested_transferred',
      transferredTo: '115',
      seller: 'Sirojov 115 Davlatbek',
      attempts: [
        { ext: '112', name: 'Karimova 112 Malika', result: 'busy', at: null },
        { ext: '114', name: null, result: 'rejected', at: null, ringSec: 4 },
        { ext: '116', name: null, result: 'no_answer', at: null, ringSec: 15 },
        { ext: '115', name: 'Sirojov 115 Davlatbek', result: 'answered', at: null, ringSec: 6 },
      ],
      notes: [
        { key: 'problem', value: 'Boʻgʻim' },
        { key: 'region', value: 'Samarqand' },
        { key: 'for_whom', value: 'relative' },
      ],
      lead: { pipeline: 'Регистрация', stage: 'Обработка', status: 'OPEN' },
      verdict: 'ordered',
      sales: [],
      soldBy: null,
    },
  ],
}

const REPORT = {
      data: {
        funnel: { calls: 12, deals: 10, answered: 8, tests: 2, byOutcome: { interested_transferred: 3, transfer_failed: 1, no_answer: 4, not_interested: 4 } },
        ai: group(3, 2, 1),
        classic: group(40, 10, 4),
        sellers: [
          { key: 'e115', employeeId: 'e115', name: 'Sirojov 115 Davlatbek', ext: '115', ai: group(2, 2, 1), classic: group(5, 1, 0) },
          { key: 'e112', employeeId: 'e112', name: 'Karimova 112 Malika', ext: '112', ai: group(1, 0, 0), classic: group(3, 1, 1) },
        ],
        extensions: [{ ext: '115', name: 'Sirojov 115 Davlatbek', tried: 4, answered: 2, busy: 2, noAnswer: 0, failed: 0 }],
        deals: [
          {
            dealId: '1001',
            title: 'Aziza',
            phone: '+998901234567',
            at: '2026-10-22T07:00:00.000Z',
            outcome: 'interested_transferred',
            transferredTo: '115',
            seller: 'Sirojov 115 Davlatbek',
            attempts: [
              { ext: '112', result: 'busy' },
              { ext: '115', result: 'answered' },
            ],
            problem: 'Boʻgʻim',
            summary: null,
            lead: { pipeline: 'Регистрация', stage: 'Обработка', status: 'OPEN' },
            sales: [{ dealId: '2002', pipeline: 'Тасдиклаш', stage: 'Заказ тасдиклаш', status: 'OPEN', amount: money(500_000), createdAt: '2026-10-22T08:00:00.000Z' }],
            soldBy: null,
            verdict: 'ordered',
          },
          {
            dealId: '1002',
            title: 'Bekzod',
            phone: '+998907654321',
            at: '2026-10-22T06:00:00.000Z',
            outcome: 'transfer_failed',
            transferredTo: null,
            seller: null,
            attempts: [{ ext: '115', result: 'no_answer' }],
            problem: null,
            summary: null,
            lead: null,
            sales: [],
            soldBy: null,
            verdict: 'not_transferred',
          },
        ],
        enoughToCompare: false,
        minLeads: 20,
        followDays: 30,
        slackMinutes: 10,
      },
      meta: {},
    }

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AiRegistratorPage />
    </QueryClientProvider>,
  )
}

describe('AiRegistratorPage', () => {
  it('sets the AI path beside the registrars and says the sample is too small to decide', async () => {
    renderPage()
    const table = await screen.findByRole('table', { name: 'AI ulab berdi vs oddiy registrator' })
    const ai = within(table).getByRole('rowheader', { name: 'AI → sotuvchi (jonli ulash)' }).closest('tr')!
    expect(within(ai).getByText('66.7%')).toBeTruthy()
    expect(screen.getByText(/Xulosa uchun hali erta/)).toBeTruthy()
  })

  it('lists each lead with its tries, its seller and what followed, and filters the failed ones', async () => {
    renderPage()
    const deals = await screen.findByRole('table', { name: 'Lidlar — bitimma-bitim' })
    expect(within(deals).getByText('112 band (boshqa qoʻngʻiroqda) → 115 koʻtardi')).toBeTruthy()
    expect(within(deals).getByText('Buyurtma bor')).toBeTruthy()
    expect(within(deals).getByText('Ulanmadi — sotuvchi javob bermadi')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Ulanmaganlar' }))
    expect(within(deals).queryByText('Aziza')).toBeNull()
    expect(within(deals).getByText('Bekzod')).toBeTruthy()
  })
})

describe('AiRegistratorPage — every number opens its calls', () => {
  it('opens a tile’s calls with each phone, the extensions tried and whose they are, and what the agent wrote', async () => {
    asked.length = 0
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Sotuvchiga ulandi — qoʻngʻiroqlar roʻyxatini ochish' }))
    const drawer = await screen.findByRole('dialog')
    expect(await within(drawer).findByText('+998 90 123 45 67')).toBeTruthy()
    expect(within(drawer).getByText('Karimova 112 Malika')).toBeTruthy()
    expect(within(drawer).getByText('— band — boshqa qoʻngʻiroqda')).toBeTruthy()
    // a seller who pressed the red button is not «band», and each try says how long it rang
    expect(within(drawer).getByText('— rad etdi (qizil tugma) · 4 s da')).toBeTruthy()
    expect(within(drawer).getByText('— koʻtarmadi · 15 s jiringladi')).toBeTruthy()
    expect(within(drawer).getByText('— koʻtardi · 6 s da')).toBeTruthy()
    expect(within(drawer).getByText('Samarqand')).toBeTruthy()
    expect(within(drawer).getByText('Hudud:')).toBeTruthy()
    // The agent's English enumerations read in the floor's words.
    expect(within(drawer).getByText('qarindoshi uchun')).toBeTruthy()
    expect(within(drawer).getByText('Natija: Buyurtma bor')).toBeTruthy()
    expect(within(drawer).getByText(/gaplashdi 1:24 · 2-urinish/)).toBeTruthy()
    expect(asked.at(-1)).toMatchObject({ preset: 'today', kind: 'outcome', outcome: 'interested_transferred' })
  })

  it('opens a result row, a seller’s AI leads and an extension’s tries with their own filters', async () => {
    asked.length = 0
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Koʻtarmadi' }))
    await screen.findByRole('dialog')
    expect(asked.at(-1)).toMatchObject({ kind: 'outcome', outcome: 'no_answer' })
    fireEvent.click(screen.getByRole('button', { name: 'Yopish' }))

    const sellers = screen.getByRole('table', { name: 'Sotuvchilar boʻyicha' })
    fireEvent.click(within(within(sellers).getByRole('rowheader', { name: /Sirojov/ }).closest('tr')!).getByRole('button', { name: '2' }))
    await screen.findByRole('dialog')
    expect(asked.at(-1)).toMatchObject({ kind: 'seller', seller: 'e115' })
    fireEvent.click(screen.getByRole('button', { name: 'Yopish' }))

    const tries = screen.getByRole('table', { name: 'Ulash urinishlari' })
    fireEvent.click(within(tries).getByRole('button', { name: '4' }))
    await screen.findByRole('dialog')
    expect(asked.at(-1)).toMatchObject({ kind: 'ext', ext: '115' })
  })
})
