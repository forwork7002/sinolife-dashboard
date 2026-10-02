// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
  // The headline: the six channels' 3 224, «Исход» 2 410 and «Boshqa» 120, less the AI's 40.
  funnel: { total: 5714 },
  tiles: {
    rows: (Object.keys(TILES) as LeadTile[]).map((tile) => ({ tile, ...TILES[tile] })),
    // The six channels' sum, as the server builds it — «Исход» and «Boshqa» left out.
    total: cells(3224, 964, 40),
    toHeadline: { outbound: 2410, other: 120, ai: -40 },
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
    expect(within(tile('Сммщик ии')).getByText('«ИИ квал сана» shu davrda · barcha voronkalar · 14.09.2026 dan')).toBeTruthy()
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
    expect(total.parentElement!.children).toHaveLength(7)
  })

  it('says, quietly, what takes «Jami» to «Жами лидлар» (2026-10-02)', () => {
    render(<ChannelTiles data={data} status="ready" />)

    const total = screen.getByTestId('lead-channel-total')
    // 3 224 + 2 410 + 120 − 40 = 5 714, the headline.
    expect(within(total).getByText('+2,490 → 5,714 «Жами лидлар»')).toBeTruthy()
    const parts = within(total).getByText('Исход +2,410 · Boshqa +120 · ИИ farqi −40')
    expect(parts.getAttribute('title')).toMatch(/«ИИ квал сана»/)
  })

  it('names only the parts that add something', () => {
    const quiet = {
      funnel: { total: 3344 },
      tiles: { ...data.tiles, toHeadline: { outbound: 0, other: 120, ai: 0 } },
    } as unknown as LeadSourcesOverviewDto
    render(<ChannelTiles data={quiet} status="ready" />)

    const total = screen.getByTestId('lead-channel-total')
    expect(within(total).getByText('+120 → 3,344 «Жами лидлар»')).toBeTruthy()
    expect(within(total).getByText('Boshqa +120').getAttribute('title')).toBeNull()
  })

  it('says «= Жами лидлар» when nothing is apart', () => {
    const even = {
      funnel: { total: 3224 },
      tiles: { ...data.tiles, toHeadline: { outbound: 0, other: 0, ai: 0 } },
    } as unknown as LeadSourcesOverviewDto
    render(<ChannelTiles data={even} status="ready" />)

    expect(within(screen.getByTestId('lead-channel-total')).getByText('= «Жами лидлар»')).toBeTruthy()
  })

  it('puts «Исход» and «Boshqa» on one card beneath, outside «Jami», picked by a filter (2026-10-02)', () => {
    render(<ChannelTiles data={data} status="ready" />)

    const apart = screen.getByRole('group', { name: 'Jamiga kirmaydi' })
    expect(apart.querySelectorAll('.card')).toHaveLength(1)
    // «Исход» first, the picker on the card.
    expect(within(tile('Исход')).getByText('2,410')).toBeTruthy()
    expect(within(tile('Исход')).getByText('operatorning chiquvchi qoʻngʻirogʻi')).toBeTruthy()
    fireEvent.click(within(apart).getByRole('button', { name: 'Boshqa' }))
    expect(within(tile('Boshqa')).getByText('120')).toBeTruthy()
    expect(screen.queryByText('Исход', { selector: 'p' })).toBeNull()
    expect(within(screen.getByTestId('lead-channel-total').parentElement!).queryByText('Boshqa')).toBeNull()
  })

  it('says loading and failure on every tile rather than printing zeros', () => {
    const { unmount } = render(<ChannelTiles data={undefined} status="loading" />)
    expect(screen.getAllByRole('status')).toHaveLength(8)
    unmount()

    render(<ChannelTiles data={undefined} status="error" />)
    expect(screen.getAllByText('Olinmadi')).toHaveLength(8)
  })
})
