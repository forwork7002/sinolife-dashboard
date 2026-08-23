'use client'

import { keepPreviousData, useQueries } from '@tanstack/react-query'

import { BarList } from '@/components/charts/BarList'
import { FunnelChart } from '@/components/charts/FunnelChart'
import { RevenueTrendChart } from '@/components/charts/RevenueTrendChart'
import { ChartSkeleton } from '@/components/states/States'
import { Card, ChartCard } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import {
  ApiClientError,
  apiGet,
  type DeltaDto,
  type FunnelStepDto,
  type MoneyDto,
  type TrendPointDto,
} from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatNumber, formatPercent, formatUzs } from '@/lib/format'
import { t } from '@/lib/messages'

interface SalesPayload {
  readonly trend: readonly TrendPointDto[]
  readonly summary: {
    readonly revenue: { readonly amountMinor: string; readonly currency: string }
    readonly dealsWon: number
    readonly dealsLost: number
    readonly dealsCreated: number
    readonly conversionRatePercent: number | null
  }
}

interface SourceRow {
  readonly sourceId: string
  readonly name: string
  readonly revenue: MoneyDto
  readonly dealsWon: number
  readonly dealsTotal: number
  readonly sharePercent: number | null
  readonly conversionPercent: number | null
  readonly delta: DeltaDto
}

interface ProductRow {
  readonly productId: string
  readonly name: string
  readonly revenue: MoneyDto
  readonly units: number
  readonly sharePercent: number | null
}

export function SalesPage() {
  const { apiParams } = useDashboardFilters()

  const [sales, sources, products, funnel] = useQueries({
    queries: [
      {
        queryKey: ['sales', apiParams],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          apiGet<SalesPayload>('/analytics/sales', apiParams, signal),
        placeholderData: keepPreviousData,
      },
      {
        queryKey: ['sources', apiParams],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          apiGet<readonly SourceRow[]>('/analytics/sources', apiParams, signal),
        placeholderData: keepPreviousData,
      },
      {
        queryKey: ['products', apiParams],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          apiGet<readonly ProductRow[]>('/analytics/products', apiParams, signal),
        placeholderData: keepPreviousData,
      },
      {
        queryKey: ['funnel', apiParams],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          apiGet<readonly FunnelStepDto[]>('/analytics/funnel', apiParams, signal),
        placeholderData: keepPreviousData,
      },
    ],
  })

  const trend = sales.data?.data.trend ?? []
  const sourceRows = sources.data?.data ?? []
  const productRows = products.data?.data ?? []
  const funnelSteps = funnel.data?.data ?? []

  const sourceColumns: Column<SourceRow>[] = [
    {
      key: 'name',
      header: t.table.source,
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
      key: 'deals',
      header: t.table.dealsWon,
      align: 'right',
      numeric: true,
      render: (row) => `${formatNumber(row.dealsWon)} / ${formatNumber(row.dealsTotal)}`,
    },
    {
      key: 'conversion',
      header: t.table.conversion,
      align: 'right',
      numeric: true,
      render: (row) => formatPercent(row.conversionPercent),
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
      title={t.nav.sales}
      meta={sales.data?.meta}
      filters={{ employees: true, departments: true, products: true, sources: true, stages: true }}
    >
      <ChartCard title={t.chart.revenueTrend} hint={t.chart.revenueTrendHint}>
        {sales.isPending ? (
          <ChartSkeleton />
        ) : (
          <RevenueTrendChart data={trend} />
        )}
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title={t.chart.funnel} hint={t.chart.funnelHint}>
          {funnel.isPending ? <ChartSkeleton height={200} /> : <FunnelChart steps={funnelSteps} />}
        </ChartCard>

        <ChartCard title={t.chart.byProduct} hint="Eng yaxshi 8 ta">
          <BarList
            items={productRows.slice(0, 8).map((row) => ({
              id: row.productId,
              label: row.name,
              value: row.revenue.amount,
              sharePercent: row.sharePercent,
            }))}
          />
        </ChartCard>

        <ChartCard title={t.chart.bySource}>
          <BarList
            items={sourceRows.map((row) => ({
              id: row.sourceId,
              label: row.name,
              value: row.revenue.amount,
              sharePercent: row.sharePercent,
            }))}
          />
        </ChartCard>
      </div>

      <Card className="px-4 py-4">
        <h2
          className="mb-3 text-sm font-semibold tracking-tight"
          style={{ color: 'var(--ink-primary)' }}
        >
          {t.chart.bySource}
        </h2>
        <DataTable
          columns={sourceColumns}
          rows={sourceRows}
          rowKey={(row) => row.sourceId}
          status={sources.isError ? 'error' : sources.isPending ? 'loading' : 'ready'}
          errorMessage={
            sources.error instanceof ApiClientError ? sources.error.message : undefined
          }
          onRetry={() => void sources.refetch()}
          minWidth={760}
        />
      </Card>
    </PageShell>
  )
}

export { NO_VALUE }
