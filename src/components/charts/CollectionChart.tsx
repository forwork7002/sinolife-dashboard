'use client'

import { useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { endpointDot, endpointLabelWidth } from '@/components/charts/chartEndpoint'
import { ChartTooltipPanel } from '@/components/charts/chartTooltip'
import { formatCompactUzs, formatDateShort, formatUzs } from '@/lib/format'
import { useReducedMotion } from '@/lib/useReducedMotion'

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
 * The gap gets a faint wash between the lines because the gap is the POINT of
 * the chart — the reader is here to see uncollected money, so that region is
 * painted just enough to read as a shape rather than an absence. 7% of the
 * collected series' hue: visible on both themes, and far too quiet to pass
 * for a third series.
 *
 * Two series means a legend is required, and with only two they are also
 * distinguishable by their fixed categorical slots (blue, orange) rather than
 * by position.
 */
export function CollectionChart({
  data,
  height,
}: {
  data: readonly CollectionPointDto[]
  /**
   * Fixed height, or omit to fill the container. Same contract as
   * RevenueTrendChart — the hard-coded 280 died for the same reason its 280
   * did: fine alone, wrong beside any taller neighbour.
   */
  height?: number
}) {
  const reducedMotion = useReducedMotion()

  /** See RevenueTrendChart: the endpoint labels yield to the tooltip. */
  const [cursorNearEnd, setCursorNearEnd] = useState(false)

  const points = data.map((point) => ({
    ...point,
    label: formatDateShort(point.date),
    // The band between the lines, as a range series. Recharts draws an Area
    // whose dataKey yields [low, high] as a ribbon between the two values —
    // exactly the invoiced–collected gap, with no second axis and no fake
    // stacking arithmetic.
    gapBand: [point.collected, point.invoiced] as [number, number],
  }))

  const last = points[points.length - 1]
  const invoicedLabel = last ? formatCompactUzs(last.invoiced) : undefined
  const collectedLabel = last ? formatCompactUzs(last.collected) : undefined

  /**
   * When the two finals land nearly on top of each other, their endpoint
   * labels would overprint. "Nearly" is measured against the chart's whole
   * value span — under ~9% of it, two 11px labels physically overlap — and
   * the fix is symmetric: the higher line's label nudges up, the lower's
   * down. Data decides, so the labels never jitter with the cursor.
   */
  let invoicedShift = 0
  let collectedShift = 0
  if (last && points.length > 0) {
    const values = points.flatMap((p) => [p.invoiced, p.collected])
    const span = Math.max(...values) - Math.min(...values) || 1
    if (Math.abs(last.invoiced - last.collected) / span < 0.09) {
      invoicedShift = last.invoiced >= last.collected ? -7 : 7
      collectedShift = -invoicedShift
    }
  }

  const handleMove = (state: { activeTooltipIndex?: number | string | null | undefined }) => {
    const raw = state?.activeTooltipIndex
    const index = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
    setCursorNearEnd(
      Number.isFinite(index) && index >= points.length - Math.max(2, Math.ceil(points.length / 4)),
    )
  }

  // The wider of the two final figures decides the reserved margin — both
  // labels share the same right-edge column.
  const labelMargin = Math.max(
    invoicedLabel ? endpointLabelWidth(invoicedLabel) : 8,
    collectedLabel ? endpointLabelWidth(collectedLabel) : 8,
  )

  return (
    /*
      The absolute-fill sandwich (see RevenueTrendChart for the full story):
      a percentage height needs a definite parent, and an absolutely
      positioned child is the one box that always measures the real
      rectangle. The legend lives INSIDE the sandwich as a flex row so the
      plot takes whatever height the legend leaves, instead of the two
      overflowing the card together.
    */
    <div style={{ position: 'relative', width: '100%', height: height ?? '100%', minHeight: 280 }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={points}
                margin={{ top: 8, right: labelMargin, left: 0, bottom: 0 }}
                onMouseMove={handleMove}
                onMouseLeave={() => setCursorNearEnd(false)}
              >
                <CartesianGrid vertical={false} stroke="var(--grid)" />

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
                  // Measured, not guessed — see RevenueTrendChart.
                  width="auto"
                  tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
                  tickFormatter={(value: number) => formatCompactUzs(value)}
                />

                <Tooltip
                  cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
                  isAnimationActive={false}
                  content={<CollectionTooltip />}
                />

                {/* First, so the wash paints under both lines. No stroke, no
                    dots: the band is context, and its exact figure lives in
                    the tooltip's "Farq" row. */}
                <Area
                  dataKey="gapBand"
                  stroke="none"
                  fill="var(--series-2)"
                  fillOpacity={0.07}
                  activeDot={false}
                  legendType="none"
                  tooltipType="none"
                  isAnimationActive={!reducedMotion}
                  animationDuration={520}
                  animationEasing="ease-out"
                />

                <Line
                  type="monotone"
                  dataKey="invoiced"
                  name="Hisoblangan"
                  stroke="var(--series-1)"
                  strokeWidth={2}
                  dot={endpointDot({
                    lastIndex: points.length - 1,
                    color: 'var(--series-1)',
                    label: invoicedLabel,
                    showLabel: !cursorNearEnd,
                    labelShift: invoicedShift,
                  })}
                  activeDot={{
                    r: 4,
                    fill: 'var(--series-1)',
                    stroke: 'var(--surface-raised)',
                    strokeWidth: 2,
                  }}
                  isAnimationActive={!reducedMotion}
                  animationDuration={520}
                  animationEasing="ease-out"
                />
                <Line
                  type="monotone"
                  dataKey="collected"
                  name="Yigʻilgan"
                  stroke="var(--series-2)"
                  strokeWidth={2}
                  dot={endpointDot({
                    lastIndex: points.length - 1,
                    color: 'var(--series-2)',
                    label: collectedLabel,
                    showLabel: !cursorNearEnd,
                    labelShift: collectedShift,
                  })}
                  activeDot={{
                    r: 4,
                    fill: 'var(--series-2)',
                    stroke: 'var(--surface-raised)',
                    strokeWidth: 2,
                  }}
                  isAnimationActive={!reducedMotion}
                  animationDuration={520}
                  animationEasing="ease-out"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Legend rendered outside the SVG so it wraps and stays selectable.
            The band gets its own entry: an unexplained wash would make the
            reader guess, and guessing is what a legend exists to prevent. */}
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <LegendItem color="var(--series-1)" label="Hisoblangan" />
          <LegendItem color="var(--series-2)" label="Yigʻilgan" />
          <LegendItem color="var(--series-2)" label="Farq" kind="band" />
        </div>
      </div>
    </div>
  )
}

function LegendItem({
  color,
  label,
  kind = 'line',
}: {
  color: string
  label: string
  kind?: 'line' | 'band'
}) {
  return (
    <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--ink-secondary)' }}>
      <span
        aria-hidden="true"
        className={kind === 'band' ? 'inline-block h-2 w-4 rounded-sm' : 'inline-block h-0.5 w-4 rounded-full'}
        style={{
          // The band swatch is denser than the 7% plot wash on purpose: at
          // swatch size, 7% is invisible; the swatch's job is to say "the
          // faint region", not to colour-match it pixel for pixel.
          background:
            kind === 'band' ? `color-mix(in oklab, ${color} 22%, transparent)` : color,
        }}
      />
      {label}
    </span>
  )
}

/**
 * Payload → rows; the panel draws. "Farq" is computed here — it is a derived
 * quantity that exists in no series, which is exactly why the shared panel
 * takes rows as data.
 */
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
    <ChartTooltipPanel
      header={point.label}
      rows={[
        { swatch: 'var(--series-1)', label: 'Hisoblangan', value: formatUzs(point.invoiced) },
        { swatch: 'var(--series-2)', label: 'Yigʻilgan', value: formatUzs(point.collected) },
        ...(gap !== 0 ? [{ label: 'Farq', value: formatUzs(gap) }] : []),
      ]}
    />
  )
}
