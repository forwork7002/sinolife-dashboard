'use client'

import dynamic from 'next/dynamic'

import { ChartSkeleton } from '@/components/states/States'
import { Card } from '@/components/ui/Card'
import { StatusChip } from '@/components/ui/Stat'
import { Tooltip } from '@/components/ui/Tooltip'
import { TrendIndicator } from '@/components/ui/TrendIndicator'

import { amountOf, type MarketingMetricsDto, type MarketingDayDto, type MarketingWindowDto } from './marketingApi'
import {
  GRADE_WORDS,
  ROAS_THRESHOLDS,
  type CurrencyMode,
  deltaOf,
  gradeOf,
  moneyFromUzs,
  percent,
  ratio,
} from './marketingFormat'

/**
 * The plot, fetched separately from the figures beside it.
 *
 * recharts is 379 KB unparsed / 109 KB over the wire, and it was in this
 * route's synchronous entry set — so the revenue headline, the ROAS chip and
 * the Meta share, all of them plain text, waited on a charting library to
 * compile before they could paint. They no longer do.
 *
 * `ssr: false` costs nothing: `ResponsiveContainer` measures the DOM in an
 * effect and renders an empty box on the server either way. The fallback is
 * the same `ChartSkeleton height={220}` this slot already shows while the
 * overview query is pending, so the chunk landing is not a second visible
 * state — it is the state that was already there.
 */
const RevenueTrend = dynamic(
  () => import('./MarketingHeroTrend').then((m) => m.RevenueTrend),
  { ssr: false, loading: () => <ChartSkeleton height={220} /> },
)

/**
 * The lead instrument: the period's revenue above the daily series it is the
 * sum of — the same panel grammar as the command centre's intake hero, because
 * a reader who learns one screen has learned both.
 *
 * This replaces the hero TILE the KPI band used to end with. A hero as one
 * cell of a twelve-tile grid could state its number but never show its shape;
 * the daily revenue series was in the payload the whole time and surfaced only
 * in a tooltip. The band's source-order story survives intact: eleven tiles in
 * the source's order, and the money still comes back at the end — now with the
 * evidence beside it.
 *
 * ROAS rides the hero as the client's OWN verdict, graded at their 3.0 / 1.5
 * thresholds (`ro()` in logic.js) — a judgement they already make, not one we
 * invented. "xarajat yoʻq" for a windowful of revenue with zero recorded spend
 * keeps the table's deliberate rule: that is broken attribution, not an
 * unknown ratio.
 *
 * The chart plots the DISPLAYED currency, exactly like the dynamics panels,
 * so the axis and the toggle cannot drift apart. The dashed reference is the
 * previous window's revenue as a per-day rate — the honest flat line, for the
 * same reason the intake hero refuses to splice last month in as a second zig.
 */
export function MarketingHero({
  current,
  previous,
  daily,
  previousWindow,
  dailyFrom,
  mode,
  rate,
  status,
}: {
  current: MarketingMetricsDto | undefined
  previous: MarketingMetricsDto | undefined
  daily: readonly MarketingDayDto[]
  previousWindow: MarketingWindowDto | undefined
  /** Rows before this date are monthly buckets and are labelled as months. */
  dailyFrom: string
  mode: CurrencyMode
  rate: number
  status: 'loading' | 'error' | 'ready'
}) {
  const revenue = current ? current.revenue.amount : null
  const value = moneyFromUzs(revenue, mode, rate, 'compact')
  const exact = moneyFromUzs(revenue, mode, rate, 'unit')
  const roas = current?.roas ?? null
  const grade = gradeOf(roas, ROAS_THRESHOLDS)

  /*
    The reference line's value: last window's revenue spread over its own
    calendar days. Inclusive date arithmetic on the window's own strings —
    the same ISO dates the service resolved, so no timezone can move them.
  */
  const previousDaily = (() => {
    if (!previous || !previousWindow || previous.revenue.amount <= 0) return null
    const days =
      Math.round(
        (Date.parse(previousWindow.to) - Date.parse(previousWindow.from)) / 86_400_000,
      ) + 1
    if (days < 1) return null
    const uzsPerDay = previous.revenue.amount / days
    return mode === 'usd' ? uzsPerDay / rate : uzsPerDay
  })()

  return (
    <Card className="card-hero brackets reveal" as="section">
      <div className="grid gap-x-8 gap-y-4 px-5 py-4 lg:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
            Tushum
          </p>

          {status === 'loading' ? (
            <div className="skeleton mt-2 h-10 w-48" role="status">
              <span className="sr-only">Yuklanmoqda</span>
            </div>
          ) : status === 'error' ? (
            <p className="mt-2 text-base font-medium" style={{ color: 'var(--status-critical)' }}>
              Olinmadi
            </p>
          ) : (
            <>
              <div className="mt-2">
                <Tooltip content={<span className="tabular">{exact}</span>}>
                  <span
                    tabIndex={0}
                    className="focusable figure-hero inline-block rounded-[var(--radius-panel-sm)]"
                    style={{ color: 'var(--ink-primary)' }}
                  >
                    {value}
                  </span>
                </Tooltip>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {current && (
                  <TrendIndicator
                    delta={deltaOf(current.revenue.amount, previous ? previous.revenue.amount : null)}
                  />
                )}
                {/* The client's own verdict on the money: revenue over spend,
                    graded at THEIR 3.0 / 1.5. Zero spend under real revenue is
                    named, not dashed — the table documents why. */}
                {status === 'ready' &&
                  (roas === null ? (
                    current && current.revenue.amount > 0 ? (
                      <StatusChip tone="critical">xarajat yoʻq</StatusChip>
                    ) : null
                  ) : (
                    <StatusChip tone={grade ?? 'neutral'}>
                      ROAS {ratio(roas)}× {grade ? GRADE_WORDS[grade] : ''}
                    </StatusChip>
                  ))}
              </div>

              <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                {current?.metaSharePercent !== null && current?.metaSharePercent !== undefined
                  ? `${percent(current.metaSharePercent)} qismi Meta reklamasiga bogʻlangan`
                  : 'Meta ulushi nomaʼlum'}
                {current?.averageCheque
                  ? ` · oʻrtacha chek ${moneyFromUzs(amountOf(current.averageCheque), mode, rate, 'compact')}`
                  : ''}
              </p>
            </>
          )}
        </div>

        <div className="min-w-0">
          {status === 'loading' ? (
            <ChartSkeleton height={220} />
          ) : status === 'error' ? (
            <p className="py-14 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
              Grafik uchun maʼlumot olinmadi
            </p>
          ) : daily.length >= 2 ? (
            <RevenueTrend
              daily={daily}
              dailyFrom={dailyFrom}
              mode={mode}
              rate={rate}
              previousDaily={previousDaily}
            />
          ) : (
            <p className="py-14 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
              Bu oynada grafik chizishga yetarli kun yoʻq
            </p>
          )}
        </div>
      </div>
    </Card>
  )
}

