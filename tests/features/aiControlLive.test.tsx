// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AiReport, AiStatus } from '@/features/aiRegistrator/aiLiveLogic'
import { AiControlPage, LiveBoard, type LiveBoardProps } from '@/features/aiRegistrator/AiControlPage'

/**
 * «AI registrator → Boshqaruv» live board (2026-10-31): every line state on
 * its card, the sellers in their colours, the feed — and the page's two reads.
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
    { ext: '120', name: 'Dilnoza', state: 'busy', inList: true, transfersToday: 2, product: 'Kollagen', aiRinging: false },
    { ext: '122', name: 'Malika', state: 'free', inList: true, transfersToday: 1, product: 'Kollagen', aiRinging: true },
    { ext: '128', name: 'Sevara', state: 'free', inList: true, transfersToday: 0, product: 'Kollagen', aiRinging: false },
    { ext: '131', name: 'Kamola', state: 'offline', inList: true, transfersToday: 0, product: 'Zekstra', aiRinging: false },
  ],
  live: {
    lines: [
      { line: '290', deal: 1001, product: 'Kollagen', client: 'Aziz', test: false, state: 'dialing', since, seller: null },
      { line: '291', deal: 1002, product: 'Kollagen', client: 'Bobur', test: false, state: 'talking', since, seller: null },
      { line: '292', deal: 1003, product: 'Zekstra', client: 'Jasur', test: true, state: 'transfer', since, seller: null },
      { line: '293', deal: 1004, product: 'Kollagen', client: 'Laylo', test: false, state: 'ringing_seller', since, seller: '122' },
      { line: '295', deal: 1005, product: 'Kollagen', client: 'Nodira', test: false, state: 'with_seller', since, seller: '120', connected: true },
    ],
    recent: [
      { at: at('09:58'), line: '295', deal: 1005, product: 'Kollagen', client: 'Nodira', test: false, what: 'connected', seller: '120' },
      { at: at('09:55'), line: '291', deal: 1006, product: null, client: 'Olim', test: true, what: 'hung_up_early', seller: null },
    ],
  },
  today: { calls: 40, answered: 22, transferred: 7, transferFailed: 2, atsRejected: 1 },
}

const status = (over: Partial<AiStatus> = {}): AiStatus => ({ receivedAt: at('10:00', '40'), stale: false, report, ...over })

const props = (over: Partial<LiveBoardProps> = {}): LiveBoardProps => ({
  status: status(),
  saved: { maxCalls: 4, maxNew: 4, maxRetry: 0 },
  staleAfterSec: 90,
  now: new Date(at('10:00', '42')),
  updatedAt: at('10:00', '41'),
  updateFailed: false,
  nameOf: (ext) => ({ '120': 'Dilnoza', '122': 'Malika' })[ext] ?? null,
  ...over,
})

const card = (label: string) => screen.getByRole('listitem', { name: label })

describe('LiveBoard', () => {
  it('says the AI works, the day\'s numbers and the limits it applies beside the saved ones', () => {
    render(<LiveBoard {...props()} />)
    expect(screen.getByRole('status').textContent).toContain('AI ishlayapti · 5 liniya band / 8')
    expect(screen.getByText('Yangilandi: 10:00:41')).toBeTruthy()
    expect(screen.getByText('Bir vaqtda 6 = 4 yangi lid + 2 nedozvon')).toBeTruthy()
    expect(screen.getByText('Saqlangan: 4/4/0 · AI qoʻllagani: 6/4/2 (v3)')).toBeTruthy()
  })

  it('draws every line state on its card, the test call and the deal link', () => {
    render(<LiveBoard {...props()} />)
    expect(within(card('Liniya 178')).getByText('Boʻsh')).toBeTruthy()
    expect(within(card('Liniya 290')).getByText('Mijozga terilmoqda · Aziz · 0:42')).toBeTruthy()
    expect(within(card('Liniya 291')).getByText('AI ↔ Bobur · Kollagen · 0:42')).toBeTruthy()
    expect(within(card('Liniya 292')).getByText('Mijoz kutyapti — boʻsh sotuvchi qidirilmoqda · 0:42')).toBeTruthy()
    expect(within(card('Liniya 292')).getByText('SINOV')).toBeTruthy()
    expect(within(card('Liniya 292')).getByText('Zextra')).toBeTruthy()
    expect(within(card('Liniya 293')).getByText('Sotuvchi 122 (Malika) ga jiringlayapti · 0:42')).toBeTruthy()
    expect(within(card('Liniya 295')).getByText('Sotuvchi 120 (Dilnoza) bilan ulandi · 0:42')).toBeTruthy()
    expect(within(card('Liniya 296')).getByText('ATSʼda roʻyxatda emas')).toBeTruthy()
    const link = within(card('Liniya 291')).getByRole('link', { name: /Bitim 1002/ })
    expect(link.getAttribute('href')).toBe('https://obey.bitrix24.kz/crm/deal/details/1002/')
  })

  it('colours the sellers: the AI ringing first, then talking, free, off the line — by product', () => {
    render(<LiveBoard {...props()} />)
    expect(within(card('Sotuvchi 122')).getByText(/AI jiringlatmoqda/)).toBeTruthy()
    expect(within(card('Sotuvchi 120')).getByText(/Gaplashyapti · bugun 2 ta ulandi/)).toBeTruthy()
    expect(within(card('Sotuvchi 128')).getByText(/Boʻsh/)).toBeTruthy()
    expect(within(card('Sotuvchi 131')).getByText(/Liniyada yoʻq/)).toBeTruthy()
    expect(screen.getByText('Zextra', { selector: '.eyebrow' })).toBeTruthy()
  })

  it('lists the last put-throughs, newest first', () => {
    render(<LiveBoard {...props()} />)
    expect(screen.getByText('295 → 120 (Dilnoza) · Kollagen · Nodira — ulandi')).toBeTruthy()
    expect(screen.getByText('291 · Olim — gaplashmay qoʻydi')).toBeTruthy()
  })

  it('takes the report on prod today — no live part — and a silent AI out of hours', () => {
    const old: AiReport = { ...report, live: null, sellers: report.sellers.map(({ product: _p, aiRinging: _r, ...s }) => s) }
    render(<LiveBoard {...props({ status: status({ report: old, receivedAt: at('18:31') }), now: new Date(at('20:00')) })} />)
    expect(screen.getByRole('status').textContent).toContain('Ish vaqti emas (09:00–18:30)')
    expect(within(card('Liniya 290')).getByText('Qoʻngʻiroqda')).toBeTruthy()
    expect(screen.getByText('AI bu maʼlumotni hali yubormayapti.')).toBeTruthy()
    expect(screen.getByText(/Eskirgan — AI javob bermayapti/)).toBeTruthy()
  })

  it('is red when the AI is silent within the day', () => {
    render(<LiveBoard {...props({ now: new Date(at('10:05')) })} />)
    expect(screen.getByRole('status').textContent).toContain('AI javob bermayapti — oxirgi xabar 10:00')
  })
})

describe('AiControlPage — two reads, the management kept', () => {
  it('polls the last report alone beside the panel, and keeps «Saqlash»', async () => {
    const asked: unknown[] = []
    const panel = {
      config: { version: 3, sellers: ['120', '122'], parked: [], maxCalls: 4, maxNew: 4, maxRetry: 0, saleHandoff: 'refer', updatedAt: at('09:00'), updatedBy: 'adminjon' },
      status: status(),
      names: {},
      rules: { aiLines: ['178', '290'], maxCalls: 8, maxSellers: 60, staleAfterSec: 90 },
      history: [],
    }
    const fetchMock = vi.fn(async (url: string) => {
      asked.push(url)
      const body = url.includes('part=live') ? { status: status(), staleAfterSec: 90 } : panel
      return new Response(JSON.stringify({ data: body, meta: { generatedAt: at('10:00', '41') } }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <AiControlPage />
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('button', { name: 'Saqlash' })).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Sotuvchilar' })).toBeTruthy()
    expect(asked.some((u) => String(u).endsWith('/api/v1/leads/ai-registrator/control?part=live'))).toBe(true)
    expect(asked.some((u) => String(u).endsWith('/api/v1/leads/ai-registrator/control'))).toBe(true)
    vi.unstubAllGlobals()
  })
})
