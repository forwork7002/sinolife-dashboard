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
import { NO_VALUE, formatCents, formatCompactUzs, formatDate, formatNumber } from '@/lib/format'
import { useReducedMotion } from '@/lib/useReducedMotion'

import type { RoistatDayDto } from './roistatApi'
import { type RoistatCurrency, fromUsd, fromUzs, roasOf } from './roistatMetrics'

/**
 * «Динамика: расход и ROAS» — day by day, spend over ROAS.
 *
 * TWO PANELS, ONE DAY AXIS, NEVER A SECOND Y AXIS. The reference draws ROAS
 * on a right-hand axis over the spend bars; this codebase forbids that (see
 * `CategoryBarList`'s header): a second axis can be rescaled to imply any
 * relationship between the two series. So spend is its own short bar chart
 * and ROAS its own line under it, the two sharing the day columns and one
 * cursor (`syncId`), which is the dual-axis ban implemented rather than
 * worked around — the eye runs straight down from a bar to its ROAS.
 *
 * ROAS has a break-even line at 1×: below it the day lost money on ads, which
 * is the one threshold that needs no explaining.
 *
 * Settling days (on or after `freshFrom`) are drawn paler: their sales are
 * still closing, so a low ROAS there is expected, and the page says so above.
 *
 * Loaded on its own (`next/dynamic` in RoistatPage), like every recharts
 * importer here: recharts is most of what a route downloads.
 */

const SPEND_COLOUR = 'var(--series-1)'
const ROAS_COLOUR = 'var(--series-3)'
const SYNC_ID = 'roistat-daily'

interface Point {
  readonly label: string
  readonly day: RoistatDayDto
  readonly fresh: boolean
  /** Spend in the reader's currency, split so a settling day can be drawn paler. */
  readonly settled: number | null
  readonly settling: number | null
  readonly roas: number | null
}

export function RoistatDailyChart({
  days,
  currency,
  uzsPerUsd,
  freshFrom,
  height = 280,
}: {
  days: readonly RoistatDayDto[]
  currency: RoistatCurrency
  uzsPerUsd: number | null
  freshFrom: string
  height?: number
}) {
  const reducedMotion = useReducedMotion()

  const points: Point[] = days.map((day) => {
    const fresh = day.date >= freshFrom
    const spend = fromUsd(day.spendUsd, currency, uzsPerUsd)
    return {
      label: `${day.date.slice(8, 10)}.${day.date.slice(5, 7)}`,
      day,
      fresh,
      settled: fresh ? null : spend,
      settling: fresh ? spend : null,
      roas: roasOf(day.soldUzs, day.spendUsd, uzsPerUsd),
    }
  })
  const anyFresh = points.some((p) => p.fresh)

  const spendTick = (value: number) =>
    currency === 'uzs' ? formatCompactUzs(value) : formatNumber(Math.round(value))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height }}>
      <div
        className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]"
        style={{ color: 'var(--ink-secondary)' }}
      >
        <LegendItem color={SPEND_COLOUR} label={currency === 'uzs' ? 'Расход, сум' : 'Расход, $'} />
        <LegendItem color={ROAS_COLOUR} label="ROAS" line />
        {anyFresh && (
          <span style={{ color: 'var(--ink-muted)' }}>⏳ och ustunlar — kun hali yopilmagan</span>
        )}
      </div>

      {/* The absolute-fill sandwich — see CustomerFlowChart for why. */}
      <div style={{ position: 'relative', width: '100%', flex: 3, minHeight: 130 }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={points}
              syncId={SYNC_ID}
              margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
              barCategoryGap="20%"
            >
              <CartesianGrid vertical={false} stroke="var(--grid)" strokeDasharray="0" />
              <XAxis dataKey="label" hide />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={56}
                tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
                tickFormatter={spendTick}
              />
              <Tooltip
                cursor={{ fill: 'var(--track)' }}
                isAnimationActive={false}
                content={<DayTooltip currency={currency} uzsPerUsd={uzsPerUsd} />}
              />
              <Bar
                dataKey="settled"
                stackId="spend"
                fill={SPEND_COLOUR}
                radius={[3, 3, 0, 0]}
                isAnimationActive={!reducedMotion}
                animationDuration={420}
              />
              <Bar
                dataKey="settling"
                stackId="spend"
                fill={SPEND_COLOUR}
                fillOpacity={0.4}
                radius={[3, 3, 0, 0]}
                isAnimationActive={!reducedMotion}
                animationDuration={420}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ position: 'relative', width: '100%', flex: 2, minHeight: 100 }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} syncId={SYNC_ID} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                width={56}
                tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
                tickFormatter={(value: number) => `${formatNumber(Math.round(value * 10) / 10)}x`}
              />
              {/* The cursor only: the panel above already carries the day's tooltip. */}
              <Tooltip
                cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
                isAnimationActive={false}
                content={() => null}
              />
              {/* Before the series, so the hairline sits BEHIND the data. */}
              <ReferenceLine
                y={1}
                stroke="var(--axis)"
                strokeDasharray="4 4"
                label={{ value: '1x', position: 'insideTopRight', fill: 'var(--ink-muted)', fontSize: 11 }}
              />
              <Line
                type="monotone"
                dataKey="roas"
                // ROAS_COLOUR's slot, so it glows in its own colour in dark (globals.css, «Line glow»).
                className="glow-series-3"
                stroke={ROAS_COLOUR}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: ROAS_COLOUR, stroke: 'var(--surface-raised)', strokeWidth: 2 }}
                connectNulls
                isAnimationActive={!reducedMotion}
                animationDuration={520}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

function LegendItem({ color, label, line = false }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        style={{
          width: line ? 12 : 8,
          height: line ? 2 : 8,
          borderRadius: 2,
          background: color,
          display: 'inline-block',
        }}
      />
      {label}
    </span>
  )
}

function DayTooltip({
  active,
  payload,
  currency,
  uzsPerUsd,
}: {
  active?: boolean
  payload?: readonly { payload?: Point }[]
  currency: RoistatCurrency
  uzsPerUsd: number | null
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  const { day } = point
  const money = (value: number | null) =>
    value === null
      ? NO_VALUE
      : currency === 'uzs'
        ? `${formatCompactUzs(value)} soʻm`
        : `${formatCents(value)} $`

  return (
    <ChartTooltipPanel
      header={`${formatDate(`${day.date}T12:00:00Z`)}${point.fresh ? ' ⏳' : ''}`}
      rows={[
        { swatch: SPEND_COLOUR, label: 'Расход', value: money(fromUsd(day.spendUsd, currency, uzsPerUsd)) },
        { label: 'Выручка', value: money(fromUzs(day.soldUzs, currency, uzsPerUsd)) },
        {
          swatch: ROAS_COLOUR,
          label: 'ROAS',
          value: point.roas === null ? 'нет расхода' : `${formatCents(point.roas)}x`,
        },
      ]}
      footer={
        point.fresh
          ? 'Kun hali yopilmagan — sotuvlar keyinroq tushadi'
          : 'Tushum lid sanasiga bogʻlangan'
      }
    />
  )
}
