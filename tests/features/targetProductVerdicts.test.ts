import { describe, expect, it } from 'vitest'

import { productVerdicts } from '@/features/target/ProductCompare'

const money = (amount: number) => ({ amountMinor: String(amount * 100), currency: 'UZS', amount })

function product(name: 'Collagen' | 'Zextra', over: Record<string, unknown>) {
  return {
    product: name,
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
  } as Parameters<typeof productVerdicts>[0][number]
}

describe('productVerdicts — the comparison in sentences', () => {
  // August 2026's Meta spend with the leads its pages brought (test figures).
  const collagen = product('Collagen', {
    spendUsd: 24_388,
    bitrixLeads: 1_994,
    costPerBitrixLeadUsd: 12.23,
    costPerOrderUsd: 55.05,
    roas: 1.29,
  })
  const zextra = product('Zextra', {
    spendUsd: 20_531,
    bitrixLeads: 353,
    costPerBitrixLeadUsd: 58.16,
    costPerOrderUsd: 266.63,
    roas: 0.26,
  })

  it('names the product that eats more than it brings', () => {
    expect(productVerdicts([collagen, zextra])[0]).toBe(
      'Zextra reklama pulining 46%ini oladi, lekin leadlarning 15%ini beradi.',
    )
  })

  it('states the price of a lead and how many times dearer', () => {
    expect(productVerdicts([collagen, zextra])[1]).toBe(
      '1 lead: Collagen 12.23 $, Zextra 58.16 $ — Zextra leadi 4,8 marta qimmat.',
    )
  })

  it('says which advertising does not pay for itself', () => {
    expect(productVerdicts([collagen, zextra]).at(-1)).toBe(
      'Collagen har 1 $ ga 1,29 $ tushum, Zextra har 1 $ ga 0,26 $ tushum qaytaryapti — Zextra reklamasi hozircha oʻzini qoplamayapti.',
    )
  })

  it('writes nothing it cannot support — no second product, no sentence', () => {
    expect(productVerdicts([collagen])).toEqual([])
    const bare = productVerdicts([product('Collagen', { spendUsd: 10 }), product('Zextra', { spendUsd: 5 })])
    expect(bare).toEqual([])
  })
})
