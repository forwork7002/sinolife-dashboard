// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { SellerBoardDto } from '@/lib/api'

/**
 * The sellers page's own chrome (EFIR Premium spec §7, delta 18b–18c, 20d–20e):
 * the «Bugun» title line naming its weekday, the page foot's three
 * definitions, and the shared header styled from a page-scoped selector
 * without PageShell or PeriodFilter being edited.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/sellers',
  useSearchParams: () => new URLSearchParams(''),
}))

let preset = 'today'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    apiGet: vi.fn(async (path: string, params: Record<string, unknown>) => {
      if (path !== '/analytics/sellers' || params.include) return { data: { months: [], sellers: [], today: null }, meta: META() }
      return { data: EMPTY_BOARD, meta: META() }
    }),
  }
})

const META = () => ({
  dataSource: 'DEMO' as const,
  generatedAt: '2026-09-17T05:00:00.000Z',
  period: {
    preset,
    start: preset === 'today' ? '2026-09-16T19:00:00.000Z' : '2026-08-31T19:00:00.000Z',
    end: '2026-09-17T19:00:00.000Z',
    timeZone: 'Asia/Tashkent',
    days: 1,
  },
})

const money = (amount: number) => ({ amountMinor: String(amount * 100), currency: 'UZS', amount })
const EMPTY_BOARD = {
  rows: [],
  teams: [],
  totals: { orders: 0, wonOrders: 0, won: money(0), ordered: money(0), teamlessSellers: 0 },
} as unknown as SellerBoardDto

beforeAll(() => {
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
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterEach(cleanup)

const { SellersPage } = await import('@/features/sellers/SellersPage')

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SellersPage />
    </QueryClientProvider>,
  )
}

describe('the «Bugun» title line', () => {
  it('names the day — 2026-09-17 → «payshanba» — and prints no range after it', async () => {
    preset = 'today'
    renderPage()
    const line = await screen.findByText('17-sentabr 2026, payshanba · bugun')
    expect(line.textContent).toBe('17-sentabr 2026, payshanba · bugun')
    expect(line.textContent).not.toContain('–')
  })

  it('leaves every other window to the shell’s own range', async () => {
    preset = 'this_month'
    renderPage()
    const title = screen.getByRole('heading', { level: 1 })
    await vi.waitFor(() => expect(title.nextElementSibling?.textContent).toContain('–'))
    expect(title.nextElementSibling!.textContent).not.toMatch(/payshanba|bugun/)
  })
})

describe('the page foot', () => {
  it('carries three definitions and the credit — never «hozircha»', () => {
    preset = 'today'
    const { container } = renderPage()
    const foot = container.querySelector('.tv-board-shell > footer.tv-foot')!
    expect([...foot.querySelectorAll('.tv-foot__defs > span')].map((s) => s.textContent)).toEqual([
      'Konv. = yetkazilgan ÷ (yetkazilgan + barcha bekor)',
      'Buyurt. = FAKT 1 buyurtmalari',
      'Daraja — avgustdan beri yetkazilgan pul boʻyicha',
    ])
    expect(foot.querySelector('.tv-credit')!.textContent).toBe('Developed by Yusuf')
    expect(container.textContent).not.toContain('hozircha')
  })
})

describe('the shared chrome, styled from the page', () => {
  const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
  const start = CSS.indexOf('* THE SHARED CHROME, ON THIS PAGE ONLY')
  const block = CSS.slice(start, CSS.indexOf('/* ====', start))
  const rules = block.replace(/^[\s\S]*?\*\//, '').replace(/\/\*[\s\S]*?\*\//g, '')

  it('hides the accent dash and restyles the period control only under the sellers board', () => {
    expect(start).toBeGreaterThan(-1)
    expect(rules).toContain('.page-container:has(.tv-board-shell) .accent-rule {\n  display: none;')
    const selectors = rules.match(/^[^@{}\n][^{}\n]*\{/gm)!.map((s) => s.trim())
    expect(selectors.length).toBeGreaterThan(3)
    for (const sel of selectors) expect(sel.startsWith('.page-container:has(.tv-board-shell) ')).toBe(true)
    expect(rules).toContain('var(--tier-4)')
  })

  it('reaches the control by the label PeriodFilter actually renders', async () => {
    const { t } = await import('@/lib/messages')
    expect(rules).toContain(`[aria-label="${t.period.label}"]`)
    preset = 'today'
    const { container } = renderPage()
    expect(container.querySelector(`.page-container:has(.tv-board-shell) header [role="group"][aria-label="${t.period.label}"]`)).not.toBeNull()
    expect(container.querySelector('.page-container:has(.tv-board-shell) .accent-rule')).not.toBeNull()
  })

  it('no literal colour and no color-mix()', () => {
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/)
    expect(rules).not.toContain('color-mix(')
  })
})
