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
    tone: 'plain',
    hint: null,
    manual: null,
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
    { kind: 'title', row: 4, team: null, label: 'Маркетинг COLLAGEN', sub: 'Хаёт', tone: 'section' },
    { kind: 'value', row: 9, team: null, label: 'Кол подпис tg', sub: null, tone: 'plain', fact: 'plain', bold: false, key: null },
    { kind: 'value', row: 47, team: null, label: 'Количество лид', sub: 'Умида', tone: 'plain', fact: 'plain', bold: false, key: 'reg:leads' },
    { kind: 'value', row: 48, team: null, label: 'Регистрация COLLAGEN', sub: null, tone: 'section', fact: 'rate', bold: true, key: 'reg:qualified' },
    { kind: 'value', row: 89, team: 'Sevinch', label: 'Продажа (первичка) факт1', sub: 'Севинч РОП', tone: 'team', fact: 'plain', bold: true, key: 'reg:distributed' },
    { kind: 'value', row: 90, team: 'Sevinch', label: 'Конверсия % от квал лид', sub: null, tone: 'plain', fact: 'plain', bold: false, key: 'team:Sevinch:conv1' },
  ] satisfies RnpLine[],
  settings: { usdRate: null, usdRateDate: null, leadValues: [], marketingPlanPct: null, targetologPct: null, marketerPct: null },
  canEditPlans: false,
  registration: { registrars: [], groups: [], groupNames: ['Sevinch', 'Gulzora', 'Aziz', 'Maftuna', 'Lola', 'Saidaziz', 'Zextra'] },
}

let fixture: RnpOverviewDto = FIXTURE
let posted: unknown[] = []
let postedTo: string[] = []
/** How many times the sheet was read — a save must read it again. */
let reads = 0

