/**
 * Revenue concentration: Pareto and Herfindahl–Hirschman arithmetic.
 *
 * Pure and framework-free, like the rest of the domain layer. The grouping —
 * revenue per customer, per source, per region — runs in SQL
 * (`ConcentrationRepository`); every rule that turns those groups into a
 * concentration CLAIM lives here, where it can be unit tested without a
 * database: what share the top customers hold, how many customers carry 80%
 * of the money, and when a Herfindahl index counts as "concentrated".
 *
 * Everything works on BigInt minor units and divides as late as possible, so
 * the shares of a ninety-billion-soʻm month are computed exactly and only the
 * final display number is a float.
 */

// ---------------------------------------------------------------------------
// Pareto
// ---------------------------------------------------------------------------

export interface ParetoSummary {
  /** Share of total revenue held by the 5 largest groups, 0-100. */
  readonly top5SharePercent: number | null
  /** Share of total revenue held by the 10 largest groups, 0-100. */
  readonly top10SharePercent: number | null
  /** Smallest N such that the N largest groups cover 80% of revenue. */
  readonly customersFor80Percent: number | null
  /** Every group in the distribution, including zero-revenue ones. */
  readonly totalCustomers: number
}

/** The Pareto question is always asked against this threshold. */
export const PARETO_COVERAGE_PERCENT = 80

/**
 * Share of the total held by the `n` largest entries, in percent.
 *
 * With fewer than `n` entries the answer is simply 100 — five customers hold
 * "the top ten's" share by holding everything — which is a fact, not an edge
 * case to hide behind a null. Null is reserved for a total of zero, where a
 * share genuinely does not exist.
 *
 * The division is scaled through BigInt (1e6) before the one conversion to
 * float, so a month whose total exceeds 2^53 minor units still reports an
 * exact share.
 */
export function topShareOfTotalPercent(
  revenuesMinor: readonly bigint[],
  n: number,
): number | null {
  if (!Number.isInteger(n) || n <= 0) return null

  const sorted = sortDescending(revenuesMinor)
  const total = sum(sorted)
  if (total <= 0n) return null

  const top = sum(sorted.slice(0, n))
  return Number((top * 1_000_000n) / total) / 10_000
}

/**
 * How many of the largest groups it takes to cover `coveragePercent` of the
 * total. The classic Pareto reading: 80% of revenue in how few hands?
 *
 * Cumulative comparison stays in BigInt (`cum * 100 >= total * coverage`), so
 * the boundary is exact — no float epsilon can move a customer across it.
 */
export function countForCoverage(
  revenuesMinor: readonly bigint[],
  coveragePercent: number = PARETO_COVERAGE_PERCENT,
): number | null {
  if (!Number.isFinite(coveragePercent) || coveragePercent <= 0 || coveragePercent > 100) {
    return null
  }

  const sorted = sortDescending(revenuesMinor)
  const total = sum(sorted)
  if (total <= 0n) return null

  const coverage = BigInt(Math.round(coveragePercent))
  let cumulative = 0n
  for (let index = 0; index < sorted.length; index++) {
    cumulative += sorted[index]!
    if (cumulative * 100n >= total * coverage) return index + 1
  }

  // Unreachable with a coverage <= 100 and a positive total, but the type
  // system cannot know that the loop always crosses the threshold.
  return sorted.length
}

/**
 * The whole Pareto card in one call.
 *
 * `totalCustomers` counts every group handed in — a customer whose wins sum
 * to zero soʻm (a giveaway order) is still a customer the period served, and
 * dropping them would quietly shrink the denominator the shares are read
 * against. Zero-revenue groups sort last and never enter a top-N sum, so the
 * shares themselves are unaffected.
 */
export function pareto(revenuesMinor: readonly bigint[]): ParetoSummary {
  return {
    top5SharePercent: topShareOfTotalPercent(revenuesMinor, 5),
    top10SharePercent: topShareOfTotalPercent(revenuesMinor, 10),
    customersFor80Percent: countForCoverage(revenuesMinor),
    totalCustomers: revenuesMinor.length,
  }
}

// ---------------------------------------------------------------------------
// Herfindahl–Hirschman index
// ---------------------------------------------------------------------------

/**
 * HHI band thresholds, in index points (a share of 100% squared = 10 000).
 *
 * These are the DOJ/FTC merger-guideline bands, which is why they are stated
 * as constants rather than invented: above 2 500 a market is "highly
 * concentrated", between 1 500 and 2 500 "moderately concentrated", below
 * 1 500 "unconcentrated" — here rendered diversified. The boundaries belong
 * to the more alarming band (exactly 2 500 reads concentrated): a threshold
 * exists to raise a hand, and a tie should not lower it.
 */
export const HHI_CONCENTRATED_BP = 2_500
export const HHI_MODERATE_BP = 1_500

export type HhiBand = 'concentrated' | 'moderate' | 'diversified'

/**
 * The Herfindahl–Hirschman index over one revenue cut, in index points.
 *
 * HHI = Σ sᵢ² where sᵢ is each group's percent share; a monopoly scores
 * 10 000, ten equal channels score 1 000. Computed as Σrᵢ²·10⁴ / T² entirely
 * in BigInt — squaring first and dividing once — because squaring a rounded
 * per-group share would compound the rounding across every group.
 *
 * Null when the cut has no revenue: an index over nothing is not "perfectly
 * diversified", it is unmeasured. Non-positive groups are excluded — a group
 * that produced no money holds no share of it.
 */
export function hhiBp(revenuesMinor: readonly bigint[]): number | null {
  const positive = revenuesMinor.filter((value) => value > 0n)
  const total = sum(positive)
  if (total <= 0n) return null

  const sumOfSquares = positive.reduce((acc, value) => acc + value * value, 0n)
  return Number((sumOfSquares * 10_000n) / (total * total))
}

/** The plain-language reading of an HHI score. See the threshold note above. */
export function hhiBand(bp: number): HhiBand {
  if (bp >= HHI_CONCENTRATED_BP) return 'concentrated'
  if (bp >= HHI_MODERATE_BP) return 'moderate'
  return 'diversified'
}

// ---------------------------------------------------------------------------
// Repeat purchase
// ---------------------------------------------------------------------------

/**
 * The fixed horizon for "did the first-time buyer come back".
 *
 * One constant, imported by the repository and passed into SQL as a
 * parameter, so the cohort shift and the repurchase window can never drift
 * apart: the repurchase rate is only honest when every cohort member has had
 * the FULL horizon to come back, which is why the cohort is first purchases
 * in the period shifted back by exactly this many days.
 */
export const REPURCHASE_HORIZON_DAYS = 90

// ---------------------------------------------------------------------------

function sortDescending(values: readonly bigint[]): bigint[] {
  return [...values].sort((a, b) => (a === b ? 0 : a > b ? -1 : 1))
}

function sum(values: readonly bigint[]): bigint {
  return values.reduce((acc, value) => acc + value, 0n)
}
