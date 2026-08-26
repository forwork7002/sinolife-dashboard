'use client'

import { useQueries } from '@tanstack/react-query'

import { FunnelChart } from '@/components/charts/FunnelChart'
import { RevenueTrendChart } from '@/components/charts/RevenueTrendChart'
import { PeriodFilter } from '@/components/layout/PeriodFilter'
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
  type CallsDto,
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
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'

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
  calls?: CallsDto
  /**
   * How the three reads went.
   *
   * These load independently of the headline, so a tile here can be waiting,
   * failed, or genuinely empty while the rest of the page is finished. All
   * three rendered as the same em dash until now, which reads as "no data" —
   * a confident answer to a question nobody got a reply to.
   */
  status: 'loading' | 'error' | 'ready'
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string; correlationId?: string }
  | { status: 'ready'; data: Loaded }

export function OverviewPage() {
  /**
   * The period lives in the URL, like every other page.
   *
   * This screen used to keep it in local state, which meant navigating to
   * Logistics and back silently reset the window to "this month" — and a
   * shared link to the overview never carried the dates the sender was
   * looking at.
   */
  const { filters, setPeriod } = useDashboardFilters()
  const { preset } = filters
  const window = { preset, ...(preset === 'custom' && filters.from && filters.to
    ? { from: filters.from, to: filters.to }
    : {}) }

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
        queryKey: ['overview', window],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          apiGet<OverviewDto>('/dashboard/overview', window, signal),
      },
      {
        queryKey: ['funnel', window],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          apiGet<FunnelStepDto[]>('/analytics/funnel', window, signal),
      },
      {
        queryKey: ['leaderboard', window, 'revenue'],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          apiGet<LeaderboardRowDto[]>(
            '/analytics/leaderboard',
            { ...window, metric: 'revenue' },
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
        queryKey: ['ops-logistics', window],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          apiGet<LogisticsDto>('/insights/logistics', window, signal),
      },
      {
        queryKey: ['ops-confirmation', window],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          apiGet<ConfirmationDto>('/insights/confirmations', window, signal),
      },
      {
        queryKey: ['ops-calls', window],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          apiGet<CallsDto>('/insights/calls', window, signal),
      },
    ],
  })

  const operations: Operations = {
    status: [logistics, confirmation, calls].some((q) => q.isError)
      ? ('error' as const)
      : [logistics, confirmation, calls].some((q) => q.isPending)
        ? ('loading' as const)
        : ('ready' as const),
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
      toolbar={
        <PeriodFilter
          value={preset}
          from={filters.from}
          to={filters.to}
          onChange={setPeriod}
        />
      }
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
                fill
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

/**
 * The same header every other screen has.
 *
 * It used to be 18px with the period range right-aligned on its own row, while
 * every PageShell page is 20px with the range under the title. The overview is
 * the screen people arrive on, so being the odd one out cost more here than
 * anywhere else — and the smaller title made the page look like a section of
 * something rather than the top of it.
 */
function PageHeader({ meta }: { meta?: ResponseMeta }) {
  return (
    <header className="min-w-0">
      <div className="accent-rule mb-2.5" aria-hidden="true" />
      <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
        {t.nav.overview}
      </h1>
      {meta?.period && meta.comparisonPeriod && (
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
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
    </header>
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

      <div className="stagger grid gap-3 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-3 xl:col-span-3">
        {rest.map((card) => (
          <StatTile
            // This row renders only once `overview` has resolved — KpiRow
            // returns skeletons otherwise — so the state here is always ready.
            status="ready"
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
      /*
        `pt-3.5` matches StatTile, not `p-5`.
        
        All four cards in this row start at the same y, and the hero's label is
        the same 11px uppercase type as its three neighbours' — but 20px of top
        padding against their 14px put identical labels on two baselines, 6px
        apart, in a single row. The generous padding stays everywhere else.
      */
      className="card flex flex-col justify-between px-5 pt-3.5 pb-5"
      style={{
        // The one card that is deliberately more raised than the rest: it
        // carries the number the whole screen exists to show.
        borderRadius: 'var(--radius-panel-lg)',
        boxShadow: 'var(--shadow-raised), var(--edge-highlight)',
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
          className="figure display mt-2 text-[46px] leading-none font-semibold"
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
          <span
            className="text-[11px]"
            style={{ color: 'var(--ink-muted)' }}
            title={t.period.closedBasis}
          >
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
  const { logistics, confirmation, calls, status: tileStatus } = operations

  const totalTalkHours =
    calls === undefined
      ? null
      : Math.round(calls.rows.reduce((sum, row) => sum + row.talkSeconds, 0) / 3600)

  const activeCallers = calls?.rows.filter((row) => row.connected > 0).length ?? null
  const connectedCalls = calls ? calls.inbound.connected + calls.outbound.connected : 0
  const totalAttempts = calls ? calls.inbound.calls + calls.outbound.calls : 0

  return (
    <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        status={tileStatus}
        label="Yetkazish darajasi"
        value={logistics?.totals.deliveryRate ?? null}
        unit="percent"
        /**
         * The fraction the rate is ACTUALLY computed from.
         *
         * This used to print `delivered / orders` — 898 / 2,191 — under a
         * headline of 91.6%. That fraction is 41.0%. The rate divides by
         * RESOLVED orders (delivered + refused + cancelled), because an order
         * still in transit has not failed to arrive; the hint divided by every
         * order in the window, including the 1,211 still moving. Two numbers
         * that cannot both be right, printed one above the other.
         */
        hint={
          logistics
            ? `${formatNumber(logistics.totals.delivered)} / ${formatNumber(
                logistics.totals.delivered +
                  logistics.totals.refused +
                  logistics.totals.cancelledEarly,
              )} yakunlangan · ${formatNumber(logistics.totals.inFlight)} yoʻlda`
            : 'yuklanmoqda'
        }
        /*
          Deliberately ungraded HERE, though the same figure is graded on the
          logistics page. This tile sat two rows under the revenue hero as the
          only saturated colour in the top third of the screen, so the eye
          landed on a delivery rate before it landed on the number the page
          exists to state. The meter below carries the same judgement without
          competing for the reader's first fixation.
        */
        context={<Meter value={logistics?.totals.deliveryRate ?? null} />}
      />
      {/*
        Coverage, not "confirmation rate".
        
        The rate this tile used to show was confirmed / (confirmed +
        unreachable), and it read 100.0% in every period — the portal records
        the confirmed outcome and never the unreachable one, so the denominator
        could not differ from the numerator. A quarter of the operations row
        was spent on a number that could not move, presented as a perfect
        score. Coverage is the thing that varies, and it is the same figure the
        Tasdiqlash page headlines, so the two pages now agree.
      */}
      <StatTile
        status={tileStatus}
        label="Tasdiqlash qamrovi"
        value={confirmation?.totals.coverage ?? null}
        unit="percent"
        hint={
          confirmation
            ? `${formatNumber(confirmation.totals.confirmed)} / ${formatNumber(
                confirmation.totals.orders,
              )} navbatdan`
            : 'yuklanmoqda'
        }
        context={<Meter value={confirmation?.totals.coverage ?? null} tone="neutral" />}
      />
      {/*
        These two carry a `context` slot like their neighbours.
        
        Without one the row ended ragged: the two left-hand tiles ran 24px
        taller because a Meter sat under their value, leaving 44px of empty
        card on the right against 20px on the left. The proportions below are
        the ones each tile already implies — the share of attempts that
        connected, and the share of the team that called anyone.
      */}
      <StatTile
        status={tileStatus}
        label="Mijoz bilan suhbat"
        value={totalTalkHours}
        unit="hours"
        hint={
          calls
            ? `${formatNumber(connectedCalls)} ulangan · ${formatNumber(totalAttempts)} urinishdan`
            : 'yuklanmoqda'
        }
        context={
          <Meter
            value={totalAttempts > 0 ? (connectedCalls / totalAttempts) * 100 : null}
            tone="neutral"
          />
        }
      />
      <StatTile
        status={tileStatus}
        label="Qoʻngʻiroq qilgan xodim"
        value={activeCallers}
        unit="count"
        hint="Davr davomida kamida bitta ulangan qoʻngʻiroq"
        context={
          <Meter
            value={
              activeCallers !== null && calls && calls.rows.length > 0
                ? (activeCallers / calls.rows.length) * 100
                : null
            }
            tone="neutral"
          />
        }
      />
    </div>
  )
}

function LeaderboardTable({ rows }: { rows: readonly LeaderboardRowDto[] }) {
  const max = Math.max(1, ...rows.map((r) => r.revenue.amount))
  // The kpi table is empty on this portal, so the column is em dashes all the
  // way down — costing width and teaching the reader to skip a column that
  // will matter the day targets are loaded.
  const hasKpiTargets = rows.some((r) => r.kpiAchievementPercent !== null)

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
            {hasKpiTargets && <Th className="text-right">{t.table.kpi}</Th>}
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
              {hasKpiTargets && (
                <Td className="tabular text-right">
                  {formatPercent(row.kpiAchievementPercent, 0)}
                </Td>
              )}
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
