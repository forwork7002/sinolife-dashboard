'use client'

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ChartTooltipPanel, type ChartTooltipRow } from '@/components/charts/chartTooltip'
import { SquareGlyph } from '@/components/ui/Icons'
import { formatNumber } from '@/lib/format'
import { LEAD_CHANNELS, LEAD_CHANNEL_ORDER, LEAD_CHANNEL_STACK, type LeadChannelKey } from '@/lib/leadChannels'
import { LEAD_WATCH_SETTINGS } from '@/lib/leadWatchSettings'
import { useReducedMotion } from '@/lib/useReducedMotion'

import type { LeadWatchDto, LeadWatchFlowHourDto } from './leadWatchApi'
import { hourRange } from './leadWatchLogic'

/**
 * «Bugungi lead oqimi» — today's leads hour by hour, stacked by channel, with
 * the same hour's usual figure drawn over them.
 *
 * ONE AXIS, ONE UNIT: bars and line both count leads in an hour, which is
 * what lets the line sit on the bars honestly — «bugun odatdagidan kammi» is
 * read off the gap between a bar's top and the line.
 *
 * THE STACK ORDER IS `LEAD_CHANNEL_STACK`, not the reading order: blue and
 * violet may not touch (see `leadChannels.ts`). Segments are parted by a gap
 * of the surface, so a boundary is never carried by hue alone, and the
 * tooltip names every channel's count.
 *
 * AN HOUR THAT HAS NOT STARTED HAS NO BAR, and the average over it is dashed
 * and quieter: an empty slot under a dashed line reads «not yet», where a
 * zero-height bar under a solid one would read «nothing came».
 *
 * A STOP is a faint band of the critical step behind its hours, and its
 * sentence is printed under the plot — the band alone is a colour, and
 * colour is never the only channel.
 */

const STOP_COLOR = 'var(--status-critical)'
const AVERAGE_COLOR = 'var(--ink-secondary)'

interface Point extends Record<LeadChannelKey, number> {
  readonly hour: number
  readonly label: string
  readonly total: number
  readonly average: number
  readonly past: boolean
  /** The average where the day has happened, and where it has not — two strokes of one line. */
  readonly averagePast: number | null
  readonly averageAhead: number | null
}

const hourLabel = (hour: number) => `${String(hour % 24).padStart(2, '0')}:00`

function toPoints(hours: readonly LeadWatchFlowHourDto[]): Point[] {
  const lastPast = hours.reduce((last, hour, index) => (hour.past ? index : last), -1)
  return hours.map((hour, index) => {
    const counts = LEAD_CHANNEL_ORDER.reduce(
      (out, channel) => ({ ...out, [channel]: hour.past ? (hour.counts[channel] ?? 0) : 0 }),
      {} as Record<LeadChannelKey, number>,
    )
    return {
      ...counts,
      hour: hour.hour,
      label: hourLabel(hour.hour),
      total: LEAD_CHANNEL_ORDER.reduce((sum, channel) => sum + counts[channel], 0),
      average: hour.average,
      past: hour.past,
      averagePast: index <= lastPast ? hour.average : null,
      // Starts ON the last past hour, so the dashed stroke continues the solid one without a break.
      averageAhead: index >= lastPast ? hour.average : null,
    }
  })
}

/** One decimal for an average that has one; a whole number otherwise. */
const formatAverage = (value: number) =>
  Number.isInteger(value) ? formatNumber(value) : value.toFixed(1).replace('.', ',')

