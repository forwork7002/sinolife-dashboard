// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type AiReport, type AiStatus, hoursInForce, hoursState, switchState } from '@/features/aiRegistrator/aiLiveLogic'
import { AiControlPage } from '@/features/aiRegistrator/AiControlPage'

/**
 * «Ish vaqti» on Boshqaruv (2026-11-04, the owner: «hohlagan vaqtim ish
 * vaqtini oʻzgartiray … hohlagan vaqtim hohlaganimni oʻzgartira olishim
 * kerak»): the form, its own save of the hours alone, the agent's rules before
 * the button, and the saved hours against the ones the agent runs. Fake names only.
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

const DAY = { start: '09:00', end: '22:00', lunchStart: '12:30', lunchEnd: '13:30' }
const LATE = { start: '08:00', end: '23:00', lunchStart: null, lunchEnd: null }

const report: AiReport = {
  at: at('10:00', '40'),
  appliedVersion: 5,
  applyError: null,
  enabled: true,
  limits: { calls: 4, maxNew: 3, maxRetry: 1, saleHandoff: 'refer' },
  lines: { '178': 'free', '290': 'free' },
  sellers: [{ ext: '120', name: 'Malika', state: 'free', inList: true, transfersToday: 0 }],
  live: { lines: [], recent: [] },
  today: { calls: 0, answered: 0, transferred: 0, transferFailed: 0, atsRejected: 0 },
}

const status = (over: Partial<AiReport> = {}, receivedAt = at('10:00', '40')): AiStatus => ({ receivedAt, stale: false, report: { ...report, ...over } })

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
  updatedAt: at('09:00'),
  updatedBy: 'adminjon',
  ...over,
})

function renderPanel(cfg: ReturnType<typeof config>, st: AiStatus | null, hoursSet: unknown = null) {
  const posts: unknown[] = []
  const panel = { config: cfg, status: st, names: {}, rules: { aiLines: ['178', '290'], maxCalls: 8, maxSellers: 60, staleAfterSec: 90 }, history: [], switched: null, hoursSet }
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
  return { posts, card: () => screen.findByRole('region', { name: 'Ish vaqti' }) }
}

const pick = (region: HTMLElement, name: string, value: string) => fireEvent.change(within(region).getByRole('combobox', { name }), { target: { value } })
const shown = (region: HTMLElement, name: string) => (within(region).getByRole('combobox', { name }) as HTMLSelectElement).value

describe('AiControlPage — «Ish vaqti»', () => {
  it('starts from 09:00–22:00, lunch 12:30–13:30, and saves the hours alone — «Tushliksiz» sends no lunch', async () => {
    const { posts, card } = renderPanel(config(), status({ hours: { ...DAY, sellersStart: '09:00', sellersEnd: '22:00' } }))
    const region = await card()
    expect(shown(region, 'Ish boshlanishi — soat')).toBe('09')
    expect(shown(region, 'Ish tugashi — soat')).toBe('22')
    expect(shown(region, 'Tushlik boshlanishi — daqiqa')).toBe('30')
    expect(shown(region, 'Tushlik tugashi — soat')).toBe('13')
    expect(within(region).getByText('AI serverining oʻz vaqti')).toBeTruthy()
    expect(within(region).getByText(/AIda hozir: 09:00–22:00, tushlik 12:30–13:30/)).toBeTruthy()
    // The one line on what happens with the hours.
    expect(within(region).getByText(/20 soniya ichida qoʻllaydi/).textContent).toContain('boshlanishida AIni yoqadi, tugashida (suhbatlar tugagach) oʻchiradi')

    pick(region, 'Ish boshlanishi — soat', '08')
    pick(region, 'Ish tugashi — soat', '23')
    fireEvent.click(within(region).getByRole('checkbox', { name: 'Tushliksiz' }))
    expect((within(region).getByRole('combobox', { name: 'Tushlik boshlanishi — soat' }) as HTMLSelectElement).disabled).toBe(true)
    expect(within(region).getByText('Ish vaqti saqlanmagan')).toBeTruthy()
    fireEvent.click(within(region).getByRole('button', { name: 'Ish vaqtini saqlash' }))
    await waitFor(() => expect(posts).toEqual([{ baseVersion: 5, hours: LATE }]))
  })

  it('names what breaks the agent\'s rules and offers no save', async () => {
    const { posts, card } = renderPanel(config({ hours: DAY }), status({ appliedVersion: 5, hours: DAY }))
    const region = await card()
    pick(region, 'Ish tugashi — soat', '08')
    expect(within(region).getByRole('alert').textContent).toContain('Ish tugashi boshlanishidan keyin boʻlsin')
    expect((within(region).getByRole('button', { name: 'Ish vaqtini saqlash' }) as HTMLButtonElement).disabled).toBe(true)

    pick(region, 'Ish tugashi — soat', '22')
    pick(region, 'Tushlik boshlanishi — soat', '07')
    expect(within(region).getByRole('alert').textContent).toBe('Tushlik ish vaqti ichida boʻlsin (09:00–22:00).')
    fireEvent.click(within(region).getByRole('button', { name: 'Ish vaqtini saqlash' }))
    expect(posts).toEqual([])

    // «Bekor qilish» puts the saved hours back.
    fireEvent.click(within(region).getByRole('button', { name: 'Bekor qilish' }))
    expect(shown(region, 'Tushlik boshlanishi — soat')).toBe('12')
    expect(within(region).queryByRole('alert')).toBeNull()
  })

  it('says the agent took the saved hours, and who set them', async () => {
    const { card } = renderPanel(config({ hours: LATE }), status({ appliedVersion: 5, hours: LATE }), { version: 5, savedAt: at('09:30'), savedBy: 'umida' })
    const region = await card()
    expect(within(region).getByText('AI qoʻlladi ✓')).toBeTruthy()
    expect(within(region).getByText('AIda hozir: 08:00–23:00, tushliksiz.')).toBeTruthy()
    expect(within(region).getByText(/^Oʻzgartirdi: umida · /)).toBeTruthy()
    expect((within(region).getByRole('checkbox', { name: 'Tushliksiz' }) as HTMLInputElement).checked).toBe(true)
    expect((within(region).getByRole('button', { name: 'Ish vaqtini saqlash' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('asks the stop question with the day\'s own start', async () => {
    renderPanel(config({ hours: LATE }), status({ appliedVersion: 5, hours: LATE }))
    const region = await screen.findByRole('region', { name: 'AI ishlashi' })
    fireEvent.click(within(region).getByRole('button', { name: 'Toʻxtatish' }))
    expect(within(screen.getByRole('alertdialog')).getByText(/08:00 da ham oʻzi yonmaydi/)).toBeTruthy()
  })
})

describe('hoursState — saved against applied', () => {
  const now = new Date(at('10:00', '50'))
  const saved = (hours: typeof DAY | typeof LATE | null, version = 6) => ({ hours, version })

  it('nothing saved: the agent\'s own hours run', () => {
    expect(hoursState(saved(null), status({ hours: DAY }), now, 90)).toMatchObject({ kind: 'server', tone: 'neutral' })
    expect(hoursState(saved(null), null, now, 90).detail).toBe('Bu yerda saqlansa, AI shu vaqtga oʻtadi.')
  })

  it('applied, applying, refused — never the saved shown as applied', () => {
    expect(hoursState(saved(LATE), status({ appliedVersion: 6, hours: LATE }), now, 90)).toMatchObject({ kind: 'applied', tone: 'good' })
    expect(hoursState(saved(LATE), status({ appliedVersion: 5, hours: DAY }), now, 90)).toMatchObject({
      kind: 'applying',
      title: 'qoʻllanmoqda…',
      detail: 'Saqlangan: 08:00–23:00, tushliksiz, AIda hozir: 09:00–22:00, tushlik 12:30–13:30. AI 20 soniya ichida oʻqiydi.',
    })
    // Version taken but other hours — still not what was saved.
    expect(hoursState(saved(LATE), status({ appliedVersion: 6, hours: DAY }), now, 90).kind).toBe('applying')
    const refused = hoursState(saved(LATE), status({ appliedVersion: 5, applyError: 'ish tugash vaqti boshlanishidan keyin bo\'lsin', hours: DAY }), now, 90)
    expect(refused).toMatchObject({ kind: 'refused', tone: 'critical', title: 'AI rad etdi v6' })
    expect(refused.detail).toContain('ish tugash vaqti')
  })

  it('an agent that sends no hours, and a silent one', () => {
    expect(hoursState(saved(LATE), status({ appliedVersion: 6 }), now, 90)).toMatchObject({ kind: 'old', tone: 'warning', title: 'AI bu sozlamani hali qoʻllamaydi' })
    expect(hoursState(saved(LATE), status({ hours: LATE }, at('09:00')), now, 90)).toMatchObject({ kind: 'silent', tone: 'neutral' })
  })

  it('the stop card names the day\'s start from the same source', () => {
    expect(hoursInForce(null, null)).toEqual(DAY)
    expect(hoursInForce(status({ hours: LATE }).report, DAY).start).toBe('08:00')
    const off = switchState({ enabled: false, version: 6, hours: LATE }, status({ appliedVersion: 6, enabled: false }), now, 90)
    expect(off.detail).toBe('Yangi lidlarga qoʻngʻiroq qilmaydi. 08:00 da ham oʻzi yonmaydi — faqat «Yoqish» bilan.')
  })
})
