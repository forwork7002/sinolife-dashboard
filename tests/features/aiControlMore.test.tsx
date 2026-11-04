// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AiLine, AiReport, AiStatus } from '@/features/aiRegistrator/aiLiveLogic'
import { AiControlPage } from '@/features/aiRegistrator/AiControlPage'

/**
 * The rest of «Boshqaruv» (2026-11-04, T144, the owner: «hamma narsani
 * boshqara olsin … to'xtatib qo'yish funksiyalari, SIP bilan ishlash»): what
 * each control sends — its own body, never part of «Saqlash» — and what it
 * refuses before sending. Fake names and lines only.
 */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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

const at = (hhmm: string, s = '00') => new Date(`2026-11-04T${hhmm}:${s}+05:00`).toISOString()

const line = (ext: string, over: Partial<AiLine> = {}): AiLine => ({ ext, pool: 'main', transport: 'udp', state: 'free', registration: 'Registered', enabled: true, ...over })

const LINES: AiLine[] = [
  line('178'),
  line('290'),
  line('291', { transport: 'tls', registration: 'Rejected', state: 'not_registered' }),
  line('292', { transport: 'tls', registration: 'Rejected', state: 'not_registered' }),
  line('296', { pool: 'zextra' }),
]

const TUNING = { attemptsPerDay: 5, retryDays: 2, transferOrder: 'random', ringSec: 15, missedSec: 600, firstCallDelaySec: 60, whyUs: 'on' }

const report: AiReport = {
  at: at('10:00', '40'),
  appliedVersion: 5,
  applyError: null,
  enabled: true,
  pausedUntil: null,
  aiLines: LINES,
  tuning: { ...TUNING, maxAttempts: 10 },
  limits: { calls: 4, maxNew: 3, maxRetry: 1, saleHandoff: 'refer' },
  lines: { '178': 'free', '290': 'free', '291': 'not_registered', '292': 'not_registered', '296': 'free' },
  sellers: [{ ext: '120', name: 'Malika', state: 'free', inList: true, transfersToday: 0 }],
  live: { lines: [], recent: [] },
  today: { calls: 0, answered: 0, transferred: 0, transferFailed: 0, atsRejected: 0 },
}

const status = (over: Partial<AiReport> = {}): AiStatus => ({ receivedAt: at('10:00', '40'), stale: false, report: { ...report, ...over } })

const config = (over: Record<string, unknown> = {}) => ({
  version: 5,
  enabled: true,
  sellers: ['120', '122'],
  parked: [],
  maxCalls: 4,
  maxNew: 3,
  maxRetry: 1,
  saleHandoff: 'refer',
  hours: null as unknown,
  pauseUntil: null as unknown,
  linesOff: [] as string[],
  tuning: null as unknown,
  updatedAt: at('09:00'),
  updatedBy: 'adminjon',
  ...over,
})

