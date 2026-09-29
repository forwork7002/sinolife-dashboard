// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ChannelTiles } from '@/features/leads/LeadSourcesSection'
import type { LeadChannel, LeadOutcomeDto, LeadSourcesOverviewDto } from '@/features/leads/leadSourcesApi'

/*
  «Boshqa kanallar lidlari» — the client's 2026-09-29 request: the non-ad lead
  channels as tiles beside the ad ones, with a «Jami», and «Исход» on a tile of
  its own that the total leaves out.

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

const outcome = (leads: number, success: number): LeadOutcomeDto => ({
  leads,
  success,
  noAnswer: 0,
  lowQuality: 0,
  duplicate: 0,
  open: leads - success,
  successPercent: leads > 0 ? (success / leads) * 100 : null,
})

// Last week's shape (22–28.09.2026), rounded.
const CHANNELS: Record<LeadChannel, LeadOutcomeDto> = {
  form: outcome(1500, 500),
  page: outcome(507, 179),
  inbound: outcome(581, 121),
  manual: outcome(349, 78),
  telegram: outcome(21, 13),
  smm: outcome(0, 0),
  other: outcome(38, 4),
  outbound: outcome(2462, 481),
}

const data = {
  totals: {
    // inbound + manual + telegram + smm + other, as the server sums it.
    nonAd: outcome(989, 216),
  },
  channels: (Object.keys(CHANNELS) as LeadChannel[]).map((channel) => ({ channel, outcome: CHANNELS[channel] })),
} as unknown as LeadSourcesOverviewDto

/** The tile whose label reads exactly `label`. */
const tile = (label: string) => screen.getByText(label, { selector: 'p' }).closest('.card') as HTMLElement

describe('ChannelTiles', () => {
  it('prints each non-ad channel with its kval and rate', () => {
    render(<ChannelTiles data={data} status="ready" />)

    expect(screen.getByRole('heading', { name: 'Boshqa kanallar lidlari' })).toBeTruthy()
    expect(within(tile('Ген лид (qoʻlda)')).getByText('349')).toBeTruthy()
    expect(within(tile('Ген лид (qoʻlda)')).getByText('78 kval · 22.3%')).toBeTruthy()
    expect(within(tile('Kiruvchi qoʻngʻiroq')).getByText('581')).toBeTruthy()
    expect(within(tile('Telegram')).getByText('21')).toBeTruthy()
    expect(within(tile('Telegram')).getByText('13 kval · 61.9%')).toBeTruthy()
    expect(within(tile('Boshqa')).getByText('38')).toBeTruthy()
  })

  it('shows a quiet channel at 0, with a dash for its rate', () => {
    render(<ChannelTiles data={data} status="ready" />)

    expect(within(tile('Сммщик')).getByText('0')).toBeTruthy()
    expect(within(tile('Сммщик')).getByText('0 kval · —')).toBeTruthy()
  })

  it('prints the server’s Jami, set apart as the total', () => {
    render(<ChannelTiles data={data} status="ready" />)

    const total = screen.getByTestId('lead-channel-total')
    expect(within(total).getByText('Jami')).toBeTruthy()
    expect(within(total).getByText('989')).toBeTruthy()
    expect(within(total).getByText('216 kval · 21.8%')).toBeTruthy()
    // The ads and «Исход» have no tile in the Jami row.
    expect(within(total).queryByText('2,462')).toBeNull()
  })

  it('gives «Исход» its own tile, outside the Jami row', () => {
    render(<ChannelTiles data={data} status="ready" />)

    const outbound = screen.getByTestId('lead-channel-outbound')
    expect(within(outbound).getByText('Исход (chiquvchi)')).toBeTruthy()
    expect(within(outbound).getByText('2,462')).toBeTruthy()
    expect(within(outbound).getByText('481 kval · 19.5%')).toBeTruthy()
    expect(within(outbound).getByText('operator oʻzi qoʻngʻiroq qilgan · Jamiga kirmaydi')).toBeTruthy()
    expect(screen.queryByText('Lid-forma')).toBeNull()
    expect(screen.queryByText('Reklama sahifasi')).toBeNull()
  })

  it('says loading and failure on every tile rather than printing zeros', () => {
    const { unmount } = render(<ChannelTiles data={undefined} status="loading" />)
    expect(screen.getAllByRole('status')).toHaveLength(7)
    unmount()

    render(<ChannelTiles data={undefined} status="error" />)
    expect(screen.getAllByText('Olinmadi')).toHaveLength(7)
  })
})
