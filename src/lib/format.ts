/**
 * Display formatting.
 *
 * Client-safe: no server imports. Everything here is presentation only — never
 * arithmetic. Money arrives from the API already exact; these functions turn it
 * into text and must not be used to compute anything.
 */

/**
 * Numbers are formatted from FIXED separators, not from a locale's CLDR data.
 *
 * `Intl.NumberFormat('uz-UZ')` does not agree with itself across the two
 * engines this application runs in. Measured on this machine, the same call
 * with the same input returns:
 *
 *   Node 24 (the server)   1 234 567,8   — space groups, comma decimal
 *   Chromium (the client)  1,234,567.8   — comma groups, dot decimal
 *
 * Both resolve the locale to `uz-UZ` and then ship different data for it. Any
 * number rendered on the server and hydrated on the client therefore mismatches
 * — React discards that subtree and re-renders it, and the console fills with
 * hydration errors. It stayed invisible only because every figure on every page
 * arrives from a client-side query, so the server had nothing but skeletons to
 * render; the first server-rendered constant surfaced it immediately.
 *
 * So the separators are stated here rather than looked up. `en-US` is the
 * carrier locale — not a language choice, a choice of the ONE grouping both
 * engines agree on — and it is what every reader of this dashboard has been
 * seeing all along, so nothing on screen moves.
 *
 * (The strict Uzbek convention is a space group and a comma decimal, which is
 * what the client's own published dashboards print. Switching to it is a
 * one-line change to GROUP_SEPARATOR/DECIMAL_SEPARATOR below — a deliberate,
 * visible decision, not something a CLDR update should make on its own.)
 */
const LOCALE = 'en-US'

/** What every formatted number groups and separates with, in every engine. */
const GROUP_SEPARATOR = ','
const DECIMAL_SEPARATOR = '.'

/**
 * Apply the house separators to an `en-US` rendering.
 *
 * The substitution runs even when the two match `en-US`'s own, which is the
 * point: it is what makes the constants above the single place the appearance
 * is decided, so a future switch to the Uzbek convention cannot be undone by
 * a CLDR update, and no call site has to know which locale carried the digits.
 *
 * Two passes through a sentinel rather than two `replace` calls: replacing the
 * group separator first would then let the second pass rewrite the commas it
 * just wrote.
 */
function separators(text: string): string {
  return text
    .replaceAll(',', '\u0000')
    .replaceAll('.', DECIMAL_SEPARATOR)
    .replaceAll('\u0000', GROUP_SEPARATOR)
}

/**
 * One formatter per shape, built once.
 *
 * `new Intl.NumberFormat` costs ~46µs on this hardware; a cached call costs
 * 0.66µs. That gap did not matter until numbers started ANIMATING — the
 * overview's first paint runs eleven simultaneous count-up tweens, each
 * formatting once per frame, and constructing seventy formatters per second
 * for a second was pure waste on the exact frames that needed the headroom.
 */
const integerFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 })
const numberFormat = new Intl.NumberFormat(LOCALE)
const trimFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 })

const percentFormats = new Map<number, Intl.NumberFormat>()

function percentFormat(digits: number): Intl.NumberFormat {
  let cached = percentFormats.get(digits)
  if (!cached) {
    cached = new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
    percentFormats.set(digits, cached)
  }
  return cached
}

/**
 * Compact so'm for KPI cards and axis ticks.
 *
 * UZS figures run to ten digits, and a raw `340 000 000` is slower to read than
 * `340 mln`. The full figure stays available in the tooltip and the table, so
 * precision is never lost — only deferred.
 */
export function formatCompactUzs(amount: number): string {
  const abs = Math.abs(amount)

  if (abs >= 1_000_000_000) return `${trim(amount / 1_000_000_000)} mlrd`
  if (abs >= 1_000_000) return `${trim(amount / 1_000_000)} mln`
  if (abs >= 1_000) return `${trim(amount / 1_000)} ming`
  return trim(amount)
}

function trim(value: number): string {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10
  return separators(trimFormat.format(rounded))
}

/** Full so'm with thousands separators. Used in tables and tooltips. */
export function formatUzs(amount: number): string {
  return `${separators(integerFormat.format(amount))} soʻm`
}

export function formatNumber(value: number): string {
  return separators(numberFormat.format(value))
}

/**
 * A percentage, and never a zero for something that is not zero.
 *
 * Rounding to the requested digits turned real values into "0%" all over the
 * dashboard: a product line worth 1.1 bn soʻm printed 0% beside a visibly
 * non-zero bar, six sellers who had won money shared "0.0%" with eight who had
 * won none, and nine cohort cells with returning customers printed the same
 * digit as the cells where nobody came back. A reader takes 0% as "none", so
 * the rounding was not an approximation — it was a different fact.
 *
 * Below the smallest value the requested precision can show, the figure is
 * printed as "<0.1%" instead. Exact zero still prints "0%", which is the one
 * case where the digit is true.
 */
export function formatPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—'

  const smallest = 0.5 / 10 ** digits
  if (value !== 0 && Math.abs(value) < smallest) {
    const floor = separators(percentFormat(digits).format(smallest * 2))
    return `${value < 0 ? '>-' : '<'}${floor}%`
  }

  return `${separators(percentFormat(digits).format(value))}%`
}

/**
 * Month names are a table, not a locale lookup.
 *
 * `Intl.DateTimeFormat('uz-UZ', { month: 'short' })` is only as good as the
 * browser's ICU build, and several real builds (including the Chromium this
 * dashboard is read in) ship no abbreviated Uzbek months at all — the CLDR
 * fallback renders the literal pattern "M08", so every axis tick and period
 * line read "2026 M08 01". Node's full ICU hid the bug on the server and it
 * appeared only after hydration. Twelve strings cost nothing and render the
 * same in every browser.
 */
const UZ_MONTHS_SHORT = [
  'yan', 'fev', 'mar', 'apr', 'may', 'iyn',
  'iyl', 'avg', 'sen', 'okt', 'noy', 'dek',
] as const

/** Local time zone on purpose — identical semantics to the Intl calls this
 *  replaced, which also carried no explicit timeZone. */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()}-${UZ_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`
}

export function formatDateShort(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()}-${UZ_MONTHS_SHORT[d.getMonth()]}`
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getDate()}-${UZ_MONTHS_SHORT[d.getMonth()]}, ${hh}:${mm}`
}

/** Em dash for "no value". Deliberately distinct from a zero. */
export const NO_VALUE = '—'
