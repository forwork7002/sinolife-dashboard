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
 * ranking) comes back, and «Rejalar» is gone (the client, 2026-10-01).
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
    sheet: null,
    tone: 'plain',
    hint: null,
    manual: null,
    planInput: null,
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
  settings: { usdRate: null, usdRateDate: null },
  canEditPlans: false,
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
    // No «Rejalar» on the page (the client took it off, 2026-10-01).
    expect(screen.queryByRole('button', { name: 'Rejalar' })).toBeNull()
    cleanup()
    fixture = { ...FIXTURE, canEditPlans: true }
    await draw()
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
        manual: { kind: 'cost', project: 'Collagen', line: 'bloggers' },
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

    const field = (day: string) => screen.getByRole('textbox', { name: `Collagen · Блогерлар, ${day} — soʻm` }) as HTMLInputElement

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

  describe('typed plans — the sheet\'s column C (2026-10-01)', () => {
    const withPlans = (canEditPlans: boolean): RnpOverviewDto => ({
      ...FIXTURE,
      canEditPlans,
      blocks: [
        ...FIXTURE.blocks,
        {
          id: 'team:Lola',
          kind: 'team',
          title: 'Lola РОП',
          subtitle: null,
          team: 'Lola',
          sheet: null,
          rows: [
            row({ key: 'team:Lola:plan_pct', label: 'План бажарилиши, %', unit: 'percent', additive: false, plan: 80, planInput: { team: 'Lola', metric: 'plan_pct' } }),
            row({ key: 'team:Lola:orders1', label: 'Буюртма сони', plan: 625 }),
          ],
        },
      ],
      lines: [
        ...FIXTURE.lines,
        { kind: 'value', row: 107, team: 'Lola', label: 'План бажарилиши', sub: 'Лола РОП', tone: 'team', fact: 'plan', bold: true, key: 'team:Lola:plan_pct' },
        { kind: 'value', row: 105, team: 'Lola', label: 'Буюртма сони', sub: null, tone: 'plain', fact: 'plain', bold: false, key: 'team:Lola:orders1' },
      ],
    })
    const plan = () => screen.getByRole('textbox', { name: 'Lola · План бажарилиши — reja, %' }) as HTMLInputElement

    it('types a plan the sheet types, with a decimal comma, and posts it to /rnp/plan', async () => {
      fixture = withPlans(true)
      await draw()
      expect(plan().value).toBe('80')
      fireEvent.focus(plan())
      fireEvent.change(plan(), { target: { value: '82,5' } })
      await act(async () => {
        fireEvent.keyDown(plan(), { key: 'Enter' })
      })
      await waitFor(() => expect(posted).toHaveLength(1))
      expect(postedTo).toEqual(['/api/v1/rnp/plan'])
      expect(posted[0]).toEqual({ month: '2026-09', cells: [{ team: 'Lola', metric: 'plan_pct', value: 82.5 }] })
    })

    it('leaves a plan the sheet computes as a figure, and every plan read-only without kpi:manage', async () => {
      fixture = withPlans(true)
      await draw()
      expect(screen.queryByRole('textbox', { name: /Буюртма сони — reja/ })).toBeNull()
      cleanup()
      fixture = withPlans(false)
      await draw()
      expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    })
  })

  describe('typed «Ходим сони» (2026-10-01)', () => {
    const withHeads = (days: (number | null)[] = [6, null, null]): RnpOverviewDto => ({
      ...FIXTURE,
      canEditPlans: true,
      blocks: [
        ...FIXTURE.blocks,
        ...['Lola', 'Aziz'].map((rop) => ({
          id: `team:${rop}`,
          kind: 'team' as const,
          title: `${rop} РОП`,
          subtitle: null,
          team: rop,
          sheet: null,
          rows: [row({ key: `team:${rop}:headcount`, label: 'Ходим сони', additive: false, fact: 6, days, manual: { kind: 'headcount', rop } })],
        })),
      ],
      lines: [
        ...FIXTURE.lines,
        ...['Lola', 'Aziz'].map((rop): RnpLine => ({ kind: 'value', row: null, team: rop, label: 'Ходим сони', sub: null, tone: 'plain', fact: 'fakt', bold: false, key: `team:${rop}:headcount` })),
      ],
    })
    // Two teams, two «Ходим сони» rows: each field is named for its team.
    const field = (day: string) => screen.getByRole('textbox', { name: `Lola · Ходим сони, ${day} — kishi` }) as HTMLInputElement

    it('types a team’s headcount into its open field and posts it to /rnp/headcount', async () => {
      fixture = withHeads()
      await draw()
      expect(field('01.09').value).toBe('6')
      fireEvent.focus(field('02.09'))
      fireEvent.change(field('02.09'), { target: { value: '8' } })
      fixture = withHeads([6, 8, null])
      await act(async () => {
        fireEvent.keyDown(field('02.09'), { key: 'Enter' })
      })
      await waitFor(() => expect(posted).toHaveLength(1))
      expect(postedTo).toEqual(['/api/v1/rnp/headcount'])
      expect(posted[0]).toEqual({ month: '2026-09', cells: [{ day: '2026-09-02', rop: 'Lola', value: 8 }] })
    })

    it('refuses a fraction or a thousand-plus in place, and sends nothing', async () => {
      fixture = withHeads()
      await draw()
      fireEvent.focus(field('02.09'))
      for (const typo of ['7.5', '-1', 'ab', '1001']) {
        fireEvent.change(field('02.09'), { target: { value: typo } })
        fireEvent.keyDown(field('02.09'), { key: 'Enter' })
        expect(field('02.09').getAttribute('aria-invalid')).toBe('true')
      }
      fireEvent.blur(field('02.09'))
      await act(async () => {})
      expect(posted).toHaveLength(0)
    })
  })
})
