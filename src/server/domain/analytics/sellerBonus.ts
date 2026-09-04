/**
 * The client's bonus policy, quoted rather than re-derived.
 *
 * Their published sellers dashboard decides a bonus with two functions and
 * this module is both of them, transcribed:
 *
 *   `bonusInfo(name, fact2)` — the tier ladder, measured on FAKT 2.
 *   `idInRange(name)`        — the gate in front of it.
 *
 * A tier table this consequential does not get re-derived from a screenshot.
 * It is quoted, the source is named, and the screen says whose rule it is.
 */

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

/**
 * From `bonusInfo()` on the client's published dashboard: 45 mln soʻm of won
 * intake earns 1 mln, 60 mln earns 1.5 mln, 70 mln earns 2 mln.
 *
 * DESCENDING, because the reading is "the highest tier whose floor you have
 * cleared" — evaluating ascending would award the first match and pay 1 mln
 * to a seller who earned 2.
 */
export const BONUS_TIERS: readonly { readonly floorMinor: bigint; readonly bonusMinor: bigint }[] =
  Object.freeze([
    { floorMinor: 7_000_000_000n, bonusMinor: 200_000_000n },
    { floorMinor: 6_000_000_000n, bonusMinor: 150_000_000n },
    { floorMinor: 4_500_000_000n, bonusMinor: 100_000_000n },
  ])

// ---------------------------------------------------------------------------
// The gate in front of it
// ---------------------------------------------------------------------------

/**
 * The floor-number band the client's ladder actually pays, inclusive.
 *
 * Their `idInRange()` reads the number trailing the seller's name and pays
 * nothing outside 107–147. On this portal that number is real and it is on
 * every operator: Bitrix24 `user.get` returns names like «Davlatbek Sirojov
 * 115» and «Bonu Umidovna 117», and the same number appears on their board.
 * It is a floor badge, not a Bitrix id — the Bitrix ids for those two people
 * are 6886 and 6890.
 *
 * WHY THIS MATTERS ENOUGH TO CARRY. Without the gate this board pays a bonus
 * to people the client's own page pays nothing, and the ones it invents are
 * not marginal: July's top three (Marjona Shahtiyarovna 197, Sevinchhon
 * Abdullayevna 209, Azizbek Ahatovich 169) all sit outside the band and all
 * clear the top rung. A board that promises 2 mln soʻm to three people who
 * will not be paid it is worse than a board with no bonus column at all.
 */
export const BONUS_BAND = Object.freeze({ from: 107, to: 147 })

/**
 * The floor number trailing an operator's name, or null when there is none.
 *
 * Two to four digits at the end of the string, exactly as their `idInRange()`
 * matches it. Trailing whitespace is tolerated because the portal's own data
 * carries it — `«Sardorbek Abdimurodov 198 »` is a real row.
 */
export function floorNumberOf(fullName: string): number | null {
  const match = /(\d{2,4})\s*$/.exec(fullName)
  if (!match) return null
  const value = Number.parseInt(match[1]!, 10)
  return Number.isFinite(value) ? value : null
}

/**
 * Whether the client's ladder pays this operator at all.
 *
 * A name with no floor number is NOT eligible. That is the client's own
 * behaviour — `idInRange()` returns false when the regex misses — and it is
 * the safe direction: inventing a payment is a worse error than withholding
 * a badge from a row whose name was typed without its number.
 */
export function bonusEligible(fullName: string): boolean {
  const floor = floorNumberOf(fullName)
  return floor !== null && floor >= BONUS_BAND.from && floor <= BONUS_BAND.to
}
