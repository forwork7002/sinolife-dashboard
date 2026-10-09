// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ChannelTiles } from '@/features/leads/LeadSourcesSection'
import type { ChannelTileDto, LeadSourcesOverviewDto, LeadTile } from '@/features/leads/leadSourcesApi'

/*
  «Boshqa kanallar lidlari» — the client's list of 2026-10-01: Ген лид,
  Входящий, Телеграм, Сммщик ии, Веб сайт, Сарафан, and since 2026-10-02
  «Исход» and «Boshqa» — those two on a row of their own, outside «Jami». Kval as «Квал лидлар сони» counts
  it: the cohort's, over new leads, with the count closed in the window as a
  quiet line (2026-10-09). «Jami» is «Жами лидлар» and «Сммщик ии» lists its
  accounts.

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

const cells = (leads: number, qualified: number, duplicates = 0, closedQualified = qualified + 1): ChannelTileDto => ({
  leads,
  fresh: leads - duplicates,
  qualified,
  qualifiedPercent: leads - duplicates > 0 ? (qualified / (leads - duplicates)) * 100 : null,
  closedQualified,
})

// 24–30.09.2026 off the portal, rounded.
const TILES: Record<LeadTile, ChannelTileDto> = {
  generated: cells(2278, 700, 30),
  inbound: cells(473, 100),
  telegram: cells(27, 13),
  aiSmm: cells(445, 150),
  web: cells(1, 1),
  sarafan: cells(0, 0),
  outbound: cells(2410, 0),
  other: cells(120, 10),
}

const data = {
  brand: 'all',
  // The headline is the channels' «Jami» — «Исход» 2 410 and «Boshqa» 120 in neither.
  funnel: { total: 3224 },
  tiles: {
    rows: (Object.keys(TILES) as LeadTile[]).map((tile) => ({ tile, ...TILES[tile] })),
    // The counted channels' sum, as the server builds it — «Исход» and «Boshqa» left out.
    total: cells(3224, 964, 40, 990),
    smmAccounts: [
      { key: 'UC_1X1J24', name: 'sinolifeuz', ...cells(300, 100) },
      { key: 'UC_MWIKOC', name: 'collagen.marine', ...cells(145, 50) },
    ],
    aiQualified: 410,
    aiElsewhere: 17,
  },
} as unknown as LeadSourcesOverviewDto

/** What a line's InfoTip says, opened as a pointer would open it. */
async function tipOf(line: HTMLElement): Promise<string> {
  fireEvent.mouseEnter(within(line).getByRole('button', { name: 'Izoh' }).parentElement!)
  return (await screen.findByRole('tooltip')).textContent ?? ''
}

/** The tile whose label reads exactly `label`. */
const tile = (label: string) => screen.getByText(label, { selector: 'p' }).closest('.card') as HTMLElement

