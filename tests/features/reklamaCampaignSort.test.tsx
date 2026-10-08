// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { CampaignSection } from '@/features/reklama/CampaignSection'
import type { CampaignDto } from '@/features/reklama/reklamaApi'

/**
 * «Kampaniyalar · Meta» — a campaign with no result to price (traffic,
 * awareness, a lead form with 0 leads) or no impression to click through
 * sinks to the bottom WHICHEVER way the column is sorted. As +Infinity it
 * rose to the top of «Natija narxi» descending and pushed the dearest lead
 * forms past the thirty rows shown before «Yana N ta».
 */

beforeAll(() => {
  // DataTable's pinned columns measure with one; jsdom has none.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

afterEach(cleanup)

const campaign = (o: Partial<CampaignDto> & Pick<CampaignDto, 'id' | 'name'>): CampaignDto => ({
  account: 'Umar - 64',
  targetolog: 'Umar',
  product: 'Collagen',
  channel: 'form',
  spendUsd: 10,
  metaLeads: 0,
  conversations: 0,
  results: 0,
  costPerResultUsd: null,
  impressions: 1000,
  clicks: 10,
  ctrPercent: 1,
  activeDays: 1,
  lastActive: '2026-10-05',
  crm: null,
  ...o,
})

const CAMPAIGNS = [
  campaign({ id: '1', name: 'Traffic', channel: 'other', spendUsd: 50, costPerResultUsd: null, ctrPercent: null, impressions: 0 }),
  campaign({ id: '2', name: 'Cheap form', spendUsd: 20, results: 10, costPerResultUsd: 2, ctrPercent: 3 }),
  campaign({ id: '3', name: 'Dear form', spendUsd: 30, results: 6, costPerResultUsd: 5, ctrPercent: 1 }),
]

const order = () =>
  screen
    .getAllByRole('rowheader')
    .map((cell) => ['Traffic', 'Cheap form', 'Dear form'].find((name) => cell.textContent?.startsWith(name)))

describe('CampaignSection — sorting by a figure some campaigns lack', () => {
  it('keeps the unpriced campaign last on «Natija narxi», cheapest first and dearest first alike', () => {
    render(<CampaignSection campaigns={CAMPAIGNS} status="ready" />)
    const header = screen.getByRole('button', { name: /Natija narxi/ })
    fireEvent.click(header) // a price opens cheapest first
    expect(order()).toEqual(['Cheap form', 'Dear form', 'Traffic'])
    fireEvent.click(header)
    expect(order()).toEqual(['Dear form', 'Cheap form', 'Traffic'])
  })

  it('keeps the campaign with no CTR last whichever way CTR is sorted', () => {
    render(<CampaignSection campaigns={CAMPAIGNS} status="ready" />)
    const header = screen.getByRole('button', { name: /CTR/ })
    fireEvent.click(header) // highest first
    expect(order()).toEqual(['Cheap form', 'Dear form', 'Traffic'])
    fireEvent.click(header)
    expect(order()).toEqual(['Dear form', 'Cheap form', 'Traffic'])
  })
})
