'use client'

import { useId } from 'react'

/**
 * The lit-from-above fill every Recharts <Bar> wears — one <linearGradient>
 * per series slot, rendered into the chart's own <defs>.
 *
 * WHAT MOVES AND WHAT MAY NOT. The reference boards light each bar from the
 * top: the series colour at the cap, easing toward the card at the base. The
 * HUE is the series' identity (docs/DESIGN.md — slot order is the
 * colourblind-safety mechanism), so only luminance moves: both stops are the
 * slot's own token, and the base stop is that token at BAR_BASE_OPACITY,
 * composited over whatever card the chart sits on. That is how "toward the
 * card" follows the theme with no second palette — over navy it deepens,
 * over white it softens.
 *
 * OPACITY, NOT color-mix(). Every other gradient here (Sparkline,
 * FaktTrendChart, MarketingHero) fades with stopOpacity, and the EMAL note in
 * globals.css records why nothing else is safe: an old TV Chromium dropped
 * color-mix() stops inside <defs>, and the medal <defs> were rebuilt on
 * literal tokens for it. A dropped stop here would paint a bar black.
 *
 * 0.8 IS MEASURED, NOT CHOSEN — tests/components/seriesGradientDefs.test.tsx
 * recomputes it from globals.css. Every stop of a data mark must clear 3:1
 * against --surface-raised in both themes, and the base stop is the tight
 * one because a fade toward WHITE washes the light palette out: 0.78 is the
 * floor (slot 3 light 3.06, slot 2 dark 3.08); 0.62 reads like the reference
 * in dark and stands at 2.4–2.8 on both cards. Slots 4 and 6 do not clear at
 * any fade worth drawing (slot 4 light is 3.04 at FULL opacity, slot 6 dark
 * 2.90 at 0.8), so they are not offered — the type is the guard.
 *
 * PER-BAR, NOT PER-PLOT. The gradient runs in objectBoundingBox units (the
 * SVG default): a 12px bar and a 200px bar are each lit at THEIR OWN cap.
 * userSpaceOnUse would dim every short bar whole.
 *
 * IDS. Two CallTimeCharts share /calls, so a fixed id would have both charts
 * painting whichever <defs> rendered first. `useSeriesGradientPrefix` is
 * Sparkline's pattern — React's useId stripped to id-safe characters; the
 * charts load with `ssr: false`, and useId is server-stable anyway.
 *
 * ONE THING TO KNOW BEFORE ADDING RECHARTS' OWN <Legend> OR DEFAULT <Tooltip>
 * to a chart wearing this: Recharts copies a Bar's `fill` into its payload as
 * `color`, and here that is `url(#…)`, which paints nothing as a CSS colour.
 * Every chart using this has a hand-rolled legend and a custom tooltip that
 * read `seriesColour(slot)` instead.
 */

/** Slots a bar may wear — 4 and 6 fall under 3:1 at BAR_BASE_OPACITY (see above). */
export type BarSeriesSlot = 1 | 2 | 3 | 5 | 7 | 8

/** Base-stop opacity. Move it only with the contrast test's numbers. */
export const BAR_BASE_OPACITY = 0.8

/**
 * Top corners only — a bar sits ON the baseline. Recharts clamps each corner
 * to half the bar's width and height, so the hourly chart's 4px bars at
 * 375px keep their 2px cap and a 16px bar wears the full 6.
 */
export const BAR_RADIUS: [number, number, number, number] = [6, 6, 0, 0]

/** The slot's flat token — legend square and tooltip dot restate the bar's CAP colour. */
export function seriesColour(slot: BarSeriesSlot): string {
  return `var(--series-${slot})`
}

function gradientId(prefix: string, slot: BarSeriesSlot): string {
  return `${prefix}-series-${slot}`
}

/** What a <Bar fill> takes. */
export function seriesGradientFill(prefix: string, slot: BarSeriesSlot): string {
  return `url(#${gradientId(prefix, slot)})`
}

/** One prefix per chart instance — called once at the top, like any hook. */
export function useSeriesGradientPrefix(): string {
  return `bars${useId().replace(/[^a-zA-Z0-9]/g, '')}`
}

export function SeriesGradientDefs({
  prefix,
  slots,
}: {
  prefix: string
  /** The slots this chart's bars use — one gradient each, nothing unused. */
  slots: readonly BarSeriesSlot[]
}) {
  return (
    <defs>
      {slots.map((slot) => (
        <linearGradient key={slot} id={gradientId(prefix, slot)} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={seriesColour(slot)} stopOpacity={1} />
          <stop offset="100%" stopColor={seriesColour(slot)} stopOpacity={BAR_BASE_OPACITY} />
        </linearGradient>
      ))}
    </defs>
  )
}
