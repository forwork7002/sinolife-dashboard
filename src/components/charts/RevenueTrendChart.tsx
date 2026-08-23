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

import type { TrendPointDto } from '@/lib/api'
import { formatCompactUzs, formatDateShort, formatNumber, formatUzs } from '@/lib/format'
import { t } from '@/lib/messages'

/**
 * Revenue over time.
 *
 * ONE series, so there is no legend — the card title names the measure, and a
 * legend box for a single line is noise. Revenue and deal count are NOT plotted
 * together on two y-axes: a dual-axis chart lets the author imply any
 * correlation they like by rescaling. The deal count lives in the tooltip
 * instead, where it is exact and cannot mislead.
 *
 * Grid and axes are recessive; the data is the only thing with weight.
 */
export function RevenueTrendChart({ data }: { data: readonly TrendPointDto[] }) {
  const points = data.map((point) => ({
    ...point,
    label: formatDateShort(point.date),
  }))

  return (
    <div style={{ width: '100%', height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
            axisLine={{ stroke: 'var(--axis)' }}
            tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
            // Thin the ticks rather than rotating them: rotated labels are
            // slower to read and eat vertical space the plot needs.
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

          <Tooltip
            cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
            content={<TrendTooltip />}
          />

          <Area
            type="monotone"
            dataKey="revenue"
            stroke="var(--series-1)"
            strokeWidth={2}
            fill="url(#revenueFill)"
            // No dot per point — at 23+ points they merge into a dotted line.
            // The active dot on hover is the affordance instead.
            dot={false}
            activeDot={{
              r: 4,
              fill: 'var(--series-1)',
              stroke: 'var(--surface)',
              strokeWidth: 2,
            }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

interface TooltipPayload {
  payload?: TrendPointDto & { label: string }
}

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
        <Row
          swatch="var(--series-1)"
          label={t.cards.revenue}
          value={formatUzs(point.revenue)}
        />
        <Row label={t.cards.dealsWon} value={formatNumber(point.dealsWon)} />
        <Row label={t.cards.dealsCreated} value={formatNumber(point.dealsCreated)} />
      </dl>
    </div>
  )
}

function Row({ swatch, label, value }: { swatch?: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <dt className="flex items-center gap-1.5" style={{ color: 'var(--ink-secondary)' }}>
        {swatch && (
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: swatch }}
          />
        )}
        {label}
      </dt>
      {/* Value in text ink, not the series colour. */}
      <dd className="tabular font-medium">{value}</dd>
    </div>
  )
}
