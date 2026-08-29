'use client'

import type { ReactNode } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ChartTooltipPanel } from '@/components/charts/chartTooltip'
import type { RejectionDayDto } from '@/lib/api'
import { formatDateShort, formatNumber, formatPercent } from '@/lib/format'
import { useReducedMotion } from '@/lib/useReducedMotion'

/**
 * The rejection share as a control CHART, not a control bar.
 *
 * The bar this replaces could say where TODAY stood against the band; it
 * could not say whether yesterday was creeping, whether the two breaches were
 * adjacent, or whether the mean itself is drifting — and those are exactly
 * the questions a control measure exists to answer. The daily line says all
 * of it in one look.
 *
 * The anatomy is deliberate:
 *  - the band (0 → mean+2σ) is a tinted ground, so "inside the band" is
 *    visible without reading a number;
 *  - the limit is a labelled hairline — the edge IS the decision, so it gets
 *    ink, not tint;
 *  - the mean is dashed context;
 *  - only three kinds of day get a dot: breaches (the alarm), Sundays (out
 *    of the baseline — hollow, so the eye reads "different regime"), and
 *    today (the reading the panel is stating). A dot on every day would
 *    merge into a dotted smear.
 *
 * The line is drawn in the sequential hue like every "how much" measure, and
 * the breach dots wear the critical status — state, not identity. A day with
 * no queue traffic is a GAP (share null, connectNulls off): "not measured"
 * and "0% rejected" are different claims.
 */
export function RejectionControlChart({
  data,
  mean,
  limit,
  height = 240,
}: {
  data: readonly RejectionDayDto[]
  mean: number
  limit: number
  height?: number
}) {
  const reducedMotion = useReducedMotion()

  const points = data.map((d) => ({ ...d, label: formatDateShort(d.date) }))
  const lastMeasured = [...points].reverse().find((p) => p.sharePercent !== null)

  // The band decides the scale, exactly as the bar it replaced did: a 0–100
  // axis would compress the whole interesting range into its first fifth.
  const dataMax = Math.max(...points.map((p) => p.sharePercent ?? 0), 0)
  const yMax = Math.ceil(Math.max(limit * 1.25, dataMax * 1.1, 1))

  const renderDot = ({ cx, cy, index }: { cx?: unknown; cy?: unknown; index?: unknown }): ReactNode => {
    if (typeof cx !== 'number' || typeof cy !== 'number' || typeof index !== 'number') return null
    const p = points[index]
    if (!p || p.sharePercent === null) return null

    // Sunday FIRST: it is outside the baseline, so it cannot breach a limit
    // that was computed without it. A Sunday over the working-day line is
    // still a different regime, not an alarm — the caption promises hollow.
    const breached = !p.sunday && limit > 0 && p.sharePercent > limit
    const isLast = lastMeasured !== undefined && p.date === lastMeasured.date

    if (p.sunday) {
      return (
        <circle
          cx={cx}
          cy={cy}
          r={3}
          fill="var(--surface-raised)"
          stroke="var(--ink-muted)"
          strokeWidth={1.5}
        />
      )
    }
    if (breached) {
      return (
        <circle
          cx={cx}
          cy={cy}
          r={4.5}
          fill="var(--status-critical)"
          stroke="var(--surface-raised)"
          strokeWidth={2}
        />
      )
    }
    if (isLast) {
      return (
        <circle
          cx={cx}
          cy={cy}
          r={4.5}
          fill="var(--seq-450)"
          stroke="var(--surface-raised)"
          strokeWidth={2}
        />
      )
    }
    return null
  }

  return (
    <div style={{ position: 'relative', width: '100%', height, minHeight: height }}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
              domain={[0, yMax]}
              tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
              tickFormatter={(value: number) => formatPercent(value, 0)}
            />

            <Tooltip
              cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
              isAnimationActive={false}
              content={<ControlTooltip limit={limit} />}
            />

            {/* The calm ground first, then the edges, then the data —
                SVG paints in document order and context must stay under. */}
            {limit > 0 && (
              <ReferenceArea
                y1={0}
                y2={limit}
                fill="var(--status-good)"
                fillOpacity={0.08}
                stroke="none"
              />
            )}
            {limit > 0 && (
              <ReferenceLine
                y={mean}
                stroke="var(--axis)"
                strokeDasharray="4 4"
                label={{
                  value: `odatda ${formatPercent(mean)}`,
                  position: 'insideBottomRight',
                  fill: 'var(--ink-muted)',
                  fontSize: 11,
                }}
              />
            )}
            {limit > 0 && (
              <ReferenceLine
                y={limit}
                stroke="var(--ink-secondary)"
                label={{
                  value: `chegara ${formatPercent(limit)}`,
                  position: 'insideTopRight',
                  fill: 'var(--ink-secondary)',
                  fontSize: 11,
                }}
              />
            )}

            <Line
              type="linear"
              dataKey="sharePercent"
              stroke="var(--seq-450)"
              strokeWidth={2}
              connectNulls={false}
              dot={renderDot}
              // A render, not a config: the hover dot inherits the day's own
              // colour. The default would paint the magnitude hue OVER a
              // breach's critical dot at exactly the moment of inspection.
              activeDot={(props: { cx?: unknown; cy?: unknown; payload?: unknown }) => {
                const cx = props.cx
                const cy = props.cy
                const day = props.payload as (typeof points)[number] | undefined
                if (typeof cx !== 'number' || typeof cy !== 'number' || !day) return <g />
                const color = day.sunday
                  ? 'var(--ink-muted)'
                  : limit > 0 && day.sharePercent !== null && day.sharePercent > limit
                    ? 'var(--status-critical)'
                    : 'var(--seq-450)'
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={4}
                    fill={color}
                    stroke="var(--surface-raised)"
                    strokeWidth={2}
                  />
                )
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

interface TooltipPayload {
  payload?: RejectionDayDto & { label: string }
}

function ControlTooltip({
  active,
  payload,
  limit,
}: {
  active?: boolean
  payload?: TooltipPayload[]
  limit?: number
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null

  const breached =
    !point.sunday &&
    point.sharePercent !== null &&
    limit !== undefined &&
    limit > 0 &&
    point.sharePercent > limit

  return (
    <ChartTooltipPanel
      header={point.sunday ? `${point.label} — yakshanba, bazadan tashqari` : point.label}
      rows={[
        {
          swatch: breached ? 'var(--status-critical)' : 'var(--seq-450)',
          label: 'Rad etish ulushi',
          value: point.sharePercent === null ? 'oʻlchanmagan' : formatPercent(point.sharePercent),
        },
        { label: 'Rad etilgan', value: formatNumber(point.rejected) },
        { label: 'Navbatga tushdi', value: formatNumber(point.orders) },
      ]}
    />
  )
}