function renderPanel(cfg: ReturnType<typeof config>, st: AiStatus | null, actions: unknown[] = []) {
  const posts: unknown[] = []
  const panel = { config: cfg, status: st, names: {}, rules: { aiLines: ['178', '290'], maxCalls: 8, maxSellers: 60, staleAfterSec: 90 }, history: [], switched: null, hoursSet: null, actions }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') posts.push(JSON.parse(String(init.body)))
      const body = init?.method === 'POST' ? { version: cfg.version + 1 } : url.includes('part=live') ? { status: st, staleAfterSec: 90 } : panel
      return new Response(JSON.stringify({ data: body, meta: { generatedAt: at('10:00', '41') } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AiControlPage />
    </QueryClientProvider>,
  )
  return { posts }
}

describe('«Vaqtincha toʻxtatish»', () => {
  it('sends the pause alone, Tashkent with the offset — a quick choice or «… gacha»', async () => {
    const { posts } = renderPanel(config(), status())
    const pause = await screen.findByRole('group', { name: 'Vaqtincha toʻxtatish' })
    expect(within(pause).getByRole('button', { name: 'Bugungacha' })).toBeTruthy()
    fireEvent.click(within(pause).getByRole('button', { name: '30 daq' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({ baseVersion: 5, pauseUntil: expect.stringMatching(/^2026-11-04T10:3\d:\d\d\+05:00$/) })

    fireEvent.change(within(pause).getByRole('combobox', { name: 'Pauza qaysi soatgacha' }), { target: { value: '21:30' } })
    fireEvent.click(within(pause).getByRole('button', { name: 'bugun 21:30 gacha' }))
    await waitFor(() => expect(posts).toHaveLength(2))
    expect(posts[1]).toEqual({ baseVersion: 5, pauseUntil: '2026-11-04T21:30:00+05:00' })
  })

  it('says till when and how long is left while one runs, and «Davom ettirish» ends it', async () => {
    const until = at('10:45')
    const { posts } = renderPanel(config({ pauseUntil: until }), status({ pausedUntil: until, flags: { paused: true } }))
    const pause = await screen.findByRole('group', { name: 'Vaqtincha toʻxtatish' })
    expect(within(pause).getByText(/^Pauza: 10:45 gacha · \d+ daq qoldi$/)).toBeTruthy()
    expect(within(pause).getByText('AI qoʻlladi ✓')).toBeTruthy()
    expect(screen.getByText('Dilnoza · Pauza (10:45 gacha)')).toBeTruthy()
    fireEvent.click(within(pause).getByRole('button', { name: 'Davom ettirish' }))
    await waitFor(() => expect(posts).toEqual([{ baseVersion: 5, pauseUntil: null }]))
  })

  it('is not offered while the AI is stopped — «Yoqish» comes first', async () => {
    renderPanel(config({ enabled: false }), status({ enabled: false }))
    await screen.findByRole('region', { name: 'AI ishlashi' })
    expect(screen.queryByRole('group', { name: 'Vaqtincha toʻxtatish' })).toBeNull()
  })
})

describe('Ish kunlari', () => {
  it('sends the days with the hours — and none at all for every day', async () => {
    const { posts } = renderPanel(config(), status())
    const card = await screen.findByRole('region', { name: 'Ish vaqti' })
    const days = within(card).getByRole('group', { name: 'Ish kunlari' })
    expect(within(days).getAllByRole('button').map((b) => b.textContent)).toEqual(['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'])
    fireEvent.click(within(days).getByRole('button', { name: 'shanba' }))
    fireEvent.click(within(days).getByRole('button', { name: 'yakshanba' }))
    expect(within(days).getByRole('button', { name: 'shanba' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(within(card).getByRole('button', { name: 'Ish vaqtini saqlash' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({ baseVersion: 5, hours: { start: '09:00', end: '22:00', lunchStart: '12:30', lunchEnd: '13:30', days: [1, 2, 3, 4, 5] } })
  })

  it('refuses no day at all before the button', async () => {
    renderPanel(config({ hours: { start: '09:00', end: '22:00', lunchStart: null, lunchEnd: null, days: [3] } }), status())
    const card = await screen.findByRole('region', { name: 'Ish vaqti' })
    fireEvent.click(within(card).getByRole('button', { name: 'chorshanba' }))
    expect(within(card).getByText(/Kamida bitta ish kuni boʻlsin/)).toBeTruthy()
    expect((within(card).getByRole('button', { name: 'Ish vaqtini saqlash' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('AI liniyalari (SIP)', () => {
  it('draws each line with its ATS state, switches it alone, and «Qayta ulash» only a line that is down', async () => {
    const { posts } = renderPanel(config(), status())
    const step = await screen.findByRole('region', { name: 'AI liniyalari (SIP)' })
    expect(within(step).queryByText(/Liniya qoʻshish yoki oʻchirish AI serverining sozlamasida/)).toBeNull()
    expect(within(step).getByText('Yangi liniya qoʻshish — hozircha AI serverida.')).toBeTruthy()
    expect(within(step).getAllByText('Registered ✓').length).toBe(3)
    expect(within(step).getAllByText('Rejected ✗').length).toBe(2)
    expect((within(step).getByRole('button', { name: '178 liniyasini qayta ulash' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(within(step).getByRole('button', { name: '291 liniyasini qayta ulash' }))
    await waitFor(() => expect(posts).toEqual([{ action: { kind: 'reregister', line: '291' } }]))
    fireEvent.click(within(step).getByRole('switch', { name: '290 liniyasi yoqiq' }))
    await waitFor(() => expect(posts[1]).toEqual({ baseVersion: 5, linesOff: ['290'] }))
  })

  it('refuses switching off the last main line before sending', async () => {
    const { posts } = renderPanel(config({ linesOff: ['290', '291', '292'] }), status())
    const step = await screen.findByRole('region', { name: 'AI liniyalari (SIP)' })
    fireEvent.click(within(step).getByRole('switch', { name: '178 liniyasi yoqiq' }))
    expect(within(step).getByText(/Kamida bitta asosiy \(Collagen\) AI liniyasi yoqiq boʻlsin/)).toBeTruthy()
    expect(posts).toHaveLength(0)
  })

  it('asks before «TLSʼni yangilash», offered only with every TLS line down', async () => {
    const { posts } = renderPanel(config(), status())
    const step = await screen.findByRole('region', { name: 'AI liniyalari (SIP)' })
    expect(within(step).getByText(/Hamma TLS liniyalar \(291, 292\) tushgan/)).toBeTruthy()
    fireEvent.click(within(step).getByRole('button', { name: 'TLSʼni yangilash' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'TLS ulanishini yangilash' })
    expect(posts).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ha, yangilash' }))
    await waitFor(() => expect(posts).toEqual([{ action: { kind: 'tls_reset' } }]))
  })

  it('greys «TLSʼni yangilash» while a TLS line is registered, and says the last answer', async () => {
    const lines = LINES.map((l) => (l.ext === '292' ? { ...l, registration: 'Registered', state: 'free' } : l))
    renderPanel(config(), status({ aiLines: lines }), [
      { id: 7, kind: 'reregister', line: '291', requestedAt: at('09:58'), requestedBy: 'umida', state: 'refused', text: 'ATS bloklamasin', answeredAt: at('09:58', '20') },
    ])
    const step = await screen.findByRole('region', { name: 'AI liniyalari (SIP)' })
    expect((within(step).getByRole('button', { name: 'TLSʼni yangilash' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(step).getByText(/TLS ulanishi ishlayapti \(292 Registered\)/)).toBeTruthy()
    expect(within(step).getByText('✗ Rad etildi · ATS bloklamasin · 09:58')).toBeTruthy()
    const history = screen.getByRole('region', { name: 'Oʻzgarishlar tarixi' })
    expect(within(history).getByText(/«Qayta ulash» 291 — ✗ Rad etildi/)).toBeTruthy()
  })

  it('says so when the agent does not send its lines yet', async () => {
    renderPanel(config(), status({ aiLines: undefined }))
    const step = await screen.findByRole('region', { name: 'AI liniyalari (SIP)' })
    expect(within(step).getByText(/liniyalar roʻyxatini hali yubormayapti/)).toBeTruthy()
  })
})

describe('«Qoʻshimcha sozlamalar»', () => {
  it('starts from what the agent runs, counts the total, warns on WHY_US, and saves all seven alone', async () => {
    const { posts } = renderPanel(config(), status())
    const step = await screen.findByRole('region', { name: 'Qoʻshimcha sozlamalar' })
    expect(within(step).getByText('jami 10 marta')).toBeTruthy()
    expect(within(step).getByText(/«Oʻrta Osiyoda eng yuqori» va «dietologlar tavsiya qiladi» mahsulot faktlarida tasdiqlanmagan/)).toBeTruthy()
    fireEvent.click(within(step).getByRole('button', { name: 'Nedozvonga kuniga — oshirish' }))
    expect(within(step).getByText('jami 12 marta')).toBeTruthy()
    fireEvent.change(within(step).getByRole('combobox', { name: 'Ikki sabab (WHY_US)' }), { target: { value: 'test' } })
    fireEvent.click(within(step).getByRole('button', { name: 'Qoʻshimcha sozlamalarni saqlash' }))
    await waitFor(() => expect(posts).toEqual([{ baseVersion: 5, tuning: { ...TUNING, attemptsPerDay: 6, whyUs: 'test' } }]))
  })

  it('shows the saved values against the agent\'s', async () => {
    renderPanel(config({ tuning: { ...TUNING, ringSec: 20 } }), status())
    const step = await screen.findByRole('region', { name: 'Qoʻshimcha sozlamalar' })
    expect(within(step).getByText('qoʻllanmoqda…')).toBeTruthy()
    expect(within(step).getByText(/AIda hozir: 15 s/)).toBeTruthy()
  })
})
