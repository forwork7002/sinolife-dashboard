/**
 * Split a whole number in proportion to weights so the parts sum to it
 * EXACTLY — the largest-remainder method.
 *
 * «Registratsiya» needs it twice and on both sides of the wire: 900 leads
 * split 15 / 15 / 15 / 20 / 22 / 13 % must print parts that add up to 900
 * (rounding each alone can give 899 or 901 under a row that says 900), and
 * leads typed «Sonda» must become shares that add up to exactly 100 %. Ties
 * go to the earlier weight, so the answer is stable for a given input.
 *
 * Client-safe: no server imports.
 */
export function apportion(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, w) => a + Math.max(0, w), 0)
  if (total <= 0 || sum <= 0) return weights.map(() => 0)
  const exact = weights.map((w) => (Math.max(0, w) / sum) * total)
  const parts = exact.map(Math.floor)
  let left = total - parts.reduce((a, p) => a + p, 0)
  const order = exact.map((x, i) => ({ i, rest: x - Math.floor(x) })).sort((a, b) => b.rest - a.rest || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    parts[i]! += 1
    left -= 1
  }
  return parts
}
