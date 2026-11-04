// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AiReport, AiStatus } from '@/features/aiRegistrator/aiLiveLogic'
import { AiControlPage } from '@/features/aiRegistrator/AiControlPage'
import { AiNowPanel, type NowPanelProps } from '@/features/aiRegistrator/AiNowPanel'

/**
 * «Hozir · jonli» (the owner's design canvas, 2026-11-02): one lane per AI
 * line, the sellers as chips, the live feed, why it is not dialling — and
 * Boshqaruv's two reads with its settings. Fake names and deals only.
 * Fake names and deals only.
 */

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

vi.mock('@/features/shared/PageShell', () => ({
  PageShell: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}))

const at = (hhmm: string, s = '00') => new Date(`2026-10-31T${hhmm}:${s}+05:00`).toISOString()
const since = at('10:00')

const report: AiReport = {
  at: at('10:00', '40'),
  appliedVersion: 3,
  applyError: null,
  limits: { calls: 6, maxNew: 4, maxRetry: 2, saleHandoff: 'refer', maxSipLegs: 10, fused: false },
  lines: { '178': 'free', '290': 'call', '291': 'call', '292': 'call', '293': 'call', '295': 'call', '296': 'not_registered', '297': 'free' },
  sellers: [
    { ext: '120', name: '120 Dilnoza Karimova 120', state: 'busy', inList: true, transfersToday: 2, product: 'Kollagen', aiRinging: false },
    { ext: '122', name: 'Malika', state: 'free', inList: true, transfersToday: 1, product: 'Kollagen', aiRinging: true },
    { ext: '128', name: 'Sevara', state: 'free', inList: true, transfersToday: 0, product: 'Kollagen', aiRinging: false },
    { ext: '131', name: 'Kamola', state: 'offline', inList: true, transfersToday: 0, product: 'Zekstra', aiRinging: false },
  ],
  live: {
    lines: [
      { line: '290', deal: 1001, product: 'Kollagen', client: 'Aziz', test: false, state: 'dialing', since, seller: null },
      { line: '291', deal: 1002, product: 'Kollagen', client: 'Bobur', test: false, state: 'talking', since, seller: null, started: at('09:59', '50') },
      { line: '292', deal: 1003, product: 'Zekstra', client: 'Jasur', test: true, state: 'transfer', since, seller: null },
      { line: '293', deal: 1004, product: 'Kollagen', client: 'Laylo', test: false, state: 'ringing_seller', since, seller: '122' },
      { line: '295', deal: 1005, product: 'Kollagen', client: 'Nodira', test: false, state: 'with_seller', since, seller: '120', connected: true },
    ],
    recent: [
      { at: at('09:58'), line: '295', deal: 1005, product: 'Kollagen', client: 'Nodira', test: false, what: 'connected', seller: '120', started: at('09:57', '18') },
      { at: at('09:55'), line: '291', deal: 1006, product: null, client: 'Olim', test: true, what: 'hung_up_early', seller: null },
    ],
  },
  today: { calls: 40, answered: 22, transferred: 7, transferFailed: 2, atsRejected: 1 },
}

const status = (over: Partial<AiStatus> = {}): AiStatus => ({ receivedAt: at('10:00', '40'), stale: false, report, ...over })

const props = (over: Partial<NowPanelProps> = {}): NowPanelProps => ({
  status: status(),
  saved: { maxCalls: 4, maxNew: 4, maxRetry: 0 },
  staleAfterSec: 90,
  now: new Date(at('10:00', '42')),
  updatedAt: at('10:00', '41'),
  updateFailed: false,
  nameOf: (ext: string) => ({ '120': '120 Dilnoza Karimova 120', '122': 'Malika' } as Record<string, string>)[ext] ?? null,
  ...over,
})

const lane = (line: string) => screen.getByRole('listitem', { name: `Liniya ${line}` })

