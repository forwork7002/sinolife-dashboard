'use client'

import { NO_VALUE, formatNumber } from '@/lib/format'

/**
 * A trend, at tile size.
 *
 * Deliberately hand-drawn SVG rather than a charting library: at 24 pixels
 * tall there are no axes, no legend and no tooltip to configure, and a
 * Recharts instance per tile costs a render tree the tile does not need.
 *
 * There is no y-axis, so the shape means "up or down from itself" and nothing
 * more — the number beside it carries the magnitude. That is the honest
 * reading of a sparkline and the reason the last point is marked: it ties the
 * shape to the figure the tile is actually stating.
 */
export function Sparkline({
  values,
  color = 'var(--seq-450)',
  height = 26,
  label,
}: {
  readonly values: readonly number[]
  color?: string
  height?: number
  label?: string
}) {
  // Two points is the minimum that can express a direction. One is a dot with
  // no story, and drawing it would imply a trend that was never measured.
  if (values.length < 2) {
    return (
      <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        {NO_VALUE}
      </span>
    )
  }

  const width = 100
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width
    // Inset by 2px top and bottom so the stroke is never clipped at the
    // extremes, which is what makes a flat-looking line at the top edge.
    const y = height - 2 - ((v - min) / span) * (height - 4)
    return [x, y] as const
  })

  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${path} L${width},${height} L0,${height} Z`
  const last = points[points.length - 1]!
  const rising = values[values.length - 1]! >= values[0]!

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label={
        label ??
        `Trend: ${formatNumber(values[0]!)} dan ${formatNumber(values[values.length - 1]!)} gacha, ${rising ? 'oʻsish' : 'pasayish'}`
      }
    >
      <path d={area} fill={color} opacity={0.1} />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* A surface-coloured ring keeps the end marker legible where it
          overlaps the line's own fill. */}
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} stroke="var(--surface)" strokeWidth={1.5} />
    </svg>
  )
}
