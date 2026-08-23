'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Card } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { ApiClientError, apiGet, type LeaderboardRowDto } from '@/lib/api'
import { formatCompactUzs, formatNumber, formatPercent, formatUzs } from '@/lib/format'
import { t } from '@/lib/messages'

type Metric = 'revenue' | 'deals_won' | 'conversion' | 'kpi_achievement'

const METRICS = [
  { value: 'revenue' as const, label: t.metric.revenue },
  { value: 'deals_won' as const, label: t.metric.deals_won },
  { value: 'conversion' as const, label: t.metric.conversion },
  { value: 'kpi_achievement' as const, label: t.metric.kpi_achievement },
]

export function LeaderboardPage() {
  const { apiParams } = useDashboardFilters()
  const [metric, setMetric] = useState<Metric>('revenue')

  const query = useQuery({
    queryKey: ['leaderboard', apiParams, metric],
    queryFn: ({ signal }) =>
      apiGet<readonly LeaderboardRowDto[]>(
        '/analytics/leaderboard',
        { ...apiParams, metric },
        signal,
      ),
    placeholderData: (previous) => previous,
  })

  const rows = query.data?.data ?? []
  const podium = rows.slice(0, 3)

  const columns: Column<LeaderboardRowDto>[] = [
    {
      key: 'rank',
      header: t.table.rank,
      width: '56px',
      align: 'right',
      numeric: true,
      render: (row) => (
        <span style={{ color: row.rank <= 3 ? 'var(--ink-primary)' : 'var(--ink-muted)' }}>
          {row.rank}
          {/* Ties share a rank; marking them stops the repeat looking like a bug. */}
          {row.tied && <span title="Teng natija"> =</span>}
        </span>
      ),
    },
    {
      key: 'name',
      header: t.table.employee,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium" style={{ color: 'var(--ink-primary)' }}>
            {row.fullName}
          </p>
          {row.departmentName && (
            <p className="truncate text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {row.departmentName}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'revenue',
      header: t.table.revenue,
      align: 'right',
      numeric: true,
      render: (row) => (
        <span
          style={{ color: metric === 'revenue' ? 'var(--ink-primary)' : undefined }}
          title={formatUzs(row.revenue.amount)}
        >
          {formatCompactUzs(row.revenue.amount)}
        </span>
      ),
    },
    {
      key: 'dealsWon',
      header: t.table.dealsWon,
      align: 'right',
      numeric: true,
      render: (row) => (
        <span style={{ color: metric === 'deals_won' ? 'var(--ink-primary)' : undefined }}>
          {formatNumber(row.dealsWon)}
        </span>
      ),
    },
    {
      key: 'conversion',
      header: t.table.conversion,
      align: 'right',
      numeric: true,
      render: (row) => (
        <span style={{ color: metric === 'conversion' ? 'var(--ink-primary)' : undefined }}>
          {formatPercent(row.conversionPercent)}
        </span>
      ),
    },
    {
      key: 'kpi',
      header: t.table.kpi,
      align: 'right',
      numeric: true,
      render: (row) => (
        <span style={{ color: metric === 'kpi_achievement' ? 'var(--ink-primary)' : undefined }}>
          {formatPercent(row.kpiAchievementPercent, 0)}
        </span>
      ),
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
      title={t.nav.leaderboard}
      description="Bitta koʻrsatkich boʻyicha tartiblangan"
      meta={query.data?.meta}
      filters={{ departments: true }}
      actions={
        <SegmentedControl
          ariaLabel="Koʻrsatkich"
          value={metric}
          options={METRICS}
          onChange={setMetric}
        />
      }
    >
      {podium.length === 3 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {podium.map((row, index) => (
            <Card key={row.employeeId} className="px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                  style={{
                    // Ordinal ramp: first place darkest. One hue, because this
                    // is a rank, not three unrelated categories.
                    background:
                      index === 0 ? 'var(--seq-450)' : index === 1 ? 'var(--seq-350)' : 'var(--seq-250)',
                    color: index === 0 ? '#fff' : 'var(--ink-primary)',
                  }}
                  aria-hidden="true"
                >
                  {row.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-medium"
                    style={{ color: 'var(--ink-primary)' }}
                  >
                    {row.fullName}
                  </p>
                  <p className="tabular truncate text-xs" style={{ color: 'var(--ink-secondary)' }}>
                    {metric === 'revenue' && formatCompactUzs(row.revenue.amount) + ' soʻm'}
                    {metric === 'deals_won' && `${formatNumber(row.dealsWon)} ta bitim`}
                    {metric === 'conversion' && formatPercent(row.conversionPercent)}
                    {metric === 'kpi_achievement' && formatPercent(row.kpiAchievementPercent, 0)}
                  </p>
                </div>
                <TrendIndicator delta={row.delta} />
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="px-4 py-4">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.employeeId}
          status={query.isError ? 'error' : query.isPending ? 'loading' : 'ready'}
          errorMessage={query.error instanceof ApiClientError ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
          minWidth={880}
        />
      </Card>
    </PageShell>
  )
}
