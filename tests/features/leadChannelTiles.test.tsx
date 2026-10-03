// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ChannelTiles } from '@/features/leads/LeadSourcesSection'
import type { ChannelTileDto, LeadSourcesOverviewDto, LeadTile } from '@/features/leads/leadSourcesApi'

/*
  «Boshqa kanallar lidlari» — the client's list of 2026-10-01: Ген лид,
  Входящий, Телеграм, Сммщик ии, Веб сайт, Сарафан, and «Jami». Since
  2026-10-03 «Jami» IS «Жами лидлар»: «Исход» and «Boshqa» are counted in it
  with no card of their own, and every tile says its duplicates quietly. Kval
  as «Квал лидлар сони» counts it: by the day it was WON, over new leads.

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
  generated: cells(2278, 700, 30),
  inbound: cells(473, 100),
  telegram: cells(27, 13),
  aiSmm: cells(445, 150, 5),
  web: cells(1, 1),
  sarafan: cells(0, 0),
  outbound: cells(2410, 0),
  other: cells(120, 10),
}

const data = {
  // The headline: the six channels' 3 224 less the AI's 40, «Исход» 2 410 and «Boshqa» 120.
  funnel: { total: 5714 },
  tiles: {
    rows: (Object.keys(TILES) as LeadTile[]).map((tile) => ({ tile, ...TILES[tile] })),
    // «Jami» as the server builds it: the headline, duplicates and kval included.
    total: cells(5714, 974, 60),
    // «Сммщик ии»'s Регистрация leads; its tile reads 445 by «ИИ квал сана».
    aiInTotal: 405,
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

  it('prints «Jami» first as «Жами лидлар» itself (2026-10-03)', () => {
    render(<ChannelTiles data={data} status="ready" />)

    const total = screen.getByTestId('lead-channel-total')
    expect(total.parentElement!.firstElementChild).toBe(total)
    expect(within(total).getByText('Jami')).toBeTruthy()
    expect(within(total).getByText('5,714')).toBeTruthy()
    // Over the new leads, as «Квал %»: 974 ÷ (5 714 − 60).
    expect(within(total).getByText('974 kval · 17.2%')).toBeTruthy()
    expect(within(total).getByText('= «Жами лидлар»')).toBeTruthy()
    expect(total.parentElement!.children).toHaveLength(7)
  })

  it('names «Исход» and «Boshqa» inside «Jami», with no card of their own', () => {
    render(<ChannelTiles data={data} status="ready" />)

    const total = screen.getByTestId('lead-channel-total')
    expect(within(total).getByText('Исход 2,410 · Boshqa 120').getAttribute('title')).toMatch(/«Jami»ga kiradi/)
    expect(screen.queryByText('Исход', { selector: 'p' })).toBeNull()
    expect(screen.queryByText('Boshqa', { selector: 'p' })).toBeNull()
    expect(screen.queryByText('Jamiga kirmaydi')).toBeNull()
  })

  it('says each tile\'s duplicates quietly, and only where there are some', () => {
    render(<ChannelTiles data={data} status="ready" />)

    expect(within(screen.getByTestId('lead-channel-total')).getByText('shundan 60 dubl')).toBeTruthy()
    expect(within(tile('Ген лид')).getByText('shundan 30 dubl')).toBeTruthy()
    expect(within(tile('Входящий')).queryByText(/dubl/)).toBeNull()
  })

  it('says what «Сммщик ии» puts into «Jami» when its own count differs', () => {
    render(<ChannelTiles data={data} status="ready" />)

    expect(within(tile('Сммщик ии')).getByText('«Jami»da 405').getAttribute('title')).toMatch(/Регистрацияga kelgan/)
    const same = { ...data, tiles: { ...data.tiles, aiInTotal: 445 } } as unknown as LeadSourcesOverviewDto
    cleanup()
    render(<ChannelTiles data={same} status="ready" />)
    expect(within(tile('Сммщик ии')).queryByText(/«Jami»da/)).toBeNull()
  })

  it('names only the sources that hold a lead', () => {
    const quiet = {
      ...data,
      tiles: { ...data.tiles, rows: data.tiles.rows.map((r) => (r.tile === 'outbound' ? { ...r, ...cells(0, 0) } : r)) },
    } as unknown as LeadSourcesOverviewDto
    render(<ChannelTiles data={quiet} status="ready" />)

    expect(within(screen.getByTestId('lead-channel-total')).getByText('Boshqa 120')).toBeTruthy()
  })

  it('says loading and failure on every tile rather than printing zeros', () => {
    const { unmount } = render(<ChannelTiles data={undefined} status="loading" />)
    expect(screen.getAllByRole('status')).toHaveLength(7)
    unmount()

    render(<ChannelTiles data={undefined} status="error" />)
    expect(screen.getAllByText('Olinmadi')).toHaveLength(7)
  })
})
