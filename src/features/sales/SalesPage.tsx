'use client'

import type { ReactNode } from 'react'

import { keepPreviousData, useQueries } from '@tanstack/react-query'

import { BarList } from '@/components/charts/BarList'
import { RevenueTrendChart } from '@/components/charts/RevenueTrendChart'
import { Sparkline } from '@/components/charts/Sparkline'
import { ChartSkeleton, EmptyState, ErrorState } from '@/components/states/States'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Card, ChartCard } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Meter, StatTile } from '@/components/ui/Stat'
import { Tooltip } from '@/components/ui/Tooltip'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import {
  ApiClientError,
  apiGet,
  type DeltaDto,
  type FlowDto,
  type MoneyDto,
  type PulseDto,
  type StageConversionRowDto,
  type TrendPointDto,
} from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatNumber, formatPercent, formatUzs } from '@/lib/format'
import { t } from '@/lib/messages'

/**
 * Money as `/analytics/sales` actually serialises it.
 *
 * The summary crosses the JSON layer as raw domain `Money` — a bigint in
 * MINOR units that the serialiser writes as a string, with no `amount`
 * convenience field. Unlike the newer endpoints it never went through
 * `toMoneyDto`, so the client divides by 100 itself. See `toUzs` below.
 */
interface RawMoney {
  readonly amountMinor: string
  readonly currency: string
}

interface SalesPayload {
  readonly trend: readonly TrendPointDto[]
  readonly summary: {
    readonly revenue: RawMoney
    readonly createdValue: RawMoney
    readonly pipelineValue: RawMoney
    readonly averageDeal: RawMoney | null
    readonly dealsCreated: number
    readonly dealsWon: number
    readonly dealsLost: number
    readonly dealsOpen: number
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

/** Minor units (tiyin) to soʻm — the same division the trend does server-side. */
function toUzs(money: RawMoney): number {
  return Number(money.amountMinor) / 100
}

/** Days with one decimal, matching how the API states cycle percentiles. */
function formatDays(value: number): string {
  return formatNumber(Math.round(value * 10) / 10)
}

export function SalesPage() {
  const { apiParams, filters } = useDashboardFilters()

  /**
   * The insights endpoints honour employee / department / source filters but
   * deliberately ignore product and stage ones (documented in pulseService).
   * When such a filter is active, the pulse band and the conversion ladder
   * would silently disagree with the filtered headline above them — so the
   * page says so instead of letting the reader reconcile two truths.
   */
  const insightsIgnoreFilters = filters.productIds.length > 0 || filters.stageIds.length > 0

  const [sales, sources, products, pulse, flow] = useQueries({
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
        queryKey: ['pulse', apiParams],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          apiGet<PulseDto>('/insights/pulse', apiParams, signal),
        placeholderData: keepPreviousData,
      },
      {
        queryKey: ['flow', apiParams],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          apiGet<FlowDto>('/insights/flow', apiParams, signal),
        placeholderData: keepPreviousData,
      },
    ],
  })

  const trend = sales.data?.data.trend ?? []
  const summary = sales.data?.data.summary
  const sourceRows = sources.data?.data ?? []
  const productRows = products.data?.data ?? []
  const pulseData = pulse.data?.data
  const stageRows = flow.data?.data.stageConversion.stages ?? []

  const salesStatus = sales.isPending ? 'loading' : sales.isError ? 'error' : 'ready'
  const pulseStatus = pulse.isPending ? 'loading' : pulse.isError ? 'error' : 'ready'

  /**
   * The dashed reference on the hero chart: the mean of the buckets on
   * screen, so "is today above or below the period's own bar?" is answerable
   * from the plot. Context in ink, not a series — and pointless under two
   * buckets, where the average IS the data.
   */
  const trendAverage =
    trend.length >= 2
      ? trend.reduce((sum, point) => sum + point.revenue, 0) / trend.length
      : undefined

