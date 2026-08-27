'use client'

import { useQuery } from '@tanstack/react-query'

import { BarList } from '@/components/charts/BarList'
import { ErrorState, LoadingSkeleton } from '@/components/states/States'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Card } from '@/components/ui/Card'
import { StatTile } from '@/components/ui/Stat'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Tooltip } from '@/components/ui/Tooltip'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { ApiClientError, apiGet, type DeltaDto, type MoneyDto } from '@/lib/api'
import {
  NO_VALUE,
  formatCompactUzs,
  formatNumber,
  formatPercent,
  formatUzs,
} from '@/lib/format'
import { t } from '@/lib/messages'

interface ProductRow {
  readonly productId: string
  readonly name: string
  readonly revenue: MoneyDto
  readonly dealsWon: number
  readonly units: number
  readonly sharePercent: number | null
  readonly delta: DeltaDto
}

export function ProductsPage() {
  const { apiParams } = useDashboardFilters()

  const query = useQuery({
    queryKey: ['products', apiParams],
    queryFn: ({ signal }) =>
      apiGet<readonly ProductRow[]>('/analytics/products', apiParams, signal),
    placeholderData: (previous) => previous,
  })

  /** One derivation, so no tile can disagree with its own page. */

  const tileStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'


  const rows = query.data?.data ?? []
  const total = rows.reduce((sum, row) => sum + row.revenue.amount, 0)
  const units = rows.reduce((sum, row) => sum + row.units, 0)

  /*
    The rows already carry their growth delta for the table; the hero list
    reuses THE SAME objects through a lookup, so the bar beside a product and
    the row below it can never disagree about how it moved.
  */
  const deltaById = new Map(rows.map((row) => [row.productId, row.delta]))
  const top = rows.slice(0, 10)

  const columns: Column<ProductRow>[] = [
    {
      key: 'name',
      header: t.table.product,
      render: (row) => (
        <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
          {row.name}
        </span>
      ),
    },
    {
      key: 'revenue',
      header: t.table.revenue,
      align: 'right',
      numeric: true,
      render: (row) => (
        <span style={{ color: 'var(--ink-primary)' }} title={formatUzs(row.revenue.amount)}>
          {formatCompactUzs(row.revenue.amount)}
        </span>
      ),
    },
    {
      key: 'share',
      header: t.table.share,
      align: 'right',
      numeric: true,
      render: (row) => formatPercent(row.sharePercent, 1),
    },
    {
      key: 'units',
      header: 'Sotilgan miqdor',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.units),
    },
    {
      key: 'deals',
      header: t.table.dealsWon,
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.dealsWon),
    },
    {
      key: 'growth',
      header: t.table.growth,
      align: 'right',
      render: (row) => <TrendIndicator delta={row.delta} />,
    },
  ]

  return (
    <PageShell
      title={t.nav.products}
      // The product family shares the margin page's slot — same subject,
      // same stripe.
      accent="var(--series-2)"
      description="Yopilgan bitimlar tarkibidagi mahsulotlar boʻyicha"
      meta={query.data?.meta}
      filters={{ employees: true, departments: true, products: true, sources: true }}
    >
      {/*
        The lead instrument — the page's one hero, the only panel wearing the
        registration brackets.

        A products page is about ONE ranking: where the money came from. So
        the hero is the top-10 list itself, headed by the total it slices —
        the `.figure-hero` states the whole, the bars beneath it state the
        parts, and each part carries its own growth delta so "big" and
        "growing" stop being the same visual claim. Everything after this
        panel is detail: two quiet tiles, then the full table.
      */}
      <section className="card-hero brackets reveal px-5 py-5 sm:px-6" aria-label="Jami tushum">
        {query.isError ? (
          <ErrorState
            message={query.error instanceof ApiClientError ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <>
            <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Jami tushum
            </p>

            {query.isPending ? (
              // Sized to the hero figure below, so ready never reflows loading.
              <div className="skeleton mt-2 h-[40px] w-64" role="status">
                <span className="sr-only">Yuklanmoqda</span>
              </div>
            ) : total > 0 ? (
              /*
                The exact soʻm amount rides the Tooltip primitive, not a native
                `title`: hover, focus AND touch. The figure is a tab stop — the
                full ten-digit number is otherwise unreachable without a mouse.
              */
              <div className="mt-2">
                <Tooltip content={<span className="tabular">{formatUzs(total)}</span>}>
                  <span
                    tabIndex={0}
                    className="focusable figure-hero block w-fit rounded-[var(--radius-panel-sm)]"
                    style={{ color: 'var(--ink-primary)' }}
                  >
                    <AnimatedNumber value={total} format={formatCompactUzs} duration={900} />
                    <span className="ml-1.5 text-sm font-normal" style={{ color: 'var(--ink-muted)' }}>
                      soʻm
                    </span>
                  </span>
                </Tooltip>
              </div>
            ) : (
              // Genuine null: the period closed no deals with products in
              // them. An em dash, never 0 — "nothing sold" is the table's
              // empty state to explain, not a figure to assert.
              <p className="figure-hero mt-2" style={{ color: 'var(--ink-primary)' }}>
                {NO_VALUE}
              </p>
            )}

            {/* The list's own header, a register below the figure: what the
                bars are and which window the deltas compare against. */}
            <div
              className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t pt-4"
              style={{ borderColor: 'var(--border)' }}
            >
              <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                Top-10 mahsulot
              </p>
              <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                Tushum boʻyicha · oʻsish oldingi davrga nisbatan
              </p>
            </div>

            <div className="mt-3">
              {query.isPending ? (
                <LoadingSkeleton rows={6} />
              ) : (
                <BarList
                  items={top.map((row) => ({
                    id: row.productId,
                    label: row.name,
                    value: row.revenue.amount,
                    sharePercent: row.sharePercent,
                  }))}
                  /*
                    The per-product growth pill, drawn right after the value.
                    BarList stays agnostic about what a delta means — the page
                    hands it the house TrendIndicator, so the pill here reads
                    identically to the one in the table's growth column.
                  */
                  deltaSlot={(item) => {
                    const delta = deltaById.get(item.id)
                    return delta ? <TrendIndicator delta={delta} /> : null
                  }}
                  emptyLabel="Bu davrda yopilgan bitimlar tarkibida mahsulot yoʻq"
                />
              )}
            </div>
          </>
        )}
      </section>

      {/* Supporting tiles — subordinate on purpose: the hero already carries
          the money, so these state the two counts that qualify it. */}
      <div className="stagger grid gap-3 sm:grid-cols-2">
        <StatTile status={tileStatus} label="Sotilgan miqdor" value={units || null} unit="count" />
        <StatTile
          status={tileStatus}
          label="Mahsulot turlari"
          value={rows.length || null}
          unit="count"
        />
      </div>

      <Card className="px-4 py-4">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.productId}
          status={query.isError ? 'error' : query.isPending ? 'loading' : 'ready'}
          errorMessage={query.error instanceof ApiClientError ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
          emptyBody="Tanlangan davrda yopilgan bitimlar tarkibida mahsulot topilmadi."
          minWidth={760}
        />
      </Card>
    </PageShell>
  )
}
