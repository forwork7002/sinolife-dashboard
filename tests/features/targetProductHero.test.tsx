// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { DmBlockDto, DmCellsDto } from '@/features/reklama/reklamaApi'
import { ProductCompare, productVerdicts } from '@/features/target/ProductCompare'
import type { MetaBlockDto, MetaProduct, MetaProductTotalsDto } from '@/features/target/targetApi'
import { usd } from '@/features/target/targetTheme'

/**
 * THE HERO OVER «COLLAGEN VA ZEXTRA» IS THE TWO PRODUCTS' MONEY (2026-10-06).
 *
 * It printed `meta.total` — every account, HR Eldor, Kosmetika Eldor and an
 * unmapped one included — under a label naming the two products, and divided
 * that by the products' own leads for «1 lead». It now prints the products'
 * own total, so it is the sum of the two columns drawn under it; «Лид база»'s
 * Jami keeps every dollar.
 */

afterEach(cleanup)

const money = (amount: number) => ({ amountMinor: String(amount * 100), currency: 'UZS', amount })

function totals(over: Partial<MetaProductTotalsDto>): MetaProductTotalsDto {
  return {
    spendUsd: 0,
    metaLeads: 0,
    metaCplUsd: null,
    impressions: 0,
    clicks: 0,
    ctrPercent: null,
    cpcUsd: null,
    cpmUsd: null,
    bitrixLeads: 0,
    bitrixLeadWon: 0,
    orders: 0,
    ordered: money(0),
    delivered: 0,
    deliveredMoney: money(0),
    returned: 0,
    orderPercent: null,
    buyoutPercent: null,
    costPerBitrixLeadUsd: null,
    costPerOrderUsd: null,
    costPerDeliveredUsd: null,
    roas: null,
    ...over,
  }
}

const product = (name: MetaProduct, over: Partial<MetaProductTotalsDto>) => ({ product: name, ...totals(over) })

const META: MetaBlockDto = {
  importedAt: '2026-10-06T06:00:00Z',
  window: { from: '2026-10-01', to: '2026-10-06' },
  columns: [],
  days: [],
  targetologs: [],
  owners: [],
  products: [
    product('Collagen', { spendUsd: 1_000, bitrixLeads: 800, costPerBitrixLeadUsd: 1.25 }),
    product('Zextra', { spendUsd: 500, bitrixLeads: 200, costPerBitrixLeadUsd: 2.5 }),
    // Kosmetika Eldor and HR Eldor: no product page, so no leads.
    product('Boshqa', { spendUsd: 400 }),
  ],
  total: totals({ spendUsd: 1_900, bitrixLeads: 1_000, costPerBitrixLeadUsd: 1.9 }),
  productsTotal: totals({ spendUsd: 1_500, bitrixLeads: 1_000, costPerBitrixLeadUsd: 1.5 }),
  usdRate: 12_000,
}

describe('ProductCompare — the hero', () => {
  it('prints the two products\' spend and their price of a lead, not every account\'s', () => {
    const { container } = render(<ProductCompare meta={META} status="ready" />)
    expect(screen.getByText('Reklamaga ketgan pul — Collagen va Zextra')).toBeTruthy()
    expect(container.querySelector('.figure-hero')!.textContent).toBe(usd(1_500))
    const line = container.querySelector('.figure-hero')!.nextElementSibling!.textContent ?? ''
    expect(line).toContain(`1 lead ${usd(1.5)}`)
    expect(line).not.toContain(usd(1.9))
  })

  it('names no product when none of them spent, and prints no «what it bought» line under 0 $', () => {
    const { container } = render(
      <ProductCompare meta={{ ...META, products: [product('Boshqa', { spendUsd: 400 })], productsTotal: totals({}) }} status="ready" />,
    )
    expect(screen.getByText('Reklamaga ketgan pul')).toBeTruthy()
    expect(screen.queryByText(/Reklamaga ketgan pul — Boshqa/)).toBeNull()
    // «0 ta Bitrix24 lead» would contradict the Bitrix24 tiles below, which count the pages' real leads.
    expect(container.textContent).not.toContain('ta Bitrix24 lead')
    expect(screen.getByText('Bu davrda Meta akkauntlarida sarf yozilmagan.')).toBeTruthy()
  })
})

const dmCells = (over: Partial<DmCellsDto>): DmCellsDto => ({
  conversations: 0,
  leads: 0,
  qualified: 0,
  spendUsd: 0,
  costPerQualifiedUsd: null,
  qualifiedPercent: null,
  conversationToQualifiedPercent: null,
  costPerConversationUsd: null,
  ...over,
})

/** The DM sheet's per-product sums, as `/target/dm` sends them. */
const DM: DmBlockDto = {
  total: dmCells({}),
  days: [],
  pages: [],
  products: [
    { product: 'Collagen', pages: ['sinolifeuz', 'collagen.sinolife'], ...dmCells({ qualified: 40, spendUsd: 200, costPerQualifiedUsd: 5 }) },
    { product: 'Zextra', pages: ['zextrauzb'], ...dmCells({ qualified: 10, spendUsd: 80, costPerQualifiedUsd: 8 }) },
  ],
  unattributed: { spendUsd: 0, conversations: 0 },
}

describe('ProductCompare — kval (2026-10-07)', () => {
  const withKval: MetaBlockDto = {
    ...META,
    products: [
      product('Collagen', { spendUsd: 1_000, bitrixLeads: 800, bitrixLeadWon: 200, costPerBitrixLeadUsd: 1.25 }),
      product('Zextra', { spendUsd: 500, bitrixLeads: 200, bitrixLeadWon: 50, costPerBitrixLeadUsd: 2.5 }),
    ],
    productsTotal: totals({ spendUsd: 1_500, bitrixLeads: 1_000, bitrixLeadWon: 250, costPerBitrixLeadUsd: 1.5 }),
  }

  it('counts each product\'s kval and prices a DM kval from the DM sheet', () => {
    const { container } = render(<ProductCompare meta={withKval} status="ready" dm={DM} />)
    const line = container.querySelector('.figure-hero')!.nextElementSibling!.textContent ?? ''
    expect(line).toContain('250 kval')
    expect(screen.getAllByText('Kval lidlar')).toHaveLength(2)
    expect(container.textContent).toContain('200 · 25')
    expect(screen.getAllByText('1 kval narxi · DM')).toHaveLength(2)
    expect(screen.getByText(usd(5))).toBeTruthy()
    expect(screen.getByText(usd(8))).toBeTruthy()
    expect(screen.getByTestId('product-verdicts').textContent).toContain(
      `1 DM kval: Collagen ${usd(5)}, Zextra ${usd(8)} — Zextra kvali 1,6 marta qimmat.`,
    )
  })

  it('prints a dash, not a price, for a product with no DM-money page', () => {
    render(<ProductCompare meta={withKval} status="ready" dm={{ ...DM, products: DM.products.slice(0, 1) }} />)
    expect(screen.getByText(usd(5))).toBeTruthy()
    expect(screen.queryByText(usd(8))).toBeNull()
  })

  it('writes no DM sentence without both prices', () => {
    const products = withKval.products.filter((p) => p.product !== 'Boshqa')
    expect(productVerdicts(products, DM.products.slice(0, 1)).join(' ')).not.toContain('DM kval')
  })
})
