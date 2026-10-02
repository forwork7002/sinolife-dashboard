// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { FunnelTiles } from '@/features/leads/LeadSourcesSection'
import type { LeadSourcesOverviewDto } from '@/features/leads/leadSourcesApi'

/*
  The seven headline tiles on «Lid manbalari» — the client's list of
  2026-10-01, in its order and with its labels.

  Reduced motion, so `AnimatedNumber` prints the final figure (the stub
  leadChannelTiles.test.tsx uses).
*/
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

const data = {
  importedAt: null,
  funnel: {
    total: 1000,
    fresh: 940,
    duplicates: 60,
    qualified: 300,
    qualifiedPercent: (300 / 940) * 100,
    spendUsd: 1200,
    costPerQualifiedUsd: 4,
  },
  tiles: { rows: [], total: { leads: 3224 } },
} as unknown as LeadSourcesOverviewDto

const tile = (label: string) => screen.getByText(label, { selector: 'p' }).closest('.card') as HTMLElement

describe('FunnelTiles', () => {
  it('prints the six figures in the client’s order, «Бошка лидлар» gone (2026-10-02)', () => {
    render(<FunnelTiles data={data} status="ready" />)

    const labels = ['Жами лидлар', 'Янги лидлар', 'Дубль лидлар', 'Квал лидлар сони', 'Квал %', 'Квал лид нархи $']
    const cards = [...document.querySelectorAll('.card')].map((c) => c.querySelector('p')!.textContent)
    expect(cards).toEqual(labels)

    expect(within(tile('Жами лидлар')).getByText('1,000')).toBeTruthy()
    expect(within(tile('Янги лидлар')).getByText('940')).toBeTruthy()
    expect(within(tile('Янги лидлар')).getByText('dublsiz · 94.0%')).toBeTruthy()
    expect(within(tile('Дубль лидлар')).getByText('60')).toBeTruthy()
    expect(within(tile('Квал лидлар сони')).getByText('300')).toBeTruthy()
    expect(within(tile('Квал %')).getByText('31.9%')).toBeTruthy()
    expect(within(tile('Квал лид нархи $')).getByText('4.00')).toBeTruthy()
    expect(within(tile('Квал лид нархи $')).getByText('Meta byudjeti 1 200 $ ÷ квал')).toBeTruthy()
  })

  it('draws a dash, never a zero, for a rate or a price it cannot compute', () => {
    const quiet = {
      importedAt: null,
      funnel: { total: 0, fresh: 0, duplicates: 0, qualified: 0, qualifiedPercent: null, spendUsd: 0, costPerQualifiedUsd: null },
      tiles: { rows: [], total: { leads: 0 } },
    } as unknown as LeadSourcesOverviewDto
    render(<FunnelTiles data={quiet} status="ready" />)

    expect(within(tile('Квал %')).getByText('—')).toBeTruthy()
    expect(within(tile('Квал лид нархи $')).getByText('—')).toBeTruthy()
  })

  it('washes Янги green and Дубль red, and only those two', () => {
    render(<FunnelTiles data={data} status="ready" />)

    expect(tile('Янги лидлар').style.background).toContain('--status-good')
    expect(tile('Дубль лидлар').style.background).toContain('--status-critical')
    expect(tile('Жами лидлар').style.background).toBe('')
  })
})
