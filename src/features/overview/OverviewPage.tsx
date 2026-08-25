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
import { Sparkline } from '@/components/charts/Sparkline'
import { Card, ChartCard } from '@/components/ui/Card'
import { Meter, RankBadge, StatTile } from '@/components/ui/Stat'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import {
  ApiClientError,
  type CallActivityDto,
  type ConfirmationDto,
  type FunnelStepDto,
  type KpiCardDto,
  type LeaderboardRowDto,
  type LogisticsDto,
  type OverviewDto,
  type ResponseMeta,
  apiGet,
} from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatDate, formatNumber, formatPercent, formatUzs } from '@/lib/format'
import { t } from '@/lib/messages'

interface Loaded {
  overview: OverviewDto
  funnel: readonly FunnelStepDto[]
  leaderboard: readonly LeaderboardRowDto[]
  meta: ResponseMeta
}

/**
 * The operational row.
 *
 * Loaded separately from the sales figures and allowed to be missing. These
 * three reads are each an indexed aggregate over a different table, and the
 * page is worth showing the moment revenue is known — waiting for delivery
 * timings before rendering the headline would make the whole screen as slow as
 * its slowest question.
 */
interface Operations {
  logistics?: LogisticsDto
  confirmation?: ConfirmationDto
  calls?: readonly CallActivityDto[]
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

  /**
   * Operational reads, deliberately outside the readiness gate.
   *
   * If delivery or telephony is slow or empty, the sales half of the page
   * still renders. Each tile below reports its own absence rather than
   * blocking the others.
   */
  const [logistics, confirmation, calls] = useQueries({
    queries: [
      {
        queryKey: ['ops-logistics', preset],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          apiGet<LogisticsDto>('/insights/logistics', { preset }, signal),
      },
      {
        queryKey: ['ops-confirmation', preset],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          apiGet<ConfirmationDto>('/insights/confirmations', { preset }, signal),
      },
      {
        queryKey: ['ops-calls', preset],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          apiGet<CallActivityDto[]>('/insights/calls', { preset }, signal),
      },
    ],
  })

  const operations: Operations = {
    logistics: logistics.data?.data,
    confirmation: confirmation.data?.data,
    calls: calls.data?.data,
  }

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

            <OperationsRow operations={operations} />

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

            <ChartCard
              title={t.chart.leaderboard}
              hint="Tushum boʻyicha. Ustunlar birinchi oʻrinning ulushiga nisbatan."
            >
              {!ready ? (
                <LoadingSkeleton rows={5} />
              ) : ready.leaderboard.length === 0 ? (
                <EmptyState />
              ) : (
                <LeaderboardTable rows={ready.leaderboard.slice(0, 10)} />
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

/**
 * The headline row.
 *
 * Revenue is given a wider tile and its own trend line, because it is the
 * number the page exists to state and the six beside it are context for it.
 * Everything else keeps a delta, so no figure sits without a reference point.
 */
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

  const revenue = overview.cards.find((c) => c.key === 'revenue')
  const rest = overview.cards.filter((c) => c.key !== 'revenue')
  const trend = overview.trend.map((point) => point.revenue)

  return (
    <div className="grid gap-3 lg:grid-cols-3 xl:grid-cols-4">
      {revenue && <HeroCard card={revenue} trend={trend} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-3 xl:col-span-3">
        {rest.map((card) => (
          <StatTile
            key={card.key}
            label={CARD_LABELS[card.key] ?? card.key}
            value={card.value}
            unit={card.unit === 'money' ? 'money' : card.unit === 'percent' ? 'percent' : 'count'}
            context={<TrendIndicator delta={card.delta} />}
          />
        ))}
      </div>
    </div>
  )
}

/** Revenue, at the size the number deserves, with the period's shape beneath. */
function HeroCard({ card, trend }: { card: KpiCardDto; trend: readonly number[] }) {
  return (
    <div
      className="rise flex flex-col justify-between rounded-[var(--radius-lg)] border p-5"
      style={{
        background: 'var(--surface)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--shadow-raised)',
      }}
    >
      <div>
        <p
          className="text-[11px] font-medium tracking-wide uppercase"
          style={{ color: 'var(--ink-muted)' }}
        >
          {t.cards.revenue}
        </p>
        <p
          className="figure mt-2 text-[38px] leading-none font-semibold"
          style={{ color: 'var(--ink-primary)' }}
          title={card.money ? formatUzs(card.money.amount) : undefined}
        >
          {card.money ? formatCompactUzs(card.money.amount) : NO_VALUE}
          <span className="ml-1.5 text-sm font-normal" style={{ color: 'var(--ink-muted)' }}>
            soʻm
          </span>
        </p>
        <div className="mt-2 flex items-center gap-2">
          <TrendIndicator delta={card.delta} />
          <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {t.period.comparedTo}
          </span>
        </div>
      </div>

      <div className="mt-4">
        <Sparkline values={trend} color="var(--series-1)" height={40} label="Davr boʻyicha tushum" />
      </div>
    </div>
  )
}

/**
 * How the work went, next to how much it earned.
 *
 * Revenue alone does not say whether the orders arrived, whether operators
 * reached anyone, or how much of the team's day was spent talking to
 * customers. These four are the operational half of the same question, and
 * each reports "not connected" independently rather than showing a zero for a
 * source that has not been read yet.
 */
function OperationsRow({ operations }: { operations: Operations }) {
  const { logistics, confirmation, calls } = operations

  const totalTalkHours =
    calls === undefined
      ? null
      : Math.round(calls.reduce((sum, row) => sum + row.talkSeconds, 0) / 3600)

  const activeCallers = calls?.filter((row) => row.connected > 0).length ?? null

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        label="Yetkazish darajasi"
        value={logistics?.totals.deliveryRate ?? null}
        unit="percent"
        hint={
          logistics
            ? `${formatNumber(logistics.totals.delivered)} / ${formatNumber(logistics.totals.orders)} buyurtma`
            : 'yuklanmoqda'
        }
        tone={
          logistics === undefined
            ? 'neutral'
            : logistics.totals.deliveryRate >= 85
              ? 'good'
              : logistics.totals.deliveryRate >= 60
                ? 'warning'
                : 'critical'
        }
        context={<Meter value={logistics?.totals.deliveryRate ?? null} />}
      />
      <StatTile
        label="Tasdiqlash darajasi"
        value={confirmation?.totals.confirmRate ?? null}
        unit="percent"
        hint={
          confirmation
            ? `${formatNumber(confirmation.totals.confirmed)} tasdiqlangan`
            : 'yuklanmoqda'
        }
        context={<Meter value={confirmation?.totals.confirmRate ?? null} tone="neutral" />}
      />
      <StatTile
        label="Mijoz bilan suhbat"
        value={totalTalkHours}
        unit="hours"
        hint={
          calls
            ? `${formatNumber(calls.reduce((sum, r) => sum + r.connected, 0))} ta ulangan qoʻngʻiroq`
            : 'yuklanmoqda'
        }
      />
      <StatTile
        label="Qoʻngʻiroq qilgan xodim"
        value={activeCallers}
        unit="count"
        hint="Davr davomida kamida bitta ulangan qoʻngʻiroq"
      />
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
              <Td className="text-right">
                <RankBadge rank={row.rank} />
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
