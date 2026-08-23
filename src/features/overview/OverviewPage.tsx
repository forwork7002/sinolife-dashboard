'use client'

import { useQueries } from '@tanstack/react-query'
import { useState } from 'react'

import { FunnelChart } from '@/components/charts/FunnelChart'
import { RevenueTrendChart } from '@/components/charts/RevenueTrendChart'
import { PeriodFilter, type PeriodPreset } from '@/components/layout/PeriodFilter'
import { Shell } from '@/components/layout/Shell'
import {
  ChartSkeleton,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
} from '@/components/states/States'
import { Card, ChartCard, KpiCard } from '@/components/ui/Card'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import {
  ApiClientError,
  type FunnelStepDto,
  type LeaderboardRowDto,
  type OverviewDto,
  type ResponseMeta,
  apiGet,
} from '@/lib/api'
import { formatCompactUzs, formatDate, formatNumber, formatPercent } from '@/lib/format'
import { t } from '@/lib/messages'

interface Loaded {
  overview: OverviewDto
  funnel: readonly FunnelStepDto[]
  leaderboard: readonly LeaderboardRowDto[]
  meta: ResponseMeta
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string; correlationId?: string }
  | { status: 'ready'; data: Loaded }

export function OverviewPage() {
  const [preset, setPreset] = useState<PeriodPreset>('this_month')

  /**
   * Three independent reads, issued together and cached per period.
   *
   * `useQueries` handles cancellation, stale-response ordering and retry, so
   * none of that is hand-rolled here — and because loading is derived from the
   * query state rather than set inside an effect, changing the period cannot
   * briefly render the previous period's numbers under the new label.
   */
  const [overview, funnel, leaderboard] = useQueries({
    queries: [
      {
        queryKey: ['overview', preset],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          apiGet<OverviewDto>('/dashboard/overview', { preset }, signal),
      },
      {
        queryKey: ['funnel', preset],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          apiGet<FunnelStepDto[]>('/analytics/funnel', { preset }, signal),
      },
      {
        queryKey: ['leaderboard', preset, 'revenue'],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          apiGet<LeaderboardRowDto[]>(
            '/analytics/leaderboard',
            { preset, metric: 'revenue' },
            signal,
          ),
      },
    ],
  })

  const queries = [overview, funnel, leaderboard]
  const firstError = queries.find((q) => q.isError)?.error

  const state: State = firstError
    ? {
        status: 'error',
        message:
          firstError instanceof ApiClientError ? firstError.message : t.state.errorBody,
        correlationId:
          firstError instanceof ApiClientError ? firstError.correlationId : undefined,
      }
    : overview.data && funnel.data && leaderboard.data
      ? {
          status: 'ready',
          data: {
            overview: overview.data.data,
            funnel: funnel.data.data,
            leaderboard: leaderboard.data.data,
            meta: overview.data.meta,
          },
        }
      : { status: 'loading' }

  const retry = () => {
    for (const query of queries) void query.refetch()
  }

  const ready = state.status === 'ready' ? state.data : null

  return (
    <Shell
      dataSource={ready?.meta.dataSource}
      lastSyncedAt={ready?.overview.lastSyncedAt}
      toolbar={<PeriodFilter value={preset} onChange={setPreset} />}
    >
      <div className="mx-auto max-w-[1400px] space-y-4">
        <PageHeader meta={ready?.meta} />

        {state.status === 'error' ? (
          <Card>
            <ErrorState
              message={state.message}
              correlationId={state.correlationId}
              onRetry={retry}
            />
          </Card>
        ) : (
          <>
            <KpiRow overview={ready?.overview} loading={state.status === 'loading'} />

            <div className="grid gap-4 lg:grid-cols-3">
              <ChartCard
                title={t.chart.revenueTrend}
                hint={t.chart.revenueTrendHint}
                className="lg:col-span-2"
              >
                {!ready ? (
                  <ChartSkeleton height={280} />
                ) : ready.overview.trend.length === 0 ? (
                  <EmptyState />
                ) : (
                  <RevenueTrendChart data={ready.overview.trend} />
                )}
              </ChartCard>

              <ChartCard title={t.chart.funnel} hint={t.chart.funnelHint}>
                {!ready ? (
                  <LoadingSkeleton rows={6} />
                ) : ready.funnel.every((s) => s.dealCount === 0) ? (
                  <EmptyState />
                ) : (
                  <FunnelChart steps={ready.funnel} />
                )}
              </ChartCard>
            </div>

            <ChartCard title={t.chart.leaderboard} hint={t.metric.revenue}>
              {!ready ? (
                <LoadingSkeleton rows={5} />
              ) : ready.leaderboard.length === 0 ? (
                <EmptyState />
              ) : (
                <LeaderboardTable rows={ready.leaderboard.slice(0, 8)} />
              )}
            </ChartCard>
          </>
        )}
      </div>
    </Shell>
  )
}

