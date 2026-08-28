'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ChartTooltipPanel } from '@/components/charts/chartTooltip'
import { formatCompactUzs } from '@/lib/format'
import { useReducedMotion } from '@/lib/useReducedMotion'
import type { MarketingDayDto } from './marketingApi'
import {
  type CurrencyMode,
  dayLabel,
  dayShortLabel,
  formatUsd,
  monthLabel,
  moneyFromUsd,
  moneyFromUzs,
  ratio,
} from './marketingFormat'

/**
 * Daily spend and daily ROAS — as TWO PANELS, not one dual-axis chart.
 *
 * Their page draws spend as bars on a left axis and ROAS as a line on a right
 * axis in the same plot. That is the one chart form this design system refuses
 * outright (docs/DESIGN.md; DESIGN-BRIEF traps): with two independent scales
 * the author chooses where the line crosses the bars, so "ROAS collapsed when
 * we scaled spend" and "ROAS held while we scaled spend" are the same data
 * drawn at two different right-axis ranges. Nobody reading it can tell which
 * one they are looking at.
 *
 * Stacking the panels keeps every fact the original carried — the same days,
 * the same two measures, read against each other by looking straight down the
 * column — and removes the only thing that was arbitrary about it. Each panel
 * owns one scale that starts where it should.
 *
 * The x axis is shared for real, not by eye: both panels take the same data
 * array, the same margins and the same FIXED y-axis width, so day N sits at
 * the same pixel in both. `width="auto"` is what every other chart in the app
 * uses and it is exactly wrong here — it would measure "213 mln" in one panel
 * and "3,0" in the other and offset the plots by thirty pixels.
 *
 * Only the lower panel prints tick labels; a repeated date row between two
 * panels of one chart would read as two charts.
 */

/** The plot geometry both panels must agree on, or the axis is not shared. */
const AXIS_WIDTH = 62
const MARGIN = { top: 8, right: 12, left: 0, bottom: 0 } as const

export function MarketingDynamics({
  days,
  mode,
  rate,
  dailyFrom,
}: {
  readonly days: readonly MarketingDayDto[]
  readonly mode: CurrencyMode
  readonly rate: number
  /** Rows before this date are monthly buckets and are labelled as months. */
  readonly dailyFrom: string
}) {
  const reducedMotion = useReducedMotion()

  const points = days.map((day) => ({
    date: day.date,
    label: day.date < dailyFrom ? monthLabel(day.date) : dayShortLabel(day.date),
    // Spend is USD-native: the soʻm view multiplies by the rate. The chart
    // plots the DISPLAYED unit so the axis ticks and the tooltip cannot drift
    // apart when the toggle moves.
    spend: mode === 'usd' ? day.spend.amount : day.spend.amount * rate,
    spendUsd: day.spend.amount,
    revenueUzs: day.revenue.amount,
    roas: day.roas,
  }))

  const spendUnit = mode === 'usd' ? 'Xarajat, $' : 'Xarajat, soʻm'

  return (
    <div className="space-y-1">
      {/* Economist finishing: the unit is stated ONCE at the top-left of the
          plot instead of rotated up the y-axis, where nobody reads it. */}
      <PanelLabel>{spendUnit}</PanelLabel>
      <div style={{ width: '100%', height: 148 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={MARGIN}>
            <CartesianGrid vertical={false} stroke="var(--grid)" strokeDasharray="0" />
            {/* The axis exists (it is what positions the bars) but prints
                nothing: the lower panel carries the dates for both. */}
            <XAxis dataKey="label" hide />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={AXIS_WIDTH}
              tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
              tickFormatter={(value: number) =>
                mode === 'usd' ? formatUsd(value) : formatCompactUzs(value)
              }
            />
            <Tooltip
              cursor={{ fill: 'color-mix(in oklab, var(--ink-primary) 6%, transparent)' }}
              isAnimationActive={false}
              content={<DynamicsTooltip mode={mode} rate={rate} />}
            />
            <Bar
              dataKey="spend"
              // series-1, not the page accent: a mark that encodes a value may
              // never wear page identity. Radius only on the top corners —
              // a bar sits ON the baseline.
              fill="var(--series-1)"
              radius={[3, 3, 0, 0]}
              maxBarSize={16}
              isAnimationActive={!reducedMotion}
              animationDuration={520}
              animationEasing="ease-out"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <PanelLabel>ROAS, ×</PanelLabel>
      <div style={{ width: '100%', height: 132 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={MARGIN}>
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
              width={AXIS_WIDTH}
              tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
              tickFormatter={(value: number) => ratio(value, 1)}
            />

            {/*
              The two thresholds the client already grades by (logic.js `ro()`):
              3.0 is "good", 1.5 is the floor. Drawn in --axis and dashed —
              annotation lives in ink, never in a series hue — and before the
              Line so the data paints over the context, never under it.
              `ifOverflow="extendDomain"` because a threshold above every point
              is exactly the case the reader needs to see.
            */}
            <ReferenceLine
              y={3}
              stroke="var(--axis)"
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
              label={{
                value: 'yaxshi 3,0×',
                position: 'insideTopRight',
                fill: 'var(--ink-muted)',
                fontSize: 11,
              }}
            />
            <ReferenceLine
              y={1.5}
              stroke="var(--axis)"
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
              label={{
                value: 'chegara 1,5×',
                position: 'insideBottomRight',
                fill: 'var(--ink-muted)',
                fontSize: 11,
              }}
            />

            <Tooltip
              cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
              isAnimationActive={false}
              content={<DynamicsTooltip mode={mode} rate={rate} />}
            />

            <Line
              type="monotone"
              dataKey="roas"
              stroke="var(--series-3)"
              strokeWidth={2}
              // No dots at rest — at sixty points they merge into a dotted
              // line. `connectNulls={false}` so a day with no spend leaves a
              // GAP: ROAS is undefined there, and a line drawn straight
              // through would invent a value for it.
              dot={false}
              connectNulls={false}
              activeDot={{
                r: 4,
                fill: 'var(--series-3)',
                stroke: 'var(--surface-raised)',
                strokeWidth: 2,
              }}
              isAnimationActive={!reducedMotion}
              animationDuration={520}
              animationEasing="ease-out"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="pl-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
      {children}
    </p>
  )
}

interface DynamicsPoint {
  readonly date: string
  readonly label: string
  readonly spend: number
  readonly spendUsd: number
  readonly revenueUzs: number
  readonly roas: number | null
}

/**
 * One tooltip for both panels, so hovering either one answers the same
 * question: what did that day cost, what did it bring back, what was the
 * ratio. Splitting the chart in two must not split the reading.
 */
function DynamicsTooltip({
  active,
  payload,
  mode,
  rate,
}: {
  active?: boolean
  payload?: { payload?: DynamicsPoint }[]
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
          label: 'Xarajat',
          value: moneyFromUsd(point.spendUsd, mode, rate, 'unit'),
        },
        {
          label: 'Tushum',
          value: moneyFromUzs(point.revenueUzs, mode, rate, 'unit'),
        },
        {
          swatch: 'var(--series-3)',
          label: 'ROAS',
          // "xarajat yoʻq" rather than an em dash: a day with revenue and no
          // recorded spend has a BROKEN attribution, not an unknown ratio.
          value: point.roas === null ? 'xarajat yoʻq' : `${ratio(point.roas)}×`,
        },
      ]}
    />
  )
}
