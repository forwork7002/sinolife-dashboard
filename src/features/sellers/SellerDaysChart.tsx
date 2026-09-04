'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ChartTooltipPanel } from '@/components/charts/chartTooltip'
import { UnavailableState } from '@/components/states/States'
import type { SellerDayDto } from '@/lib/api'
import { formatCompactUzs, formatDateShort, formatNumber, formatUzs } from '@/lib/format'
import { useReducedMotion } from '@/lib/useReducedMotion'

/**
 * «Kunlik dinamika» — one seller's days, as the client's page draws them.
 *
 * THEIR CHART IS DUAL-AXIS AND THIS ONE IS NOT, which is the single
 * deliberate departure. They plot Lid as a line on a right-hand axis over
 * Fakt 1 and Fakt 2 as bars on a left-hand one. That is the chart form this
 * design system refuses outright, and the refusal is already written down
 * twice — `MarketingDynamics.tsx` and `RevenueTrendChart.tsx` — for one
 * reason: with two independent scales the author picks where the line crosses
 * the bars, so "leads dried up and sales followed" and "leads held while
 * sales fell" are the same data drawn at two right-axis ranges.
 *
 * Stacking the panels keeps every fact the original carried — the same days,
 * the same three measures, read against each other by looking straight down
 * the column — and takes away the only arbitrary thing about it.
 *
 * THE X AXIS IS SHARED FOR REAL, not by eye: both panels take the same array,
 * the same margins and the same FIXED y-axis width, so day N sits at the same
 * pixel in both. `width="auto"` — what every other chart in the app uses — is
 * exactly wrong here: it would measure «213 mln» in one panel and «41» in the
 * other and offset the plots by thirty pixels. Only the lower panel prints
 * tick labels; a repeated date row between two panels reads as two charts.
 */

/** The plot geometry both panels must agree on, or the axis is not shared. */
const AXIS_WIDTH = 62
const MARGIN = { top: 8, right: 12, left: 0, bottom: 0 } as const

interface Point {
  readonly label: string
  readonly ordered: number
  readonly won: number
  readonly orders: number
  readonly leads: number | null
}

export function SellerDaysChart({ days }: { days: readonly SellerDayDto[] }) {
  const reducedMotion = useReducedMotion()

  const points: Point[] = days.map((day) => ({
    label: formatDateShort(day.date),
    ordered: day.ordered.amount,
    won: day.won.amount,
    orders: day.orders,
    leads: day.leads,
  }))

  /*
    The lead panel renders only when there is a lead to draw. Every day
    carrying null is the state this application is in today — there is no
    lead source connected — and an empty line panel with a 0-100 axis would
    assert a measured zero. The panel says which it is instead.
  */
  const hasLeads = points.some((point) => point.leads !== null)

  return (
    <div className="space-y-1">
      <PanelLabel>Buyurtma puli, soʻm — och: FAKT 1, toʻq: FAKT 2</PanelLabel>
      <div style={{ width: '100%', height: 168 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={MARGIN}>
            <CartesianGrid vertical={false} stroke="var(--grid)" strokeDasharray="0" />
            {/* The axis exists — it is what positions the bars — but prints
                nothing: the lower panel carries the dates for both. */}
            <XAxis dataKey="label" hide />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={AXIS_WIDTH}
              tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
              tickFormatter={(value: number) => formatCompactUzs(value)}
            />
            <Tooltip
              cursor={{ fill: 'color-mix(in oklab, var(--ink-primary) 6%, transparent)' }}
              isAnimationActive={false}
              content={<DayTooltip />}
            />
            {/*
              ONE HUE AT TWO STEPS OF THE SEQUENTIAL RAMP, never two
              categorical slots: FAKT 2 is the part of FAKT 1 already
              delivered — one measure at two stages. The same grammar the
              table rows and the day list already use, so the light and dark
              steps mean the same thing everywhere on this page.
            */}
            <Bar
              dataKey="ordered"
              fill="var(--seq-250)"
              radius={[3, 3, 0, 0]}
              maxBarSize={16}
              isAnimationActive={!reducedMotion}
              animationDuration={520}
              animationEasing="ease-out"
            />
            <Bar
              dataKey="won"
              fill="var(--seq-550)"
              radius={[3, 3, 0, 0]}
              maxBarSize={16}
              isAnimationActive={!reducedMotion}
              animationDuration={520}
              animationEasing="ease-out"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <PanelLabel>
        {hasLeads ? 'Lid, ta' : 'Lid, ta'}
        {!hasLeads && (
          <span style={{ color: 'var(--ink-muted)' }}> · manba ulanmagan</span>
        )}
      </PanelLabel>
      {hasLeads ? (
        <div style={{ width: '100%', height: 132 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={MARGIN}>
              <CartesianGrid vertical={false} stroke="var(--grid)" strokeDasharray="0" />
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
                width={AXIS_WIDTH}
                tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
                tickFormatter={(value: number) => formatNumber(value)}
              />
              <Tooltip
                cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
                isAnimationActive={false}
                content={<DayTooltip />}
              />
              <Line
                dataKey="leads"
                stroke="var(--series-3)"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={!reducedMotion}
                animationDuration={520}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        /*
          The dates still have to be readable under the bars, so the fallback
          keeps the lower panel's x-axis and puts the explanation where the
          line would have been.
        */
        <div className="py-1">
          <UnavailableState hint="Lid soni bu bazada yoʻq — qaysi manbadan olinishi kelishilmagan." />
          <div style={{ width: '100%', height: 28 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={MARGIN}>
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
                  interval="preserveStartEnd"
                  minTickGap={28}
                />
                <YAxis width={AXIS_WIDTH} hide />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The unit, stated once at the top-left of the plot instead of rotated up the
 * y-axis where nobody reads it. Same treatment as `MarketingDynamics`.
 */
function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
      {children}
    </p>
  )
}

/** One tooltip surface for both panels, so a hover reads the same either way. */
function DayTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: readonly { payload: Point }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]!.payload

  return (
    <ChartTooltipPanel
      header={label ?? point.label}
      rows={[
        { swatch: 'var(--seq-250)', label: 'FAKT 1 — tasdiqlangan', value: formatUzs(point.ordered) },
        { swatch: 'var(--seq-550)', label: 'FAKT 2 — yetkazilgan', value: formatUzs(point.won) },
        { label: 'Buyurtma', value: `${formatNumber(point.orders)} ta` },
        {
          swatch: 'var(--series-3)',
          label: 'Lid',
          value: point.leads === null ? '—' : `${formatNumber(point.leads)} ta`,
        },
      ]}
    />
  )
}
