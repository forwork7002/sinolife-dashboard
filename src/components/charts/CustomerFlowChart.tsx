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
import type { CustomerFlowPointDto } from '@/lib/api'
import { formatDateShort, formatNumber } from '@/lib/format'
import { useReducedMotion } from '@/lib/useReducedMotion'

/**
 * Yangi mijozlar against qaytgan mijozlar, day by day, on «Mijozlar oqimi».
 *
 * MODELLED ON `DailyOutcomeChart`, NOT GENERALISED FROM IT. Two small charts
 * that happen to share a shape are cheaper to read, here and at the call
 * site, than one chart with four props deciding what it means — so this file
 * copies the tooltip panel, the hand-rolled legend and the reduced-motion
 * guard rather than adding a `unit` or a `grain` switch to the other chart.
 *
 * ONE Y AXIS, AND IT IS NOT A STYLE CHOICE. A second axis can be rescaled to
 * imply any relationship between two series, which is why this codebase
 * forbids one (see `DailyOutcomeChart`'s header, and `CategoryBarList`'s).
 * Both lines here count PEOPLE, which is what makes a single axis honest —
 * and the gap between them IS the reading: on this portal returning
 * customers run at roughly a seventh of new ones, and the question a reader
 * brings is whether that ratio is moving, not what either line's raw height
 * is.
 *
 * THE SERIES DOES NOT GAP-FILL. A day with no orders at all emits no row, so
 * a quiet day is a MISSING point, not a zero — the server only returns
 * buckets that had activity. At this portal's volume (roughly 77 new
 * customers a day) that will rarely bite, but a reader who sees a straight
 * segment between two points spanning more than a day should be able to
 * trace it to an absent row rather than an invented zero.
 */

export function CustomerFlowChart({
  data,
  height,
}: {
  data: readonly CustomerFlowPointDto[]
  height?: number
}) {
  // Recharts drives its draw-in from JS, out of reach of the CSS media guards
  // every other animation sits behind — so it asks the same question here.
  const reducedMotion = useReducedMotion()

  const points = data.map((point) => ({
    ...point,
    label: formatDateShort(point.bucket),
  }))

  const last = points[points.length - 1]
  const newEnd = last ? formatNumber(last.newCustomers) : undefined
  const returningEnd = last ? formatNumber(last.returningCustomers) : undefined

  /*
    Two final values share one right edge, so they are nudged apart when they
    would print on top of each other. The threshold is a share of the plot's
    own range rather than a fixed amount, because the axis rescales with the
    window. Modelled on `DailyOutcomeChart`'s identical guard.
  */
  const span = points.reduce(
    (max, point) => Math.max(max, point.newCustomers, point.returningCustomers),
    0,
  )
  const endsCollide =
    last !== undefined &&
    span > 0 &&
    Math.abs(last.newCustomers - last.returningCustomers) < span * 0.06

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: height ?? '100%' }}>
      {/* Ours, not Recharts' <Legend>: its own reserves a band inside the plot
          and re-lays the chart out when it wraps. */}
      <div
        className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]"
        style={{ color: 'var(--ink-secondary)' }}
      >
        <LegendItem color="var(--series-1)" label="Yangi mijoz" />
        <LegendItem color="var(--series-3)" label="Qaytgan mijoz" />
      </div>

      {/*
        The absolute-fill sandwich. `height: 100%` resolves against the
        parent's HEIGHT PROPERTY, and in a plain card that is `auto` — the
        percentage resolves to auto, the box computes to zero and Recharts
        draws nothing at all. An absolutely-positioned child resolves its inset
        against the used padding box instead, min-height included, so the
        measurer always sees a real rectangle.
      */}
      <div style={{ position: 'relative', width: '100%', flex: 1, minHeight: 220 }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={points}
              margin={{
                top: 8,
                right: Math.max(
                  newEnd ? endpointLabelWidth(newEnd) : 8,
                  returningEnd ? endpointLabelWidth(returningEnd) : 8,
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
                tickFormatter={formatNumber}
                allowDecimals={false}
              />

              <Tooltip
                cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
                isAnimationActive={false}
                content={<FlowTooltip />}
              />

              <Line
                type="monotone"
                dataKey="newCustomers"
                stroke="var(--series-1)"
                strokeWidth={2}
                dot={endpointDot({
                  lastIndex: points.length - 1,
                  color: 'var(--series-1)',
                  label: newEnd,
                  showLabel: true,
                  labelShift: endsCollide ? -9 : 0,
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

              <Line
                type="monotone"
                dataKey="returningCustomers"
                stroke="var(--series-3)"
                strokeWidth={2}
                dot={endpointDot({
                  lastIndex: points.length - 1,
                  color: 'var(--series-3)',
                  label: returningEnd,
                  showLabel: true,
                  labelShift: endsCollide ? 9 : 0,
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
  payload?: CustomerFlowPointDto & { label: string }
}

function FlowTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: readonly TooltipPayload[]
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  return (
    <ChartTooltipPanel
      header={point.label}
      rows={[
        {
          swatch: 'var(--series-1)',
          label: 'Yangi mijoz',
          value: `${formatNumber(point.newCustomers)} ta`,
        },
        {
          swatch: 'var(--series-3)',
          label: 'Qaytgan mijoz',
          value: `${formatNumber(point.returningCustomers)} ta`,
        },
      ]}
    />
  )
}
