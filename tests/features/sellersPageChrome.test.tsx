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

  /*
    EVERY OTHER WINDOW IN WORDS TOO (premium review, 2026-09-17): the shell's range
    is `Intl` 'uz' short months, and the television's Chromium printed «1-sen 2026 –
    17-sen 2026» where the mock prints «1–17 sentabr 2026». The shell's own range
    must not follow it — meta travels without its period on every window.
  */
  it('names «Shu oy» as «1–17 sentabr 2026», and the shell prints no second range', async () => {
    preset = 'this_month'
    renderPage()
    const title = screen.getByRole('heading', { level: 1 })
    await vi.waitFor(() => expect(title.nextElementSibling?.textContent).toBe('1–17 sentabr 2026'))
    expect(title.nextElementSibling!.textContent).not.toMatch(/payshanba|bugun|sen /)
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
    // Every rule is scoped to the page that holds the board; the page glow is the ONE rule on `main`.
    const onMain = selectors.filter((sel) => sel.startsWith('main:has(.tv-board-shell) '))
    expect(onMain).toEqual(['main:has(.tv-board-shell) {'])
    for (const sel of selectors) {
      if (onMain.includes(sel)) continue
      expect(sel.startsWith('.page-container:has(.tv-board-shell) ')).toBe(true)
    }
    expect(rules).toContain('var(--tier-4)')
  })

  /*
    THE PINK AURORA IS NOT DRAWN HERE (premium review, 2026-09-17). PageShell mixes
    its first blob from `--accent` — pink on this page — over a 70 px blur, and it
    smudged the title and the record wall. The mock's one cool light replaces it,
    from above `main`, reading the page's own `--efir-page-glow`.
  */
  it('replaces the shell aurora with the mock’s one cool glow, on `main`', () => {
    expect(rules).toContain('.page-container:has(.tv-board-shell) .page-atmosphere {\n  display: none;')
    expect(rules).toContain(
      'main:has(.tv-board-shell) {\n  background: radial-gradient(1100px 420px at 46% -120px, var(--efir-page-glow), transparent 70%);',
    )
  })

  it('puts the header — record wall and period control — inside the `--efir-*` token root', async () => {
    const { t } = await import('@/lib/messages')
    preset = 'this_month'
    const { container } = renderPage()
    const root = container.querySelector('main:has(.tv-board-shell)')
    expect(root).not.toBeNull()
    expect(root!.querySelector(`header [role="group"][aria-label="${t.period.label}"]`)).not.toBeNull()
    const tokens = CSS.match(/:is\(\.tv-board-shell, main:has\(\.tv-board-shell\)\) \{/g) ?? []
    expect(tokens).toHaveLength(3)
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
