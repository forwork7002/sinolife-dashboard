'use client'

import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { DataTable, type Column } from '@/components/ui/DataTable'
import { RankBadge } from '@/components/ui/Stat'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type SellerSourceRowDto, apiGet } from '@/lib/api'
import { NO_VALUE, formatFullUzs, formatNumber, formatPercent } from '@/lib/format'

/**
 * WHERE FAKT 1 AND FAKT 2 CAME FROM — every source in the «Manba» filter as a
 * ranked row, laid out like «Jamoalar boʻyicha» directly above it.
 *
 * Asked for on 2026-09-23: «manba … har biri jadval usulida … 1-oʻrin, 2-oʻrin
 * qilib, oʻsha qatorga toʻliq maʼlumoti yoziladi». The filter answers «show me
 * one source»; this answers «which source is carrying the month», which the
 * filter can only answer one click at a time.
 *
 * THE SAME COHORT AND THE SAME CLOCK AS THE HERO. `?include=sources` is
 * `/analytics/sellers` on the queue basis, grouped by the deal's source
 * through the board's own predicates, so the rows add up to the hero's FAKT 1
 * and FAKT 2. The row with no source set is printed as one, not dropped, for
 * exactly that reason.
 *
 * IN THE SERVER'S OWN ORDER, never re-sorted here — FAKT 2, then FAKT 1, the
 * rule the teams table ranks by. See `sourceRows` in `sellerBoardService`.
 *
 * ITS OWN REQUEST, not a field on the board: the television polls the board
 * every minute and has no use for a per-source GROUP BY.
 */
export function SourceFaktTable() {
  const { apiParams } = useDashboardFilters()

  const params = useMemo(() => ({ ...apiParams, include: 'sources' as const }), [apiParams])

  const query = useQuery({
    queryKey: ['sellers', 'sources', params],
    queryFn: ({ signal }) =>
      apiGet<readonly SellerSourceRowDto[]>('/analytics/sellers', params, signal),
    placeholderData: keepPreviousData,
  })

  const status = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'

  return (
    <div
      className="space-y-2"
      style={{
        opacity: query.isPlaceholderData ? 0.6 : 1,
        transition: 'opacity 150ms var(--ease-out)',
      }}
      aria-busy={query.isPlaceholderData || undefined}
    >
      <h3 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
        Manbalar boʻyicha · FAKT 1 / FAKT 2
      </h3>
      <SourceTable
        rows={query.data?.data ?? []}
        status={status}
        errorMessage={(query.error as Error | null)?.message}
        onRetry={() => void query.refetch()}
      />
    </div>
  )
}

/**
 * The table alone, in the order it is handed. Exported for
 * `tests/features/sourceFaktTable.test.tsx`; `SourceFaktTable` above is one
 * `useQuery` and nothing worth asserting.
 */
export function SourceTable({
  rows,
  status,
  errorMessage,
  onRetry,
}: {
  rows: readonly SellerSourceRowDto[]
  status: 'loading' | 'error' | 'ready'
  errorMessage?: string
  onRetry?: () => void
}) {
  const columns: readonly Column<SellerSourceRowDto>[] = [
    {
      key: 'rank',
      header: 'Oʻrin',
      width: '64px',
      render: (row) => <RankBadge rank={row.rank} />,
    },
    {
      key: 'source',
      header: 'Manba',
      rowHeader: true,
      render: (row) =>
        row.name ?? <span style={{ color: 'var(--ink-muted)' }}>Manba koʻrsatilmagan</span>,
    },
    {
      key: 'sellers',
      header: 'Sotuvchi',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.sellers),
    },
    {
      key: 'cohort',
      header: 'Navbatga tushgan',
      align: 'right',
      numeric: true,
      render: (row) => `${formatNumber(row.cohortOrders)} ta`,
    },
    {
      key: 'fakt1',
      header: 'FAKT 1',
      align: 'right',
      numeric: true,
      render: (row) => formatFullUzs(row.ordered.amount),
    },
    {
      key: 'orders',
      header: 'Tasdiqlangan',
      align: 'right',
      numeric: true,
      render: (row) => `${formatNumber(row.orders)} ta`,
    },
    {
      key: 'fakt1Forecast',
      header: 'FAKT 1 prognoz',
      align: 'right',
      numeric: true,
      // Beside the figure it is made from, as on the teams table.
      render: (row) =>
        row.forecast.fakt1 === null ? NO_VALUE : formatFullUzs(row.forecast.fakt1.amount),
    },
    {
      key: 'fakt2',
      header: 'FAKT 2',
      align: 'right',
      numeric: true,
      render: (row) => formatFullUzs(row.won.amount),
    },
    {
      key: 'fakt2Forecast',
      header: 'FAKT 2 prognoz',
      align: 'right',
      numeric: true,
      render: (row) =>
        row.forecast.fakt2 === null ? NO_VALUE : formatFullUzs(row.forecast.fakt2.amount),
    },
    {
      key: 'wonOrders',
      header: 'Yetkazilgan',
      align: 'right',
      numeric: true,
      render: (row) => `${formatNumber(row.wonOrders)} ta`,
    },
    {
      key: 'open',
      header: 'Yoʻlda',
      align: 'right',
      numeric: true,
      render: (row) => formatFullUzs(row.open.amount),
    },
    {
      key: 'rejected',
      header: 'Rad etildi',
      align: 'right',
      numeric: true,
      render: (row) => `${formatNumber(row.rejectedOrders)} ta`,
    },
    {
      key: 'conversion',
      header: 'Konversiya',
      align: 'right',
      numeric: true,
      render: (row) =>
        row.conversionPercent === null ? NO_VALUE : formatPercent(row.conversionPercent),
    },
    {
      key: 'fakt1Share',
      header: 'FAKT 1 ulushi',
      align: 'right',
      numeric: true,
      render: (row) =>
        row.fakt1SharePercent === null ? NO_VALUE : formatPercent(row.fakt1SharePercent),
    },
    {
      key: 'share',
      header: 'FAKT 2 ulushi',
      align: 'right',
      numeric: true,
      render: (row) => (row.sharePercent === null ? NO_VALUE : formatPercent(row.sharePercent)),
    },
  ]

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.sourceId ?? '__none__'}
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      emptyTitle="Bu davrda manba boʻyicha maʼlumot yoʻq"
      // Fifteen columns, six of them money in full digits; below this the
      // table scrolls sideways inside its own box.
      minWidth={1640}
      // The whole list, as on the teams table: «kim oldinda» is not answered
      // inside a scroll box with the last sources below the fold.
      maxHeight="none"
    />
  )
}
