'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ChartTooltipPanel } from '@/components/charts/chartTooltip'
import type { CallSideSeriesPointDto } from '@/lib/api'
import { CALL_SIDES, type CallSideKey } from '@/lib/callQuality'
import { formatDateShort, formatNumber } from '@/lib/format'
import { useReducedMotion } from '@/lib/useReducedMotion'

/**
 * Connected talk time per day, stacked by which side of the base was rung.
 *
 * MODELLED ON `CustomerFlowChart`, NOT GENERALISED FROM IT — the tooltip panel,
 * the hand-rolled legend, the absolute-fill sandwich and the reduced-motion
 * guard are copied for the reason that file gives.
 *
 * STACKED, BECAUSE THE STACK TOP IS THE TILE. Three areas — Baza, Baza emas,
 * and calls with no customer attached — sum to the day's connected talk time,
 * which is the «Suhbat vaqti» tile beside the chart. That is why the unlinked
 * side is drawn rather than dropped: without it the stack would fall short of
 * the tile and the reader would be left to reconcile the difference.
 *
 * ONE AXIS, IN HOURS. Every area is the same unit, which is what makes stacking
 * honest; a second axis is forbidden in this codebase. Hours and not seconds,
 * because a day on this floor is a six-figure number of seconds and an axis in
 * six figures is read as an error.
 *
 * THE SERIES DOES NOT GAP-FILL DAYS. The server emits only days that carry
 * calls; recharts draws straight across a missing day, and a manufactured zero
 * would assert that nobody spoke where the truth is that nothing was recorded.
 * Within a day that IS present, a silent side is zero seconds, which is true.
 */

export interface TalkChartPoint extends Record<CallSideKey, number> {
  readonly day: string
  readonly label: string
  /** Hours, all sides — equal to the stack top. */
  readonly total: number
}

/** Seconds per side → hours per side, plus the day total the stack reaches. */
export function talkChartPoints(data: readonly CallSideSeriesPointDto[]): TalkChartPoint[] {
  return data.map((point) => {
    const hours = Object.fromEntries(
      CALL_SIDES.map((side) => [side.key, point.talkSec[side.key] / 3600]),
    ) as Record<CallSideKey, number>
    const total = CALL_SIDES.reduce((sum, side) => sum + hours[side.key], 0)
    return { day: point.day, label: formatDateShort(point.day), total, ...hours }
  })
}

export function CallTalkChart({
  data,
  height,
}: {
  data: readonly CallSideSeriesPointDto[]
  height?: number
}) {
  const reducedMotion = useReducedMotion()
  const points = talkChartPoints(data)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: height ?? '100%' }}>
      {/* Ours, not Recharts' <Legend> — see CustomerFlowChart. */}
      <div
        className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]"
        style={{ color: 'var(--ink-secondary)' }}
      >
        {CALL_SIDES.map((side) => (
          <LegendItem key={side.key} color={`var(${side.colour})`} label={side.label} />
        ))}
      </div>

      {/* The absolute-fill sandwich — see CustomerFlowChart for why. */}
      <div style={{ position: 'relative', width: '100%', flex: 1, minHeight: 220 }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                tickFormatter={(value: number) => formatNumber(Math.round(value))}
              />

              <Tooltip
                cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
                isAnimationActive={false}
                content={<TalkTooltip />}
              />

              {CALL_SIDES.map((side) => (
                <Area
                  key={side.key}
                  type="monotone"
                  dataKey={side.key}
                  stackId="talk"
                  stroke={`var(${side.colour})`}
                  fill={`var(${side.colour})`}
                  fillOpacity={0.35}
                  strokeWidth={1.5}
                  isAnimationActive={!reducedMotion}
                  animationDuration={520}
                  animationEasing="ease-out"
                />
              ))}
            </AreaChart>
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
        style={{ width: 8, height: 8, borderRadius: 999, background: color, display: 'inline-block' }}
      />
      {label}
    </span>
  )
}

function hours(value: number): string {
  return `${formatNumber(Math.round(value * 10) / 10)} soat`
}

function TalkTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: readonly { payload?: TalkChartPoint }[]
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  return (
    <ChartTooltipPanel
      header={point.label}
      rows={[
        ...CALL_SIDES.map((side) => ({
          swatch: `var(${side.colour})`,
          label: side.label,
          value: hours(point[side.key]),
        })),
        // No swatch: the total is not a series, and a swatchless row is how
        // chartTooltip already sets a summary apart.
        { label: 'Jami', value: hours(point.total) },
      ]}
    />
  )
}
