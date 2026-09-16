'use client'

import { type Column, DataTable } from '@/components/ui/DataTable'
import type { CallRowDto } from '@/lib/api'
import { NO_VALUE, formatDuration, formatNumber, formatPercent } from '@/lib/format'

/**
 * One ranked table, rendered three times — sides of the base, teams, operators.
 *
 * THE MEAN AND THE MEDIAN ARE BOTH COLUMNS, and dropping either is the one
 * edit that breaks this block. Measured above the floor: the mean connected
 * call runs 169 s and the median 53 s, because 8.4% of calls pass ten minutes
 * and hold 50% of all talk time. With only the mean a ROP reads a typical call
 * as three minutes; with only the median the day's hours go unexplained.
 *
 * THE MEAN IS COMPUTED HERE, from `talkSec / connected`. Neither the SQL nor
 * the service carries it: rounded on the way out and again for display, a tile
 * and this table would disagree by a second and nobody could say which was
 * right.
 *
 * THE ORDER IS THE SERVER'S. It ranked by talk time (or, for the sides, by
 * `CALL_SIDES`); re-sorting here would be a second definition of «top». So no
 * column is sortable.
 *
 * Built on `DataTable` so the loading, error and empty renderings, the sticky
 * header, the pinned name and the row header a screen reader announces a row
 * by are the ones every other table in the product has.
 */
export function CallRowTable({
  rows,
  nameHeader,
  status,
  errorMessage,
  onRetry,
  maxHeight = 'none',
}: {
  rows: readonly CallRowDto[]
  nameHeader: string
  status: 'loading' | 'error' | 'ready'
  errorMessage?: string
  onRetry?: () => void
  /**
   * `'none'` for the short tables (three sides, sixteen teams), which show
   * whole. The operators table passes a bound: a hundred-odd rows scroll inside
   * the card under a sticky header rather than pushing the rest of the screen
   * three pages down.
   */
  maxHeight?: number | string
}) {
  return (
    <DataTable<CallRowDto>
      columns={columns(nameHeader)}
      rows={rows}
      rowKey={(row) => row.key}
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      emptyTitle="Bu davrda qoʻngʻiroq yoʻq"
      emptyBody="Tanlangan oraliqda portal hech qanday qoʻngʻiroq yozmagan."
      // Seven columns, and the two durations must not wrap — they are read
      // against each other.
      minWidth={760}
      maxHeight={maxHeight}
      // The name stays put when a phone scrolls the table sideways, for the
      // reason RopSection pins its ROP: a column of durations with nobody's
      // name on it is not a reading.
      stickyColumns={1}
    />
  )
}

function columns(nameHeader: string): readonly Column<CallRowDto>[] {
  return [
    {
      key: 'name',
      header: nameHeader,
      rowHeader: true,
      render: (row) => row.label,
    },
    {
      key: 'calls',
      header: 'Qoʻngʻiroq',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.calls),
    },
    {
      key: 'connected',
      header: 'Ulangan',
      align: 'right',
      numeric: true,
      render: (row) => (
        <>
          {formatNumber(row.connected)}
          <span className="ml-1.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {formatPercent(row.connectPercent)}
          </span>
        </>
      ),
    },
    {
      key: 'talk',
      header: 'Suhbat',
      align: 'right',
      numeric: true,
      render: (row) => `${formatNumber(Math.round((row.talkSec / 3600) * 10) / 10)} soat`,
    },
    {
      key: 'mean',
      header: 'Oʻrtacha',
      align: 'right',
      numeric: true,
      /*
        NULL, NOT ZERO, WHEN NOBODY WAS REACHED. A team that dialled twice and
        reached nobody has no average call — «0 s» would state a measurement
        that was never made.
      */
      render: (row) => (row.connected === 0 ? NO_VALUE : formatDuration(row.talkSec / row.connected)),
    },
    {
      key: 'median',
      header: 'Median',
      align: 'right',
      numeric: true,
      render: (row) => (row.medianSec === null ? NO_VALUE : formatDuration(row.medianSec)),
    },
    {
      key: 'p90',
      header: 'p90',
      align: 'right',
      numeric: true,
      render: (row) => (row.p90Sec === null ? NO_VALUE : formatDuration(row.p90Sec)),
    },
  ]
}