describe('ChannelTiles', () => {
  it('prints the client\'s six channels with their kval and rate', async () => {
    render(<ChannelTiles data={data} status="ready" />)

    expect(screen.getByRole('heading', { name: 'Boshqa kanallar lidlari' })).toBeTruthy()
    expect(within(tile('Ген лид')).getByText('2,278')).toBeTruthy()
    expect(within(tile('Ген лид')).getByText('lid-forma + qoʻlda kiritilgan')).toBeTruthy()
    expect(within(tile('Входящий')).getByText('473')).toBeTruthy()
    expect(within(tile('Телеграм')).getByText('27')).toBeTruthy()
    expect(within(tile('Телеграм')).getByText('13 kval · 48.1%')).toBeTruthy()
    expect(within(tile('Сммщик ии')).getByText('445')).toBeTruthy()
    expect(await tipOf(within(tile('Сммщик ии')).getByText('Instagram / Telegram bot akkauntlari · yaratilgan kuni boʻyicha'))).toContain('collagen.marine')
    expect(within(tile('Веб сайт')).getByText('1')).toBeTruthy()
  })

  it('under one brand, says «Сарафан» and the inbound calls are not split instead of printing a figure', () => {
    render(<ChannelTiles data={{ ...data, brand: 'Zextra', inboundCalls: null } as LeadSourcesOverviewDto} status="ready" />)

    const sarafan = tile('Сарафан')
    expect(within(sarafan).getByText('Brend boʻyicha ajratilmaydi')).toBeTruthy()
    expect(within(sarafan).queryByText('faqat Ecommerce voronkasi · «Jami»ga kirmaydi')).toBeNull()
    expect(within(tile('Входящий')).getByText('📞 qoʻngʻiroqlar · Brend boʻyicha ajratilmaydi')).toBeTruthy()
    // The brand's own channels still print their figures.
    expect(within(tile('Входящий')).getByText('473')).toBeTruthy()
  })

  it('lists «Сммщик ии» by account, and keeps «ИИ квал сана» as a quiet line with what left Регистрация in its tip (2026-10-09)', async () => {
    render(<ChannelTiles data={data} status="ready" />)

    const smm = tile('Сммщик ии')
    const accounts = within(smm).getByTestId('smm-accounts')
    expect([...accounts.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['sinolifeuz300', 'collagen.marine145'])
    const line = within(smm).getByText('«ИИ квал сана» boʻyicha: 410')
    expect(await tipOf(line)).toMatch(/Yana 17 tasi Регистрацияdan oʻtib ketgan/)
    // The big number is the accounts' leads by creation day, not the AI's date.
    expect(within(smm).getByText('445')).toBeTruthy()
  })

  it('names nothing past Регистрация when nothing is, and no list with no account', async () => {
    render(<ChannelTiles data={{ ...data, tiles: { ...data.tiles, smmAccounts: [], aiElsewhere: 0 } }} status="ready" />)

    const smm = tile('Сммщик ии')
    expect(within(smm).queryByTestId('smm-accounts')).toBeNull()
    expect(await tipOf(within(smm).getByText('«ИИ квал сана» boʻyicha: 410'))).not.toMatch(/oʻtib ketgan/)
  })

  it('prints the count closed in the window as a quiet second line on every tile', async () => {
    render(<ChannelTiles data={data} status="ready" />)

    const line = within(tile('Телеграм')).getByText('shu davrda yopilgan: 14')
    expect(await tipOf(line)).toMatch(/eski hisob/)
    expect(within(screen.getByTestId('lead-channel-total')).getByText('shu davrda yopilgan: 990')).toBeTruthy()
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

  it('says «Jami» is «Жами лидлар» and nothing about a gap — the «+N / ИИ farqi» lines are gone (2026-10-09)', () => {
    render(<ChannelTiles data={data} status="ready" />)

    const total = screen.getByTestId('lead-channel-total')
    expect(within(total).getByText('= «Жами лидлар» · Исходsiz')).toBeTruthy()
    expect(within(total).queryByText(/→|ИИ farqi|Исход \+/)).toBeNull()
  })

  it('puts «Исход» and «Boshqa» on one card beneath, outside «Jami», picked by a filter (2026-10-02)', () => {
    render(<ChannelTiles data={data} status="ready" />)

    const apart = screen.getByRole('group', { name: 'Jamiga kirmaydi' })
    expect(apart.querySelectorAll('.card')).toHaveLength(1)
    // «Исход» first, the picker on the card.
    expect(within(tile('Исход')).getByText('2,410')).toBeTruthy()
    expect(within(tile('Исход')).getByText('operatorning chiquvchi qoʻngʻirogʻi — lid emas')).toBeTruthy()
    fireEvent.click(within(apart).getByRole('button', { name: 'Boshqa' }))
    expect(within(tile('Boshqa')).getByText('120')).toBeTruthy()
    expect(screen.queryByText('Исход', { selector: 'p' })).toBeNull()
    expect(within(screen.getByTestId('lead-channel-total').parentElement!).queryByText('Boshqa')).toBeNull()
  })

  it('says each tile\'s duplicates quietly, and only where there are some (2026-10-03)', () => {
    render(<ChannelTiles data={data} status="ready" />)

    expect(within(screen.getByTestId('lead-channel-total')).getByText('shundan 40 dubl')).toBeTruthy()
    expect(within(tile('Ген лид')).getByText('shundan 30 dubl')).toBeTruthy()
    expect(within(tile('Входящий')).queryByText(/dubl/)).toBeNull()
  })

  it('says loading and failure on every tile rather than printing zeros', () => {
    const { unmount } = render(<ChannelTiles data={undefined} status="loading" />)
    expect(screen.getAllByRole('status')).toHaveLength(8)
    unmount()

    render(<ChannelTiles data={undefined} status="error" />)
    expect(screen.getAllByText('Olinmadi')).toHaveLength(8)
  })
})
