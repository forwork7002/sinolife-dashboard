/**
 * What a typed search term IS — decided once, read by both ends of the wire.
 *
 * The palette decides whether a keystroke is worth a request; the repository
 * decides which columns it may cost. Both used to answer «three characters of
 * anything», and the first three characters of every phone number in the
 * country are «998». Typing one fired a substring match over all 326 859
 * customers at the third digit, again at the fourth, and again at every pause
 * after that — each one queued behind the last on a one-core database — and
 * the eight rows it returned were arbitrary, because a prefix that matches
 * everybody identifies nobody.
 *
 * Two kinds, because people type two things: a NUMBER — a phone, a Bitrix
 * deal id — and TEXT — a name, an order code, a product. A number is compared
 * against id and phone columns only; text against name and title columns
 * only. The other columns cannot hold it, so reading them is pure cost.
 *
 * A number is normalised to its digits: «+998 (90) 123-45-67» and
 * «998901234567» are the same question, and the CRM stores the digits.
 *
 * Client-safe on purpose (no server imports): `Shell` reads it to skip the
 * request, and the message it shows for a short term is the same rule the
 * server applies.
 */

export type SearchTermKind = 'number' | 'text'

export interface SearchTerm {
  readonly kind: SearchTermKind
  /** What the SQL compares against: the digits of a number, the trimmed text. */
  readonly needle: string
  /** `empty` — nothing typed; `short` — not enough to look up; `ok`. */
  readonly status: 'empty' | 'short' | 'ok'
}

/** Below this a trigram index cannot help, and the answer is too broad to read. */
export const MIN_TEXT = 3
/**
 * Every Uzbek number starts «998», and the operator code after it is one of a
 * dozen — four digits still match a sixth of the table. Five is where a
 * prefix starts to mean somebody.
 */
export const MIN_DIGITS = 5

/** A term that is a number written the way people write numbers. */
const NUMBER_SHAPE = /^\+?[\d\s()\-]+$/

export function classifySearchTerm(raw: string): SearchTerm {
  const text = raw.trim()
  if (text.length === 0) return { kind: 'text', needle: '', status: 'empty' }

  if (NUMBER_SHAPE.test(text)) {
    const needle = text.replace(/\D/g, '')
    if (needle.length > 0) {
      return { kind: 'number', needle, status: needle.length >= MIN_DIGITS ? 'ok' : 'short' }
    }
  }

  return { kind: 'text', needle: text, status: text.length >= MIN_TEXT ? 'ok' : 'short' }
}

/** The one-line reason a term was not looked up, for the empty state. */
export function shortTermHint(term: SearchTerm): string | null {
  if (term.status !== 'short') return null
  return term.kind === 'number'
    ? `Kamida ${MIN_DIGITS} ta raqam yozing`
    : `Kamida ${MIN_TEXT} ta harf yozing`
}
