/**
 * Display formatting.
 *
 * Client-safe: no server imports. Everything here is presentation only — never
 * arithmetic. Money arrives from the API already exact; these functions turn it
 * into text and must not be used to compute anything.
 */

const LOCALE = 'uz-UZ'

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
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(rounded)
}

/** Full so'm with thousands separators. Used in tables and tooltips. */
export function formatUzs(amount: number): string {
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(amount)} soʻm`
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(LOCALE).format(value)
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)}%`
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso))
}

export function formatDateShort(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: 'short' }).format(
    new Date(iso),
  )
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

/** Em dash for "no value". Deliberately distinct from a zero. */
export const NO_VALUE = '—'
