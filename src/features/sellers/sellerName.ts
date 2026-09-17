/**
 * A seller's portal name, split into the NAME and the seller's CODE token.
 *
 * The portal carries each seller's desk number inside the full name, and not
 * in one place: «268 Ozoda Yuldosheva», «Shahtiyarovna 197 Marjona»,
 * «Raxmatullayeva 253 Ruxshona Tolib qizi». The board prints the code as a
 * quiet token after the name (EFIR Premium spec §2, §4, §5) — and drops it
 * before the name ellipsises — so every place that shows a name reads it
 * through this one function rather than guessing the shape itself.
 *
 * THE RULE (delta 10a). `code` is the FIRST all-digit token of 2–4 digits,
 * taken only when a non-digit token remains after it is removed. Everything
 * else stays in the name, in its order: «(stajor)», a second number, a
 * Cyrillic name with no code at all. A name that is only a number keeps the
 * number as its name — a row is never left nameless.
 */
export interface SellerName {
  /** The name without the code token, single-spaced. */
  readonly name: string
  /** The 2–4 digit desk code, or `null` when the name carries none. */
  readonly code: string | null
}

const CODE = /^\d{2,4}$/
const DIGITS = /^\d+$/

export function parseSellerName(raw: string): SellerName {
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  const at = tokens.findIndex((token) => CODE.test(token))
  if (at === -1) return { name: tokens.join(' '), code: null }

  const rest = tokens.filter((_, i) => i !== at)
  if (!rest.some((token) => !DIGITS.test(token))) return { name: tokens.join(' '), code: null }

  return { name: rest.join(' '), code: tokens[at]! }
}
