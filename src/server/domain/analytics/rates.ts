/**
 * Rates, and the one rule they all obey: an empty denominator is NULL.
 *
 * WHY THIS IS IN `domain` AND NOT BESIDE THE QUERIES THAT USE IT. These three
 * are pure arithmetic, and the services need them as much as the repositories
 * do — `insightsService` divides money the SQL deliberately left un-divided.
 * Importing them from `insightsRepository` would work at compile time and be
 * wrong at runtime: that module reads `env` at import scope, so a value import
 * pulls the whole configuration into anything that touches a rate, and three
 * service tests that had never needed a DATABASE_URL started failing on one.
 * The domain layer imports no framework and no config, which is exactly what
 * makes it the right home.
 */

/**
 * Basis points, or NULL when there is nothing to divide by.
 *
 * Null, not zero. A carrier whose every order is still in transit has no
 * delivery rate yet; returning 0 states that it delivers nothing, which is a
 * confident claim about something nobody knows. The same applies to an
 * operator with no decided orders and a channel with no leads. The DTO layer
 * carries the null through and the Meter renders an em dash, which is the
 * whole point of having three renderings for loading, failure and a genuine
 * absence — a zero manufactured this deep made the third one unreachable.
 */
export function rateBp(numerator: number, denominator: number): number | null {
  // Deliberately NOT rounded to whole basis points. `pct` rounds it again for
  // display, and rounding twice moved Namangan's 86/101 from 85.1% to 85.2% —
  // small, except the tone thresholds sit at 85 and 60.
  return denominator === 0 ? null : (numerator / denominator) * 10_000
}

/**
 * Delivery rate over RESOLVED orders, not over every order in the window.
 *
 * Half of any current month is still in transit. Dividing by the whole month
 * reported 42% for a business that actually delivers 93% of what it dispatches
 * — a number that would start a fire in the wrong department. The orders still
 * moving are reported separately as `inFlight`, where they belong.
 *
 * `cancelledEarly` counts against the rate. Bitrix24 leaves those deals with
 * an OPEN semantic because `Отказ предварительно` is not one of its terminal
 * stages, but a customer who cancelled before dispatch is not still on its way
 * anywhere, and leaving them in the denominator's numerator-free middle would
 * flatter the figure indefinitely.
 */
export function deliveryRateBp(
  delivered: number,
  refused: number,
  cancelledEarly: number,
): number | null {
  return rateBp(delivered, delivered + refused + cancelledEarly)
}

/**
 * The same rule as `rateBp`, for a numerator and denominator in minor units.
 *
 * NOT `rateBp(Number(a), Number(b))`. A UZS total passes 2^53 at ninety
 * billion soʻm, which is why every money sum crosses the driver as text and
 * arrives as a BigInt — converting to `number` to divide would throw the
 * precision away at exactly the scale this dashboard reports at. The ratio is
 * taken in BigInt, scaled by a million first so the result keeps
 * sub-basis-point precision, and deliberately not rounded: `pct` rounds it
 * again for display and rounding twice moves a figure across a tone threshold.
 *
 * Null over an empty denominator, for the reason `rateBp` gives.
 */
export function moneyRateBp(numerator: bigint, denominator: bigint): number | null {
  if (denominator === 0n) return null
  return Number((numerator * 1_000_000n) / denominator) / 100
}
