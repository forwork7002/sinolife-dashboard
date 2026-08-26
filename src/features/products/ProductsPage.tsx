'use client'

import { useQuery } from '@tanstack/react-query'

import { BarList } from '@/components/charts/BarList'
import { Card, ChartCard } from '@/components/ui/Card'
import { StatTile } from '@/components/ui/Stat'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { ApiClientError, apiGet, type DeltaDto, type MoneyDto } from '@/lib/api'
import { formatCompactUzs, formatNumber, formatPercent, formatUzs } from '@/lib/format'
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
      {/* House tiles, not the local Stat this page grew before the design
          pass existed: those rendered zeros as data while loading, never
          counted up, and never reported an error. */}
      <div className="stagger grid gap-3 sm:grid-cols-3">
        <StatTile status={tileStatus} label="Jami tushum" value={total || null} unit="money" />
        <StatTile status={tileStatus} label="Sotilgan miqdor" value={units || null} unit="count" />
        <StatTile
          status={tileStatus}
          label="Mahsulot turlari"
          value={rows.length || null}
          unit="count"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <ChartCard
          title={t.chart.byProduct}
          hint="Tushum boʻyicha tartiblangan"
          className="lg:col-span-2"
        >
          <BarList
            items={rows.slice(0, 10).map((row) => ({
              id: row.productId,
              label: row.name,
              value: row.revenue.amount,
              sharePercent: row.sharePercent,
            }))}
          />
        </ChartCard>

        <Card className="px-4 py-4 lg:col-span-3">
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
      </div>
    </PageShell>
  )
}