  const wonSpark = trend.map((point) => point.dealsWon)
  const createdSpark = trend.map((point) => point.dealsCreated)

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
      {/*
        The lead instrument — the page's ONE hero.

        The revenue figure this page fetched and never showed now sits as the
        hero number above the trend that explains it: figure and chart are one
        panel, so the number is never a blank tile and the chart is never an
        unheadlined plot. `.card-hero` + `.brackets` mark it as the flagship;
        nothing else on the page wears either class.
      */}
      <Card className="card-hero brackets reveal">
        <header className="flex items-start justify-between gap-4 px-5 pt-4">
          <div className="min-w-0">
            <h2
              className="text-sm font-semibold tracking-tight"
              style={{ color: 'var(--ink-primary)' }}
            >
              {t.chart.revenueTrend}
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
              {t.chart.revenueTrendHint}
            </p>
          </div>
        </header>

        <div className="px-5 pt-3">
          <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
            Davr tushumi
          </p>
          {/*
            Three states, not one — the same discipline as the tiles. A
            loading skeleton sized to the hero figure, a critical "Olinmadi"
            for a failed fetch, and the number itself only when it is real.
          */}
          {sales.isPending ? (
            <div className="skeleton mt-1.5 h-10 w-56" role="status">
              <span className="sr-only">Yuklanmoqda</span>
            </div>
          ) : sales.isError ? (
            <p
              className="mt-1.5 text-base font-medium"
              style={{ color: 'var(--status-critical)' }}
            >
              Olinmadi
            </p>
          ) : summary ? (
            /* The exact soʻm amount rides the Tooltip primitive — hover,
               focus and touch — because the compact form drops the digits. */
            <div className="mt-1.5">
              <Tooltip content={<span className="tabular">{formatUzs(toUzs(summary.revenue))}</span>}>
                <span
                  tabIndex={0}
                  className="focusable figure-hero inline-block rounded-[var(--radius-panel-sm)]"
                  style={{ color: 'var(--ink-primary)' }}
                >
                  <AnimatedNumber
                    value={toUzs(summary.revenue)}
                    format={formatCompactUzs}
                    duration={900}
                  />
                  <span className="ml-1.5 text-sm font-normal" style={{ color: 'var(--ink-muted)' }}>
                    soʻm
                  </span>
                </span>
              </Tooltip>
            </div>
          ) : null}
        </div>

        {/*
          The chart keeps the guard the old page had: an API failure or an
          empty payload renders a message and a retry, never a silent blank
          plot area under a confident headline.
        */}
        <div className="px-5 pt-4 pb-5">
          {sales.isPending ? (
            <ChartSkeleton height={300} />
          ) : sales.isError ? (
            <ErrorState
              message={(sales.error as Error | null)?.message}
              onRetry={() => void sales.refetch()}
            />
          ) : trend.length === 0 ? (
            <EmptyState
              title="Bu davrda tushum yoʻq"
              body="Tanlangan davr ichida yopilgan bitim topilmadi."
            />
          ) : (
            <RevenueTrendChart
              data={trend}
              height={300}
              referenceValue={trendAverage}
              referenceLabel="Davr oʻrtachasi"
            />
          )}
        </div>
      </Card>