describe('AiNowPanel', () => {
  it('leads with LIVE and one sentence counted from the lanes, the busy lines, the limit and the time', () => {
    render(<AiNowPanel {...props()} />)
    expect(screen.getByRole('status').textContent).toBe('LIVE')
    expect(screen.getByText('1 ta terilmoqda · AI 1 kishi bilan gaplashyapti · 2 ta ulanmoqda · 1 ta sotuvchida')).toBeTruthy()
    expect(screen.getByText('yangilandi 10:00:41')).toBeTruthy()
  })

  it('draws every AI line as a lane — its phase, who, whom, and the call\'s own start for the timer', () => {
    render(<AiNowPanel {...props()} />)
    expect(lane('290').getAttribute('data-phase')).toBe('dial')
    expect(within(lane('290')).getByText('Terilmoqda')).toBeTruthy()
    expect(within(lane('290')).getByText('Aziz')).toBeTruthy()
    expect(lane('291').getAttribute('data-phase')).toBe('ai')
    // `started` 09:59:50 → 52 s at 10:00:42, not `since` 10:00:00.
    expect(within(lane('291')).getByText('00:52')).toBeTruthy()
    expect(lane('292').getAttribute('data-phase')).toBe('queue')
    expect(within(lane('292')).getByText('Sinov')).toBeTruthy()
    expect(lane('293').getAttribute('data-phase')).toBe('xfer')
    expect(within(lane('293')).getByText('Malika')).toBeTruthy()
    expect(lane('295').getAttribute('data-phase')).toBe('ok')
    expect(lane('178').getAttribute('data-phase')).toBe('idle')
    expect(lane('296').getAttribute('data-phase')).toBe('bad')
    expect(within(lane('296')).getByText('ATS bilmaydi')).toBeTruthy()
  })

  it('shows a line the map has on a call with no live record — a test call — as a busy lane', () => {
    const r: AiReport = { ...report, lines: { ...report.lines, '294': 'call' } }
    render(<AiNowPanel {...props({ status: status({ report: r }) })} />)
    expect(lane('294').getAttribute('data-phase')).toBe('ai')
  })

  it('puts the sellers on one row, the AI-ringing one first; a busy one with the AI client and a timer', () => {
    const r: AiReport = { ...report, sellers: report.sellers.map((s) => (s.ext === '120' ? { ...s, since: at('09:58', '10'), word: 'On the phone' } : s)) }
    render(<AiNowPanel {...props({ status: status({ report: r }) })} />)
    const chips = within(screen.getByRole('region', { name: 'Sotuvchilar hozir' })).getAllByRole('listitem')
    expect(chips[0]!.getAttribute('aria-label')).toBe('Sotuvchi 122')
    const busy = screen.getByRole('listitem', { name: 'Sotuvchi 120' })
    expect(busy.getAttribute('data-state')).toBe('busy')
    expect(busy.textContent).toContain('AI mijozi bilan')
    expect(busy.textContent).toContain('02:32')
  })

  it('lists the last put-throughs, and how long into the call the put-through came', () => {
    render(<AiNowPanel {...props()} />)
    const rows = screen.getByRole('region', { name: 'Soʻnggi ulanishlar' }).querySelectorAll('ul > li')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.textContent).toContain('42 s da ulandi')
    expect(rows[1]!.textContent).toContain('Gaplashmay qoʻydi')
  })

  it('draws the live feed only when the agent sends events, counting «Koʻtarmadi»', () => {
    const { unmount } = render(<AiNowPanel {...props()} />)
    expect(screen.queryByRole('region', { name: 'Jonli lenta' })).toBeNull()
    unmount()
    const events = [
      { at: at('10:00', '30'), line: '290', deal: 1001, product: 'Kollagen', client: 'Aziz', test: false, what: 'dial', seller: null },
      { at: at('10:00', '10'), line: '297', deal: 1007, product: null, client: 'Sardor', test: false, what: 'no_answer', seller: null },
      { at: at('09:59'), line: '178', deal: 1008, product: null, client: 'Umid', test: false, what: 'ats_rejected', seller: null },
    ]
    render(<AiNowPanel {...props({ status: status({ report: { ...report, live: { ...report.live!, events } } }) })} />)
    const feed = screen.getByRole('region', { name: 'Jonli lenta' })
    expect(feed.textContent).toContain('soʻnggi 3 ta voqea · 1 tasi koʻtarmadi')
    expect(feed.textContent).toContain('Terilmoqda')
    expect(feed.textContent).toContain('Koʻtarmadi')
    expect(feed.textContent).toContain('Boshqa / ATS rad etdi')
  })

  it('says why the agent is not dialling, from its flags', () => {
    render(<AiNowPanel {...props({ status: status({ report: { ...report, flags: { no_free_specialist: true, credits_out: false } } }) })} />)
    expect(screen.getByRole('note', { name: 'Nega termayapti' }).textContent).toContain('Hamma sotuvchi band')
    expect(screen.getByRole('note', { name: 'Nega termayapti' }).textContent).not.toContain('kredit')
  })

  it('takes a report with no live part, and a silent AI out of hours', () => {
    const old: AiReport = { ...report, live: null, sellers: report.sellers.map(({ product: _p, aiRinging: _r, ...s }) => s) }
    render(<AiNowPanel {...props({ status: status({ report: old, receivedAt: at('22:01') }), now: new Date(at('22:30')) })} />)
    expect(screen.getByRole('status').textContent).toContain('Ish vaqti emas (09:00–22:00)')
    expect(lane('290').getAttribute('data-phase')).toBe('ai')
    expect(screen.getByRole('listitem', { name: 'Sotuvchi 120' }).getAttribute('data-state')).toBe('unknown')
  })

  it('is red when the AI is silent within the day', () => {
    render(<AiNowPanel {...props({ now: new Date(at('10:05')) })} />)
    expect(screen.getByRole('status').textContent).toContain('AI javob bermayapti — oxirgi xabar 10:00')
  })
})

