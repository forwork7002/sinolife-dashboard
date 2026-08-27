/**
 * Display formatting.
 *
 * Client-safe: no server imports. Everything here is presentation only — never
 * arithmetic. Money arrives from the API already exact; these functions turn it
 * into text and must not be used to compute anything.
 */

const LOCALE = 'uz-UZ'

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
  return trimFormat.format(rounded)
}

/** Full so'm with thousands separators. Used in tables and tooltips. */
export function formatUzs(amount: number): string {
  return `${integerFormat.format(amount)} soʻm`
}

export function formatNumber(value: number): string {
  return numberFormat.format(value)
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${percentFormat(digits).format(value)}%`
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
