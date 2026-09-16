'use client'

import { useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { endpointDot, endpointLabelWidth } from '@/components/charts/chartEndpoint'
import { ChartTooltipPanel } from '@/components/charts/chartTooltip'
import { OUTCOME_SPECS, type RatePoint } from '@/features/sales/confirmationOutcomes'
import { formatDateShort, formatNumber, formatPercent } from '@/lib/format'
import { useReducedMotion } from '@/lib/useReducedMotion'

/**
 * «Тасдиқланиш %» over time — the confirmation queue's rate, bucket by bucket,
 * with the period's own rate drawn across it.
 *
 * ONE SERIES, ONE AXIS, AND THE AXIS IS FIXED AT 0–100. A rate axis that
 * autoscaled to the data would draw a month that moved between 84% and 92% as
 * a mountain range; pinned to the whole range it is the gentle line it is,
 * and two months side by side are drawn to the same scale. The dashed
 * reference is the period's pooled rate — the SAME figure the tile above the
 * chart prints, so "is this day above or below the period?" is answered by
 * the plot, and the reader never meets two averages under one name.
 *
 * NO LEGEND BOX: a single series is named by the heading over it, and a
 * legend with one entry is a box that says nothing. The basis line stays,
 * because a cohort dated by its ARRIVAL is the one thing here worth saying
 * twice.
 *
 * A BUCKET NOTHING ENTERED IS A GAP, not a zero. `connectNulls` is off on
 * purpose: bridging it would draw a rate across a day that had no orders to
 * rate. A day whose every order was refused IS a zero, and is drawn.
 *
 * The tooltip carries the bucket's whole partition — all five states and the
 * total — because a low point raises exactly one question (refusals up, or
 * intake down?) and the point already holds the answer.
 */
export function ConfirmedRateChart({
  data,
  height,
  referenceValue,
  referenceLabel,
}: {
  data: readonly RatePoint[]
  height?: number
  /** The period's pooled rate, 0–100. Drawn in --axis: context, not a series. */
  referenceValue?: number
  referenceLabel?: string
}) {
  const reducedMotion = useReducedMotion()

  /** See `FaktTrendChart`: the endpoint label yields to the tooltip near the right edge. */
  const [cursorNearEnd, setCursorNearEnd] = useState(false)

  const points = data.map((point) => ({ ...point, label: formatDateShort(point.date) }))
  const last = points[points.length - 1]
  const endLabel = last && last.rate !== null ? formatPercent(last.rate) : undefined

  const handleMove = (state: { activeTooltipIndex?: number | string | null | undefined }) => {
    const raw = state?.activeTooltipIndex
    const index = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
    setCursorNearEnd(
      Number.isFinite(index) && index >= points.length - Math.max(2, Math.ceil(points.length / 4)),
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: height ?? '100%' }}>
      <div
        className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]"
        style={{ color: 'var(--ink-muted)' }}
      >
        <span>Тасдиқланди ÷ navbatga tushganlar, har bir kun uchun</span>
        <span>Navbatga tushgan sana boʻyicha</span>
      </div>

      {/* The absolute-fill sandwich — see `FaktTrendChart` for why. */}
      <div style={{ position: 'relative', width: '100%', flex: 1, minHeight: 200 }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={points}
              margin={{
                top: 8,
                right: endLabel ? endpointLabelWidth(endLabel) : 8,
                left: 0,
                bottom: 0,
              }}
              onMouseMove={handleMove}
              onMouseLeave={() => setCursorNearEnd(false)}
            >
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
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(value: number) => `${value}%`}
              />

              <Tooltip
                cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
                isAnimationActive={false}
                content={<RateTooltip />}
              />

              {/* Before the series, so the hairline sits BEHIND the data. */}
              {referenceValue !== undefined && (
                <ReferenceLine
                  y={referenceValue}
                  stroke="var(--axis)"
                  strokeDasharray="4 4"
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

              <Line
                type="monotone"
                dataKey="rate"
                stroke="var(--status-good)"
                strokeWidth={2}
                connectNulls={false}
                dot={endpointDot({
                  lastIndex: points.length - 1,
                  color: 'var(--status-good)',
                  label: endLabel,
                  showLabel: !cursorNearEnd,
                })}
                activeDot={{
                  r: 4,
                  fill: 'var(--status-good)',
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

interface TooltipPayload {
  payload?: RatePoint & { label: string }
}

function RateTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null

  return (
    <ChartTooltipPanel
      header={point.label}
      rows={[
        { label: 'Тасдиқланиш %', value: formatPercent(point.rate) },
        ...OUTCOME_SPECS.map((spec) => ({
          swatch: spec.colour,
          label: spec.label,
          value: `${formatNumber(point.byOutcome[spec.key])} ta`,
        })),
        { label: 'Navbatga tushdi', value: `${formatNumber(point.cohortOrders)} ta` },
      ]}
      footer="Navbatga tushgan sana boʻyicha"
    />
  )
}