describe('AiControlPage — the design\'s Boshqaruv, two reads', () => {
  it('shows the status card, the live lines, the sellers, limits and hand-off, and saves from the bar', async () => {
    const asked: { url: string; body?: unknown }[] = []
    const panel = {
      config: { version: 3, enabled: false, sellers: ['120', '122'], parked: ['128'], maxCalls: 4, maxNew: 4, maxRetry: 0, saleHandoff: 'refer', updatedAt: at('09:00'), updatedBy: 'adminjon' },
      status: status(),
      names: {},
      rules: { aiLines: ['178', '290'], maxCalls: 8, maxSellers: 60, staleAfterSec: 90 },
      history: [{ version: 3, savedAt: at('09:00'), savedBy: 'adminjon', lines: ['Bir vaqtda: 6 → 4'] }],
    }
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      asked.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      const body = init?.method === 'POST' ? { version: 4 } : url.includes('part=live') ? { status: status(), staleAfterSec: 90 } : panel
      return new Response(JSON.stringify({ data: body, meta: { generatedAt: at('10:00', '41') } }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <AiControlPage />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Dilnoza ishlayapti')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'AI liniyalari (SIP)' })).toBeTruthy()
    const table = screen.getByRole('table', { name: 'Sotuvchilar' })
    expect(within(table).getByText('Oʻchirib qoʻyilganlar · 1')).toBeTruthy()
    // No order: the agent picks by its own `transferOrder`.
    expect(screen.queryByRole('button', { name: '120 — yuqoriga' })).toBeNull()
    expect(screen.getByRole('img', { name: /Bir vaqtda 4 ta qoʻngʻiroq: yangi lidlarga koʻpi bilan 4 ta, nedozvonga koʻpi bilan 0 ta/ })).toBeTruthy()
    const saveButton = screen.getByRole('button', { name: 'Saqlash' })
    expect(saveButton.hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('switch', { name: '128 — AI ulashi' }))
    expect(saveButton.hasAttribute('disabled')).toBe(false)
    fireEvent.click(saveButton)
    await screen.findByText('Oʻzgarish yoʻq')
    const post = asked.find((a) => a.body !== undefined)
    expect(post?.body).toMatchObject({ baseVersion: 3, sellers: ['120', '122', '128'], parked: [] })
    // «Saqlash» carries no stop: a stopped AI whose sellers change stays stopped (2026-11-04).
    expect(post?.body).not.toHaveProperty('enabled')
    expect(asked.some((a) => a.url.endsWith('/api/v1/leads/ai-registrator/control?part=live'))).toBe(true)
    vi.unstubAllGlobals()
  })
})

/**
 * «Limitlar» (the owner, 2026-11-02): «yangi» 0 and «nedozvon» 0 together is
 * not a stop but «any lead», so the panel will not let it be saved; shares
 * that fall short of «bir vaqtda» leave grey idle slots and «amalda N ta»;
 * and the section says whether the agent applied the saved version.
 */
describe('AiControlPage — Limitlar', () => {
  const renderWith = async (limits: { maxCalls: number; maxNew: number; maxRetry: number }, st: AiStatus) => {
    const panel = {
      config: { version: 15, sellers: ['120', '122'], parked: [], ...limits, saleHandoff: 'refer', updatedAt: at('10:57'), updatedBy: 'adminjon' },
      status: st,
      names: {},
      rules: { aiLines: ['178', '290'], maxCalls: 8, maxSellers: 60, staleAfterSec: 90 },
      history: [],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body = url.includes('part=live') ? { status: st, staleAfterSec: 90 } : panel
        return new Response(JSON.stringify({ data: body, meta: { generatedAt: at('10:58') } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <AiControlPage />
      </QueryClientProvider>,
    )
    return screen.findByRole('region', { name: 'Limitlar' })
  }
  const applied = (over: Partial<AiReport>) => status({ report: { ...report, ...over } })
  afterEach(() => vi.unstubAllGlobals())

  it('greys the slots the shares never fill and says «amalda 2 ta» for 4 / 0 / 2', async () => {
    const section = await renderWith({ maxCalls: 4, maxNew: 0, maxRetry: 2 }, applied({ appliedVersion: 15, limits: { calls: 4, maxNew: 0, maxRetry: 2 } }))
    const bar = within(section).getByRole('img', { name: /Amalda bir vaqtda 2 ta qoʻngʻiroq \(4 ta qoʻyilgan\)/ })
    expect([...bar.querySelectorAll('[data-slot]')].map((e) => e.getAttribute('data-slot'))).toEqual(['retry', 'retry', 'idle', 'idle'])
    expect(within(section).getByText('amalda 2 ta')).toBeTruthy()
    // «yangi» is 0, so «nedozvon» may not go below 1 — and the panel says why.
    expect(within(section).getByRole('button', { name: 'Shundan nedozvonga — kamaytirish' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(within(section).getByRole('button', { name: 'Shundan nedozvonga — kamaytirish' }))
    expect(within(section).getByRole('button', { name: 'Shundan nedozvonga — kamaytirish' }).hasAttribute('disabled')).toBe(true)
    expect(within(section).getByText(/ikkalasi birga 0 boʻlmaydi — bu AIni toʻxtatmaydi, aksincha istalgan lidga teradi/)).toBeTruthy()
    // The saved v15 is what the agent runs.
    expect(within(section).getByText('AI qoʻlladi ✓ v15')).toBeTruthy()
    expect(within(section).getByText('Hozir AIda: bir vaqtda 4, yangi 0, nedozvon 2')).toBeTruthy()
  })

  it('will not save 0 and 0, and shows the agent\'s refusal in red', async () => {
    const section = await renderWith(
      { maxCalls: 4, maxNew: 0, maxRetry: 0 },
      applied({ appliedVersion: 14, applyError: 'yangi va nedozvon ikkalasi 0 bo‘lmaydi' }),
    )
    expect(within(section).getByRole('img', { name: /ikkalasi 0 — AI bu sozlamani rad etadi/ })).toBeTruthy()
    expect(within(section).getByText('AI rad etdi v15')).toBeTruthy()
    expect(within(section).getByText('Sabab: yangi va nedozvon ikkalasi 0 bo‘lmaydi')).toBeTruthy()
    // Raising one share makes it savable; the bar names the problem until then.
    expect(screen.getByRole('region', { name: 'Saqlash' }).textContent).toContain('ikkalasi birga 0 boʻlmaydi')
    fireEvent.click(within(section).getByRole('button', { name: 'Shundan yangi lidlarga — oshirish' }))
    expect(screen.getByRole('button', { name: 'Saqlash' }).hasAttribute('disabled')).toBe(false)
  })
})
