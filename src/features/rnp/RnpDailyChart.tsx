'use client'

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { type ChartTooltipRow, ChartTooltipPanel } from '@/components/charts/chartTooltip'
import { formatCompactUzs, formatDate, formatNumber, formatUzs } from '@/lib/format'
import { useReducedMotion } from '@/lib/useReducedMotion'

import type { RnpRowDto } from './rnpApi'
import { dayMonth, weekday } from './rnpDerive'

/**
 * A month of one sheet row as bars, a second row as a line, on ONE axis.
 *
 * Both series always share a unit — FAKT 1 and FAKT 2 are soʻm, handed-out
 * leads and orders are counts — so the magnitudes compare honestly; two
 * measures of different units never meet here (no second axis, ever).
 *
 * The x axis is the WHOLE month: the days not lived yet stay as empty room on
 * the right, so «how far into the month» is read off the chart's shape. Days
 * before the bar row's `reliableFrom` are washed and their bars faded — drawn,
 * because they happened, but visibly not a figure to compare against.
 */
export interface RnpSeries {
  readonly label: string
  readonly color: string
  readonly row: RnpRowDto | null
}

interface Point {
  readonly date: string
  readonly tick: string
  readonly bar: number | null
  readonly line: number | null
  readonly early: boolean
  readonly index: number
}

export function RnpDailyChart({
  days,
  today,
  bar,
  line,
  unit,
  dayPlan,
  extraRows,
  height = 280,
}: {
  days: readonly string[]
  today: string
  bar: RnpSeries
  line: RnpSeries
  unit: 'uzs' | 'count'
  /** The bar row's day plan — a dashed reference line when there is one. */
  dayPlan?: number | null
  /** More tooltip rows for day `i` (figures the chart does not draw). */
  extraRows?: (i: number) => ChartTooltipRow[]
  height?: number
}) {
  const reducedMotion = useReducedMotion()
  const reliableFrom = bar.row?.reliableFrom ?? null
  const points: Point[] = days.map((date, index) => ({
    date,
    tick: String(Number(date.slice(8, 10))),
    bar: date <= today ? (bar.row?.days[index] ?? null) : null,
    line: date <= today ? (line.row?.days[index] ?? null) : null,
    early: reliableFrom !== null && date < reliableFrom,
    index,
  }))
  const earlyDays = points.filter((p) => p.early)
  const fmt = (v: number) => (unit === 'uzs' ? formatCompactUzs(v) : formatNumber(Math.round(v)))
  const full = (v: number | null) =>
    v === null ? '—' : unit === 'uzs' ? formatUzs(v) : formatNumber(Math.round(v))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height }}>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
        <LegendItem color={bar.color} label={bar.label} shape="bar" />
        <LegendItem color={line.color} label={line.label} shape="line" />
        {dayPlan != null && <LegendItem label="Kunlik reja" shape="dash" />}
        {earlyDays.length > 0 && reliableFrom && (
          <span style={{ color: 'var(--ink-muted)' }}>{dayMonth(reliableFrom)} gacha — Bitrix24 da toʻliq emas</span>
        )}
      </div>
      <div style={{ position: 'relative', width: '100%', flex: 1, minHeight: 180 }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke="var(--grid)" strokeDasharray="0" />
              {earlyDays.length > 0 && (
                <ReferenceArea
                  x1={earlyDays[0]!.tick}
                  x2={earlyDays.at(-1)!.tick}
                  fill="var(--track)"
                  fillOpacity={0.45}
                  stroke="none"
                  ifOverflow="visible"
                />
              )}
              <XAxis
                dataKey="tick"
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
                interval="preserveStartEnd"
                minTickGap={10}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width="auto"
                allowDecimals={false}
                tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
                tickFormatter={fmt}
              />
              <Tooltip
                cursor={{ fill: 'var(--track)', fillOpacity: 0.5 }}
                isAnimationActive={false}
                content={
                  <DayTooltip
                    bar={bar}
                    line={line}
                    full={full}
                    dayPlan={dayPlan ?? null}
                    extraRows={extraRows}
                  />
                }
              />
              {dayPlan != null && (
                <ReferenceLine
                  y={dayPlan}
                  stroke="var(--axis)"
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                  label={{ value: 'Kunlik reja', position: 'insideTopRight', fill: 'var(--ink-muted)', fontSize: 11 }}
                />
              )}
              <Bar
                dataKey="bar"
                fill={bar.color}
                radius={[4, 4, 0, 0]}
                maxBarSize={22}
                isAnimationActive={!reducedMotion}
                animationDuration={420}
              >
                {points.map((p) => (
                  <Cell key={p.date} fill={bar.color} fillOpacity={p.early ? 0.35 : 1} />
                ))}
              </Bar>
              <Line
                type="monotone"
                dataKey="line"
                stroke={line.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: line.color, stroke: 'var(--surface-raised)', strokeWidth: 2 }}
                isAnimationActive={!reducedMotion}
                animationDuration={520}
                animationEasing="ease-out"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

function LegendItem({ color, label, shape }: { color?: string; label: string; shape: 'bar' | 'line' | 'dash' }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {shape === 'bar' ? (
        <span aria-hidden style={{ width: 8, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />
      ) : (
        <span
          aria-hidden
          style={{
            width: 14,
            height: 0,
            borderTop: shape === 'dash' ? '2px dashed var(--axis)' : `2px solid ${color}`,
            display: 'inline-block',
          }}
        />
      )}
      {label}
    </span>
  )
}

function DayTooltip({
  bar,
  line,
  full,
  dayPlan,
  extraRows,
  active,
  payload,
}: {
  bar: RnpSeries
  line: RnpSeries
  full: (v: number | null) => string
  dayPlan: number | null
  extraRows?: (i: number) => ChartTooltipRow[]
  active?: boolean
  payload?: readonly { payload?: Point }[]
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  const rows: ChartTooltipRow[] = [
    { swatch: bar.color, label: bar.label, value: full(point.bar) },
    { swatch: line.color, label: line.label, value: full(point.line) },
    ...(extraRows?.(point.index) ?? []),
    ...(dayPlan !== null ? [{ label: 'Kunlik reja', value: full(dayPlan) }] : []),
  ]
  return (
    <ChartTooltipPanel
      header={`${formatDate(`${point.date}T12:00:00Z`)} · ${weekday(point.date)}`}
      rows={rows}
      footer={point.early ? 'Bu kun Bitrix24 da toʻliq emas — oy hisobiga kirmaydi' : undefined}
    />
  )
}
