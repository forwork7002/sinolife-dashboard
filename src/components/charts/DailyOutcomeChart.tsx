'use client'

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { endpointDot, endpointLabelWidth } from '@/components/charts/chartEndpoint'
import { ChartTooltipPanel } from '@/components/charts/chartTooltip'
import { formatDateShort, formatFullUzs, formatNumber, formatUzs } from '@/lib/format'
import { useReducedMotion } from '@/lib/useReducedMotion'

/**
 * Успешно against Отказ, day by day over the logistics cohort.
 *
 * THE ONLY RECHARTS CHART ON THE LOGISTIKA SCREEN. The other four comparisons
 * there are six or eight fixed rows and are drawn by hand — a chart library
 * for those is an axis nobody reads and a hover that hides the numbers. A time
 * series is different: the shape between the points IS the information, and
 * there is nothing to hand-draw it with.
 *
 * ONE Y AXIS. A second one is forbidden in this codebase because it can be
 * rescaled to imply any relationship between two series; where volume and rate
 * both need showing, two panels are stacked instead. Here both lines are the
 * same unit anyway, which is what makes one axis honest.
 *
 * COUNTS OR MONEY, THE CALLER'S CHOICE — but never both at once. Delivered
 * revenue and refused value on one axis look comparable and are not the same
 * question, so the screen carries a switch and this chart draws one of them.
 */

export interface DailyOutcomePoint {
  readonly date: string
  readonly deliveredOrders: number
  readonly deliveredAmount: number
  readonly refusedOrders: number
  readonly refusedAmount: number
  readonly orders: number
  readonly amount: number
}

export function DailyOutcomeChart({
  data,
  unit,
  height,
}: {
  data: readonly DailyOutcomePoint[]
  unit: 'orders' | 'money'
  height?: number
}) {
  // Recharts drives its draw-in from JS, out of reach of the CSS media guards
  // every other animation sits behind — so it asks the same question here.
  const reducedMotion = useReducedMotion()

  const money = unit === 'money'
  const points = data.map((point) => ({
    ...point,
    label: formatDateShort(point.date),
    done: money ? point.deliveredAmount : point.deliveredOrders,
    lost: money ? point.refusedAmount : point.refusedOrders,
  }))

  const last = points[points.length - 1]
  const fmt = (value: number) => (money ? formatFullUzs(value) : formatNumber(value))
  const doneEnd = last ? fmt(last.done) : undefined
  const lostEnd = last ? fmt(last.lost) : undefined

  /*
    Two final values share one right edge, so they are nudged apart when they
    would print on top of each other. The threshold is a share of the plot's
    own range rather than a fixed amount, because the axis rescales with the
    window and with the unit switch.
  */
  const span = points.reduce((max, point) => Math.max(max, point.done, point.lost), 0)
  const endsCollide = last !== undefined && span > 0 && Math.abs(last.done - last.lost) < span * 0.06

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: height ?? '100%' }}>
      {/* Ours, not Recharts' <Legend>: its own reserves a band inside the plot
          and re-lays the chart out when it wraps. */}
      <div
        className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]"
        style={{ color: 'var(--ink-secondary)' }}
      >
        <LegendItem color="var(--series-3)" label="Успешно" />
        <LegendItem color="var(--series-8)" label="Отказ" />
        <span style={{ color: 'var(--ink-muted)' }}>Navbatga tushgan sana boʻyicha</span>
      </div>

      {/*
        The absolute-fill sandwich. `height: 100%` resolves against the
        parent's HEIGHT PROPERTY, and in a plain card that is `auto` — the
        percentage resolves to auto, the box computes to zero and Recharts
        draws nothing at all. An absolutely-positioned child resolves its inset
        against the used padding box instead, min-height included, so the
        measurer always sees a real rectangle.
      */}
      <div style={{ position: 'relative', width: '100%', flex: 1, minHeight: 260 }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={points}
              margin={{
                top: 8,
                right: Math.max(
                  doneEnd ? endpointLabelWidth(doneEnd) : 8,
                  lostEnd ? endpointLabelWidth(lostEnd) : 8,
                ),
                left: 0,
                bottom: 0,
              }}
            >
              <CartesianGrid vertical={false} stroke="var(--grid)" strokeDasharray="0" />

              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
                // Thin the ticks rather than rotating them: rotated labels are
                // slower to read and eat vertical space the plot needs.
                interval="preserveStartEnd"
                minTickGap={28}
              />

              <YAxis
                tickLine={false}
                axisLine={false}
                // Measures the rendered labels instead of guessing a width, so
                // the gutter is exactly as wide as this window's numbers need.
                width="auto"
                tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
                tickFormatter={fmt}
                allowDecimals={false}
              />

              <Tooltip
                cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
                isAnimationActive={false}
                content={<DailyTooltip money={money} />}
              />

              <Line
                type="monotone"
                dataKey="done"
                stroke="var(--series-3)"
                strokeWidth={2}
                dot={endpointDot({
                  lastIndex: points.length - 1,
                  color: 'var(--series-3)',
                  label: doneEnd,
                  showLabel: true,
                  labelShift: endsCollide ? -9 : 0,
                })}
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

              <Line
                type="monotone"
                dataKey="lost"
                stroke="var(--series-8)"
                strokeWidth={2}
                dot={endpointDot({
                  lastIndex: points.length - 1,
                  color: 'var(--series-8)',
                  label: lostEnd,
                  showLabel: true,
                  labelShift: endsCollide ? 9 : 0,
                })}
                activeDot={{
                  r: 4,
                  fill: 'var(--series-8)',
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
    </div>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: color,
          display: 'inline-block',
        }}
      />
      {label}
    </span>
  )
}

interface TooltipPayload {
  payload?: DailyOutcomePoint & { label: string; done: number; lost: number }
}

/**
 * The tooltip carries the day's WHOLE row, not only the drawn series.
 *
 * ЗАКАЗ is what the two lines are shares of, and a reader inspecting a bad day
 * wants to know whether Отказ rose or ЗАКАЗ fell. Both are already on the
 * point, so stating them costs nothing and answers the question the chart
 * would otherwise raise and leave open.
 */
function DailyTooltip({
  money,
  active,
  payload,
}: {
  money: boolean
  active?: boolean
  payload?: readonly TooltipPayload[]
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  const value = (orders: number, amount: number) =>
    money ? formatUzs(amount) : `${formatNumber(orders)} ta`

  return (
    <ChartTooltipPanel
      header={point.label}
      rows={[
        {
          swatch: 'var(--series-3)',
          label: 'Успешно',
          value: value(point.deliveredOrders, point.deliveredAmount),
        },
        {
          swatch: 'var(--series-8)',
          label: 'Отказ',
          value: value(point.refusedOrders, point.refusedAmount),
        },
        { label: 'ЗАКАЗ', value: value(point.orders, point.amount) },
      ]}
      footer="Navbatga tushgan sana boʻyicha"
    />
  )
}
