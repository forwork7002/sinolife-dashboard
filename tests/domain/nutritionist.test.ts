import { describe, expect, it } from 'vitest'

import { NUTRITIONIST_BRANDS, NUTRITIONIST_USD_PER_ORDER, nutritionistPay } from '@/server/domain/sverka/nutritionist'

const pair = (bitrix: number, moysklad: number) => ({
  bitrix: { orders: bitrix, amountMinor: 0n },
  moysklad: { orders: moysklad, amountMinor: 0n },
  beforeFloor: { orders: 0, amountMinor: 0n },
})

const empty = { fakt1: pair(0, 0), fakt2: pair(0, 0) }

describe('nutritionistPay', () => {
  it('prices each count at the rate — the client\'s «100 × 2 $ = 200 $»', () => {
    const out = nutritionistPay({ Collagen: { fakt1: pair(100, 98), fakt2: pair(60, 61) }, Zextra: empty })
    expect(NUTRITIONIST_USD_PER_ORDER).toBe(2)
    expect(out.brands[0].fakt1).toEqual({ bitrix: 100, moysklad: 98, bitrixUsd: 200, moyskladUsd: 196 })
    expect(out.brands[0].fakt2).toEqual({ bitrix: 60, moysklad: 61, bitrixUsd: 120, moyskladUsd: 122 })
  })

  it('prints Collagen, then Zextra, each off its own totals at the one rate', () => {
    const out = nutritionistPay({ Collagen: { fakt1: pair(10, 9), fakt2: pair(5, 5) }, Zextra: { fakt1: pair(7, 7), fakt2: pair(3, 2) } })
    expect(NUTRITIONIST_BRANDS).toEqual(['Collagen', 'Zextra'])
    expect(out.brands.map((b) => b.brand)).toEqual(['Collagen', 'Zextra'])
    expect(out.brands[1].fakt1).toEqual({ bitrix: 7, moysklad: 7, bitrixUsd: 14, moyskladUsd: 14 })
    expect(out.brands[1].fakt2).toEqual({ bitrix: 3, moysklad: 2, bitrixUsd: 6, moyskladUsd: 4 })
  })

  it('reads an empty window as zero dollars, not as missing', () => {
    const out = nutritionistPay({ Collagen: empty, Zextra: empty })
    expect(out.brands).toHaveLength(2)
    expect(out.brands[1].fakt2).toEqual({ bitrix: 0, moysklad: 0, bitrixUsd: 0, moyskladUsd: 0 })
  })
})
