// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { InboundCallsSection } from '@/features/calls/InboundCallsSection'

/** «Соф янги» pressed: the tile's numbers, laid out as the client's own sheet. */

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

// jsdom has no `matchMedia`; «reduced» makes `AnimatedNumber` print each figure once.
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

afterEach(cleanup)

const groups = { fresh: 2, notReached: 0, talkedNoBuy: 0, buyer: 1, noDeal: 0 }
const asked: Record<string, unknown>[] = []

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiGet: async (path: string, params: Record<string, unknown>) => {
    if (path === '/insights/calls/inbound') {
      return {
        data: {
          days: [
            { day: '2026-10-16', calls: 4, numbers: 3, talked: 1, talkedPercent: 33.3, outbound: 2, groups, unfinished: true },
          ],
          total: {
            calls: 4,
            numbers: 3,
            talked: 1,
            talkedPercent: 33.3,
            outbound: 2,
            groups,
            unreached: { fresh: 1, notReached: 0, talkedNoBuy: 0, buyer: 1, noDeal: 0 },
          },
          lastCallAt: '2026-10-16T05:00:00.000Z',
          undatedContacts: 0,
          floorApplied: false,
        },
        meta: {},
      }
    }
    if (path === '/insights/calls/inbound/callers') {
      asked.push(params)
      // Another group never answers: what the card shows while it loads.
      if (params.group !== 'fresh') return new Promise(() => {})
      return {
        data: {
          group: params.group,
          rows: [
            {
              key: '978277500',
              phone: '+998978277500',
              tel: '+998978277500',
              contact: { name: 'Malika', bitrixId: '501' },
              calls: 2,
              talked: false,
              talkSec: 0,
              firstCallAt: '2026-10-16T01:30:00.000Z',
              lastCallAt: '2026-10-16T01:40:00.000Z',
              callback: { at: '2026-10-16T02:00:00.000Z', talked: false, operator: 'Bekzod', attempts: 1 },
            },
            {
              key: '882008371',
              phone: '+998882008371',
              tel: '+998882008371',
              contact: null,
              calls: 1,
              talked: true,
              talkSec: 105,
              firstCallAt: '2026-10-16T02:11:00.000Z',
              lastCallAt: '2026-10-16T02:11:00.000Z',
              callback: null,
            },
          ],
        },
        meta: { period: { days: 0 } },
      }
    }
    return { data: { rows: [], waiting: 0, calledBack: 0, reached: 0 }, meta: {} }
  },
}))

function open() {
  // The app's own default: a query keeps its previous answer while a new key loads.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, placeholderData: (previous: unknown) => previous } } })
  render(
    <QueryClientProvider client={client}>
      <InboundCallsSection windowParams={{ preset: 'today' }} />
    </QueryClientProvider>,
  )
}

describe('a pressed group tile', () => {
  it('opens «Соф янги» as its numbers, oldest first, with the sheet columns', async () => {
    open()
    const tile = (await screen.findByText('Соф янги', { selector: '[data-testid="inbound-groups"] p' })).closest('button')!
    expect(tile.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('inbound-group-callers')).toBeNull()

    fireEvent.click(tile)
    expect(tile.getAttribute('aria-expanded')).toBe('true')
    const card = screen.getByTestId('inbound-group-callers')
    const phone = await within(card).findByRole('link', { name: '+998978277500' })
    expect(phone.getAttribute('href')).toBe('tel:+998978277500')
    expect(asked.at(-1)).toMatchObject({ preset: 'today', group: 'fresh' })

    for (const header of ['№', 'Vaqt', 'Telefon', 'Qoʻngʻiroq soni', 'Kiruvchida ulangan', 'Suhbat (soniya)', 'Qayta qoʻngʻiroq']) {
      expect(within(card).getByRole('columnheader', { name: header })).toBeTruthy()
    }
    // One day: the hour alone, in Tashkent — as the client's sheet prints it.
    expect(within(card).getByText('06:30')).toBeTruthy()
    expect(within(card).getByText('105')).toBeTruthy()
    expect(within(card).getByText(/Соф янги — raqamlar roʻyxati · 2 ta/)).toBeTruthy()
  })

  it('narrows to the unconnected numbers and closes from the tile or the card', async () => {
    open()
    const tile = (await screen.findByText('Соф янги', { selector: '[data-testid="inbound-groups"] p' })).closest('button')!
    fireEvent.click(tile)
    const card = screen.getByTestId('inbound-group-callers')
    await within(card).findByText('+998882008371')
    fireEvent.click(within(card).getByText('Ulanmagan · 1'))
    expect(within(card).queryByText('+998882008371')).toBeNull()
    expect(within(card).getByText('+998978277500')).toBeTruthy()

    fireEvent.click(within(card).getByRole('button', { name: 'Roʻyxatni yopish' }))
    expect(screen.queryByTestId('inbound-group-callers')).toBeNull()
    expect(document.activeElement).toBe(tile)
    fireEvent.click(tile)
    expect(screen.getByTestId('inbound-group-callers')).toBeTruthy()
    fireEvent.click(tile)
    expect(screen.queryByTestId('inbound-group-callers')).toBeNull()
  })

  it('never shows one group numbers under another while the other loads', async () => {
    open()
    const tileOf = async (label: string) =>
      (await screen.findByText(label, { selector: '[data-testid="inbound-groups"] p' })).closest('button')!
    fireEvent.click(await tileOf('Соф янги'))
    await within(screen.getByTestId('inbound-group-callers')).findByText('+998978277500')

    fireEvent.click(await tileOf('Эски харидор'))
    const card = screen.getByTestId('inbound-group-callers')
    expect(within(card).getByText(/Эски харидор — raqamlar roʻyxati/)).toBeTruthy()
    expect(within(card).queryByText('+998978277500')).toBeNull()
    expect((await tileOf('Эски харидор')).getAttribute('aria-controls')).toBe('inbound-group-callers')
  })
})
