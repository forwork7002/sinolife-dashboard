// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RnpLine, RnpOverviewDto, RnpRowDto } from '@/features/rnp/rnpApi'

/**
 * «RNP jadvali» — the page is the client's sheet and nothing else.
 *
 * Promises nothing else checks: the sheet's lines are drawn in order under
 * its own labels, the header strip carries the sheet's rows 1–2 (days gone
 * by, dollar rate, today), a day with no figure prints a dash and never a
 * zero, none of the deleted extras (ROP rail, KPI cards, charts, funnel,
 * ranking) comes back, and «Rejalar» still saves plans and registrar groups.
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
  lines: [
    { kind: 'title', row: 4, label: 'Маркетинг COLLAGEN', sub: 'Хаёт', tone: 'section' },
    { kind: 'value', row: 9, label: 'Кол подпис tg', sub: null, tone: 'plain', fact: 'plain', bold: false, key: null },
    { kind: 'value', row: 47, label: 'Количество лид', sub: 'Умида', tone: 'plain', fact: 'plain', bold: false, key: 'reg:leads' },
    { kind: 'value', row: 48, label: 'Регистрация COLLAGEN', sub: null, tone: 'section', fact: 'rate', bold: true, key: 'reg:qualified' },
    { kind: 'value', row: 89, label: 'Продажа (первичка) факт1', sub: 'Севинч РОП', tone: 'team', fact: 'plain', bold: true, key: 'reg:distributed' },
    { kind: 'value', row: 90, label: 'Конверсия % от квал лид', sub: null, tone: 'plain', fact: 'plain', bold: false, key: 'team:Sevinch:conv1' },
  ] satisfies RnpLine[],
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

async function draw() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  render(
    <QueryClientProvider client={client}>
      <RnpPage />
    </QueryClientProvider>,
  )
  await waitFor(() => expect(screen.getByRole('region', { name: 'RNP jadvali' })).toBeTruthy())
}

function labels(): string[] {
  const grid = screen.getByRole('region', { name: 'RNP jadvali' })
  return [...grid.querySelectorAll('tbody tr:not([data-gap]) th')].map((th) => th.textContent ?? '')
}

describe('RnpPage — the sheet', () => {
  it('draws the sheet’s lines in order, a dash for a day with no figure, a rate as a percent', async () => {
    await draw()

    expect(labels()).toEqual([
      'Маркетинг COLLAGENХаёт',
      'Кол подпис tg',
      'Количество лидУмида',
      'Регистрация COLLAGEN',
      'Севинч РОППродажа (первичка) факт1',
      'Конверсия % от квал лид',
    ])

    const grid = screen.getByRole('region', { name: 'RNP jadvali' })
    const leads = [...grid.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('th')?.textContent?.startsWith('Количество лид'))!
    const cells = [...leads.querySelectorAll('td')].map((td) => td.textContent)
    // Кунлик план, План, Факт, Прогноз, Индекс, then the three days.
    expect(cells).toEqual(['—', '—', '12', '—', '—', '12', '—', '—'])
    expect(cells).not.toContain('0')
    expect(within(grid).getAllByText('85.3%')).toHaveLength(2)
  })

  it('carries the sheet’s rows 1–2 above the grid: days gone by, the dollar rate, today', async () => {
    await draw()
    const toolbar = screen.getByTestId('page-toolbar')
    expect(within(toolbar).getByLabelText('Oy')).toBeTruthy()
    expect(toolbar.textContent).toContain('Oʻtgan kunlar:1')
    expect(toolbar.textContent).toContain('Dollar kursi:kiritilmagan')
    expect(toolbar.textContent).toContain('Bugun:02.09.2026')
    expect(within(toolbar).getByRole('button', { name: 'Kengliklarni tiklash' })).toBeTruthy()
    // No «Rejalar» for an account that cannot edit plans.
    expect(screen.queryByRole('button', { name: 'Rejalar' })).toBeNull()

    cleanup()
    fixture = { ...FIXTURE, settings: { ...FIXTURE.settings, usdRate: 12200 } }
    await draw()
    expect(screen.getByTestId('page-toolbar').textContent).toContain('Dollar kursi:12,200 soʻm')
  })

  it('has none of the deleted extras — no ROP rail, cards, charts, funnel or ranking', async () => {
    window.history.replaceState(null, '', '/rnp?rop=Sevinch')
    await draw()
    expect(screen.queryByRole('group', { name: 'ROP tanlash' })).toBeNull()
    expect(screen.queryByRole('list', { name: 'Lid voronkasi bosqichlari' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Jamoalar reytingi' })).toBeNull()
    expect(screen.queryAllByRole('heading')).toHaveLength(0)
    // `?rop=` narrows nothing: the whole sheet is drawn.
    expect(labels()).toHaveLength(6)
    expect(screen.getAllByRole('table')).toHaveLength(1)
  })

  it('says so when the month has no sheet, and offers a retry when the request fails', async () => {
    fixture = { ...FIXTURE, blocks: [], lines: [] }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
    render(
      <QueryClientProvider client={client}>
        <RnpPage />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('Bu oy uchun jadval yoʻq')).toBeTruthy())
    cleanup()

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: { code: 'INTERNAL_ERROR', message: 'Server xatosi' } }) })),
    )
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })}>
        <RnpPage />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Qayta urinish' })).toBeTruthy())
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
    await draw()

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
})
