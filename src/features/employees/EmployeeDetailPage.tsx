'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'

import { RevenueTrendChart } from '@/components/charts/RevenueTrendChart'
import { ChartSkeleton, ErrorState } from '@/components/states/States'
import { Card, ChartCard } from '@/components/ui/Card'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import {
  ApiClientError,
  apiGet,
  type DeltaDto,
  type MoneyDto,
  type TrendPointDto,
} from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatNumber, formatPercent, formatUzs } from '@/lib/format'
import { t } from '@/lib/messages'

interface EmployeeDetail {
  readonly employee: {
    readonly id: string
    readonly fullName: string
    readonly position: string | null
    readonly departmentName: string | null
    readonly isActive: boolean
  }
  readonly current: {
    readonly revenue: MoneyDto
    readonly pipeline: MoneyDto
    readonly averageDeal: MoneyDto | null
    readonly dealsWon: number
    readonly dealsLost: number
    readonly dealsCreated: number
    readonly dealsOpen: number
    readonly conversionPercent: number | null
  }
  readonly deltas: { readonly revenue: DeltaDto; readonly dealsWon: DeltaDto }
  readonly teamSharePercent: number | null
  readonly versusTeamAveragePercent: number | null
  readonly kpiAchievementPercent: number | null
  readonly trend: readonly TrendPointDto[]
}

export function EmployeeDetailPage({ employeeId }: { employeeId: string }) {
  const { apiParams } = useDashboardFilters()

  const query = useQuery({
    queryKey: ['employee', employeeId, apiParams],
    queryFn: ({ signal }) =>
      apiGet<EmployeeDetail>(`/employees/${employeeId}`, apiParams, signal),
    placeholderData: (previous) => previous,
    retry: (count, error) =>
      error instanceof ApiClientError && error.status === 404 ? false : count < 1,
  })

  const data = query.data?.data

  return (
    <PageShell
      title={data?.employee.fullName ?? t.nav.employees}
      description={
        data
          ? [data.employee.position, data.employee.departmentName].filter(Boolean).join(' · ')
          : undefined
      }
      meta={query.data?.meta}
      actions={
        <Link
          href="/employees"
          className="rounded-lg border px-2.5 py-1.5 text-xs font-medium"
          style={{ borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
        >
          ← {t.nav.employees}
        </Link>
      }
    >
      {query.isError ? (
        <Card>
          <ErrorState
            message={
              query.error instanceof ApiClientError && query.error.status === 404
                ? 'Xodim topilmadi yoki koʻrishga ruxsatingiz yoʻq.'
                : undefined
            }
            onRetry={() => void query.refetch()}
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label={t.cards.revenue}
              value={data ? `${formatCompactUzs(data.current.revenue.amount)} soʻm` : NO_VALUE}
              title={data ? formatUzs(data.current.revenue.amount) : undefined}
              delta={data?.deltas.revenue}
            />
            <Metric
              label={t.cards.dealsWon}
              value={data ? formatNumber(data.current.dealsWon) : NO_VALUE}
              delta={data?.deltas.dealsWon}
            />
            <Metric
              label={t.cards.averageDeal}
              value={
                data?.current.averageDeal
                  ? `${formatCompactUzs(data.current.averageDeal.amount)} soʻm`
                  : NO_VALUE
              }
            />
            <Metric
              label={t.cards.conversion}
              value={formatPercent(data?.current.conversionPercent ?? null)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label={t.cards.dealsCreated} value={data ? formatNumber(data.current.dealsCreated) : NO_VALUE} small />
            <Metric label={t.cards.dealsOpen} value={data ? formatNumber(data.current.dealsOpen) : NO_VALUE} small />
            <Metric
              label={t.cards.pipeline}
              value={data ? `${formatCompactUzs(data.current.pipeline.amount)} soʻm` : NO_VALUE}
              small
            />
            <Metric label={t.cards.kpiAchievement} value={formatPercent(data?.kpiAchievementPercent ?? null, 0)} small />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard title={t.chart.revenueTrend} hint={t.chart.revenueTrendHint} className="lg:col-span-2">
              {!data ? <ChartSkeleton /> : <RevenueTrendChart data={data.trend} />}
            </ChartCard>

            <ChartCard title="Jamoaga nisbatan">
              <div className="space-y-4 py-1">
                <Comparison
                  label="Jamoa tushumidagi ulush"
                  percent={data?.teamSharePercent ?? null}
                  max={100}
                />
                <Comparison
                  label="Jamoa oʻrtachasiga nisbatan"
                  percent={data?.versusTeamAveragePercent ?? null}
                  max={200}
                  // 100 is exactly average, so that is where the marker sits.
                  marker={100}
                />
                <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  100% — jamoa oʻrtachasi bilan bir xil natija.
                </p>
              </div>
            </ChartCard>
          </div>
        </>
      )}
    </PageShell>
  )
}

function Metric({
  label,
  value,
  delta,
  title,
  small,
}: {
  label: string
  value: string
  delta?: DeltaDto
  title?: string
  small?: boolean
}) {
  return (
    <Card className="px-4 py-3.5">
      <p className="truncate text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </p>
      <p
        className={`mt-1.5 leading-none font-semibold tracking-tight ${small ? 'text-lg' : 'text-2xl'}`}
        style={{ color: 'var(--ink-primary)' }}
        title={title}
      >
        {value}
      </p>
      {delta && (
        <div className="mt-2">
          <TrendIndicator delta={delta} />
        </div>
      )}
    </Card>
  )
}

function Comparison({
  label,
  percent,
  max,
  marker,
}: {
  label: string
  percent: number | null
  max: number
  marker?: number
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {label}
        </span>
        <span className="tabular text-xs font-medium" style={{ color: 'var(--ink-primary)' }}>
          {formatPercent(percent, 0)}
        </span>
      </div>
      <div
        className="relative mt-1.5 h-2 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--grid)' }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${percent === null ? 0 : Math.min(100, (percent / max) * 100)}%`,
            background: 'var(--series-1)',
          }}
        />
        {marker !== undefined && (
          <span
            className="absolute top-0 h-full w-px"
            style={{ left: `${(marker / max) * 100}%`, background: 'var(--ink-muted)' }}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  )
}
