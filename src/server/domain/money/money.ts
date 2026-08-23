/**
 * Money.
 *
 * Framework-free. No Prisma, no React, no Next. Safe to unit test in isolation
 * and safe to lift into a separate service later.
 *
 * WHY BIGINT MINOR UNITS
 * Floating point cannot represent 0.1 exactly, so `0.1 + 0.2 !== 0.3`. Summing
 * thousands of deal amounts as floats accumulates visible error, and a sales
 * dashboard that disagrees with accounting by a few so'm is worthless.
 * Every amount is therefore an integer count of the currency's smallest unit,
 * and arithmetic stays exact end to end. Conversion to a display number happens
 * once, at the very edge, and never feeds back into a calculation.
 */

/** An exact monetary amount: an integer count of minor units, plus its currency. */
export interface Money {
  /** Integer minor units. For UZS, hundredths of a so'm. */
  readonly amountMinor: bigint
  /** ISO 4217 code, uppercase. */
  readonly currency: string
}

/**
 * ISO 4217 minor-unit exponents for the currencies this application handles.
 * Anything absent falls back to 2, which is correct for the overwhelming
 * majority of currencies.
 */
const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = Object.freeze({
  UZS: 2,
  USD: 2,
  EUR: 2,
  RUB: 2,
  KZT: 2,
  JPY: 0,
  KRW: 0,
})

const DEFAULT_EXPONENT = 2

/** `Number.MAX_SAFE_INTEGER` as a bigint, for lossy-conversion guards. */
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)
const MIN_SAFE = -MAX_SAFE

export function currencyExponent(currency: string): number {
  return CURRENCY_EXPONENTS[currency.toUpperCase()] ?? DEFAULT_EXPONENT
}

export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(
      `Cannot combine amounts in different currencies: ${a} and ${b}. ` +
        'Convert to a common currency first.',
    )
    this.name = 'CurrencyMismatchError'
  }
}

export function money(amountMinor: bigint | number, currency: string): Money {
  if (typeof amountMinor === 'number' && !Number.isInteger(amountMinor)) {
    throw new TypeError(
      `money() received a fractional number (${amountMinor}). ` +
        'Amounts must be whole minor units.',
    )
  }
  return Object.freeze({
    amountMinor: BigInt(amountMinor),
    currency: currency.toUpperCase(),
  })
}

export function zeroMoney(currency: string): Money {
  return money(0n, currency)
}

export function isZero(m: Money): boolean {
  return m.amountMinor === 0n
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(a.currency, b.currency)
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return money(a.amountMinor + b.amountMinor, a.currency)
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return money(a.amountMinor - b.amountMinor, a.currency)
}

/**
 * Sum a collection.
 *
 * An empty collection returns zero in `fallbackCurrency` rather than throwing:
 * "this employee closed nothing this month" is a normal state, not an error.
 */
export function sumMoney(values: readonly Money[], fallbackCurrency: string): Money {
  if (values.length === 0) return zeroMoney(fallbackCurrency)

  const currency = values[0]!.currency
  let total = 0n
  for (const value of values) {
    if (value.currency !== currency) {
      throw new CurrencyMismatchError(currency, value.currency)
    }
    total += value.amountMinor
  }
  return money(total, currency)
}

/**
 * Arithmetic mean, rounded half away from zero.
 *
 * Returns null for an empty collection. Null means "undefined", which the UI
 * renders as an em dash — deliberately distinct from a real average of zero.
 */
export function averageMoney(values: readonly Money[]): Money | null {
  if (values.length === 0) return null

  const total = sumMoney(values, values[0]!.currency)
  return divideMoney(total, values.length)
}

/**
 * Divide by a whole number of parts, rounding half away from zero.
 *
 * BigInt division truncates toward zero, which would bias every average
 * downward. This corrects for that explicitly.
 */
export function divideMoney(m: Money, divisor: number): Money {
  if (!Number.isInteger(divisor)) {
    throw new TypeError(`divideMoney expects an integer divisor, got ${divisor}`)
  }
  if (divisor === 0) {
    throw new RangeError('divideMoney: division by zero')
  }

  const d = BigInt(divisor)
  const quotient = m.amountMinor / d
  const remainder = m.amountMinor % d

  // Round half away from zero: bump the magnitude when |remainder| * 2 >= |d|.
  const twiceRemainder = abs(remainder) * 2n
  if (twiceRemainder >= abs(d)) {
    const sign = (m.amountMinor < 0n) !== (d < 0n) ? -1n : 1n
    return money(quotient + sign, m.currency)
  }

  return money(quotient, m.currency)
}

/**
 * Scale by a real-valued ratio (e.g. a 0.15 commission).
 *
 * The ratio is converted to a fixed-point integer first so the multiplication
 * itself never touches floating point.
 */
export function scaleMoney(m: Money, ratio: number, precision = 6): Money {
  if (!Number.isFinite(ratio)) {
    throw new TypeError(`scaleMoney expects a finite ratio, got ${ratio}`)
  }

  const factor = 10 ** precision
  const scaledRatio = BigInt(Math.round(ratio * factor))
  const product = m.amountMinor * scaledRatio

  return divideMoney(money(product, m.currency), factor)
}

function abs(v: bigint): bigint {
  return v < 0n ? -v : v
}

/**
 * Convert to a JavaScript number of MAJOR units, for charts and JSON.
 *
 * Lossy by definition, and one-way: never feed the result back into a
 * calculation. Throws rather than silently corrupting a figure if the amount
 * exceeds the safe integer range.
 */
export function toMajorNumber(m: Money): number {
  if (m.amountMinor > MAX_SAFE || m.amountMinor < MIN_SAFE) {
    throw new RangeError(
      `Amount ${m.amountMinor} exceeds the safe integer range and cannot be ` +
        'converted to a number without losing precision.',
    )
  }
  return Number(m.amountMinor) / 10 ** currencyExponent(m.currency)
}

/** Serialise for transport. Minor units travel as a string so JSON keeps them exact. */
export interface MoneyDto {
  readonly amountMinor: string
  readonly currency: string
  /** Lossy major-unit value, provided for charts and sorting. */
  readonly amount: number
}

export function toMoneyDto(m: Money): MoneyDto {
  return {
    amountMinor: m.amountMinor.toString(),
    currency: m.currency,
    amount: toMajorNumber(m),
  }
}

export function fromMoneyDto(dto: MoneyDto): Money {
  return money(BigInt(dto.amountMinor), dto.currency)
}
