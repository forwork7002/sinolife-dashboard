// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { SverkaBody } from '@/features/sverka/SverkaPage'
import type { SverkaIssue, SverkaLineDto, SverkaOverviewDto } from '@/features/sverka/sverkaApi'

/**
 * «Sverka»'s difference list, rendered from a fixture — the page cannot be seen
 * locally (no MoySklad rows in any local database). What is pinned is what the
 * difference list must say without a click: the gap in soʻm, the product the
 * baskets differ by, the soʻm behind each chip, and the field-by-field panel.
 */

beforeAll(() => {
  // DataTable's pinned columns measure with one; jsdom has none.
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
  Element.prototype.scrollIntoView = () => {}
})

afterEach(cleanup)

const zeroes = (): Record<SverkaIssue, number> => ({
  MISSING_IN_MS: 0,
  NOT_FAKT1: 0,
  NOT_QUEUED: 0,
  NO_DEAL: 0,
  SUM: 0,
  STATUS: 0,
  PRODUCTS: 0,
  SELLER: 0,
  REGION: 0,
  ROP: 0,
  DUPLICATE: 0,
})

// Deal 1071484 of 05.10: MoySklad carries an extra Sedana line, +200 000.
const sedana: SverkaLineDto = {
  dealId: '1071484',
  issues: ['SUM', 'PRODUCTS', 'REGION'],
  diffAmount: 200_000,
  productDiff: [{ key: 'code:sedana', name: 'Sedana Sinolife', bitrixQuantity: 0, moyskladQuantity: 1 }],
  regionMatch: 'diff',
  ropMatch: 'same',
  bitrix: {
    amount: 1_600_000,
    stage: 'CARAVAN',
    phase: 'TRANSIT',
    fakt1: true,
    delivered: false,
    seller: 'Zarnigor Mirzayeva230',
    rop: 'Shohjaxon',
    ropSource: 'Shohjaxon',
    region: 'Хорезм',
    queuedAt: '2026-10-05T08:00:00.000Z',
    items: [{ code: 'collagen', name: 'Sinolife collagen marine kakao', quantity: 2, amount: 1_600_000 }],
  },
  moysklad: {
    orderId: 'ms-1',
    orderName: 'bx1071484',
    moment: '2026-10-05T10:00:00.000Z',
    state: 'В пути',
    phase: 'TRANSIT',
    amount: 1_800_000,
    seller: 'Zarnigor Mirzayeva230',
    project: 'Shohjaxon(ROP)',
    region: 'Бухара',
    logistics: 'CARAVAN',
    payed: 0,
    shipped: 1_800_000,
    items: [
      { code: 'collagen', name: 'Collagen Marine Sinolife', quantity: 2, amount: 1_600_000 },
      { code: 'sedana', name: 'Sedana Sinolife', quantity: 1, amount: 200_000 },
    ],
  },
  moyskladOrders: 2,
  otherOrders: [{ orderId: 'ms-0', orderName: 'bx1071484-old', moment: '2026-10-04T10:00:00.000Z', state: 'Новый', amount: 1_600_000 }],
}

const missing: SverkaLineDto = {
  dealId: '1070001',
  issues: ['MISSING_IN_MS'],
  diffAmount: null,
  productDiff: [],
  regionMatch: null,
  ropMatch: null,
  bitrix: { ...sedana.bitrix!, seller: 'Kamilla 225', region: null },
  moysklad: null,
  moyskladOrders: 0,
  otherOrders: [],
}

const pair = { bitrix: { orders: 2, amount: 3_200_000 }, moysklad: { orders: 1, amount: 1_800_000 } }

const data: SverkaOverviewDto = {
  totals: {
    fakt1: pair,
    fakt2: pair,
    transit: pair,
    returned: pair,
    pending: { orders: 0, amount: 0 },
    clean: 0,
    cohortOrders: 2,
  },
  issueCounts: { ...zeroes(), SUM: 1, PRODUCTS: 1, REGION: 1, MISSING_IN_MS: 1 },
  issueAmounts: { ...zeroes(), SUM: 200_000, PRODUCTS: 1_600_000, REGION: 1_600_000, MISSING_IN_MS: 1_600_000 },
  otherWindowOrders: 0,
  lines: [missing, sedana],
  flaggedCount: 2,
  linesTruncated: false,
  products: [],
  teams: [],
  moysklad: { orders: 10, lastSuccessAt: '2026-10-06T05:46:00.000Z', lastError: null },
}

describe('SverkaBody — the difference list', () => {
  it('prints the gap in soʻm and the product the baskets differ by, on the row', () => {
    render(<SverkaBody data={data} status="ready" />)
    const row = screen.getByRole('rowheader', { name: '1071484' }).closest('tr')!
    expect(within(row).getByText('+200,000')).toBeTruthy()
    expect(within(row).getByText('+1 Sedana Sinolife')).toBeTruthy()
    expect(within(row).getByText('Хорезм ≠ Бухара')).toBeTruthy()
  })

  it('puts the soʻm at stake on each chip', () => {
    render(<SverkaBody data={data} status="ready" />)
    // The table's rows are buttons too; the chip is the one that toggles.
    const chip = screen.getAllByRole('button', { name: /Summa farqi/ }).find((b) => b.hasAttribute('aria-pressed'))!
    expect(chip.textContent).toContain('200 ming')
  })

  it('opens both sides field by field, with the products beside each other and the other order', () => {
    render(<SverkaBody data={data} status="ready" />)
    fireEvent.click(screen.getByRole('rowheader', { name: '1071484' }))
    const panel = screen.getByText('Bitim 1071484 — ikki tizimda').closest('div')!.parentElement!.parentElement!
    const region = within(panel).getByRole('rowheader', { name: 'Region' }).closest('tr')!
    expect(region.textContent).toContain('✗ farq')
    const seller = within(panel).getByRole('rowheader', { name: 'Sotuvchi' }).closest('tr')!
    expect(seller.textContent).toContain('✓ mos')
    expect(within(panel).getByText('Mahsulotlar — yonma-yon')).toBeTruthy()
    expect(within(panel).getByText('bx1071484-old')).toBeTruthy()
  })
})
