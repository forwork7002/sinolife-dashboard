// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RnpLine, RnpOverviewDto, RnpRowDto } from '@/features/rnp/rnpApi'
import { t } from '@/lib/messages'

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
    { kind: 'value', row: 47, team: null, label: 'Жами лид сони', sub: null, tone: 'section', fact: 'plain', bold: true, key: 'reg:leads' },
    { kind: 'value', row: 48, team: null, label: 'Жами квал сони', sub: null, tone: 'plain', fact: 'plain', bold: false, key: 'reg:qualified' },
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
/** The month each read asked for. */
let readMonths: (string | null)[] = []

/** The month it is in Tashkent as the test runs — what the page opens on. */
const CURRENT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7)

beforeEach(() => {
  window.history.replaceState(null, '', '/rnp')
  fixture = FIXTURE
  posted = []
  postedTo = []
  reads = 0
  readMonths = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted.push(JSON.parse(String(init.body)))
        postedTo.push(url)
      } else {
        reads += 1
        readMonths.push(new URL(url, 'http://x').searchParams.get('month'))
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
  return client
}

/** The sheet read again, as the minute's poll does. */
async function poll(client: QueryClient) {
  await act(async () => {
    await client.refetchQueries({ queryKey: ['rnp-overview'] })
    // TanStack hands the result to React on its next tick: let it land before the test goes on.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
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
      'Жами лид сони',
      'Жами квал сони',
      'Севинч РОППродажа (первичка) факт1',
      'Конверсия % от квал лид',
    ])

    const grid = screen.getByRole('region', { name: 'RNP jadvali' })
    const leads = [...grid.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('th')?.textContent?.startsWith('Жами лид сони'))!
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

  it('keeps the sheet when a background read fails — the error card is only for no sheet at all (2026-10-02)', async () => {
    const client = await draw()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ error: { code: 'INTERNAL_ERROR', message: 'Server xatosi' } }) })),
    )
    await poll(client)
    expect(screen.getByRole('region', { name: 'RNP jadvali' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Qayta urinish' })).toBeNull()
  })

  it('says under the title what is typed here, not that everything is collected', () => {
    expect(t.modules.rnp.lead).toContain('Raqamlar Bitrix24 va Meta Ads dan oʻzi yigʻiladi')
    expect(t.modules.rnp.lead).toContain('rejalar, P&L xarajatlari va «Ходим сони» shu jadvalda kiritiladi')
    expect(t.modules.rnp.lead).not.toContain('Hammasi')
  })

  describe('the month (2026-10-02)', () => {
    const box = () => within(screen.getByTestId('page-toolbar')).getByLabelText('Oy') as HTMLInputElement

    it('requests only a whole month the sheet can show, and keeps a half-typed one in the box', async () => {
      await draw()
      expect(box().min).toBe('2025-01')
      expect(box().max).toBe(CURRENT)
      expect(readMonths).toEqual([CURRENT])
      // A year typed digit by digit, a future month, one before the floor: nothing is read.
      for (const v of ['0002-10', '0202-10', '2099-01', '2024-12']) {
        act(() => fireEvent.change(box(), { target: { value: v } }))
        expect(box().value).toBe(v)
      }
      expect(readMonths).toEqual([CURRENT])
      expect(window.location.search).toBe('')
      // Left half-typed, the box shows the month on screen again.
      act(() => fireEvent.blur(box()))
      expect(box().value).toBe(CURRENT)
    })

    it('keeps a picked month in the URL, and strips it for the current one', async () => {
      window.history.replaceState(null, '', '/rnp?rop=Sevinch')
      await draw()
      act(() => fireEvent.change(box(), { target: { value: '2025-06' } }))
      await waitFor(() => expect(readMonths).toContain('2025-06'))
      expect(new URLSearchParams(window.location.search).get('month')).toBe('2025-06')
      // The ROP cut rides along untouched.
      expect(new URLSearchParams(window.location.search).get('rop')).toBe('Sevinch')
      act(() => fireEvent.change(box(), { target: { value: CURRENT } }))
      expect(new URLSearchParams(window.location.search).get('month')).toBeNull()
      expect(box().value).toBe(CURRENT)
    })

    it('opens on the URL’s month when the sheet can show it, else on the current one', async () => {
      window.history.replaceState(null, '', '/rnp?month=2025-06')
      await draw()
      expect(readMonths).toEqual(['2025-06'])
      expect(box().value).toBe('2025-06')
      cleanup()
      for (const stale of ['2099-01', '2024-12', 'abc']) {
        window.history.replaceState(null, '', `/rnp?month=${stale}`)
        readMonths = []
        await draw()
        expect(readMonths).toEqual([CURRENT])
        cleanup()
      }
    })
  })

  describe('the ROP list (2026-10-02)', () => {
    const lg = (team: string, sub: string, key: string): RnpLine => ({ kind: 'value', row: null, team, label: 'Логистика  Сумма факт1', sub, tone: 'section', fact: 'plain', bold: true, key })
    const ordered: RnpOverviewDto = {
      ...FIXTURE,
      lines: [
        ...FIXTURE.lines.slice(0, 4),
        { kind: 'value', row: 157, team: 'Charos', label: 'Дозвон сони', sub: null, tone: 'plain', fact: 'plain', bold: false, key: 'team:Charos:reach' },
        ...FIXTURE.lines.slice(4),
        lg('Shohjaxon', 'Шохжахон РОП', 'lg:Shohjaxon:fakt1'),
      ],
    }

    it('lists the teams in the sheet’s order, a team with only logistics lines too, under its column-B name', async () => {
      fixture = ordered
      await draw()
      const select = within(screen.getByTestId('page-toolbar')).getByLabelText('ROP') as HTMLSelectElement
      expect([...select.options].map((o) => o.textContent)).toEqual(['Barchasi', 'Charos', 'Sevinch', 'Шохжахон РОП'])
      act(() => fireEvent.change(select, { target: { value: 'Shohjaxon' } }))
      await waitFor(() => expect(labels()).toHaveLength(2))
      expect(labels()[0]).toContain('Логистика — Шохжахон РОП')
    })

    it('keeps a link’s ROP that this month has no lines for, and shows the whole sheet', async () => {
      window.history.replaceState(null, '', '/rnp?rop=Ghost')
      await draw()
      expect((within(screen.getByTestId('page-toolbar')).getByLabelText('ROP') as HTMLSelectElement).value).toBe('')
      expect(labels()).toHaveLength(6)
      expect(window.location.search).toBe('?rop=Ghost')
    })
  })

  describe('«Bugun» (2026-10-02)', () => {
    it('is a button on a month that has today, and brings today’s column beside the frozen block', async () => {
      await draw()
      const grid = screen.getByRole('region', { name: 'RNP jadvali' })
      let left = 0
      Object.defineProperty(grid, 'scrollLeft', { configurable: true, get: () => left, set: (v: number) => void (left = v) })
      const today = within(grid).getAllByRole('columnheader').find((th) => th.getAttribute('aria-current') === 'date')!
      const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return { left: this === today ? 900 : 0, width: 0, height: 0 } as DOMRect
      })
      const button = within(screen.getByTestId('page-toolbar')).getByRole('button', { name: 'Bugun: 02.09.2026' })
      expect(button.title).toBe('Bugungi kunga oʻtish')
      act(() => fireEvent.click(button))
      expect(grid.scrollLeft).toBe(900)
      rect.mockRestore()
    })

    it('stays a plain fact on a month without today', async () => {
      fixture = { ...FIXTURE, today: '2026-10-02' }
      await draw()
      const toolbar = screen.getByTestId('page-toolbar')
      expect(within(toolbar).queryByRole('button', { name: /Bugun/ })).toBeNull()
      expect(toolbar.textContent).toContain('Bugun:02.10.2026')
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

    it('lets an untouched field take another save that arrives while it has focus, and sends nothing (2026-10-02)', async () => {
      fixture = withCosts(true)
      const client = await draw()
      // Focused, nothing typed — empty, and one with a figure.
      fireEvent.focus(field('02.09'))
      fixture = withCosts(true, [2_000_000, 700_000, null])
      await poll(client)
      await act(async () => {
        fireEvent.blur(field('02.09'))
      })
      fireEvent.focus(field('01.09'))
      await act(async () => {
        fireEvent.blur(field('01.09'))
      })
      // Never the old figure (or an empty cell) written back over the other save.
      expect(posted).toHaveLength(0)
      expect(field('02.09').value).toBe('700.000')
      expect(field('01.09').value).toBe('2.000.000')
    })

    it('rings the field that has focus', async () => {
      fixture = withCosts(true)
      await draw()
      expect(field('02.09').style.boxShadow).toContain('var(--border-strong)')
      fireEvent.focus(field('02.09'))
      expect(field('02.09').style.boxShadow).toBe('inset 0 0 0 2px var(--accent)')
      fireEvent.blur(field('02.09'))
      await act(async () => {})
      expect(field('02.09').style.boxShadow).toContain('var(--border-strong)')
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
      for (const typo of ['12.5', '1.2345', '-300', '12abc', '2000000000000', '1.250 000']) {
        fireEvent.change(field('02.09'), { target: { value: typo } })
        fireEvent.keyDown(field('02.09'), { key: 'Enter' })
        const input = field('02.09')
        expect(input.getAttribute('aria-invalid')).toBe('true')
        const message = document.getElementById(input.getAttribute('aria-describedby')!)!
        expect(message.getAttribute('role')).toBe('alert')
        expect(message.textContent).toMatch(/son|katta/)
        // The cell globals.css lifts over the rows below while it holds a refusal.
        expect(message.parentElement!.matches('td[data-cost-cell]')).toBe(true)
      }
      // Leaving the field does not send a typo either.
      fireEvent.blur(field('02.09'))
      await act(async () => {})
      expect(posted).toHaveLength(0)
      // Thousands under ONE separator — dots (as the field shows them), spaces or commas — are fine;
      // a mix («1.250 000», in the list above) is a typo.
      fireEvent.focus(field('02.09'))
      fireEvent.change(field('02.09'), { target: { value: '1 250 000' } })
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
      // With its sign, like the figures beside it (2026-10-02).
      expect(plan().value).toBe('80%')
      fireEvent.focus(plan())
      fireEvent.change(plan(), { target: { value: '82,5' } })
      await act(async () => {
        fireEvent.keyDown(plan(), { key: 'Enter' })
      })
      await waitFor(() => expect(posted).toHaveLength(1))
      expect(postedTo).toEqual(['/api/v1/rnp/plan'])
      expect(posted[0]).toEqual({ month: '2026-09', cells: [{ team: 'Lola', metric: 'plan_pct', value: 82.5 }] })
    })

    it('shows a dollar plan with its sign and takes one pasted from the client’s sheet, «16 000$» (2026-10-02)', async () => {
      const usd: RnpOverviewDto = {
        ...FIXTURE,
        canEditPlans: true,
        blocks: [
          ...FIXTURE.blocks,
          {
            id: 'marketing',
            kind: 'marketing',
            title: 'Маркетинг',
            subtitle: null,
            team: null,
            sheet: null,
            rows: [row({ key: 'meta:collagen:budget', label: 'Бюджет Collagen', unit: 'usd', plan: 36_000, planInput: { team: '', metric: 'budget_collagen' } })],
          },
        ],
        lines: [...FIXTURE.lines, { kind: 'value', row: 14, team: null, label: 'Бюджет Collagen', sub: null, tone: 'plain', fact: 'money', bold: false, key: 'meta:collagen:budget' }],
      }
      fixture = usd
      await draw()
      const budget = () => screen.getByRole('textbox', { name: 'Kompaniya · Бюджет Collagen — reja, $' }) as HTMLInputElement
      expect(budget().value).toBe('$36.000')
      // Tabbing through what the field shows sends nothing.
      fireEvent.focus(budget())
      await act(async () => {
        fireEvent.blur(budget())
      })
      expect(posted).toHaveLength(0)
      fireEvent.focus(budget())
      fireEvent.change(budget(), { target: { value: '16 000$' } })
      await act(async () => {
        fireEvent.keyDown(budget(), { key: 'Enter' })
      })
      await waitFor(() => expect(posted).toHaveLength(1))
      expect(posted[0]).toEqual({ month: '2026-09', cells: [{ team: '', metric: 'budget_collagen', value: 16_000 }] })
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
    const withHeads = (days: (number | null)[] = [6, null, null], canEditPlans = true, headcountTeams?: string[]): RnpOverviewDto => ({
      ...FIXTURE,
      canEditPlans,
      headcountTeams,
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

    it('opens a ROP only their own team’s row (2026-10-07)', async () => {
      fixture = withHeads([6, null, null], false, ['Lola'])
      await draw()
      expect(field('02.09')).toBeTruthy()
      expect(screen.queryAllByRole('textbox', { name: /^Aziz · Ходим сони/ })).toHaveLength(0)
      fireEvent.focus(field('02.09'))
      fireEvent.change(field('02.09'), { target: { value: '7' } })
      await act(async () => {
        fireEvent.keyDown(field('02.09'), { key: 'Enter' })
      })
      await waitFor(() => expect(posted).toHaveLength(1))
      expect(posted[0]).toEqual({ month: '2026-09', cells: [{ day: '2026-09-02', rop: 'Lola', value: 7 }] })
    })

    it('opens nothing to a viewer who heads no team', async () => {
      fixture = withHeads([6, null, null], false, [])
      await draw()
      expect(screen.queryAllByRole('textbox')).toHaveLength(0)
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

describe('«ROP otchet» (moved here from «Lidlar», 2026-10-07)', () => {
  const money = (som: number) => ({ amountMinor: String(som * 100), currency: 'UZS', amount: som })
  const cells = (leads: number, fakt1: number) => ({
    leads,
    plan: money(leads * 500_000),
    fakt1: money(fakt1),
    deviation: money(leads * 500_000 - fakt1),
    fakt1Orders: 1,
    conversionPercent: leads > 0 ? 100 / leads : null,
    fakt2: money(0),
    fakt2Orders: 0,
    connectedCalls: 0,
    talkSec: 0,
  })
  const report = {
    day: '2026-10-07',
    groups: [
      {
        rop: 'Asliddin',
        sellers: [{ employeeId: 'e2', fullName: 'Sardor Davlatov', isHead: false, onRoster: true, ...cells(12, 4_800_000) }],
        total: cells(12, 4_800_000),
      },
    ],
    total: cells(12, 4_800_000),
  }

  it('is the second tab: the report on its own day, and the sheet is not asked for while it is open', async () => {
    const asked: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        asked.push(new URL(url, 'http://x').pathname)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: String(url).includes('/registration/report') ? report : fixture,
            meta: { dataSource: 'DEMO', generatedAt: '2026-10-07T06:00:00.000Z' },
          }),
        }
      }),
    )
    await draw()
    const tabs = within(screen.getByRole('group', { name: 'Qaysi jadval' }))
    expect(tabs.getByRole('button', { name: 'RNP jadvali' }).getAttribute('aria-pressed')).toBe('true')
    expect(asked.some((p) => p.endsWith('/registration/report'))).toBe(false)

    const sheetReads = asked.length
    fireEvent.click(tabs.getByRole('button', { name: 'ROP otchet' }))
    await waitFor(() => expect(screen.getByText('Sardor Davlatov')).toBeTruthy())
    expect(screen.queryByRole('region', { name: 'RNP jadvali' })).toBeNull()
    // The sheet's month and ROP controls belong to the sheet.
    expect(within(screen.getByTestId('page-toolbar')).queryByText('Oy')).toBeNull()
    expect(asked.slice(sheetReads).every((p) => p.endsWith('/registration/report'))).toBe(true)

    fireEvent.click(tabs.getByRole('button', { name: 'RNP jadvali' }))
    await waitFor(() => expect(screen.getByRole('region', { name: 'RNP jadvali' })).toBeTruthy())
  })
})
