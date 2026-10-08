// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { SverkaBody } from '@/features/sverka/SverkaPage'
import type { SverkaIssue, SverkaLineDto, SverkaOverviewDto } from '@/features/sverka/sverkaApi'
import { formatDate } from '@/lib/format'

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

const none = { orders: 0, amount: 0 }

const pair = { bitrix: { orders: 2, amount: 3_200_000 }, moysklad: { orders: 1, amount: 1_800_000 }, beforeFloor: none }

const data: SverkaOverviewDto = {
  totals: {
    fakt1: pair,
    fakt2: pair,
    kassa: { banked: { orders: 1, amount: 1_200_000 }, awaiting: { orders: 1, amount: 600_000 }, payed: none },
    transit: pair,
    returned: pair,
    pending: { orders: 0, amount: 0 },
    clean: 0,
    cohortOrders: 2,
    beforeFloor: none,
  },
  issueCounts: { ...zeroes(), SUM: 1, PRODUCTS: 1, REGION: 1, MISSING_IN_MS: 1 },
  issueAmounts: { ...zeroes(), SUM: 200_000, PRODUCTS: 1_600_000, REGION: 1_600_000, MISSING_IN_MS: 1_600_000 },
  otherWindowOrders: 0,
  lines: [missing, sedana],
  flaggedCount: 2,
  linesTruncated: false,
  products: [],
  teams: [],
  moysklad: { orders: 10, since: '2026-06-14T19:00:00.000Z', lastSuccessAt: '2026-10-06T05:46:00.000Z', lastError: null },
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
    expect(within(region).getByText(/^farq/)).toBeTruthy()
    const seller = within(panel).getByRole('rowheader', { name: 'Sotuvchi' }).closest('tr')!
    expect(within(seller).getByText('mos')).toBeTruthy()
    expect(within(panel).getByText('Mahsulotlar — yonma-yon')).toBeTruthy()
    expect(within(panel).getByText('bx1071484-old')).toBeTruthy()
  })
})

/*
  «Yil 2026»: MoySklad starts on 15.06, so the January–June orders are in
  Bitrix24's FAKT figures and in no comparison. Before the floor they made the
  tiles red and «Toʻliq mos» collapse.
*/
describe('SverkaBody — the «Kassa» tile', () => {
  const tile = () => screen.getByRole('heading', { name: 'Kassa — pul tushgan' }).closest('div')!.parentElement!

  it('sets the delivered money against what MoySklad calls «Касса» and names the remainder', () => {
    render(<SverkaBody data={data} status="ready" />)
    const card = within(tile())
    expect(card.getByText('Kerak · FAKT 2')).toBeTruthy()
    expect(card.getByText('Kassaga tushmagan')).toBeTruthy()
    // 3 200 000 owed, 1 200 000 in the cash desk.
    expect(card.getByText(/1 ta · 2,000,000 soʻm/)).toBeTruthy()
    expect(card.getByText(/«Успешно» \(kassa kutilmoqda\): 1 ta, 600,000 soʻm/)).toBeTruthy()
    expect(card.queryByText(/toʻlov yozilgan/)).toBeNull()
  })

  it('says so when every delivered soʻm is in the cash desk', () => {
    const all = { ...data, totals: { ...data.totals, kassa: { banked: pair.bitrix, awaiting: none, payed: pair.bitrix } } }
    render(<SverkaBody data={all} status="ready" />)
    const card = within(tile())
    expect(card.getByText('toʻliq tushgan')).toBeTruthy()
    expect(card.getByText(/toʻlov yozilgan: 2 ta buyurtma/)).toBeTruthy()
  })
})

describe('SverkaBody — a window reaching back past MoySklad', () => {
  const old = { orders: 2, amount: 3_200_000 }
  const year: SverkaOverviewDto = {
    ...data,
    totals: {
      ...data.totals,
      // One comparable order, matched; two older than MoySklad.
      fakt1: { bitrix: { orders: 3, amount: 4_800_000 }, moysklad: { orders: 1, amount: 1_600_000 }, beforeFloor: old },
      // Every delivered order is older than MoySklad: nothing to compare.
      fakt2: { bitrix: old, moysklad: none, beforeFloor: old },
      clean: 1,
      cohortOrders: 3,
      beforeFloor: old,
    },
    issueCounts: zeroes(),
    issueAmounts: zeroes(),
    lines: [],
    flaggedCount: 0,
  }

  const tile = (label: string) => screen.getByRole('heading', { name: label }).closest<HTMLElement>('.card')!

  it('says from when MoySklad holds orders and how much of the window was left out', () => {
    render(<SverkaBody data={year} status="ready" />)
    const since = formatDate('2026-06-14T19:00:00.000Z')
    const note = screen.getByText(new RegExp(`MoySklad buyurtmalari ${since} dan boshlanadi`)).textContent
    expect(note).toContain('2 ta bitim (3,200,000 soʻm) MoySkladʼda yoʻq')
    // The tiles keep them; the product and ROP tables, which only compare, do not.
    expect(note).toContain('mahsulot hamda ROP jadvallariga kirmadi')
    expect(screen.getByText(/davrda Tasdiqlashga tushgan 1 ta bitim solishtirildi/)).toBeTruthy()
  })

  it('keeps Bitrix24\'s whole figure on the tile and judges only what MoySklad could hold', () => {
    render(<SverkaBody data={year} status="ready" />)
    const fakt1 = tile('FAKT 1 — buyurtmalar')
    expect(fakt1.textContent).toContain('4,800,000')
    expect(within(fakt1).getByText('mos')).toBeTruthy()
    expect(fakt1.textContent).toContain('Bitrix24 dagi 2 tasi (3,200,000 soʻm) MoySklad boshlanishidan oldin tushgan')
    expect(tile('FAKT 2 — yetkazilgan').textContent).toContain('Solishtirilmadi')
    expect(within(tile('FAKT 2 — yetkazilgan')).queryByText('mos')).toBeNull()
  })

  it('takes the older orders out of «Toʻliq mos», as it does the ones still packing', () => {
    render(<SverkaBody data={year} status="ready" />)
    expect(screen.getByText(/boʻlishi kerak boʻlgan 1 ta FAKT 1 buyurtmadan 1 tasi/)).toBeTruthy()
  })
})
