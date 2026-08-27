'use client'

import { useId } from 'react'

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
  baseline,
}: {
  readonly values: readonly number[]
  color?: string
  height?: number
  label?: string
  /**
   * Optional reference value — a dashed hairline at e.g. the previous
   * period's average, so the shape answers "above or below the bar?" without
   * growing axes. The domain STRETCHES to include it: clamping a baseline
   * that sits outside the data would draw it pinned to an edge, claiming a
   * proximity that is not true.
   *
   * The time window the values cover stays the caller's job to state, as
   * before — a sparkline has no x-axis to say it.
   */
  baseline?: number
}) {
  // Unique per instance: two sparklines sharing one gradient id would both
  // paint whichever <defs> happened to render first. Above the early return,
  // because hooks must run on every render path.
  const gradientId = `spark-${useId().replace(/[^a-zA-Z0-9]/g, '')}`

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
  const min = Math.min(...values, ...(baseline !== undefined ? [baseline] : []))
  const max = Math.max(...values, ...(baseline !== undefined ? [baseline] : []))
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
    /*
      The marker lives OUTSIDE the svg, and that is the whole point.

      `preserveAspectRatio="none"` stretches a 100-unit viewBox across whatever
      width the tile happens to be — typically 380px — so one x-unit is nearly
      four pixels while one y-unit stays one. The line survives that because
      `non-scaling-stroke` exempts its stroke, but a <circle> has no such
      escape: r=2.5 rendered as a 19×2.5 pixel ellipse, a smear rather than a
      dot. Positioning it in the layout instead means it is round at every
      width, with no aspect ratio to compensate for.
    */
    <span className="relative block" style={{ height }}>
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
        <defs>
          {/* The fill fades to nothing rather than sitting as a flat tint —
              the line reads as lit from above, and the baseline stays clean. */}
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {/* Before the data paths: SVG paints in document order, and a
            reference must sit behind the line, not across it. Dashes and
            stroke width stay in screen pixels via non-scaling-stroke — the
            stretched viewBox would otherwise pull each dash four ways. */}
        {baseline !== undefined && (
          <line
            x1={0}
            x2={width}
            y1={height - 2 - ((baseline - min) / span) * (height - 4)}
            y2={height - 2 - ((baseline - min) / span) * (height - 4)}
            stroke="var(--axis)"
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path d={area} fill={`url(#${gradientId})`} />
        <path
          className="draw-in"
          style={{
            filter: `drop-shadow(0 1px 5px color-mix(in oklab, ${color} 50%, transparent))`,
          }}
          pathLength={1}
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* A surface-coloured ring keeps the end marker legible where it
          overlaps the line's own fill. Ring width 2px, matching the Recharts
          charts' endpoint dots — one marker language across every trend the
          app draws, tile-sized or full-sized. */}
      <span
        aria-hidden="true"
        className="absolute block rounded-full"
        style={{
          width: 5,
          height: 5,
          background: color,
          boxShadow: '0 0 0 2px var(--surface-raised)',
          left: `${(last[0] / width) * 100}%`,
          top: last[1],
          transform: 'translate(-50%, -50%)',
        }}
      />
    </span>
  )
}
