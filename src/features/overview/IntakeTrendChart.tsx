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
import type { IntakeDayDto } from '@/lib/api'
import { formatDateShort, formatNumber, formatUzs } from '@/lib/format'
import { useReducedMotion } from '@/lib/useReducedMotion'

/**
 * Order intake, day by day — the hero's own evidence.
 *
 * The headline above this chart is the period's order count, and this is that
 * same count spread over its days: the area under the line IS the tile. One
 * series, so no legend — the panel's header names the measure. Booked value
 * rides in the tooltip rather than on a second axis: a money scale laid over
 * a count scale is the dual-axis chart the design system bans, and the daily
 * money figure is a detail, not the story.
 *
 * The dashed reference is the PREVIOUS window's intake as orders-per-day —
 * the honest way to put last month on this chart. Splicing its daily series
 * in as a second line would compare Tuesday to a different Tuesday at a
 * different month-position; one flat line saying "last period averaged this"
 * makes the comparison the reader actually wants, without the false zip.
 */
export function IntakeTrendChart({
  data,
  previousDailyOrders,
  height = 240,
}: {
  data: readonly IntakeDayDto[]
  previousDailyOrders: number | null
  height?: number
}) {
  const reducedMotion = useReducedMotion()

  /** Hover near the right edge hides the endpoint label — same collision
      rule as the revenue trend chart, for the same reason. */
  const [cursorNearEnd, setCursorNearEnd] = useState(false)

  const points = data.map((d) => ({ ...d, label: formatDateShort(d.date) }))
  const last = points[points.length - 1]
  const endLabel = last ? formatNumber(last.orders) : undefined

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
      style={{ position: 'relative', width: '100%', height, minHeight: height }}
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
              <linearGradient id="intakeFill" x1="0" y1="0" x2="0" y2="1">
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
              tickFormatter={(value: number) => formatNumber(value)}
              allowDecimals={false}
            />

            <Tooltip
              cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
              isAnimationActive={false}
              content={<IntakeTooltip />}
            />

            {/* Before the Area, so the hairline sits BEHIND the data. */}
            {previousDailyOrders !== null && (
              <ReferenceLine
                y={previousDailyOrders}
                stroke="var(--axis)"
                strokeDasharray="4 4"
                ifOverflow="extendDomain"
                label={{
                  value: `oʻtgan davr: kuniga ~${formatNumber(previousDailyOrders)}`,
                  position: 'insideTopRight',
                  fill: 'var(--ink-muted)',
                  fontSize: 11,
                }}
              />
            )}

            <Area
              type="monotone"
              dataKey="orders"
              stroke="var(--series-1)"
              strokeWidth={2}
              fill="url(#intakeFill)"
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
  payload?: IntakeDayDto & { label: string }
}

function IntakeTooltip({
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
        { swatch: 'var(--series-1)', label: 'Buyurtma olindi', value: formatNumber(point.orders) },
        // The exact amount: a tooltip is precisely the place compacting is
        // not allowed to drop digits — or the unit.
        { label: 'Bron summa', value: formatUzs(point.booked) },
      ]}
    />
  )
}
