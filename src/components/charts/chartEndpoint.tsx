'use client'

import type { ReactNode } from 'react'

/**
 * Endpoint marker for trend lines: a dot on the LAST point plus the final
 * value printed just past the right edge of the plot.
 *
 * A line at rest carries no dots — at 23+ points they merge into a dotted
 * smear — but the last point is the one the chart is actually stating ("where
 * we are now"), so it alone gets a marker, and the figure beside it ties the
 * shape to a number without the reader hovering anything. Stripe and Mercury
 * both end their trend lines this way; it is the cheapest piece of chart
 * finishing that reads as craft.
 *
 * Implemented as a Recharts `dot` render rather than a ReferenceDot: a
 * ReferenceDot addresses the point by its x CATEGORY value, and our x values
 * are formatted dates without a year, which can repeat across a long window —
 * the dot would then snap to the wrong occurrence. The dot render is handed
 * the index, which cannot be ambiguous.
 */

/**
 * What Recharts hands a custom `dot` render, reduced to the fields we read.
 * Typed loose (`unknown`) and narrowed at runtime so this stays compatible
 * with whatever extra props Recharts adds to the render call.
 */
interface EndpointDotRenderProps {
  readonly cx?: unknown
  readonly cy?: unknown
  readonly index?: unknown
}

export function endpointDot({
  lastIndex,
  color,
  label,
  showLabel = true,
  labelShift = 0,
}: {
  /** Index of the series' final point — the only one that gets a marker. */
  lastIndex: number
  /** The series' own colour: the marker restates the line's identity. */
  color: string
  /** Formatted final value. Omit to draw the dot alone. */
  label?: string
  /**
   * Collision guard, decided by the caller: the label shares the right edge
   * with the hover tooltip, and only the chart knows when the cursor is near
   * enough for the two to fight.
   */
  showLabel?: boolean
  /**
   * Vertical nudge in px. Two series ending at nearly the same value would
   * print their labels on top of each other; the caller pushes one up and one
   * down when it can see the finals are close.
   */
  labelShift?: number
}): (props: EndpointDotRenderProps) => ReactNode {
  return function EndpointDot({ cx, cy, index }: EndpointDotRenderProps): ReactNode {
    if (index !== lastIndex || typeof cx !== 'number' || typeof cy !== 'number') return null
    return (
      <g>
        {/* A raised-surface ring, because charts live on raised cards: the
            ring must match the paper behind the line, or it reads as a halo. */}
        <circle
          cx={cx}
          cy={cy}
          r={4.5}
          fill={color}
          stroke="var(--surface-raised)"
          strokeWidth={2}
        />
        {label && showLabel && (
          <text
            x={cx + 9}
            y={cy + labelShift}
            className="tabular"
            fill={color}
            fontSize={11}
            fontWeight={600}
            dominantBaseline="central"
            textAnchor="start"
          >
            {label}
          </text>
        )}
      </g>
    )
  }
}

/**
 * How much right margin a chart must reserve so the endpoint label is not
 * clipped by the SVG edge. 6.2px/char is the measured advance of tabular
 * digits at 11px in the app's stack, plus the 9px dot offset and breathing
 * room. Over-reserving by a few px costs nothing; under-reserving truncates
 * the number, so the constant leans generous.
 */
export function endpointLabelWidth(label: string): number {
  return Math.ceil(label.length * 6.2) + 16
}
