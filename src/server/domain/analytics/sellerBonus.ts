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
 * Their `idInRange()` reads the seller's floor number and pays nothing
 * outside 107–147. On this portal that number is real: Bitrix24 `user.get`
 * returns names like «Davlatbek Sirojov 115» and «Bonu Umidovna 117», and the
 * same number appears on their board. It is a floor badge, not a Bitrix id —
 * the Bitrix ids for those two people are 6886 and 6890. Where the number
 * sits inside OUR `fullName` is a separate question; see `floorNumberOf`.
 *
 * Measured on production 2026-09-04: 237 of 289 employees carry a floor
 * number and 55 of them fall inside the band.
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
 * The floor number somewhere in an operator's name, or null when there is none.
 *
 * ANYWHERE, NOT AT THE END, and the difference is the whole rule. Their
 * `idInRange()` anchors at the end because their board prints «Marjona
 * Xayrullayeva 154» — Bitrix24's `NAME` then `LAST_NAME`, and the portal
 * keeps the number on the LAST_NAME. This application composes `fullName` the
 * other way round, so the very same person is stored «Xayrullayeva 154
 * Marjona» and the number lands in the MIDDLE. Measured on production
 * 2026-09-04 over all 289 employees: 90 names carry it first, 16 last, 237
 * carry it somewhere, and an end-anchored regex matched 16 — which gated all
 * but three people out of a bonus they are owed.
 *
 * EXACTLY ONE standalone 2–4 digit token, or nothing. That is the rule
 * `marketingService.employeeCode()` already uses to pair these same people
 * against the Roistat sheet, proven there against a 24 541-row import; two
 * numbers in one name is an ambiguity, not a match, and today there are none.
 *
 * Separators are not always spaces — «130-Salomat Shoimova» is a real row —
 * so anything that is not a letter or a digit splits.
 */
export function floorNumberOf(fullName: string): number | null {
  const digits = fullName
    .replace(/[^0-9\p{L}]+/gu, ' ')
    .split(' ')
    .filter((token) => /^\d{2,4}$/.test(token))

  if (digits.length !== 1) return null
  const value = Number.parseInt(digits[0]!, 10)
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
