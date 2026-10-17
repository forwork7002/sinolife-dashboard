import { describe, expect, it } from 'vitest'

import { NUTRITIONIST_USD_PER_ORDER, nutritionistPay } from '@/server/domain/sverka/nutritionist'

const pair = (bitrix: number, moysklad: number) => ({
  bitrix: { orders: bitrix, amountMinor: 0n },
  moysklad: { orders: moysklad, amountMinor: 0n },
  beforeFloor: { orders: 0, amountMinor: 0n },
})

describe('nutritionistPay', () => {
  it('prices each count at the rate — the client\'s «100 × 2 $ = 200 $»', () => {
    const out = nutritionistPay({ fakt1: pair(100, 98), fakt2: pair(60, 61) })
    expect(NUTRITIONIST_USD_PER_ORDER).toBe(2)
    expect(out.fakt1).toEqual({ bitrix: 100, moysklad: 98, bitrixUsd: 200, moyskladUsd: 196 })
    expect(out.fakt2).toEqual({ bitrix: 60, moysklad: 61, bitrixUsd: 120, moyskladUsd: 122 })
  })

  it('reads an empty window as zero dollars, not as missing', () => {
    expect(nutritionistPay({ fakt1: pair(0, 0), fakt2: pair(0, 0) }).fakt2).toEqual({ bitrix: 0, moysklad: 0, bitrixUsd: 0, moyskladUsd: 0 })
  })
})