      {/*
        The KPI row this page never had — the summary was always fetched and
        never rendered. Supporting tiles, deliberately subordinate to the
        hero: 30px figures against its 34–40px, and each carries its own
        context (sparkline, meter or fraction) so no number sits unjudgeable.
        The summary DTO carries no deltas, so none are invented here; the
        period-over-period story lives on the pulse band's win-rate pills.
      */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t.cards.dealsWon}
          value={summary?.dealsWon ?? null}
          unit="count"
          status={salesStatus}
          hint={summary ? `${formatNumber(summary.dealsLost)} ta bekor qilingan` : undefined}
          context={
            wonSpark.length >= 2 ? (
              <Sparkline values={wonSpark} label="Davr boʻyicha yopilgan bitimlar" />
            ) : undefined
          }
        />
        <StatTile
          label={t.cards.dealsCreated}
          value={summary?.dealsCreated ?? null}
          unit="count"
          status={salesStatus}
          hint={summary ? `Qiymati ${formatCompactUzs(toUzs(summary.createdValue))} soʻm` : undefined}
          context={
            createdSpark.length >= 2 ? (
              <Sparkline values={createdSpark} label="Davr boʻyicha yaratilgan bitimlar" />
            ) : undefined
          }
        />
        <StatTile
          label={t.cards.conversion}
          value={summary?.conversionRatePercent ?? null}
          unit="percent"
          status={salesStatus}
          // A rate states its fraction: won over resolved, the same
          // denominator the server divides by.
          hint={
            summary
              ? `${formatNumber(summary.dealsWon)} / ${formatNumber(
                  summary.dealsWon + summary.dealsLost,
                )} yakunlangan bitim`
              : undefined
          }
          context={
            summary && summary.conversionRatePercent !== null ? (
              <Meter
                value={summary.conversionRatePercent}
                tone="neutral"
                label={t.cards.conversion}
              />
            ) : undefined
          }
        />
        <StatTile
          label={t.cards.averageDeal}
          value={summary?.averageDeal ? toUzs(summary.averageDeal) : null}
          unit="money"
          status={salesStatus}
          hint={summary ? `${formatNumber(summary.dealsWon)} ta yutilgan bitim boʻyicha` : undefined}
        />
      </div>

