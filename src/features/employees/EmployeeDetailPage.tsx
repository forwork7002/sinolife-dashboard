'use client'

import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { RevenueTrendChart } from '@/components/charts/RevenueTrendChart'
import { Sparkline } from '@/components/charts/Sparkline'
import { ChartSkeleton, ErrorState } from '@/components/states/States'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Button } from '@/components/ui/Button'
import { Card, ChartCard } from '@/components/ui/Card'
import { ChevronRightGlyph } from '@/components/ui/Icons'
import { StatTile } from '@/components/ui/Stat'
import { Tooltip } from '@/components/ui/Tooltip'
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
  const loading = query.isPending
  const tileStatus = loading ? 'loading' : 'ready'
  const closedDeals = data ? data.current.dealsWon + data.current.dealsLost : 0

  return (
    <PageShell
      title={data?.employee.fullName ?? t.nav.employees}
      // The team family shares the leaderboard's slot — one person is still
      // the same family of screens, and the stripe should say so.
      accent="var(--series-5)"
      description={
        data
          ? [data.employee.position, data.employee.departmentName].filter(Boolean).join(' · ')
          : undefined
      }
      meta={query.data?.meta}
      actions={
        <Button
          href="/employees"
          variant="secondary"
          icon={<ChevronRightGlyph className="rotate-180" />}
        >
          {t.nav.employees}
        </Button>
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
          {/*
            The lead instrument: what this person EARNED, at hero size, with
            the period's shape beside it. Everything else on the screen is a
            supporting tile — the deal counts explain the revenue, never the
            other way round, and the sizes now say so (~40px vs 30 vs 18).

            Brackets on the wrapper, hero surface on the card — `.brackets`
            and `.glow-track` both claim ::after, and although only one of the
            two is used here, the wrapper split keeps the pattern uniform with
            the leaderboard's hero.
          */}
          <div className="brackets">
            <section className="card-hero flex flex-col gap-4 px-5 py-4 md:flex-row md:items-end md:justify-between">
              <div className="min-w-0">
                <p
                  className="truncate text-[12.5px] font-medium"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  {t.cards.revenue}
                </p>
                {loading ? (
                  // Sized to the hero figure below, so ready never reflows
                  // loading — and a skeleton, never an em dash: "still
                  // fetching" and "genuinely nothing" are different claims.
                  <div className="skeleton mt-2 h-[38px] w-56" role="status">
                    <span className="sr-only">Yuklanmoqda</span>
                  </div>
                ) : (
                  /*
                    The exact soʻm amount rides the Tooltip primitive — hover,
                    focus AND touch — because the compact figure is a summary
                    and the full number is otherwise unreachable here.
                  */
                  <div className="mt-2">
                    <Tooltip
                      content={
                        <span className="tabular">
                          {data ? formatUzs(data.current.revenue.amount) : NO_VALUE}
                        </span>
                      }
                    >
                      <span
                        tabIndex={0}
                        className="focusable figure-hero block w-fit rounded-[var(--radius-panel-sm)]"
                        style={{ color: 'var(--ink-primary)' }}
                      >
                        {data ? (
                          <AnimatedNumber
                            value={data.current.revenue.amount}
                            format={formatCompactUzs}
                            duration={900}
                          />
                        ) : (
                          NO_VALUE
                        )}
                        <span
                          className="ml-1.5 text-sm font-normal"
                          style={{ color: 'var(--ink-muted)' }}
                        >
                          soʻm
                        </span>
                      </span>
                    </Tooltip>
                  </div>
                )}
                <div className="mt-2.5 flex items-center gap-2">
                  {data && <TrendIndicator delta={data.deltas.revenue} />}
                  {/* The comparison names its window; the title names its
                      basis — closed-date, like every money figure here. */}
                  <span
                    className="text-[11px]"
                    style={{ color: 'var(--ink-muted)' }}
                    title={t.period.closedBasis}
                  >
                    {t.period.comparedTo}
                  </span>
                </div>
              </div>

              {/*
                Not a blank hero: the period's own shape rides beside the
                figure, in the revenue series' hue — the same line the big
                chart below draws, so tint and data stay one entity. Fewer
                than two buckets and the Sparkline itself declines to imply a
                trend that was never measured.
              */}
              <div className="w-full shrink-0 md:w-64 lg:w-80">
                {loading ? (
                  <div className="skeleton h-[44px] w-full" role="status">
                    <span className="sr-only">Yuklanmoqda</span>
                  </div>
                ) : (
                  <Sparkline
                    values={(data?.trend ?? []).map((point) => point.revenue)}
                    color="var(--series-1)"
                    height={44}
                    label="Davr boʻyicha tushum"
                  />
                )}
              </div>
            </section>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile
              label={t.cards.dealsWon}
              value={data ? data.current.dealsWon : null}
              unit="count"
              status={tileStatus}
              context={
                data ? (
                  <div className="flex items-center justify-between gap-3">
                    <TrendIndicator delta={data.deltas.dealsWon} />
                    {/* Neutral hue on purpose: a deals count is a magnitude,
                        not a named series on this screen. */}
                    <span className="w-24 min-w-0">
                      <Sparkline
                        values={data.trend.map((point) => point.dealsWon)}
                        height={22}
                        label="Davr boʻyicha yopilgan bitimlar"
                      />
                    </span>
                  </div>
                ) : undefined
              }
            />
            <StatTile
              label={t.cards.averageDeal}
              value={data ? (data.current.averageDeal?.amount ?? null) : null}
              unit="money"
              status={tileStatus}
            />
            <StatTile
              label={t.cards.conversion}
              value={data ? data.current.conversionPercent : null}
              unit="percent"
              status={tileStatus}
              // A rate states its fraction — the denominator is closed deals,
              // and printing it is what makes 50% from 2 deals readable as
              // exactly that.
              hint={
                data && closedDeals > 0
                  ? `${formatNumber(data.current.dealsWon)} yutilgan / ${formatNumber(closedDeals)} yakunlangan bitim`
                  : undefined
              }
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label={t.cards.dealsCreated}
              value={data ? formatNumber(data.current.dealsCreated) : NO_VALUE}
              loading={loading}
            />
            <Metric
              label={t.cards.dealsOpen}
              value={data ? formatNumber(data.current.dealsOpen) : NO_VALUE}
              loading={loading}
            />
            <Metric
              label={t.cards.pipeline}
              value={
                data ? (
                  <>
                    {formatCompactUzs(data.current.pipeline.amount)}
                    <span className="ml-1 text-[11px] font-normal" style={{ color: 'var(--ink-muted)' }}>
                      soʻm
                    </span>
                  </>
                ) : (
                  NO_VALUE
                )
              }
              exact={data ? formatUzs(data.current.pipeline.amount) : undefined}
              loading={loading}
            />
            <Metric
              label={t.cards.kpiAchievement}
              value={formatPercent(data?.kpiAchievementPercent ?? null, 0)}
              loading={loading}
            />
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

/**
 * The quiet tier: 18px figures under the same 12.5px label voice as every
 * tile in the app. These four are context for the hero and the 30px row
 * above, and their size is the statement that they are.
 *
 * Money passes `exact`, and the full amount rides the Tooltip primitive —
 * a native `title` reaches neither keyboard nor touch. Loading renders a
 * skeleton, never the em dash: a dash is a CLAIM (measured: nothing), and
 * while the request is in flight nothing has been measured yet.
 */
function Metric({
  label,
  value,
  exact,
  loading,
}: {
  label: string
  value: ReactNode
  exact?: string
  loading?: boolean
}) {
  return (
    <Card className="px-4 py-3.5">
      <p className="truncate text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </p>
      {loading ? (
        <div className="skeleton mt-1.5 h-[18px] w-1/2" role="status">
          <span className="sr-only">Yuklanmoqda</span>
        </div>
      ) : exact ? (
        <Tooltip content={<span className="tabular">{exact}</span>}>
          <p
            tabIndex={0}
            className="focusable figure mt-1.5 w-fit rounded-[var(--radius-panel-sm)] text-lg leading-none font-semibold"
            style={{ color: 'var(--ink-primary)' }}
          >
            {value}
          </p>
        </Tooltip>
      ) : (
        <p
          className="figure mt-1.5 text-lg leading-none font-semibold"
          style={{ color: 'var(--ink-primary)' }}
        >
          {value}
        </p>
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
