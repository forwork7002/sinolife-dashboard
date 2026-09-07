'use client'

/**
 * The hero's chart, on its own so the hero's NUMBERS do not wait for recharts.
 *
 * Split out of MarketingHero for one reason: recharts is 379 KB unparsed and
 * it was in the synchronous entry set of /marketing, so the headline figures —
 * revenue, ROAS, the Meta share — could not paint until a charting library had
 * downloaded and compiled. They are plain text and they are the first thing
 * anyone reads on this screen. Now they paint with the page and the plot
 * arrives behind them, in the slot that already had a skeleton.
 *
 * Nothing here changed in the move except its address.
 */

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
import { useReducedMotion } from '@/lib/useReducedMotion'

import type { MarketingDayDto } from './marketingApi'
import {
  type CurrencyMode,
  dayLabel,
  dayShortLabel,
  monthLabel,
  moneyFromUsd,
  moneyFromUzs,
  ratio,
} from './marketingFormat'

/**
 * Daily revenue, in the house trend-chart grammar: series-1 (revenue's slot on
 * every screen of this product), soft gradient wash, endpoint dot + figure,
 * reference in ink. Spend and ROAS stay in the dynamics panels below — this
 * chart answers "what came back", theirs answer "what it cost".
 */
export function RevenueTrend({
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
