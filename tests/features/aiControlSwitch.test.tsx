// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type AiReport, type AiStatus, agentEnabled, switchState } from '@/features/aiRegistrator/aiLiveLogic'
import { AiControlPage } from '@/features/aiRegistrator/AiControlPage'

/**
 * «Toʻxtatish» / «Yoqish» on Boshqaruv (2026-11-04, the owner: «ai boshqaruvda
 * ai registratorni oʻchirib toʻxtatish funksiyasi ham boʻlsin»): the button, the
 * page's own question before a stop, and the saved state against the one the
 * agent applied — never one shown as the other. Fake names only.
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

const report: AiReport = {
  at: at('10:00', '40'),
  appliedVersion: 5,
  applyError: null,
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
  updatedAt: at('09:00'),
  updatedBy: 'adminjon',
  ...over,
})

const STOP_QUESTION =
  'AI registrator yangi lidlarga qoʻngʻiroq qilmaydi, hozirgi suhbatlar oxirigacha tugaydi. 09:00 da ham oʻzi yonmaydi — faqat «Yoqish» bilan. Toʻxtatilsinmi?'

function renderPanel(cfg: ReturnType<typeof config> | null, st: AiStatus | null, switched: unknown = null) {
  const posts: unknown[] = []
  const panel = { config: cfg, status: st, names: {}, rules: { aiLines: ['178', '290'], maxCalls: 8, maxSellers: 60, staleAfterSec: 90 }, history: [], switched }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') posts.push(JSON.parse(String(init.body)))
      const body = init?.method === 'POST' ? { version: (cfg?.version ?? 0) + 1 } : url.includes('part=live') ? { status: st, staleAfterSec: 90 } : panel
      return new Response(JSON.stringify({ data: body, meta: { generatedAt: at('10:00', '41') } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AiControlPage />
    </QueryClientProvider>,
  )
  return { posts, card: () => screen.findByRole('region', { name: 'AI ishlashi' }) }
}

describe('AiControlPage — Toʻxtatish / Yoqish', () => {
  it('«Ishlayapti»: «Toʻxtatish» asks in the page\'s own dialog, and only «Ha, toʻxtatish» sends the stop alone', async () => {
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    const { posts, card } = renderPanel(config(), status({ enabled: true, flags: { stopped: false } }))
    const region = await card()
    expect(within(region).getByText('Ishlayapti')).toBeTruthy()
    expect(within(region).getByText('Sozlama v5: adminjon', { exact: false })).toBeTruthy()

    fireEvent.click(within(region).getByRole('button', { name: 'Toʻxtatish' }))
    const dialog = screen.getByRole('alertdialog', { name: 'AI registratorni toʻxtatish' })
    expect(within(dialog).getByText(STOP_QUESTION)).toBeTruthy()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Bekor qilish' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bekor qilish' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()

    fireEvent.click(within(region).getByRole('button', { name: 'Toʻxtatish' }))
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(posts).toEqual([])

    fireEvent.click(within(region).getByRole('button', { name: 'Toʻxtatish' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Ha, toʻxtatish' }))
    await waitFor(() => expect(posts).toEqual([{ baseVersion: 5, enabled: false }]))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(confirm).not.toHaveBeenCalled()
  })

  it('«Toʻxtatilgan»: red, who stopped it and when, and «Yoqish» starts it with no question', async () => {
    const { posts, card } = renderPanel(
      config({ version: 6, enabled: false }),
      status({ appliedVersion: 6, enabled: false, flags: { stopped: true } }),
      { version: 6, savedAt: at('09:30'), savedBy: 'umida' },
    )
    const region = await card()
    expect(within(region).getByText('Toʻxtatilgan')).toBeTruthy()
    expect(within(region).getByText(/^Toʻxtatdi: umida · /)).toBeTruthy()
    expect(within(region).getByText(/09:00 da ham oʻzi yonmaydi/)).toBeTruthy()
    // The page's first line says so too — not «Dilnoza ishlayapti».
    expect(screen.getByText('Dilnoza toʻxtatilgan')).toBeTruthy()
    expect(screen.queryByText('Dilnoza ishlayapti')).toBeNull()

    fireEvent.click(within(region).getByRole('button', { name: 'Yoqish' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(posts).toEqual([{ baseVersion: 6, enabled: true }]))
  })

  it('«qoʻllanmoqda…» while the agent has not taken the saved stop yet', async () => {
    const { card } = renderPanel(config({ version: 6, enabled: false }), status({ appliedVersion: 5, enabled: true }))
    const region = await card()
    expect(within(region).getByText('qoʻllanmoqda…')).toBeTruthy()
    expect(within(region).getByText(/Saqlangan: toʻxtatilgan, AIda hozir: ishlayapti/)).toBeTruthy()
    expect(within(region).queryByText('Toʻxtatilgan')).toBeNull()
  })

  it('an agent older than the button: says so, and never shows the saved stop as applied', async () => {
    const { card } = renderPanel(config({ version: 6, enabled: false }), status({ appliedVersion: 6 }))
    const region = await card()
    expect(within(region).getByText('AI bu tugmani hali qoʻllamaydi')).toBeTruthy()
    expect(within(region).getByText(/qoʻngʻiroq qilishda davom etadi/)).toBeTruthy()
    expect(within(region).queryByText('Toʻxtatilgan')).toBeNull()
    cleanup()

    const running = renderPanel(config(), status())
    fireEvent.click(within(await running.card()).getByRole('button', { name: 'Toʻxtatish' }))
    expect(within(screen.getByRole('alertdialog')).getByText(/AI serveri bu tugmani hali qoʻllamaydi/)).toBeTruthy()
  })

  it('a silent agent: the page\'s «AI javob bermayapti» rule, the saved state named as saved only', async () => {
    const { card } = renderPanel(config(), status({ enabled: true }, at('09:50')))
    const region = await card()
    expect(within(region).getByText('AI javob bermayapti — oxirgi xabar 09:50')).toBeTruthy()
    expect(within(region).getByText('Saqlangan: ishlayapti — AI qoʻllaganini bilib boʻlmaydi.')).toBeTruthy()
    expect(within(region).queryByText('Ishlayapti')).toBeNull()
  })

  it('nothing saved yet: the button is off and says to save first', async () => {
    const { card } = renderPanel(null, null)
    const region = await card()
    expect(within(region).getByRole('button', { name: 'Toʻxtatish' }).hasAttribute('disabled')).toBe(true)
    expect(within(region).getByText(/^Avval sozlamani saqlang/)).toBeTruthy()
  })
})

describe('switchState / agentEnabled', () => {
  const now = new Date(at('10:00', '41'))
  it('reads the stop from enabled or flags.stopped, and an agent that sends neither as unknown', () => {
    expect(agentEnabled({ ...report, enabled: true })).toBe(true)
    expect(agentEnabled({ ...report, enabled: false })).toBe(false)
    expect(agentEnabled({ ...report, enabled: true, flags: { stopped: true } })).toBe(false)
    expect(agentEnabled({ ...report, flags: { stopped: true } })).toBe(false)
    expect(agentEnabled(report)).toBeNull()
  })

  it('is red with the agent\'s reason when it refused the saved version', () => {
    const s = switchState({ enabled: false, version: 6 }, status({ appliedVersion: 5, enabled: true, applyError: 'sellers boʻsh' }), now, 90)
    expect(s).toMatchObject({ kind: 'refused', tone: 'critical', title: 'AI rad etdi v6' })
    expect(s.detail).toContain('sellers boʻsh')
  })

  it('is grey, not red, out of hours with no fresh report', () => {
    const night = new Date(at('22:30'))
    expect(switchState({ enabled: true, version: 5 }, status({ enabled: true }), night, 90)).toMatchObject({ kind: 'silent', tone: 'neutral' })
  })
})
