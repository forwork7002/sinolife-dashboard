// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ChannelTiles } from '@/features/leads/LeadSourcesSection'
import type { ChannelTileDto, LeadSourcesOverviewDto, LeadTile } from '@/features/leads/leadSourcesApi'

/*
  «Boshqa kanallar lidlari» — the client's list of 2026-10-01: Ген лид,
  Входящий, Телеграм, Сммщик ии, Веб сайт, Сарафан, and since 2026-10-02
  «Исход» and «Boshqa» — those two on a row of their own, outside «Jami». Kval as «Квал лидлар сони» counts
  it: by the day it was WON, over new leads.

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
  outbound: cells(2410, 0),
  other: cells(120, 10),
}

const data = {
  tiles: {
    rows: (Object.keys(TILES) as LeadTile[]).map((tile) => ({ tile, ...TILES[tile] })),
    // The six channels' sum, as the server builds it — «Исход» and «Boshqa» left out.
    total: cells(3224, 964, 40),
  },
} as unknown as LeadSourcesOverviewDto

/** The tile whose label reads exactly `label`. */
const tile = (label: string) => screen.getByText(label, { selector: 'p' }).closest('.card') as HTMLElement

describe('ChannelTiles', () => {
  it('prints the client\'s six channels with their kval and rate', () => {
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
    expect(within(total).getByText('3,224')).toBeTruthy()
    // Over the new leads, as «Квал %»: 964 ÷ (3 224 − 40).
    expect(within(total).getByText('964 kval · 30.3%')).toBeTruthy()
    expect(
      within(total).getByText('6 kanal yigʻindisi · Исход va Boshqa kirmaydi · forma va ИИ lidlari Reklamada ham bor'),
    ).toBeTruthy()
    expect(total.parentElement!.children).toHaveLength(7)
  })

  it('puts «Исход» and «Boshqa» on a row of their own, outside «Jami» (2026-10-02)', () => {
    render(<ChannelTiles data={data} status="ready" />)

    const apart = screen.getByRole('group', { name: 'Jamiga kirmaydi' })
    expect(apart.children).toHaveLength(2)
    expect(within(apart).getByText('Исход')).toBeTruthy()
    expect(within(apart).getByText('Boshqa')).toBeTruthy()
    expect(within(tile('Исход')).getByText('2,410')).toBeTruthy()
    expect(within(tile('Boshqa')).getByText('120')).toBeTruthy()
    expect(within(screen.getByTestId('lead-channel-total').parentElement!).queryByText('Исход')).toBeNull()
  })

  it('says loading and failure on every tile rather than printing zeros', () => {
    const { unmount } = render(<ChannelTiles data={undefined} status="loading" />)
    expect(screen.getAllByRole('status')).toHaveLength(9)
    unmount()

    render(<ChannelTiles data={undefined} status="error" />)
    expect(screen.getAllByText('Olinmadi')).toHaveLength(9)
  })
})
