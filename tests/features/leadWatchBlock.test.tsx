// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LeadWatchDto, LeadWatchIssueDto, LeadWatchRowDto, WatchIssueKind, WatchSeverity } from '@/features/leads/leadWatchApi'

/**
 * «Лид назорати» as a reader meets it: the cards in the order of their
 * trouble, a calm card that opens nothing, and the drawer — its chips, its
 * fifty rows at a time, its way to Bitrix24, and the modal discipline (Escape,
 * the scrim, focus back on the card). The network is the contract in
 * `leadWatchApi.ts`, answered by a stub.
 */

// jsdom has no `matchMedia`: reduced motion on (numbers render settled), and a desk-wide drawer.
window.matchMedia = ((query: string) => ({
  matches: query.includes('prefers-reduced-motion') || query.includes('min-width'),
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

const { LeadWatch } = await import('@/features/leads/LeadWatch')
const { useCriticalTitle, useLeadWatchCritical } = await import('@/features/leads/leadWatchQueries')

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

function row(n: number, over: Partial<LeadWatchRowDto> = {}): LeadWatchRowDto {
  return {
    key: `r${n}`,
    dealId: String(1_050_000 + n),
    title: `Mijoz ${n}`,
    channel: n % 3 === 0 ? 'smm' : 'generated',
    brand: n % 2 === 0 ? 'Collagen' : 'Zextra',
    owner: null,
    rop: null,
    since: ago(200 - n),
    note: null,
    ...over,
  }
}

function issue(kind: WatchIssueKind, severity: WatchSeverity, over: Partial<LeadWatchIssueDto> = {}): LeadWatchIssueDto {
  const rows = over.rows ?? []
  return {
    kind,
    count: rows.length,
    severity,
    oldestSince: rows[0]?.since ?? null,
    summary: null,
    byChannel: {
      generated: rows.filter((r) => r.channel === 'generated').length,
      smm: rows.filter((r) => r.channel === 'smm').length,
      inbound: rows.filter((r) => r.channel === 'inbound').length,
      telegram: rows.filter((r) => r.channel === 'telegram').length,
      other: rows.filter((r) => r.channel === 'other').length,
    },
    rows,
    ...over,
  }
}

const SEVENTY = Array.from({ length: 70 }, (_, i) => row(i + 1))

const BUSY: LeadWatchDto = {
  generatedAt: ago(0),
  dataAsOf: ago(1),
  critical: 2,
  issues: [
    issue('unassigned', 'critical', { rows: SEVENTY }),
    issue('idle', 'warn', {
      rows: [
        row(101, { title: 'Dilnoza Karimova', owner: 'Sevinch Tursunova', rop: 'Gulzora', note: 'Umar formasi', channel: 'inbound', since: ago(72) }),
        row(102, { title: '+998 90 123 45 67', dealId: null, owner: null, rop: null, channel: 'other', brand: null, since: null }),
      ],
    }),
    issue('chats', 'ok'),
    issue('missedCalls', 'warn', { rows: [row(201, { channel: 'inbound' })] }),
    issue('channelStop', 'critical', { summary: '1 forma', rows: [row(301, { title: 'Umar formasi', dealId: null, since: ago(95) })] }),
    issue('uneven', 'ok'),
    issue('noProject', 'ok'),
  ],
  flow: { hours: [], stops: [] },
}

const CALM: LeadWatchDto = {
  generatedAt: ago(0),
  dataAsOf: ago(0),
  critical: 0,
  issues: (['unassigned', 'idle', 'chats', 'missedCalls', 'channelStop', 'uneven', 'noProject'] as const).map((kind) => issue(kind, 'ok')),
  flow: { hours: [], stops: [] },
}

const envelope = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ data, meta: { dataSource: 'BITRIX24', generatedAt: new Date().toISOString() } }),
})

let answer: (url: string) => unknown

