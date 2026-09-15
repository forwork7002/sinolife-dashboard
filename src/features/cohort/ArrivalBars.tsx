'use client'

import { InfoTip } from '@/components/ui/Tooltip'
import { formatMonth, formatNumber } from '@/lib/format'

/**
 * «Qancha yangi mijoz keladi?» — the first of the manager's three questions,
 * answered from the column that was already on the wire.
 *
 * A cohort's `size` IS the count of customers who made their first delivered
 * purchase in that month. Eighteen of them ship with every cohort response
 * and were rendered as a narrow numeric column nobody reads as a series.
 *
 * THE RUNNING MONTH IS SHORT BY CONSTRUCTION. A customer joins a month when
 * their order is DELIVERED, so the current month is half-lived and its orders
 * are still sitting in Тасдиклаш and Доставка. Drawn as a finished month it
 * reads as a collapse — the mistake the record wall already made once — so it
 * is hatched, labelled, and kept out of the comparison below.
 *
 * `rows` IS SPARSE, AND THAT IS A SEPARATE TRAP FROM THE ONE ABOVE. A month
 * with no first-time buyer emits no row at all (see the cohort query in
 * `insightsRepository.ts`) — the exact fact `InsightsService.cohorts()`
 * already had to learn once, in the comment above its own `currentMonth`
 * ("THE HORIZON IS THE CLOCK, and it used to be the data"), and the matrix's
 * cells apply the same rule cell by cell ("a month with no repeat buyers
 * reports 0, not null — the absence IS the finding"). Reading `rows` as one
 * entry per calendar month turns a quiet month into a MISSING bar instead of
 * a SHORT one, which hides the exact thing this block exists to show a
 * manager. So the bars — and the months the comparison walks — are built from
 * a DENSE calendar sequence, walked from the oldest row's month through
 * `currentMonth` one whole month at a time, with every gap filled at size 0.
 * That is also what makes `before`'s slice a slice of calendar months rather
 * than of array entries: with a gap, the last N ARRAY entries can reach
 * further back than the last N CALENDAR months, while the sentence claims the
 * latter.
 */

/** How many complete months the comparison leans on, at most. */
const TREND_MONTHS = 12

/**
 * Fewer than this many complete months behind the last one and the block says
 * nothing. A comparison against a single month is not a trend; it is that
 * month.
 */
const MIN_TREND_MONTHS = 2

/**
 * A cohort string → whole months elapsed since year 0.
 *
 * Whole-month arithmetic on the year/month pair, never on the timestamp —
 * the same discipline `formatMonthOffset` documents (adding 30 days to
 * 31-yanvar lands in March) and `InsightsService.monthsApart` already applies
 * server-side. `cohort` arrives as `YYYY-MM-DD` (always the first of the
 * month — `date_trunc('month', …)`), so a plain string split is exact.
 */
function monthIndex(cohort: string): number {
  const [year, month] = cohort.split('-').map(Number)
  return (year ?? 0) * 12 + ((month ?? 1) - 1)
}

/** The inverse of `monthIndex` — always the first of the month. */
function cohortAtIndex(index: number): string {
  const year = Math.floor(index / 12)
  const month = index % 12
  return `${year}-${String(month + 1).padStart(2, '0')}-01`
}

export function ArrivalBars({
  rows,
  currentMonth,
}: {
  readonly rows: readonly { cohort: string; size: number }[]
  readonly currentMonth: string
}) {
  const ordered = [...rows].sort((a, b) => a.cohort.localeCompare(b.cohort))
  const sizeByCohort = new Map(ordered.map((r) => [r.cohort, r.size]))

  /*
    THE DENSE CALENDAR, NOT THE SPARSE ROWS. Walked from the oldest row's
    month through `currentMonth` inclusive; a month absent from `rows` is a
    measured zero (nobody's first purchase landed there), filled in rather
    than skipped. With no rows at all there is no calendar to anchor on, so
    the block draws nothing — the same as before this fix.
  */
  const dense: { cohort: string; size: number }[] = []
  if (ordered.length > 0) {
    const start = monthIndex(ordered[0]!.cohort)
    const end = monthIndex(currentMonth)
    for (let idx = start; idx <= end; idx += 1) {
      const cohort = cohortAtIndex(idx)
      dense.push({ cohort, size: sizeByCohort.get(cohort) ?? 0 })
    }
  }

  const max = Math.max(1, ...dense.map((r) => r.size))

  const complete = dense.filter((r) => r.cohort < currentMonth)
  const last = complete.at(-1)
  const before = complete.slice(-1 - TREND_MONTHS, -1)
  const mean =
    before.length >= MIN_TREND_MONTHS
      ? before.reduce((sum, r) => sum + r.size, 0) / before.length
      : null

  return (
    <section>
      <h3
        className="flex items-center gap-1 text-[13px] font-medium"
        style={{ color: 'var(--ink-secondary)' }}
      >
        Qancha yangi mijoz keladi?{' '}
        <InfoTip
          label="Izoh: yangi mijozlar"
          content="Har oyda BIRINCHI marta xarid qilgan mijozlar soni. Mijoz buyurtmasi yetkazilgan oyga tushadi, shuning uchun tugamagan oy har doim past koʻrinadi."
        />
      </h3>

      {/* A DEFINITE HEIGHT, because every bar's height is a PERCENTAGE of it.
          `items-end` grows them from the baseline; without a height on the rail
          the percentages resolve against `auto` and every month collapses to
          its own 2px floor. */}
      <div className="mt-3 flex h-28 items-end gap-1" data-testid="arrival-bars">
        {dense.map((row) => {
          const partial = row.cohort >= currentMonth
          return (
            <div
              key={row.cohort}
              className="min-w-0 flex-1 rounded-t-[2px]"
              role="img"
              data-partial={partial ? 'true' : 'false'}
              aria-label={
                partial
                  ? `${formatMonth(row.cohort)}: ${formatNumber(row.size)} ta yangi mijoz — oy tugamagan`
                  : `${formatMonth(row.cohort)}: ${formatNumber(row.size)} ta yangi mijoz`
              }
              style={{
                height: `${Math.round((row.size / max) * 100)}%`,
                /* A gap month is a MEASURED zero (nobody's first purchase
                   landed there), not an absence, so it still draws a bar —
                   just enough of one (2px) to read as empty rather than
                   missing when the computed height rounds to nothing. */
                minHeight: '2px',
                /* Colour follows the entity, never its rank (docs/DESIGN.md),
                   and the hatch is the matrix's own «not measured» fill, so
                   the two blocks say the same thing the same way. A dense
                   zero month is measured, not merely un-reached, so it is
                   NEVER hatched — only the running month is. */
                background: partial
                  ? 'repeating-linear-gradient(45deg, var(--axis) 0 2px, transparent 2px 6px)'
                  : 'var(--series-1)',
              }}
            />
          )
        })}
      </div>

      {mean !== null && last && (
        <p
          className="mt-3 text-sm leading-snug"
          style={{ color: 'var(--ink-secondary)' }}
          role="status"
        >
          {formatMonth(last.cohort)}da {formatNumber(last.size)} ta yangi mijoz —{' '}
          oldingi {before.length} toʻliq oyning oʻrtachasi {formatNumber(Math.round(mean))} ta
          edi.
        </p>
      )}
    </section>
  )
}
