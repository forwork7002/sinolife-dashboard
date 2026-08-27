'use client'

import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'

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
import { Card, ChartCard, KpiCard } from '@/components/ui/Card'
import { GaugeTile, Meter, RankBadge, StatTile, StatusChip } from '@/components/ui/Stat'
import { Tooltip } from '@/components/ui/Tooltip'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import {
  ApiClientError,
  type CallsDto,
  type ConfirmationDto,
  type FlowAgingDto,
  type FlowDto,
  type FunnelStepDto,
  type KpiCardDto,
  type LeaderboardRowDto,
  type LogisticsDto,
  type OverviewDto,
  type PulseDto,
  type PulseForecastDto,
  type PulseVelocityDto,
  type PulseWinRateDto,
  type ResponseMeta,
  apiGet,
} from '@/lib/api'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { NO_VALUE, formatCompactUzs, formatDate, formatNumber, formatPercent, formatUzs } from '@/lib/format'
import { t } from '@/lib/messages'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'

interface Loaded {
  overview: OverviewDto
  funnel: readonly FunnelStepDto[]
  leaderboard: readonly LeaderboardRowDto[]
  meta: ResponseMeta
}

/** The three renderings every independent read must keep distinct. */
type TileStatus = 'loading' | 'error' | 'ready'

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
  status: TileStatus
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string; correlationId?: string }
  | { status: 'ready'; data: Loaded }

/**
 * The Linear glow, wired the cheap way.
 *
 * `.glow-track` paints a pointer-following radial from `--mx`/`--my`; the
 * only job of this handler is to keep those two custom properties current.
 * It writes them straight onto the element instead of going through state,
 * so a 60Hz mousemove costs zero React renders — and when the CSS guard
 * (`hover:hover` + `no-preference`) removes the pseudo-element entirely,
 * the writes land on properties nothing reads, which is as close to free
 * as a listener gets.
 */
function trackGlow(event: React.MouseEvent<HTMLElement>) {
  const el = event.currentTarget
  const rect = el.getBoundingClientRect()
  el.style.setProperty('--mx', `${event.clientX - rect.left}px`)
  el.style.setProperty('--my', `${event.clientY - rect.top}px`)
}

