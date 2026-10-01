// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ChannelTiles } from '@/features/leads/LeadSourcesSection'
import type { ChannelTileDto, LeadSourcesOverviewDto, LeadTile } from '@/features/leads/leadSourcesApi'

/*
  «Boshqa kanallar lidlari» — the client's list of 2026-10-01: Ген лид,
  Входящий, Телеграм, Сммщик ии, Веб сайт, Сарафан, then Исход and Boshqa
  (asked back the same day) and their «Jami» — «Жами лидлар» whole.

  Reduced motion, so `AnimatedNumber` prints the final figure rather than the
  frame the assertion happened to catch (the stub faktQueueBand.test.tsx uses).
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

const cells = (leads: number, qualified: number, duplicates = 0): ChannelTileDto => ({
  leads,
  fresh: leads - duplicates,
  qualified,
  qualifiedPercent: leads - duplicates > 0 ? (qualified / (leads - duplicates)) * 100 : null,
})

// 24–30.09.2026 off the portal, rounded.
const TILES: Record<LeadTile, ChannelTileDto> = {
  generated: cells(2278, 700),
  inbound: cells(473, 100),
  telegram: cells(27, 13),
  aiSmm: cells(445, 150),
  web: cells(1, 1),
  sarafan: cells(0, 0),
  outbound: cells(2410, 40),
  other: cells(100, 10),
}

const data = {
  tiles: {
    rows: (Object.keys(TILES) as LeadTile[]).map((tile) => ({ tile, ...TILES[tile] })),
    total: cells(5734, 1014, 60),
  },
} as unknown as LeadSourcesOverviewDto

/** The tile whose label reads exactly `label`. */
const tile = (label: string) => screen.getByText(label, { selector: 'p' }).closest('.card') as HTMLElement

describe('ChannelTiles', () => {
  it('prints the client\'s channels with their kval and rate', () => {
    render(<ChannelTiles data={data} status="ready" />)

    expect(screen.getByRole('heading', { name: 'Boshqa kanallar lidlari' })).toBeTruthy()
    expect(within(tile('Ген лид')).getByText('2,278')).toBeTruthy()
    expect(within(tile('Ген лид')).getByText('lid-forma + qoʻlda kiritilgan')).toBeTruthy()
    expect(within(tile('Входящий')).getByText('473')).toBeTruthy()
    expect(within(tile('Телеграм')).getByText('27')).toBeTruthy()
    expect(within(tile('Телеграм')).getByText('13 kval · 48.1%')).toBeTruthy()
    expect(within(tile('Сммщик ии')).getByText('445')).toBeTruthy()
    expect(within(tile('Сммщик ии')).getByText('«ИИ квал сана» toʻldirilgan · 14.09.2026 dan')).toBeTruthy()
    expect(within(tile('Веб сайт')).getByText('1')).toBeTruthy()
    expect(within(tile('Исход')).getByText('2,410')).toBeTruthy()
    expect(within(tile('Boshqa')).getByText('100')).toBeTruthy()
  })

  it('shows a quiet channel at 0, with a dash for its rate', () => {
    render(<ChannelTiles data={data} status="ready" />)

    expect(within(tile('Сарафан')).getByText('0')).toBeTruthy()
    expect(within(tile('Сарафан')).getByText('0 kval · —')).toBeTruthy()
  })

  it('prints the server’s Jami first, set apart as the total', () => {
    render(<ChannelTiles data={data} status="ready" />)

    const total = screen.getByTestId('lead-channel-total')
    expect(total.parentElement!.firstElementChild).toBe(total)
    expect(within(total).getByText('Jami')).toBeTruthy()
    expect(within(total).getByText('5,734')).toBeTruthy()
    // kval ÷ yangi (5 674), as the headline «Квал %».
    expect(within(total).getByText('1,014 kval · 17.9%')).toBeTruthy()
    expect(within(total).getByText('= Жами лидлар · kval yopilgan kuni')).toBeTruthy()
  })

  it('says loading and failure on every tile rather than printing zeros', () => {
    const { unmount } = render(<ChannelTiles data={undefined} status="loading" />)
    expect(screen.getAllByRole('status')).toHaveLength(9)
    unmount()

    render(<ChannelTiles data={undefined} status="error" />)
    expect(screen.getAllByText('Olinmadi')).toHaveLength(9)
  })
})
