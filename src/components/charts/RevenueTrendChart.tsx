'use client'

import { useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { endpointDot, endpointLabelWidth } from '@/components/charts/chartEndpoint'
import { ChartTooltipPanel } from '@/components/charts/chartTooltip'
import type { TrendPointDto } from '@/lib/api'
import { formatCompactUzs, formatDateShort, formatNumber, formatUzs } from '@/lib/format'
import { t } from '@/lib/messages'
import { useReducedMotion } from '@/lib/useReducedMotion'

/**
 * Revenue over time.
 *
 * ONE series, so there is no legend — the card title names the measure, and a
 * legend box for a single line is noise. Revenue and deal count are NOT plotted
 * together on two y-axes: a dual-axis chart lets the author imply any
 * correlation they like by rescaling. The deal count lives in the tooltip
 * instead, where it is exact and cannot mislead.
 *
 * Grid and axes are recessive; the data is the only thing with weight. No axis
 * spine anywhere — the bottom gridline and the tick labels already say where
 * zero and the dates are, and a drawn spine is a box the chart does not need.
 */
export function RevenueTrendChart({
  data,
  height,
  referenceValue,
  referenceLabel,
}: {
  data: readonly TrendPointDto[]
  /**
   * Fixed height, or omit to fill the container.
   *
   * It was hard-coded at 280px, which is fine on its own and wrong beside a
   * taller neighbour: in the overview's two-column row the funnel next to it
   * ran to 628px and left 348px of empty card under the chart. A trend line
   * with twice the vertical resolution is worth more than that whitespace.
   */
  height?: number
  /**
   * Optional horizontal reference — a dashed hairline at this value, e.g. the
   * previous period's average, so "is this good?" is answerable from the
   * chart itself. Drawn in --axis, not a series colour: it is context, not
   * data, and must never compete with the line for attention.
   */
  referenceValue?: number
  /** Label for the reference line, small and right-aligned above it. */
  referenceLabel?: string
}) {
  // Recharts drives its draw-in from JS, out of reach of the CSS media
  // guards every other animation sits behind — so it asks the same question
  // in component code.
  const reducedMotion = useReducedMotion()

  /**
   * Whether the cursor is hovering the FINAL quarter of the plot. The
   * endpoint value label lives at the right edge, exactly where the tooltip
   * and crosshair end up when the reader inspects recent points — so the
   * label yields while the tooltip is in its territory. The tooltip states
   * the same value precisely, so nothing is lost while it is hidden.
   */
  const [cursorNearEnd, setCursorNearEnd] = useState(false)

  const points = data.map((point) => ({
    ...point,
    label: formatDateShort(point.date),
  }))

  const last = points[points.length - 1]
  const endLabel = last ? formatCompactUzs(last.revenue) : undefined

  const handleMove = (state: { activeTooltipIndex?: number | string | null | undefined }) => {
    const raw = state?.activeTooltipIndex
    const index = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
    setCursorNearEnd(
      Number.isFinite(index) && index >= points.length - Math.max(2, Math.ceil(points.length / 4)),
    )
  }

  return (
    /*
      The absolute-fill sandwich, and why it exists.

      `height: 100%` resolves against the parent's HEIGHT PROPERTY, and when
      that is `auto` — any plain ChartCard — the percentage resolves to auto,
      the chart's box computes to zero, and Recharts draws nothing. min-height
      raises the USED height, but percentage resolution never looks at used
      heights, so the sales page rendered a 260px card with an empty chart in
      it. An absolutely-positioned child, by contrast, resolves inset against
      the used padding box — min-height included — so the measurer always sees
      the real rectangle, in a flex parent and a plain card alike.
    */
    <div
      className="glow-series-1"
      style={{ position: 'relative', width: '100%', height: height ?? '100%', minHeight: 260 }}
    >
      <div style={{ position: 'absolute', inset: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={points}
          // Right margin reserves the endpoint label's column so the final
          // figure is never clipped by the SVG edge. Reserved even while the
          // label is hidden — a margin that follows hover would make the whole
          // plot breathe on every mouse move.
          margin={{ top: 8, right: endLabel ? endpointLabelWidth(endLabel) : 8, left: 0, bottom: 0 }}
          onMouseMove={handleMove}
          onMouseLeave={() => setCursorNearEnd(false)}
        >
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.01} />
            </linearGradient>
          </defs>

          <CartesianGrid
            vertical={false}
            stroke="var(--grid)"
            strokeDasharray="0"
          />

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
            /*
              'auto' measures the rendered tick labels instead of guessing.
              The old constant was 64 — sized for '900 mln', the worst case —
              which taxed every chart whose ticks were '80 mln' with dead
              gutter. Letting Recharts measure gives the tight width AND
              survives the mlrd-scale charts that forced 64 in the first
              place.
            */
            width="auto"
            tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
            tickFormatter={(value: number) => formatCompactUzs(value)}
          />

          <Tooltip
            // The crosshair: one hairline in axis ink, snapped to the point.
            cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
            // The tooltip tracks the pointer with no easing lag — an animated
            // chase reads as sluggishness, not polish — which also means there
            // is nothing here for reduced-motion to switch off.
            isAnimationActive={false}
            content={<TrendTooltip />}
          />

          {/* Before the Area so the hairline sits BEHIND the data: SVG paints
              in document order, and context must never overdraw the series. */}
          {referenceValue !== undefined && (
            <ReferenceLine
              y={referenceValue}
              stroke="var(--axis)"
              strokeDasharray="4 4"
              // A target above every data point must still be visible —
              // clipping it would silently hide the one line that says
              // "you are below the bar".
              ifOverflow="extendDomain"
              label={
                referenceLabel
                  ? {
                      value: referenceLabel,
                      position: 'insideTopRight',
                      fill: 'var(--ink-muted)',
                      fontSize: 11,
                    }
                  : undefined
              }
            />
          )}

          <Area
            type="monotone"
            dataKey="revenue"
            stroke="var(--series-1)"
            strokeWidth={2}
            fill="url(#revenueFill)"
            // No dot per point — at 23+ points they merge into a dotted line.
            // Only the LAST point is marked: it is the value the chart is
            // stating, and the printed figure beside it ties shape to number.
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

interface TooltipPayload {
  payload?: TrendPointDto & { label: string }
}

/**
 * Payload → rows. The mapping stays here, beside the chart that knows what
 * its series mean; the drawing lives in ChartTooltipPanel, shared app-wide.
 */
function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: TooltipPayload[]
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null

  return (
    <ChartTooltipPanel
      header={point.label}
      rows={[
        { swatch: 'var(--series-1)', label: t.cards.revenue, value: formatUzs(point.revenue) },
        { label: t.cards.dealsWon, value: formatNumber(point.dealsWon) },
        { label: t.cards.dealsCreated, value: formatNumber(point.dealsCreated) },
      ]}
    />
  )
}
