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
import { formatCompactUzs, formatDate, formatNumber, formatPercent } from '@/lib/format'
import { useReducedMotion } from '@/lib/useReducedMotion'

import type { TargetGroupDto } from './targetApi'

/**
 * Leads and orders, day by day.
 *
 * TWO BARS, ONE AXIS, ONE UNIT — both are counts of deals, so they share the
 * axis honestly; a second axis is forbidden in this codebase. The money and
 * the pass rate ride the tooltip rather than a third mark, because soʻm on a
 * count axis would be a second unit.
 *
 * Loaded on its own (`next/dynamic` in TargetPage), like every recharts
 * importer here: recharts is most of what a route downloads.
 */

const LEADS_COLOUR = 'var(--series-1)'
const ORDERS_COLOUR = 'var(--series-3)'

interface Point {
  readonly label: string
  readonly row: TargetGroupDto
  readonly leads: number
  readonly orders: number
}

export function TargetDailyChart({
  days,
  height = 260,
}: {
  days: readonly TargetGroupDto[]
  height?: number
}) {
  const reducedMotion = useReducedMotion()
  const points: Point[] = days.map((row) => ({
    label: row.key.slice(8, 10) + '.' + row.key.slice(5, 7),
    row,
    leads: row.leads,
    orders: row.orders,
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height }}>
      <div
        className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]"
        style={{ color: 'var(--ink-secondary)' }}
      >
        <LegendItem color={LEADS_COLOUR} label="Leadlar" />
        <LegendItem color={ORDERS_COLOUR} label="Buyurtmalar" />
      </div>

      {/* The absolute-fill sandwich — see CustomerFlowChart for why. */}
      <div style={{ position: 'relative', width: '100%', flex: 1, minHeight: 180 }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={points}
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
                content={<DayTooltip />}
              />
              <Bar
                dataKey="leads"
                fill={LEADS_COLOUR}
                radius={[3, 3, 0, 0]}
                isAnimationActive={!reducedMotion}
                animationDuration={420}
              />
              <Bar
                dataKey="orders"
                fill={ORDERS_COLOUR}
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

function DayTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: readonly { payload?: Point }[]
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  const row = point.row

  return (
    <ChartTooltipPanel
      header={formatDate(`${row.key}T12:00:00Z`)}
      rows={[
        { swatch: LEADS_COLOUR, label: 'Leadlar', value: formatNumber(row.leads) },
        {
          label: 'Sotuvchiga uzatildi',
          value: `${formatNumber(row.leadWon)} · ${formatPercent(row.passPercent)}`,
        },
        { swatch: ORDERS_COLOUR, label: 'Buyurtmalar', value: formatNumber(row.orders) },
        { label: 'Buyurtma summasi', value: `${formatCompactUzs(row.ordered.amount)} soʻm` },
        {
          label: 'Yetkazildi',
          value: `${formatNumber(row.delivered)} · ${formatCompactUzs(row.deliveredMoney.amount)} soʻm`,
        },
      ]}
      footer="Yaratilgan kuni boʻyicha: lead — roʻyxatga olingan, buyurtma — sotuv bitimi ochilgan kun"
    />
  )
}