beforeEach(() => {
  answer = () => envelope(BUSY)
  vi.stubGlobal('fetch', vi.fn(async (url: string) => answer(url)))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function mount(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

const cardTitles = () => screen.getAllByRole('listitem').map((li) => li.querySelector('[data-severity]')).filter(Boolean)

describe('the block', () => {
  it('asks /leads/watch once, with no period and no brand', async () => {
    mount(<LeadWatch />)
    await screen.findByText('Не распределены')
    const calls = vi.mocked(fetch).mock.calls.map(([url]) => String(url))
    expect(calls).toEqual(['/api/v1/leads/watch'])
  })

  it('orders the cards critical, then warnings, then calm — each group in the client’s order', async () => {
    mount(<LeadWatch />)
    await screen.findByText('Не распределены')
    expect(cardTitles().map((card) => [card!.textContent!.match(/^[^\d]+?(?=\d|Joyida)/)?.[0], card!.getAttribute('data-severity')])).toEqual([
      ['Не распределены', 'critical'],
      ['Канал стоп', 'critical'],
      ['Не обработаны', 'warn'],
      ['Пропущенные звонки', 'warn'],
      ['Чаты без ответа', 'ok'],
      ['Неравномерно', 'ok'],
      ['Без проекта', 'ok'],
    ])
  })

  it('prints the count, and under it the longest wait, the server’s own line, or «qayta qilinmagan»', async () => {
    mount(<LeadWatch />)
    const unassigned = (await screen.findByText('Не распределены')).closest('[data-severity]') as HTMLElement
    expect(within(unassigned).getByText('70')).toBeTruthy()
    expect(within(unassigned).getByText('eng uzoq kutayotgan: 3 soat 19 daq')).toBeTruthy()
    expect(within(screen.getByText('Канал стоп').closest('[data-severity]') as HTMLElement).getByText('1 forma')).toBeTruthy()
    expect(within(screen.getByText('Пропущенные звонки').closest('[data-severity]') as HTMLElement).getByText('qayta qilinmagan')).toBeTruthy()
  })

  it('makes a troubled card a button and leaves a calm, empty one as plain text', async () => {
    mount(<LeadWatch />)
    await screen.findByText('Не распределены')
    const troubled = screen.getByRole('button', { name: /Не распределены/ })
    expect(troubled.getAttribute('aria-expanded')).toBe('false')
    const calm = screen.getByText('Чаты без ответа').closest('[data-severity]') as HTMLElement
    expect(calm.tagName).toBe('DIV')
    expect(within(calm).getByText('Joyida')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Чаты без ответа/ })).toBeNull()
  })

  it('counts the critical problems in the header, then the warnings, then says all is well', async () => {
    mount(<LeadWatch />)
    expect((await screen.findByText('2 ta muhim muammo')).closest('[role="status"]')).toBeTruthy()
    expect(screen.getByText('Jonli · 1 daq oldin yangilandi')).toBeTruthy()
    cleanup()

    answer = () => envelope(CALM)
    mount(<LeadWatch />)
    expect(await screen.findByText('Hammasi joyida')).toBeTruthy()
    expect(screen.getAllByText('Joyida')).toHaveLength(7)
    expect(screen.queryAllByRole('button', { name: /Joyida/ })).toEqual([])
  })

  it('says the period and the brand do not reach it', async () => {
    mount(<LeadWatch />)
    expect(await screen.findByText(/butun kompaniya boʻyicha — yuqoridagi davr va brend filtri bu blokka taʼsir qilmaydi/)).toBeTruthy()
  })

  it('fails on its own: one compact line and a retry that asks again', async () => {
    answer = () => ({ ok: false, status: 500, json: async () => ({ error: { code: 'INTERNAL', message: 'Server xatosi.' }, meta: {} }) })
    mount(<LeadWatch />)
    expect(await screen.findByText('Lid nazorati maʼlumotini yuklab boʻlmadi')).toBeTruthy()
    expect(screen.getByText(/Server xatosi\./)).toBeTruthy()

    answer = () => envelope(BUSY)
    fireEvent.click(screen.getByRole('button', { name: 'Qayta urinish' }))
    expect(await screen.findByText('Не распределены')).toBeTruthy()
  })
})

describe('the drawer', () => {
  async function open(name: RegExp) {
    mount(<LeadWatch />)
    await screen.findByText('Не распределены')
    const card = screen.getByRole('button', { name })
    card.focus()
    fireEvent.click(card)
    return { card, dialog: await screen.findByRole('dialog') }
  }

  it('opens as a modal named by the problem, with its count, and takes the focus', async () => {
    const { card, dialog } = await open(/Не распределены/)
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(within(dialog).getByRole('heading', { name: 'Не распределены' })).toBeTruthy()
    expect(within(dialog).getByText('70 ta')).toBeTruthy()
    expect(card.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Yopish' }))
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('closes on Escape, gives the focus back to the card and lets the page scroll again', async () => {
    const { card, dialog } = await open(/Не распределены/)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(card)
    expect(document.body.style.overflow).toBe('')
    expect(card.getAttribute('aria-expanded')).toBe('false')
  })

  it('closes on a press of the scrim, and not on a press inside the panel', async () => {
    const { dialog } = await open(/Не распределены/)
    fireEvent.mouseDown(dialog)
    expect(screen.queryByRole('dialog')).toBeTruthy()
    fireEvent.mouseDown(dialog.parentElement!)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('keeps Tab inside: forward from the last stop lands on the first, and back again', async () => {
    const { dialog } = await open(/Не обработаны/)
    const stops = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')]
    const first = stops[0]!
    const last = stops[stops.length - 1]!
    last.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('lists fifty rows, then twenty more on «Yana 20 ta»', async () => {
    const { dialog } = await open(/Не распределены/)
    const body = () => within(dialog).getAllByRole('row').slice(1)
    expect(body()).toHaveLength(50)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yana 20 ta' }))
    expect(body()).toHaveLength(70)
    expect(within(dialog).queryByRole('button', { name: /^Yana/ })).toBeNull()
  })

  it('filters by channel, disables a channel with no rows, and starts the list over', async () => {
    const { dialog } = await open(/Не распределены/)
    const chip = (name: RegExp) => within(dialog).getByRole('button', { name })
    expect(chip(/^Hammasi\s*70$/).getAttribute('aria-pressed')).toBe('true')
    expect((chip(/^Входящий\s*0$/) as HTMLButtonElement).disabled).toBe(true)
    expect((chip(/^Телеграм\s*0$/) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(chip(/^СММ\s*23$/))
    expect(chip(/^СММ\s*23$/).getAttribute('aria-pressed')).toBe('true')
    const rows = within(dialog).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(23)
    expect(rows.every((r) => within(r).queryByText('СММ') !== null)).toBe(true)
  })

  it('draws a row: the customer and the note, the pill and the brand, the owner and the ROP, a timer, a link out', async () => {
    const { dialog } = await open(/Не обработаны/)
    const [full, bare] = within(dialog).getAllByRole('row').slice(1) as [HTMLElement, HTMLElement]

    expect(within(full).getByText('Dilnoza Karimova')).toBeTruthy()
    expect(within(full).getByText('Umar formasi')).toBeTruthy()
    expect(within(full).getByText('Входящий')).toBeTruthy()
    expect(within(full).getByRole('img', { name: 'Zextra' })).toBeTruthy()
    expect(within(full).getByText('Sevinch Tursunova')).toBeTruthy()
    expect(within(full).getByText('ROP: Gulzora')).toBeTruthy()
    expect(within(full).getByText('1 soat 12 daq')).toBeTruthy()
    const link = within(full).getByRole('link', { name: /Dilnoza Karimova — Bitrix24 da ochish/ })
    expect(link.getAttribute('href')).toBe('https://obey.bitrix24.kz/crm/deal/details/1050101/')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')

    // No deal, no owner, no timer: dashes and no link — and an «other» channel still gets its pill.
    expect(within(bare).queryByRole('link')).toBeNull()
    expect(within(bare).getByText('Boshqa')).toBeTruthy()
    expect(within(bare).getAllByText('—')).toHaveLength(2)
    expect(within(bare).queryByRole('img')).toBeNull()
  })

  it('reserves a leading slot in every row for a checkbox, and an empty bar for bulk actions', async () => {
    const { dialog } = await open(/Не обработаны/)
    for (const tr of dialog.querySelectorAll('tr')) {
      expect(tr.firstElementChild!.getAttribute('aria-hidden')).toBe('true')
      expect(tr.firstElementChild!.textContent).toBe('')
    }
    const bar = dialog.querySelector('[data-slot="bulk-actions"]') as HTMLElement
    expect(bar.hidden).toBe(true)
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
  })

  it('says how many are not listed when the server capped the rows', async () => {
    answer = () =>
      envelope({
        ...BUSY,
        issues: BUSY.issues.map((i) =>
          i.kind === 'unassigned' ? { ...i, count: 412, byChannel: { ...i.byChannel, generated: 389 } } : i,
        ),
      })
    const { dialog } = await open(/Не распределены/)
    expect(within(dialog).getByText('412 ta')).toBeTruthy()
    expect(within(dialog).getByText(/Jami 412 ta — eng uzoq kutayotgan 70 tasi roʻyxatda, qolgan 342 tasi koʻrsatilmagan\./)).toBeTruthy()
  })
})

describe('the badge and the tab title', () => {
  function Probe({ enabled }: { enabled: boolean }) {
    const critical = useLeadWatchCritical(enabled)
    useCriticalTitle('Lidlar', critical)
    return <span data-testid="critical">{critical}</span>
  }

  it('asks the summary, prefixes the title while something is critical, and puts it back on leaving', async () => {
    document.title = 'SinoLife — Savdo tahlili'
    answer = () => envelope({ critical: 3 })
    const view = mount(<Probe enabled />)
    await waitFor(() => expect(screen.getByTestId('critical').textContent).toBe('3'))
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual(['/api/v1/leads/watch/summary'])
    expect(document.title).toBe('(3) Lidlar')
    view.unmount()
    expect(document.title).toBe('SinoLife — Savdo tahlili')
  })

  it('leaves the title alone at zero', async () => {
    document.title = 'SinoLife — Savdo tahlili'
    answer = () => envelope({ critical: 0 })
    mount(<Probe enabled />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(document.title).toBe('SinoLife — Savdo tahlili')
  })

  it('never asks for an account without the section', async () => {
    mount(<Probe enabled={false} />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.getByTestId('critical').textContent).toBe('0')
  })

  it('hands the block’s own count to the badge, so the two cannot disagree', async () => {
    answer = (url) => envelope(url.endsWith('/summary') ? { critical: 9 } : BUSY)
    mount(
      <>
        <Probe enabled />
        <LeadWatch />
      </>,
    )
    await screen.findByText('2 ta muhim muammo')
    await waitFor(() => expect(screen.getByTestId('critical').textContent).toBe('2'))
  })
})
