// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ProductCompare } from '@/features/target/ProductCompare'
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

  it('names no product when none of them spent', () => {
    render(<ProductCompare meta={{ ...META, products: [product('Boshqa', { spendUsd: 400 })], productsTotal: totals({}) }} status="ready" />)
    expect(screen.getByText('Reklamaga ketgan pul')).toBeTruthy()
    expect(screen.queryByText(/Reklamaga ketgan pul — Boshqa/)).toBeNull()
  })
})
