'use client'

import { useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { endpointDot, endpointLabelWidth } from '@/components/charts/chartEndpoint'
import { ChartTooltipPanel } from '@/components/charts/chartTooltip'
import { ChartSkeleton } from '@/components/states/States'
import { Card } from '@/components/ui/Card'
import { StatusChip } from '@/components/ui/Stat'
import { Tooltip } from '@/components/ui/Tooltip'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import { useReducedMotion } from '@/lib/useReducedMotion'

import { amountOf, type MarketingMetricsDto, type MarketingDayDto, type MarketingWindowDto } from './marketingApi'
import {
  GRADE_WORDS,
  ROAS_THRESHOLDS,
  type CurrencyMode,
  dayLabel,
  dayShortLabel,
  deltaOf,
  gradeOf,
  monthLabel,
  moneyFromUsd,
  moneyFromUzs,
  percent,
  ratio,
} from './marketingFormat'

/**
 * The lead instrument: the period's revenue above the daily series it is the
 * sum of — the same panel grammar as the command centre's intake hero, because
 * a reader who learns one screen has learned both.
 *
 * This replaces the hero TILE the KPI band used to end with. A hero as one
 * cell of a twelve-tile grid could state its number but never show its shape;
 * the daily revenue series was in the payload the whole time and surfaced only
 * in a tooltip. The band's source-order story survives intact: eleven tiles in
 * the source's order, and the money still comes back at the end — now with the
 * evidence beside it.
 *
 * ROAS rides the hero as the client's OWN verdict, graded at their 3.0 / 1.5
 * thresholds (`ro()` in logic.js) — a judgement they already make, not one we
 * invented. "xarajat yoʻq" for a windowful of revenue with zero recorded spend
 * keeps the table's deliberate rule: that is broken attribution, not an
 * unknown ratio.
 *
 * The chart plots the DISPLAYED currency, exactly like the dynamics panels,
 * so the axis and the toggle cannot drift apart. The dashed reference is the
 * previous window's revenue as a per-day rate — the honest flat line, for the
 * same reason the intake hero refuses to splice last month in as a second zig.
 */
export function MarketingHero({
  current,
  previous,
  daily,
  previousWindow,
  dailyFrom,
  mode,
  rate,
  status,
}: {
  current: MarketingMetricsDto | undefined
  previous: MarketingMetricsDto | undefined
  daily: readonly MarketingDayDto[]
  previousWindow: MarketingWindowDto | undefined
  /** Rows before this date are monthly buckets and are labelled as months. */
  dailyFrom: string
  mode: CurrencyMode
  rate: number
  status: 'loading' | 'error' | 'ready'
}) {
  const revenue = current ? current.revenue.amount : null
  const value = moneyFromUzs(revenue, mode, rate, 'compact')
  const exact = moneyFromUzs(revenue, mode, rate, 'unit')
  const roas = current?.roas ?? null
  const grade = gradeOf(roas, ROAS_THRESHOLDS)

  /*
    The reference line's value: last window's revenue spread over its own
    calendar days. Inclusive date arithmetic on the window's own strings —
    the same ISO dates the service resolved, so no timezone can move them.
  */
  const previousDaily = (() => {
    if (!previous || !previousWindow || previous.revenue.amount <= 0) return null
    const days =
      Math.round(
        (Date.parse(previousWindow.to) - Date.parse(previousWindow.from)) / 86_400_000,
      ) + 1
    if (days < 1) return null
    const uzsPerDay = previous.revenue.amount / days
    return mode === 'usd' ? uzsPerDay / rate : uzsPerDay
  })()

  return (
    <Card className="card-hero brackets reveal" as="section">
      <div className="grid gap-x-8 gap-y-4 px-5 py-4 lg:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
            Tushum
          </p>

          {status === 'loading' ? (
            <div className="skeleton mt-2 h-10 w-48" role="status">
              <span className="sr-only">Yuklanmoqda</span>
            </div>
          ) : status === 'error' ? (
            <p className="mt-2 text-base font-medium" style={{ color: 'var(--status-critical)' }}>
              Olinmadi
            </p>
          ) : (
            <>
              <div className="mt-2">
                <Tooltip content={<span className="tabular">{exact}</span>}>
                  <span
                    tabIndex={0}
                    className="focusable figure-hero inline-block rounded-[var(--radius-panel-sm)]"
                    style={{ color: 'var(--ink-primary)' }}
                  >
                    {value}
                  </span>
                </Tooltip>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {current && (
                  <TrendIndicator
                    delta={deltaOf(current.revenue.amount, previous ? previous.revenue.amount : null)}
                  />
                )}
                {/* The client's own verdict on the money: revenue over spend,
                    graded at THEIR 3.0 / 1.5. Zero spend under real revenue is
                    named, not dashed — the table documents why. */}
                {status === 'ready' &&
                  (roas === null ? (
                    current && current.revenue.amount > 0 ? (
                      <StatusChip tone="critical">xarajat yoʻq</StatusChip>
                    ) : null
                  ) : (
                    <StatusChip tone={grade ?? 'neutral'}>
                      ROAS {ratio(roas)}× {grade ? GRADE_WORDS[grade] : ''}
                    </StatusChip>
                  ))}
              </div>

              <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                {current?.metaSharePercent !== null && current?.metaSharePercent !== undefined
                  ? `${percent(current.metaSharePercent)} qismi Meta reklamasiga bogʻlangan`
                  : 'Meta ulushi nomaʼlum'}
                {current?.averageCheque
                  ? ` · oʻrtacha chek ${moneyFromUzs(amountOf(current.averageCheque), mode, rate, 'compact')}`
                  : ''}
              </p>
            </>
          )}
        </div>

        <div className="min-w-0">
          {status === 'loading' ? (
            <ChartSkeleton height={220} />
          ) : status === 'error' ? (
            <p className="py-14 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
              Grafik uchun maʼlumot olinmadi
            </p>
          ) : daily.length >= 2 ? (
            <RevenueTrend
              daily={daily}
              dailyFrom={dailyFrom}
              mode={mode}
              rate={rate}
              previousDaily={previousDaily}
            />
          ) : (
            <p className="py-14 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
              Bu oynada grafik chizishga yetarli kun yoʻq
            </p>
          )}
        </div>
      </div>
    </Card>
  )
}

/**
 * Daily revenue, in the house trend-chart grammar: series-1 (revenue's slot on
 * every screen of this product), soft gradient wash, endpoint dot + figure,
 * reference in ink. Spend and ROAS stay in the dynamics panels below — this
 * chart answers "what came back", theirs answer "what it cost".
 */
function RevenueTrend({
  daily,
  dailyFrom,
  mode,
  rate,
  previousDaily,
}: {
  daily: readonly MarketingDayDto[]
  dailyFrom: string
  mode: CurrencyMode
  rate: number
  previousDaily: number | null
}) {
  const reducedMotion = useReducedMotion()
  const [cursorNearEnd, setCursorNearEnd] = useState(false)

  const points = daily.map((day) => ({
    date: day.date,
    label: day.date < dailyFrom ? monthLabel(day.date) : dayShortLabel(day.date),
    revenue: mode === 'usd' ? day.revenue.amount / rate : day.revenue.amount,
    revenueUzs: day.revenue.amount,
    spendUsd: day.spend.amount,
    roas: day.roas,
    sold: day.sold,
  }))

  const last = points[points.length - 1]
  const endLabel = last ? moneyFromUzs(last.revenueUzs, mode, rate, 'compact') : undefined

  const handleMove = (state: { activeTooltipIndex?: number | string | null | undefined }) => {
    const raw = state?.activeTooltipIndex
    const index = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
    setCursorNearEnd(
      Number.isFinite(index) && index >= points.length - Math.max(2, Math.ceil(points.length / 4)),
    )
  }

  return (
    <div
      className="glow-series-1"
      style={{ position: 'relative', width: '100%', height: 220, minHeight: 220 }}
    >
      <div style={{ position: 'absolute', inset: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={points}
            margin={{ top: 8, right: endLabel ? endpointLabelWidth(endLabel) : 8, left: 0, bottom: 0 }}
            onMouseMove={handleMove}
            onMouseLeave={() => setCursorNearEnd(false)}
          >
            <defs>
              <linearGradient id="marketingRevenueFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.01} />
              </linearGradient>
            </defs>

            <CartesianGrid vertical={false} stroke="var(--grid)" strokeDasharray="0" />

            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={28}
            />

            <YAxis
              tickLine={false}
              axisLine={false}
              width="auto"
              tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
              tickFormatter={(v: number) =>
                mode === 'usd'
                  ? moneyFromUsd(v, 'usd', rate, 'compact')
                  : moneyFromUzs(v, 'uzs', rate, 'compact')
              }
            />

            <ChartTooltip
              cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
              isAnimationActive={false}
              content={<HeroTooltip mode={mode} rate={rate} />}
            />

            {previousDaily !== null && (
              <ReferenceLine
                y={previousDaily}
                stroke="var(--axis)"
                strokeDasharray="4 4"
                ifOverflow="extendDomain"
                label={{
                  value: 'oʻtgan oyna: kuniga shu atrofda',
                  position: 'insideTopRight',
                  fill: 'var(--ink-muted)',
                  fontSize: 11,
                }}
              />
            )}

            <Area
              type="monotone"
              dataKey="revenue"
              stroke="var(--series-1)"
              strokeWidth={2}
              fill="url(#marketingRevenueFill)"
              dot={endpointDot({
                lastIndex: points.length - 1,
                color: 'var(--series-1)',
                label: endLabel,
                showLabel: !cursorNearEnd,
              })}
              activeDot={{
                r: 4,
                fill: 'var(--series-1)',
                stroke: 'var(--surface-raised)',
                strokeWidth: 2,
              }}
              isAnimationActive={!reducedMotion}
              animationDuration={520}
              animationEasing="ease-out"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

interface HeroPoint {
  readonly date: string
  readonly label: string
  readonly revenue: number
  readonly revenueUzs: number
  readonly spendUsd: number
  readonly roas: number | null
  readonly sold: number
}

/**
 * The full day at a glance: what came back, how many sales that was, what it
 * cost, and the ratio — one hover answers the question the two panels below
 * would need two hovers for. Only revenue has a mark in THIS plot, so only
 * revenue gets a swatch; the rest are companion facts, not drawn series.
 */
function HeroTooltip({
  active,
  payload,
  mode,
  rate,
}: {
  active?: boolean
  payload?: { payload?: HeroPoint }[]
  mode: CurrencyMode
  rate: number
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null

  return (
    <ChartTooltipPanel
      header={dayLabel(point.date)}
      rows={[
        {
          swatch: 'var(--series-1)',
          label: 'Tushum',
          value: moneyFromUzs(point.revenueUzs, mode, rate, 'unit'),
        },
        { label: 'Sotuvlar', value: String(point.sold) },
        { label: 'Xarajat', value: moneyFromUsd(point.spendUsd, mode, rate, 'unit') },
        {
          label: 'ROAS',
          value: point.roas === null ? 'xarajat yoʻq' : `${ratio(point.roas)}×`,
        },
      ]}
    />
  )
}