export function OverviewPage() {
  /**
   * The period lives in the URL, like every other page.
   *
   * This screen used to keep it in local state, which meant navigating to
   * Logistics and back silently reset the window to "this month" — and a
   * shared link to the overview never carried the dates the sender was
   * looking at.
   */
  const { filters, setPeriod, apiParams } = useDashboardFilters()
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
   * The pulse and flow reads — the projection, velocity and stuck-deal
   * panels. Fetched apart from the headline for the same reason the
   * operations row is: each is a heavier percentile query, and the hero
   * must render the moment revenue is known. `keepPreviousData` lets a
   * period change morph the numbers in place (AnimatedNumber glides them)
   * instead of dropping the band back to skeletons.
   */
  const pulse = useQuery({
    queryKey: ['pulse', apiParams],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      apiGet<PulseDto>('/insights/pulse', apiParams, signal),
    placeholderData: keepPreviousData,
  })
  const flow = useQuery({
    queryKey: ['flow', apiParams],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      apiGet<FlowDto>('/insights/flow', apiParams, signal),
    placeholderData: keepPreviousData,
  })

  const pulseStatus: TileStatus = pulse.isError ? 'error' : pulse.data ? 'ready' : 'loading'
  const flowStatus: TileStatus = flow.isError ? 'error' : flow.data ? 'ready' : 'loading'

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
            <BentoHero
              overview={ready?.overview}
              loading={state.status === 'loading'}
              pulse={pulse.data?.data}
              pulseStatus={pulseStatus}
            />

            <KpiRow overview={ready?.overview} loading={state.status === 'loading'} />

            {/*
              The operations region: how the work went, next to how much of it
              is stuck. The four tiles fold to a 2×2 block beside the aging
              panel on wide screens — hierarchy by area, not by an equal grid.
            */}
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 xl:col-span-8">
                <OperationsRow operations={operations} />
              </div>
              <div className="col-span-12 xl:col-span-4">
                <StuckDealsPanel
                  aging={flow.data?.data.aging}
                  status={flowStatus}
                  onRetry={() => void flow.refetch()}
                />
              </div>
            </div>

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
                  /*
                    No `referenceValue`: the honest reference here would be the
                    previous period's DAILY AVERAGE, and no endpoint exposes
                    it — PulseForecastDto carries the previous full unit's
                    total but not its day count, and reconstructing the total
                    from a rounded delta percent would be manufacturing a
                    number. Omitted rather than faked.
                  */
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
            /* The explanation carries information, so it rides the Tooltip
               primitive — reachable by touch and keyboard, not only hover. */
            <Tooltip content="Oldingi oy qisqaroq boʻlgani uchun taqqoslash davri kesildi">
              <span
                className="ml-2 rounded px-1.5 py-0.5"
                style={{ background: 'var(--grid)', color: 'var(--ink-secondary)' }}
              >
                {t.period.truncated}
              </span>
            </Tooltip>
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
 * The bento hero — the page's ONE lead instrument, with its two wingmen.
 *
 * Revenue takes the wide panel and the page's single `.figure-hero`; sales
 * velocity and the win rate stack beside it at tile size. The 12-column split
 * (8/4 wide, 7/5 mid) is hierarchy by area: the reader meets the period's
 * money first, and the two derived rates read as commentary on it, not as
 * competitors.
 */
function BentoHero({
  overview,
  loading,
  pulse,
  pulseStatus,
}: {
  overview?: OverviewDto
  loading: boolean
  pulse?: PulseDto
  pulseStatus: TileStatus
}) {
  const revenue = overview?.cards.find((c) => c.key === 'revenue')
  const trend = overview?.trend.map((point) => point.revenue) ?? []

  return (
    <div className="grid grid-cols-12 gap-4">
      {/*
        Brackets on a WRAPPER, glow on the card: both classes draw with
        `::after`, so stacking them on one element would weld the two rules
        into one broken pseudo — globals.css documents the split.
      */}
      <div className="brackets col-span-12 lg:col-span-7 xl:col-span-8">
        <HeroInstrument
          card={revenue}
          trend={trend}
          loading={loading}
          forecast={pulse?.forecast}
          pulseStatus={pulseStatus}
        />
      </div>

      <div className="col-span-12 grid gap-4 sm:grid-cols-2 lg:col-span-5 lg:grid-cols-1 xl:col-span-4">
        <VelocityTile velocity={pulse?.velocity} status={pulseStatus} />
        <WinRateTile winRate={pulse?.winRate} status={pulseStatus} />
      </div>
    </div>
  )
}

/**
 * The lead instrument: period revenue at hero size, the period's shape under
 * it, and the run-rate projection along the bottom edge.
 *
 * The headline and the projection degrade independently — the revenue half
 * answers from `/dashboard/overview`, the forecast strip from
 * `/insights/pulse` — so a slow percentile query can never hold the page's
 * reason for existing hostage.
 */
function HeroInstrument({
  card,
  trend,
  loading,
  forecast,
  pulseStatus,
}: {
  card?: KpiCardDto
  trend: readonly number[]
  loading: boolean
  forecast?: PulseForecastDto
  pulseStatus: TileStatus
}) {
  return (
    <section
      className="card card-hero glow-track flex h-full flex-col px-5 pt-4 pb-5"
      onMouseMove={trackGlow}
      aria-label={t.cards.revenue}
    >
      <div>
        <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
          {t.cards.revenue}
        </p>

        {loading || !card ? (
          // Sized to the hero figure below, so ready never reflows loading.
          <div className="skeleton mt-2 h-[40px] w-64" role="status">
            <span className="sr-only">Yuklanmoqda</span>
          </div>
        ) : card.money ? (
          /*
            The exact soʻm amount rides the Tooltip primitive, not a native
            `title`: hover, focus AND touch. The figure is a tab stop — the
            full ten-digit number is otherwise unreachable without a mouse.
          */
          <div className="mt-2">
            <Tooltip content={<span className="tabular">{formatUzs(card.money.amount)}</span>}>
              <span
                tabIndex={0}
                className="focusable figure-hero block w-fit rounded-[var(--radius-panel-sm)]"
                style={{ color: 'var(--ink-primary)' }}
              >
                <AnimatedNumber value={card.money.amount} format={formatCompactUzs} duration={900} />
                <span className="ml-1.5 text-sm font-normal" style={{ color: 'var(--ink-muted)' }}>
                  soʻm
                </span>
              </span>
            </Tooltip>
          </div>
        ) : (
          <p className="figure-hero mt-2" style={{ color: 'var(--ink-primary)' }}>
            {NO_VALUE}
          </p>
        )}

        {!loading && card && (
          <div className="mt-2.5 flex items-center gap-2">
            <TrendIndicator delta={card.delta} />
            <Tooltip content={t.period.closedBasis}>
              <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                {t.period.comparedTo}
              </span>
            </Tooltip>
          </div>
        )}
      </div>

      {/* `mt-auto` pins the shape and the projection to the bottom edge, so
          the panel keeps its composure at whatever height the side stack
          gives the row. */}
      <div className="mt-auto pt-4">
        {loading ? (
          <div className="skeleton h-12 w-full" role="status">
            <span className="sr-only">Yuklanmoqda</span>
          </div>
        ) : (
          <Sparkline values={trend} color="var(--series-1)" height={48} label="Davr boʻyicha tushum" />
        )}
      </div>

      <ForecastStrip forecast={forecast} status={pulseStatus} />
    </section>
  )
}

/**
 * "Davr prognozi" — the run-rate projection along the hero's bottom edge.
 *
 * Three honest parts: the projected figure (period-to-date ÷ elapsed
 * fraction), the meter stating HOW MUCH of the unit that fraction is — a
 * projection from 8% of a month deserves visible scepticism — and the
 * previous full unit's total as the caption the delta is read against.
 */
function ForecastStrip({ forecast, status }: { forecast?: PulseForecastDto; status: TileStatus }) {
  return (
    <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
      <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
        Davr prognozi
      </p>

      {status === 'loading' ? (
        <div className="skeleton mt-2 h-[22px] w-44" role="status">
          <span className="sr-only">Yuklanmoqda</span>
        </div>
      ) : status === 'error' || !forecast ? (
        <p
          className="mt-2 text-base font-medium"
          style={{ color: 'var(--status-critical)' }}
          // Decorative title — it only repeats the visible word.
          title="Maʼlumot olinmadi"
        >
          Olinmadi
        </p>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className="figure text-[22px] leading-none font-semibold"
                style={{ color: 'var(--ink-primary)' }}
              >
                {forecast.projected ? (
                  <>
                    <AnimatedNumber value={forecast.projected.amount} format={formatCompactUzs} />
                    <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
                      soʻm
                    </span>
                  </>
                ) : (
                  // Null, never zero: under 2% of the unit elapsed the
                  // run-rate is arithmetic, not information.
                  NO_VALUE
                )}
              </span>
              <TrendIndicator delta={forecast.delta} />
            </div>
            <p className="mt-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {forecast.projected
                ? `Oʻtgan toʻliq davr: ${formatCompactUzs(forecast.previousFull.amount)} soʻm`
                : 'Davr endi boshlandi — prognoz uchun juda erta'}
            </p>
          </div>

          <div className="w-full sm:max-w-[220px]">
            <p className="mb-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              Davrning oʻtgan qismi
            </p>
            <Meter value={forecast.elapsedPercent} tone="neutral" label="Davrning oʻtgan qismi" />
          </div>
        </div>
      )}
    </div>
  )
}

