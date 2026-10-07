/**
 * Revenue concentration: Pareto arithmetic and the repurchase horizon.
 *
 * Pure and framework-free, like the rest of the domain layer. The grouping —
 * revenue per customer — runs in SQL (`ConcentrationRepository`); every rule
 * that turns those groups into a concentration CLAIM lives here, where it can
 * be unit tested without a database: what share the top customers hold and
 * how many customers carry 80% of the money.
 *
 * THE HERFINDAHL INDEX WENT ON 2026-10-06. Its two cuts — by source and by
 * region — were drawn as verdict chips on the channels page until 8ca99c6
 * (2026-08-29) and read by nothing after it, while `/insights/concentration`
 * kept paying two revenue scans per request for them. Bring them back with a
 * reader, not before.
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
const PARETO_COVERAGE_PERCENT = 80

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