      {/*
        Savdo pulsi — how fast the machine turns, from /insights/pulse.
        Cycle time, velocity, and the win rate stated BOTH ways: by deal
        count and value-weighted, side by side and labelled, because the two
        diverge exactly when a few large deals are carrying the period.
      */}
      <section aria-labelledby="sales-pulse-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="sales-pulse-heading" className="eyebrow">
            Savdo pulsi
          </h2>
          {insightsIgnoreFilters && (
            <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              Mahsulot va bosqich filtrlari bu qatorga taʼsir qilmaydi
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <InsightTile
            label="Aylanish davri (mediana)"
            status={pulseStatus}
            hint={
              pulseData
                ? pulseData.cycle.wonCount > 0
                  ? `${formatNumber(pulseData.cycle.wonCount)} ta yutilgan bitim boʻyicha`
                  : 'Bu davrda yutilgan bitim yoʻq'
                : undefined
            }
            context={
              pulseData &&
              (pulseData.cycle.p75Days !== null || pulseData.cycle.p90Days !== null) ? (
                <p className="tabular text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  p75:{' '}
                  {pulseData.cycle.p75Days !== null
                    ? formatDays(pulseData.cycle.p75Days)
                    : NO_VALUE}{' '}
                  · p90:{' '}
                  {pulseData.cycle.p90Days !== null
                    ? formatDays(pulseData.cycle.p90Days)
                    : NO_VALUE}{' '}
                  kun
                </p>
              ) : undefined
            }
          >
            {pulseData?.cycle.p50Days != null ? (
              <>
                <AnimatedNumber value={pulseData.cycle.p50Days} format={formatDays} />
                <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
                  kun
                </span>
              </>
            ) : (
              NO_VALUE
            )}
          </InsightTile>

          <InsightTile
            label="Savdo tezligi"
            status={pulseStatus}
            /*
              The formula's legs, always visible. Velocity is null the moment
              ANY component is — so the hint names each leg, and the missing
              one prints its em dash right where the reader is looking.
            */
            hint={
              pulseData
                ? `Ochiq ${formatNumber(pulseData.velocity.openDeals)} ta · yutish ${formatPercent(
                    pulseData.velocity.winRatePercent,
                  )} · aylanish ${
                    pulseData.velocity.medianCycleDays !== null
                      ? `${formatDays(pulseData.velocity.medianCycleDays)} kun`
                      : NO_VALUE
                  }`
                : undefined
            }
          >
            {pulseData?.velocity.salesVelocityPerDay ? (
              <Tooltip
                content={
                  <span className="tabular">
                    {formatUzs(pulseData.velocity.salesVelocityPerDay.amount)} / kun
                  </span>
                }
              >
                <span
                  tabIndex={0}
                  className="focusable inline-block rounded-[var(--radius-panel-sm)]"
                >
                  <AnimatedNumber
                    value={pulseData.velocity.salesVelocityPerDay.amount}
                    format={formatCompactUzs}
                  />
                  <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
                    soʻm/kun
                  </span>
                </span>
              </Tooltip>
            ) : (
              NO_VALUE
            )}
          </InsightTile>

          <StatTile
            label="Yutish — bitimlar soni"
            value={pulseData?.winRate.countPercent ?? null}
            unit="percent"
            status={pulseStatus}
            hint={
              pulseData
                ? `${formatNumber(pulseData.winRate.wonCount)} / ${formatNumber(
                    pulseData.winRate.wonCount + pulseData.winRate.lostCount,
                  )} yakunlangan bitim`
                : undefined
            }
            context={pulseData ? <TrendIndicator delta={pulseData.winRate.countDelta} /> : undefined}
          />

          <StatTile
            label="Yutish — bitim qiymati"
            value={pulseData?.winRate.valuePercent ?? null}
            unit="percent"
            status={pulseStatus}
            // What "value-weighted" means, in the reader's language: a big
            // deal moves this rate more than a small one.
            hint="Katta bitimlar koʻproq vazn oladi"
            context={pulseData ? <TrendIndicator delta={pulseData.winRate.valueDelta} /> : undefined}
          />
        </div>
      </section>

      {/*
        The ever-reached conversion ladder replaces the FunnelChart that used
        to sit here. The funnel showed the CURRENT position of the period's
        deals — a snapshot the Overview still carries — while this ladder,
        from DealStageHistory, answers the question a sales screen actually
        asks: of the deals created in the period, how many ever REACHED each
        stage, and where does the pipeline leak. Two funnels with two
        different denominators on one screen would demand a reconciliation
        nobody can do from memory; the honest one for this page won.

        The by-source BarList is gone too: the sources table below states the
        same ranking with more columns, and its freed slot is what gives the
        ladder room to breathe.
      */}
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Bosqich konversiyasi"
          // The basis, stated where the numbers are — this ladder counts
          // deals CREATED in the period, not deals currently sitting anywhere.
          hint={`Davrda yaratilgan bitimlar boʻyicha — har bosqichga yetib borganlar${
            insightsIgnoreFilters ? ' · mahsulot va bosqich filtrlarisiz' : ''
          }`}
        >
          {flow.isPending ? (
            <ChartSkeleton height={240} />
          ) : flow.isError ? (
            <ErrorState
              message={flow.error instanceof ApiClientError ? flow.error.message : undefined}
              onRetry={() => void flow.refetch()}
            />
          ) : stageRows.length === 0 ? (
            <EmptyState
              title="Maʼlumot yoʻq"
              body="Tanlangan davrda yaratilgan bitimlar boʻyicha bosqich tarixi topilmadi."
            />
          ) : (
            <StageLadder stages={stageRows} />
          )}
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

/**
 * A stat tile whose value is not a bare number — days with a unit, money per
 * day — rendered in exactly StatTile's voice (same card, label, 30px figure,
 * skeleton and error treatments) so the pulse row reads as one family.
 * StatTile itself formats from `(value, unit)` and neither of these values
 * fits its unit set; duplicating the shell here is cheaper than widening a
 * component six pages already depend on.
 */
function InsightTile({
  label,
  hint,
  context,
  status,
  children,
}: {
  label: string
  hint?: string
  context?: ReactNode
  status: 'loading' | 'error' | 'ready'
  children: ReactNode
}) {
  return (
    <div className="card flex flex-col px-4 py-3.5">
      <p className="truncate text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </p>

      {status === 'loading' ? (
        // Sized to the 30px figure below, so ready never reflows loading.
        <div className="skeleton mt-2 h-[30px] w-2/3" role="status">
          <span className="sr-only">Yuklanmoqda</span>
        </div>
      ) : status === 'error' ? (
        <p
          className="figure mt-2 text-[30px] leading-none font-semibold"
          style={{ color: 'var(--status-critical)' }}
          title="Maʼlumot olinmadi"
        >
          <span className="text-base font-medium">Olinmadi</span>
        </p>
      ) : (
        // A div, not a p: the velocity tile nests its Tooltip trigger here.
        <div
          className="figure mt-2 text-[30px] leading-none font-semibold"
          style={{ color: 'var(--ink-primary)' }}
        >
          {children}
        </div>
      )}

      {hint && (
        <p className="mt-1 text-[11px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
          {hint}
        </p>
      )}

      {context && <div className="mt-2.5">{context}</div>}
    </div>
  )
}

/**
 * The conversion ladder: per pipeline, each stage with the count of cohort
 * deals that ever entered it and the pass-through from the previous stage as
 * a neutral meter — magnitude, not judgement, because a "good" pass-through
 * rate differs per stage and the grading thresholds would lie here.
 */
function StageLadder({ stages }: { stages: readonly StageConversionRowDto[] }) {
  // Map preserves the server's pipeline order; stages re-sorted defensively.
  const byPipeline = new Map<string, StageConversionRowDto[]>()
  for (const stage of stages) {
    const group = byPipeline.get(stage.pipelineName)
    if (group) group.push(stage)
    else byPipeline.set(stage.pipelineName, [stage])
  }

  return (
    <div className="space-y-5">
      {[...byPipeline.entries()].map(([pipelineName, rows]) => {
        const ordered = [...rows].sort((a, b) => a.sortOrder - b.sortOrder)
        return (
          <div key={pipelineName}>
            <p className="text-xs font-semibold" style={{ color: 'var(--ink-primary)' }}>
              {pipelineName}
            </p>
            <ul className="mt-2 space-y-2">
              {ordered.map((row) => (
                <li
                  key={row.stageId}
                  className="grid grid-cols-[minmax(0,1fr)_auto_minmax(110px,150px)] items-center gap-3"
                >
                  {/* Long Uzbek stage names wrap rather than truncate — a
                      ladder row has the vertical room a table cell lacks. */}
                  <span
                    className="text-[12.5px] leading-snug"
                    style={{ color: 'var(--ink-secondary)' }}
                  >
                    {row.stageName}
                  </span>
                  <span
                    className="tabular text-xs font-medium"
                    style={{ color: 'var(--ink-primary)' }}
                  >
                    {formatNumber(row.dealCount)} ta
                  </span>
                  {row.conversionFromPreviousPercent !== null &&
                  row.conversionFromPreviousPercent > 100 ? (
                    /*
                      Over 100% is a real value here — deals can enter a stage
                      without ever visiting its predecessor — and Meter clamps
                      its printed number to the clamped bar. Printing "100%"
                      for 128% would break the bar-states-its-number rule, so
                      past the track's ceiling the exact figure stands alone.
                    */
                    <span
                      className="tabular text-xs font-medium"
                      style={{ color: 'var(--ink-secondary)' }}
                    >
                      {formatPercent(row.conversionFromPreviousPercent)}
                    </span>
                  ) : (
                    // Null (a pipeline's first stage) renders Meter's em dash:
                    // there is no previous stage to convert from.
                    <Meter
                      value={row.conversionFromPreviousPercent}
                      tone="neutral"
                      label={`${row.stageName}: oldingi bosqichdan oʻtish`}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