/** `— kun`, or the real number — a leg of the formula, never a fake zero. */
function formatCycleDays(days: number | null): string {
  if (days === null) return NO_VALUE
  const rounded = days >= 10 ? Math.round(days) : Math.round(days * 10) / 10
  return formatNumber(rounded)
}

/**
 * "Savdo tezligi" — the pipeline-velocity tile.
 *
 * Hand-rolled rather than StatTile for one reason: the unit is soʻm PER DAY,
 * and StatTile's money unit prints a bare "soʻm". Everything else — label
 * voice, 30px figure, skeleton sized to the ready state, the exact value on
 * the Tooltip primitive — deliberately mirrors StatTile so the tile family
 * stays one family.
 *
 * The hint line prints the formula's four legs in order. The value is null
 * whenever ANY leg is null, and the em dash in the hint says WHICH leg — a
 * dash with a reason, not a shrug.
 */
function VelocityTile({ velocity, status }: { velocity?: PulseVelocityDto; status: TileStatus }) {
  const v = velocity
  const money = v?.salesVelocityPerDay ?? null

  const formula = v
    ? [
        `${formatNumber(v.openDeals)} ochiq`,
        `× ${formatPercent(v.winRatePercent)} yutish`,
        `× ${v.avgWonAmount ? formatCompactUzs(v.avgWonAmount.amount) : NO_VALUE} chek`,
        `÷ ${formatCycleDays(v.medianCycleDays)} kun`,
      ].join(' ')
    : null

  return (
    <div className="card flex flex-col px-4 py-3.5">
      <p className="truncate text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
        Savdo tezligi
      </p>

      {status === 'error' ? (
        <p
          className="figure mt-2 text-[30px] leading-none font-semibold"
          style={{ color: 'var(--status-critical)' }}
          title="Maʼlumot olinmadi"
        >
          <span className="text-base font-medium">Olinmadi</span>
        </p>
      ) : status === 'loading' || !v ? (
        <div className="skeleton mt-2 h-[30px] w-2/3" role="status">
          <span className="sr-only">Yuklanmoqda</span>
        </div>
      ) : money ? (
        <div className="mt-2">
          <Tooltip content={<span className="tabular">{formatUzs(money.amount)}/kun</span>}>
            <span
              tabIndex={0}
              className="focusable figure block w-fit rounded-[var(--radius-panel-sm)] text-[30px] leading-none font-semibold"
              style={{ color: 'var(--ink-primary)' }}
            >
              <AnimatedNumber value={money.amount} format={formatCompactUzs} />
              <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
                soʻm/kun
              </span>
            </span>
          </Tooltip>
        </div>
      ) : (
        <p
          className="figure mt-2 text-[30px] leading-none font-semibold"
          style={{ color: 'var(--ink-primary)' }}
        >
          {NO_VALUE}
        </p>
      )}

      {/* The fraction wraps rather than truncates: a formula with its tail
          cut off is a different formula. */}
      {formula && status === 'ready' && (
        <p className="tabular mt-1.5 text-[11px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
          {formula}
        </p>
      )}
    </div>
  )
}