function PageHeader({ meta }: { meta?: ResponseMeta }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h1 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
        {t.nav.overview}
      </h1>
      {meta?.period && meta.comparisonPeriod && (
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {formatDate(meta.period.start)} – {formatDate(shiftBack(meta.period.end))}
          <span className="mx-1.5">·</span>
          {formatDate(meta.comparisonPeriod.start)} –{' '}
          {formatDate(shiftBack(meta.comparisonPeriod.end))} {t.period.comparedTo}
          {meta.comparisonTruncated && (
            <span
              className="ml-2 rounded px-1.5 py-0.5"
              style={{ background: 'var(--grid)', color: 'var(--ink-secondary)' }}
              title="Oldingi oy qisqaroq boʻlgani uchun taqqoslash davri kesildi"
            >
              {t.period.truncated}
            </span>
          )}
        </p>
      )}
    </div>
  )
}

/** Periods are half-open, so the displayed last day is one millisecond back. */
function shiftBack(iso: string): string {
  return new Date(new Date(iso).getTime() - 1).toISOString()
}

const CARD_LABELS: Record<string, string> = {
  revenue: t.cards.revenue,
  dealsWon: t.cards.dealsWon,
  dealsCreated: t.cards.dealsCreated,
  averageDeal: t.cards.averageDeal,
  conversion: t.cards.conversion,
  dealsOpen: t.cards.dealsOpen,
  pipeline: t.cards.pipeline,
}

function KpiRow({ overview, loading }: { overview?: OverviewDto; loading: boolean }) {
  if (loading || !overview) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <Card key={i} className="px-4 py-3.5">
            <LoadingSkeleton rows={2} />
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {overview.cards.map((card) => (
        <KpiCard key={card.key} card={card} label={CARD_LABELS[card.key] ?? card.key} />
      ))}
    </div>
  )
}

function LeaderboardTable({ rows }: { rows: readonly LeaderboardRowDto[] }) {
  const max = Math.max(1, ...rows.map((r) => r.revenue.amount))

  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr style={{ color: 'var(--ink-muted)' }}>
            <Th className="w-10 text-right">#</Th>
            <Th>{t.table.employee}</Th>
            <Th className="text-right">{t.table.revenue}</Th>
            <Th className="w-32">{t.table.share}</Th>
            <Th className="text-right">{t.table.dealsWon}</Th>
            <Th className="text-right">{t.table.conversion}</Th>
            <Th className="text-right">{t.table.kpi}</Th>
            <Th className="text-right">{t.table.growth}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.employeeId} className="border-t" style={{ borderColor: 'var(--border)' }}>
              <Td className="tabular text-right" style={{ color: 'var(--ink-muted)' }}>
                {row.rank}
              </Td>
              <Td>
                <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
                  {row.fullName}
                </span>
                {row.departmentName && (
                  <span className="ml-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
                    {row.departmentName}
                  </span>
                )}
              </Td>
              <Td className="tabular text-right font-medium">
                {formatCompactUzs(row.revenue.amount)}
              </Td>
              <Td>
                {/* One measure, one hue — this is a magnitude bar, not a series. */}
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full"
                  style={{ background: 'var(--grid)' }}
                  aria-hidden="true"
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(row.revenue.amount / max) * 100}%`,
                      background: 'var(--series-1)',
                    }}
                  />
                </div>
              </Td>
              <Td className="tabular text-right">{formatNumber(row.dealsWon)}</Td>
              <Td className="tabular text-right">{formatPercent(row.conversionPercent)}</Td>
              <Td className="tabular text-right">
                {formatPercent(row.kpiAchievementPercent, 0)}
              </Td>
              <Td className="text-right">
                <TrendIndicator delta={row.delta} />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`px-2 pb-2 text-left text-[11px] font-medium tracking-wide uppercase ${className}`}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  className = '',
  style,
}: {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <td className={`px-2 py-2.5 ${className}`} style={{ color: 'var(--ink-secondary)', ...style }}>
      {children}
    </td>
  )
}