beforeEach(() => {
  window.history.replaceState(null, '', '/rnp')
  fixture = FIXTURE
  posted = []
  postedTo = []
  reads = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted.push(JSON.parse(String(init.body)))
        postedTo.push(url)
      } else reads += 1
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
    // План, Факт, Прогноз, Индекс, Кунлик план, then the three days.
    expect(cells).toEqual(['—', '12', '—', '—', '—', '12', '—', '—'])
    expect(cells).not.toContain('0')
    expect(within(grid).getAllByText('85,3%')).toHaveLength(2)
  })

  it('carries the sheet’s rows 1–2 above the grid: days gone by, the dollar rate, today', async () => {
    await draw()
    const toolbar = screen.getByTestId('page-toolbar')
    expect(within(toolbar).getByLabelText('Oy')).toBeTruthy()
    expect(toolbar.textContent).toContain('Oʻtgan kunlar:1')
    expect(toolbar.textContent).toContain('Dollar kursi:Markaziy bankdan olinmadi')
    expect(toolbar.textContent).toContain('Bugun:02.09.2026')
    expect(within(toolbar).queryByRole('button', { name: 'Kengliklarni tiklash' })).toBeNull()
    // No «Rejalar» for an account that cannot edit plans.
    expect(screen.queryByRole('button', { name: 'Rejalar' })).toBeNull()

    cleanup()
    fixture = { ...FIXTURE, settings: { ...FIXTURE.settings, usdRate: 11806.97, usdRateDate: '2026-09-02' } }
    await draw()
    // The Central Bank's rate, with its day — never a typed one.
    expect(screen.getByTestId('page-toolbar').textContent).toContain('Dollar kursi (MB, 02.09):11.806,97 soʻm')
  })

  it('has none of the deleted extras — no ROP rail, cards, charts, funnel or ranking', async () => {
    await draw()
    expect(screen.queryByRole('group', { name: 'ROP tanlash' })).toBeNull()
    expect(screen.queryByRole('list', { name: 'Lid voronkasi bosqichlari' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Jamoalar reytingi' })).toBeNull()
    expect(screen.queryAllByRole('heading')).toHaveLength(0)
    expect(labels()).toHaveLength(6)
    expect(screen.getAllByRole('table')).toHaveLength(1)
  })

  it('cuts the sheet to one ROP from the «ROP» select, and back to «Barchasi»', async () => {
    await draw()
    const select = within(screen.getByTestId('page-toolbar')).getByLabelText('ROP') as HTMLSelectElement
    // Only teams that have lines on the sheet are offered.
    expect([...select.options].map((o) => o.textContent)).toEqual(['Barchasi', 'Sevinch'])
    act(() => fireEvent.change(select, { target: { value: 'Sevinch' } }))
    expect(window.location.search).toBe('?rop=Sevinch')
    await waitFor(() => expect(labels()).toHaveLength(3)) // its heading and its two lines
    expect(labels()[0]).toContain('Sevinch — ROP bloki')
    act(() => fireEvent.change(select, { target: { value: '' } }))
    await waitFor(() => expect(labels()).toHaveLength(6))
    expect(window.location.search).toBe('')
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
        usdRateDate: '2026-09-02',
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

  describe('typed P&L costs', () => {
    const costRow = (days: (number | null)[]) =>
      row({
        key: 'project:collagen:cost_bloggers',
        label: 'Блогерлар',
        unit: 'uzs',
        better: 'down',
        fact: days.some((d) => d !== null) ? days.reduce<number>((a, d) => a + (d ?? 0), 0) : null,
        days,
        hint: 'Qoʻlda kiritiladi — Bitrix24 da yoʻq xarajat.',
        manual: { project: 'Collagen', line: 'bloggers' },
      })
    const withCosts = (canEditPlans: boolean, days: (number | null)[] = [1_500_000, null, null]): RnpOverviewDto => ({
      ...FIXTURE,
      canEditPlans,
      blocks: [
        ...FIXTURE.blocks,
        { id: 'project:collagen', kind: 'project', title: 'Коллаген проект', subtitle: null, team: null, sheet: null, rows: [costRow(days)] },
      ],
      lines: [
        ...FIXTURE.lines,
        { kind: 'value', row: 411, team: null, label: 'Блогерлар', sub: null, tone: 'brand', fact: 'plain', bold: false, key: 'project:collagen:cost_bloggers' },
      ],
    })

    const field = (day: string) => screen.getByRole('textbox', { name: `Блогерлар, ${day} — soʻm` }) as HTMLInputElement

    it('types a day straight into its open field, posts it to /rnp/costs and reads the sheet again', async () => {
      fixture = withCosts(true)
      await draw()
      const before = reads
      const input = field('02.09')
      expect(input.value).toBe('')
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: '2 500 000' } })
      // The server now has the figure; the refetch draws it.
      fixture = withCosts(true, [1_500_000, 2_500_000, null])
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter' })
      })
      await waitFor(() => expect(posted).toHaveLength(1))
      expect(postedTo).toEqual(['/api/v1/rnp/costs'])
      expect(posted[0]).toEqual({ month: '2026-09', cells: [{ day: '2026-09-02', project: 'Collagen', line: 'bloggers', value: 2_500_000 }] })
      await waitFor(() => expect(reads).toBeGreaterThan(before))
      // Leaving the field once the sheet is back shows the server's figure, written in full.
      fireEvent.blur(input)
      await waitFor(() => expect(field('02.09').value).toBe('2.500.000'))
      expect(posted).toHaveLength(1) // the blur after Enter sends nothing more
    })

    it('saves when the field is left, and clears a day with an emptied field — value null', async () => {
      fixture = withCosts(true)
      await draw()
      const input = field('01.09')
      expect(input.value).toBe('1.500.000')
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: '' } })
      await act(async () => {
        fireEvent.blur(input)
      })
      await waitFor(() => expect(posted).toHaveLength(1))
      expect(posted[0]).toEqual({ month: '2026-09', cells: [{ day: '2026-09-01', project: 'Collagen', line: 'bloggers', value: null }] })
    })

    it('puts the figure back on Escape and sends nothing', async () => {
      fixture = withCosts(true)
      await draw()
      fireEvent.focus(field('01.09'))
      fireEvent.change(field('01.09'), { target: { value: '9' } })
      fireEvent.keyDown(field('01.09'), { key: 'Escape' })
      expect(field('01.09').value).toBe('1.500.000')
      fireEvent.blur(field('01.09'))
      await act(async () => {})
      expect(posted).toHaveLength(0)
    })

    it('refuses a typo in place — marked, said why, nothing posted', async () => {
      fixture = withCosts(true)
      await draw()
      fireEvent.focus(field('02.09'))
      for (const typo of ['12.5', '1.2345', '-300', '12abc', '2000000000000']) {
        fireEvent.change(field('02.09'), { target: { value: typo } })
        fireEvent.keyDown(field('02.09'), { key: 'Enter' })
        const input = field('02.09')
        expect(input.getAttribute('aria-invalid')).toBe('true')
        const message = document.getElementById(input.getAttribute('aria-describedby')!)!
        expect(message.getAttribute('role')).toBe('alert')
        expect(message.textContent).toMatch(/son|katta/)
      }
      // Leaving the field does not send a typo either.
      fireEvent.blur(field('02.09'))
      await act(async () => {})
      expect(posted).toHaveLength(0)
      // Thousands separated by dots (as the field shows them), spaces or commas are fine.
      fireEvent.focus(field('02.09'))
      fireEvent.change(field('02.09'), { target: { value: '1.250 000' } })
      expect(field('02.09').getAttribute('aria-invalid')).toBeNull()
      await act(async () => {
        fireEvent.keyDown(field('02.09'), { key: 'Enter' })
      })
      await waitFor(() => expect(posted).toHaveLength(1))
      expect((posted[0] as { cells: { value: number }[] }).cells[0]!.value).toBe(1_250_000)
    })

    it('keeps the typed text and shows the server’s words when the save is refused', async () => {
      fixture = withCosts(true)
      await draw()
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init?: RequestInit) =>
          init?.method === 'POST'
            ? { ok: false, status: 403, json: async () => ({ error: { code: 'FORBIDDEN', message: 'Xarajatlarni faqat administrator kirita oladi.' }, meta: {} }) }
            : { ok: true, status: 200, json: async () => ({ data: fixture, meta: { dataSource: 'DEMO', generatedAt: '2026-09-02T06:00:00.000Z' } }) },
        ),
      )
      fireEvent.focus(field('02.09'))
      fireEvent.change(field('02.09'), { target: { value: '700000' } })
      await act(async () => {
        fireEvent.keyDown(field('02.09'), { key: 'Enter' })
      })
      await waitFor(() => expect(field('02.09').getAttribute('aria-invalid')).toBe('true'))
      expect(field('02.09').value).toBe('700000')
      expect(screen.getByRole('alert').textContent).toBe('Xarajatlarni faqat administrator kirita oladi.')
    })

    it('shows the typed row read-only, with its chip, to an account that cannot edit plans', async () => {
      fixture = withCosts(false)
      await draw()
      expect(screen.queryAllByRole('textbox')).toHaveLength(0)
      const grid = screen.getByRole('region', { name: 'RNP jadvali' })
      const bloggers = [...grid.querySelectorAll<HTMLTableRowElement>('tbody tr')].find((tr) => tr.querySelector('th')?.textContent?.startsWith('Блогерлар'))!
      expect(within(bloggers).getByText('qoʻlda')).toBeTruthy()
      expect(bloggers.textContent).not.toContain('Bitrix24ʼda yoʻq')
    })
  })
})
