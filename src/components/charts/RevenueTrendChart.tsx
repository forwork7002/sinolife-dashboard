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
import { type FaktChartPoint, mergeFaktSeries } from '@/components/charts/faktSeries'
import type { FaktTrendPointDto, TrendPointDto } from '@/lib/api'
import { formatCompactUzs, formatDateShort, formatNumber, formatUzs } from '@/lib/format'
import { t } from '@/lib/messages'
import { useReducedMotion } from '@/lib/useReducedMotion'

/**
 * Revenue over time, and — since 2026-09-09 — FAKT 1 and FAKT 2 over it.
 *
 * ONE SERIES BY DEFAULT, so there is still no legend when `fakt` is absent:
 * the card title names the measure, and a legend box for a single line is
 * noise. Deal COUNT is never plotted; it lives in the tooltip, where it is
 * exact and cannot mislead.
 *
 * ONE Y AXIS EVEN WITH THREE SERIES, and this is the rule that must not be
 * softened. A dual-axis chart lets the author imply any correlation they like
 * by rescaling, and the client asked for these three specifically so the
 * magnitudes could be compared — «bir birni ustida chiqib turadi, solishtirsa
 * boʻladigan boʻladi». Rescaling one of them would answer a question nobody
 * asked with a picture that looks like the answer to this one. All three are
 * soʻm; they belong on one scale.
 *
 * TWO CLOCKS, AND THE CHART SAYS SO — because they cannot be reconciled by
 * looking. Revenue is booked on the CLOSE date; FAKT 1 and FAKT 2 are dated by
 * the order's arrival in the confirmation queue (C4:NEW). The legend carries
 * the basis and so does the tooltip, for the same reason `FaktBasisNote`
 * carries it under the tiles further down the page: their totals differ by a
 * wide margin in any month, and a reader who does not see the basis named
 * concludes one of the two is broken.
 *
 * THE AREA IS STILL THE HERO. Revenue keeps the fill, the endpoint dot and the
 * printed end value; the two FAKTs are unfilled 1.5px lines, so the panel has
 * one subject and two references rather than three things shouting.
 *
 * Grid and axes are recessive; the data is the only thing with weight. No axis
 * spine anywhere — the bottom gridline and the tick labels already say where
 * zero and the dates are, and a drawn spine is a box the chart does not need.
 */
