// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { TablesBlock } from '@/features/leads/LeadSourcesSection'
import type { LeadOutcomeDto, LeadSourcesOverviewDto } from '@/features/leads/leadSourcesApi'

/*
  «Targetologlar» and «DM sahifalar», period and day by day: four tables in
  one card behind one switch (the client, 2026-10-02 — four cards ran the
  page too long). One table on screen at a time, and a day view's picker
  keeps its choice across the switch.
*/
afterEach(cleanup)

beforeAll(() => {
  // DataTable's pinned columns measure with one; jsdom has none.
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
})

const outcome = (leads: number, success: number): LeadOutcomeDto => ({
  leads,
  success,
  noAnswer: 0,
  lowQuality: 0,
  duplicate: 0,
  open: 0,
  successPercent: leads > 0 ? (success / leads) * 100 : null,
})

const data = {
  totals: { formReachPercent: 63.6 },
  forms: {
    spendUsd: 167.48,
    metaLeads: 130,
    outcome: outcome(91, 23),
    days: [{ date: '2026-10-01', metaLeads: 130, leads: 91, success: 23 }],
    owners: [
      {
        key: 'sobirjon|Collagen',
        targetolog: 'Sobirjon',
        product: 'Collagen',
        forms: ['Sobirjon-collagen I.S'],
        accounts: ['Collagen Sobirjon #2'],
        spendUsd: 167.48,
        metaLeads: 130,
        outcome: outcome(91, 23),
        reachPercent: 70,
        costPerLeadUsd: 1.84,
        costPerSuccessUsd: 7.28,
        days: [{ date: '2026-10-01', metaLeads: 130, leads: 91, success: 23 }],
      },
    ],
  },
  dm: {
    conversations: 312,
    outcome: outcome(27, 3),
    days: [{ date: '2026-10-01', conversations: 312, leads: 27, success: 3 }],
    pages: [
      {
        key: 'UC_MWIKOC',
        name: 'collagen.marine',
        product: 'Collagen',
        conversations: 312,
        outcome: outcome(27, 3),
        days: [{ date: '2026-10-01', conversations: 312, leads: 27, success: 3 }],
      },
    ],
  },
} as unknown as LeadSourcesOverviewDto

/** Presses `label` on the card's top switch. */
const view = (label: string) =>
  fireEvent.click(within(screen.getByRole('group', { name: 'Targetolog yoki DM jadvali' })).getByRole('button', { name: label }))

describe('TablesBlock', () => {
  it('opens on the targetologs over the period, the other three one press away', () => {
    render(<TablesBlock data={data} status="ready" />)

    const sw = screen.getByRole('group', { name: 'Targetolog yoki DM jadvali' })
    expect([...sw.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Targetologlar',
      'Targetologlar · kunlik',
      'DM sahifalar',
      'DM sahifalar · kunlik',
    ])
    expect(screen.getByRole('heading', { name: 'Targetologlar · lid-forma — davr boʻyicha' })).toBeTruthy()
    expect(screen.getByText('Sobirjon')).toBeTruthy()
    expect(screen.queryByText('collagen.marine')).toBeNull()
  })

  it('draws one table at a time', () => {
    render(<TablesBlock data={data} status="ready" />)

    view('DM sahifalar')
    expect(screen.getByRole('heading', { name: 'DM sahifalar — davr boʻyicha' })).toBeTruthy()
    expect(screen.getByText('collagen.marine')).toBeTruthy()
    expect(screen.queryByText('Sobirjon')).toBeNull()
    expect(screen.getAllByRole('table')).toHaveLength(1)
  })

  it('keeps a day view\'s pick across the switch', () => {
    render(<TablesBlock data={data} status="ready" />)

    view('Targetologlar · kunlik')
    expect(screen.getByRole('heading', { name: 'Targetologlar · kunlik — barcha targetologlar' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sobirjon · Collagen' }))
    expect(screen.getByRole('heading', { name: 'Targetologlar · kunlik — Sobirjon · Collagen' })).toBeTruthy()

    view('DM sahifalar · kunlik')
    expect(screen.getByRole('heading', { name: 'DM sahifalar · kunlik — barcha sahifalar' })).toBeTruthy()

    view('Targetologlar · kunlik')
    expect(screen.getByRole('heading', { name: 'Targetologlar · kunlik — Sobirjon · Collagen' })).toBeTruthy()
  })
})
