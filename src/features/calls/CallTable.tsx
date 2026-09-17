'use client'

import { type Column, DataTable } from '@/components/ui/DataTable'
import type { CallRowDto } from '@/lib/api'
import {
  NO_VALUE,
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatTime,
} from '@/lib/format'

/**
 * «Kim qancha gaplashdi» — one ranked table, rendered for operators and teams.
 *
 * TALK TIME LEADS, AND CARRIES ITS SHARE AS A BAR. The question the client
 * asked is «kim qancha gaplashayapti», so the first figure after the name is
 * the time, spelled out («3 soat 12 daq»), with the row's share of the whole
 * window's talk beside it and a bar scaled to the top row. The bar is relative
 * to the LEADER, not to the total, so the difference between neighbours stays
 * visible when one team holds a third of the floor.
 *
 * THE MEAN AND THE MEDIAN ARE BOTH COLUMNS. Measured above the floor: the mean
 * connected call runs 169 s and the median 53 s, because 8.4% of calls pass ten
 * minutes and hold half of all talk time. With only the mean a ROP reads a
 * typical call as three minutes; with only the median the day's hours go
 * unexplained. The mean is computed HERE from `talkSec / connected` — neither
 * the SQL nor the service carries it, so a tile and this table cannot be
 * rounded into disagreement.
 *
 * «BIRINCHI – OXIRGI» IS WHEN THE ROW WAS ON THE PHONE, not a shift. It is the
 * first and last call start the portal recorded for that row inside the
 * window, in Tashkent time; a row whose two ends fall on different days prints
 * both dates, because «09:02 – 11:40» over a week reads as one morning.
 *
 * THE ORDER IS THE SERVER'S. It ranked by talk time; re-sorting here would be a
 * second definition of «top». So no column is sortable.
 */
export function CallTable({
  rows,
  totalTalkSec,
  kind,
  status,
  errorMessage,
  onRetry,
  maxHeight,
}: {
  rows: readonly CallRowDto[]
  /** The window's whole talk time — what each row's share is of. */
  totalTalkSec: number
  kind: 'operator' | 'team'
  status: 'loading' | 'error' | 'ready'
  errorMessage?: string
  onRetry?: () => void
  maxHeight?: number | string
}) {
  const leader = rows.reduce((max, row) => Math.max(max, row.talkSec), 0)
  const ranked = rows.map((row, index) => ({ row, rank: index + 1 }))

  return (
    <DataTable<RankedRow>
      columns={columns(kind, leader, totalTalkSec)}
      rows={ranked}
      rowKey={({ row }) => row.key}
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      emptyTitle="Bu davrda qoʻngʻiroq yoʻq"
      emptyBody="Tanlangan oraliqda portal hech qanday qoʻngʻiroq yozmagan."
      minWidth={kind === 'operator' ? 980 : 900}
      maxHeight={maxHeight ?? 'none'}
      // The name stays put when a phone scrolls the table sideways: a column
      // of durations with nobody's name on it is not a reading.
      stickyColumns={2}
    />
  )
}

interface RankedRow {
  readonly row: CallRowDto
  readonly rank: number
}

/** «17-sen, 09:02 – 18:47», or both dates when the ends fall on different days. */
export function callSpanText(first: string | null, last: string | null): string {
  if (!first || !last) return NO_VALUE
  if (formatDate(first) === formatDate(last)) {
    return `${formatDateTime(first)} – ${formatTime(last)}`
  }
  return `${formatDateTime(first)} – ${formatDateTime(last)}`
}

function columns(
  kind: 'operator' | 'team',
  leader: number,
  totalTalkSec: number,
): readonly Column<RankedRow>[] {
  const muted = { color: 'var(--ink-muted)' }

  return [
    {
      key: 'rank',
      header: '#',
      align: 'right',
      numeric: true,
      width: '44px',
      render: ({ rank }) => <span style={muted}>{rank}</span>,
    },
    {
      key: 'name',
      header: kind === 'operator' ? 'Operator' : 'Komanda',
      rowHeader: true,
      render: ({ row }) =>
        kind === 'operator' && row.team ? (
          <span className="flex flex-col leading-tight">
            <span>{row.label}</span>
            <span className="text-[11px] font-normal" style={muted}>
              {row.team}
            </span>
          </span>
        ) : (
          row.label
        ),
    },
    {
      key: 'talk',
      header: 'Suhbat vaqti',
      render: ({ row }) => {
        const width = leader > 0 ? Math.max(2, (row.talkSec / leader) * 100) : 0
        const share = totalTalkSec > 0 ? (row.talkSec / totalTalkSec) * 100 : null
        return (
          <span className="flex min-w-[170px] flex-col gap-1">
            <span className="flex items-baseline justify-between gap-3 tabular-nums">
              <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
                {formatDuration(row.talkSec)}
              </span>
              <span className="text-[11px]" style={muted}>
                {formatPercent(share)}
              </span>
            </span>
            <span
              aria-hidden
              className="block h-1.5 w-full overflow-hidden rounded-full"
              style={{ background: 'var(--track)' }}
            >
              <span
                className="block h-full rounded-full"
                style={{ width: `${width}%`, background: 'var(--accent)' }}
              />
            </span>
          </span>
        )
      },
    },
    {
      key: 'calls',
      header: 'Qoʻngʻiroq',
      align: 'right',
      numeric: true,
      render: ({ row }) => formatNumber(row.calls),
    },
    {
      key: 'connected',
      header: 'Ulangan',
      align: 'right',
      numeric: true,
      render: ({ row }) => (
        <>
          {formatNumber(row.connected)}
          <span className="ml-1.5 text-xs" style={muted}>
            {formatPercent(row.connectPercent)}
          </span>
        </>
      ),
    },
    {
      key: 'median',
      header: 'Median suhbat',
      align: 'right',
      numeric: true,
      /*
        NULL, NOT ZERO, WHEN NOBODY WAS REACHED. A row that dialled twice and
        reached nobody has no typical call — «0 s» would state a measurement
        that was never made.
      */
      render: ({ row }) => (row.medianSec === null ? NO_VALUE : formatDuration(row.medianSec)),
    },
    {
      key: 'mean',
      header: 'Oʻrtacha suhbat',
      align: 'right',
      numeric: true,
      render: ({ row }) =>
        row.connected === 0 ? NO_VALUE : formatDuration(row.talkSec / row.connected),
    },
    {
      key: 'span',
      header: 'Birinchi – oxirgi qoʻngʻiroq',
      align: 'right',
      numeric: true,
      render: ({ row }) => (
        <span className="whitespace-nowrap">{callSpanText(row.firstCallAt, row.lastCallAt)}</span>
      ),
    },
  ]
}