export function RevenueTrendChart({
  data,
  fakt,
  height,
  referenceValue,
  referenceLabel,
}: {
  data: readonly TrendPointDto[]
  /**
   * FAKT 1 / FAKT 2 for the same window, from
   * `/analytics/sellers?include=faktTrend`. Omit it and the chart is exactly
   * what it was: one area, no legend.
   *
   * Zipped onto the revenue buckets by `mergeFaktSeries`, which drops any
   * point the area has no bucket for — see that module for why the area owns
   * the axis.
   */
  fakt?: readonly FaktTrendPointDto[]
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
   * previous period's average, so "is this good?" is answerable from the
   * chart itself. Drawn in --axis, not a series colour: it is context, not
   * data, and must never compete with the line for attention.
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
   * endpoint value label lives at the right edge, exactly where the tooltip
   * and crosshair end up when the reader inspects recent points — so the
   * label yields while the tooltip is in its territory. The tooltip states
   * the same value precisely, so nothing is lost while it is hidden.
   */
  const [cursorNearEnd, setCursorNearEnd] = useState(false)

  const points = mergeFaktSeries(data, fakt).map((point) => ({
    ...point,
    label: formatDateShort(point.date),
  }))

  /*
    Whether anything was actually matched, not merely whether a prop arrived.
    An empty answer, or one whose buckets did not line up, leaves every FAKT
    value null — and a legend naming two series that draw nothing is chrome
    describing nothing.
  */
  const hasFakt = points.some((point) => point.fakt1 !== null || point.fakt2 !== null)

  const last = points[points.length - 1]
  const endLabel = last ? formatCompactUzs(last.revenue) : undefined

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
        inside the plot and re-lays the chart out when it wraps; this is three
        static items in the panel's own type, above the plot, where it also has
        room to carry the second basis — which is the half of the legend that
        actually prevents a misreading.
      */}
      {hasFakt && (
        <div
          className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]"
          style={{ color: 'var(--ink-secondary)' }}
        >
          <LegendItem color="var(--series-1)" label={t.cards.revenue} />
          <LegendItem color="var(--series-2)" label={t.chart.fakt1} />
          <LegendItem color="var(--series-3)" label={t.chart.fakt2} />
          <span style={{ color: 'var(--ink-muted)' }}>{t.chart.faktBasis}</span>
        </div>
      )}
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
        className="glow-series-1"
        style={{ position: 'relative', width: '100%', flex: 1, minHeight: 260 }}
      >
      <div style={{ position: 'absolute', inset: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={points}
          // Right margin reserves the endpoint label's column so the final
          // figure is never clipped by the SVG edge. Reserved even while the
          // label is hidden — a margin that follows hover would make the whole
          // plot breathe on every mouse move.
          margin={{ top: 8, right: endLabel ? endpointLabelWidth(endLabel) : 8, left: 0, bottom: 0 }}
          onMouseMove={handleMove}
          onMouseLeave={() => setCursorNearEnd(false)}
        >
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
              The old constant was 64 — sized for '900 mln', the worst case —
              which taxed every chart whose ticks were '80 mln' with dead
              gutter. Letting Recharts measure gives the tight width AND
              survives the mlrd-scale charts that forced 64 in the first
              place.
            */
            width="auto"
            tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
            tickFormatter={(value: number) => formatCompactUzs(value)}
          />

          <Tooltip
            // The crosshair: one hairline in axis ink, snapped to the point.
            cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
            // The tooltip tracks the pointer with no easing lag — an animated
            // chase reads as sluggishness, not polish — which also means there
            // is nothing here for reduced-motion to switch off.
            isAnimationActive={false}
            content={<TrendTooltip />}
          />

          {/* Before the Area so the hairline sits BEHIND the data: SVG paints
              in document order, and context must never overdraw the series. */}
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
            dataKey="revenue"
            stroke="var(--series-1)"
            strokeWidth={2}
            fill="url(#revenueFill)"
            // No dot per point — at 23+ points they merge into a dotted line.
            // Only the LAST point is marked: it is the value the chart is
            // stating, and the printed figure beside it ties shape to number.
            dot={endpointDot({
              lastIndex: points.length - 1,
              color: 'var(--series-1)',
              label: endLabel,
              showLabel: !cursorNearEnd,
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

          {/*
            AFTER the area, so the two references paint over the fill rather
            than under it — a 1.5px line lost inside an 18%-opacity gradient is
            a line the reader cannot follow, which is the one thing this pair
            was added to allow.

            No fill and no endpoint label on either: the area is still the
            panel's subject, and three printed end values at the right edge
            would collide at any width the sidebar leaves.

            `connectNulls={false}` is the default and is written out anyway —
            `mergeFaktSeries` emits null for a bucket the queue did not answer
            for, and joining across it would draw a straight line through days
            that were never measured.
          */}
          <Line
            type="monotone"
            dataKey="fakt1"
            stroke="var(--series-2)"
            strokeWidth={1.5}
            dot={false}
            activeDot={{
              r: 3.5,
              fill: 'var(--series-2)',
              stroke: 'var(--surface-raised)',
              strokeWidth: 2,
            }}
            connectNulls={false}
            isAnimationActive={!reducedMotion}
            animationDuration={520}
            animationEasing="ease-out"
          />
          <Line
            type="monotone"
            dataKey="fakt2"
            stroke="var(--series-3)"
            strokeWidth={1.5}
            dot={false}
            activeDot={{
              r: 3.5,
              fill: 'var(--series-3)',
              stroke: 'var(--surface-raised)',
              strokeWidth: 2,
            }}
            connectNulls={false}
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
  payload?: FaktChartPoint & { label: string }
}

/**
 * Payload → rows. The mapping stays here, beside the chart that knows what
 * its series mean; the drawing lives in ChartTooltipPanel, shared app-wide.
 */
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
    <ChartTooltipPanel
      header={point.label}
      rows={[
        { swatch: 'var(--series-1)', label: t.cards.revenue, value: formatUzs(point.revenue) },
        { label: t.cards.dealsWon, value: formatNumber(point.dealsWon) },
        { label: t.cards.dealsCreated, value: formatNumber(point.dealsCreated) },
        /*
          The FAKT pair comes LAST and only when the chart is drawing it, so a
          tooltip on the ordinary one-series chart is unchanged. `!= null` and
          not a truthiness test: a bucket that genuinely confirmed nothing is a
          zero worth reading, and dropping it would make an empty day look like
          an unanswered one.
        */
        ...(point.fakt1 !== null
          ? [{ swatch: 'var(--series-2)', label: t.chart.fakt1, value: formatUzs(point.fakt1) }]
          : []),
        ...(point.fakt2 !== null
          ? [{ swatch: 'var(--series-3)', label: t.chart.fakt2, value: formatUzs(point.fakt2) }]
          : []),
      ]}
      /* Stated on every hover, not only in the legend: the tooltip is where a
         reader compares the three numbers digit by digit, and that is exactly
         the moment two different clocks look like one broken figure. */
      footer={point.fakt1 !== null || point.fakt2 !== null ? t.chart.faktBasis : undefined}
    />
  )
}
