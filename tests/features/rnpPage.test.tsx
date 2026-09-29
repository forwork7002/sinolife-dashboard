// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RnpOverviewDto, RnpRowDto } from '@/features/rnp/rnpApi'

/**
 * «RNP jadvali» — what the sheet prints and what choosing a ROP leaves.
 *
 * Promises nothing else checks: a day with no figure prints a dash and never
 * a zero, a rate prints as a percent, picking a team — by its chip or by its
 * line in the ranking — leaves that team's blocks and nothing else and puts
 * it in the URL, and the lead funnel sums its steps over one window.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/rnp',
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/features/shared/PageShell', () => ({
  PageShell: ({ actions, toolbar, children }: { actions?: unknown; toolbar?: unknown; children?: unknown }) => (
    <div>
      <div data-testid="page-actions">{actions as React.ReactNode}</div>
      <div data-testid="page-toolbar">{toolbar as React.ReactNode}</div>
      <div>{children as React.ReactNode}</div>
    </div>
  ),
}))

/*
  jsdom has no `matchMedia` (AnimatedNumber and the charts ask it about
  motion — «reduced» prints each figure once) and no `ResizeObserver`
  (Recharts' ResponsiveContainer measures with one).
*/
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
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const { RnpPage } = await import('@/features/rnp/RnpPage')

function row(over: Partial<RnpRowDto> & Pick<RnpRowDto, 'key' | 'label'>): RnpRowDto {
  return {
    unit: 'count',
    additive: true,
    better: 'up',
    plan: null,
    dayPlan: null,
    fact: null,
    forecast: null,
    index: null,
    days: [null, null, null],
    planKey: null,
    sheet: null,
    share: null,
    tone: 'plain',
    hint: null,
    reliableFrom: null,
    ...over,
  }
}

const FIXTURE: RnpOverviewDto = {
  month: '2026-09',
  days: ['2026-09-01', '2026-09-02', '2026-09-03'],
  today: '2026-09-02',
  elapsedDays: 1,
  teams: [
    { rop: 'Sevinch', label: 'Sevinch', head: 'Sevinch Aliyeva', isBase: false },
    { rop: 'Charos', label: 'Charos', head: 'Malika Rahmonova', isBase: true },
  ],
  blocks: [
    {
      id: 'registration',
      kind: 'registration',
      title: 'Регистрация',
      subtitle: null,
      team: null,
      sheet: null,
      rows: [
        row({ key: 'reg:leads', label: 'Лидлар', fact: 12, days: [12, null, null] }),
        row({ key: 'reg:qualified', label: 'Квал лид', fact: 8, days: [2, 6, null] }),
        row({ key: 'reg:distributed', label: 'РОП ларга', fact: 5, days: [4, 5, null], reliableFrom: '2026-09-02' }),
      ],
    },
    {
      id: 'team:Sevinch',
      kind: 'team',
      title: 'Sevinch РОП',
      subtitle: 'Sevinch Aliyeva',
      team: 'Sevinch',
      sheet: null,
      rows: [
        row({
          key: 'team:Sevinch:conv1',
          label: 'Конверсия % от квал лид',
          unit: 'percent',
          additive: false,
          plan: 30,
          fact: 85.3,
          index: 284.3,
          days: [85.3, null, null],
        }),
        row({ key: 'team:Sevinch:orders1', label: 'Буюртма сони (ФАКТ 1)', fact: 4, days: [1, 3, null] }),
        row({ key: 'team:Sevinch:orders2', label: 'Транзакция ФАКТ 2', fact: 2, days: [0, 2, null] }),
      ],
    },
    {
      id: 'team:Charos',
      kind: 'team',
      title: 'Charos РОП — БАЗА',
      subtitle: 'Malika Rahmonova',
      team: 'Charos',
      sheet: null,
      rows: [
        row({ key: 'team:Charos:reach', label: 'Дозвон', fact: 40, days: [40, null, null] }),
        // A БАЗА team's orders are not the leads' — the funnel leaves them out.
        row({ key: 'team:Charos:orders1', label: 'Буюртма сони (ФАКТ 1)', fact: 50, days: [20, 30, null] }),
      ],
    },
  ],
  settings: { usdRate: null, leadValues: [], marketingPlanPct: null, targetologPct: null, marketerPct: null },
  canEditPlans: false,
  registration: { registrars: [], groups: [], groupNames: ['Sevinch', 'Gulzora', 'Aziz', 'Maftuna', 'Lola', 'Saidaziz', 'Zextra'] },
}