/**
 * "Yutish darajasi" — the count-based win rate with the fraction it came
 * from. A rate without its denominator is a rumour: 100% of three closed
 * deals and 100% of three hundred are different facts.
 */
function WinRateTile({ winRate, status }: { winRate?: PulseWinRateDto; status: TileStatus }) {
  const closed = winRate ? winRate.wonCount + winRate.lostCount : 0

  return (
    <StatTile
      status={status === 'ready' && !winRate ? 'loading' : status}
      label="Yutish darajasi"
      value={winRate?.countPercent ?? null}
      unit="percent"
      hint={
        winRate && status === 'ready'
          ? `${formatNumber(winRate.wonCount)} / ${formatNumber(closed)} yopilgan bitimdan`
          : undefined
      }
      context={winRate && status === 'ready' ? <TrendIndicator delta={winRate.countDelta} /> : undefined}
    />
  )
}

/**
 * The subordinate row: six KPI cards under the bento hero.
 *
 * KpiCard on purpose, not StatTile — its 28px figure sits one step below the
 * side tiles' 30 and two below the hero, so the type scale alone tells the
 * reader what order to read the page in.
 */
function KpiRow({ overview, loading }: { overview?: OverviewDto; loading: boolean }) {
  if (loading || !overview) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="px-4 py-3.5">
            <LoadingSkeleton rows={2} />
          </Card>
        ))}
      </div>
    )
  }

  const rest = overview.cards.filter((card) => card.key !== 'revenue')

  return (
    <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {rest.map((card) => (
        <KpiCard key={card.key} card={card} label={CARD_LABELS[card.key] ?? card.key} />
      ))}
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
    <div className="stagger grid h-full gap-3 sm:grid-cols-2">
      {/*
        A ring, and NEUTRAL, deliberately.

        The hint states the fraction the rate is actually computed from —
        resolved orders, because an order still in transit has not failed to
        arrive. (It once printed `898 / 2,191`, which is 41%, under a headline
        of 91.6%.) And the ring stays in the sequential hue rather than status
        green: this tile sits two rows under the revenue hero, and a saturated
        green there pulled the eye before the number the page exists to state.
        The logistics page grades the same figure.
      */}
      <GaugeTile
        status={tileStatus}
        label="Yetkazish darajasi"
        value={logistics?.totals.deliveryRate ?? null}
        tone="neutral"
        hint={
          logistics
            ? `${formatNumber(logistics.totals.delivered)} / ${formatNumber(
                logistics.totals.delivered +
                  logistics.totals.refused +
                  logistics.totals.cancelledEarly,
              )} yakunlangan · ${formatNumber(logistics.totals.inFlight)} yoʻlda`
            : 'yuklanmoqda'
        }
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
      <GaugeTile
        status={tileStatus}
        label="Tasdiqlash qamrovi"
        value={confirmation?.totals.coverage ?? null}
        tone="neutral"
        hint={
          confirmation
            ? `${formatNumber(confirmation.totals.confirmed)} / ${formatNumber(
                confirmation.totals.orders,
              )} navbatdan`
            : 'yuklanmoqda'
        }
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

/** Hours read as hours until two days, then as days — dwell times here run
    to weeks, and "312 soat" makes the reader do division mid-scan. */
function formatDwell(hours: number | null): string {
  if (hours === null) return NO_VALUE
  if (hours < 48) return `${formatNumber(Math.round(hours))} soat`
  const days = hours / 24
  return `${formatNumber(days >= 10 ? Math.round(days) : Math.round(days * 10) / 10)} kun`
}

/**
 * "Qotib qolgan bitimlar" — the aging panel from `/insights/flow`.
 *
 * A deal is "stuck" when its current dwell exceeds 2× that stage's own
 * historical median — the stage judged against itself, not against a global
 * constant, because a week in prepayment is normal and a week in "collecting
 * the order" is a problem. The rows below name the stages holding the most
 * stuck money, each with its current median dwell against the usual one.
 *
 * This is a POINT-IN-TIME reading over open deals: the chip goes warning
 * only when there is actually something to chase, because a permanently
 * amber panel trains the reader to ignore amber.
 */
function StuckDealsPanel({
  aging,
  status,
  onRetry,
}: {
  aging?: FlowAgingDto
  status: TileStatus
  onRetry: () => void
}) {
  const worst = aging
    ? [...aging.stages]
        .filter((stage) => stage.stuckCount > 0)
        // Ranked by the MONEY standing still, count as the tiebreak — three
        // stuck wholesale deals outrank a dozen stuck small ones.
        .sort((a, b) => b.stuckValue.amount - a.stuckValue.amount || b.stuckCount - a.stuckCount)
        .slice(0, 4)
    : []

  return (
    <Card className="flex h-full flex-col px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
          Qotib qolgan bitimlar
        </p>
        {status === 'ready' && aging && aging.totals.stuckCount > 0 && (
          <StatusChip tone="warning">{formatNumber(aging.totals.stuckCount)} bitim</StatusChip>
        )}
      </div>

      {status === 'loading' || (status === 'ready' && !aging) ? (
        <div className="mt-3">
          <LoadingSkeleton rows={4} />
        </div>
      ) : status === 'error' || !aging ? (
        <ErrorState onRetry={onRetry} />
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span
              className="figure text-[28px] leading-none font-semibold"
              style={{ color: 'var(--ink-primary)' }}
            >
              {/* Zero is a measured fact here — every open deal was checked
                  against its stage's baseline — so it prints as 0, unlike
                  the em dash a missing read would earn. */}
              <AnimatedNumber
                value={aging.totals.stuckCount}
                format={(v) => formatNumber(Math.round(v))}
              />
            </span>
            <span className="tabular text-xs" style={{ color: 'var(--ink-secondary)' }}>
              bitim · {formatCompactUzs(aging.totals.stuckValue.amount)} soʻm
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
            Bosqichda odatdagidan 2× uzoq turgan ochiq bitimlar · hozirgi holat
          </p>

          {worst.length > 0 ? (
            <ul className="mt-2.5">
              {worst.map((stage) => (
                <li
                  key={stage.stageId}
                  className="flex items-center justify-between gap-3 border-t py-2"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium" style={{ color: 'var(--ink-primary)' }}>
                      {stage.stageName}
                      {/* The portal's stage names often carry their own pipeline
                          prefix ("Доставка · В пути"); repeating the pipeline
                          after that reads as a stutter, so the tag renders only
                          when the name doesn't already say it. */}
                      {!stage.stageName.includes(stage.pipelineName) && (
                        <span className="ml-1.5 font-normal" style={{ color: 'var(--ink-muted)' }}>
                          {stage.pipelineName}
                        </span>
                      )}
                    </p>
                    {/* The judgement and its baseline, side by side — the
                        claim "stuck" is checkable from the row itself. */}
                    <p className="tabular mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                      hozir p50 {formatDwell(stage.dwellP50Hours)} · odatda{' '}
                      {formatDwell(stage.historicalP50Hours)}
                    </p>
                  </div>
                  <span
                    className="tabular shrink-0 text-xs font-semibold"
                    style={{ color: 'var(--ink-secondary)' }}
                  >
                    {formatNumber(stage.stuckCount)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p
              className="mt-3 border-t pt-3 text-[11px] leading-snug"
              style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
            >
              {formatNumber(aging.totals.openCount)} ochiq bitim odatdagi tezlikda yurmoqda.
            </p>
          )}
        </>
      )}
    </Card>
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
          <tr>
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
                  style={{ background: 'var(--track)' }}
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
    // `.eyebrow` — the ONE positive-tracked uppercase style, and a table
    // header is one of the two places it is allowed to live.
    <th scope="col" className={`eyebrow px-2 pb-2 text-left ${className}`}>
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
