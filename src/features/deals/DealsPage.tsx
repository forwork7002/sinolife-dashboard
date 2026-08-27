'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Card } from '@/components/ui/Card'
import { Pagination, SegmentedControl, StatusBadge } from '@/components/ui/Controls'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Tooltip } from '@/components/ui/Tooltip'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { ApiClientError, apiGet, type DealRowDto, type DealsPageDto } from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatDateShort, formatUzs } from '@/lib/format'
import { t } from '@/lib/messages'
import { DealDetailPanel } from './DealDetailPanel'

const STATUS_OPTIONS = [
  { value: 'all', label: 'Barchasi' },
  { value: 'OPEN', label: t.status.OPEN },
  { value: 'WON', label: t.status.WON },
  { value: 'LOST', label: t.status.LOST },
] as const

export function DealsPage() {
  const { filters, update, apiParams } = useDashboardFilters()
  const [openDealId, setOpenDealId] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['deals', apiParams, filters.page, filters.pageSize, filters.sort, filters.order],
    queryFn: ({ signal }) =>
      apiGet<DealsPageDto>(
        '/deals',
        {
          ...apiParams,
          page: filters.page,
          pageSize: filters.pageSize,
          sort: filters.sort,
          order: filters.order,
        },
        signal,
      ),
    // Keeps the previous page visible while the next one loads, so the table
    // does not collapse to a skeleton on every page change.
    placeholderData: (previous) => previous,
  })

  const status = query.isError ? 'error' : query.isPending ? 'loading' : 'ready'
  const page = query.data?.data

  /** Clicking the active column flips direction; a new column starts descending. */
  const onSort = (sortKey: string) => {
    update(
      filters.sort === sortKey
        ? { order: filters.order === 'asc' ? 'desc' : 'asc' }
        : { sort: sortKey, order: 'desc' },
    )
  }

  const columns: Column<DealRowDto>[] = [
    {
      key: 'title',
      header: t.table.deal,
      sortKey: 'title',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium" style={{ color: 'var(--ink-primary)' }}>
            {row.title}
          </p>
          {row.customer && (
            <p className="truncate text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {row.customer.name}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'amount',
      header: t.table.amount,
      sortKey: 'amountMinor',
      align: 'right',
      numeric: true,
      render: (row) => (
        /*
          The exact soʻm amount rides the Tooltip primitive, not a native
          title — hover, focus AND touch, in the house panel style. Not a tab
          stop: fifty rows per page, and the row itself is already focusable.
        */
        <Tooltip content={<span className="tabular">{formatUzs(row.amount.amount)}</span>}>
          <span style={{ color: 'var(--ink-primary)' }}>
            {formatCompactUzs(row.amount.amount)}
          </span>
        </Tooltip>
      ),
    },
    {
      key: 'employee',
      header: t.table.employee,
      render: (row) => row.employee.fullName,
    },
    {
      key: 'stage',
      header: t.table.stage,
      render: (row) => row.stage.name,
    },
    {
      key: 'status',
      header: t.table.status,
      sortKey: 'status',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'products',
      header: t.table.product,
      render: (row) =>
        row.products.length === 0 ? (
          NO_VALUE
        ) : (
          // The full product list is data the "+N" hides — it moves from a
          // native title to the Tooltip primitive so touch and keyboard see
          // it too. max-w keeps a ten-product deal from becoming a banner.
          <Tooltip content={<span className="block max-w-72">{row.products.join(', ')}</span>}>
            <span className="truncate">
              {row.products[0]}
              {row.products.length > 1 && (
                <span style={{ color: 'var(--ink-muted)' }}> +{row.products.length - 1}</span>
              )}
            </span>
          </Tooltip>
        ),
    },
    {
      key: 'source',
      header: t.table.source,
      render: (row) => row.source?.name ?? NO_VALUE,
    },
    {
      key: 'created',
      header: t.table.created,
      sortKey: 'createdAtSource',
      align: 'right',
      numeric: true,
      render: (row) => formatDateShort(row.createdAt),
    },
    {
      key: 'closed',
      header: t.table.closed,
      sortKey: 'closedAt',
      align: 'right',
      numeric: true,
      render: (row) => (row.closedAt ? formatDateShort(row.closedAt) : NO_VALUE),
    },
  ]

  return (
    <PageShell
      title={t.nav.deals}
      accent="var(--series-1)"
      meta={query.data?.meta}
      filters={{
        search: true,
        employees: true,
        departments: true,
        stages: true,
        products: true,
        sources: true,
      }}
      actions={
        <SegmentedControl
          ariaLabel={t.table.status}
          value={filters.status ?? 'all'}
          options={STATUS_OPTIONS}
          onChange={(value) => update({ status: value === 'all' ? undefined : value })}
        />
      }
    >
      {/*
        The registry IS this page's lead instrument, so the one card wears the
        hero surface and the registration brackets. There is no hero NUMBER on
        purpose: a paginated operational list has no single honest headline
        figure, and inventing one (a page-sum of fifty arbitrary rows) would
        put a number in the flagship slot that means nothing. One hero per
        page still holds — this is it.
      */}
      <Card className="card-hero brackets px-4 py-4">
        <DataTable
          columns={columns}
          rows={page?.items ?? []}
          rowKey={(row) => row.id}
          status={status}
          errorMessage={
            query.error instanceof ApiClientError ? query.error.message : undefined
          }
          onRetry={() => void query.refetch()}
          onRowClick={(row) => setOpenDealId(row.id)}
          sort={filters.sort}
          order={filters.order}
          onSort={onSort}
          minWidth={980}
          /*
            Bounded, so the header row pins while fifty deals scroll under it —
            without the cap the container grows with the page and sticky has
            nothing to stick to. Pagination stays visible below the cap too,
            instead of a full page-height away.
          */
          maxHeight={640}
        />

        {page && (
          <Pagination
            page={page.pagination.page}
            totalPages={page.pagination.totalPages}
            totalItems={page.pagination.totalItems}
            onPage={(next) => update({ page: next })}
          />
        )}
      </Card>

      <DealDetailPanel dealId={openDealId} onClose={() => setOpenDealId(null)} />
    </PageShell>
  )
}
