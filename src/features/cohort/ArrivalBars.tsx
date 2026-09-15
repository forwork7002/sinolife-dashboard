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
 */

/** How many complete months the comparison leans on, at most. */
const TREND_MONTHS = 12

/**
 * Fewer than this many complete months behind the last one and the block says
 * nothing. A comparison against a single month is not a trend; it is that
 * month.
 */
const MIN_TREND_MONTHS = 2

export function ArrivalBars({
  rows,
  currentMonth,
}: {
  readonly rows: readonly { cohort: string; size: number }[]
  readonly currentMonth: string
}) {
  const ordered = [...rows].sort((a, b) => a.cohort.localeCompare(b.cohort))
  const max = Math.max(1, ...ordered.map((r) => r.size))

  const complete = ordered.filter((r) => r.cohort < currentMonth)
  const last = complete.at(-1)
  const before = complete.slice(-1 - TREND_MONTHS, -1)
  const mean =
    before.length >= MIN_TREND_MONTHS
      ? before.reduce((sum, r) => sum + r.size, 0) / before.length
      : null

  return (
    <section>
      <h3>
        Qancha yangi mijoz keladi?{' '}
        <InfoTip
          label="Izoh: yangi mijozlar"
          content="Har oyda BIRINCHI marta xarid qilgan mijozlar soni. Mijoz buyurtmasi yetkazilgan oyga tushadi, shuning uchun tugamagan oy har doim past koʻrinadi."
        />
      </h3>

      <div data-testid="arrival-bars">
        {ordered.map((row) => {
          const partial = row.cohort >= currentMonth
          return (
            <div
              key={row.cohort}
              role="img"
              data-partial={partial ? 'true' : 'false'}
              aria-label={
                partial
                  ? `${formatMonth(row.cohort)}: ${formatNumber(row.size)} ta yangi mijoz — oy tugamagan`
                  : `${formatMonth(row.cohort)}: ${formatNumber(row.size)} ta yangi mijoz`
              }
              style={{
                height: `${Math.round((row.size / max) * 100)}%`,
                /* Colour follows the entity, never its rank (docs/DESIGN.md),
                   and the hatch is the matrix's own «not measured» fill, so
                   the two blocks say the same thing the same way. */
                background: partial
                  ? 'repeating-linear-gradient(45deg, var(--axis) 0 2px, transparent 2px 6px)'
                  : 'var(--series-1)',
              }}
            />
          )
        })}
      </div>

      {mean !== null && last && (
        <p role="status">
          {formatMonth(last.cohort)}da {formatNumber(last.size)} ta yangi mijoz —{' '}
          oldingi {before.length} toʻliq oyning oʻrtachasi {formatNumber(Math.round(mean))} ta
          edi.
        </p>
      )}
    </section>
  )
}
