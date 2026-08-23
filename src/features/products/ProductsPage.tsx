'use client'

import { useQuery } from '@tanstack/react-query'

import { BarList } from '@/components/charts/BarList'
import { Card, ChartCard } from '@/components/ui/Card'
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
      description="Yopilgan bitimlar tarkibidagi mahsulotlar boʻyicha"
      meta={query.data?.meta}
      filters={{ employees: true, departments: true, products: true, sources: true }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Jami tushum" value={`${formatCompactUzs(total)} soʻm`} />
        <Stat label="Sotilgan miqdor" value={formatNumber(units)} />
        <Stat label="Mahsulot turlari" value={formatNumber(rows.length)} />
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="px-4 py-3.5">
      <p className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </p>
      <p
        className="mt-1.5 text-xl leading-none font-semibold tracking-tight"
        style={{ color: 'var(--ink-primary)' }}
      >
        {value}
      </p>
    </Card>
  )
}
