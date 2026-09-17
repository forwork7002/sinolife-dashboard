'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ChartTooltipPanel } from '@/components/charts/chartTooltip'
import type { CallTimePoint } from '@/components/charts/callTimePoints'
import { NO_VALUE, formatDuration, formatNumber, formatPercent } from '@/lib/format'
import { useReducedMotion } from '@/lib/useReducedMotion'

/**
 * Calls and connected calls over time — by hour of the day, or by day.
 *
 * ONE COMPONENT FOR BOTH AXES. The two cards on «Qoʻngʻiroqlar» ask the same
 * question at two grains («when do we talk?»), and a second chart would be a
 * second tooltip that could drift from the first.
 *
 * TWO BARS, ONE AXIS, ONE UNIT. «Qoʻngʻiroq» and «Ulangan» are both counts of
 * legs, so they share the axis honestly; a second axis is forbidden in this
 * codebase. Talk time and the median ride the tooltip rather than a third mark,
 * because seconds on a count axis would be a second unit.
 */

const CALLS_COLOUR = 'var(--series-1)'
const CONNECTED_COLOUR = 'var(--series-3)'

export function CallTimeChart({
  points,
  headerLabel,
  height,
}: {
  points: readonly CallTimePoint[]
  /** Turns a point's label into the tooltip header, e.g. «09:00 – 09:59». */
  headerLabel?: (point: CallTimePoint) => string
  height?: number
}) {
  const reducedMotion = useReducedMotion()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: height ?? '100%' }}>
      <div
        className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]"
        style={{ color: 'var(--ink-secondary)' }}
      >
        <LegendItem color={CALLS_COLOUR} label="Qoʻngʻiroq" />
        <LegendItem color={CONNECTED_COLOUR} label="Ulangan" />
      </div>

      {/* The absolute-fill sandwich — see CustomerFlowChart for why. */}
      <div style={{ position: 'relative', width: '100%', flex: 1, minHeight: 200 }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={points as CallTimePoint[]}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              barGap={2}
              barCategoryGap="20%"
            >
              <CartesianGrid vertical={false} stroke="var(--grid)" strokeDasharray="0" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width="auto"
                allowDecimals={false}
                tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
                tickFormatter={(value: number) => formatNumber(Math.round(value))}
              />
              <Tooltip
                cursor={{ fill: 'var(--track)' }}
                isAnimationActive={false}
                content={<TimeTooltip headerLabel={headerLabel} />}
              />
              <Bar
                dataKey="calls"
                fill={CALLS_COLOUR}
                radius={[3, 3, 0, 0]}
                isAnimationActive={!reducedMotion}
                animationDuration={420}
              />
              <Bar
                dataKey="connected"
                fill={CONNECTED_COLOUR}
                radius={[3, 3, 0, 0]}
                isAnimationActive={!reducedMotion}
                animationDuration={420}
              />
            </BarChart>
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
        style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }}
      />
      {label}
    </span>
  )
}

function TimeTooltip({
  active,
  payload,
  headerLabel,
}: {
  active?: boolean
  payload?: readonly { payload?: CallTimePoint }[]
  headerLabel?: (point: CallTimePoint) => string
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  return (
    <ChartTooltipPanel
      header={headerLabel ? headerLabel(point) : point.label}
      rows={[
        { swatch: CALLS_COLOUR, label: 'Qoʻngʻiroq', value: formatNumber(point.calls) },
        {
          swatch: CONNECTED_COLOUR,
          label: 'Ulangan',
          value: `${formatNumber(point.connected)} · ${formatPercent(point.connectPercent)}`,
        },
        { label: 'Suhbat vaqti', value: formatDuration(point.talkSec) },
        {
          label: 'Median suhbat',
          value: point.medianSec === null ? NO_VALUE : formatDuration(point.medianSec),
        },
      ]}
    />
  )
}
