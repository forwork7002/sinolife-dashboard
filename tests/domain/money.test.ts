import { describe, expect, it } from 'vitest'

import {
  CurrencyMismatchError,
  addMoney,
  averageMoney,
  currencyExponent,
  divideMoney,
  fromMoneyDto,
  money,
  scaleMoney,
  subtractMoney,
  sumMoney,
  toMajorNumber,
  toMoneyDto,
  zeroMoney,
} from '@/server/domain/money/money'

const UZS = 'UZS'

describe('money construction', () => {
  it('normalises the currency code to uppercase', () => {
    expect(money(100n, 'uzs').currency).toBe('UZS')
  })

  it('rejects fractional numeric input', () => {
    expect(() => money(10.5, UZS)).toThrow(TypeError)
  })

  it('accepts integer numbers and bigints alike', () => {
    expect(money(500, UZS).amountMinor).toBe(500n)
    expect(money(500n, UZS).amountMinor).toBe(500n)
  })
})

describe('exact arithmetic', () => {
  it('does not accumulate floating point error across many additions', () => {
    // The float equivalent of this loop drifts; the bigint version cannot.
    const values = Array.from({ length: 10_000 }, () => money(10n, UZS))
    const total = sumMoney(values, UZS)
    expect(total.amountMinor).toBe(100_000n)
  })

  it('represents the classic 0.1 + 0.2 case exactly', () => {
    const sum = addMoney(money(10n, UZS), money(20n, UZS))
    expect(sum.amountMinor).toBe(30n)
    expect(toMajorNumber(sum)).toBe(0.3)
  })

  it('subtracts into negative territory', () => {
    expect(subtractMoney(money(100n, UZS), money(250n, UZS)).amountMinor).toBe(-150n)
  })

  it('refuses to combine different currencies', () => {
    expect(() => addMoney(money(1n, 'UZS'), money(1n, 'USD'))).toThrow(
      CurrencyMismatchError,
    )
    expect(() => sumMoney([money(1n, 'UZS'), money(1n, 'USD')], 'UZS')).toThrow(
      CurrencyMismatchError,
    )
  })
})

describe('empty and zero cases', () => {
  it('sums an empty collection to zero in the fallback currency', () => {
    const total = sumMoney([], UZS)
    expect(total.amountMinor).toBe(0n)
    expect(total.currency).toBe(UZS)
  })

  it('returns null for the average of nothing, not zero', () => {
    // "No deals closed" must stay distinguishable from "average deal is 0".
    expect(averageMoney([])).toBeNull()
  })

  it('averages a real collection', () => {
    const avg = averageMoney([money(100n, UZS), money(200n, UZS), money(300n, UZS)])
    expect(avg?.amountMinor).toBe(200n)
  })
})

describe('rounding', () => {
  it('rounds half away from zero rather than truncating', () => {
    // 10 / 4 = 2.5 -> 3, not 2. Truncation would bias every average downward.
    expect(divideMoney(money(10n, UZS), 4).amountMinor).toBe(3n)
    expect(divideMoney(money(-10n, UZS), 4).amountMinor).toBe(-3n)
  })

  it('rounds below the halfway point downward', () => {
    expect(divideMoney(money(9n, UZS), 4).amountMinor).toBe(2n)
  })

  it('averages three-way splits without losing a unit', () => {
    expect(averageMoney([money(1n, UZS), money(1n, UZS), money(2n, UZS)])?.amountMinor).toBe(1n)
  })

  it('rejects division by zero', () => {
    expect(() => divideMoney(money(10n, UZS), 0)).toThrow(RangeError)
  })
})

describe('scaling', () => {
  it('applies a percentage without touching floating point in the product', () => {
    // 15% commission on 1 000 000.00 UZS
    const commission = scaleMoney(money(100_000_000n, UZS), 0.15)
    expect(commission.amountMinor).toBe(15_000_000n)
  })

  it('rejects a non-finite ratio', () => {
    expect(() => scaleMoney(money(100n, UZS), Number.NaN)).toThrow(TypeError)
  })
})

describe('currency exponents', () => {
  it('knows UZS has two minor digits', () => {
    expect(currencyExponent('UZS')).toBe(2)
  })

  it('knows JPY has none', () => {
    expect(currencyExponent('JPY')).toBe(0)
    expect(toMajorNumber(money(500n, 'JPY'))).toBe(500)
  })

  it('defaults unknown currencies to two', () => {
    expect(currencyExponent('XYZ')).toBe(2)
  })
})

describe('transport', () => {
  it('round-trips through the DTO without loss', () => {
    // A realistic large SinoLife figure: 340 000 000.00 so'm
    const original = money(34_000_000_000n, UZS)
    const restored = fromMoneyDto(toMoneyDto(original))
    expect(restored.amountMinor).toBe(original.amountMinor)
    expect(restored.currency).toBe(original.currency)
  })

  it('carries minor units as a string so JSON stays exact', () => {
    expect(toMoneyDto(money(34_000_000_000n, UZS)).amountMinor).toBe('34000000000')
  })

  it('refuses to produce a number that would silently lose precision', () => {
    const huge = money(BigInt(Number.MAX_SAFE_INTEGER) + 1n, UZS)
    expect(() => toMajorNumber(huge)).toThrow(RangeError)
  })
})

describe('zeroMoney', () => {
  it('is additive identity', () => {
    const value = money(12_345n, UZS)
    expect(addMoney(value, zeroMoney(UZS)).amountMinor).toBe(value.amountMinor)
  })
})
