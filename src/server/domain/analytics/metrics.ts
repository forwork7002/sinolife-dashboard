/**
 * Core metric primitives: growth, ratios, conversion.
 *
 * Framework-free and fully deterministic — every function here is a pure
 * function of its arguments, which is what makes the analytics engine testable
 * without a database.
 *
 * THE POINT OF THIS FILE
 * Dashboards get these wrong in the same handful of ways every time: dividing
 * by a zero baseline and rendering `+Infinity%`, treating "no data" as zero and
 * reporting a confident -100%, or letting a negative baseline flip the sign of
 * a change. Each of those is a number a manager could act on, and each is
 * wrong. So the outcome is modelled as a discriminated union instead of a bare
 * number, and the UI is forced to handle every case explicitly.
 */

/** Result of comparing a current period against its previous equivalent. */
export type Delta =
  /** Both periods have data and the value moved. */
  | { readonly kind: 'change'; readonly percent: number; readonly direction: 'up' | 'down' }
  /** Both periods have data and the value is identical. */
  | { readonly kind: 'unchanged' }
  /**
   * The previous period was zero. A percentage change is mathematically
   * undefined here — "grew by infinity percent" is not a fact. The UI shows
   * "new" rather than a number.
   */
  | { readonly kind: 'no_baseline'; readonly current: number }
  /**
   * The baseline was non-zero but too small to divide by meaningfully.
   *
   * On a 288-person leaderboard, 43 of the 60 rows rendering as a multiple had
   * a baseline of three closed deals or fewer, and 25 of exactly one. One
   * 900,000 soʻm deal last month against a normal month this month printed
   * «↑×153» and sorted that person above everyone who actually sells. The
   * ratio was arithmetically correct and told the reader nothing except that
   * the denominator was small.
   *
   * Both sides travel so the UI can show the pair instead of a number that
   * only looks like a measurement.
   */
  | { readonly kind: 'small_base'; readonly current: number; readonly previous: number }
  /** One or both periods have no data at all. Distinct from a value of zero. */
  | { readonly kind: 'no_data' }

export type Numeric = number | bigint

function toNumber(value: Numeric): number {
  return typeof value === 'bigint' ? Number(value) : value
}

/**
 * Percentage change from `previous` to `current`.
 *
 * The denominator is |previous|, so a recovery from -100 to -50 reads as an
 * improvement rather than as a decline.
 */
/**
 * Below this, a baseline is treated as too thin to divide by.
 *
 * Expressed as a fraction of the CURRENT value rather than an absolute, so it
 * works for soʻm and for deal counts without a unit-specific threshold: if the
 * previous period is under a twentieth of this one, the resulting ratio is
 * driven by how small the denominator was, not by how much the numerator grew.
 * Twenty is a round number chosen to sit above the ×5 range that real growth
 * reaches and below the ×20+ range that only tiny baselines produce.
 */
const SMALL_BASE_RATIO = 20

export function growth(
  current: Numeric | null | undefined,
  previous: Numeric | null | undefined,
): Delta {
  if (current === null || current === undefined) return { kind: 'no_data' }
  if (previous === null || previous === undefined) return { kind: 'no_data' }

  const c = toNumber(current)
  const p = toNumber(previous)

  if (!Number.isFinite(c) || !Number.isFinite(p)) return { kind: 'no_data' }

  if (p === 0) {
    return c === 0 ? { kind: 'unchanged' } : { kind: 'no_baseline', current: c }
  }

  if (c === p) return { kind: 'unchanged' }

  // Growth only. A shrinking value has a large denominator by definition, and
  // a fall from a big base is exactly the signal nobody wants suppressed.
  if (c > 0 && p > 0 && c / p >= SMALL_BASE_RATIO) {
    return { kind: 'small_base', current: c, previous: p }
  }

  const percent = ((c - p) / Math.abs(p)) * 100

  return {
    kind: 'change',
    percent,
    direction: percent >= 0 ? 'up' : 'down',
  }
}

/**
 * A proportion of a whole, as a percentage in [0, 100] unless the inputs
 * legitimately exceed it.
 *
 * Returns null when the denominator is zero — "0 of 0 deals converted" has no
 * meaningful rate, and reporting 0% would claim a failure that never happened.
 */
export function ratePercent(
  part: Numeric | null | undefined,
  total: Numeric | null | undefined,
): number | null {
  if (part === null || part === undefined) return null
  if (total === null || total === undefined) return null

  const p = toNumber(part)
  const t = toNumber(total)

  if (!Number.isFinite(p) || !Number.isFinite(t)) return null
  if (t === 0) return null

  return (p / t) * 100
}

/**
 * Conversion rate: won deals as a share of all *resolved* deals.
 *
 * Deals still open are excluded from the denominator on purpose. Including
 * them would make conversion sag every time the team opens new opportunities,
 * which reads as a performance drop caused by doing more work.
 */
export function conversionRate(won: number, lost: number): number | null {
  if (!Number.isInteger(won) || !Number.isInteger(lost)) return null
  if (won < 0 || lost < 0) return null

  return ratePercent(won, won + lost)
}

/** Basis points (10000 = 100.00%). Used wherever a rate is persisted. */
export function toBasisPoints(percent: number | null): number | null {
  if (percent === null || !Number.isFinite(percent)) return null
  return Math.round(percent * 100)
}

export function fromBasisPoints(bp: number | null): number | null {
  if (bp === null || !Number.isFinite(bp)) return null
  return bp / 100
}

/**
 * Round a percentage for display. Keeps one decimal, which is the most
 * precision a period-over-period figure can honestly carry.
 */
export function roundPercent(value: number, decimals = 1): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** Transport shape for a Delta. Percent is pre-rounded for display. */
export type DeltaDto =
  | { readonly kind: 'change'; readonly percent: number; readonly direction: 'up' | 'down' }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'no_baseline' }
  /** Ratio suppressed; both sides travel so the UI can state the pair. */
  | { readonly kind: 'small_base'; readonly current: number; readonly previous: number }
  | { readonly kind: 'no_data' }

export function toDeltaDto(delta: Delta): DeltaDto {
  switch (delta.kind) {
    case 'change':
      return {
        kind: 'change',
        percent: roundPercent(delta.percent),
        direction: delta.direction,
      }
    case 'unchanged':
      return { kind: 'unchanged' }
    case 'no_baseline':
      return { kind: 'no_baseline' }
    case 'small_base':
      return { kind: 'small_base', current: delta.current, previous: delta.previous }
    case 'no_data':
      return { kind: 'no_data' }
  }
}
