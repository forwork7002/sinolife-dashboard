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

import { formatCompactUzs, formatDateShort, formatUzs } from '@/lib/format'

export interface CollectionPointDto {
  readonly date: string
  readonly invoiced: number
  readonly collected: number
}

/**
 * Invoiced versus collected.
 *
 * TWO series, ONE axis — and that is the whole reason this chart works. Both
 * are so'm, so the vertical gap between the lines IS the money not yet
 * collected, readable directly off the chart. A second y-axis would let that
 * gap be drawn at any width and would make the comparison meaningless.
 *
 * Two series means a legend is required, and with only two they are also
 * distinguishable by their fixed categorical slots (blue, orange) rather than
 * by position.
 */
export function CollectionChart({ data }: { data: readonly CollectionPointDto[] }) {
  const points = data.map((point) => ({ ...point, label: formatDateShort(point.date) }))

  return (
    <div style={{ width: '100%', height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />

          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: 'var(--axis)' }}
            tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
            interval="preserveStartEnd"
            minTickGap={28}
          />

          <YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
            tickFormatter={(value: number) => formatCompactUzs(value)}
          />

          <Tooltip cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }} content={<CollectionTooltip />} />

          <Line
            type="monotone"
            dataKey="invoiced"
            name="Hisoblangan"
            stroke="var(--series-1)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: 'var(--series-1)', stroke: 'var(--surface)', strokeWidth: 2 }}
            isAnimationActive
            animationDuration={520}
            animationEasing="ease-out"
          />
          <Line
            type="monotone"
            dataKey="collected"
            name="Yigʻilgan"
            stroke="var(--series-2)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: 'var(--series-2)', stroke: 'var(--surface)', strokeWidth: 2 }}
            isAnimationActive
            animationDuration={520}
            animationEasing="ease-out"
          />
        </LineChart>
      </ResponsiveContainer>

      {/* Legend rendered outside the SVG so it wraps and stays selectable. */}
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <LegendItem color="var(--series-1)" label="Hisoblangan" />
        <LegendItem color="var(--series-2)" label="Yigʻilgan" />
      </div>
    </div>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--ink-secondary)' }}>
      <span
        aria-hidden="true"
        className="inline-block h-0.5 w-4 rounded-full"
        style={{ background: color }}
      />
      {label}
    </span>
  )
}

function CollectionTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: { payload?: CollectionPointDto & { label: string } }[]
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null

  const gap = point.invoiced - point.collected

  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-lg"
      style={{
        background: 'var(--surface-raised)',
        borderColor: 'var(--border-strong)',
        color: 'var(--ink-primary)',
      }}
    >
      <p className="font-medium">{point.label}</p>
      <dl className="mt-1.5 space-y-1">
        <Row color="var(--series-1)" label="Hisoblangan" value={formatUzs(point.invoiced)} />
        <Row color="var(--series-2)" label="Yigʻilgan" value={formatUzs(point.collected)} />
        {gap !== 0 && (
          <Row label="Farq" value={formatUzs(gap)} />
        )}
      </dl>
    </div>
  )
}

function Row({ color, label, value }: { color?: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <dt className="flex items-center gap-1.5" style={{ color: 'var(--ink-secondary)' }}>
        {color && (
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: color }}
          />
        )}
        {label}
      </dt>
      <dd className="tabular font-medium">{value}</dd>
    </div>
  )
}