let fixture: RnpOverviewDto = FIXTURE
let posted: unknown[] = []
let postedTo: string[] = []

beforeEach(() => {
  window.history.replaceState(null, '', '/rnp')
  fixture = FIXTURE
  posted = []
  postedTo = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted.push(JSON.parse(String(init.body)))
        postedTo.push(url)
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: init?.method === 'POST' ? { saved: true } : fixture,
          meta: { dataSource: 'DEMO', generatedAt: '2026-09-02T06:00:00.000Z' },
        }),
      }
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function draw(first = 'Регистрация') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  render(
    <QueryClientProvider client={client}>
      <RnpPage />
    </QueryClientProvider>,
  )
  await waitFor(() => expect(screen.getByRole('heading', { name: first })).toBeTruthy())
}

function chip(name: RegExp) {
  const rail = screen.getByRole('group', { name: 'ROP tanlash' })
  return within(rail).getByRole('button', { name })
}

describe('RnpPage — Kengaytirilgan', () => {
  beforeEach(() => window.history.replaceState(null, '', '/rnp'))

  it('draws each block, a dash for a day with no figure, and a rate as a percent', async () => {
    await draw()

    const toggle = screen.getByRole('button', { name: 'Регистрация' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    const registration = screen.getByRole('heading', { name: 'Регистрация' }).closest('section')!
    const leads = [...registration.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('th')?.textContent === 'Лидлар')!
    const cells = [...leads.querySelectorAll('td')].map((td) => td.textContent)
    // Reja, Kunlik reja, Fakt, Prognoz, Indeks, then the three days.
    expect(cells).toEqual(['—', '—', '12', '—', '—', '12', '—', '—'])
    expect(cells).not.toContain('0')

    // The company view has no team block; its rate lives in the ranking.
    expect(screen.queryByRole('heading', { name: 'Sevinch РОП' })).toBeNull()
    expect(screen.getAllByText('85.3%').length).toBeGreaterThan(0)
  })

  it('narrows to one team when its chip is picked, and keeps it in the URL', async () => {
    await draw()

    const rail = screen.getByRole('group', { name: 'ROP tanlash' })
    expect(within(rail).getAllByRole('button').map((b) => b.getAttribute('aria-label')?.split(' — ')[0])).toEqual([
      'Butun kompaniya',
      'Sevinch',
      'Charos (БАЗА)',
    ])
    expect(chip(/^Butun kompaniya/).getAttribute('aria-pressed')).toBe('true')

    await act(async () => {
      fireEvent.click(chip(/^Charos/))
    })

    expect(chip(/^Charos/).getAttribute('aria-pressed')).toBe('true')
    expect(new URL(window.location.href).searchParams.get('rop')).toBe('Charos')
    expect(screen.getByRole('heading', { name: 'Charos РОП — БАЗА' })).toBeTruthy()
    expect(screen.getByText('2-oʻrin / 2')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Sevinch РОП' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Регистрация' })).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Butun kompaniya' }))
    })
    expect(new URL(window.location.href).searchParams.has('rop')).toBe(false)
    expect(screen.getByRole('heading', { name: 'Регистрация' })).toBeTruthy()
  })

  it('opens the team a shared ?rop= link names', async () => {
    window.history.replaceState(null, '', '/rnp?rop=Sevinch')
    await draw('Sevinch РОП')
    expect(screen.queryByRole('heading', { name: 'Регистрация' })).toBeNull()
  })

  it('says so when the link names a team the month does not have', async () => {
    window.history.replaceState(null, '', '/rnp?rop=Nobody')
    await draw()
    expect(screen.getByText(/«Nobody» jamoasi bu oyda yoʻq/)).toBeTruthy()
  })

  it('selects the ROP whose line in the ranking is clicked', async () => {
    await draw()

    const ranking = screen.getByRole('heading', { name: 'Jamoalar reytingi' }).closest('section')!
    const line = [...ranking.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes('Sevinch'))!
    await act(async () => {
      fireEvent.click(line.querySelectorAll('td')[1]!)
    })

    expect(new URL(window.location.href).searchParams.get('rop')).toBe('Sevinch')
    expect(screen.getByRole('heading', { name: 'Sevinch РОП' })).toBeTruthy()
  })

  it('sums the funnel over the reliable window and leaves БАЗА orders out', async () => {
    await draw()

    const funnel = screen.getByRole('list', { name: 'Lid voronkasi bosqichlari' })
    const steps = within(funnel)
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    // From 02.09 (the distributed row's reliableFrom) to today, 02.09 — one day.
    expect(steps).toEqual([
      'Tushgan lid0',
      '↓ — oldingi bosqichdanKval lid6',
      '↓ 83.3% oldingi bosqichdanROP larga tarqatildi5',
      '↓ 60.0% oldingi bosqichdanBuyurtma (FAKT 1)3',
      '↓ 66.7% oldingi bosqichdanYetkazildi (FAKT 2)2',
    ])
    expect(screen.getByText(/02\.09 – 02\.09 · 1 kun/)).toBeTruthy()
  })

  it('saves a team’s FAKT 1 as a fakt pair, once, and a company plan as a row', async () => {
    const fakt1 = (label: string, plan: number | null) =>
      row({ key: label, label, unit: 'uzs', plan, planKey: { team: 'Sevinch', metric: 'fakt1' } })
    fixture = {
      ...FIXTURE,
      canEditPlans: true,
      settings: {
        usdRate: 12650,
        leadValues: [{ team: '', fromDay: 1, value: 50000 }],
        marketingPlanPct: 12,
        targetologPct: null,
        marketerPct: null,
      },
      blocks: [
        {
          id: 'marketing',
          kind: 'marketing',
          title: 'Маркетинг',
          subtitle: null,
          team: null,
          sheet: null,
          rows: [row({ key: 'meta:spend', label: 'Жами бюджет, $', unit: 'usd', planKey: { team: '', metric: 'budget' } })],
        },
        {
          id: 'team:Sevinch',
          kind: 'team',
          title: 'Sevinch РОП',
          subtitle: null,
          team: 'Sevinch',
          sheet: null,
          rows: [
            fakt1('Сумма ФАКТ 1', 100_000_000),
            row({ key: 'f2', label: 'Сумма ФАКТ 2', unit: 'uzs', plan: 80_000_000, planKey: { team: 'Sevinch', metric: 'fakt2' } }),
          ],
        },
        { id: 'summary', kind: 'summary', title: 'Свод', subtitle: null, team: null, sheet: null, rows: [fakt1('ФАКТ 1 · Sevinch', 100_000_000)] },
      ],
    }
    await draw('Маркетинг')

    fireEvent.click(screen.getByRole('button', { name: 'Rejalar' }))
    fireEvent.change(screen.getByLabelText('Свод · ФАКТ 1 · Sevinch'), { target: { value: '120000000' } })
    fireEvent.change(screen.getByLabelText('Маркетинг · Жами бюджет, $'), { target: { value: '1500.5' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Saqlash' }))
    })

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toEqual({
      month: '2026-09',
      rows: [
        { team: '', metric: 'budget', fromDay: 1, value: 1500.5 },
        { team: '', metric: 'usd_rate', fromDay: 1, value: 12650 },
        { team: '', metric: 'marketing_plan_pct', fromDay: 1, value: 12 },
        { team: '', metric: 'targetolog_pct', fromDay: 1, value: null },
        { team: '', metric: 'marketer_pct', fromDay: 1, value: null },
        { team: '', metric: 'lead_value', fromDay: 1, value: 50000 },
      ],
      fakt: [{ rop: 'Sevinch', fakt1: 120_000_000, fakt2: 80_000_000 }],
    })
  })

  it('prefills the P&L percentages and saves a typed one as a company row', async () => {
    fixture = { ...FIXTURE, canEditPlans: true }
    await draw()

    fireEvent.click(screen.getByRole('button', { name: 'Rejalar' }))
    const targetolog = screen.getByRole('textbox', { name: /^Targetolog ФОТ, % byudjetdan/ }) as HTMLInputElement
    expect(targetolog.value).toBe('')
    fireEvent.change(targetolog, { target: { value: '10,5' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Saqlash' }))
    })

    await waitFor(() => expect(posted).toHaveLength(1))
    expect((posted[0] as { rows: unknown[] }).rows).toContainEqual({ team: '', metric: 'targetolog_pct', fromDay: 1, value: 10.5 })
  })

  describe('registrar groups', () => {
    const withRegistrars: RnpOverviewDto = {
      ...FIXTURE,
      canEditPlans: true,
      registration: {
        registrars: ['Aziza', 'Dilnoza'],
        // «Eski» is only in a group this month — still offered.
        groups: [
          { registrar: 'Aziza', group: 'Sevinch' },
          { registrar: 'Eski', group: 'Lola' },
        ],
        groupNames: ['Sevinch', 'Gulzora', 'Aziz', 'Maftuna', 'Lola', 'Saidaziz', 'Zextra'],
      },
    }

    async function openForm() {
      fixture = withRegistrars
      await draw()
      fireEvent.click(screen.getByRole('button', { name: 'Rejalar' }))
    }

    const select = (name: string) => screen.getByRole('combobox', { name: `${name} — guruh` }) as HTMLSelectElement

    it('prefills each registrar and posts only the changed row', async () => {
      await openForm()
      expect(select('Aziza').value).toBe('Sevinch')
      expect(select('Dilnoza').value).toBe('')
      expect(select('Eski').value).toBe('Lola')

      fireEvent.change(select('Dilnoza'), { target: { value: 'Maftuna' } })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Saqlash' }))
      })

      await waitFor(() => expect(posted).toHaveLength(2))
      expect(postedTo).toEqual(['/api/v1/rnp/plans', '/api/v1/rnp/registrars'])
      expect(posted[1]).toEqual({ month: '2026-09', rows: [{ registrar: 'Dilnoza', group: 'Maftuna' }] })
    })

    it('sends null for «—», and nothing to /rnp/registrars when no group changed', async () => {
      await openForm()
      fireEvent.change(select('Eski'), { target: { value: '' } })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Saqlash' }))
      })
      await waitFor(() => expect(posted).toHaveLength(2))
      expect(posted[1]).toEqual({ month: '2026-09', rows: [{ registrar: 'Eski', group: null }] })

      cleanup()
      posted = []
      postedTo = []
      await openForm()
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Saqlash' }))
      })
      await waitFor(() => expect(posted).toHaveLength(1))
      expect(postedTo).toEqual(['/api/v1/rnp/plans'])
    })
  })

  it('folds a brand project to its FAKT 2, marketing cost and CAC', async () => {
    fixture = {
      ...FIXTURE,
      blocks: [
        ...FIXTURE.blocks,
        {
          id: 'project:collagen',
          kind: 'project',
          title: 'Коллаген проект',
          subtitle: null,
          team: null,
          sheet: null,
          rows: [
            row({ key: 'pj:collagen:fakt2', label: 'Сумма ФАКТ 2 (успешка)', unit: 'uzs', fact: 12_400_000 }),
            row({ key: 'pj:collagen:cost_fact', label: 'Маркетинг харажат факт', unit: 'uzs', fact: 2_000_000 }),
            row({ key: 'pj:collagen:cac', label: 'CAC, $', unit: 'usd', additive: false, fact: 15.5 }),
          ],
        },
      ],
    }
    await draw('Коллаген проект')

    const summaries = screen.getAllByText(/^ФАКТ 2 .+ soʻm · Маркетинг харажат .+ soʻm · CAC \$15\.5$/)
    expect(summaries.length).toBeGreaterThan(0)
  })
})
