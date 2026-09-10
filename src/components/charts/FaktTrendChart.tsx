'use client'

import { useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { endpointDot, endpointLabelWidth } from '@/components/charts/chartEndpoint'
import { ChartTooltipPanel } from '@/components/charts/chartTooltip'
import type { FaktTrendPointDto } from '@/lib/api'
import { formatDateShort, formatFullUzs, formatNumber, formatUzs } from '@/lib/format'
import { t } from '@/lib/messages'
import { useReducedMotion } from '@/lib/useReducedMotion'

/**
 * FAKT 1 and FAKT 2 over time — the whole of Savdo dinamikasi's hero chart.
 *
 * IT USED TO PLOT REVENUE TOO, AND THAT WAS THE THIRD THING THE CLIENT ASKED
 * US TO TAKE OFF THIS SCREEN on 2026-09-10: «menga bu boʻlim fakt 1 va fakt 2
 * va bitrix24dan». The closed-revenue area was the panel's subject, on its own
 * clock (the CLOSE date) against the pair's (arrival in C4:NEW) — two clocks
 * on one plot, and the reason this file used to carry four paragraphs
 * reconciling them. Removing the area removed the reconciliation with it: one
 * cohort, one clock, one basis line.
 *
 * It also removed `/analytics/sales` from the page. The area was the last
 * thing reading it, so the screen now runs on ONE cohort fetched ONCE —
 * `/analytics/sellers` — which is the other half of what the client asked for
 * («yengil va optimal ishlashligi tarafdoriman»).
 *
 * ONE Y AXIS, AND THAT RULE DOES NOT SOFTEN. Both series are soʻm and the
 * client asked for these two specifically so the magnitudes could be compared
 * — «bir birni ustida chiqib turadi, solishtirsa boʻladigan boʻladi». A second
 * axis would let the author imply any correlation they liked by rescaling.
 *
 * FAKT 1 CARRIES THE FILL AND THAT IS NOT NESTING. On the queue basis FAKT 2
 * is NOT a subset of FAKT 1 — an order refused in the queue and revived
 * afterwards delivers into FAKT 2 while never entering FAKT 1, so the two
 * cross over. Nothing here stacks them (`stackId` appears nowhere) and the
 * FAKT 2 line rides ABOVE the fill whenever it is the larger of the two,
 * which is the honest picture of two siblings rather than a whole and a part.
 * The fill is weight for the panel's subject, not arithmetic.
 *
 * Deal COUNT is never plotted; it lives in the tooltip, where it is exact.
 *
 * Grid and axes are recessive; the data is the only thing with weight. No axis
 * spine anywhere — the bottom gridline and the tick labels already say where
 * zero and the dates are, and a drawn spine is a box the chart does not need.
 */
export function FaktTrendChart({
  data,
  height,
  referenceValue,
  referenceLabel,
}: {
  /** The queue cohort's daily FAKT 1 / FAKT 2, from `/analytics/sellers?include=faktTrend`. */
  data: readonly FaktTrendPointDto[]
  /**
   * Fixed height, or omit to fill the container.
   *
   * It was hard-coded at 280px, which is fine on its own and wrong beside a
   * taller neighbour: in the overview's two-column row the funnel next to it
   * ran to 628px and left 348px of empty card under the chart. A trend line
   * with twice the vertical resolution is worth more than that whitespace.
   */
  height?: number
  /**
   * Optional horizontal reference — a dashed hairline at this value, e.g. the
   * period's own FAKT 1 average, so "is this day above or below the bar?" is
   * answerable from the chart itself. Drawn in --axis, not a series colour: it
   * is context, not data, and must never compete with a line for attention.
   */
  referenceValue?: number
  /** Label for the reference line, small and right-aligned above it. */
  referenceLabel?: string
}) {
  // Recharts drives its draw-in from JS, out of reach of the CSS media
  // guards every other animation sits behind — so it asks the same question
  // in component code.
  const reducedMotion = useReducedMotion()

  /**
   * Whether the cursor is hovering the FINAL quarter of the plot. The
   * endpoint value labels live at the right edge, exactly where the tooltip
   * and crosshair end up when the reader inspects recent points — so they
   * yield while the tooltip is in their territory. The tooltip states the
   * same values precisely, so nothing is lost while they are hidden.
   */
  const [cursorNearEnd, setCursorNearEnd] = useState(false)

  const points = data.map((point) => ({ ...point, label: formatDateShort(point.date) }))

  const last = points[points.length - 1]
  // In full, like the axis and the headline above it. `endpointLabelWidth`
  // measures whatever it is given, so the reserved right margin grows with the
  // longer string rather than clipping it.
  const fakt1End = last ? formatFullUzs(last.fakt1) : undefined
  const fakt2End = last ? formatFullUzs(last.fakt2) : undefined

  /*
    TWO FINAL VALUES SHARE ONE RIGHT EDGE, so they are pushed apart when they
    would otherwise print on top of each other.

    The old chart never had this problem: revenue was the only series with a
    printed end value and the two FAKTs carried none. With the area gone both
    are worth printing — and on this cohort they land within a hair of one
    another on any day the whole intake was delivered. The threshold is a
    share of the plot's own value range, not a fixed soʻm amount, because the
    axis rescales with the window.
  */
  const span = points.reduce((max, point) => Math.max(max, point.fakt1, point.fakt2), 0)
  const endsCollide =
    last !== undefined && span > 0 && Math.abs(last.fakt1 - last.fakt2) < span * 0.06

  const handleMove = (state: { activeTooltipIndex?: number | string | null | undefined }) => {
    const raw = state?.activeTooltipIndex
    const index = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
    setCursorNearEnd(
      Number.isFinite(index) && index >= points.length - Math.max(2, Math.ceil(points.length / 4)),
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: height ?? '100%' }}>
      {/*
        THE LEGEND IS OURS, NOT RECHARTS'. Its own <Legend> reserves a band
        inside the plot and re-lays the chart out when it wraps; this is two
        static items in the panel's own type, above the plot, where it also has
        room to carry the basis — which is the half of the legend that actually
        prevents a misreading.
      */}
      <div
        className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]"
        style={{ color: 'var(--ink-secondary)' }}
      >
        <LegendItem color="var(--series-2)" label={t.chart.fakt1} />
        <LegendItem color="var(--series-3)" label={t.chart.fakt2} />
        <span style={{ color: 'var(--ink-muted)' }}>{t.chart.faktBasis}</span>
      </div>
      {/*
      The absolute-fill sandwich, and why it exists.

      `height: 100%` resolves against the parent's HEIGHT PROPERTY, and when
      that is `auto` — any plain ChartCard — the percentage resolves to auto,
      the chart's box computes to zero, and Recharts draws nothing. min-height
      raises the USED height, but percentage resolution never looks at used
      heights, so the sales page rendered a 260px card with an empty chart in
      it. An absolutely-positioned child, by contrast, resolves inset against
      the used padding box — min-height included — so the measurer always sees
      the real rectangle, in a flex parent and a plain card alike.

      The height now sits on the wrapper above, and this box takes what the
      legend left: `flex: 1` with `minHeight` still on it, so a fixed-height
      caller loses the legend's band from the plot rather than growing the card.
      */}
      <div
        className="glow-series-2"
        style={{ position: 'relative', width: '100%', flex: 1, minHeight: 260 }}
      >
        <div style={{ position: 'absolute', inset: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={points}
              // Right margin reserves the endpoint labels' column so the final
              // figures are never clipped by the SVG edge. Reserved even while
              // the labels are hidden — a margin that followed hover would make
              // the whole plot breathe on every mouse move.
              margin={{
                top: 8,
                right: Math.max(
                  fakt1End ? endpointLabelWidth(fakt1End) : 8,
                  fakt2End ? endpointLabelWidth(fakt2End) : 8,
                ),
                left: 0,
                bottom: 0,
              }}
              onMouseMove={handleMove}
              onMouseLeave={() => setCursorNearEnd(false)}
            >
              <defs>
                <linearGradient id="fakt1Fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--series-2)" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="var(--series-2)" stopOpacity={0.01} />
                </linearGradient>
              </defs>

              <CartesianGrid vertical={false} stroke="var(--grid)" strokeDasharray="0" />

              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
                // Thin the ticks rather than rotating them: rotated labels are
                // slower to read and eat vertical space the plot needs.
                interval="preserveStartEnd"
                minTickGap={28}
              />

              <YAxis
                tickLine={false}
                axisLine={false}
                /*
                  'auto' measures the rendered tick labels instead of guessing.
                  The old constant was 64 — sized for '900 mln', the worst case
                  — which taxed every chart whose ticks were '80 mln' with dead
                  gutter. Letting Recharts measure gives the tight width AND
                  survives the mlrd-scale charts that forced 64 in the first
                  place.
                */
                width="auto"
                tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
                /*
                  THE LAST DIGIT, NOT «600 mln» — the client's instruction on
                  2026-09-09 was that every figure on this screen is printed in
                  full. `width="auto"` above is what makes it affordable: it
                  MEASURES the rendered labels, so the gutter is exactly as wide
                  as this month's numbers need and no wider.
                */
                tickFormatter={(value: number) => formatFullUzs(value)}
              />

              <Tooltip
                // The crosshair: one hairline in axis ink, snapped to the point.
                cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
                // The tooltip tracks the pointer with no easing lag — an
                // animated chase reads as sluggishness, not polish — which also
                // means there is nothing here for reduced-motion to switch off.
                isAnimationActive={false}
                content={<FaktTooltip />}
              />

              {/* Before the series so the hairline sits BEHIND the data: SVG
                  paints in document order, and context must never overdraw. */}
              {referenceValue !== undefined && (
                <ReferenceLine
                  y={referenceValue}
                  stroke="var(--axis)"
                  strokeDasharray="4 4"
                  // A target above every data point must still be visible —
                  // clipping it would silently hide the one line that says
                  // "you are below the bar".
                  ifOverflow="extendDomain"
                  label={
                    referenceLabel
                      ? {
                          value: referenceLabel,
                          position: 'insideTopRight',
                          fill: 'var(--ink-muted)',
                          fontSize: 11,
                        }
                      : undefined
                  }
                />
              )}

              <Area
                type="monotone"
                dataKey="fakt1"
                stroke="var(--series-2)"
                strokeWidth={2}
                fill="url(#fakt1Fill)"
                // No dot per point — at 23+ points they merge into a dotted
                // line. Only the LAST point is marked: it is the value the
                // chart is stating, and the printed figure beside it ties
                // shape to number.
                dot={endpointDot({
                  lastIndex: points.length - 1,
                  color: 'var(--series-2)',
                  label: fakt1End,
                  showLabel: !cursorNearEnd,
                  labelShift: endsCollide ? -9 : 0,
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

              {/*
                AFTER the area, so FAKT 2 paints over the fill rather than under
                it — a line lost inside an 18%-opacity gradient is a line the
                reader cannot follow, which is the one thing this pair is drawn
                together to allow.

                Same 2px weight as FAKT 1: they are peers. The old chart drew
                both at 1.5px because a revenue area was the subject and these
                two were references to it; with the area gone there is no third
                thing for them to defer to.
              */}
              <Line
                type="monotone"
                dataKey="fakt2"
                stroke="var(--series-3)"
                strokeWidth={2}
                dot={endpointDot({
                  lastIndex: points.length - 1,
                  color: 'var(--series-3)',
                  label: fakt2End,
                  showLabel: !cursorNearEnd,
                  labelShift: endsCollide ? 9 : 0,
                })}
                activeDot={{
                  r: 4,
                  fill: 'var(--series-3)',
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
    </div>
  )
}

/** One legend entry: a series dot and its name. */
function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: color,
          display: 'inline-block',
        }}
      />
      {label}
    </span>
  )
}

interface TooltipPayload {
  payload?: FaktTrendPointDto & { label: string }
}

/**
 * Payload → rows. The mapping stays here, beside the chart that knows what
 * its series mean; the drawing lives in ChartTooltipPanel, shared app-wide.
 */
function FaktTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null

  return (
    <ChartTooltipPanel
      header={point.label}
      rows={[
        { swatch: 'var(--series-2)', label: t.chart.fakt1, value: formatUzs(point.fakt1) },
        { swatch: 'var(--series-3)', label: t.chart.fakt2, value: formatUzs(point.fakt2) },
        { label: 'Buyurtmalar', value: formatNumber(point.orders) },
      ]}
      /* Stated on every hover, not only in the legend: the tooltip is where a
         reader compares the figures digit by digit, and that is exactly the
         moment a cohort dated by its ARRIVAL looks like a broken total. */
      footer={t.chart.faktBasis}
    />
  )
}
