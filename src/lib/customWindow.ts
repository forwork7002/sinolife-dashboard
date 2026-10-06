/** Mirrors `MAX_CUSTOM_RANGE_MS` in `src/server/http/queryParams.ts`, which client code may not import. */
const MAX_SPAN_MS = 10 * 366 * 24 * 60 * 60 * 1000

/**
 * Whether a custom window is one the API will accept.
 *
 * Both bounds come from places nothing controls — a link pasted between
 * phones, browser storage, an `<input type="month">` that Firefox and Safari
 * on a desk draw as plain text — and `periodQuerySchema` refuses three things:
 * a bound that is not a real calendar day, an end before its start, and a
 * span over ten years. A window it refuses is a 400 on every request of the
 * page, and the remembered one rides every sidebar link, so it would open
 * every screen on an error until somebody pressed a preset. Asked before a
 * window is honoured, remembered or applied. The mirror is checked:
 * `tests/features/dashboardFilters.test.ts` puts one table of windows to this
 * and to `periodQuerySchema`, the ten-year edge to the day included.
 */
export function isCustomWindow(from: string | null | undefined, to: string | null | undefined): boolean {
  if (!from || !to || !isCalendarDay(from) || !isCalendarDay(to) || to < from) return false
  return Date.parse(to) - Date.parse(from) <= MAX_SPAN_MS
}

/** `YYYY-MM-DD` that comes back unchanged from its own date — «2026-02-30» does not. */
function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}