export function LeadFlowChart({ flow, height = 180 }: { flow: LeadWatchDto['flow']; height?: number }) {
  // Recharts draws in from JS, out of reach of the CSS media guards.
  const reducedMotion = useReducedMotion()
  const points = toPoints(flow.hours)
  const hasOther = points.some((point) => point.other > 0)
  const legend = LEAD_CHANNEL_ORDER.filter((channel) => channel !== 'other' || hasOther)
  const stack = LEAD_CHANNEL_STACK.filter((channel) => channel !== 'other' || hasOther)
  const first = points[0]?.hour
  const last = points[points.length - 1]?.hour
  const total = points.reduce((sum, point) => sum + point.total, 0)

  if (points.length === 0 || first === undefined || last === undefined) {
    return (
      <p className="py-8 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
        Ish vaqti ({hourLabel(LEAD_WATCH_SETTINGS.workHours.from)}–{hourLabel(LEAD_WATCH_SETTINGS.workHours.to)}) uchun
        hali maʼlumot yoʻq.
      </p>
    )
  }

  // A stop is drawn over the hours the axis has; one wholly outside working hours has no band.
  const bands = flow.stops
    .map((stop) => ({ from: Math.max(first, stop.fromHour), to: Math.min(last, stop.toHour - 1) }))
    .filter((band) => band.from <= band.to)

  return (
    <div className="flex flex-col">
      {/* Ours, not Recharts' <Legend>: its own reserves a band inside the plot and re-lays it out when it wraps. */}
      <div
        className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]"
        style={{ color: 'var(--ink-secondary)' }}
      >
        {legend.map((channel) => (
          <span key={channel} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: LEAD_CHANNELS[channel].color }}
            />
            {LEAD_CHANNELS[channel].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-0.5 w-3.5 rounded-full" style={{ background: AVERAGE_COLOR }} />
          {LEAD_WATCH_SETTINGS.channelStop.historyDays} kunlik oʻrtacha
        </span>
        {bands.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-3.5 rounded-[3px]"
              style={{ background: `color-mix(in oklab, ${STOP_COLOR} 22%, transparent)` }}
            />
            Kanal toʻxtagan
          </span>
        )}
      </div>

      {/* The absolute-fill sandwich (see DailyOutcomeChart): the measurer always sees a real rectangle. */}
      <div
        role="img"
        aria-label={`Bugungi lead oqimi, soatma-soat: jami ${formatNumber(total)} ta lead`}
        style={{ position: 'relative', width: '100%', height }}
      >
        <div style={{ position: 'absolute', inset: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke="var(--grid)" strokeDasharray="0" />

              {bands.map((band) => (
                <ReferenceArea
                  key={`${band.from}-${band.to}`}
                  x1={hourLabel(band.from)}
                  x2={hourLabel(band.to)}
                  fill={STOP_COLOR}
                  fillOpacity={0.1}
                  stroke="none"
                  ifOverflow="hidden"
                />
              ))}

              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
                // Every third hour: twelve labels under twelve bars is a ruler nobody reads.
                interval={2}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width="auto"
                tickCount={3}
                tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
                tickFormatter={formatNumber}
                allowDecimals={false}
              />

              <Tooltip cursor={{ fill: 'var(--glass-hover)' }} isAnimationActive={false} content={<FlowTooltip channels={legend} />} />

              {stack.map((channel) => (
                <Bar
                  key={channel}
                  dataKey={channel}
                  stackId="leads"
                  fill={LEAD_CHANNELS[channel].color}
                  shape={Segment}
                  maxBarSize={28}
                  isAnimationActive={!reducedMotion}
                  animationDuration={420}
                  animationEasing="ease-out"
                />
              ))}

              <Line
                type="monotone"
                dataKey="averagePast"
                stroke={AVERAGE_COLOR}
                strokeWidth={1.5}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="averageAhead"
                stroke={AVERAGE_COLOR}
                strokeOpacity={0.55}
                strokeWidth={1.5}
                strokeDasharray="3 4"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {flow.stops.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {flow.stops.map((stop) => (
            <li
              key={`${stop.fromHour}-${stop.toHour}-${stop.label}`}
              className="flex items-start gap-1.5 text-[11.5px] leading-snug"
              style={{ color: 'var(--ink-secondary)' }}
            >
              <span className="mt-[2px] shrink-0" style={{ color: STOP_COLOR }}>
                <SquareGlyph size={10} />
              </span>
              <span>
                <span className="tabular font-medium" style={{ color: 'var(--ink-primary)' }}>
                  {hourLabel(stop.fromHour)}–{hourLabel(stop.toHour)}
                </span>{' '}
                · {stop.label}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* The same figures as a table, for a reader the drawing does not reach. In a clipped box: a
          table ignores the 1px width `sr-only` gives it and widened the page by its own columns. */}
      <div className="sr-only">
        <table>
          <caption>Bugungi lead oqimi, soatma-soat</caption>
          <thead>
            <tr>
              <th scope="col">Soat</th>
              {legend.map((channel) => (
                <th key={channel} scope="col">
                  {LEAD_CHANNELS[channel].label}
                </th>
              ))}
              <th scope="col">Oʻrtacha</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.hour}>
                <th scope="row">{hourRange(point.hour)}</th>
                {legend.map((channel) => (
                  <td key={channel}>{point.past ? point[channel] : '—'}</td>
                ))}
                <td>{formatAverage(point.average)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * One segment of a stacked bar, drawn short of the one above it by a gap of
 * the surface. A stroke would have done it and drawn a hairline for every
 * channel that had nothing that hour.
 */
function Segment(props: { x?: number; y?: number; width?: number; height?: number; fill?: string }) {
  const { x = 0, y = 0, width = 0, height = 0, fill } = props
  const gap = height > 3 ? 1.5 : 0
  if (height <= 0 || width <= 0) return null
  return <rect x={x} y={y + gap} width={width} height={height - gap} rx={2} fill={fill} />
}

function FlowTooltip({
  channels,
  active,
  payload,
}: {
  channels: readonly LeadChannelKey[]
  active?: boolean
  payload?: readonly { payload?: Point }[]
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  const average: ChartTooltipRow = {
    label: `${LEAD_WATCH_SETTINGS.channelStop.historyDays} kunlik oʻrtacha`,
    value: formatAverage(point.average),
  }
  if (!point.past) {
    return <ChartTooltipPanel header={hourRange(point.hour)} rows={[average]} footer="Bu soat hali boshlanmagan" />
  }
  return (
    <ChartTooltipPanel
      header={hourRange(point.hour)}
      rows={[
        ...channels.map((channel) => ({
          swatch: LEAD_CHANNELS[channel].color,
          label: LEAD_CHANNELS[channel].label,
          value: `${formatNumber(point[channel])} ta`,
        })),
        { label: 'Jami', value: `${formatNumber(point.total)} ta` },
        average,
      ]}
    />
  )
}
